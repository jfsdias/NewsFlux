from __future__ import annotations

from collections.abc import Iterable

from services.article_intel_auth.config import AuthConfigurationError, canonicalize_web_origin
from services.article_intel_auth.errors import AuthError

_ALLOWED_METHODS = frozenset({"GET", "POST", "OPTIONS"})
_ALLOWED_HEADERS = frozenset({
    "content-type",
    "x-miniflux-api-key",
    "x-newsflux-miniflux-server",
})


class OriginPolicy:
    """Exact-origin CORS policy. Origin is a browser boundary, never an identity claim."""

    def __init__(self, allowed_origins: Iterable[str]) -> None:
        self._allowed_origins = frozenset(canonicalize_web_origin(origin) for origin in allowed_origins)
        if not self._allowed_origins:
            raise AuthConfigurationError("At least one allowed web origin is required")

    def validate_origin(self, origin: str | None) -> str | None:
        if origin is None:
            return None
        try:
            canonical = canonicalize_web_origin(origin)
        except AuthConfigurationError as exc:
            raise AuthError("request_origin_not_allowed", 403) from None
        if canonical not in self._allowed_origins:
            raise AuthError("request_origin_not_allowed", 403)
        return canonical

    def cors_headers(self, origin: str | None) -> dict[str, str]:
        canonical = self.validate_origin(origin)
        if canonical is None:
            return {}
        return {
            "Access-Control-Allow-Origin": canonical,
            "Access-Control-Allow-Headers": "Content-Type, X-Miniflux-API-Key, X-NewsFlux-Miniflux-Server",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Vary": "Origin",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        }

    def preflight_headers(self, origin: str | None, method: str, headers: str | Iterable[str]) -> dict[str, str]:
        canonical = self.validate_origin(origin)
        if canonical is None:
            raise AuthError("request_origin_not_allowed", 403)
        requested_method = method.strip().upper() if isinstance(method, str) else ""
        if requested_method not in _ALLOWED_METHODS:
            raise AuthError("request_origin_not_allowed", 403)
        requested_headers = headers.split(",") if isinstance(headers, str) else list(headers)
        normalized_headers = {value.strip().casefold() for value in requested_headers if value.strip()}
        if not normalized_headers.issubset(_ALLOWED_HEADERS):
            raise AuthError("request_origin_not_allowed", 403)
        return {
            **self.cors_headers(canonical),
            "Access-Control-Max-Age": "600",
        }
