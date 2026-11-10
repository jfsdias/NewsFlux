from __future__ import annotations

import html
import ipaddress
import json
import os
import re
import socket
from datetime import datetime
from html.parser import HTMLParser
from dataclasses import dataclass
from urllib.parse import urlsplit

from services.article_intel_auth.auth import AuthError, MinifluxAuthService
from services.article_intel_auth.config import AuthSettings
from services.content_fallback.http_client import FetchError, PinnedHTTPClient, UnsafeURL
from services.content_fallback.miniflux import MinifluxClient, MinifluxError

_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_MAX_READER_HTML_BYTES = 2 * 1024 * 1024
_MAX_READER_HTML_PARAGRAPHS = 20_000


def _resolve_private_service(host: str, port: int, _allow_private: bool) -> str:
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise FetchError("private service DNS lookup failed") from exc
    if not answers:
        raise FetchError("private service DNS returned no addresses")
    pinned: list[str] = []
    for answer in answers:
        raw_address = answer[4][0].split("%", 1)[0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise UnsafeURL("private service DNS returned an invalid address") from exc
        classified = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) else address
        if (
            not (classified.is_private or classified.is_loopback)
            or classified.is_link_local
            or classified.is_multicast
            or classified.is_reserved
            or classified.is_unspecified
        ):
            raise UnsafeURL("content fallback service must resolve to a private address")
        pinned.append(str(address))
    return pinned[0]


class ContentFallbackPrivateClient:
    """Fixed-origin, no-redirect POST client for the private sidecar API."""

    def __init__(
        self,
        base_url: str,
        service_token: str,
        *,
        http: PinnedHTTPClient | None = None,
    ) -> None:
        try:
            parts = urlsplit(base_url)
            port = parts.port
        except (TypeError, ValueError):
            raise ValueError("Content Fallback private URL is invalid") from None
        if (
            parts.scheme.casefold() not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
            or parts.path not in {"", "/"}
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError("Content Fallback private URL must be a service origin")
        if (
            not isinstance(service_token, str)
            or len(service_token) < 32
            or any(char in service_token for char in "\r\n\x00")
        ):
            raise ValueError("Content Fallback service token is invalid")
        normalized_port = "" if port is None or port == (443 if parts.scheme.casefold() == "https" else 80) else f":{port}"
        host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname.casefold()
        self.base_url = f"{parts.scheme.casefold()}://{host}{normalized_port}"
        self.service_token = service_token
        self.http = http or PinnedHTTPClient(resolver=_resolve_private_service)

    def recover(self, entry_id: int) -> dict[str, object]:
        if not _positive_id(entry_id):
            raise ReaderBridgeError("invalid_request", 400)
        url = f"{self.base_url}/v1/entries/{entry_id}/recover"
        try:
            response = self.http.post(
                url,
                b"",
                headers={
                    "Authorization": f"Bearer {self.service_token}",
                    "Accept": "application/json",
                },
                timeout=8,
                max_bytes=_MAX_READER_HTML_BYTES + 16 * 1024,
                same_origin=self.base_url,
                allow_private_origin=True,
            )
        except (FetchError, UnsafeURL):
            raise ReaderBridgeError("recovery_unavailable", 502) from None
        if (
            response.status != 200
            or not response.headers.get("content-type", "").casefold().startswith("application/json")
        ):
            raise ReaderBridgeError("recovery_unavailable", 502)
        try:
            result = json.loads(response.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ReaderBridgeError("invalid_recovery_result") from None
        if not isinstance(result, dict):
            raise ReaderBridgeError("invalid_recovery_result")
        return result


class ReaderBridgeError(Exception):
    """Fixed safe error for a rejected Reader recovery request."""

    def __init__(self, code: str, status_code: int = 502) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


@dataclass(frozen=True)
class ReaderBridgeRuntimeConfig:
    auth_settings: AuthSettings
    allowed_user_id: int
    trusted_proxy_ips: frozenset[str]

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> ReaderBridgeRuntimeConfig | None:
        values = os.environ if environ is None else environ
        if values.get("CONTENT_FALLBACK_READER_ENABLED", "false").strip().casefold() != "true":
            return None
        raw_user_id = values.get("CONTENT_FALLBACK_READER_USER_ID", "")
        if (
            not raw_user_id.isascii()
            or not raw_user_id.isdecimal()
            or not 1 <= int(raw_user_id) <= 9_223_372_036_854_775_807
        ):
            raise ValueError("CONTENT_FALLBACK_READER_USER_ID must be a positive integer")
        raw_proxy_ips = values.get("CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS", "")
        if not raw_proxy_ips.strip():
            raise ValueError("CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS is required when Reader recovery is enabled")
        try:
            trusted_proxy_ips = frozenset(
                ipaddress.ip_address(item.strip()).compressed
                for item in raw_proxy_ips.split(",")
                if item.strip()
            )
        except ValueError as exc:
            raise ValueError("CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS must contain IP addresses") from exc
        if not trusted_proxy_ips:
            raise ValueError("CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS must contain at least one IP")
        return cls(
            auth_settings=AuthSettings.from_env(values),
            allowed_user_id=int(raw_user_id),
            trusted_proxy_ips=trusted_proxy_ips,
        )


class _ParagraphOnlyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[str] = []
        self.current: list[str] | None = None
        self.invalid = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() != "p" or attrs or self.current is not None:
            self.invalid = True
            return
        if len(self.paragraphs) >= _MAX_READER_HTML_PARAGRAPHS:
            self.invalid = True
            return
        self.current = []

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() != "p" or self.current is None:
            self.invalid = True
            return
        text = "".join(self.current).strip()
        if text:
            self.paragraphs.append(text)
        self.current = None

    def handle_data(self, data: str) -> None:
        if self.current is None:
            if data.strip():
                self.invalid = True
            return
        self.current.append(data)

    def handle_comment(self, _data: str) -> None:
        self.invalid = True

    def handle_decl(self, _decl: str) -> None:
        self.invalid = True

    def unknown_decl(self, _data: str) -> None:
        self.invalid = True

    def handle_startendtag(self, _tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        self.invalid = True


def canonicalize_safe_reader_html(value: object) -> str:
    if not isinstance(value, str):
        raise ReaderBridgeError("invalid_recovery_result")
    try:
        encoded = value.encode("utf-8", errors="strict")
    except UnicodeError:
        raise ReaderBridgeError("invalid_recovery_result") from None
    if not encoded or len(encoded) > _MAX_READER_HTML_BYTES:
        raise ReaderBridgeError("invalid_recovery_result")
    parser = _ParagraphOnlyParser()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        raise ReaderBridgeError("invalid_recovery_result") from None
    if parser.invalid or parser.current is not None or not parser.paragraphs:
        raise ReaderBridgeError("invalid_recovery_result")
    return "".join(f"<p>{html.escape(paragraph, quote=False)}</p>" for paragraph in parser.paragraphs)


def _positive_id(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _validate_recovery_result(result: object, *, entry_id: int, url_fingerprint: str) -> dict[str, object]:
    if not isinstance(result, dict):
        raise ReaderBridgeError("invalid_recovery_result")
    if (
        result.get("status") != "recovered"
        or not _positive_id(result.get("entry_id"))
        or result["entry_id"] != entry_id
        or result.get("url_fingerprint") != url_fingerprint
        or not isinstance(result.get("url_fingerprint"), str)
        or not _SHA256_RE.fullmatch(result["url_fingerprint"])
        or result.get("content_origin") not in {"wallhop", "miniflux_scraper"}
    ):
        raise ReaderBridgeError("recovery_identity_mismatch")

    validation = result.get("validation")
    if not isinstance(validation, dict) or validation.get("state") != "SUFFICIENT":
        raise ReaderBridgeError("invalid_recovery_result")
    safe_validation: dict[str, int | str] = {"state": "SUFFICIENT"}
    for field in ("word_count", "sentence_count", "paragraph_count"):
        value = validation.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ReaderBridgeError("invalid_recovery_result")
        safe_validation[field] = value

    origin = result["content_origin"]
    provenance = result.get("provenance")
    provider = "wallhop.io" if origin == "wallhop" else "miniflux"
    if (
        not isinstance(provenance, dict)
        or provenance.get("provider") != provider
        or not isinstance(provenance.get("fetched_at"), str)
        or len(provenance["fetched_at"]) > 64
    ):
        raise ReaderBridgeError("invalid_recovery_result")
    try:
        datetime.fromisoformat(provenance["fetched_at"].replace("Z", "+00:00"))
    except ValueError:
        raise ReaderBridgeError("invalid_recovery_result") from None

    return {
        "status": "recovered",
        "entry_id": entry_id,
        "url_fingerprint": url_fingerprint,
        "content_html": canonicalize_safe_reader_html(result.get("content_html")),
        "content_origin": origin,
        "validation": safe_validation,
        "provenance": {"provider": provider, "fetched_at": provenance["fetched_at"]},
    }


class ReaderContentBridge:
    """One-user Reader adapter reusing PR #205 Miniflux authorization."""

    def __init__(
        self,
        *,
        auth: MinifluxAuthService,
        miniflux: MinifluxClient,
        recovery: ContentFallbackPrivateClient,
        allowed_user_id: int,
    ) -> None:
        if not _positive_id(allowed_user_id):
            raise ValueError("Reader bridge requires one positive configured user ID")
        self.auth = auth
        self.miniflux = miniflux
        self.recovery = recovery
        self.allowed_user_id = allowed_user_id

    def recover(
        self,
        *,
        entry_id: int,
        api_key: str | None,
        claimed_miniflux_base_url: str | None,
        request_origin: str | None,
        request_is_secure: bool,
    ) -> dict[str, object]:
        if not _positive_id(entry_id):
            raise ReaderBridgeError("invalid_request", 400)
        try:
            authorized_entry = self.auth.authorize_entry(
                api_key=api_key,
                claimed_miniflux_base_url=claimed_miniflux_base_url,
                request_origin=request_origin,
                request_is_secure=request_is_secure,
                entry_id=entry_id,
            )
        except AuthError:
            raise
        if authorized_entry.user_id != self.allowed_user_id:
            raise ReaderBridgeError("entry_not_accessible", 404)
        url_fingerprint = authorized_entry.url_fingerprint
        if not isinstance(url_fingerprint, str) or not _SHA256_RE.fullmatch(url_fingerprint):
            raise ReaderBridgeError("entry_fingerprint_unavailable", 502)

        try:
            service_identity = self.miniflux.get_current_user_identity()
        except MinifluxError:
            raise ReaderBridgeError("bridge_scope_unavailable", 503) from None
        if service_identity.id != self.allowed_user_id or service_identity.is_admin:
            raise ReaderBridgeError("bridge_scope_unavailable", 503)

        try:
            result = self.recovery.recover(entry_id)
        except Exception:
            raise ReaderBridgeError("recovery_unavailable", 502) from None
        return _validate_recovery_result(
            result,
            entry_id=authorized_entry.entry_id,
            url_fingerprint=url_fingerprint,
        )
