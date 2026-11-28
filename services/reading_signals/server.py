"""HTTP API of the NewsFlux reading-signals sidecar (NF-0902, ADR 0002).

Routes: GET /healthz, POST /v1/signals, GET /v1/affinity[?feeds=1,2], GET /v1/export,
POST /v1/signals/reset. Every /v1 route authenticates the caller's existing Miniflux API key.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import logging
import os
import ssl
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from services.article_intel_auth.auth import MinifluxAuthService
from services.article_intel_auth.config import AuthSettings
from services.article_intel_auth.errors import AuthError
from services.reading_signals.affinity import compute_affinity
from services.reading_signals.payload import MAX_FEED_ID, PayloadError, parse_signals_payload
from services.reading_signals.store import SignalStore

LOGGER = logging.getLogger("newsflux.reading_signals")
MAX_BODY_BYTES = 64 * 1024
MAX_FEED_FILTER = 5000
_JSON_HEADERS = {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


@dataclass(frozen=True)
class ServerSettings:
    trusted_proxy_ips: frozenset[str] = field(default_factory=frozenset)
    host: str = "0.0.0.0"
    port: int = 8791
    database_path: str = "/data/reading-signals.sqlite3"

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None) -> ServerSettings:
        values = os.environ if environ is None else environ
        raw_ips = [item.strip() for item in values.get("READING_SIGNALS_TRUSTED_PROXY_IPS", "").split(",") if item.strip()]
        if not raw_ips:
            raise ValueError("READING_SIGNALS_TRUSTED_PROXY_IPS must contain at least one IP")
        try:
            ips = frozenset(ipaddress.ip_address(item).compressed for item in raw_ips)
        except ValueError:
            raise ValueError("READING_SIGNALS_TRUSTED_PROXY_IPS must contain IP addresses") from None
        return cls(
            trusted_proxy_ips=ips,
            host=values.get("READING_SIGNALS_HOST", cls.host),
            port=int(values.get("READING_SIGNALS_PORT", str(cls.port))),
            database_path=values.get("READING_SIGNALS_DB_PATH", cls.database_path),
        )


def account_digest(miniflux_base_url: str, user_id: int) -> str:
    return hashlib.sha256(f"{miniflux_base_url}\n{user_id}".encode()).hexdigest()


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _utc_today() -> date:
    return datetime.now(timezone.utc).date()


def make_handler(*, store: SignalStore, auth, settings: ServerSettings, today: Callable[[], date] = _utc_today):
    class ReadingSignalsHandler(BaseHTTPRequestHandler):
        server_version = "NewsFluxReadingSignals/1"
        sys_version = ""

        def do_OPTIONS(self) -> None:  # noqa: N802
            try:
                headers = auth.origin_policy.preflight_headers(
                    self.headers.get("Origin"),
                    self.headers.get("Access-Control-Request-Method", ""),
                    self.headers.get("Access-Control-Request-Headers", ""),
                )
            except AuthError as exc:
                self._write(HTTPStatus(exc.status_code), {"error": exc.code})
                return
            self._write(HTTPStatus.NO_CONTENT, None, headers)

        def do_GET(self) -> None:  # noqa: N802
            path, query = self._route()
            if path == "/healthz":
                self._write(HTTPStatus.OK, {"status": "ok"})
            elif path == "/v1/affinity":
                self._authenticated(lambda account: self._affinity(account, query))
            elif path == "/v1/export":
                self._authenticated(lambda account: (HTTPStatus.OK, store.export(account)))
            else:
                self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            path, _ = self._route()
            if path == "/v1/signals":
                self._authenticated(self._signals)
            elif path == "/v1/signals/reset":
                self._authenticated(lambda account: (HTTPStatus.OK, {"deleted": store.reset(account)}))
            else:
                self._write(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def _method_not_allowed(self) -> None:
            self._write(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "method_not_allowed"})

        do_PUT = do_DELETE = do_PATCH = _method_not_allowed  # noqa: N815

        def _route(self) -> tuple[str, dict[str, list[str]]]:
            parts = urlsplit(self.path)
            return parts.path, parse_qs(parts.query, keep_blank_values=True)

        def _authenticated(self, action) -> None:
            cors: dict[str, str] = {}
            try:
                cors = auth.origin_policy.cors_headers(self.headers.get("Origin"))
                principal = auth.authenticate(
                    api_key=self.headers.get("X-Miniflux-API-Key"),
                    claimed_miniflux_base_url=self.headers.get("X-NewsFlux-Miniflux-Server"),
                    request_origin=self.headers.get("Origin"),
                    request_is_secure=self._request_is_secure(),
                )
                status, body = action(account_digest(principal.miniflux_base_url, principal.user_id))
            except AuthError as exc:
                self._write(HTTPStatus(exc.status_code), {"error": exc.code}, cors)
                return
            except Exception:  # never leak internals or client data
                LOGGER.exception("Reading signals request failed")
                self._write(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error"}, cors)
                return
            self._write(status, body, cors)

        def _signals(self, account: str):
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().casefold()
            if content_type != "application/json":
                return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "json_required"}
            raw_length = self.headers.get("Content-Length", "")
            if self.headers.get("Transfer-Encoding") or not raw_length.isdecimal():
                return HTTPStatus.LENGTH_REQUIRED, {"error": "length_required"}
            length = int(raw_length)
            if length > MAX_BODY_BYTES:
                return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "payload_too_large"}
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object)
                rows = parse_signals_payload(payload, today=today())
            except (UnicodeDecodeError, ValueError, PayloadError):
                return HTTPStatus.BAD_REQUEST, {"error": "invalid_signals"}
            return HTTPStatus.OK, {"accepted": store.add(account, rows)}

        def _affinity(self, account: str, query: dict[str, list[str]]):
            raw_feeds = query.get("feeds")
            if raw_feeds is not None:
                try:
                    items = [item for value in raw_feeds for item in value.split(",") if item]
                    feed_ids = {int(item) for item in items if item.isdecimal()}
                    # An empty list would purge every row; it is rejected, never read as "no feeds".
                    if not feed_ids or len(feed_ids) != len(set(items)) or len(feed_ids) > MAX_FEED_FILTER:
                        raise ValueError("invalid feeds")
                    if any(not 1 <= feed_id <= MAX_FEED_ID for feed_id in feed_ids):
                        raise ValueError("invalid feeds")
                except ValueError:
                    return HTTPStatus.BAD_REQUEST, {"error": "invalid_feeds"}
                store.purge_unsubscribed(account, feed_ids)
            store.prune(today())
            return HTTPStatus.OK, compute_affinity(store.counts(account), today=today())

        def _request_is_secure(self) -> bool:
            if isinstance(self.connection, ssl.SSLSocket):
                return True
            try:
                peer = ipaddress.ip_address(str(self.client_address[0])).compressed
            except ValueError:
                return False
            return peer in settings.trusted_proxy_ips and (
                self.headers.get("X-Forwarded-Proto", "").strip().casefold() == "https"
            )

        def _write(self, status: HTTPStatus, body: object, headers: dict[str, str] | None = None) -> None:
            self._last_status = int(status)
            data = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
            self.send_response(status)
            for name, value in {**_JSON_HEADERS, **(headers or {})}.items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def log_message(self, _format: str, *_args: object) -> None:
            # Route and status only: never query strings, headers or bodies.
            LOGGER.info(
                "Reading signals HTTP request",
                extra={"method": self.command, "path": self.path.split("?", 1)[0], "status": getattr(self, "_last_status", None)},
            )

    return ReadingSignalsHandler


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(message)s")
    if os.environ.get("READING_SIGNALS_ENABLED", "false").strip().casefold() != "true":
        raise SystemExit("Reading signals are disabled. Set READING_SIGNALS_ENABLED=true to start the service.")
    settings = ServerSettings.from_env()
    auth = MinifluxAuthService(AuthSettings.from_env())
    store = SignalStore(settings.database_path)
    server = ThreadingHTTPServer((settings.host, settings.port), make_handler(store=store, auth=auth, settings=settings))
    server.daemon_threads = True
    LOGGER.info("NewsFlux reading signals listening", extra={"host": settings.host, "port": settings.port})
    server.serve_forever()


if __name__ == "__main__":
    main()
