from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from services.article_intel_summary.inference import DisabledInferenceAdapter
from services.article_intel_summary.litellm_adapter import (
    LiteLLMInferenceAdapter,
    create_configured_inference_adapter,
    load_litellm_settings,
)


class SharedLiteLLMContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.ledger_dir = self.root / "private"
        self.ledger_dir.mkdir(mode=0o700)
        self.key_file = self.root / "litellm-key"
        self.key_file.write_text("synthetic-shared-key\n", encoding="ascii")
        self.key_file.chmod(0o600)
        self.environment = {
            "NEWSFLUX_AI_INFERENCE_ENABLED": "true",
            "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "true",
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://litellm.example.test",
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.key_file),
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
            "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "newsflux-s5-free",
            "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS": "newsflux-mistral-small",
            "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION": "0",
            "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION": "0",
            "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION": "0.15",
            "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION": "0.60",
            "NEWSFLUX_AI_MONTHLY_BUDGET_USD": "2.00",
            "NEWSFLUX_AI_MAX_INPUT_TOKENS": "4096",
            "NEWSFLUX_AI_MAX_OUTPUT_TOKENS": "512",
            "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": "5",
            "NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE": "20000",
            "NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS": "15",
            "NEWSFLUX_AI_USAGE_DATABASE_PATH": str(self.ledger_dir / "usage.sqlite3"),
        }

    def tearDown(self) -> None:
        self.tempdir.cleanup()

    def test_shared_gateway_configuration_is_disabled_by_default(self) -> None:
        settings = load_litellm_settings({})
        adapter = create_configured_inference_adapter({})

        self.assertFalse(settings.enabled)
        self.assertFalse(settings.is_ready())
        self.assertIsInstance(adapter, DisabledInferenceAdapter)

    def test_selected_s5_free_choice_uses_only_its_server_configured_alias(self) -> None:
        settings = load_litellm_settings(self.environment)

        self.assertTrue(settings.is_ready())
        self.assertEqual(settings.model_choice, "s5-free")
        self.assertEqual(settings.model_id, "newsflux-s5-free")
        self.assertEqual(settings.input_price_usd_per_million, Decimal("0"))
        self.assertEqual(settings.output_price_usd_per_million, Decimal("0"))
        self.assertIsInstance(create_configured_inference_adapter(self.environment), LiteLLMInferenceAdapter)

    def test_mistral_choice_requires_explicit_paid_inference_authorization(self) -> None:
        environment = {
            **self.environment,
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "mistral-small",
        }
        self.assertFalse(load_litellm_settings(environment).is_ready())

        environment["NEWSFLUX_AI_ALLOW_PAID_INFERENCE"] = "true"
        settings = load_litellm_settings(environment)
        self.assertTrue(settings.is_ready())
        self.assertEqual(settings.model_choice, "mistral-small")
        self.assertEqual(settings.model_id, "newsflux-mistral-small")

    def test_unknown_choice_and_missing_selected_alias_fail_closed(self) -> None:
        unknown = {**self.environment, "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "other"}
        missing = {
            **self.environment,
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "mistral-small",
            "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS": "",
            "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "true",
        }

        self.assertFalse(load_litellm_settings(unknown).is_ready())
        self.assertFalse(load_litellm_settings(missing).is_ready())
        self.assertIsInstance(create_configured_inference_adapter(unknown), DisabledInferenceAdapter)

    def test_free_choice_with_nonzero_configured_price_requires_paid_opt_in(self) -> None:
        environment = {
            **self.environment,
            "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION": "0.01",
        }

        self.assertFalse(load_litellm_settings(environment).is_ready())
        environment["NEWSFLUX_AI_ALLOW_PAID_INFERENCE"] = "true"
        self.assertTrue(load_litellm_settings(environment).is_ready())


if __name__ == "__main__":
    unittest.main()
