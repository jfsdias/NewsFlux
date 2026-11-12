"""Synthetic HTTP harness only: no network transport to Miniflux or LiteLLM."""
import json
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
from services.article_intel_summary.tests.test_litellm_adapter import make_settings, completion_response
from services.content_fallback.http_client import HTTPResponse

_temp = tempfile.TemporaryDirectory(prefix="newsflux-pilot-")
_calls = []
_mode = "success"
_release = threading.Event()
_completed = threading.Event()

class SyntheticMiniflux(FakeMinifluxHTTP):
    def get(self, url, **options):
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
adapter = LiteLLMInferenceAdapter(make_settings(str(Path(_temp.name) / "usage.sqlite3")), client=httpx.Client(transport=httpx.MockTransport(mock_litellm)))
app = create_app(auth_service=auth, summary_service=SummaryService(adapter))

@app.get("/__pilot/metrics")
async def metrics():
    return JSONResponse({"inference_calls": len(_calls), "completed": _completed.is_set(), "miniflux_methods": [call["method"] for call in _miniflux.calls]})

@app.post("/__pilot/mode/{mode}")
async def set_mode(mode: str):
    global _mode
    if mode not in {"success", "short", "denied", "failure", "delayed"}:
        return JSONResponse({"error": "invalid"}, status_code=400)
    _mode = mode
    _release.clear()
    _completed.clear()
    _calls.clear()
    _miniflux.calls.clear()
    _miniflux.content = SHORT_HTML if mode == "short" else _pilot_content
    _miniflux.identity_status = 401 if mode == "denied" else 200
    return JSONResponse({"status": "ok"})

@app.post("/__pilot/release")
async def release():
    _release.set()
    return JSONResponse({"status": "ok"})
