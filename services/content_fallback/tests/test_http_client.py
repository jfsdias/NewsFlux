from __future__ import annotations

import unittest

from services.content_fallback.http_client import HTTPResponse, PinnedHTTPClient, UnsafeURL


class PinnedHTTPClientTests(unittest.TestCase):
    def test_each_redirect_is_resolved_and_pinned(self) -> None:
        calls: list[tuple[str, str]] = []
        responses = [
            HTTPResponse(302, {"location": "https://cdn.example.test/article"}, b"", ""),
            HTTPResponse(200, {"content-type": "text/html"}, b"ok", ""),
        ]

        def resolver(host: str, _port: int, _allow_private: bool) -> str:
            return {"wallhop.io": "203.0.113.10", "cdn.example.test": "203.0.113.11"}[host]

        def requester(url, ip, _port, _headers, _timeout, _max_bytes):
            calls.append((url, ip))
            return responses.pop(0)

        client = PinnedHTTPClient(resolver=resolver, requester=requester)
        result = client.get("https://wallhop.io/raw/encoded", max_redirects=1)
        self.assertEqual(result.body, b"ok")
        self.assertEqual(calls[0][1], "203.0.113.10")
        self.assertEqual(calls[1][1], "203.0.113.11")

    def test_private_redirect_is_rejected_before_request(self) -> None:
        requested: list[str] = []

        def resolver(host: str, _port: int, _allow_private: bool) -> str:
            if host == "127.0.0.1":
                raise UnsafeURL("URL resolves to a non-public address")
            return "203.0.113.10"

        def requester(url, _ip, _port, _headers, _timeout, _max_bytes):
            requested.append(url)
            return HTTPResponse(302, {"location": "http://127.0.0.1/admin"}, b"", url)

        client = PinnedHTTPClient(resolver=resolver, requester=requester)
        with self.assertRaises(UnsafeURL):
            client.get("https://wallhop.io/raw/encoded")
        self.assertEqual(len(requested), 1)

    def test_miniflux_service_redirect_must_stay_on_configured_origin(self) -> None:
        calls: list[str] = []

        def requester(url, _ip, _port, _headers, _timeout, _max_bytes):
            calls.append(url)
            return HTTPResponse(302, {"location": "http://127.0.0.1/private"}, b"", url)

        client = PinnedHTTPClient(
            resolver=lambda *_args: "10.0.0.4",
            requester=requester,
        )
        with self.assertRaises(UnsafeURL):
            client.get(
                "http://miniflux:8080/v1/entries/42",
                headers={"X-Auth-Token": "token"},
                max_redirects=0,
                same_origin="http://miniflux:8080",
                allow_private_origin=True,
            )
        self.assertEqual(len(calls), 1)

    def test_response_size_is_checked_even_for_injected_transport(self) -> None:
        client = PinnedHTTPClient(
            resolver=lambda *_args: "203.0.113.10",
            requester=lambda url, *_args: HTTPResponse(200, {}, b"12345", url),
        )
        with self.assertRaisesRegex(Exception, "size limit"):
            client.get("https://wallhop.io/raw/x", max_bytes=4)

    def test_https_redirect_cannot_downgrade_to_http(self) -> None:
        client = PinnedHTTPClient(
            resolver=lambda *_args: "203.0.113.10",
            requester=lambda url, *_args: HTTPResponse(302, {"location": "http://wallhop.io/x"}, b"", url),
        )
        with self.assertRaisesRegex(UnsafeURL, "downgrade"):
            client.get("https://wallhop.io/raw/x")


if __name__ == "__main__":
    unittest.main()
