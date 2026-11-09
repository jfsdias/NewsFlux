from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

_MAX_CONFIG_URL_LENGTH = 2048
_MAX_ADMIN_ID = 9_223_372_036_854_775_807
_ALLOWED_PATH = re.compile(r"^/[A-Za-z0-9._~/-]*$")
_ALLOWED_DNS_NAME = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$")


class AuthConfigurationError(ValueError):
    """A safe configuration error that never contains a secret value."""


def _canonical_host(host: str, *, allow_ip: bool) -> str:
    if not host or any(char.isspace() or ord(char) < 0x21 for char in host):
        raise AuthConfigurationError("URL host is invalid")
    normalized = host.rstrip(".").casefold()
    if not normalized:
        raise AuthConfigurationError("URL host is invalid")
    try:
        address = ipaddress.ip_address(normalized)
    except ValueError:
        try:
            ascii_host = normalized.encode("idna").decode("ascii")
        except UnicodeError as exc:
            raise AuthConfigurationError("URL host is invalid") from exc
        if len(ascii_host) > 253 or not _ALLOWED_DNS_NAME.fullmatch(ascii_host):
            raise AuthConfigurationError("URL host is invalid")
        return ascii_host
    if not allow_ip:
        raise AuthConfigurationError("IP literal hosts are not allowed")
    return f"[{address.compressed}]" if address.version == 6 else address.compressed


def _parse_https_url(value: object):
    if not isinstance(value, str) or not value or len(value) > _MAX_CONFIG_URL_LENGTH:
        raise AuthConfigurationError("HTTPS URL is required")
    if any(char in value for char in "\r\n\x00\\"):
        raise AuthConfigurationError("URL contains invalid characters")
    normalized_value = value.strip()
    if "?" in normalized_value or "#" in normalized_value:
        raise AuthConfigurationError("URL query and fragment components are not allowed")
    try:
        parsed = urlsplit(normalized_value)
        port = parsed.port
    except ValueError as exc:
        raise AuthConfigurationError("URL is invalid") from exc
    if parsed.scheme.casefold() != "https" or not parsed.netloc or not parsed.hostname:
        raise AuthConfigurationError("URL must use HTTPS and include a host")
    if parsed.username is not None or parsed.password is not None:
        raise AuthConfigurationError("URL credentials are not allowed")
    if port is not None and not 1 <= port <= 65535:
        raise AuthConfigurationError("URL port is invalid")
    host = _canonical_host(parsed.hostname, allow_ip=True)
    return parsed, host, port


def canonicalize_miniflux_base_url(value: object) -> str:
    """Normalize one trusted Miniflux API base; callers never use client input as a target."""

    parsed, host, port = _parse_https_url(value)
    raw_path = parsed.path or ""
    decoded_path = unquote(raw_path)
    if (
        "%" in raw_path
        or not _ALLOWED_PATH.fullmatch(raw_path or "/")
        or "//" in raw_path
        or any(segment in {".", ".."} for segment in decoded_path.split("/"))
    ):
        raise AuthConfigurationError("Miniflux base path is invalid")
    path = raw_path.rstrip("/")
    normalized_port = "" if port in (None, 443) else f":{port}"
    return f"https://{host}{normalized_port}{path}"


def canonicalize_web_origin(value: object) -> str:
    """Normalize an exact HTTPS browser origin; paths, wildcards and credentials fail closed."""

    parsed, host, port = _parse_https_url(value)
    if parsed.path not in {"", "/"}:
        raise AuthConfigurationError("Web origin must not contain a path")
    normalized_port = "" if port in (None, 443) else f":{port}"
    return f"https://{host}{normalized_port}"


def parse_admin_user_ids(raw: str | None) -> tuple[frozenset[int], str]:
    """Return an origin-scoped allowlist and a fail-closed configuration state."""

    if raw is None:
        return frozenset(), "missing"
    if not raw.strip():
        return frozenset(), "empty"

    user_ids: set[int] = set()
    for item in raw.split(","):
        value = item.strip()
        if not value or not value.isascii() or not value.isdecimal():
            return frozenset(), "invalid"
        try:
            user_id = int(value)
        except ValueError:
            return frozenset(), "invalid"
        if not 1 <= user_id <= _MAX_ADMIN_ID:
            return frozenset(), "invalid"
        user_ids.add(user_id)
    if not user_ids:
        return frozenset(), "empty"
    return frozenset(user_ids), "configured"


@dataclass(frozen=True)
class AuthSettings:
    """Non-secret runtime settings for a single authorized Miniflux deployment."""

    miniflux_base_url: str
    allowed_web_origins: frozenset[str]
    admin_user_ids: frozenset[int]
    admin_allowlist_state: str

    def __post_init__(self) -> None:
        canonical_base = canonicalize_miniflux_base_url(self.miniflux_base_url)
        canonical_origins = frozenset(canonicalize_web_origin(origin) for origin in self.allowed_web_origins)
        if not canonical_origins:
            raise AuthConfigurationError("At least one exact HTTPS NewsFlux web origin is required")
        if self.admin_allowlist_state not in {"missing", "empty", "invalid", "configured"}:
            raise AuthConfigurationError("Admin allowlist state is invalid")
        valid_ids = frozenset(
            user_id
            for user_id in self.admin_user_ids
            if isinstance(user_id, int) and not isinstance(user_id, bool) and 1 <= user_id <= _MAX_ADMIN_ID
        )
        if self.admin_allowlist_state != "configured" or len(valid_ids) != len(self.admin_user_ids):
            valid_ids = frozenset()
            if self.admin_allowlist_state == "configured":
                object.__setattr__(self, "admin_allowlist_state", "invalid")
        object.__setattr__(self, "miniflux_base_url", canonical_base)
        object.__setattr__(self, "allowed_web_origins", canonical_origins)
        object.__setattr__(self, "admin_user_ids", valid_ids)

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> AuthSettings:
        values = os.environ if environ is None else environ
        raw_base = values.get("NEWSFLUX_AI_MINIFLUX_BASE_URL")
        if raw_base is None:
            raise AuthConfigurationError("NEWSFLUX_AI_MINIFLUX_BASE_URL is required")
        base_url = canonicalize_miniflux_base_url(raw_base)

        raw_origins = values.get("NEWSFLUX_AI_ALLOWED_WEB_ORIGINS", "")
        origins = frozenset(
            canonicalize_web_origin(value.strip())
            for value in raw_origins.split(",")
            if value.strip()
        )
        if not origins:
            raise AuthConfigurationError("NEWSFLUX_AI_ALLOWED_WEB_ORIGINS must contain an HTTPS origin")

        admin_ids, allowlist_state = parse_admin_user_ids(values.get("NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS"))
        return cls(
            miniflux_base_url=base_url,
            allowed_web_origins=origins,
            admin_user_ids=admin_ids,
            admin_allowlist_state=allowlist_state,
        )
