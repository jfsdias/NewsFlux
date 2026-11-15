from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import re
import ssl
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from services.article_intel_auth.auth import AuthError, MinifluxAuthService
from services.content_fallback.http_client import EgressRelayResolver, PinnedHTTPClient
from services.content_fallback.miniflux import MinifluxClient, ReaderRecoveryScope
from services.content_fallback.policy import PolicyRegistry
from services.content_fallback.reader_bridge import (
    ContentFallbackPrivateClient,
    ReaderBridgeError,
    ReaderBridgeRuntimeConfig,
    ReaderContentBridge,
)
from services.content_fallback.service import ContentFallbackService, RecoveryError, WallHopProvider
from services.content_fallback.store import SQLiteRecoveryStore

LOGGER = logging.getLogger("newsflux.content_fallback.http")
_ENTRY_PATH_RE = re.compile(r"^/v1/entries/([1-9][0-9]{0,18})/recover$")
_READER_ENTRY_PATH_RE = re.compile(r"^/reader/v1/entries/([1-9][0-9]{0,18})/recover$")
_MAX_READER_SCOPE_REQUEST_BYTES = 8192


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    miniflux_base_url: str
    miniflux_api_token: str
    service_api_token: str
    database_path: str
    private_service_url: str
    policies: PolicyRegistry
    reader_bridge: ReaderBridgeRuntimeConfig | None

    @classmethod
    def from_env(cls) -> Settings:
        raw_policies = os.environ.get("CONTENT_FALLBACK_POLICIES_JSON", "{}")
        try:
            policy_document = json.loads(raw_policies)
        except json.JSONDecodeError as exc:
            raise ValueError("CONTENT_FALLBACK_POLICIES_JSON is invalid JSON") from exc
        base_url = os.environ.get("MINIFLUX_BASE_URL", "").strip()
        miniflux_token = os.environ.get("MINIFLUX_API_TOKEN", "")
        service_token = os.environ.get("CONTENT_FALLBACK_API_TOKEN", "")
        if not base_url or not miniflux_token or not service_token:
            raise ValueError("Miniflux URL and API tokens are required to start the service")
        if len(service_token) < 32:
            raise ValueError("CONTENT_FALLBACK_API_TOKEN must be at least 32 characters")
        try:
            port = int(os.environ.get("CONTENT_FALLBACK_PORT", "8790"))
        except ValueError as exc:
            raise ValueError("CONTENT_FALLBACK_PORT must be an integer") from exc
        if not 1 <= port <= 65535:
            raise ValueError("CONTENT_FALLBACK_PORT must be between 1 and 65535")
        return cls(
            host=os.environ.get("CONTENT_FALLBACK_HOST", "127.0.0.1"),
            port=port,
            miniflux_base_url=base_url,
            miniflux_api_token=miniflux_token,
            service_api_token=service_token,
            database_path=os.environ.get("CONTENT_FALLBACK_DB_PATH", "/data/content-fallback.sqlite3"),
            private_service_url=os.environ.get(
                "CONTENT_FALLBACK_PRIVATE_URL", f"http://127.0.0.1:{port}"
            ).strip(),
            policies=PolicyRegistry.from_dict(policy_document),
            reader_bridge=ReaderBridgeRuntimeConfig.from_env(),
        )


def make_handler(
    service: ContentFallbackService,
    service_token: str,
    *,
    reader_bridge: ReaderContentBridge | None = None,
    reader_trusted_proxy_ips: frozenset[str] = frozenset(),
):
    class ContentFallbackHandler(BaseHTTPRequestHandler):
        server_version = "NewsFluxContentFallback/0.1"

        def _write_json(
            self,
            status: HTTPStatus,
            payload: dict[str, object],
            extra_headers: dict[str, str] | None = None,
        ) -> None:
            self._last_status = status.value
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status.value)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.send_header("x-content-type-options", "nosniff")
            self.send_header("content-length", str(len(body)))
            self.send_header("connection", "close")
            for name, value in (extra_headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/healthz":
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            self._write_json(
                HTTPStatus.OK,
                {
                    "status": "ok",
                    "read_only": True,
                    "persistent_cache": bool(getattr(service.store, "persistent", False)),
                    "preload_supported": False,
                    "thirteen_ft_enabled": False,
                },
            )

        def do_OPTIONS(self) -> None:  # noqa: N802
            if reader_bridge is None or not _READER_ENTRY_PATH_RE.fullmatch(self.path):
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            try:
                headers = reader_bridge.auth.origin_policy.preflight_headers(
                    self.headers.get("Origin"),
                    self.headers.get("Access-Control-Request-Method", ""),
                    self.headers.get("Access-Control-Request-Headers", ""),
                )
            except Exception:
                self._write_json(HTTPStatus.FORBIDDEN, {"error": "request_origin_not_allowed"})
                return
            self._write_json(HTTPStatus.OK, {}, headers)

        def do_POST(self) -> None:  # noqa: N802
            reader_path_match = _READER_ENTRY_PATH_RE.fullmatch(self.path)
            if reader_path_match is not None:
                self._handle_reader_recovery(int(reader_path_match.group(1)))
                return

            supplied = self.headers.get("Authorization", "")
            expected = f"Bearer {service_token}"
            if not service_token or not hmac.compare_digest(supplied, expected):
                self._write_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            path_match = _ENTRY_PATH_RE.fullmatch(self.path)
            if path_match is None:
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            raw_content_length = self.headers.get("content-length", "0")
            if (
                not raw_content_length.isascii()
                or not raw_content_length.isdecimal()
                or self.headers.get("transfer-encoding")
            ):
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "request_body_not_allowed"})
                return
            entry_id = int(path_match.group(1))
            if entry_id > 9_223_372_036_854_775_807:
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_entry_id"})
                return
            if len(raw_content_length) > len(str(_MAX_READER_SCOPE_REQUEST_BYTES)):
                self._write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid_reader_scope"})
                return
            content_length = int(raw_content_length)
            if content_length > _MAX_READER_SCOPE_REQUEST_BYTES:
                self._write_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid_reader_scope"})
                return
            reader_scope = None
            if content_length:
                content_type = self.headers.get("content-type", "").split(";", 1)[0].strip().casefold()
                if content_type != "application/json":
                    self._write_json(HTTPStatus.BAD_REQUEST, {"error": "request_body_not_allowed"})
                    return
                try:
                    raw_body = self.rfile.read(content_length)
                    if len(raw_body) != content_length:
                        raise ValueError("incomplete request body")
                    reader_scope = ReaderRecoveryScope.from_payload(
                        json.loads(raw_body.decode("utf-8"), object_pairs_hook=_unique_json_object),
                        expected_entry_id=entry_id,
                    )
                except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
                    self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_reader_scope"})
                    return
            try:
                result = (
                    service.recover(entry_id)
                    if reader_scope is None
                    else service.recover(entry_id, reader_scope=reader_scope)
                )
            except RecoveryError as exc:
                if str(exc) == "entry not found":
                    self._write_json(HTTPStatus.NOT_FOUND, {"error": "entry_not_found"})
                    return
                if str(exc) == "reader_scope_mismatch":
                    self._write_json(HTTPStatus.FORBIDDEN, {"error": "entry_not_accessible"})
                    return
                LOGGER.warning("Content fallback could not read Miniflux entry", extra={"entry_id": entry_id})
                self._write_json(HTTPStatus.BAD_GATEWAY, {"error": "miniflux_unavailable"})
                return
            self._write_json(HTTPStatus.OK, result)

        def _handle_reader_recovery(self, entry_id: int) -> None:
            if reader_bridge is None:
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            cors_headers: dict[str, str] = {}
            try:
                cors_headers = reader_bridge.auth.origin_policy.cors_headers(self.headers.get("Origin"))
                if self.headers.get("content-length", "0") != "0" or self.headers.get("transfer-encoding"):
                    self._write_json(HTTPStatus.BAD_REQUEST, {"error": "request_body_not_allowed"}, cors_headers)
                    return
                result = reader_bridge.recover(
                    entry_id=entry_id,
                    api_key=self.headers.get("X-Miniflux-API-Key"),
                    claimed_miniflux_base_url=self.headers.get("X-NewsFlux-Miniflux-Server"),
                    request_origin=self.headers.get("Origin"),
                    request_is_secure=self._request_is_secure(),
                )
            except ReaderBridgeError as exc:
                self._write_json(
                    HTTPStatus(exc.status_code),
                    {"error": exc.code},
                    cors_headers,
                )
                return
            except AuthError as exc:
                self._write_json(
                    HTTPStatus(exc.status_code),
                    {"error": exc.code},
                    cors_headers,
                )
                return
            except Exception:
                self._write_json(HTTPStatus.BAD_GATEWAY, {"error": "recovery_unavailable"}, cors_headers)
                return
            self._write_json(HTTPStatus.OK, result, cors_headers)

        def _request_is_secure(self) -> bool:
            if isinstance(self.connection, ssl.SSLSocket):
                return True
            try:
                peer_ip = ipaddress.ip_address(str(self.client_address[0])).compressed
            except ValueError:
                return False
            return (
                peer_ip in reader_trusted_proxy_ips
                and self.headers.get("X-Forwarded-Proto", "").strip().casefold() == "https"
            )

        def log_message(self, _format: str, *_args: object) -> None:
            # BaseHTTPRequestHandler's default access log includes the request target;
            # keep the service log limited to route and status, never URL parameters.
            LOGGER.info(
                "Content fallback HTTP request",
                extra={"method": self.command, "path": self.path.split("?", 1)[0], "status": getattr(self, "_last_status", None)},
            )

    return ContentFallbackHandler


def build_egress_http(environ: dict[str, str] | None = None) -> PinnedHTTPClient | None:
    """Optional controlled egress. When required, startup fails closed without a relay."""
    values = os.environ if environ is None else environ
    relay = values.get("CONTENT_FALLBACK_EGRESS_RELAY", "").strip()
    required = values.get("CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY", "false").strip().casefold() == "true"
    if not relay:
        if required:
            raise ValueError("CONTENT_FALLBACK_EGRESS_RELAY is required")
        return None
    allowed = frozenset(
        item for item in values.get("CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS", "").split(",") if item.strip()
    )
    return PinnedHTTPClient(resolver=EgressRelayResolver(relay, allowed))


def build_service(settings: Settings, http: PinnedHTTPClient | None = None) -> ContentFallbackService:
    http = http if http is not None else build_egress_http()
    if http is not None:
        miniflux_parts = urlsplit(settings.miniflux_base_url)
        if miniflux_parts.scheme != "https":
            raise ValueError("MINIFLUX_BASE_URL must be HTTPS when the egress relay is used")
    miniflux = MinifluxClient(settings.miniflux_base_url, settings.miniflux_api_token, http=http)
    store = SQLiteRecoveryStore(settings.database_path)
    provider = WallHopProvider(http=http) if http is not None else None
    return ContentFallbackService(miniflux=miniflux, policies=settings.policies, store=store, provider=provider)


def build_reader_bridge(settings: Settings, service: ContentFallbackService) -> ReaderContentBridge | None:
    config = settings.reader_bridge
    if config is None:
        return None
    auth = MinifluxAuthService(config.auth_settings, http=service.miniflux.http)
    recovery = ContentFallbackPrivateClient(settings.private_service_url, settings.service_api_token)
    return ReaderContentBridge(
        auth=auth,
        miniflux=service.miniflux,
        recovery=recovery,
        allowed_user_id=config.allowed_user_id,
    )


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
    settings = Settings.from_env()
    service = build_service(settings)
    reader_bridge = build_reader_bridge(settings, service)
    server = ThreadingHTTPServer(
        (settings.host, settings.port),
        make_handler(
            service,
            settings.service_api_token,
            reader_bridge=reader_bridge,
            reader_trusted_proxy_ips=(settings.reader_bridge.trusted_proxy_ips if settings.reader_bridge else frozenset()),
        ),
    )
    server.daemon_threads = True
    LOGGER.info("NewsFlux content fallback listening", extra={"host": settings.host, "port": settings.port})
    server.serve_forever()


if __name__ == "__main__":
    main()
