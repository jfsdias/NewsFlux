from __future__ import annotations

import unittest

from services.content_fallback import content as content_module
from services.content_fallback.content import assess_content
from services.content_fallback.http_client import FetchError, HTTPResponse, PinnedHTTPClient, UnsafeURL
from services.content_fallback.service import RecoveryError, WallHopProvider
from services.content_fallback.tests.test_service import entry, full_article_html


def wallhop_response(body: str, status: int = 200, content_type: str = "text/html; charset=utf-8") -> HTTPResponse:
    return HTTPResponse(status, {"content-type": content_type}, body.encode(), "https://wallhop.io/raw/encoded")


PROVIDER_FOOTER = (
    "Technical attribution: WaffleHacker and everywall maintain ladder, released under "
    "GPL-3.0, for the rendering service. Credits identify the intermediary version used "
    "to provide this captured article to the public reader."
)


class FakeTransport:
    def __init__(self, response: HTTPResponse | Exception) -> None:
        self.response = response
        self.calls: list[tuple[str, str]] = []

    def resolve(self, host: str, _port: int, _allow_private: bool = False) -> str:
        if host in {"127.0.0.1", "10.20.30.40"}:
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
    def test_article_title_named_wallhop_is_not_removed_as_provider_chrome(self) -> None:
        body = full_article_html().removeprefix("<article>").removesuffix("</article>")
        article = f"<article><h1>WallHop</h1>{body}</article>"

        cleaned, reason = content_module.clean_wallhop_content(article)

        self.assertEqual(reason, "no_provider_chrome")
        self.assertIn("<p>WallHop</p>", cleaned)

    def test_editorial_footer_with_all_provider_markers_is_not_removed(self) -> None:
        final_paragraph = (
            "The article's final section compares WaffleHacker, everywall, ladder, and "
            "GPL-3.0 as examples in the history of web publishing."
        )
        article = full_article_html() + f"<p>{final_paragraph}</p>"

        cleaned, reason = content_module.clean_wallhop_content(article)

        self.assertEqual(reason, "ambiguous_provider_chrome")
        self.assertIn(final_paragraph, cleaned)

    def test_isolated_provider_header_is_removed_after_fetch(self) -> None:
        page = "<p>wallhop</p>" + full_article_html()
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        result = provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertTrue(result.assessment.sufficient)
        self.assertNotIn("wallhop", result.assessment.safe_html.casefold())
        self.assertIn("Researchers reported", result.assessment.safe_html)
        self.assertEqual(result.assessment.safe_html, assess_content("Research Update", full_article_html()).safe_html)

    def test_specific_provider_footer_is_removed_without_dropping_newsletter(self) -> None:
        newsletter = (
            "<section><h2>More from the newsletter</h2>"
            "<p>Subscribers receive additional reporting, context, interviews, and analysis every week.</p></section>"
        )
        page = full_article_html() + f"<p>{PROVIDER_FOOTER}</p>" + newsletter
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        result = provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertTrue(result.assessment.sufficient)
        self.assertNotIn("wafflehacker", result.assessment.safe_html.casefold())
        self.assertNotIn("everywall", result.assessment.safe_html.casefold())
        self.assertNotIn("gpl-3.0", result.assessment.safe_html.casefold())
        self.assertIn("More from the newsletter", result.assessment.safe_html)
        self.assertIn("Subscribers receive additional reporting", result.assessment.safe_html)
        expected = assess_content(
            "Research Update",
            full_article_html() + newsletter,
        ).safe_html
        self.assertEqual(result.assessment.safe_html, expected)

    def test_legitimate_wallhop_and_open_source_mentions_are_preserved(self) -> None:
        prose = (
            "<p>The reporting discusses WallHop and open-source software, including a "
            "separate project licensed under GPL-3.0, as part of its account of web publishing.</p>"
        )
        page = full_article_html().replace("</article>", prose + "</article>")
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        result = provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertTrue(result.assessment.sufficient)
        self.assertIn("WallHop and open-source software", result.assessment.safe_html)
        self.assertIn("GPL-3.0", result.assessment.safe_html)

    def test_provider_chrome_cleanup_keeps_html_sanitization(self) -> None:
        page = (
            "<script>RAW_SCRIPT_SENTINEL</script><img src='https://tracker.invalid/pixel' "
            "onerror='RAW_EVENT_SENTINEL'><p>wallhop</p>"
            + full_article_html()
        )
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        result = provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertNotIn("<script", result.assessment.safe_html.casefold())
        self.assertNotIn("<img", result.assessment.safe_html.casefold())
        self.assertNotIn("onerror", result.assessment.safe_html.casefold())
        self.assertNotIn("RAW_SCRIPT_SENTINEL", result.assessment.safe_html)
        self.assertNotIn("RAW_EVENT_SENTINEL", result.assessment.safe_html)

    def test_ambiguous_footer_signature_is_rejected_without_partial_removal(self) -> None:
        ambiguous = "<p>WaffleHacker and everywall mention ladder tools in this report.</p>"
        transport = FakeTransport(wallhop_response(full_article_html() + ambiguous))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        with self.assertRaisesRegex(RecoveryError, "ambiguous_provider_chrome"):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertEqual(len(transport.calls), 2)

    def test_cleanup_is_idempotent(self) -> None:
        page = "<p>wallhop</p>" + full_article_html() + f"<p>{PROVIDER_FOOTER}</p>"

        cleaned, first_reason = content_module.clean_wallhop_content(page)
        repeated, second_reason = content_module.clean_wallhop_content(cleaned)

        self.assertEqual(first_reason, "provider_chrome_removed")
        self.assertEqual(second_reason, "no_provider_chrome")
        self.assertEqual(repeated, cleaned)

    def test_recovery_is_rejected_when_cleaned_article_fails_validation(self) -> None:
        sentence = "Researchers compared coastal sensor readings across three independent observation sites. "
        body = "<article>" + "".join(
            f"<p>Section {index}. {sentence * 4}</p>" for index in range(4)
        ) + "</article>"
        page = body + f"<p>{PROVIDER_FOOTER}</p>"
        self.assertTrue(assess_content("Research Update", page).sufficient)
        transport = FakeTransport(wallhop_response(page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        with self.assertRaisesRegex(RecoveryError, "short_or_partial_prose"):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))

        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_full_text_passes_validation(self) -> None:
        transport = FakeTransport(wallhop_response(full_article_html()))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        original = assess_content("Research Update", "<p>Short feed teaser.</p>")
        result = provider.recover(entry(), original)
        self.assertEqual(result.assessment.state, "SUFFICIENT")
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(
            transport.calls[0][0],
            "https://wallhop.io/raw/https://www.nytimes.com/2026/11/07/example-story.html",
        )

    def test_wallhop_url_uses_documented_raw_https_format(self) -> None:
        self.assertEqual(
            WallHopProvider._wallhop_url("https://example.com/article"),
            "https://wallhop.io/raw/https://example.com/article",
        )

    def test_wallhop_url_keeps_common_query_parameters_in_the_source_url(self) -> None:
        source = "https://example.com/article?id=42&utm_source=feed&view=full"
        self.assertEqual(
            WallHopProvider._wallhop_url(source),
            "https://wallhop.io/raw/https://example.com/article?id=42&utm_source=feed&view=full",
        )

    def test_wallhop_url_keeps_existing_escapes_and_fragment_is_removed(self) -> None:
        source = "https://example.com/a%2Fb?next=%3Fpage%3D2&label=a%26b#section"
        sanitized = WallHopProvider._source_url(source)
        self.assertEqual(sanitized, "https://example.com/a%2Fb?next=%3Fpage%3D2&label=a%26b")
        self.assertEqual(
            WallHopProvider._wallhop_url(sanitized),
            "https://wallhop.io/raw/https://example.com/a%2Fb?next=%3Fpage%3D2&label=a%26b",
        )

    def test_url_credentials_are_rejected_before_wallhop_request(self) -> None:
        transport = FakeTransport(wallhop_response(full_article_html()))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        protected = entry(url="https://reader:secret@example.com/article")
        with self.assertRaises(UnsafeURL):
            provider.recover(protected, assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(transport.calls, [])

    def test_private_and_loopback_source_destinations_are_blocked_before_wallhop(self) -> None:
        for address in ("127.0.0.1", "10.20.30.40"):
            with self.subTest(address=address):
                transport = FakeTransport(wallhop_response(full_article_html()))
                provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
                with self.assertRaises(UnsafeURL):
                    provider.recover(
                        entry(url=f"http://{address}/article"),
                        assess_content("Research Update", "<p>Short feed teaser.</p>"),
                    )
                self.assertEqual(transport.calls, [])

    def test_wallhop_partial_text_preserves_original(self) -> None:
        partial = "<article><p>" + ("The report includes a few early observations. " * 20) + "</p></article>"
        transport = FakeTransport(wallhop_response(partial))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)
        with self.assertRaises(RecoveryError):
            provider.recover(entry(), assess_content("Research Update", "<p>Short feed teaser.</p>"))
        self.assertEqual(len(transport.calls), 2)

    def test_wallhop_repeated_teaser_is_not_accepted_as_full_text(self) -> None:
        repeated_teaser = (
            "Researchers reported a brief coastal current change and said additional "
            "measurements will be reviewed during the next observation period."
        )
        repeated_page = "<article>" + "".join(
            f"<p>{repeated_teaser}</p>" for _ in range(12)
        ) + "</article>"
        transport = FakeTransport(wallhop_response(repeated_page))
        provider = WallHopProvider(http=transport.client(), sleep=lambda _seconds: None)

        with self.assertRaises(RecoveryError):
            provider.recover(
                entry(), assess_content("Research Update", "<p>Short feed teaser.</p>")
            )

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
