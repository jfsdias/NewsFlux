from __future__ import annotations

import hmac
import json
import logging
import os
import re
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from services.content_fallback.miniflux import MinifluxClient
from services.content_fallback.policy import PolicyRegistry
from services.content_fallback.service import ContentFallbackService, RecoveryError
from services.content_fallback.store import SQLiteRecoveryStore

LOGGER = logging.getLogger("newsflux.content_fallback.http")
_ENTRY_PATH_RE = re.compile(r"^/v1/entries/([1-9][0-9]{0,18})/recover$")


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    miniflux_base_url: str
    miniflux_api_token: str
    service_api_token: str
    database_path: str
    policies: PolicyRegistry

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
            policies=PolicyRegistry.from_dict(policy_document),
        )


def make_handler(service: ContentFallbackService, service_token: str):
    class ContentFallbackHandler(BaseHTTPRequestHandler):
        server_version = "NewsFluxContentFallback/0.1"

        def _write_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
            self._last_status = status.value
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status.value)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.send_header("x-content-type-options", "nosniff")
            self.send_header("content-length", str(len(body)))
            self.send_header("connection", "close")
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

        def do_POST(self) -> None:  # noqa: N802
            supplied = self.headers.get("Authorization", "")
            expected = f"Bearer {service_token}"
            if not service_token or not hmac.compare_digest(supplied, expected):
                self._write_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            path_match = _ENTRY_PATH_RE.fullmatch(self.path)
            if path_match is None:
                self._write_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            if self.headers.get("content-length", "0") != "0" or self.headers.get("transfer-encoding"):
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "request_body_not_allowed"})
                return
            entry_id = int(path_match.group(1))
            if entry_id > 9_223_372_036_854_775_807:
                self._write_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_entry_id"})
                return
            try:
                result = service.recover(entry_id)
            except RecoveryError as exc:
                if str(exc) == "entry not found":
                    self._write_json(HTTPStatus.NOT_FOUND, {"error": "entry_not_found"})
                    return
                LOGGER.warning("Content fallback could not read Miniflux entry", extra={"entry_id": entry_id})
                self._write_json(HTTPStatus.BAD_GATEWAY, {"error": "miniflux_unavailable"})
                return
            self._write_json(HTTPStatus.OK, result)

        def log_message(self, _format: str, *_args: object) -> None:
            # BaseHTTPRequestHandler's default access log includes the request target;
            # keep the service log limited to route and status, never URL parameters.
            LOGGER.info(
                "Content fallback HTTP request",
                extra={"method": self.command, "path": self.path.split("?", 1)[0], "status": getattr(self, "_last_status", None)},
            )

    return ContentFallbackHandler


def build_service(settings: Settings) -> ContentFallbackService:
    miniflux = MinifluxClient(settings.miniflux_base_url, settings.miniflux_api_token)
    store = SQLiteRecoveryStore(settings.database_path)
    return ContentFallbackService(miniflux=miniflux, policies=settings.policies, store=store)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
    settings = Settings.from_env()
    server = ThreadingHTTPServer((settings.host, settings.port), make_handler(build_service(settings), settings.service_api_token))
    server.daemon_threads = True
    LOGGER.info("NewsFlux content fallback listening", extra={"host": settings.host, "port": settings.port})
    server.serve_forever()


if __name__ == "__main__":
    main()
