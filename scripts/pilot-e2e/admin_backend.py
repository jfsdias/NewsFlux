"""Synthetic harness for NEWSFLUX-AI-SETTINGS-01: real Summary app, real admin store.

Real code under test: create_app, admin router, Miniflux admin authorization,
ManagedSettingsStore (temporary 0700 directory), gateway_getter and the dynamic
catalog. Only the transports are synthetic: Miniflux identity and the LiteLLM
gateway are in-process fakes. No network, no real credential, no article inference.
"""
import json
import os
import tempfile
from pathlib import Path

import httpx
from fastapi.responses import JSONResponse

import services.article_intel_summary.catalog as catalog
from services.article_intel_auth.auth import AuthSettings, MinifluxAuthService
from services.content_fallback.http_client import HTTPResponse

MINIFLUX_BASE = "https://miniflux.example"
WEB_ORIGIN = "https://newsflux.example"
ADMIN_TOKEN = "synthetic-admin-miniflux-key"
READER_TOKEN = "synthetic-reader-miniflux-key"
BOOTSTRAP_KEY = "sk-synthetic-bootstrap-newsflux-key-0001"
REPLACEMENT_KEY = "sk-synthetic-replacement-newsflux-key-0002"
ACCEPTED_KEYS = {BOOTSTRAP_KEY, REPLACEMENT_KEY}

_tmp = tempfile.TemporaryDirectory(prefix="newsflux-ai-admin-")
_root = Path(_tmp.name)
_bootstrap = _root / "bootstrap-key"
_bootstrap.write_text(BOOTSTRAP_KEY + "\n", encoding="ascii")
_bootstrap.chmod(0o600)
_managed = _root / "managed"

_gateway_calls: list[dict] = []
_gateway_mode = {"value": "ok"}


def _model(alias, provider, api_base, input_cost, output_cost, mode="chat"):
    info = {"mode": mode, "litellm_provider": provider, "max_input_tokens": 32768, "max_output_tokens": 4096}
    if input_cost is not None:
        info["input_cost_per_token"] = input_cost
    if output_cost is not None:
        info["output_cost_per_token"] = output_cost
    return {"model_name": alias, "litellm_params": {"model": f"{provider}/{alias}", "api_base": api_base}, "model_info": info}


MODELS = [
    _model("llama3.2:3b", "ollama", "http://ollama:11434", 0, 0),
    _model("groq-free-synthetic", "groq", "https://api.groq.example", 0, 0),
    _model("mistral-small-synthetic", "mistral", "https://api.mistral.example", 0.0000002, 0.0000006),
    _model("unpriced-synthetic", "openai", "https://api.openai.example", None, None),
    _model("embedding-synthetic", "ollama", "http://ollama:11434", 0, 0, mode="embedding"),
]


def _fake_litellm(request: httpx.Request) -> httpx.Response:
    auth = request.headers.get("authorization", "")
    key = auth.removeprefix("Bearer ")
    _gateway_calls.append({"method": request.method, "path": request.url.path, "accepted": key in ACCEPTED_KEYS})
    if request.method != "GET":
        return httpx.Response(405)
    if _gateway_mode["value"] == "down":
        return httpx.Response(503, json={"error": "synthetic outage"})
    if key not in ACCEPTED_KEYS:
        return httpx.Response(401, json={"error": "invalid key"})
    if request.url.path == "/v1/models":
        return httpx.Response(200, json={"object": "list", "data": [{"id": m["model_name"], "object": "model"} for m in MODELS]})
    if request.url.path == "/model/info":
        return httpx.Response(200, json={"data": MODELS})
    return httpx.Response(404)


_real_getter = catalog.gateway_getter


def synthetic_gateway_getter(base_url, private_peer, virtual_key, *, client=None):
    return _real_getter(
        base_url, private_peer, virtual_key,
        client=httpx.Client(transport=httpx.MockTransport(_fake_litellm), follow_redirects=False),
    )


# Patch before the app builds its catalog so bootstrap and managed discovery
# both use the real getter code over the synthetic transport.
catalog.gateway_getter = synthetic_gateway_getter

os.environ.update({
    "NEWSFLUX_AI_LITELLM_BASE_URL": "https://litellm.example",
    "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(_bootstrap),
    "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
    "NEWSFLUX_AI_INFERENCE_ENABLED": "false",
    "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "false",
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
    "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
    "NEWSFLUX_AI_ADMIN_SETTINGS_DIR": str(_managed),
    "NEWSFLUX_AI_USAGE_DATABASE_PATH": str(_root / "usage.sqlite3"),
})

from services.article_intel_summary.admin_settings import ManagedSettingsStore  # noqa: E402
from services.article_intel_summary.app import create_app  # noqa: E402


class SyntheticMiniflux:
    def __init__(self):
        self.calls = []

    def get(self, url, **options):
        token = dict(options.get("headers", {})).get("X-Auth-Token")
        self.calls.append(url)
        if not url.endswith("/v1/me") or token not in (ADMIN_TOKEN, READER_TOKEN):
            return HTTPResponse(401, {"content-type": "application/json"}, b"{}", url)
        admin = token == ADMIN_TOKEN
        body = {"id": 7 if admin else 8, "username": "synthetic-admin" if admin else "synthetic-reader", "is_admin": admin}
        return HTTPResponse(200, {"content-type": "application/json; charset=utf-8"}, json.dumps(body).encode(), url)


auth = MinifluxAuthService(
    AuthSettings(
        miniflux_base_url=MINIFLUX_BASE,
        allowed_web_origins=frozenset({WEB_ORIGIN}),
        admin_user_ids=frozenset({7}),
        admin_allowlist_state="configured",
    ),
    http=SyntheticMiniflux(),
)
store = ManagedSettingsStore(getter_factory=synthetic_gateway_getter)
app = create_app(auth_service=auth, admin_store=store)


@app.get("/__admin/state")
async def state():
    files = sorted(p.name for p in _managed.iterdir()) if _managed.exists() else []
    modes = {p.name: oct(p.stat().st_mode & 0o777) for p in _managed.iterdir()} if _managed.exists() else {}
    raw = b"".join(p.read_bytes() for p in _managed.iterdir() if p.is_file()) if _managed.exists() else b""
    return JSONResponse({
        "files": files,
        "modes": modes,
        "dir_mode": oct(_managed.stat().st_mode & 0o777) if _managed.exists() else None,
        # Assertions only: whether each synthetic key is the one now persisted server-side.
        "stores_replacement": REPLACEMENT_KEY.encode() in (_managed / "settings.json").read_bytes()
        if (_managed / "settings.json").exists() else False,
        "bootstrap_unchanged": _bootstrap.read_text(encoding="ascii").strip() == BOOTSTRAP_KEY,
        "has_any_key_bytes": bool(raw),
        "gateway_calls": list(_gateway_calls),
    })


_LEGACY_ENV = {
    "NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS": "llama3.2:3b",
    "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION": "0",
    "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION": "0",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS": "mistral-small-synthetic",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION": "0.2",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION": "0.6",
}
_archives = {"count": 0}


@app.post("/__admin/legacy/{mode}")
async def legacy(mode: str):
    """Harness only: a fresh LEGACY bootstrap (aliases, no policy JSON, no managed record)."""
    if mode not in {"on", "readonly", "off"}:
        return JSONResponse({"error": "invalid"}, status_code=400)
    if mode in {"on", "readonly"}:
        if _managed.exists():
            # Keep earlier tests' records (temporary dir only) instead of deleting them.
            _archives["count"] += 1
            _managed.rename(_root / f"archived-{_archives['count']}")
        store.env.update(_LEGACY_ENV)
        store.enabled = mode == "on"
    else:
        for name in _LEGACY_ENV:
            store.env.pop(name, None)
        store.enabled = True
    _gateway_mode["value"] = "ok"
    return JSONResponse({"legacy": mode})


@app.post("/__admin/gateway/{mode}")
async def gateway(mode: str):
    if mode not in {"ok", "down"}:
        return JSONResponse({"error": "invalid"}, status_code=400)
    _gateway_mode["value"] = mode
    _gateway_calls.clear()
    return JSONResponse({"status": mode})
