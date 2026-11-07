from __future__ import annotations

import unittest

from services.content_fallback.content import assess_content
from services.content_fallback.http_client import FetchError, HTTPResponse, PinnedHTTPClient, UnsafeURL
from services.content_fallback.service import RecoveryError, WallHopProvider
from services.content_fallback.tests.test_service import entry, full_article_html


def wallhop_response(body: str, status: int = 200, content_type: str = "text/html; charset=utf-8") -> HTTPResponse:
    return HTTPResponse(status, {"content-type": content_type}, body.encode(), "https://wallhop.io/raw/encoded")


class FakeTransport:
    def __init__(self, response: HTTPResponse | Exception) -> None:
        self.response = response
        self.calls: list[tuple[str, str]] = []

    def resolve(self, host: str, _port: int, _allow_private: bool = False) -> str:
        if host == "127.0.0.1":
            raise UnsafeURL("URL resolves to a non-public address")
        return "93.184.216.34"

    def request(self, url, pinned_ip, _port, _headers, _timeout, _max_bytes):
        self.calls.append((url, pinned_ip))
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def client(self) -> PinnedHTTPClient:
        return PinnedHTTPClient(resolver=self.resolve, requester=self.request)


class WallHopProviderTests(unittest.TestCase):
    def test_wallhop_full_text_passes_validation(self) -> None:
        transport = FakeTransport(wallhop_response(full_article_html()))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        original = assess_content("Research Update", "<p>Short feed teaser.</p>")
        result = provider.recover(entry(), original)
        self.assertEqual(result.assessment.state, "SUFFICIENT")
        self.assertEqual(len(transport.calls), 1)
        self.assertIn("https://wallhop.io/raw/https%3A%2F%2Fwww.nytimes.com%2F2026%2F11%2F07%2Fexample-story.html", transport.calls[0][0])

    def test_wallhop_partial_text_preserves_original(self) -> None:
        partial = "<article><p>" + ("The report includes a few early observations. " * 20) + "</p></article>"
        transport = FakeTransport(wallhop_response(partial))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(RecoveryError):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_block_page_http_200_is_rejected(self) -> None:
        page = "<main><h1>Just a moment</h1><p>Verify you are human to continue.</p></main>"
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(RecoveryError):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_timeout_fails_closed_after_bounded_attempts(self) -> None:
        transport = FakeTransport(FetchError("timeout"))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(RecoveryError):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_unavailable_fails_closed_after_bounded_attempts(self) -> None:
        transport = FakeTransport(HTTPResponse(503, {"content-type": "text/plain"}, b"unavailable", ""))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(RecoveryError):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_unsafe_redirect_is_blocked(self) -> None:
        transport = FakeTransport(HTTPResponse(302, {"location": "http://127.0.0.1/latest/meta-data/"}, b"", ""))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(UnsafeURL):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 1)

    def test_sensitive_source_url_is_never_sent_to_wallhop(self) -> None:
        transport = FakeTransport(wallhop_response(full_article_html()))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        protected = entry(url="https://www.nytimes.com/story?access_token=secret")
        with self.assertRaises(UnsafeURL):
            provider.recover(protected, assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(transport.calls, [])


if __name__ == "__main__":
    unittest.main()
