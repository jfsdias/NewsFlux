"""Synthetic HTTP harness only: no network transport to Miniflux or LiteLLM."""
import json
import os
import tempfile
import threading
from pathlib import Path

import httpx
from fastapi.responses import JSONResponse

from services.article_intel_auth.auth import AuthSettings, MinifluxAuthService
from services.article_intel_summary.app import create_app
from services.article_intel_summary.litellm_adapter import LiteLLMInferenceAdapter
from services.article_intel_summary.service import SummaryService
from services.article_intel_summary.tests.support import FakeMinifluxHTTP, MINIFLUX_BASE, WEB_ORIGIN, SHORT_HTML
from services.article_intel_summary.tests.test_litellm_adapter import (
    MISTRAL_ALIAS,
    make_settings,
    completion_response,
)
from services.content_fallback.http_client import HTTPResponse

_temp = None
_ledger_path = os.environ.get("NEWSFLUX_PILOT_LEDGER_PATH")
if not _ledger_path:
    _temp = tempfile.TemporaryDirectory(prefix="newsflux-pilot-")
    _ledger_path = str(Path(_temp.name) / "usage.sqlite3")
_calls = []
_gateway_checks = []
_mode = "success"
_release = threading.Event()
_completed = threading.Event()
_virtual_key_path = os.environ.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE")
_virtual_key = (
    Path(_virtual_key_path).read_text(encoding="utf-8").strip()
    if _virtual_key_path
    else "synthetic-virtual-key"
)

class SyntheticMiniflux(FakeMinifluxHTTP):
    def get(self, url, **options):
        if options.get("headers", {}).get("X-Auth-Token") != "synthetic-user-api-key":
            self.calls.append({"method": "GET", "url": url, "authorized": False})
            return HTTPResponse(
                401,
                {"content-type": "application/json; charset=utf-8"},
                b"{}",
                url,
            )
        result = super().get(url, **options)
        if "/v1/entries/" in url:
            value = json.loads(result.body)
            value["id"] = 501
            return HTTPResponse(result.status, result.headers, json.dumps(value).encode(), result.url)
        return result

_pilot_content = json.loads(Path("scripts/pilot-e2e/article.json").read_text())["content"]
_miniflux = SyntheticMiniflux()
_miniflux.content = _pilot_content

def mock_litellm(request):
    _calls.append(request.method)
    authorized = request.headers.get("authorization") == f"Bearer {_virtual_key}"
    try:
        model_valid = json.loads(request.content).get("model") == MISTRAL_ALIAS
    except (AttributeError, json.JSONDecodeError):
        model_valid = False
    _gateway_checks.append({"authorized": authorized, "model_valid": model_valid})
    if not authorized or not model_valid:
        _completed.set()
        return httpx.Response(401)
    if _mode == "delayed":
        _release.wait(timeout=12)
    _completed.set()
    if _mode == "failure":
        return httpx.Response(503)
    output = {
        "summary": "Synthetic pilot summary.",
        "summary_paragraph_ids": ["p1"],
        "key_points": [{"text": "Synthetic pilot key point.", "paragraph_ids": ["p1"]}],
        "action_points": [{"text": "Synthetic pilot action.", "paragraph_ids": ["p1"]}],
    }
    return completion_response(output=output)

settings = AuthSettings(miniflux_base_url=MINIFLUX_BASE, allowed_web_origins=frozenset({WEB_ORIGIN}), admin_user_ids=frozenset(), admin_allowlist_state="empty")
auth = MinifluxAuthService(settings, http=_miniflux)
adapter = LiteLLMInferenceAdapter(
    make_settings(
        _ledger_path,
        virtual_key=_virtual_key,
        # The serial browser matrix exceeds the production default token quota.
        # Keep those UI scenarios reaching the MockTransport; budget gates are unit-tested separately.
        requests_per_minute=50,
        tokens_per_minute=200_000,
    ),
    client=httpx.Client(transport=httpx.MockTransport(mock_litellm)),
)
app = create_app(auth_service=auth, summary_service=SummaryService(adapter))

@app.get("/__pilot/metrics")
async def metrics():
    return JSONResponse({
        "inference_calls": len(_calls),
        "completed": _completed.is_set(),
        "miniflux_methods": [call["method"] for call in _miniflux.calls],
        "gateway_checks": list(_gateway_checks),
    })

@app.post("/__pilot/mode/{mode}")
async def set_mode(mode: str):
    global _mode
    if mode not in {"success", "short", "denied", "failure", "delayed"}:
        return JSONResponse({"error": "invalid"}, status_code=400)
    _mode = mode
    _release.clear()
    _completed.clear()
    _calls.clear()
    _gateway_checks.clear()
    _miniflux.calls.clear()
    _miniflux.content = SHORT_HTML if mode == "short" else _pilot_content
    _miniflux.identity_status = 401 if mode == "denied" else 200
    return JSONResponse({"status": "ok"})

@app.post("/__pilot/release")
async def release():
    _release.set()
    return JSONResponse({"status": "ok"})
