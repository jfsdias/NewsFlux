"""S5 enablement preflight: read-only GETs, positive evidence only. Synthetic only.

The fixtures below are test data. They are never operator evidence and never prove anything about the
live LiteLLM gateway.
"""
from __future__ import annotations

import io
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.article_intel_summary import s5_preflight
from services.article_intel_summary.tests.test_litellm_adapter import (
    S5_ALIAS,
    approved_environment,
)

KEY = "sk-synthetic-virtual-key-000000000000"
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def key_info(**overrides):
    info = {
        "status": "active",
        "blocked": None,
        "expires": None,
        "models": [S5_ALIAS],
        "max_budget": 0.5,
        "budget_duration": "30d",
        "spend": 0.0,
        "tpm_limit": 20000,
        "rpm_limit": 5,
        "allowed_routes": ["llm_api_routes"],
    }
    info.update(overrides)
    return info


def gateway(*, models=(S5_ALIAS,), info=None, key_info_error=None, cost=0.0, model_info_error=None, callbacks=()):
    calls = []
    info = key_info() if info is None else info

    def get(path):
        calls.append(path)
        if path == "/key/info" and key_info_error is not None:
            raise s5_preflight.GatewayHTTPError(key_info_error)
        if path == "/model/info" and model_info_error is not None:
            raise s5_preflight.GatewayHTTPError(model_info_error)
        return {
            "/v1/models": {"data": [{"id": item} for item in models]},
            "/key/info": {"info": info},
            "/model/info": {
                "data": [
                    {"model_name": S5_ALIAS, "model_info": {"input_cost_per_token": cost, "output_cost_per_token": cost}}
                ]
            },
            "/health/readiness": {"status": "healthy", "success_callbacks": list(callbacks)},
        }[path]

    return get, calls


def attestation(**overrides):
    document = {
        "schema": s5_preflight.ATTESTATION_SCHEMA,
        "evidence_kind": "LIVE_LITELLM_ADMIN_READ",
        "captured_at": (NOW - timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
        "key_fingerprint": s5_preflight.key_fingerprint(KEY),
        "alias": S5_ALIAS,
        "key": key_info(allowed_routes=["llm_api_routes"]),
        "pricing": [{"input_cost_per_token": 0.0, "output_cost_per_token": 0.0}],
        "operator": {"provider_cost_zero_confirmed": True, "reference": "provider free-tier terms reviewed"},
    }
    for path, value in overrides.items():
        target = document
        parts = path.split(".")
        for part in parts[:-1]:
            target = target[part]
        if value is _DELETE:
            target.pop(parts[-1], None)
        else:
            target[parts[-1]] = value
    return document


_DELETE = object()


class S5PreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text(KEY + "\n", encoding="ascii")
        key.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        env.update(
            {
                "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
                # Current production state: everything disabled.
                "NEWSFLUX_AI_INFERENCE_ENABLED": "false",
                "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false",
                "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
                "NEWSFLUX_AI_S5_MAX_OUTPUT_TOKENS": "2048",
            }
        )
        self.env = env

    def run_preflight(self, get, document=None):
        return s5_preflight.run(self.env, get, attestation=document, now=NOW)

    # --- Reproduction of the live result: catalog 200, /key/info 403 -------------------------------

    def test_live_shape_catalog_200_key_info_403_without_attestation_is_blocked_not_invalid(self) -> None:
        get, _ = gateway(key_info_error=403, model_info_error=403)
        gates = self.run_preflight(get)
        self.assertEqual(gates["CATALOG_ACCESS_GATE"], "PASS")
        self.assertEqual(gates["KEY_INFO_ACCESS"], "HTTP_403")
        # 403 is not proof that the key is invalid for inference, nor proof of scope.
        for gate in ("KEY_VALIDITY_GATE", "KEY_SCOPE_GATE", "KEY_BUDGET_GATE", "KEY_RATE_LIMIT_GATE"):
            self.assertEqual(gates[gate], "NOT_VERIFIED", gate)
        self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "NONE")
        self.assertEqual(gates["PRICING_GATE"], "NOT_VERIFIED")
        self.assertFalse(s5_preflight.overall(gates))

    def test_401_400_and_malformed_key_info_are_classified_and_block(self) -> None:
        for error, expected in ((401, "HTTP_401"), (400, "HTTP_400"), (500, "HTTP_500")):
            get, _ = gateway(key_info_error=error)
            gates = self.run_preflight(get)
            self.assertEqual(gates["KEY_INFO_ACCESS"], expected)
            self.assertEqual(gates["KEY_SCOPE_GATE"], "NOT_VERIFIED")
            self.assertFalse(s5_preflight.overall(gates))
        for broken in ({}, {"info": None}, {"info": "x"}):
            gates = self.run_preflight(lambda path, broken=broken: broken if path == "/key/info" else gateway()[0](path))
            self.assertEqual(gates["KEY_INFO_ACCESS"], "MALFORMED", broken)
            self.assertFalse(s5_preflight.overall(gates))

    def test_catalog_listing_alone_is_never_sufficient(self) -> None:
        get, _ = gateway(key_info_error=403)
        gates = self.run_preflight(get)
        self.assertEqual(gates["CATALOG_ACCESS_GATE"], "PASS")
        self.assertFalse(s5_preflight.overall(gates))

    # --- Scope -------------------------------------------------------------------------------------

    def test_empty_or_missing_model_scope_is_unrestricted_and_fails(self) -> None:
        for models in ([], None, "missing"):
            info = key_info() if models == "missing" else key_info(models=models)
            if models == "missing":
                info.pop("models")
            get, _ = gateway(info=info)
            gates = self.run_preflight(get, attestation())
            expected = "NOT_VERIFIED" if models == "missing" else "FAIL"
            self.assertEqual(gates["KEY_SCOPE_GATE"], expected, models)
            self.assertFalse(s5_preflight.overall(gates))

    def test_wildcards_and_extra_models_fail_scope(self) -> None:
        for models in (["*"], ["all-proxy-models"], ["all-team-models"], ["openai/*"], [S5_ALIAS, "mistral-small"]):
            get, _ = gateway(info=key_info(models=models))
            gates = self.run_preflight(get, attestation())
            self.assertEqual(gates["KEY_SCOPE_GATE"], "FAIL", models)
            self.assertFalse(s5_preflight.overall(gates))

    # --- Validity, budget, rate limits -------------------------------------------------------------

    def test_blocked_expired_or_inactive_key_fails_validity(self) -> None:
        for overrides in (
            {"blocked": True},
            {"status": "revoked"},
            {"status": "expired"},
            {"status": _DELETE, "expires": (NOW - timedelta(days=1)).isoformat()},
        ):
            info = key_info()
            for name, value in overrides.items():
                if value is _DELETE:
                    info.pop(name)
                else:
                    info[name] = value
            get, _ = gateway(info=info)
            gates = self.run_preflight(get, attestation())
            self.assertEqual(gates["KEY_VALIDITY_GATE"], "FAIL", overrides)
            self.assertFalse(s5_preflight.overall(gates))

    def test_budget_must_be_positive_bounded_windowed_and_not_exhausted(self) -> None:
        cases = (
            ({"max_budget": None}, "FAIL"),
            ({"max_budget": 0}, "FAIL"),
            ({"max_budget": 5.0}, "FAIL"),  # above the app's monthly budget (1.00)
            ({"budget_duration": None}, "FAIL"),
            ({"spend": 0.5}, "FAIL"),
            ({"max_budget": "1"}, "FAIL"),
        )
        for overrides, expected in cases:
            get, _ = gateway(info=key_info(**overrides))
            gates = self.run_preflight(get, attestation())
            self.assertEqual(gates["KEY_BUDGET_GATE"], expected, overrides)
            self.assertFalse(s5_preflight.overall(gates))
        info = key_info()
        info.pop("max_budget")
        get, _ = gateway(info=info)
        self.assertEqual(self.run_preflight(get, attestation())["KEY_BUDGET_GATE"], "NOT_VERIFIED")

    def test_gateway_rate_limits_must_be_set(self) -> None:
        for overrides in ({"tpm_limit": None}, {"rpm_limit": 0}, {"rpm_limit": True}):
            get, _ = gateway(info=key_info(**overrides))
            gates = self.run_preflight(get, attestation())
            self.assertEqual(gates["KEY_RATE_LIMIT_GATE"], "FAIL", overrides)
            self.assertFalse(s5_preflight.overall(gates))

    # --- Allowed routes (least privilege is a required gate, not a diagnostic) ----------------------

    def _routes_cases(self):
        return (
            (["llm_api_routes"], "PASS"),
            ([], "FAIL"),  # LiteLLM: empty allowlist = no route restriction
            (None, "FAIL"),  # null = no route restriction
            (_DELETE, "NOT_VERIFIED"),
            (["llm_api_routes", "/key/generate"], "FAIL"),
            (["llm_api_routes", "/key/info"], "FAIL"),
            (["llm_api_routes", "management_routes"], "FAIL"),
            (["llm_api_routes", "info_routes"], "FAIL"),
            (["/chat/completions"], "FAIL"),  # not the approved policy, even if narrower
            (["*"], "FAIL"),
            (["/*"], "FAIL"),
            (["llm_api_routes", "/v1/*"], "FAIL"),
            ("llm_api_routes", "FAIL"),  # a string, not a list
            ([["llm_api_routes"]], "FAIL"),
        )

    def test_allowed_routes_gate_with_self_introspection(self) -> None:
        for routes, expected in self._routes_cases():
            info = key_info()
            if routes is _DELETE:
                info.pop("allowed_routes")
            else:
                info["allowed_routes"] = routes
            get, _ = gateway(info=info)
            gates = self.run_preflight(get, attestation())
            self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "SELF_INTROSPECTION")
            self.assertEqual(gates["KEY_ALLOWED_ROUTES_GATE"], expected, routes)
            self.assertEqual(s5_preflight.overall(gates), expected == "PASS", (routes, gates))

    def test_allowed_routes_gate_with_admin_attestation(self) -> None:
        get, _ = gateway(key_info_error=403, model_info_error=403)
        for routes, expected in self._routes_cases():
            gates = self.run_preflight(get, attestation(**{"key.allowed_routes": routes}))
            self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "ADMIN_ATTESTATION")
            self.assertEqual(gates["KEY_ALLOWED_ROUTES_GATE"], expected, routes)
            self.assertEqual(s5_preflight.overall(gates), expected == "PASS", (routes, gates))

    def test_allowed_routes_gate_is_required(self) -> None:
        self.assertIn("KEY_ALLOWED_ROUTES_GATE", s5_preflight.REQUIRED_GATES)

    def test_routes_gate_not_verified_without_key_evidence(self) -> None:
        get, _ = gateway(key_info_error=403)
        gates = self.run_preflight(get)
        self.assertEqual(gates["KEY_ALLOWED_ROUTES_GATE"], "NOT_VERIFIED")
        self.assertFalse(s5_preflight.overall(gates))

    # --- Pricing -----------------------------------------------------------------------------------

    def test_unpublished_gateway_price_is_not_zero_cost_evidence(self) -> None:
        def get(path):
            if path == "/model/info":
                return {"data": [{"model_name": S5_ALIAS, "model_info": {}}]}
            return gateway()[0](path)

        document = attestation(pricing=[{"input_cost_per_token": None, "output_cost_per_token": None}])
        gates = self.run_preflight(get, document)
        self.assertEqual(gates["GATEWAY_PRICE"], "NOT_PUBLISHED")
        self.assertEqual(gates["PRICING_GATE"], "NOT_VERIFIED")
        self.assertFalse(s5_preflight.overall(gates))

    def test_nonzero_gateway_price_fails(self) -> None:
        get, _ = gateway(cost=0.000001)
        gates = self.run_preflight(get, attestation())
        self.assertEqual(gates["PRICING_GATE"], "FAIL")
        self.assertFalse(s5_preflight.overall(gates))

    def test_zero_gateway_price_still_needs_operator_provider_confirmation(self) -> None:
        get, _ = gateway()
        for document in (None, attestation(**{"operator.provider_cost_zero_confirmed": False})):
            gates = self.run_preflight(get, document)
            self.assertEqual(gates["GATEWAY_PRICE"], "ZERO")
            self.assertEqual(gates["PRICING_GATE"], "NOT_VERIFIED")
            self.assertFalse(s5_preflight.overall(gates))

    # --- Positive paths ----------------------------------------------------------------------------

    def test_self_introspection_plus_operator_attestation_passes(self) -> None:
        get, calls = gateway()
        gates = self.run_preflight(get, attestation())
        self.assertTrue(s5_preflight.overall(gates), gates)
        self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "SELF_INTROSPECTION")
        self.assertEqual(calls, ["/v1/models", "/key/info", "/model/info", "/health/readiness"])
        self.assertNotIn("synthetic-virtual-key", repr(gates))

    def test_least_privilege_key_403_with_admin_attestation_passes(self) -> None:
        get, _ = gateway(key_info_error=403, model_info_error=403)
        gates = self.run_preflight(get, attestation())
        self.assertTrue(s5_preflight.overall(gates), gates)
        self.assertEqual(gates["KEY_INFO_ACCESS"], "HTTP_403")
        self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "ADMIN_ATTESTATION")
        self.assertEqual(gates["KEY_ALLOWED_ROUTES_GATE"], "PASS")
        self.assertEqual(gates["PRICING_GATE"], "PASS")

    # --- Attestation integrity ---------------------------------------------------------------------

    def test_attestation_for_another_key_stale_or_wrong_schema_is_rejected(self) -> None:
        get, _ = gateway(key_info_error=403, model_info_error=403)
        for overrides, expected in (
            ({"key_fingerprint": s5_preflight.key_fingerprint("sk-other")}, "KEY_MISMATCH"),
            ({"captured_at": (NOW - timedelta(hours=25)).isoformat()}, "STALE"),
            ({"captured_at": (NOW + timedelta(hours=1)).isoformat()}, "FUTURE"),
            ({"schema": "v0"}, "SCHEMA"),
            ({"alias": "other"}, "ALIAS_MISMATCH"),
            ({"evidence_kind": "SYNTHETIC"}, "NOT_LIVE"),
            ({"key": _DELETE}, "MALFORMED"),
        ):
            gates = self.run_preflight(get, attestation(**overrides))
            self.assertEqual(gates["ATTESTATION"], f"REJECTED_{expected}", overrides)
            self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "NONE")
            self.assertFalse(s5_preflight.overall(gates))

    def test_attestation_cannot_override_live_self_introspection(self) -> None:
        # When the gateway itself reports the key, that live answer wins over a document.
        get, _ = gateway(info=key_info(models=[]))
        gates = self.run_preflight(get, attestation())
        self.assertEqual(gates["KEY_EVIDENCE_SOURCE"], "SELF_INTROSPECTION")
        self.assertEqual(gates["KEY_SCOPE_GATE"], "FAIL")

    def test_fingerprint_is_not_the_litellm_token_hash(self) -> None:
        import hashlib

        token_hash = hashlib.sha256(KEY.encode()).hexdigest()
        fingerprint = s5_preflight.key_fingerprint(KEY)
        self.assertNotEqual(fingerprint, token_hash)
        self.assertNotIn(token_hash, fingerprint)

    # --- Preserved gates ---------------------------------------------------------------------------

    def test_logging_callback_outside_allowlist_blocks(self) -> None:
        get, _ = gateway(callbacks=("langfuse",))
        gates = self.run_preflight(get, attestation())
        self.assertEqual(gates["LOGGING_GATE"], "FAIL")
        self.assertFalse(s5_preflight.overall(gates))
        self.env["NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS"] = "langfuse"
        self.assertTrue(s5_preflight.overall(self.run_preflight(get, attestation())))

    def test_nonzero_configured_s5_price_or_missing_budget_blocks_before_gateway(self) -> None:
        for change in ({"NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION": "0.1"}, {"NEWSFLUX_AI_MONTHLY_BUDGET_USD": ""}):
            get, calls = gateway()
            gates = s5_preflight.run({**self.env, **change}, get, attestation=attestation(), now=NOW)
            self.assertFalse(s5_preflight.overall(gates), change)
            self.assertEqual(calls, [])

    def test_paid_model_stays_blocked_even_with_permissive_env(self) -> None:
        get, _ = gateway()
        gates = s5_preflight.run({**self.env, "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true"}, get, attestation=attestation(), now=NOW)
        self.assertEqual(gates["PAID_MODEL_BLOCKED_GATE"], "PASS")

    # --- Contract with the operator audit tool (ops/deploy/release-governance/s5_key_audit.py) -----------

    def test_audit_tool_output_is_accepted_and_shares_the_fingerprint(self) -> None:
        import importlib.util

        path = Path(__file__).resolve().parents[3] / "deploy" / "release-governance" / "s5_key_audit.py"
        spec = importlib.util.spec_from_file_location("s5_key_audit_contract", path)
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        self.assertEqual(audit.key_fingerprint(KEY), s5_preflight.key_fingerprint(KEY))
        self.assertEqual(audit.ATTESTATION_SCHEMA, s5_preflight.ATTESTATION_SCHEMA)
        self.assertEqual(audit.EVIDENCE_KIND, s5_preflight.ATTESTATION_EVIDENCE_KIND)

        def admin(method, path, body):
            if path == "/v2/key/info":
                return {"info": [key_info(allowed_routes=["llm_api_routes"])]}
            return {"data": [{"model_name": S5_ALIAS, "model_info": {"input_cost_per_token": 0, "output_cost_per_token": 0}}]}

        document, _ = audit.build_attestation(
            admin, virtual_key=KEY, alias=S5_ALIAS, now=NOW - timedelta(minutes=5),
            provider_cost_zero_confirmed=True, reference="synthetic",
        )
        get, _ = gateway(key_info_error=403, model_info_error=403)
        gates = self.run_preflight(get, json.loads(json.dumps(document)))
        self.assertTrue(s5_preflight.overall(gates), gates)

    # --- CLI ---------------------------------------------------------------------------------------

    def test_cli_reads_attestation_from_stdin_and_prints_no_secret(self) -> None:
        get, _ = gateway(key_info_error=403, model_info_error=403)
        out = io.StringIO()
        stdin = io.StringIO(json.dumps(attestation()))
        code = s5_preflight.main(["--attestation-stdin"], environ=self.env, get=get, stdin=stdin, stdout=out, now=NOW)
        text = out.getvalue()
        self.assertEqual(code, 0, text)
        self.assertIn("S5_PREFLIGHT=PASS", text)
        self.assertNotIn(KEY, text)
        self.assertNotIn(s5_preflight.key_fingerprint(KEY), text)  # only a short prefix is shown

    def test_cli_oversized_or_invalid_stdin_is_rejected(self) -> None:
        get, _ = gateway(key_info_error=403)
        for payload in ("not json", "x" * (s5_preflight.MAX_ATTESTATION_BYTES + 1)):
            out = io.StringIO()
            code = s5_preflight.main(["--attestation-stdin"], environ=self.env, get=get, stdin=io.StringIO(payload), stdout=out, now=NOW)
            self.assertEqual(code, 1)
            self.assertIn("ATTESTATION=REJECTED_MALFORMED", out.getvalue())
            self.assertIn("S5_PREFLIGHT=BLOCKED", out.getvalue())


if __name__ == "__main__":
    unittest.main()
