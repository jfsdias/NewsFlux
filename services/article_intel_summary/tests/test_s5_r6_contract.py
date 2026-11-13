from __future__ import annotations

import json
from contextlib import closing
import sqlite3
import tempfile
import unittest
from pathlib import Path
from decimal import Decimal

import httpx

from services.article_intel_summary.inference import InferenceUnavailable
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.tests.support import (
    API_KEY, ENTRY_ID, make_test_client, request_headers, valid_request,
)
from services.article_intel_summary.tests.test_litellm_adapter import (
    GOOD_OUTPUT, S5_ALIAS, completion_response, input_fixture, make_settings,
)


class S5R6Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.calls = []
        self.response = completion_response(model=S5_ALIAS)
        settings = make_settings(
            str(Path(self.temp.name) / "ledger.sqlite"), model_choice="s5-free", model_id=S5_ALIAS,
            paid_inference_authorized=False, input_price_usd_per_million=Decimal("0"), output_price_usd_per_million=Decimal("0"), max_input_tokens=4096, max_output_tokens=2048,
        )
        def handler(request):
            self.calls.append(request)
            return self.response
        self.adapter = LiteLLMInferenceAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))

    def test_s5_success_api_uses_no_reasoning_and_explicit_grounded_contract(self):
        client, miniflux, _, snapshot = make_test_client(adapter=self.adapter)
        result = client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["status"], "partial")
        self.assertEqual(result.json()["provenance"]["content_fingerprint"], snapshot.content_fingerprint)
        self.assertEqual(result.json()["provenance"]["effective_model_id"], S5_ALIAS)
        self.assertEqual([call["method"] for call in miniflux.calls], ["GET"] * 4)
        self.assertEqual(len(self.calls), 1)
        sent = json.loads(self.calls[0].content)
        self.assertEqual(sent["reasoning_effort"], "none")
        self.assertNotIn("temperature", sent)
        self.assertEqual(sent["max_tokens"], 2048)
        prompt = sent["messages"][0]["content"]
        for required in ("exactly", "summary_paragraph_ids", "key_points", "action_points", "1 to 3", "1 to 8", "32", "Markdown", "empty array"):
            self.assertIn(required, prompt)
        self.assertEqual(self.adapter.ledger.uncertain_count(), 0)
        with closing(sqlite3.connect(self.adapter.ledger.path)) as db:
            self.assertEqual(db.execute("SELECT state FROM inference_usage").fetchall(), [("settled",)])

    def test_changed_authorized_snapshot_rejects_summary_and_does_not_persist_content(self):
        client, miniflux, _, original = make_test_client(adapter=self.adapter)
        original_content = miniflux.content
        changed_content = original_content.replace("3.200 passageiros", "3.201 passageiros")
        self.assertNotEqual(original_content, changed_content)
        def change_before_response(request):
            self.calls.append(request)
            miniflux.content = changed_content
            return self.response
        self.adapter.client.close()
        self.adapter.client = httpx.Client(transport=httpx.MockTransport(change_before_response))
        result = client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result.json()["error"]["code"], "STALE_SNAPSHOT")
        self.assertNotIn("summary", result.json())
        self.assertNotIn("A cidade de Aurora", result.text)
        self.assertNotIn(original.content_fingerprint, result.text)
        self.assertNotIn(GOOD_OUTPUT["summary"], result.text)
        self.assertEqual([call["method"] for call in miniflux.calls], ["GET"] * 4)
        self.assertEqual(len(self.calls), 1)
        with closing(sqlite3.connect(self.adapter.ledger.path)) as db:
            self.assertEqual(db.execute("SELECT state FROM inference_usage").fetchall(), [("settled",)])
            dump = "\n".join(db.iterdump())
        self.assertNotIn("A cidade de Aurora", dump)
        self.assertNotIn("3.201 passageiros", dump)
        self.assertNotIn(GOOD_OUTPUT["summary"], dump)

    def test_invalid_structures_fail_closed_with_only_safe_diagnostic(self):
        point = {"text": "synthetic-secret-content", "paragraph_ids": ["p1"]}
        cases = [
            ({k: v for k, v in GOOD_OUTPUT.items() if k != "summary"}, "MODEL_OUTPUT_MISSING_FIELD"),
            ({**GOOD_OUTPUT, "extra": "synthetic-secret-content"}, "MODEL_OUTPUT_EXTRA_FIELD"),
            ({**GOOD_OUTPUT, "summary": 42}, "MODEL_OUTPUT_INVALID_FIELD_TYPE"),
            ({**GOOD_OUTPUT, "summary": " "}, "MODEL_OUTPUT_LENGTH_EXCEEDED"),
            ({**GOOD_OUTPUT, "summary": "x" * 3001}, "MODEL_OUTPUT_LENGTH_EXCEEDED"),
            ({**GOOD_OUTPUT, "key_points": [point] * 4}, "MODEL_OUTPUT_TOO_MANY_KEY_POINTS"),
            ({**GOOD_OUTPUT, "summary_paragraph_ids": ["p999"]}, "MODEL_OUTPUT_INVALID_PARAGRAPH_REFERENCE"),
            ({**GOOD_OUTPUT, "summary_paragraph_ids": ["p1", "p1"]}, "MODEL_OUTPUT_DUPLICATE_REFERENCE"),
            ({**GOOD_OUTPUT, "action_points": [{"text": "x", "paragraph_ids": []}]}, "MODEL_OUTPUT_INVALID_POINT_STRUCTURE"),
            ({**GOOD_OUTPUT, "action_points": [point] * 4}, "MODEL_OUTPUT_INVALID_POINT_STRUCTURE"),
            ({**GOOD_OUTPUT, "key_points": [{**point, "extra": "synthetic-secret-content"}]}, "MODEL_OUTPUT_INVALID_POINT_STRUCTURE"),
        ]
        for index, (output, code) in enumerate(cases):
            with self.subTest(code=code):
                settings = make_settings(str(Path(self.temp.name) / f"{index}.sqlite"), model_choice="s5-free", model_id=S5_ALIAS, paid_inference_authorized=False, input_price_usd_per_million=Decimal("0"), output_price_usd_per_million=Decimal("0"))
                calls = []
                def handler(request):
                    calls.append(request)
                    return completion_response(model=S5_ALIAS, output=output)
                adapter = LiteLLMInferenceAdapter(settings, client=httpx.Client(transport=httpx.MockTransport(handler)))
                client, _, _, _ = make_test_client(adapter=adapter)
                with self.assertLogs("services.article_intel_summary.service", level="WARNING") as captured:
                    result = client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
                self.assertEqual(result.status_code, 502)
                self.assertEqual(result.json()["error"]["code"], "MODEL_OUTPUT_INVALID")
                self.assertEqual(len(calls), 1)
                self.assertIn(code, captured.output[0])
                self.assertNotIn("synthetic-secret-content", " ".join(captured.output))
                self.assertNotIn(API_KEY, " ".join(captured.output))

    def test_invalid_json_has_safe_diagnostic_and_no_retry(self):
        self.response = completion_response(model=S5_ALIAS, output='{"summary":"SENSITIVE_SENTINEL",}')
        with self.assertLogs("services.article_intel_summary.litellm_adapter", level="WARNING") as captured:
            with self.assertRaises(InferenceUnavailable):
                self.adapter.summarize(input_fixture(), timeout_seconds=12)
        self.assertEqual(len(self.calls), 1)
        self.assertIn("MODEL_OUTPUT_INVALID_JSON", captured.output[0])
        self.assertNotIn("SENSITIVE_SENTINEL", " ".join(captured.output))

    def test_invalid_json_returns_safe_503_without_retry(self):
        self.response = completion_response(model=S5_ALIAS, output="SENSITIVE_JSON_SENTINEL")
        client, miniflux, _, _ = make_test_client(adapter=self.adapter)
        with self.assertLogs("services.article_intel_summary.litellm_adapter", level="WARNING") as captured:
            result = client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
        self.assertEqual(result.status_code, 503)
        self.assertEqual(result.json()["status"], "unavailable")
        self.assertNotIn("SENSITIVE_JSON_SENTINEL", result.text + " ".join(captured.output))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual([call["method"] for call in miniflux.calls], ["GET"] * 2)
        self.assertEqual(self.adapter.ledger.uncertain_count(), 0)
        with closing(sqlite3.connect(self.adapter.ledger.path)) as db:
            self.assertEqual(db.execute("SELECT state FROM inference_usage").fetchall(), [("settled",)])

    def test_rejected_none_does_not_retry(self):
        self.response = httpx.Response(400, text="sensitive provider body")
        client, _, _, _ = make_test_client(adapter=self.adapter)
        result = client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=valid_request())
        self.assertEqual(result.status_code, 503)
        self.assertEqual(len(self.calls), 1)
        self.assertNotIn("sensitive provider body", result.text)

class S5CanaryPreflightTests(unittest.TestCase):
    def test_six_paragraph_fixture_is_sufficient_within_3072_input_bound(self):
        from services.article_intel_summary.inference import build_model_input
        from services.article_intel_summary.litellm_adapter import _build_messages, _estimate_input_tokens
        from services.article_intel_summary.tests.support import SYNTHETIC_PARAGRAPHS, make_snapshot

        html = "<article>" + "".join(f"<p>{p}</p>" for p in SYNTHETIC_PARAGRAPHS[:6]) + "</article>"
        snapshot = make_snapshot(html)
        self.assertTrue(snapshot.is_sufficient)
        self.assertLessEqual(_estimate_input_tokens(_build_messages(build_model_input(snapshot), s5=True)), 3072)
