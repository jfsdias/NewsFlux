"""Primary / fallback routing (Track B), request/response v3. Synthetic only; no network.

Gates: ONE_SECONDARY_ATTEMPT_MAX, TRANSIENT_ONLY, NO_FALLBACK_ON_AUTH_CONTENT_VALIDATION,
FALLBACK_REVALIDATED_AT_ATTEMPT, PAID_FALLBACK_NEEDS_CONSENT, CROSS_PROVIDER_NEEDS_CONSENT,
SESSION_REVALIDATED_BEFORE_FALLBACK, SAME_BUDGET_LEDGER, VERIFIABLE_PROVENANCE, V2_UNCHANGED.
"""

from __future__ import annotations

import copy
import unittest

from services.article_intel_auth.auth import AuthSettings, MinifluxAuthService
from services.article_intel_summary.app import create_app
from services.article_intel_summary.catalog import CatalogEntry, ModelRouter
from services.article_intel_summary.inference import InferenceResult, InferenceUnavailable
from services.article_intel_summary.litellm_adapter import TransientLiteLLMFailure
from services.article_intel_summary.profiles import DEFAULT_PROFILE
from services.article_intel_summary.service import SummaryService
from services.article_intel_summary.tests.support import (
    ENTRY_ID,
    MINIFLUX_BASE,
    WEB_ORIGIN,
    FakeMinifluxHTTP,
    SyncASGIClient,
    request_headers,
)
from services.article_intel_summary.tests.test_v2_catalog_profiles import V2_OUTPUT

REQUEST_ID = "44444444-4444-4444-8444-444444444444"


class Adapter:
    def __init__(self, name, *, error=None, output=None, on_call=None):
        self.name = name
        self.error = error
        self.output = output if output is not None else copy.deepcopy(V2_OUTPUT)
        self.calls = 0
        self.timeouts = []
        self.on_call = on_call

    def summarize(self, request, *, timeout_seconds):
        self.calls += 1
        self.timeouts.append(timeout_seconds)
        if self.on_call:
            self.on_call()
        if self.error is not None:
            raise self.error
        return InferenceResult(
            output=copy.deepcopy(self.output),
            provider_id="litellm",
            deployment_id=self.name,
            effective_model_id=f"alias-{self.name}",
            prompt_version="editorial-summary-v2-profile-litellm",
        )


def entry(model_id, adapter, *, provider="LiteLLM", paid=False, reason=None):
    available = adapter is not None and reason is None
    return CatalogEntry(
        model_id, available, None if available else (reason or "INFERENCE_DISABLED"), None, provider=provider, paid=paid
    )


def router(*specs, default=None):
    entries, adapters = {}, {}
    for model_id, adapter, kwargs in specs:
        entries[model_id] = entry(model_id, adapter, **kwargs)
        if entries[model_id].available:
            adapters[model_id] = adapter
    return ModelRouter(entries, adapters, default)


def client_for(model_router):
    settings = AuthSettings(
        miniflux_base_url=MINIFLUX_BASE,
        allowed_web_origins=frozenset({WEB_ORIGIN}),
        admin_user_ids=frozenset(),
        admin_allowlist_state="empty",
    )
    miniflux = FakeMinifluxHTTP()
    auth = MinifluxAuthService(settings, http=miniflux)
    service = SummaryService(Adapter("legacy"), router=model_router)
    return SyncASGIClient(create_app(auth_service=auth, summary_service=service)), miniflux


def v3(primary="free-a", fallback="free-b", *, paid=False, cross=False, **changes):
    document = {
        "schema_version": "3",
        "request_id": REQUEST_ID,
        "primary_model_id": primary,
        "fallback_model_id": fallback,
        "fallback_consent": {"paid": paid, "cross_provider": cross},
        "profile": copy.deepcopy(DEFAULT_PROFILE),
    }
    document.update(changes)
    return document


def post(client, body):
    return client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=body)


TRANSIENTS = (
    (TransientLiteLLMFailure("t", kind="TIMEOUT"), "PRIMARY_TIMEOUT"),
    (TransientLiteLLMFailure("t", kind="RATE_LIMITED"), "PRIMARY_RATE_LIMITED"),
    (TransientLiteLLMFailure("t", kind="UPSTREAM_UNAVAILABLE"), "PRIMARY_UPSTREAM_UNAVAILABLE"),
)


class PrimaryFallbackTests(unittest.TestCase):
    def test_primary_success_never_touches_fallback(self) -> None:
        a, b = Adapter("a"), Adapter("b")
        client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        response = post(client, v3())
        self.assertEqual(response.status_code, 200, response.text)
        provenance = response.json()["provenance"]
        self.assertEqual((a.calls, b.calls), (1, 0))
        self.assertEqual(response.json()["schema_version"], "3")
        self.assertEqual(provenance["requested_model_id"], "free-a")
        self.assertEqual(provenance["primary_model_id"], "free-a")
        self.assertEqual(provenance["fallback_model_id"], "free-b")
        self.assertEqual(provenance["effective_model_id"], "free-a")
        self.assertEqual(provenance["effective_model_alias"], "alias-a")
        self.assertFalse(provenance["fallback_used"])
        self.assertIsNone(provenance["fallback_reason"])
        self.assertEqual(provenance["fallback_outcome"], "NOT_NEEDED")
        self.assertEqual(provenance["attempts"], 1)
        self.assertEqual(provenance["pricing_class"], "free")

    def test_transient_primary_failure_uses_one_fallback_attempt(self) -> None:
        for error, reason in TRANSIENTS:
            a, b = Adapter("a", error=error), Adapter("b")
            client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
            response = post(client, v3())
            self.assertEqual(response.status_code, 200, response.text)
            provenance = response.json()["provenance"]
            self.assertEqual((a.calls, b.calls), (1, 1), reason)
            self.assertTrue(provenance["fallback_used"])
            self.assertEqual(provenance["fallback_reason"], reason)
            self.assertEqual(provenance["fallback_outcome"], "USED")
            self.assertEqual(provenance["effective_model_id"], "free-b")
            self.assertEqual(provenance["effective_model_alias"], "alias-b")
            self.assertEqual(provenance["attempts"], 2)
            # the primary had only part of the time; the fallback the rest, never more than the total
            self.assertLess(a.timeouts[0], 15)

    def test_fallback_failure_is_final_no_third_attempt(self) -> None:
        a = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT"))
        b = Adapter("b", error=TransientLiteLLMFailure("t", kind="TIMEOUT"))
        client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        response = post(client, v3())
        self.assertEqual(response.status_code, 503)
        provenance = response.json()["provenance"]
        self.assertEqual((a.calls, b.calls), (1, 1))
        self.assertEqual(provenance["fallback_outcome"], "FAILED")
        self.assertFalse(provenance["fallback_used"])
        self.assertEqual(provenance["attempts"], 2)
        self.assertEqual(response.json()["summary"], "")

    def test_non_transient_failures_never_fall_back(self) -> None:
        for error in (InferenceUnavailable("policy/auth/budget"), RuntimeError("other"), TimeoutError("deadline")):
            a, b = Adapter("a", error=error), Adapter("b")
            client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
            response = post(client, v3())
            self.assertEqual(response.status_code, 503, error)
            self.assertEqual(b.calls, 0, error)
            self.assertEqual(response.json()["provenance"]["fallback_outcome"], "NOT_ELIGIBLE")

    def test_invalid_model_output_never_falls_back(self) -> None:
        a = Adapter("a", output={"summary": "x"})
        b = Adapter("b")
        client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        response = post(client, v3())
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "MODEL_OUTPUT_INVALID")
        self.assertEqual(b.calls, 0)

    def test_fallback_disabled_means_single_attempt(self) -> None:
        a, b = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT")), Adapter("b")
        client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        response = post(client, v3(fallback=None))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(b.calls, 0)
        provenance = response.json()["provenance"]
        self.assertEqual(provenance["fallback_outcome"], "NOT_CONFIGURED")
        self.assertIsNone(provenance["fallback_model_id"])
        self.assertEqual(a.timeouts[0], 15)  # the whole budget goes to the only attempt

    def test_paid_fallback_needs_explicit_consent(self) -> None:
        for consent, expected_calls, outcome in ((False, 0, "PAID_NOT_CONSENTED"), (True, 1, "USED")):
            a, b = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT")), Adapter("b")
            client, _ = client_for(router(("free-a", a, {}), ("paid-b", b, {"paid": True})))
            response = post(client, v3(fallback="paid-b", paid=consent))
            self.assertEqual(b.calls, expected_calls, consent)
            self.assertEqual(response.json()["provenance"]["fallback_outcome"], outcome)
            if consent:
                self.assertEqual(response.json()["provenance"]["pricing_class"], "paid")

    def test_cross_provider_fallback_needs_explicit_consent(self) -> None:
        for consent, expected_calls, outcome in ((False, 0, "CROSS_PROVIDER_NOT_CONSENTED"), (True, 1, "USED")):
            a, b = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT")), Adapter("b")
            client, _ = client_for(router(("free-a", a, {"provider": "Acme"}), ("free-b", b, {"provider": "Other"})))
            response = post(client, v3(cross=consent))
            self.assertEqual(b.calls, expected_calls, consent)
            self.assertEqual(response.json()["provenance"]["fallback_outcome"], outcome)

    def test_fallback_unavailable_or_unauthorized_at_attempt_is_not_used(self) -> None:
        for kwargs in ({"reason": "PAID_NOT_AUTHORIZED"}, {"reason": "NOT_DISCOVERED"}):
            a = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT"))
            b = Adapter("b")
            client, miniflux = client_for(router(("free-a", a, {}), ("free-b", b, kwargs)))
            response = post(client, v3())
            self.assertEqual(response.status_code, 503)
            self.assertEqual(b.calls, 0)
            self.assertEqual(response.json()["provenance"]["fallback_outcome"], "NOT_AVAILABLE")

    def test_same_model_twice_is_rejected_before_any_access(self) -> None:
        a = Adapter("a")
        client, miniflux = client_for(router(("free-a", a, {}),))
        response = post(client, v3(fallback="free-a"))
        self.assertEqual(response.status_code, 422)
        self.assertEqual((a.calls, miniflux.calls), (0, []))

    def test_unavailable_primary_is_refused_and_never_replaced_by_fallback(self) -> None:
        b = Adapter("b")
        client, miniflux = client_for(router(("free-a", None, {}), ("free-b", b, {})))
        response = post(client, v3())
        self.assertIn(response.status_code, (403, 409))
        self.assertEqual((b.calls, miniflux.calls), (0, []))

    def test_session_change_before_fallback_aborts_without_second_attempt(self) -> None:
        holder = {}

        def revoke():
            holder["miniflux"].identity_status = 401

        a = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT"), on_call=revoke)
        b = Adapter("b")
        client, miniflux = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        holder["miniflux"] = miniflux
        response = post(client, v3())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(b.calls, 0)

    def test_content_change_before_fallback_aborts_as_stale(self) -> None:
        holder = {}

        def edit():
            holder["miniflux"].content = holder["miniflux"].content.replace("Aurora", "Boreal")

        a = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT"), on_call=edit)
        b = Adapter("b")
        client, miniflux = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        holder["miniflux"] = miniflux
        response = post(client, v3())
        self.assertEqual((response.status_code, response.json()["error"]["code"]), (409, "STALE_SNAPSHOT"))
        self.assertEqual(b.calls, 0)

    def test_unknown_or_malformed_v3_fields_are_rejected(self) -> None:
        a = Adapter("a")
        client, miniflux = client_for(router(("free-a", a, {}), ("free-b", Adapter("b"), {})))
        for body in (
            v3(fallback="Bad/ID"),
            v3(fallback_consent={"paid": "yes", "cross_provider": False}),
            v3(fallback_consent={"paid": True}),
            {**v3(), "model_id": "free-a"},
            {**v3(), "retry": 3},
        ):
            response = post(client, body)
            self.assertEqual(response.status_code, 422, body)
        self.assertEqual((a.calls, miniflux.calls), (0, []))

    def test_v2_contract_still_never_falls_back(self) -> None:
        a = Adapter("a", error=TransientLiteLLMFailure("t", kind="TIMEOUT"))
        b = Adapter("b")
        client, _ = client_for(router(("free-a", a, {}), ("free-b", b, {})))
        body = {"schema_version": "2", "request_id": REQUEST_ID, "model_id": "free-a", "profile": copy.deepcopy(DEFAULT_PROFILE)}
        response = post(client, body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(b.calls, 0)
        self.assertFalse(response.json()["provenance"]["fallback_used"])


class AdapterTransientClassificationTests(unittest.TestCase):
    def test_kinds(self) -> None:
        self.assertEqual(TransientLiteLLMFailure("x").kind, "UPSTREAM_UNAVAILABLE")
        self.assertEqual(TransientLiteLLMFailure("x", kind="TIMEOUT").kind, "TIMEOUT")
        with self.assertRaises(ValueError):
            TransientLiteLLMFailure("x", kind="ANYTHING")


if __name__ == "__main__":
    unittest.main()


class RealAdapterLedgerTests(unittest.TestCase):
    """Real catalog + LiteLLM adapters + budget ledger; only the gateway is synthetic."""

    def setUp(self) -> None:
        self.build(requests_per_minute=10)

    def build(self, *, requests_per_minute):
        import json
        import tempfile
        from pathlib import Path

        from services.article_intel_summary.catalog import create_model_router
        from services.article_intel_summary.tests.test_litellm_adapter import approved_environment

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text("sk-synthetic-virtual-key-000000000000\n", encoding="ascii")
        key.chmod(0o600)
        self.db = str(Path(self.tmp.name) / "usage.sqlite3")
        env = approved_environment(self.db)
        models = [
            {"id": m, "alias": f"alias-{m}", "label": m, "provider": "Synthetic", "compatible_for_summary": True,
             "input_usd_per_million": "0", "output_usd_per_million": "0", "paid_authorized": False, "transfer_authorized": True}
            for m in ("free-a", "free-b")
        ]
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "",
            "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_POLICY_JSON": json.dumps({"version": 1, "models": models}),
            "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": str(requests_per_minute),
        })
        listing = {"data": [{"id": "alias-free-a"}, {"id": "alias-free-b"}]}
        info = {"data": [{"model_name": f"alias-{m}", "model_info": {"mode": "chat", "input_cost_per_token": 0, "output_cost_per_token": 0}} for m in ("free-a", "free-b")]}
        self.router, _ = create_model_router(env, discovery_getter=lambda path: listing if path == "/v1/models" else info)
        self.addCleanup(self.router.ledger_owner.__exit__)
        self.calls = []

    def gateway(self, model, status):
        import json

        import httpx

        def handler(request):
            self.calls.append(model)
            if status != 200:
                return httpx.Response(status)
            return httpx.Response(200, json={
                "model": f"alias-{model}",
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(V2_OUTPUT)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 120},
            })

        return httpx.Client(transport=httpx.MockTransport(handler))

    def rows(self):
        import sqlite3

        with sqlite3.connect(self.db) as connection:
            return connection.execute("SELECT state FROM inference_usage ORDER BY created_at").fetchall()

    def test_fallback_goes_through_the_same_ledger(self) -> None:
        self.router.adapter_for("free-a").client = self.gateway("free-a", 503)
        self.router.adapter_for("free-b").client = self.gateway("free-b", 200)
        client, _ = client_for(self.router)
        response = post(client, v3())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.calls, ["free-a", "free-b"])
        self.assertEqual(response.json()["provenance"]["effective_model_alias"], "alias-free-b")
        self.assertEqual(len(self.rows()), 2)  # both attempts reserved in the one ledger

    def test_exhausted_rate_budget_blocks_the_fallback_before_any_call(self) -> None:
        # One request per minute in total: the primary consumes it, the fallback must be refused by
        # the shared ledger, not by the network.
        self.build(requests_per_minute=1)
        self.router.adapter_for("free-a").client = self.gateway("free-a", 429)
        self.router.adapter_for("free-b").client = self.gateway("free-b", 200)
        client, _ = client_for(self.router)
        response = post(client, v3())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.calls, ["free-a"])
        self.assertEqual(response.json()["provenance"]["fallback_outcome"], "FAILED")
        self.assertEqual(response.json()["provenance"]["fallback_reason"], "PRIMARY_RATE_LIMITED")
