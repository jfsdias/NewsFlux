from __future__ import annotations

import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from services.content_fallback.server import make_handler


class FakeService:
    def __init__(self) -> None:
        self.calls: list[int] = []

    def recover(self, entry_id: int) -> dict[str, object]:
        self.calls.append(entry_id)
        return {"entry_id": entry_id, "status": "disabled", "content_html": "<p>Original</p>"}


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = FakeService()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service, "s" * 40))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def request(self, path: str, *, authorization: str = "", body: bytes = b""):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        headers = {"Authorization": authorization, "Content-Length": str(len(body))}
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        status = response.status
        payload = response.read()
        connection.close()
        return status, json.loads(payload)

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

    def test_invalid_entry_path_is_rejected(self) -> None:
        status, payload = self.request(
            "/v1/entries/0/recover",
            authorization="Bearer " + "s" * 40,
        )
        self.assertEqual(status, 404)
        self.assertEqual(payload["error"], "not_found")


if __name__ == "__main__":
    unittest.main()
