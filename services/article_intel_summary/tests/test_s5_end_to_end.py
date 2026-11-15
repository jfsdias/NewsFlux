"""S5 end to end through the REAL app factory, router, LiteLLM adapter, budget ledger and Miniflux auth.

Only the network edges are synthetic: Miniflux (FakeMinifluxHTTP) and the LiteLLM gateway
(httpx.MockTransport). Gates: SUMMARY_STARTUP, MODEL_CATALOG, MODEL_AUTHORIZATION, ON_DEMAND_ONLY,
NO_SILENT_FALLBACK, CONTENT_ORIGIN_ACCURACY, NO_MINIFLUX_WRITES, PAID_MODEL_BLOCKED.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from services.article_intel_auth.auth import AuthSettings, MinifluxAuthService
from services.article_intel_summary.app import create_app
from services.article_intel_summary.profiles import DEFAULT_PROFILE
from services.article_intel_summary.tests.support import (
    ENTRY_ID,
    MINIFLUX_BASE,
    SYNTHETIC_PARAGRAPHS,
    WEB_ORIGIN,
    FakeMinifluxHTTP,
    SyncASGIClient,
    request_headers,
)
from services.article_intel_summary.tests.test_litellm_adapter import S5_ALIAS, approved_environment

REQUEST_ID = "33333333-3333-4333-8333-333333333333"
V2_OUTPUT = {
    "summary": "Aurora propõe ampliar o serviço de ônibus no corredor leste.",
    "summary_paragraph_ids": ["p1", "p2"],
    "key_points": [{"text": "24 horários adicionais nos dias úteis.", "paragraph_ids": ["p2"]}],
    "facts": [],
    "implications": [],
    "action_points": [],
    "open_questions": [{"text": "Faltam medições de fim de semana.", "paragraph_ids": ["p5"]}],
}


class SyntheticGateway:
    def __init__(self, *, status: int = 200, model: str = S5_ALIAS, output=None) -> None:
        self.requests: list[dict] = []
        self.status = status
        self.model = model
        self.output = output if output is not None else V2_OUTPUT

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.requests.append({"path": request.url.path, "auth": request.headers.get("authorization"), "body": body})
        if self.status != 200:
            return httpx.Response(self.status)
        return httpx.Response(
            200,
            json={
                "model": self.model,
                "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(self.output)}}],
                "usage": {"prompt_tokens": 900, "completion_tokens": 120, "total_tokens": 1020},
            },
        )


class S5EndToEndTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        key = Path(self.tmp.name) / "key"
        key.write_text("synthetic-virtual-key-000000000000\n", encoding="ascii")
        key.chmod(0o600)
        env = approved_environment(str(Path(self.tmp.name) / "usage.sqlite3"))
        # The exact policy `enable-s5` applies: S5 only, free, no paid inference, no fallback.
        env.update(
            {
                "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(key),
                "NEWSFLUX_AI_LITELLM_MODEL_CHOICE": "s5-free",
                "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
                "NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK": "false",
                "NEWSFLUX_AI_S5_MAX_OUTPUT_TOKENS": "2048",
                "NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS": "20",
            }
        )
        self.env = env

    def make_client(self, gateway: SyntheticGateway):
        settings = AuthSettings(
            miniflux_base_url=MINIFLUX_BASE,
            allowed_web_origins=frozenset({WEB_ORIGIN}),
            admin_user_ids=frozenset(),
            admin_allowlist_state="empty",
        )
        self.miniflux = FakeMinifluxHTTP()
        auth = MinifluxAuthService(settings, http=self.miniflux)
        with patch.dict(os.environ, self.env, clear=False):
            app = create_app(auth_service=auth)
        router = app.state.summary_service.router
        adapter = router.adapter_for("s5-free")
        adapter.client = httpx.Client(transport=httpx.MockTransport(gateway))
        owner = adapter._owner
        self.addCleanup(lambda: owner and owner.__exit__())
        return SyncASGIClient(app), app

    def summarize(self, client, **changes):
        body = {"schema_version": "2", "request_id": REQUEST_ID, "model_id": "s5-free", "profile": copy.deepcopy(DEFAULT_PROFILE)}
        body.update(changes)
        return client.post(f"/api/ai/v1/entries/{ENTRY_ID}/summary", headers=request_headers(), json=body)

    def test_catalog_offers_s5_by_default_and_blocks_paid_mistral(self) -> None:
        gateway = SyntheticGateway()
        client, _ = self.make_client(gateway)
        catalog = client.get("/api/ai/v1/models", headers=request_headers()).json()
        models = {item["id"]: item for item in catalog["models"]}
        self.assertEqual(catalog["default_model_id"], "s5-free")
        self.assertTrue(models["s5-free"]["available"])
        self.assertEqual(models["mistral-small"]["unavailable_reason"], "PAID_NOT_AUTHORIZED")
        self.assertEqual(gateway.requests, [], "the catalog never calls the model")

    def test_explicit_s5_summary_one_dispatch_with_profile_and_provenance(self) -> None:
        gateway = SyntheticGateway()
        client, _ = self.make_client(gateway)
        response = self.summarize(client)
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(len(gateway.requests), 1)
        sent = gateway.requests[0]
        self.assertEqual(sent["path"], "/v1/chat/completions")
        self.assertEqual(sent["body"]["model"], S5_ALIAS)
        self.assertEqual(sent["body"]["reasoning_effort"], "none")
        self.assertTrue(sent["body"]["disable_fallbacks"])
        self.assertLessEqual(sent["body"]["max_tokens"], 2048)
        system, user = sent["body"]["messages"]
        self.assertIn("Brazilian Portuguese", system["content"])
        self.assertIn("open_questions", system["content"])
        self.assertNotIn(SYNTHETIC_PARAGRAPHS[0][:40], system["content"])
        self.assertIn(SYNTHETIC_PARAGRAPHS[0][:40], user["content"])
        self.assertEqual(payload["provenance"]["model_id"], "s5-free")
        self.assertEqual(payload["provenance"]["effective_model_id"], S5_ALIAS)
        self.assertEqual(payload["provenance"]["content_origin"], "ORIGINAL_MINIFLUX")
        self.assertFalse(payload["provenance"]["fallback_used"])
        self.assertEqual(payload["open_questions"][0]["paragraph_ids"], ["p5"])
        self.assertTrue(all(call["method"] == "GET" for call in self.miniflux.calls))

    def test_paid_model_refused_and_s5_failure_never_falls_back(self) -> None:
        gateway = SyntheticGateway(status=503)
        client, _ = self.make_client(gateway)
        refused = self.summarize(client, model_id="mistral-small")
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(gateway.requests, [])
        failed = self.summarize(client)
        self.assertEqual(failed.status_code, 503)
        self.assertEqual(failed.json()["status"], "unavailable")
        self.assertEqual(len(gateway.requests), 1, "exactly one S5 attempt, no Mistral")

    def test_gateway_answering_with_another_model_is_rejected(self) -> None:
        gateway = SyntheticGateway(model="newsflux-mistral-small")
        client, _ = self.make_client(gateway)
        response = self.summarize(client)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")

    def test_no_inference_without_explicit_request(self) -> None:
        gateway = SyntheticGateway()
        client, _ = self.make_client(gateway)
        self.assertEqual(client.get("/healthz").status_code, 200)
        client.get("/api/ai/v1/models", headers=request_headers())
        self.assertEqual(gateway.requests, [])


if __name__ == "__main__":
    unittest.main()
