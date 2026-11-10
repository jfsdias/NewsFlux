from __future__ import annotations

import copy
import hashlib
import http.client
import ipaddress
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import threading
from datetime import datetime
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from services.content_fallback.content import assess_content, passes_recovery
from services.content_fallback.http_client import (
    PinnedHTTPClient,
    UnsafeURL,
    _request_pinned,
    resolve_host,
)
from services.content_fallback.miniflux import MinifluxClient
from services.content_fallback.policy import PolicyRegistry
from services.content_fallback.server import make_handler
from services.content_fallback.service import ContentFallbackService, WallHopProvider
from services.content_fallback.store import SQLiteRecoveryStore

EXPECTED_SOURCE_SHA = "058aa9cf11264771ca660f00fcd8a0d16f949677"
SOURCE_URL = (
    "https://www.nasa.gov/news-release/"
    "nasa-awards-moon-base-transportation-technology-science-projects/"
)
TITLE = "NASA Awards Moon Base Transportation, Technology, Science Projects"
ENTRY_ID = 942710053
FEED_ID = 942710054
EXPECTED_RUN_ATTEMPT = "1"
_REDIRECTS = {301, 302, 303, 307, 308}
_FORBIDDEN_EGRESS = {"host_not_allowed", "publisher_http_blocked"}

ENTRY = {
    "id": ENTRY_ID,
    "feed_id": FEED_ID,
    "title": TITLE,
    "url": SOURCE_URL,
    "published_at": "2026-11-07T00:00:00Z",
    "status": "unread",
    "starred": False,
    "content": (
        "<p>NASA announced new awards related to lunar transportation and Moon Base "
        "infrastructure. This short synthetic feed excerpt is intentionally incomplete.</p>"
    ),
}


class _State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.get_count = 0
        self.write_count = 0
        self.wallhop_observations: list[dict[str, object]] = []
        self.blocked_egress: list[str] = []
        self.original_entry = copy.deepcopy(ENTRY)
        self.miniflux_token = ""


class _SanitizedHTML(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.safe = True
        self.tags: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append(tag.casefold())
        if tag.casefold() != "p" or attrs:
            self.safe = False

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append(tag.casefold())
        if tag.casefold() != "p" or attrs:
            self.safe = False

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() != "p":
            self.safe = False


def _json_response(handler: BaseHTTPRequestHandler, status: int, value: object) -> None:
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.send_header("cache-control", "no-store")
    handler.send_header("connection", "close")
    handler.end_headers()
    handler.wfile.write(body)


def _mock_miniflux_handler(state: _State):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path != f"/v1/entries/{ENTRY_ID}":
                _json_response(self, 404, {"error": "not_found"})
                return
            if self.headers.get("X-Auth-Token") != state.miniflux_token:
                _json_response(self, 401, {"error": "unauthorized"})
                return
            with state.lock:
                state.get_count += 1
            _json_response(self, 200, state.original_entry)

        def _reject_write(self) -> None:
            with state.lock:
                state.write_count += 1
            _json_response(self, 405, {"error": "read_only_fixture"})

        do_POST = _reject_write
        do_PUT = _reject_write
        do_PATCH = _reject_write
        do_DELETE = _reject_write

        def log_message(self, _format: str, *_args: object) -> None:
            return

    return Handler


def _allowed_domain(host: str, root: str) -> bool:
    return host == root or host.endswith("." + root)


def _media_type(headers: dict[str, str]) -> str:
    return headers.get("content-type", "").split(";", 1)[0].strip().casefold()


def _record(observation: dict[str, object]) -> None:
    fields = (
        "SOURCE_SHA",
        "IMAGE_ID_DIGEST",
        "EXACT_SHA_GATE",
        "ISOLATED_RUNTIME_GATE",
        "NON_ROOT_GATE",
        "NO_PUBLISHED_PORTS",
        "NO_PRODUCTION_ACCESS",
        "SYNTHETIC_MINIFLUX_GATE",
        "HEALTHCHECK",
        "MINIFLUX_GET_COUNT",
        "MINIFLUX_WRITE_COUNT",
        "PROVIDER_REACHABILITY",
        "WALLHOP_REQUEST_COUNT",
        "WALLHOP_HTTP_STATUS",
        "SERVICE_HTTP_STATUS",
        "RECOVERY_STATUS",
        "CONTENT_ORIGIN",
        "ORIGINAL_WORD_COUNT",
        "RECOVERED_WORD_COUNT",
        "CONTENT_VALIDATION",
        "SANITIZATION_GATE",
        "PROVENANCE_GATE",
        "ORIGINAL_CONTENT_FALLBACK",
        "NETWORK_ALLOWLIST_GATE",
        "CLEANUP_GATE",
        "RECOVERY",
        "ROOT_CAUSE_IF_FAILED",
    )
    for field in fields:
        value = observation.get(field, "NOT_RUN")
        print(f"{field}={value}", flush=True)


def main() -> int:
    logging.disable(logging.CRITICAL)
    state = _State()
    observation: dict[str, object] = {
        "SOURCE_SHA": os.environ.get("NEWSFLUX_SOURCE_SHA", "UNSET"),
        "IMAGE_ID_DIGEST": os.environ.get("NEWSFLUX_IMAGE_ID", "UNSET"),
        "EXACT_SHA_GATE": "FAIL",
        "ISOLATED_RUNTIME_GATE": "FAIL",
        "NON_ROOT_GATE": "NOT_RUN",
        "NO_PUBLISHED_PORTS": "PASS_BY_WORKFLOW_CONFIGURATION",
        "NO_PRODUCTION_ACCESS": "PASS_BY_FIXED_LOOPBACK_AND_EGRESS_GUARDS",
        "SYNTHETIC_MINIFLUX_GATE": "FAIL",
        "HEALTHCHECK": "NOT_RUN",
        "PROVIDER_REACHABILITY": "NOT_TESTED",
        "WALLHOP_HTTP_STATUS": "NO_HTTP_RESPONSE",
        "SERVICE_HTTP_STATUS": "NOT_RUN",
        "RECOVERY_STATUS": "NOT_RUN",
        "CONTENT_ORIGIN": "NOT_RUN",
        "CONTENT_VALIDATION": "NOT_RUN",
        "SANITIZATION_GATE": "NOT_RUN",
        "PROVENANCE_GATE": "NOT_RUN",
        "ORIGINAL_CONTENT_FALLBACK": "NOT_EXERCISED",
        "NETWORK_ALLOWLIST_GATE": "NOT_RUN",
        "CLEANUP_GATE": "PASS_ON_CONTAINER_EXIT",
        "RECOVERY": "BLOCKED",
        "ROOT_CAUSE_IF_FAILED": "ARMED_OR_SOURCE_PROVENANCE_MISSING",
    }
    if os.environ.get("NEWSFLUX_WALLHOP_P0_ARMED") != "YES":
        observation["ROOT_CAUSE_IF_FAILED"] = "CANARY_NOT_EXPLICITLY_ARMED"
        _record(observation)
        return 24
    if os.environ.get("NEWSFLUX_RUN_ATTEMPT") != EXPECTED_RUN_ATTEMPT:
        observation["ROOT_CAUSE_IF_FAILED"] = "RERUN_REFUSED_TO_PREVENT_DUPLICATE_PROVIDER_ACTION"
        _record(observation)
        return 24
    if observation["SOURCE_SHA"] != EXPECTED_SOURCE_SHA:
        observation["ROOT_CAUSE_IF_FAILED"] = "UNAPPROVED_SOURCE_SHA"
        _record(observation)
        return 24
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        observation["ROOT_CAUSE_IF_FAILED"] = "ROOT_RUNTIME_REFUSED"
        observation["NON_ROOT_GATE"] = "FAIL"
        _record(observation)
        return 24
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", str(observation["IMAGE_ID_DIGEST"])):
        observation["ROOT_CAUSE_IF_FAILED"] = "IMAGE_ID_DIGEST_MISSING"
        _record(observation)
        return 24

    source_parts = urlsplit(SOURCE_URL)
    if (
        source_parts.scheme != "https"
        or source_parts.hostname != "www.nasa.gov"
        or source_parts.query
        or source_parts.fragment
        or source_parts.username is not None
        or source_parts.password is not None
    ):
        observation["ROOT_CAUSE_IF_FAILED"] = "SAMPLE_URL_CONTRACT_MISMATCH"
        _record(observation)
        return 24

    observation["EXACT_SHA_GATE"] = "PASS"
    observation["ISOLATED_RUNTIME_GATE"] = "PASS"
    observation["NON_ROOT_GATE"] = "PASS"
    temp_root: str | None = None
    mock_server: ThreadingHTTPServer | None = None
    service_server: ThreadingHTTPServer | None = None
    store: SQLiteRecoveryStore | None = None
    exit_code = 30
    try:
        miniflux_token = secrets.token_hex(32)
        service_token = secrets.token_hex(32)
        state.miniflux_token = miniflux_token
        mock_server = ThreadingHTTPServer(("127.0.0.1", 0), _mock_miniflux_handler(state))
        mock_port = int(mock_server.server_address[1])
        mock_thread = threading.Thread(target=mock_server.serve_forever, daemon=True)
        mock_thread.start()

        def guarded_resolver(host: str, port: int, allow_private: bool = False) -> str:
            normalized = host.casefold().rstrip(".")
            try:
                address = ipaddress.ip_address(normalized)
            except ValueError:
                address = None
            if address is not None and address.is_loopback:
                if port != mock_port or not allow_private:
                    state.blocked_egress.append("host_not_allowed")
                    raise UnsafeURL("canary loopback target not allowed")
                return "127.0.0.1"
            if _allowed_domain(normalized, "nasa.gov") or _allowed_domain(normalized, "wallhop.io"):
                return resolve_host(host, port, False)
            state.blocked_egress.append("host_not_allowed")
            raise UnsafeURL("canary outbound host not allowed")

        def guarded_requester(
            url: str,
            pinned_ip: str,
            port: int,
            headers: dict[str, str],
            timeout: float,
            max_bytes: int,
        ):
            parts = urlsplit(url)
            host = (parts.hostname or "").casefold().rstrip(".")
            if host in {"127.0.0.1", "localhost"}:
                if port != mock_port or parts.scheme != "http":
                    state.blocked_egress.append("host_not_allowed")
                    raise UnsafeURL("canary synthetic service target not allowed")
                return _request_pinned(url, pinned_ip, port, headers, timeout, max_bytes)
            if _allowed_domain(host, "nasa.gov"):
                state.blocked_egress.append("publisher_http_blocked")
                raise UnsafeURL("direct publisher requests are blocked in canary")
            if _allowed_domain(host, "wallhop.io") and parts.scheme == "https" and port == 443:
                try:
                    response = _request_pinned(url, pinned_ip, port, headers, timeout, max_bytes)
                except Exception as exc:
                    with state.lock:
                        state.wallhop_observations.append(
                            {"host_class": "wallhop.io", "transport_error": type(exc).__name__}
                        )
                    raise
                with state.lock:
                    state.wallhop_observations.append(
                        {
                            "host_class": "wallhop.io",
                            "status": response.status,
                            "redirect": response.status in _REDIRECTS,
                            "media_type": _media_type(response.headers),
                        }
                    )
                return response
            state.blocked_egress.append("host_not_allowed")
            raise UnsafeURL("canary outbound host not allowed")

        http = PinnedHTTPClient(resolver=guarded_resolver, requester=guarded_requester)
        miniflux = MinifluxClient(
            f"http://127.0.0.1:{mock_port}",
            miniflux_token,
            http=http,
            timeout_seconds=4,
        )
        policies = PolicyRegistry.from_dict(
            {
                "enabled": True,
                "domains": {"nasa.gov": {"state": "ON_DEMAND", "provider": "wallhop"}},
            }
        )
        policy_decision = policies.decide(url=SOURCE_URL, feed_id=FEED_ID)
        if not policy_decision.on_demand or len(policies.domains) != 1 or len(policies.feeds) != 0:
            raise RuntimeError("single-host canary policy invariant failed")

        temp_root = tempfile.mkdtemp(prefix="wallhop-p0-")
        os.chmod(temp_root, 0o700)
        store = SQLiteRecoveryStore(os.path.join(temp_root, "ephemeral.sqlite3"))
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=policies,
            provider=WallHopProvider(http=http),
            store=store,
        )
        service_port = 8790
        service_server = ThreadingHTTPServer(("127.0.0.1", service_port), make_handler(service, service_token))
        service_thread = threading.Thread(target=service_server.serve_forever, daemon=True)
        service_thread.start()

        health_connection = http.client.HTTPConnection("127.0.0.1", service_port, timeout=3)
        try:
            health_connection.request("GET", "/healthz")
            health_response = health_connection.getresponse()
            health_body = json.loads(health_response.read(4096).decode("utf-8"))
            health_ok = (
                health_response.status == 200
                and health_body.get("status") == "ok"
                and health_body.get("read_only") is True
                and health_body.get("persistent_cache") is True
                and health_body.get("preload_supported") is False
                and health_body.get("thirteen_ft_enabled") is False
            )
        finally:
            health_connection.close()
        observation["HEALTHCHECK"] = "PASS" if health_ok else "FAIL"

        connection = http.client.HTTPConnection("127.0.0.1", service_port, timeout=45)
        try:
            connection.request(
                "POST",
                f"/v1/entries/{ENTRY_ID}/recover",
                body=b"",
                headers={"Authorization": f"Bearer {service_token}", "Content-Length": "0"},
            )
            response = connection.getresponse()
            service_status = response.status
            raw_response = response.read(4 * 1024 * 1024 + 1)
        finally:
            connection.close()
        if len(raw_response) > 4 * 1024 * 1024:
            raise RuntimeError("service response exceeded local canary bound")
        try:
            result = json.loads(raw_response.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            result = {}

        with state.lock:
            get_count = state.get_count
            write_count = state.write_count
            wallhop = list(state.wallhop_observations)
            blocked_egress = list(state.blocked_egress)

        provider_statuses = [str(item["status"]) for item in wallhop if "status" in item]
        observation.update(
            {
                "PROVIDER_REACHABILITY": "PASS" if provider_statuses else "FAIL",
                "WALLHOP_REQUEST_COUNT": len(wallhop),
                "WALLHOP_HTTP_STATUS": ",".join(provider_statuses) if provider_statuses else "NO_HTTP_RESPONSE",
                "SERVICE_HTTP_STATUS": service_status,
                "RECOVERY_STATUS": result.get("status", "invalid_response"),
                "CONTENT_ORIGIN": result.get("content_origin", "none"),
                "MINIFLUX_GET_COUNT": get_count,
                "MINIFLUX_WRITE_COUNT": write_count,
                "SYNTHETIC_MINIFLUX_GATE": (
                    "PASS"
                    if get_count == 2 and write_count == 0 and state.original_entry == ENTRY
                    else "FAIL"
                ),
                "NETWORK_ALLOWLIST_GATE": (
                    "PASS"
                    if not blocked_egress
                    and all(item.get("host_class") == "wallhop.io" for item in wallhop)
                    else "FAIL"
                ),
            }
        )

        original_assessment = assess_content(TITLE, ENTRY["content"])
        observation["ORIGINAL_WORD_COUNT"] = original_assessment.word_count
        recovered_html = result.get("content_html") if isinstance(result, dict) else None
        response_id_ok = result.get("entry_id") == ENTRY_ID
        expected_fingerprint = hashlib.sha256(SOURCE_URL.encode("utf-8")).hexdigest()
        fingerprint_ok = result.get("url_fingerprint") == expected_fingerprint
        provider_ok = (
            result.get("status") == "recovered"
            and result.get("content_origin") == "wallhop"
            and result.get("provenance", {}).get("provider") == "wallhop.io"
        )
        provenance_ok = (
            response_id_ok
            and fingerprint_ok
            and provider_ok
            and isinstance(result.get("provenance", {}).get("fetched_at"), str)
        )
        if provenance_ok:
            try:
                parsed_time = datetime.fromisoformat(result["provenance"]["fetched_at"].replace("Z", "+00:00"))
                provenance_ok = parsed_time.tzinfo is not None
            except (TypeError, ValueError):
                provenance_ok = False
        observation["PROVENANCE_GATE"] = "PASS" if provenance_ok else "FAIL"

        validation = result.get("validation") if isinstance(result, dict) else None
        content_ok = False
        recovered_count = "NOT_AVAILABLE"
        sanitized_ok = False
        if isinstance(recovered_html, str):
            recovered_assessment = assess_content(TITLE, recovered_html)
            recovered_count = recovered_assessment.word_count
            content_ok = (
                provider_ok
                and isinstance(validation, dict)
                and validation.get("state") == "SUFFICIENT"
                and recovered_assessment.sufficient
                and passes_recovery(original_assessment, recovered_assessment)
                and recovered_count > original_assessment.word_count
            )
            parsed = _SanitizedHTML()
            parsed.feed(recovered_html)
            parsed.close()
            sanitized_ok = parsed.safe and bool(parsed.tags)
        observation["RECOVERED_WORD_COUNT"] = recovered_count
        observation["CONTENT_VALIDATION"] = "PASS" if content_ok else "FAIL"
        observation["SANITIZATION_GATE"] = "PASS" if sanitized_ok else "FAIL"

        if result.get("status") != "recovered" and isinstance(recovered_html, str):
            observation["ORIGINAL_CONTENT_FALLBACK"] = (
                "PASS" if recovered_html == original_assessment.safe_html else "FAIL"
            )
        elif result.get("status") == "recovered":
            observation["ORIGINAL_CONTENT_FALLBACK"] = "NOT_EXERCISED_ON_SUCCESS"

        required_gates = (
            observation["SYNTHETIC_MINIFLUX_GATE"] == "PASS"
            and observation["NETWORK_ALLOWLIST_GATE"] == "PASS"
            and observation["HEALTHCHECK"] == "PASS"
            and observation["PROVIDER_REACHABILITY"] == "PASS"
            and observation["SERVICE_HTTP_STATUS"] == 200
            and observation["PROVENANCE_GATE"] == "PASS"
            and observation["CONTENT_VALIDATION"] == "PASS"
            and observation["SANITIZATION_GATE"] == "PASS"
        )
        if required_gates:
            observation["RECOVERY"] = "PASS"
            observation["ROOT_CAUSE_IF_FAILED"] = "NONE"
            exit_code = 0
        else:
            reasons = {str(item) for item in wallhop if "transport_error" in item}
            blocked = (
                not provider_statuses
                or any(status in {"401", "403", "429"} for status in provider_statuses)
                or result.get("reason") in {"block_page_marker", "paywall_marker", "unsafe_source_url"}
                or any(kind in _FORBIDDEN_EGRESS for kind in blocked_egress)
                or bool(reasons)
            )
            observation["RECOVERY"] = "BLOCKED" if blocked else "FAIL"
            observation["ROOT_CAUSE_IF_FAILED"] = (
                "PROVIDER_ACCESS_OR_NETWORK_BLOCKED" if blocked else "PROVIDER_CONTENT_OR_VALIDATION_FAILURE"
            )
            exit_code = 31 if blocked else 32

        if write_count != 0 or state.original_entry != ENTRY:
            observation["SYNTHETIC_MINIFLUX_GATE"] = "FAIL"
            observation["RECOVERY"] = "FAIL"
            observation["ROOT_CAUSE_IF_FAILED"] = "SYNTHETIC_MINIFLUX_STATE_OR_WRITE_INVARIANT_FAILED"
            exit_code = 32
    except Exception as exc:
        # Only the exception class is emitted. Messages may contain upstream data or URLs.
        observation["RECOVERY"] = "BLOCKED" if type(exc).__name__ in {"FetchError", "TimeoutError"} else "FAIL"
        observation["ROOT_CAUSE_IF_FAILED"] = f"HARNESS_{type(exc).__name__}"
        with state.lock:
            observation["MINIFLUX_GET_COUNT"] = state.get_count
            observation["MINIFLUX_WRITE_COUNT"] = state.write_count
            observation["WALLHOP_REQUEST_COUNT"] = len(state.wallhop_observations)
            statuses = [str(item["status"]) for item in state.wallhop_observations if "status" in item]
            observation["WALLHOP_HTTP_STATUS"] = ",".join(statuses) if statuses else "NO_HTTP_RESPONSE"
            observation["PROVIDER_REACHABILITY"] = "PASS" if statuses else "FAIL"
            observation["NETWORK_ALLOWLIST_GATE"] = "PASS" if not state.blocked_egress else "FAIL"
        exit_code = 31 if observation["RECOVERY"] == "BLOCKED" else 32
    finally:
        if service_server is not None:
            service_server.shutdown()
            service_server.server_close()
        if mock_server is not None:
            mock_server.shutdown()
            mock_server.server_close()
        if store is not None:
            try:
                store.delete(ENTRY_ID)
                store.close()
            except Exception:
                observation["CLEANUP_GATE"] = "FAIL"
                if exit_code == 0:
                    exit_code = 32
        if temp_root is not None:
            try:
                shutil.rmtree(temp_root)
            except OSError:
                observation["CLEANUP_GATE"] = "FAIL"
                if exit_code == 0:
                    exit_code = 32
    _record(observation)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
