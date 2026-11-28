from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date
from http.server import ThreadingHTTPServer
from pathlib import Path

from services.article_intel_auth.auth import AuthenticatedPrincipal
from services.article_intel_auth.errors import AuthError
from services.article_intel_auth.origin import OriginPolicy
from services.reading_signals.server import ServerSettings, make_handler
from services.reading_signals.store import SignalStore

ORIGIN = "https://newsflux.example"
BASE = "https://miniflux.example"


class FakeAuth:
    def __init__(self) -> None:
        self.origin_policy = OriginPolicy([ORIGIN])
        self.calls = 0

    def authenticate(self, *, api_key, claimed_miniflux_base_url, request_origin, request_is_secure, **_):
        self.calls += 1
        if request_is_secure is not True:
            raise AuthError("https_required", 400)
        self.origin_policy.validate_origin(request_origin)
        if claimed_miniflux_base_url != BASE:
            raise AuthError("miniflux_origin_not_authorized", 403)
        users = {"key-user-1": 1, "key-user-2": 2}
        if api_key not in users:
            raise AuthError("unauthenticated", 401)
        return AuthenticatedPrincipal(miniflux_base_url=BASE, user_id=users[api_key], username="u", is_admin=False)


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SignalStore(Path(self.tmp.name) / "signals.sqlite3")
        self.auth = FakeAuth()
        handler = make_handler(
            store=self.store,
            auth=self.auth,
            settings=ServerSettings(trusted_proxy_ips=frozenset({"127.0.0.1"})),
            today=lambda: date(2026, 11, 28),
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, key="key-user-1", headers=None, raw=None):
        all_headers = {
            "Origin": ORIGIN,
            "X-Forwarded-Proto": "https",
            "X-NewsFlux-Miniflux-Server": BASE,
            **({"X-Miniflux-API-Key": key} if key else {}),
            **(headers or {}),
        }
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        if data is not None:
            all_headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=all_headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read() or b"null"), dict(response.headers)
        except urllib.error.HTTPError as error:
            with error:
                return error.code, json.loads(error.read() or b"null"), dict(error.headers)

    def post_rows(self, *rows, key="key-user-1"):
        return self.request("POST", "/v1/signals", {"schema": 1, "rows": list(rows)}, key=key)

    def test_healthz_needs_no_auth(self) -> None:
        status, body, _ = self.request("GET", "/healthz", key=None, headers={"Origin": ""})
        self.assertEqual((status, body), (200, {"status": "ok"}))

    def test_signals_round_trip_into_affinity_and_export(self) -> None:
        status, body, headers = self.post_rows(
            {"feed_id": 9, "day": "2026-11-28", "impressions": 40, "opens": 8, "read_to_end": 2, "stars": 0}
        )
        self.assertEqual((status, body), (200, {"accepted": 1}))
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(headers["Cache-Control"], "no-store")
        status, body, _ = self.request("GET", "/v1/affinity")
        self.assertEqual(status, 200)
        self.assertEqual(body["sources"][0]["feed_id"], 9)
        status, body, _ = self.request("GET", "/v1/export")
        self.assertEqual((status, body["schema"], len(body["rows"])), (200, 1, 1))

    def test_affinity_purges_unsubscribed_feeds(self) -> None:
        self.post_rows(
            {"feed_id": 1, "day": "2026-11-28", "impressions": 1, "opens": 0, "read_to_end": 0, "stars": 0},
            {"feed_id": 2, "day": "2026-11-28", "impressions": 1, "opens": 0, "read_to_end": 0, "stars": 0},
        )
        status, body, _ = self.request("GET", "/v1/affinity?feeds=2")
        self.assertEqual(status, 200)
        self.assertEqual([s["feed_id"] for s in body["sources"]], [2])
        self.assertEqual(self.request("GET", "/v1/affinity?feeds=2,x")[0], 400)
        self.assertEqual(self.request("GET", "/v1/affinity?feeds=")[0], 400)
        self.assertEqual(len(self.request("GET", "/v1/export")[1]["rows"]), 1)

    def test_entry_level_fields_are_rejected(self) -> None:
        status, body, _ = self.post_rows(
            {"feed_id": 1, "day": "2026-11-28", "impressions": 1, "opens": 0, "read_to_end": 0, "stars": 0, "entry_id": 5}
        )
        self.assertEqual((status, body["error"]), (400, "invalid_signals"))
        self.assertEqual(self.store.export(self._digest(1))["rows"], [])

    def test_accounts_are_isolated_and_reset_is_scoped(self) -> None:
        row = {"feed_id": 1, "day": "2026-11-28", "impressions": 3, "opens": 1, "read_to_end": 0, "stars": 0}
        self.post_rows(row, key="key-user-1")
        self.post_rows(row, key="key-user-2")
        status, body, _ = self.request("POST", "/v1/signals/reset", key="key-user-1")
        self.assertEqual((status, body), (200, {"deleted": 1}))
        self.assertEqual(self.request("GET", "/v1/export", key="key-user-1")[1]["rows"], [])
        self.assertEqual(len(self.request("GET", "/v1/export", key="key-user-2")[1]["rows"]), 1)

    def test_auth_failures(self) -> None:
        self.assertEqual(self.request("GET", "/v1/affinity", key="wrong")[0], 401)
        self.assertEqual(self.request("GET", "/v1/affinity", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("GET", "/v1/affinity", headers={"X-Forwarded-Proto": "http"})[0], 400)

    def test_untrusted_peer_cannot_claim_https(self) -> None:
        handler = make_handler(
            store=self.store,
            auth=self.auth,
            settings=ServerSettings(trusted_proxy_ips=frozenset({"10.0.0.1"})),
            today=lambda: date(2026, 11, 28),
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            self.base = f"http://127.0.0.1:{server.server_address[1]}"
            self.assertEqual(self.request("GET", "/v1/affinity")[0], 400)
        finally:
            server.shutdown()
            server.server_close()

    def test_body_limits_and_content_type(self) -> None:
        big = b'{"schema":1,"rows":[' + b" " * 70_000 + b"]}"
        self.assertEqual(self.request("POST", "/v1/signals", raw=big)[0], 413)
        status = self.request("POST", "/v1/signals", raw=b"{}", headers={"Content-Type": "text/plain"})[0]
        self.assertEqual(status, 415)
        dup = b'{"schema":1,"schema":1,"rows":[]}'
        self.assertEqual(self.request("POST", "/v1/signals", raw=dup)[0], 400)

    def test_preflight_and_unknown_routes(self) -> None:
        status, _, headers = self.request(
            "OPTIONS",
            "/v1/signals",
            key=None,
            headers={"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-miniflux-api-key"},
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], ORIGIN)
        self.assertEqual(self.request("GET", "/v1/unknown")[0], 404)
        self.assertEqual(self.request("DELETE", "/v1/signals")[0], 405)

    def _digest(self, user_id: int) -> str:
        from services.reading_signals.server import account_digest

        return account_digest(BASE, user_id)


if __name__ == "__main__":
    unittest.main()
