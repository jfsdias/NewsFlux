from __future__ import annotations

import asyncio
import json
import re
import threading
from collections.abc import Iterable
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from jsonschema.exceptions import ValidationError

from services.article_intel_auth.auth import AuthError, AuthSettings, MinifluxAuthService
from services.article_intel_auth.config import AuthConfigurationError, canonicalize_web_origin
from services.article_intel_summary.contracts import validate_error, validate_request
from services.article_intel_summary.litellm_adapter import create_configured_inference_adapter
from services.article_intel_summary.service import ModelOutputInvalid, SummaryService

MAX_REQUEST_BODY_BYTES = 8 * 1024
MAX_IN_FLIGHT_SUMMARIES = 2
_ENTRY_ID_RE = re.compile(r"^[1-9][0-9]{0,18}$")
_REQUEST_ID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


class _ApiError(Exception):
    def __init__(self, code: str, status_code: int, request_id: str | None = None, retryable: bool = False) -> None:
        self.code = code
        self.status_code = status_code
        self.request_id = request_id
        self.retryable = retryable
        super().__init__(code)


def create_app(
    *,
    auth_service: MinifluxAuthService | None = None,
    summary_service: SummaryService | None = None,
    settings: AuthSettings | None = None,
) -> FastAPI:
    if auth_service is None:
        trusted_settings = settings or AuthSettings.from_env()
        auth_service = MinifluxAuthService(trusted_settings)
    elif settings is not None and settings != auth_service.settings:
        raise AuthConfigurationError("Provided app settings differ from the authentication service settings")
    summary_service = summary_service or SummaryService(create_configured_inference_adapter())
    origins = frozenset(auth_service.settings.allowed_web_origins)
    in_flight = threading.BoundedSemaphore(MAX_IN_FLIGHT_SUMMARIES)
    app = FastAPI(title="NewsFlux Article Intelligence API", version="1", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.auth_service = auth_service
    app.state.summary_service = summary_service

    @app.api_route("/api/ai/v1/entries/{entry_id}/summary", methods=["POST", "OPTIONS"])
    async def summarize_entry(entry_id: str, request: Request) -> Response:
        request_id: str | None = None
        origin = request.headers.get("origin")
        try:
            if request.url.query:
                raise _ApiError("INVALID_REQUEST", 400)
            if request.url.scheme.casefold() != "https":
                raise _ApiError("HTTPS_REQUIRED", 400)
            _validate_host(request, origins)
            canonical_origin = auth_service.origin_policy.validate_origin(origin)

            if request.method == "OPTIONS":
                requested_method = request.headers.get("access-control-request-method", "").strip().upper()
                if requested_method != "POST":
                    raise _ApiError("NOT_AUTHORIZED", 403)
                headers = auth_service.origin_policy.preflight_headers(
                    origin,
                    requested_method,
                    request.headers.get("access-control-request-headers", ""),
                )
                headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
                return Response(status_code=204, headers=_security_headers(headers))

            if not _ENTRY_ID_RE.fullmatch(entry_id):
                raise _ApiError("INVALID_REQUEST", 400)
            parsed_entry_id = int(entry_id)
            if parsed_entry_id > 9_223_372_036_854_775_807:
                raise _ApiError("INVALID_REQUEST", 400)
            if request.headers.get("content-type", "").split(";", 1)[0].strip().casefold() != "application/json":
                raise _ApiError("INVALID_REQUEST", 415)
            document = await _read_request_json(request)
            request_id = document["request_id"]

            if not in_flight.acquire(blocking=False):
                raise _ApiError("SUMMARY_BUSY", 429, request_id, retryable=True)
            try:
                authorized_entry = await asyncio.to_thread(
                    auth_service.authorize_entry,
                    api_key=request.headers.get("x-miniflux-api-key"),
                    claimed_miniflux_base_url=request.headers.get("x-newsflux-miniflux-server"),
                    request_origin=origin,
                    entry_id=parsed_entry_id,
                    request_is_secure=True,
                )
                outcome = await asyncio.to_thread(
                    summary_service.summarize,
                    authorized_entry,
                    request_id=request_id,
                )
                if outcome.http_status == 200:
                    current_entry = await asyncio.to_thread(
                        auth_service.authorize_entry,
                        api_key=request.headers.get("x-miniflux-api-key"),
                        claimed_miniflux_base_url=request.headers.get("x-newsflux-miniflux-server"),
                        request_origin=origin,
                        entry_id=parsed_entry_id,
                        request_is_secure=True,
                    )
                    current_snapshot = await asyncio.to_thread(summary_service.resolver.resolve, current_entry)
                    if (
                        current_entry.user_id != authorized_entry.user_id
                        or current_snapshot.content_fingerprint
                        != outcome.payload["provenance"]["content_fingerprint"]
                    ):
                        raise _ApiError("STALE_SNAPSHOT", 409, request_id)
            finally:
                in_flight.release()

            response = JSONResponse(outcome.payload, status_code=outcome.http_status)
            return _add_security_headers(response, auth_service, canonical_origin)
        except _ApiError as exc:
            return _error_response(exc, auth_service, canonical_origin=origin if _is_allowed_origin(auth_service, origin) else None)
        except AuthError as exc:
            return _error_response(_auth_api_error(exc, request_id), auth_service, canonical_origin=origin if _is_allowed_origin(auth_service, origin) else None)
        except ValidationError:
            return _error_response(_ApiError("INVALID_REQUEST", 422, request_id), auth_service, canonical_origin=origin if _is_allowed_origin(auth_service, origin) else None)
        except ModelOutputInvalid:
            return _error_response(_ApiError("MODEL_OUTPUT_INVALID", 502, request_id), auth_service, canonical_origin=origin if _is_allowed_origin(auth_service, origin) else None)

    return app


async def _read_request_json(request: Request) -> dict[str, Any]:
    raw_length = request.headers.get("content-length")
    if raw_length is not None:
        if not raw_length.isascii() or not raw_length.isdecimal():
            raise _ApiError("INVALID_REQUEST", 400)
        if int(raw_length) > MAX_REQUEST_BODY_BYTES:
            raise _ApiError("REQUEST_TOO_LARGE", 413)

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BODY_BYTES:
            raise _ApiError("REQUEST_TOO_LARGE", 413)
        body.extend(chunk)
    try:
        document = json.loads(
            body.decode("utf-8", errors="strict"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_nonfinite_number,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise _ApiError("INVALID_JSON", 400) from None
    try:
        return validate_request(document)
    except ValidationError:
        raise _ApiError("INVALID_REQUEST", 422) from None


def _reject_duplicate_keys(pairs: Iterable[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _reject_nonfinite_number(value: str) -> None:
    raise ValueError(f"non-finite JSON number {value}")


def _validate_host(request: Request, allowed_origins: frozenset[str]) -> None:
    host = request.headers.get("host", "")
    try:
        request_origin = canonicalize_web_origin(f"{request.url.scheme}://{host}")
    except AuthConfigurationError:
        raise _ApiError("HOST_NOT_AUTHORIZED", 400) from None
    if request_origin not in allowed_origins:
        raise _ApiError("HOST_NOT_AUTHORIZED", 400)


def _auth_api_error(error: AuthError, request_id: str | None) -> _ApiError:
    mapping = {
        "unauthenticated": ("UNAUTHENTICATED", 401),
        "request_origin_not_allowed": ("NOT_AUTHORIZED", 403),
        "miniflux_origin_not_authorized": ("NOT_AUTHORIZED", 403),
        "entry_not_accessible": ("ENTRY_NOT_ACCESSIBLE", 404),
        "stale_snapshot": ("STALE_SNAPSHOT", 409),
        "invalid_request": ("INVALID_REQUEST", 400),
        "https_required": ("HTTPS_REQUIRED", 400),
        "miniflux_unavailable": ("MINIFLUX_UNAVAILABLE", 502),
        "invalid_miniflux_response": ("MINIFLUX_UNAVAILABLE", 502),
    }
    code, status = mapping.get(error.code, ("NOT_AUTHORIZED", error.status_code))
    return _ApiError(code, status, request_id, retryable=status >= 500)


def _error_response(
    error: _ApiError,
    auth_service: MinifluxAuthService,
    *,
    canonical_origin: str | None,
) -> JSONResponse:
    payload = {
        "schema_version": "1",
        "request_id": error.request_id if isinstance(error.request_id, str) and _REQUEST_ID_RE.fullmatch(error.request_id) else None,
        "error": {"code": error.code, "retryable": error.retryable},
    }
    validate_error(payload)
    response = JSONResponse(payload, status_code=error.status_code)
    return _add_security_headers(response, auth_service, canonical_origin)


def _add_security_headers(
    response: Response,
    auth_service: MinifluxAuthService,
    origin: str | None,
) -> Response:
    if origin is not None:
        response.headers.update(auth_service.origin_policy.cors_headers(origin))
        response.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    response.headers.update(_security_headers({}))
    return response


def _security_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        **headers,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Vary": "Origin",
    }


def _is_allowed_origin(auth_service: MinifluxAuthService, origin: str | None) -> bool:
    try:
        return auth_service.origin_policy.validate_origin(origin) is not None
    except AuthError:
        return False
