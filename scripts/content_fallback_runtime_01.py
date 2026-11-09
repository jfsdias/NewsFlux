#!/usr/bin/env python3
"""Run a loopback-only synthetic Content Fallback runtime rehearsal.

The Miniflux API is served by a local HTTP fixture and the WallHop provider is
replaced at the provider boundary. This script never contacts Miniflux, WallHop,
publishers, production services, or any host outside 127.0.0.1.
"""

from __future__ import annotations

import http.client
import json
import logging
import stat
import sys
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.content_fallback.content import assess_content
from services.content_fallback.http_client import PinnedHTTPClient
from services.content_fallback.miniflux import MinifluxClient
from services.content_fallback.policy import PolicyRegistry
from services.content_fallback.server import make_handler
from services.content_fallback.service import (
    ContentFallbackService,
    ProviderResult,
    RecoveryError,
)
from services.content_fallback.store import SQLiteRecoveryStore

MINIFLUX_TOKEN = "runtime-test-miniflux-token-do-not-use"
SERVICE_TOKEN = "runtime-test-content-token-do-not-use"
PUBLISHED_AT = "2026-11-09T12:00:00Z"
SHORT_CONTENT = (
    "<p>This syndicated excerpt introduces the report but omits the evidence, "
    "responses, and implementation details.</p>"
)
UPDATED_CONTENT = "<p>A newer synthetic feed version replaced the earlier excerpt.</p>"
RECOVERED_PARAGRAPHS = (
    "Residents received the revised transit proposal at a public meeting on Monday. "
    "The council described the route changes, estimated costs, and expected construction sequence.",
    "The plan adds more frequent service on the eastern corridor during weekday mornings. "
    "Officials said the adjustment follows six months of passenger counts and written feedback.",
    "The transportation department expects the first phase to begin after procurement is complete. "
    "A public progress report will be released before crews close any major road section.",
    "Several speakers asked how the schedule would affect nearby schools and small businesses. "
    "The project team said it will publish a detour map and hold another neighborhood session. "
    "Staff will also compare the proposed route with current bus connections and publish the methodology. "
    "Residents can submit corrections before the final construction calendar is approved.",
    "The council approved the proposal with a requirement to report delays and spending quarterly. "
    "Members may revise later phases if measured ridership differs from the published forecast.",
    "The department will compare service reliability before and after the changes take effect. "
    "The comparison will include missed trips, average waiting time, and public complaints.",
)
RECOVERED_HTML = "<article>" + "".join(
    f"<p>{paragraph}</p>" for paragraph in RECOVERED_PARAGRAPHS
) + "</article>"


def _entry(entry_id: int, *, url: str, content: str = SHORT_CONTENT) -> dict[str, object]:
    return {
        "id": entry_id,
        "feed_id": 501,
        "title": "Synthetic transit proposal coverage",
        "url": url,
        "published_at": PUBLISHED_AT,
        "status": "unread",
        "starred": False,
        "content": content,
    }


class _MinifluxState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.entries: dict[int, dict[str, object]] = {
            101: _entry(101, url="https://news.example.test/recovery"),
            102: _entry(102, url="https://news.example.test/incomplete"),
            103: _entry(103, url="https://news.example.test/stale"),
            104: _entry(104, url="https://disabled.example.test/story"),
            105: _entry(
                105,
                url="https://news.example.test/already-sufficient",
                content=RECOVERED_HTML,
            ),
        }
        self.get_requests = 0
        self.write_requests = 0
        self.invalid_auth_requests = 0

    def read_entry(self, entry_id: int) -> dict[str, object] | None:
        with self.lock:
            self.get_requests += 1
            value = self.entries.get(entry_id)
            return dict(value) if value is not None else None

    def replace_content(self, entry_id: int, content: str) -> None:
        with self.lock:
            self.entries[entry_id] = {**self.entries[entry_id], "content": content}


def _miniflux_handler(state: _MinifluxState):
    class MinifluxMockHandler(BaseHTTPRequestHandler):
        server_version = "SyntheticMiniflux/1"

        def _send_json(self, status: int, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.send_header("connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.headers.get("X-Auth-Token") != MINIFLUX_TOKEN:
                with state.lock:
                    state.invalid_auth_requests += 1
                self._send_json(401, {"error": "unauthorized"})
                return
            prefix = "/v1/entries/"
            if not self.path.startswith(prefix):
                self._send_json(404, {"error": "not_found"})
                return
            raw_id = self.path[len(prefix) :]
            if not raw_id.isdigit() or "/" in raw_id:
                self._send_json(404, {"error": "not_found"})
                return
            entry = state.read_entry(int(raw_id))
            if entry is None:
                self._send_json(404, {"error": "entry_not_found"})
                return
            self._send_json(200, entry)

        def do_POST(self) -> None:  # noqa: N802
            with state.lock:
                state.write_requests += 1
            self._send_json(405, {"error": "method_not_allowed"})

        do_PUT = do_POST
        do_PATCH = do_POST
        do_DELETE = do_POST

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return MinifluxMockHandler


class _MockWallHopProvider:
    def __init__(self, state: _MinifluxState, *, fail_entry_ids: set[int] | None = None) -> None:
        self.state = state
        self.fail_entry_ids = fail_entry_ids or set()
        self.calls: list[int] = []
        self.live_network_requests = 0

    def recover(self, entry, _original):
        self.calls.append(entry.id)
        if entry.id in self.fail_entry_ids:
            raise RecoveryError("short_or_partial_prose")
        if entry.id == 103:
            self.state.replace_content(entry.id, UPDATED_CONTENT)
        assessment = assess_content(entry.title, RECOVERED_HTML)
        return ProviderResult(
            assessment=assessment,
            fetched_at=datetime(2026, 11, 9, 12, tzinfo=timezone.utc).isoformat(),
            provider="wallhop.io",
        )


@contextmanager
def _running_server(server: ThreadingHTTPServer) -> Iterator[tuple[str, threading.Thread]]:
    if server.server_address[0] != "127.0.0.1":
        raise RuntimeError("runtime rehearsal must bind to IPv4 loopback")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", thread
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if thread.is_alive():
            raise RuntimeError("runtime rehearsal server did not stop")


def _request_json(
    base_url: str,
    method: str,
    path: str,
    *,
    token: str | None = None,
    body: bytes = b"",
) -> tuple[int, dict[str, object]]:
    port = int(base_url.rsplit(":", 1)[1])
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    headers = {"Content-Length": str(len(body))}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    try:
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            raise RuntimeError("runtime rehearsal received a non-object JSON response")
        return status, payload
    finally:
        connection.close()


def _make_policy(*, enabled: bool = True) -> PolicyRegistry:
    return PolicyRegistry.from_dict(
        {
            "enabled": enabled,
            "domains": {
                "news.example.test": {"state": "ON_DEMAND", "provider": "wallhop"},
                "disabled.example.test": {"state": "DISABLED", "provider": "wallhop"},
            },
        }
    )


def _make_content_service(
    miniflux: MinifluxClient,
    state: _MinifluxState,
    database_path: Path,
    provider: _MockWallHopProvider,
    *,
    policy_enabled: bool = True,
) -> tuple[ContentFallbackService, SQLiteRecoveryStore]:
    store = SQLiteRecoveryStore(database_path)
    service = ContentFallbackService(
        miniflux=miniflux,
        policies=_make_policy(enabled=policy_enabled),
        provider=provider,
        store=store,
    )
    return service, store


def run_runtime_rehearsal() -> dict[str, object]:
    state = _MinifluxState()
    miniflux_server = ThreadingHTTPServer(("127.0.0.1", 0), _miniflux_handler(state))
    miniflux_server.daemon_threads = True
    provider = _MockWallHopProvider(state, fail_entry_ids={102})
    log_stream = __import__("io").StringIO()
    log_handler = logging.StreamHandler(log_stream)
    loggers = [
        logging.getLogger("newsflux.content_fallback"),
        logging.getLogger("newsflux.content_fallback.http"),
    ]
    original_levels = [logger.level for logger in loggers]
    for logger in loggers:
        logger.addHandler(log_handler)
        logger.setLevel(logging.INFO)

    runtime_http_requests = 0
    successful_payload: dict[str, object] | None = None
    cache_payload: dict[str, object] | None = None
    fallback_payload: dict[str, object] | None = None
    stale_payload: dict[str, object] | None = None
    disabled_payload: dict[str, object] | None = None
    sufficient_payload: dict[str, object] | None = None
    database_path: Path | None = None
    database_permissions = 0
    stores: list[SQLiteRecoveryStore] = []
    app_servers: list[ThreadingHTTPServer] = []
    app_threads: list[threading.Thread] = []

    def start_app(service: ContentFallbackService) -> str:
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service, SERVICE_TOKEN))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        app_servers.append(server)
        app_threads.append(thread)
        if server.server_address[0] != "127.0.0.1":
            raise RuntimeError("service runtime escaped loopback binding")
        return f"http://127.0.0.1:{server.server_address[1]}"

    def stop_app(server: ThreadingHTTPServer, thread: threading.Thread) -> None:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        if thread.is_alive():
            raise RuntimeError("service runtime did not stop")
        app_servers.remove(server)
        app_threads.remove(thread)

    temp_directory = tempfile.TemporaryDirectory(prefix="newsflux-content-fallback-runtime-")
    try:
        with _running_server(miniflux_server):
            miniflux_url = f"http://127.0.0.1:{miniflux_server.server_address[1]}"
            miniflux = MinifluxClient(
                miniflux_url,
                MINIFLUX_TOKEN,
                http=PinnedHTTPClient(),
                timeout_seconds=3,
            )
            database_path = Path(temp_directory.name) / "data" / "runtime.sqlite3"
            service1, store1 = _make_content_service(
                miniflux, state, database_path, provider
            )
            stores.append(store1)
            base_url = start_app(service1)

            status, health = _request_json(base_url, "GET", "/healthz")
            runtime_http_requests += 1
            if not (
                status == 200
                and health.get("status") == "ok"
                and health.get("read_only") is True
                and health.get("persistent_cache") is True
                and health.get("preload_supported") is False
                and health.get("thirteen_ft_enabled") is False
            ):
                raise RuntimeError("health gate failed")

            gets_before_unauthorized = state.get_requests
            status, unauthorized = _request_json(
                base_url, "POST", "/v1/entries/101/recover"
            )
            runtime_http_requests += 1
            if status != 401 or unauthorized.get("error") != "unauthorized":
                raise RuntimeError("service auth gate failed")
            if state.get_requests != gets_before_unauthorized:
                raise RuntimeError("unauthorized request reached Miniflux")

            status, rejected_body = _request_json(
                base_url,
                "POST",
                "/v1/entries/101/recover",
                token=SERVICE_TOKEN,
                body=b"{}",
            )
            runtime_http_requests += 1
            if status != 400 or rejected_body.get("error") != "request_body_not_allowed":
                raise RuntimeError("empty-body contract gate failed")

            status, successful_payload = _request_json(
                base_url,
                "POST",
                "/v1/entries/101/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if not (
                status == 200
                and successful_payload.get("status") == "recovered"
                and successful_payload.get("content_origin") == "wallhop"
                and successful_payload.get("entry_id") == 101
                and successful_payload.get("provenance", {}).get("provider") == "wallhop.io"
            ):
                raise RuntimeError("synthetic recovery gate failed")
            if "<article>" in str(successful_payload.get("content_html", "")):
                raise RuntimeError("sanitized content returned provider container markup")
            if successful_payload.get("validation", {}).get("state") != "SUFFICIENT":
                raise RuntimeError("content validation gate failed")

            database_permissions = stat.S_IMODE(database_path.stat().st_mode)
            if database_permissions != 0o600:
                raise RuntimeError("SQLite permissions gate failed")

            status, fallback_payload = _request_json(
                base_url,
                "POST",
                "/v1/entries/102/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if not (
                status == 200
                and fallback_payload.get("status") == "incomplete"
                and fallback_payload.get("content_origin") == "miniflux"
                and fallback_payload.get("content_html") == "<p>This syndicated excerpt introduces the report but omits the evidence, responses, and implementation details.</p>"
            ):
                raise RuntimeError("original-content fallback gate failed")

            status, stale_payload = _request_json(
                base_url,
                "POST",
                "/v1/entries/103/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if not (
                status == 200
                and stale_payload.get("status") == "stale"
                and stale_payload.get("content_html") == "<p>A newer synthetic feed version replaced the earlier excerpt.</p>"
            ):
                raise RuntimeError("stale-entry gate failed")

            calls_before_disabled = list(provider.calls)
            disabled_service, disabled_store = _make_content_service(
                miniflux,
                state,
                Path(temp_directory.name) / "disabled.sqlite3",
                provider,
                policy_enabled=False,
            )
            stores.append(disabled_store)
            disabled_url = start_app(disabled_service)
            status, disabled_payload = _request_json(
                disabled_url,
                "POST",
                "/v1/entries/104/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if status != 200 or disabled_payload.get("status") != "disabled":
                raise RuntimeError("default-disabled policy gate failed")
            if provider.calls != calls_before_disabled:
                raise RuntimeError("disabled policy invoked provider")
            disabled_server = app_servers[-1]
            disabled_thread = app_threads[-1]
            stop_app(disabled_server, disabled_thread)

            status, sufficient_payload = _request_json(
                base_url,
                "POST",
                "/v1/entries/105/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if status != 200 or sufficient_payload.get("status") != "original_sufficient":
                raise RuntimeError("sufficient-original short circuit gate failed")
            if 105 in provider.calls:
                raise RuntimeError("sufficient original content invoked provider")

            service1_server = app_servers[-1]
            service1_thread = app_threads[-1]
            stop_app(service1_server, service1_thread)
            store1.close()
            stores.remove(store1)

            provider_after_restart = _MockWallHopProvider(state)
            service2, store2 = _make_content_service(
                miniflux, state, database_path, provider_after_restart
            )
            stores.append(store2)
            base_url2 = start_app(service2)
            status, cache_payload = _request_json(
                base_url2,
                "POST",
                "/v1/entries/101/recover",
                token=SERVICE_TOKEN,
            )
            runtime_http_requests += 1
            if not (
                status == 200
                and cache_payload.get("status") == "recovered"
                and cache_payload.get("cache_hit") is True
                and provider_after_restart.calls == []
            ):
                raise RuntimeError("persistent-cache restart gate failed")

        log_output = log_stream.getvalue()
        if any(
            secret in log_output
            for secret in (MINIFLUX_TOKEN, SERVICE_TOKEN, "news.example.test", "synthetic recovered paragraph")
        ):
            raise RuntimeError("secret-redaction gate failed")
        if state.write_requests != 0:
            raise RuntimeError("Miniflux read-only gate failed")
        if provider.live_network_requests != 0:
            raise RuntimeError("WallHop mock made a live request")
        if any(server.server_address[0] != "127.0.0.1" for server in app_servers):
            raise RuntimeError("runtime server was not loopback-only")

        return {
            "runtime_gate": "PASS",
            "bind_host": "127.0.0.1",
            "health_gate": "PASS",
            "service_auth_gate": "PASS",
            "miniflux_read_only_gate": "PASS",
            "policy_gate": "PASS",
            "wallhop_mock_gate": "PASS",
            "content_validation_gate": "PASS",
            "fallback_gate": "PASS",
            "stale_entry_gate": "PASS",
            "sqlite_persistence_gate": "PASS",
            "sqlite_file_mode": f"{database_permissions:04o}",
            "secret_redaction_gate": "PASS",
            "loopback_http_requests": runtime_http_requests + state.get_requests,
            "miniflux_get_requests": state.get_requests,
            "miniflux_write_requests": state.write_requests,
            "wallhop_mock_calls": len(provider.calls),
            "wallhop_live_requests": provider.live_network_requests,
            "external_network_requests": 0,
        }
    finally:
        for server, thread in list(zip(app_servers, app_threads)):
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        for store in stores:
            store.close()
        miniflux_server.server_close()
        temp_directory.cleanup()
        for logger, level in zip(loggers, original_levels):
            logger.removeHandler(log_handler)
            logger.setLevel(level)
        log_handler.close()


def main() -> int:
    try:
        summary = run_runtime_rehearsal()
    except Exception:
        print(json.dumps({"runtime_gate": "FAIL", "reason": "synthetic_runtime_gate_failed"}))
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
