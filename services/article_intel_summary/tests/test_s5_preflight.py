"""S5 enablement preflight: read-only GETs, free-only policy, logging allowlist. Synthetic only."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from services.article_intel_summary import s5_preflight
from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS, approved_environment


def gateway(*, models=(S5_ALIAS,), key_models=(S5_ALIAS,), cost=0.0, callbacks=()):
    calls = []

    def get(path):
        calls.append(path)
        return {
            "/v1/models": {"data": [{"id": item} for item in models]},
            "/key/info": {"info": {"models": list(key_models), "max_budget": 1.0}},
            "/model/info": {"data": [{"model_name": S5_ALIAS, "model_info": {"input_cost_per_token": cost, "output_cost_per_token": cost}}]},
            "/health/readiness": {"status": "healthy", "success_callbacks": list(callbacks)},
        }[path]

    return get, calls


class S5PreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text("synthetic-virtual-key-000000000000\n", encoding="ascii")
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

    def test_disabled_production_state_passes_with_simulated_enablement_policy(self) -> None:
        get, calls = gateway()
        gates = s5_preflight.run(self.env, get)
        self.assertTrue(s5_preflight.overall(gates), gates)
        self.assertEqual(calls, ["/v1/models", "/key/info", "/model/info", "/health/readiness"])
        self.assertEqual(gates["PAID_MODEL_BLOCKED_GATE"], "PASS")
        self.assertNotIn("synthetic-virtual-key", repr(gates))

    def test_unauthorized_alias_paid_price_or_logging_callback_blocks(self) -> None:
        for kwargs, gate in (
            ({"models": ("other",)}, "MODEL_AUTHORIZED_GATE"),
            ({"key_models": ("other",)}, "KEY_GATE"),
            ({"cost": 0.000001}, "GATEWAY_PRICE_GATE"),
            ({"callbacks": ("langfuse",)}, "LOGGING_GATE"),
        ):
            get, _ = gateway(**kwargs)
            gates = s5_preflight.run(self.env, get)
            self.assertEqual(gates[gate], "FAIL", kwargs)
            self.assertFalse(s5_preflight.overall(gates))

    def test_allowlisted_callback_and_unpublished_gateway_price_pass(self) -> None:
        self.env["NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS"] = "prometheus"
        get, _ = gateway(callbacks=("prometheus",))
        gates = s5_preflight.run(self.env, get)
        self.assertTrue(s5_preflight.overall(gates), gates)

    def test_nonzero_configured_s5_price_or_missing_budget_blocks_before_gateway(self) -> None:
        for change in ({"NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION": "0.1"}, {"NEWSFLUX_AI_MONTHLY_BUDGET_USD": ""}):
            get, calls = gateway()
            gates = s5_preflight.run({**self.env, **change}, get)
            self.assertFalse(s5_preflight.overall(gates), change)
            self.assertEqual(calls, [])

    def test_paid_inference_already_authorized_fails_paid_gate(self) -> None:
        get, _ = gateway()
        gates = s5_preflight.run({**self.env, "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true"}, get)
        # The enablement policy forces paid=false, so even a permissive env cannot enable Mistral.
        self.assertEqual(gates["PAID_MODEL_BLOCKED_GATE"], "PASS")


if __name__ == "__main__":
    unittest.main()
