from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import httpx

from services.article_intel_summary.budget import BudgetLedger
from services.article_intel_summary.inference import InferenceUnavailable
from services.article_intel_summary.litellm_adapter import (
    LiteLLMInferenceAdapter,
    S5MistralFallbackAdapter,
    create_configured_inference_adapter,
)
from services.article_intel_summary.tests.test_litellm_adapter import (
    MISTRAL_ALIAS,
    S5_ALIAS,
    approved_environment,
    completion_response,
    input_fixture,
    make_settings,
)
from services.article_intel_summary.tests.support import (
    ENTRY_ID,
    make_test_client,
    request_headers,
    valid_request,
)


class S5MistralFallbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.database = str(Path(self.tmp.name) / "usage.sqlite3")
        self.calls: list[httpx.Request] = []

    def make_fallback(self, handler, *, budget: str = "0.01"):
        ledger = BudgetLedger(self.database)
        primary_settings = make_settings(
            self.database,
            model_choice="s5-free",
            model_id=S5_ALIAS,
            input_price_usd_per_million=Decimal("0"),
            output_price_usd_per_million=Decimal("0"),
            monthly_budget_usd=Decimal(budget),
            max_input_tokens=4096,
            max_output_tokens=512,
            requests_per_minute=2,
            tokens_per_minute=12000,
        )
        paid_settings = replace(
            primary_settings,
            model_choice="mistral-small",
            model_id=MISTRAL_ALIAS,
            input_price_usd_per_million=Decimal("0.15"),
            output_price_usd_per_million=Decimal("0.60"),
        )

        def handler_with_capture(request: httpx.Request) -> httpx.Response:
            self.calls.append(request)
            return handler(request)

        client = httpx.Client(transport=httpx.MockTransport(handler_with_capture))
        primary = LiteLLMInferenceAdapter(primary_settings, ledger=ledger, client=client)
        paid = LiteLLMInferenceAdapter(paid_settings, ledger=ledger, client=client)
        return S5MistralFallbackAdapter(primary, paid), ledger

    @staticmethod
    def model(request: httpx.Request) -> str:
        return json.loads(request.content)["model"]

    def test_s5_success_never_calls_paid_model(self) -> None:
        adapter, ledger = self.make_fallback(
            lambda _: completion_response(model=S5_ALIAS)
        )
        result = adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual(result.effective_model_id, S5_ALIAS)
        self.assertEqual(result.deployment_id, "s5-free")
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])
        self.assertEqual(ledger.current_month_spend(), Decimal("0"))

    def test_only_transient_http_statuses_trigger_exactly_one_paid_attempt(self) -> None:
        for code in (429, 500, 502, 503, 504):
            with self.subTest(code=code):
                self.calls.clear()
                self.database = str(Path(self.tmp.name) / f"status-{code}.sqlite3")

                def handler(request, code=code):
                    if self.model(request) == S5_ALIAS:
                        return httpx.Response(code, text="sensitive upstream detail")
                    return completion_response(model=MISTRAL_ALIAS)

                adapter, ledger = self.make_fallback(handler)
                result = adapter.summarize(input_fixture(), timeout_seconds=12)
                self.assertEqual(result.effective_model_id, MISTRAL_ALIAS)
                self.assertEqual(result.deployment_id, "mistral-small")
                self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS, MISTRAL_ALIAS])
                self.assertNotIn("temperature", json.loads(self.calls[0].content))
                self.assertEqual(json.loads(self.calls[0].content)["reasoning_effort"], "none")
                self.assertEqual(json.loads(self.calls[1].content)["temperature"], 0)
                self.assertNotIn("reasoning_effort", json.loads(self.calls[1].content))
                self.assertEqual(ledger.current_month_spend(), Decimal("0.000051"))

    def test_timeout_triggers_one_paid_attempt_with_no_secret_leak(self) -> None:
        def handler(request):
            if self.model(request) == S5_ALIAS:
                raise httpx.ReadTimeout("credential=synthetic-virtual-key")
            return completion_response(model=MISTRAL_ALIAS)

        adapter, ledger = self.make_fallback(handler)
        result = adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual(result.effective_model_id, MISTRAL_ALIAS)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS, MISTRAL_ALIAS])
        self.assertEqual(ledger.uncertain_count(), 1)

    def test_auth_errors_redirects_and_invalid_responses_never_trigger_paid(self) -> None:
        for code in (302, 307, 400, 401, 403, 404, 422):
            with self.subTest(code=code):
                self.calls.clear()
                self.database = str(Path(self.tmp.name) / f"no-fallback-{code}.sqlite3")
                adapter, _ = self.make_fallback(
                    lambda _: httpx.Response(code, text="provider detail")
                )
                with self.assertRaises(InferenceUnavailable):
                    adapter.summarize(input_fixture(), timeout_seconds=12)
                self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])

        self.calls.clear()
        self.database = str(Path(self.tmp.name) / "bad-output.sqlite3")
        adapter, _ = self.make_fallback(
            lambda _: completion_response(model=S5_ALIAS, output="not-json")
        )
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])

    def test_paid_fallback_never_bypasses_budget_gate(self) -> None:
        adapter, ledger = self.make_fallback(
            lambda _: httpx.Response(503),
            budget="0.0002",
        )
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])
        self.assertEqual(ledger.current_month_spend(), Decimal("0"))

    def test_no_fallback_after_second_attempt_failure(self) -> None:
        adapter, ledger = self.make_fallback(
            lambda request: httpx.Response(503 if self.model(request) == S5_ALIAS else 502)
        )
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS, MISTRAL_ALIAS])
        self.assertEqual(ledger.uncertain_count(), 2)

    def test_wrong_model_identity_does_not_trigger_paid_fallback(self) -> None:
        adapter, _ = self.make_fallback(
            lambda _: completion_response(model="unapproved-model")
        )
        with self.assertRaises(InferenceUnavailable):
            adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])

    def test_invalid_structured_s5_output_does_not_trigger_paid_fallback(self) -> None:
        adapter, ledger = self.make_fallback(
            lambda _: completion_response(model=S5_ALIAS, output={"summary": "incomplete"})
        )
        client, _, _, _ = make_test_client(adapter=adapter)
        with self.assertLogs("services.article_intel_summary.service", level="WARNING"):
            response = client.post(
                f"/api/ai/v1/entries/{ENTRY_ID}/summary",
                headers=request_headers(),
                json=valid_request(),
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "MODEL_OUTPUT_INVALID")
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS])
        self.assertEqual(ledger.uncertain_count(), 0)

    def test_real_summary_api_reports_paid_fallback_and_revalidates_source(self) -> None:
        adapter, ledger = self.make_fallback(
            lambda request: (
                httpx.Response(503)
                if self.model(request) == S5_ALIAS
                else completion_response(model=MISTRAL_ALIAS)
            )
        )
        client, miniflux_http, _, snapshot = make_test_client(adapter=adapter)
        response = client.post(
            f"/api/ai/v1/entries/{ENTRY_ID}/summary",
            headers=request_headers(),
            json=valid_request(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["status"], "partial")
        self.assertEqual(payload["provenance"]["deployment_id"], "mistral-small")
        self.assertEqual(payload["provenance"]["effective_model_id"], MISTRAL_ALIAS)
        self.assertEqual(payload["provenance"]["content_fingerprint"], snapshot.content_fingerprint)
        self.assertEqual(len(miniflux_http.calls), 4)
        self.assertEqual([self.model(r) for r in self.calls], [S5_ALIAS, MISTRAL_ALIAS])
        self.assertEqual(ledger.current_month_spend(), Decimal("0.000051"))

    def test_factory_requires_opt_in_paid_consent_and_two_attempt_capacity(self) -> None:
        key_file = Path(self.tmp.name) / "virtual-key"
        key_file.write_text("synthetic-virtual-key\n", encoding="ascii")
        key_file.chmod(0o600)

        config = approved_environment(self.database)
        config.update({
            "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key_file),
            "NEWSFLUX_AI_MAX_INPUT_TOKENS": "2048",
            "NEWSFLUX_AI_MAX_OUTPUT_TOKENS": "512",
            "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": "2",
            "NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE": "6000",
        })
        self.assertIsInstance(
            create_configured_inference_adapter(config), LiteLLMInferenceAdapter
        )

        config["NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK"] = "true"
        self.assertIsInstance(
            create_configured_inference_adapter(config), S5MistralFallbackAdapter
        )

        for field, value in (
            ("NEWSFLUX_AI_ALLOW_PAID_INFERENCE", "false"),
            ("NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE", "1"),
            ("NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE", "4000"),
            ("NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS", ""),
            ("NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION", ""),
        ):
            with self.subTest(field=field):
                restricted = dict(config, **{field: value})
                self.assertEqual(
                    type(create_configured_inference_adapter(restricted)).__name__,
                    "DisabledInferenceAdapter",
                )

        not_s5 = dict(config, NEWSFLUX_AI_LITELLM_MODEL_CHOICE="mistral-small")
        self.assertEqual(
            type(create_configured_inference_adapter(not_s5)).__name__,
            "DisabledInferenceAdapter",
        )


if __name__ == "__main__":
    unittest.main()
