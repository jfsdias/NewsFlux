"""Admin-only LiteLLM control plane, never a browser-based credential store."""
from __future__ import annotations

import json
from collections.abc import Iterable

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from services.article_intel_auth.auth import MinifluxAuthService
from services.article_intel_auth.config import AuthConfigurationError, canonicalize_web_origin
from services.article_intel_auth.errors import AuthError
from services.article_intel_summary.admin_settings import ManagedSettingsError, ManagedSettingsStore

MAX_BODY_BYTES = 18 * 1024
BASE = "/api/ai/v1/admin/litellm"
ACTION_NAMES = frozenset({
    "status", "models", "policy", "test-key", "save-key", "save-policy",
    "approve-model", "remove-model", "migration-preview", "migrate-policy",
})
READ_ACTIONS = frozenset({"status", "models", "policy", "migration-preview"})


def _response(payload: dict, status: int = 200, *, origin: str | None = None) -> Response:
    reply = JSONResponse(payload, status_code=status)
    reply.headers.update({
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Vary": "Origin",
    })
    if origin:
        reply.headers["Access-Control-Allow-Origin"] = origin
        reply.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        reply.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, X-Miniflux-API-Key, X-NewsFlux-Miniflux-Server"
        )
    return reply


def _safe_error(code: str, status: int, origin: str | None) -> Response:
    if code not in {
        "NOT_AUTHORIZED", "UNAUTHENTICATED", "INVALID_REQUEST", "INVALID_JSON",
        "REQUEST_TOO_LARGE", "CONFIG_UNAVAILABLE", "CONFIG_UNSAFE",
        "CONFIG_INVALID", "CONFIG_CONFLICT", "KEY_INVALID", "KEY_UNVERIFIED",
        "POLICY_INVALID", "MODEL_NOT_DISCOVERED", "MODEL_UNVERIFIED",
        "CHANGES_DISABLED", "MIGRATION_REQUIRED", "MIGRATION_NOT_CONFIRMED",
    }:
        code = "CONFIG_UNAVAILABLE"
    return _response({"error": {"code": code}}, status, origin=origin)


def _check_origin_host(request: Request, auth: MinifluxAuthService) -> str:
    # Key mutations require an actual same-origin browser request (no Origin=None).
    origin = request.headers.get("origin")
    if not origin:
        raise AuthError("request_origin_not_allowed", 403)
    canonical = auth.origin_policy.validate_origin(origin)
    try:
        host_origin = canonicalize_web_origin(
            f"{request.url.scheme}://{request.headers.get('host', '')}"
        )
    except AuthConfigurationError:
        raise AuthError("request_origin_not_allowed", 403) from None
    if request.url.scheme.casefold() != "https" or canonical != host_origin:
        raise AuthError("request_origin_not_allowed", 403)
    if request.url.query:
        raise AuthError("request_origin_not_allowed", 403)
    return canonical


async def _body(request: Request) -> dict:
    if request.headers.get("content-type", "").split(";", 1)[0].lower().strip() != "application/json":
        raise ValueError("invalid")
    size = request.headers.get("content-length")
    if size is not None and (not size.isdecimal() or int(size) > MAX_BODY_BYTES):
        raise ValueError("too_large")
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_BODY_BYTES:
            raise ValueError("too_large")
        data.extend(chunk)

    def unique(pairs: Iterable[tuple[str, object]]) -> dict:
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate")
            result[key] = value
        return result

    try:
        obj = json.loads(
            data.decode("utf-8", errors="strict"),
            object_pairs_hook=unique,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError("constant"))
        )
    except (ValueError, UnicodeError):
        raise ValueError("invalid") from None
    if not isinstance(obj, dict):
        raise ValueError("invalid")
    return obj


def create_admin_router(auth: MinifluxAuthService, store: ManagedSettingsStore) -> APIRouter:
    router = APIRouter()

    async def authorize(request: Request) -> str:
        origin = _check_origin_host(request, auth)
        await run_in_threadpool(
            auth.authorize_admin,
            api_key=request.headers.get("x-miniflux-api-key"),
            claimed_miniflux_base_url=request.headers.get("x-newsflux-miniflux-server"),
            request_origin=origin,
            request_is_secure=True,
        )
        return origin

    async def invoke(request: Request, action: str):
        origin = None
        try:
            origin = await authorize(request)
            if request.method == "GET":
                if action == "status":
                    result = await run_in_threadpool(store.status)
                elif action == "models":
                    result = await run_in_threadpool(store.public_models)
                elif action == "policy":
                    result = await run_in_threadpool(store.policy)
                elif action == "migration-preview":
                    result = await run_in_threadpool(store.migration_preview)
                else:
                    return _safe_error("INVALID_REQUEST", 405, origin)
            elif request.method == "POST":
                data = await _body(request)
                if action == "test-key" and set(data) == {"key"}:
                    result = await run_in_threadpool(store.validate_candidate, data["key"])
                elif action == "save-key" and set(data) == {"key", "expected_revision"}:
                    if not isinstance(data["expected_revision"], str):
                        raise ValueError("invalid")
                    result = await run_in_threadpool(
                        store.save_key, data["key"], data["expected_revision"]
                    )
                elif action == "save-policy" and set(data) == {"policy", "expected_revision"}:
                    if not isinstance(data["expected_revision"], str):
                        raise ValueError("invalid")
                    result = await run_in_threadpool(
                        store.save_policy, data["policy"], data["expected_revision"]
                    )
                elif action == "approve-model" and set(data) == {
                    "alias", "expected_revision", "allow_paid", "allow_external"
                }:
                    result = await run_in_threadpool(
                        store.approve_model, data["alias"], data["expected_revision"],
                        allow_paid=data["allow_paid"], allow_external=data["allow_external"]
                    )
                elif action == "remove-model" and set(data) == {"alias", "expected_revision"}:
                    result = await run_in_threadpool(
                        store.remove_model, data["alias"], data["expected_revision"]
                    )
                elif action == "migrate-policy" and set(data) == {
                    "expected_revision", "preview_token", "confirm"
                }:
                    if not isinstance(data["expected_revision"], str):
                        raise ValueError("invalid")
                    result = await run_in_threadpool(
                        store.migrate_legacy_policy, data["expected_revision"],
                        data["preview_token"], data["confirm"]
                    )
                else:
                    raise ValueError("invalid")
            else:
                return _safe_error("INVALID_REQUEST", 405, origin)
            return _response(result, origin=origin)
        except AuthError as err:
            status = 401 if err.code == "unauthenticated" else 403
            return _safe_error(
                "UNAUTHENTICATED" if status == 401 else "NOT_AUTHORIZED",
                status, origin
            )
        except ValueError as err:
            return _safe_error(
                "REQUEST_TOO_LARGE" if str(err) == "too_large" else "INVALID_REQUEST",
                413 if str(err) == "too_large" else 422, origin
            )
        except ManagedSettingsError as err:
            status = (
                403 if err.code == "CHANGES_DISABLED" else
                409 if err.code in {"CONFIG_CONFLICT", "MIGRATION_REQUIRED"} else
                422 if err.code in {
                    "KEY_INVALID", "POLICY_INVALID", "MODEL_NOT_DISCOVERED", "MIGRATION_NOT_CONFIRMED"
                } else
                503
            )
            return _safe_error(err.code, status, origin)
        except Exception:
            return _safe_error("CONFIG_UNAVAILABLE", 503, origin)

    @router.get(BASE + "/status")
    async def status(request: Request):
        return await invoke(request, "status")

    @router.get(BASE + "/models")
    async def models(request: Request):
        return await invoke(request, "models")

    @router.get(BASE + "/policy")
    async def policy(request: Request):
        return await invoke(request, "policy")

    @router.get(BASE + "/migration-preview")
    async def migration_preview(request: Request):
        return await invoke(request, "migration-preview")

    @router.post(BASE + "/migrate-policy")
    async def migrate_policy(request: Request):
        return await invoke(request, "migrate-policy")

    @router.post(BASE + "/test-key")
    async def test_key(request: Request):
        return await invoke(request, "test-key")

    @router.post(BASE + "/save-key")
    async def save_key(request: Request):
        return await invoke(request, "save-key")

    @router.post(BASE + "/save-policy")
    async def save_policy(request: Request):
        return await invoke(request, "save-policy")

    @router.post(BASE + "/approve-model")
    async def approve_model(request: Request):
        return await invoke(request, "approve-model")

    @router.post(BASE + "/remove-model")
    async def remove_model(request: Request):
        return await invoke(request, "remove-model")

    @router.options(BASE + "/{action}")
    async def preflight(action: str, request: Request):
        if action not in ACTION_NAMES:
            return _safe_error("INVALID_REQUEST", 404, None)
        try:
            origin = _check_origin_host(request, auth)
            method = request.headers.get("access-control-request-method", "").upper()
            expected = "GET" if action in READ_ACTIONS else "POST"
            if method != expected:
                raise AuthError("request_origin_not_allowed", 403)
            headers = auth.origin_policy.preflight_headers(
                origin, method, request.headers.get("access-control-request-headers", "")
            )
            return Response(status_code=204, headers={
                **headers,
                "Access-Control-Allow-Methods": expected,
                "Cache-Control": "no-store",
            })
        except AuthError:
            return _safe_error("NOT_AUTHORIZED", 403, None)

    return router
