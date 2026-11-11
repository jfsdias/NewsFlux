from __future__ import annotations

import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from services.article_intel_auth.auth import AuthError
from services.article_intel_auth.origin import OriginPolicy
from services.content_fallback.miniflux import ReaderRecoveryScope
from services.content_fallback.server import make_handler


class FakeService:
    def __init__(self) -> None:
        self.calls: list[int] = []
        self.reader_scopes: list[ReaderRecoveryScope | None] = []

    def recover(
        self,
        entry_id: int,
        *,
        reader_scope: ReaderRecoveryScope | None = None,
    ) -> dict[str, object]:
        self.calls.append(entry_id)
        self.reader_scopes.append(reader_scope)
        return {"entry_id": entry_id, "status": "disabled", "content_html": "<p>Original</p>"}


class FakeReaderBridge:
    def __init__(self) -> None:
        self.auth = type(
            "AuthFixture",
            (),
            {"origin_policy": OriginPolicy(["https://newsflux.example"])},
        )()
        self.calls: list[dict[str, object]] = []

    def recover(self, **kwargs):
        if kwargs["request_is_secure"] is not True:
            raise AuthError("https_required", 400)
        self.auth.origin_policy.validate_origin(kwargs["request_origin"])
        self.calls.append(kwargs)
        return {"status": "recovered", "entry_id": kwargs["entry_id"]}


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = FakeService()
        self.reader_bridge = FakeReaderBridge()
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            make_handler(
                self.service,
                "s" * 40,
                reader_bridge=self.reader_bridge,
                reader_trusted_proxy_ips=frozenset({"127.0.0.1"}),
            ),
        )
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def request(
        self,
        path: str,
        *,
        authorization: str = "",
        body: bytes = b"",
        content_type: str | None = None,
    ):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        headers = {"Authorization": authorization, "Content-Length": str(len(body))}
        if content_type is not None:
            headers["Content-Type"] = content_type
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        payload = response.read()
        connection.close()
        return status, json.loads(payload)

    def reader_request(self, *, forwarded_proto: str = "https", origin: str = "https://newsflux.example"):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(
            "POST",
            "/reader/v1/entries/42/recover",
            body=b"",
            headers={
                "Content-Length": "0",
                "X-Miniflux-API-Key": "synthetic-key",
                "X-NewsFlux-Miniflux-Server": "https://miniflux.example",
                "Origin": origin,
                "X-Forwarded-Proto": forwarded_proto,
                "Authorization": "Bearer internal-service-token-must-not-be-used",
            },
        )
        response = connection.getresponse()
        status = response.status
        payload = response.read()
        headers = dict(response.getheaders())
        connection.close()
        return status, json.loads(payload), headers

    def test_service_authentication_is_required(self) -> None:
        status, payload = self.request("/v1/entries/42/recover")
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")
        self.assertEqual(self.service.calls, [])

    def test_entry_endpoint_rejects_request_body(self) -> None:
        status, payload = self.request(
            "/v1/entries/42/recover",
            authorization="Bearer " + "s" * 40,
            body=b"{}",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "request_body_not_allowed")
        self.assertEqual(self.service.calls, [])

    def test_authenticated_entry_recovery_is_posted_by_id(self) -> None:
        status, payload = self.request(
            "/v1/entries/42/recover",
            authorization="Bearer " + "s" * 40,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload["entry_id"], 42)
        self.assertEqual(self.service.calls, [42])

    def test_private_reader_scope_is_forwarded_only_after_exact_payload_validation(self) -> None:
        scope = ReaderRecoveryScope(
            entry_id=42,
            feed_id=7,
            url_fingerprint="a" * 64,
            title_sha256="b" * 64,
            content_sha256="c" * 64,
        )
        body = json.dumps({"reader_scope": scope.to_dict()}).encode()

        status, payload = self.request(
            "/v1/entries/42/recover",
            authorization="Bearer " + "s" * 40,
            body=body,
            content_type="application/json",
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["entry_id"], 42)
        self.assertEqual(self.service.calls, [42])
        self.assertEqual(self.service.reader_scopes, [scope])

    def test_private_reader_scope_rejects_mismatched_entry_and_unauthenticated_direct_access(self) -> None:
        scope = ReaderRecoveryScope(
            entry_id=43,
            feed_id=7,
            url_fingerprint="a" * 64,
            title_sha256="b" * 64,
            content_sha256="c" * 64,
        )
        body = json.dumps({"reader_scope": scope.to_dict()}).encode()

        status, payload = self.request(
            "/v1/entries/42/recover",
            authorization="Bearer " + "s" * 40,
            body=body,
            content_type="application/json",
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid_reader_scope")
        self.assertEqual(self.service.calls, [])

        status, payload = self.request(
            "/v1/entries/42/recover",
            body=json.dumps({"reader_scope": scope.to_dict()}).encode(),
            content_type="application/json",
        )
        self.assertEqual(status, 401)
        self.assertEqual(payload["error"], "unauthorized")
        self.assertEqual(self.service.calls, [])

    def test_invalid_entry_path_is_rejected(self) -> None:
        status, payload = self.request(
            "/v1/entries/0/recover",
            authorization="Bearer " + "s" * 40,
        )
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "not_found")

    def test_reader_route_requires_verified_https_proxy_and_exact_origin(self) -> None:
        status, payload, headers = self.reader_request(forwarded_proto="http")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "https_required")
        self.assertEqual(self.reader_bridge.calls, [])

        status, payload, _headers = self.reader_request(origin="https://attacker.example")
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "request_origin_not_allowed")
        self.assertEqual(self.reader_bridge.calls, [])

    def test_reader_route_forwards_only_miniflux_request_headers_and_adds_no_store_cors(self) -> None:
        status, payload, headers = self.reader_request()
        self.assertEqual(status, 200)
        self.assertEqual(payload, {"status": "recovered", "entry_id": 42})
        self.assertEqual(len(self.reader_bridge.calls), 1)
        call = self.reader_bridge.calls[0]
        self.assertEqual(call["api_key"], "synthetic-key")
        self.assertEqual(call["claimed_miniflux_base_url"], "https://miniflux.example")
        self.assertTrue(call["request_is_secure"])
        self.assertNotIn("internal-service-token-must-not-be-used", json.dumps(call))
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://newsflux.example")
        self.assertEqual(headers.get("Cache-Control"), "no-store")

    def test_reader_preflight_allows_only_the_configured_origin_and_headers(self) -> None:
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(
            "OPTIONS",
            "/reader/v1/entries/42/recover",
            headers={
                "Origin": "https://newsflux.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-miniflux-api-key,x-newsflux-miniflux-server",
            },
        )
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Access-Control-Allow-Origin"), "https://newsflux.example")
        response.read()
        connection.close()


if __name__ == "__main__":
    unittest.main()
