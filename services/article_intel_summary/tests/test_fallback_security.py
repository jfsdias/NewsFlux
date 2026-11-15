"""PR #249 security remediation: SEC-249-01 (paid fallback consent) and SEC-249-02 (verified provider).

SEC-249-01: every PAID fallback attempt needs the caller's explicit ``fallback_consent.paid``, whatever
the primary's pricing (free→paid and paid→paid alike). The global paid gate, the model's paid
authorization, price verification and the shared budget ledger still apply on top.

SEC-249-02: the cross-provider decision uses a provider identity VERIFIED from the gateway's
``/model/info`` inventory (``model_info.litellm_provider``, the ``litellm_params.model`` prefix and the
``api_base`` host), never the operator's display label. Unknown, mixed, policy-mismatched or drifting
identities fail closed: no fallback attempt, no secondary reservation, outcome ``PROVIDER_UNVERIFIED``.

Synthetic only: a fake gateway inventory and ``httpx.MockTransport``; real catalog, adapters and ledger.
"""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

import httpx

from services.article_intel_summary.catalog import (
    CatalogEntry,
    ModelRouter,
    _State,
    create_model_router,
    load_model_policy,
)
from services.article_intel_summary.litellm_adapter import TransientLiteLLMFailure
from services.article_intel_summary.tests.test_litellm_adapter import approved_environment
from services.article_intel_summary.tests.test_primary_fallback import Adapter, client_for, post, v3
from services.article_intel_summary.tests.test_v2_catalog_profiles import V2_OUTPUT

TIMEOUT = TransientLiteLLMFailure("t", kind="TIMEOUT")


def deployment(alias, *, provider="mistral", model=None, api_base=None, cost=0.0, drop_provider=False):
    info = {"mode": "chat", "input_cost_per_token": cost, "output_cost_per_token": cost}
    if not drop_provider:
        info["litellm_provider"] = provider
    params = {"model": model if model is not None else f"{provider}/{alias}"}
    if api_base is not None:
        params["api_base"] = api_base
    return {"model_name": alias, "litellm_params": params, "model_info": info}


class Gateway:
    """A mutable synthetic /v1/models + /model/info inventory (read on every catalog rebuild)."""

    def __init__(self, deployments):
        self.deployments = list(deployments)

    def __call__(self, path):
        if path == "/v1/models":
            return {"data": [{"id": alias} for alias in dict.fromkeys(d["model_name"] for d in self.deployments)]}
        return {"data": self.deployments}


class RealCatalogFallbackTests(unittest.TestCase):
    """Real policy + discovery + adapters + ledger; only the gateway is synthetic."""

    def build(self, models, deployments, *, allow_paid=True, extra_env=None):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text("sk-synthetic-virtual-key-000000000000\n", encoding="ascii")
        key.chmod(0o600)
        self.db = str(Path(self.tmp.name) / "usage.sqlite3")
        env = approved_environment(self.db)
        policy = []
        for spec in models:
            item = {
                "id": spec["id"], "alias": f"alias-{spec['id']}", "label": spec.get("label", "Same label"),
                "provider": spec.get("provider_label", "Same provider label"), "compatible_for_summary": True,
                "input_usd_per_million": spec.get("price", "0"), "output_usd_per_million": spec.get("price", "0"),
                "paid_authorized": spec.get("paid_authorized", False), "transfer_authorized": True,
            }
            if "provider_identity" in spec:
                item["provider_identity"] = spec["provider_identity"]
            policy.append(item)
        env.update({
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "",
            "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true" if allow_paid else "false",
            "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
            "NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS": "0",  # every rebuild re-reads the inventory
            "NEWSFLUX_AI_MODEL_POLICY_JSON": json.dumps({"version": 1, "models": policy}),
            "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": "10",
        })
        env.update(extra_env or {})
        self.gateway = Gateway(deployments)
        self.router, _ = create_model_router(env, discovery_getter=self.gateway)
        self.addCleanup(self.router.ledger_owner.__exit__)
        self.calls = []

    def wire(self, model_id, status, *, on_call=None):
        def handler(request):
            self.calls.append(model_id)
            if on_call:
                on_call()
            if status != 200:
                return httpx.Response(status)
            return httpx.Response(200, json={
                "model": f"alias-{model_id}",
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(V2_OUTPUT)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 120},
            })

        self.router.adapter_for(model_id).client = httpx.Client(transport=httpx.MockTransport(handler))

    def rows(self):
        with sqlite3.connect(self.db) as connection:
            return connection.execute("SELECT state FROM inference_usage").fetchall()

    def run_fallback(self, primary, fallback, *, paid=False, cross=False, on_primary=None):
        self.wire(primary, 503, on_call=on_primary)
        self.wire(fallback, 200)
        client, miniflux = client_for(self.router)
        response = post(client, v3(primary=primary, fallback=fallback, paid=paid, cross=cross))
        return response, response.json().get("provenance", {}), miniflux

    # ---------------------------------------------------------------- SEC-249-01: paid consent

    PAID = "0.15"
    PAID_DEPLOYMENT_COST = 0.15 / 1_000_000

    def paid_setup(self, primary_paid, *, allow_paid=True):
        self.build(
            [
                {"id": "model-a", "price": self.PAID if primary_paid else "0", "paid_authorized": primary_paid},
                {"id": "model-b", "price": self.PAID, "paid_authorized": True},
            ],
            [
                deployment("alias-model-a", cost=self.PAID_DEPLOYMENT_COST if primary_paid else 0.0),
                deployment("alias-model-b", cost=self.PAID_DEPLOYMENT_COST),
            ],
            allow_paid=allow_paid,
        )

    def test_paid_to_paid_without_consent_is_blocked_before_any_secondary_request_or_charge(self) -> None:
        self.paid_setup(primary_paid=True)
        response, provenance, _ = self.run_fallback("model-a", "model-b", paid=False)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(provenance["fallback_outcome"], "PAID_NOT_CONSENTED")
        self.assertEqual(provenance["attempts"], 1)
        self.assertEqual(self.calls, ["model-a"])  # NO_SECONDARY_REQUEST_WITHOUT_CONSENT
        self.assertEqual(len(self.rows()), 1)  # NO_SECONDARY_LEDGER_CHARGE_WITHOUT_CONSENT

    def test_free_to_paid_without_consent_is_blocked_before_any_secondary_request_or_charge(self) -> None:
        self.paid_setup(primary_paid=False)
        response, provenance, _ = self.run_fallback("model-a", "model-b", paid=False)
        self.assertEqual(provenance["fallback_outcome"], "PAID_NOT_CONSENTED")
        self.assertEqual(self.calls, ["model-a"])
        self.assertEqual(len(self.rows()), 1)

    def test_paid_fallback_with_consent_stays_policy_controlled(self) -> None:
        for primary_paid in (False, True):
            with self.subTest(primary_paid=primary_paid):
                self.paid_setup(primary_paid=primary_paid)
                response, provenance, _ = self.run_fallback("model-a", "model-b", paid=True)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(provenance["fallback_outcome"], "USED")
                self.assertEqual(provenance["pricing_class"], "paid")
                self.assertEqual(self.calls, ["model-a", "model-b"])
                self.assertEqual(len(self.rows()), 2)  # same ledger, one reservation per attempt

    def test_global_paid_gate_still_refuses_a_consented_paid_fallback(self) -> None:
        self.build(
            [{"id": "model-a"}, {"id": "model-b", "price": self.PAID, "paid_authorized": True}],
            [deployment("alias-model-a"), deployment("alias-model-b", cost=self.PAID_DEPLOYMENT_COST)],
            allow_paid=False,
        )
        self.wire("model-a", 503)
        client, _ = client_for(self.router)
        response = post(client, v3(primary="model-a", fallback="model-b", paid=True, cross=True))
        self.assertEqual(response.json()["provenance"]["fallback_outcome"], "NOT_AVAILABLE")
        self.assertEqual(self.calls, ["model-a"])
        self.assertEqual(len(self.rows()), 1)

    def test_free_to_free_is_unchanged(self) -> None:
        self.build([{"id": "model-a"}, {"id": "model-b"}], [deployment("alias-model-a"), deployment("alias-model-b")])
        response, provenance, _ = self.run_fallback("model-a", "model-b")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(provenance["fallback_outcome"], "USED")
        self.assertEqual(provenance["pricing_class"], "free")

    # ---------------------------------------------------------------- SEC-249-02: verified provider

    def test_different_verified_providers_with_the_same_display_label_need_consent(self) -> None:
        self.build(
            [{"id": "model-a"}, {"id": "model-b"}],  # both declare the SAME provider label
            [deployment("alias-model-a", provider="mistral"), deployment("alias-model-b", provider="openrouter")],
        )
        response, provenance, _ = self.run_fallback("model-a", "model-b", cross=False)
        self.assertEqual(provenance["fallback_outcome"], "CROSS_PROVIDER_NOT_CONSENTED")
        self.assertEqual(self.calls, ["model-a"])
        self.assertEqual(len(self.rows()), 1)

    def test_same_verified_provider_needs_no_cross_provider_consent(self) -> None:
        self.build(
            [{"id": "model-a", "provider_label": "Label one"}, {"id": "model-b", "provider_label": "Label two"}],
            [deployment("alias-model-a", provider="mistral"), deployment("alias-model-b", provider="mistral")],
        )
        response, provenance, _ = self.run_fallback("model-a", "model-b", cross=False)
        self.assertEqual(provenance["fallback_outcome"], "USED", response.text)

    def test_different_verified_provider_with_consent_is_policy_controlled(self) -> None:
        self.build(
            [{"id": "model-a"}, {"id": "model-b"}],
            [deployment("alias-model-a", provider="mistral"), deployment("alias-model-b", provider="openrouter")],
        )
        response, provenance, _ = self.run_fallback("model-a", "model-b", cross=True)
        self.assertEqual(provenance["fallback_outcome"], "USED", response.text)
        self.assertEqual(self.calls, ["model-a", "model-b"])

    def test_same_dialect_on_different_endpoints_is_a_different_provider(self) -> None:
        self.build(
            [{"id": "model-a"}, {"id": "model-b"}],
            [
                deployment("alias-model-a", provider="openai", api_base="https://one.example/v1"),
                deployment("alias-model-b", provider="openai", api_base="https://two.example/v1"),
            ],
        )
        response, provenance, _ = self.run_fallback("model-a", "model-b", cross=False)
        self.assertEqual(provenance["fallback_outcome"], "CROSS_PROVIDER_NOT_CONSENTED")
        self.assertEqual(self.calls, ["model-a"])

    def assert_unverified(self, models, deployments, **run):
        self.build(models, deployments)
        response, provenance, _ = self.run_fallback("model-a", "model-b", paid=True, cross=True, **run)
        self.assertEqual(provenance["fallback_outcome"], "PROVIDER_UNVERIFIED", response.text)
        self.assertEqual(self.calls, ["model-a"])  # NO_UNAUTHORIZED_SECONDARY_REQUEST
        self.assertEqual(len(self.rows()), 1)
        self.assertFalse(provenance["fallback_used"])

    def test_unknown_provider_fails_closed_even_with_consent(self) -> None:
        for broken in (
            deployment("alias-model-b", drop_provider=True),
            deployment("alias-model-b", provider="not a provider!"),
            deployment("alias-model-b", provider="openai"),  # generic dialect, endpoint not visible
            deployment("alias-model-b", provider="mistral", model="openrouter/x"),  # prefix contradicts provider
            deployment("alias-model-b", provider="mistral", api_base="not a url"),
        ):
            with self.subTest(broken=broken):
                self.assert_unverified([{"id": "model-a"}, {"id": "model-b"}], [deployment("alias-model-a"), broken])

    def test_mixed_provider_deployments_fail_closed(self) -> None:
        self.assert_unverified(
            [{"id": "model-a"}, {"id": "model-b"}],
            [
                deployment("alias-model-a"),
                deployment("alias-model-b", provider="mistral"),
                deployment("alias-model-b", provider="openrouter"),
            ],
        )

    def test_policy_and_gateway_provider_mismatch_fails_closed(self) -> None:
        self.assert_unverified(
            [{"id": "model-a"}, {"id": "model-b", "provider_identity": "mistral"}],
            [deployment("alias-model-a"), deployment("alias-model-b", provider="openrouter")],
        )

    def test_policy_and_gateway_provider_match_is_accepted(self) -> None:
        self.build(
            [{"id": "model-a", "provider_identity": "mistral"}, {"id": "model-b", "provider_identity": "mistral"}],
            [deployment("alias-model-a"), deployment("alias-model-b")],
        )
        response, provenance, _ = self.run_fallback("model-a", "model-b")
        self.assertEqual(provenance["fallback_outcome"], "USED", response.text)

    def test_provider_drift_before_the_fallback_fails_closed(self) -> None:
        def drift():  # the gateway re-routes the fallback alias while the primary is in flight
            self.gateway.deployments[1] = deployment("alias-model-b", provider="openrouter")

        self.assert_unverified(
            [{"id": "model-a"}, {"id": "model-b"}],
            [deployment("alias-model-a"), deployment("alias-model-b")],
            on_primary=drift,
        )

    def test_primary_provider_drift_before_the_fallback_fails_closed(self) -> None:
        def drift():
            self.gateway.deployments[0] = deployment("alias-model-a", provider="openrouter")

        self.assert_unverified(
            [{"id": "model-a"}, {"id": "model-b"}],
            [deployment("alias-model-a"), deployment("alias-model-b")],
            on_primary=drift,
        )

    def test_provider_identity_is_never_published(self) -> None:
        self.build(
            [{"id": "model-a"}, {"id": "model-b"}],
            [deployment("alias-model-a", provider="openai", api_base="https://secret-endpoint.example/v1"), deployment("alias-model-b")],
        )
        document = json.dumps(self.router.catalog_document())
        self.assertNotIn("secret-endpoint", document)
        self.assertNotIn("provider_identity", document)
        response, provenance, _ = self.run_fallback("model-b", "model-a", cross=True)
        self.assertNotIn("secret-endpoint", response.text)

    def test_policy_rejects_a_malformed_provider_identity(self) -> None:
        base = {"id": "m", "alias": "a", "label": "L", "provider": "P", "compatible_for_summary": True,
                "input_usd_per_million": "0", "output_usd_per_million": "0", "paid_authorized": False, "transfer_authorized": True}
        for bad in ("", "has space", 3, "x" * 200):
            status, _ = load_model_policy({"NEWSFLUX_AI_MODEL_POLICY_JSON": json.dumps({"version": 1, "models": [{**base, "provider_identity": bad}]})})
            self.assertEqual(status, "INVALID", bad)
        status, models = load_model_policy({"NEWSFLUX_AI_MODEL_POLICY_JSON": json.dumps({"version": 1, "models": [{**base, "provider_identity": "mistral"}]})})
        self.assertEqual((status, models[0].provider_identity), ("CONFIGURED", "mistral"))


class RevalidationOrderTests(unittest.TestCase):
    """Identity and authorization are rechecked AFTER the session/content revalidation, at the attempt."""

    def test_drift_during_session_revalidation_blocks_the_attempt(self) -> None:
        a, b = Adapter("a", error=TIMEOUT), Adapter("b")

        def entries(identity_b):
            return {
                "free-a": CatalogEntry("free-a", True, None, None, provider_identity="mistral"),
                "free-b": CatalogEntry("free-b", True, None, None, provider_identity=identity_b),
            }

        state = {"identity_b": "mistral"}
        model_router = ModelRouter(
            {}, {}, None,
            refresh=lambda: _State(entries(state["identity_b"]), {"free-a": a, "free-b": b}, None, "OK", "CONFIGURED"),
        )
        client, miniflux = client_for(model_router)
        original = miniflux.get

        def hooked(*args, **kwargs):
            if a.calls == 1:  # the session/content revalidation that precedes the fallback
                state["identity_b"] = "openrouter"
            return original(*args, **kwargs)

        miniflux.get = hooked
        response = post(client, v3(cross=True))
        self.assertEqual(response.json()["provenance"]["fallback_outcome"], "PROVIDER_UNVERIFIED", response.text)
        self.assertEqual(b.calls, 0)


if __name__ == "__main__":
    unittest.main()
