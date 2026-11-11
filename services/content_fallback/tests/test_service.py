from __future__ import annotations

import hashlib
import logging
import threading
import tempfile
import time
import unittest
from pathlib import Path

from services.content_fallback.content import assess_content
from services.content_fallback.http_client import HTTPResponse, PinnedHTTPClient, UnsafeURL
from services.content_fallback.miniflux import EntrySnapshot, ReaderRecoveryScope
from services.content_fallback.policy import DomainPolicy, PolicyRegistry
from services.content_fallback.service import (
    ContentFallbackService,
    MinifluxScraperProvider,
    ProviderResult,
    RecoveryError,
    WallHopProvider,
)
from services.content_fallback.store import MemoryRecoveryStore, SQLiteRecoveryStore, StoredRecovery

REAL_WALLHOP_FOOTER = (
    "☕ Help keep WallHop running on Ko-fi a wafflehacker.dev project Heavily modified "
    "and tuned by WaffleHacker, built on the open-source everywall/ladder (GPL-3.0)."
)


def full_article_html() -> str:
    return "<article>" + "".join(
        "<p>Researchers reported a clear change in the coastal current during the "
        f"observation period {index}. The team compared the readings with earlier "
        "measurements and found the same pattern across several independent sites. "
        "Analysts said the results need another season of study before broad conclusions "
        "can be made about the evidence.</p>"
        for index in range(8)
    ) + "</article>"


def _synthetic_legacy_article_paragraph(section: int) -> str:
    return (
        f"Section {section} reports that monitoring teams compared new coastal current "
        "readings with records from three independent observation sites. The measurements "
        "showed a consistent seasonal shift, while analysts emphasized that more fieldwork "
        "is needed before drawing broader conclusions about regional conditions."
    )


def synthetic_legacy_wallhop_cache_content() -> str:
    first_paragraph = _synthetic_legacy_article_paragraph(1)
    paragraphs = [
        first_paragraph,
        "wallhop",
        _synthetic_legacy_article_paragraph(3),
        first_paragraph,
        *(_synthetic_legacy_article_paragraph(section) for section in range(5, 44)),
        REAL_WALLHOP_FOOTER,
    ]
    return "".join(f"<p>{paragraph}</p>" for paragraph in paragraphs)


def entry(
    entry_id: int = 42,
    *,
    status: str = "unread",
    starred: bool = True,
    content: str = "<article><p>Short feed teaser.</p></article>",
    url: str = "https://www.nytimes.com/2026/11/07/example-story.html",
    user_id: int | None = None,
    feed_user_id: int | None = None,
) -> EntrySnapshot:
    return EntrySnapshot(
        id=entry_id,
        feed_id=7,
        title="Research Update",
        url=url,
        published_at="2026-11-07T10:00:00Z",
        status=status,
        starred=starred,
        content=content,
        user_id=user_id,
        feed_user_id=feed_user_id,
    )


class FakeMiniflux:
    def __init__(self, entries: dict[int, EntrySnapshot | list[EntrySnapshot]]) -> None:
        self.entries = entries
        self.calls: list[tuple[str, int]] = []
        self.urlrewrite_rules = ""
        self.scraped_content = full_article_html()
        self.native_calls: list[tuple[str, int]] = []

    def get_entry(self, entry_id: int) -> EntrySnapshot:
        self.calls.append(("GET", entry_id))
        value = self.entries[entry_id]
        if isinstance(value, list):
            if len(value) > 1:
                return value.pop(0)
            return value[0]
        return value

    def get_feed_urlrewrite_rules(self, feed_id: int) -> str:
        self.native_calls.append(("GET_FEED", feed_id))
        return self.urlrewrite_rules

    def fetch_entry_content(self, entry_id: int) -> str:
        self.native_calls.append(("GET_FETCH_CONTENT", entry_id))
        return self.scraped_content


class FakeScopedMiniflux(FakeMiniflux):
    def __init__(
        self,
        entries: dict[int, EntrySnapshot | list[EntrySnapshot]],
        *,
        user_id: int = 1,
        is_admin: bool = True,
    ) -> None:
        super().__init__(entries)
        self.identity = type(
            "IdentityFixture",
            (),
            {"id": user_id, "username": f"user-{user_id}", "is_admin": is_admin},
        )()
        self.identity_checks = 0

    def get_current_user_identity(self):
        self.identity_checks += 1
        return self.identity


def reader_scope(item: EntrySnapshot) -> ReaderRecoveryScope:
    return ReaderRecoveryScope(
        entry_id=item.id,
        feed_id=item.feed_id,
        url_fingerprint=hashlib.sha256(item.url.encode()).hexdigest(),
        title_sha256=hashlib.sha256(item.title.encode()).hexdigest(),
        content_sha256=hashlib.sha256(item.content.encode()).hexdigest(),
    )


class FakeProvider:
    def __init__(self, html: str | None = None, *, block: threading.Event | None = None) -> None:
        self.html = html or full_article_html()
        self.calls = 0
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()
        self.started = threading.Event()
        self.block = block

    def recover(self, item: EntrySnapshot, _original) -> ProviderResult:
        with self.lock:
            self.calls += 1
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            self.started.set()
        try:
            if self.block is not None:
                self.block.wait(2)
            assessment = assess_content(item.title, self.html)
            return ProviderResult(assessment=assessment, fetched_at="2026-11-07T00:00:00+00:00")
        finally:
            with self.lock:
                self.active -= 1


class PartialProvider:
    def recover(self, _item: EntrySnapshot, _original) -> ProviderResult:
        raise RecoveryError("short_or_partial_prose")


def enabled_registry() -> PolicyRegistry:
    return PolicyRegistry.from_dict(
        {
            "enabled": True,
            "domains": {"nytimes.com": {"state": "ON_DEMAND", "provider": "wallhop"}},
        }
    )


def native_registry() -> PolicyRegistry:
    return PolicyRegistry.from_dict(
        {"enabled": True, "feeds": {"7": {"state": "ON_DEMAND", "provider": "miniflux"}}}
    )


class ServiceTests(unittest.TestCase):
    def test_reader_scoped_recovery_supports_matching_admin_identity_and_owned_entry(self) -> None:
        item = entry(user_id=1, feed_user_id=1)
        miniflux = FakeScopedMiniflux({item.id: item})
        provider = FakeProvider()
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
        )

        result = service.recover(item.id, reader_scope=reader_scope(item))

        self.assertEqual(result["status"], "recovered")
        self.assertEqual(provider.calls, 1)
        self.assertGreaterEqual(miniflux.identity_checks, 1)
        self.assertEqual((item.status, item.starred), ("unread", True))

    def test_reader_scoped_recovery_preserves_matching_non_admin_identity(self) -> None:
        item = entry(user_id=7, feed_user_id=7)
        miniflux = FakeScopedMiniflux({item.id: item}, user_id=7, is_admin=False)
        provider = FakeProvider()

        result = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
        ).recover(item.id, reader_scope=reader_scope(item))

        self.assertEqual(result["status"], "recovered")
        self.assertEqual(provider.calls, 1)
        self.assertEqual((item.status, item.starred), ("unread", True))

    def test_reader_scoped_recovery_fails_closed_for_identity_or_ownership_mismatch(self) -> None:
        item = entry(user_id=1, feed_user_id=1)
        scope = reader_scope(item)
        cases = (
            (FakeScopedMiniflux({item.id: item}, user_id=2, is_admin=True), item),
            (FakeScopedMiniflux({item.id: entry(user_id=2, feed_user_id=2)}), item),
            (FakeScopedMiniflux({item.id: entry(user_id=1, feed_user_id=2)}), item),
            (FakeScopedMiniflux({item.id: entry(user_id=1, feed_user_id=1, url="https://example.org/other")}), item),
        )

        for miniflux, requested in cases:
            provider = FakeProvider()
            with self.subTest(identity=miniflux.identity.__dict__, item=miniflux.entries[item.id]), self.assertRaises(RecoveryError):
                ContentFallbackService(
                    miniflux=miniflux,
                    policies=enabled_registry(),
                    provider=provider,
                ).recover(requested.id, reader_scope=scope)
            self.assertEqual(provider.calls, 0)

    def test_reader_scoped_recovery_rejects_tampered_resource_fingerprints(self) -> None:
        item = entry(user_id=1, feed_user_id=1)
        scope = reader_scope(item)
        altered_scopes = (
            ReaderRecoveryScope(
                entry_id=scope.entry_id,
                feed_id=scope.feed_id + 1,
                url_fingerprint=scope.url_fingerprint,
                title_sha256=scope.title_sha256,
                content_sha256=scope.content_sha256,
            ),
            ReaderRecoveryScope(
                entry_id=scope.entry_id,
                feed_id=scope.feed_id,
                url_fingerprint="d" * 64,
                title_sha256=scope.title_sha256,
                content_sha256=scope.content_sha256,
            ),
            ReaderRecoveryScope(
                entry_id=scope.entry_id,
                feed_id=scope.feed_id,
                url_fingerprint=scope.url_fingerprint,
                title_sha256="e" * 64,
                content_sha256=scope.content_sha256,
            ),
            ReaderRecoveryScope(
                entry_id=scope.entry_id,
                feed_id=scope.feed_id,
                url_fingerprint=scope.url_fingerprint,
                title_sha256=scope.title_sha256,
                content_sha256="f" * 64,
            ),
        )

        for altered_scope in altered_scopes:
            provider = FakeProvider()
            with self.subTest(scope=altered_scope), self.assertRaises(RecoveryError):
                ContentFallbackService(
                    miniflux=FakeScopedMiniflux({item.id: item}),
                    policies=enabled_registry(),
                    provider=provider,
                ).recover(item.id, reader_scope=altered_scope)
            self.assertEqual(provider.calls, 0)

    def test_reader_scope_is_revalidated_after_provider_before_result_is_used(self) -> None:
        original = entry(user_id=1, feed_user_id=1)
        changed_owner = entry(user_id=2, feed_user_id=2)
        miniflux = FakeScopedMiniflux({original.id: [original, changed_owner]})
        provider = FakeProvider()

        result = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
        ).recover(original.id, reader_scope=reader_scope(original))

        self.assertNotEqual(result["status"], "recovered")
        self.assertEqual(provider.calls, 1)

    def test_reader_scope_revalidates_service_role_after_provider(self) -> None:
        item = entry(user_id=1, feed_user_id=1)

        class RoleChangesDuringRecovery(FakeScopedMiniflux):
            def get_current_user_identity(self):
                self.identity_checks += 1
                if self.identity_checks == 1:
                    return self.identity
                return type(
                    "IdentityFixture",
                    (),
                    {"id": self.identity.id, "username": self.identity.username, "is_admin": False},
                )()

        miniflux = RoleChangesDuringRecovery({item.id: item})
        provider = FakeProvider()
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
        ).recover(item.id, reader_scope=reader_scope(item))

        self.assertNotEqual(result["status"], "recovered")
        self.assertEqual(miniflux.identity_checks, 2)
        self.assertEqual(provider.calls, 1)

    def test_reader_scope_fingerprint_change_during_provider_is_not_cached_or_returned(self) -> None:
        original = entry(user_id=1, feed_user_id=1)
        changed = entry(
            user_id=1,
            feed_user_id=1,
            content="<article><p>Updated feed excerpt.</p></article>",
        )
        miniflux = FakeScopedMiniflux({original.id: [original, changed]})
        provider = FakeProvider()
        store = MemoryRecoveryStore()

        result = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
            store=store,
        ).recover(original.id, reader_scope=reader_scope(original))

        self.assertNotEqual(result["status"], "recovered")
        self.assertEqual(provider.calls, 1)
        self.assertIsNone(store.get(original.id, original.content_fingerprint))

    def test_persistent_reader_cache_is_partitioned_by_verified_miniflux_identity(self) -> None:
        first_item = entry(user_id=1, feed_user_id=1)
        second_item = entry(user_id=2, feed_user_id=2)
        self.assertEqual(first_item.content_fingerprint, second_item.content_fingerprint)

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "content-fallback.sqlite3"
            first_store = SQLiteRecoveryStore(path)
            first_provider = FakeProvider()
            first_result = ContentFallbackService(
                miniflux=FakeScopedMiniflux({first_item.id: first_item}, user_id=1, is_admin=True),
                policies=enabled_registry(),
                provider=first_provider,
                store=first_store,
            ).recover(first_item.id, reader_scope=reader_scope(first_item))
            self.assertEqual(first_result["status"], "recovered")
            first_store.close()

            second_store = SQLiteRecoveryStore(path)
            second_provider = FakeProvider()
            second_result = ContentFallbackService(
                miniflux=FakeScopedMiniflux({second_item.id: second_item}, user_id=2, is_admin=True),
                policies=enabled_registry(),
                provider=second_provider,
                store=second_store,
            ).recover(second_item.id, reader_scope=reader_scope(second_item))
            second_store.close()

        self.assertEqual(second_result["status"], "recovered")
        self.assertFalse(second_result["cache_hit"])
        self.assertEqual(second_provider.calls, 1)

    def test_persistent_reader_cache_is_reused_for_the_same_verified_identity(self) -> None:
        item = entry(user_id=1, feed_user_id=1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "content-fallback.sqlite3"
            first_store = SQLiteRecoveryStore(path)
            first_provider = FakeProvider()
            first_result = ContentFallbackService(
                miniflux=FakeScopedMiniflux({item.id: item}, user_id=1, is_admin=True),
                policies=enabled_registry(),
                provider=first_provider,
                store=first_store,
            ).recover(item.id, reader_scope=reader_scope(item))
            self.assertEqual(first_result["status"], "recovered")
            first_store.close()

            second_store = SQLiteRecoveryStore(path)
            second_provider = FakeProvider()
            second_result = ContentFallbackService(
                miniflux=FakeScopedMiniflux({item.id: item}, user_id=1, is_admin=True),
                policies=enabled_registry(),
                provider=second_provider,
                store=second_store,
            ).recover(item.id, reader_scope=reader_scope(item))
            second_store.close()

        self.assertEqual(second_result["status"], "recovered")
        self.assertTrue(second_result["cache_hit"])
        self.assertEqual(second_provider.calls, 0)

    def test_in_memory_reader_cache_is_partitioned_by_verified_miniflux_identity(self) -> None:
        first_item = entry(user_id=1, feed_user_id=1)
        second_item = entry(user_id=2, feed_user_id=2)
        miniflux = FakeScopedMiniflux({first_item.id: first_item}, user_id=1, is_admin=True)
        provider = FakeProvider()
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
        )

        first_result = service.recover(first_item.id, reader_scope=reader_scope(first_item))
        miniflux.identity = type(
            "IdentityFixture",
            (),
            {"id": 2, "username": "user-2", "is_admin": True},
        )()
        miniflux.entries[second_item.id] = second_item
        second_result = service.recover(second_item.id, reader_scope=reader_scope(second_item))

        self.assertEqual(first_result["status"], "recovered")
        self.assertEqual(second_result["status"], "recovered")
        self.assertFalse(second_result["cache_hit"])
        self.assertEqual(provider.calls, 2)

    def test_reader_recovery_requests_for_different_identities_are_not_deduplicated(self) -> None:
        first_item = entry(user_id=1, feed_user_id=1)
        second_item = entry(user_id=2, feed_user_id=2)
        miniflux = FakeScopedMiniflux({first_item.id: first_item}, user_id=1, is_admin=True)
        release_provider = threading.Event()
        provider = FakeProvider(block=release_provider)
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
            max_concurrent=2,
            max_concurrent_per_domain=2,
            follower_wait_seconds=0.2,
        )
        results: dict[str, dict[str, object]] = {}
        first = threading.Thread(
            target=lambda: results.__setitem__(
                "first", service.recover(first_item.id, reader_scope=reader_scope(first_item))
            )
        )
        first.start()
        self.assertTrue(provider.started.wait(1))

        miniflux.identity = type(
            "IdentityFixture",
            (),
            {"id": 2, "username": "user-2", "is_admin": True},
        )()
        miniflux.entries[second_item.id] = second_item
        second = threading.Thread(
            target=lambda: results.__setitem__(
                "second", service.recover(second_item.id, reader_scope=reader_scope(second_item))
            )
        )
        second.start()

        deadline = time.monotonic() + 1
        while provider.calls < 2 and time.monotonic() < deadline:
            time.sleep(0.005)
        distinct_provider_call_started = provider.calls == 2
        release_provider.set()
        first.join(2)
        second.join(2)

        self.assertTrue(distinct_provider_call_started)
        self.assertEqual(results["first"]["status"], "stale")
        self.assertEqual(results["second"]["status"], "recovered")

    def test_miniflux_scraper_rejects_repeated_teaser_inflation(self) -> None:
        item = entry()
        repeated_teaser = (
            "Researchers reported a brief coastal current change and said additional "
            "measurements will be reviewed during the next observation period."
        )
        miniflux = FakeMiniflux({item.id: item})
        miniflux.scraped_content = "<article>" + "".join(
            f"<p>{repeated_teaser}</p>" for _ in range(12)
        ) + "</article>"
        provider = MinifluxScraperProvider(
            miniflux, resolver=lambda _host, _port, _private: "93.184.216.34"
        )

        with self.assertRaises(RecoveryError):
            provider.recover(
                item, assess_content(item.title, "<p>Short feed teaser.</p>")
            )

        self.assertEqual(
            [call[0] for call in miniflux.native_calls],
            ["GET_FEED", "GET_FETCH_CONTENT", "GET_FEED"],
        )

    def test_real_topology_legacy_cache_is_cleaned_and_reused_without_provider_call(self) -> None:
        item = entry(entry_id=26626)
        contaminated = synthetic_legacy_wallhop_cache_content()
        paragraphs = [
            paragraph.removeprefix("<p>").removesuffix("</p>")
            for paragraph in contaminated.split("</p>")
            if paragraph
        ]
        self.assertEqual(len(paragraphs), 44)
        self.assertEqual(paragraphs[1], "wallhop")
        self.assertEqual(paragraphs[0], paragraphs[3])
        self.assertEqual(paragraphs[-1], REAL_WALLHOP_FOOTER)
        old_assessment = assess_content(item.title, contaminated)
        self.assertTrue(old_assessment.sufficient)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "synthetic-content-cache.sqlite3"
            initial = SQLiteRecoveryStore(path)
            initial.put(
                item.id,
                item.content_fingerprint,
                StoredRecovery(
                    source_fingerprint=item.content_fingerprint,
                    content_html=old_assessment.safe_html,
                    validation=old_assessment.public_dict(),
                    provider="wallhop.io",
                    fetched_at="2026-11-07T00:00:00+00:00",
                ),
            )
            initial.close()

            store = SQLiteRecoveryStore(path)
            provider = FakeProvider()
            result = ContentFallbackService(
                miniflux=FakeMiniflux({item.id: item}),
                policies=enabled_registry(),
                provider=provider,
                store=store,
            ).recover(item.id)

            self.assertEqual(result["status"], "recovered")
            self.assertEqual(result["content_origin"], "wallhop")
            self.assertTrue(result["cache_hit"])
            self.assertNotIn("wallhop", result["content_html"].casefold())
            self.assertNotIn("wafflehacker", result["content_html"].casefold())
            self.assertNotIn("ko-fi", result["content_html"].casefold())
            self.assertEqual(result["validation"]["state"], "SUFFICIENT")
            self.assertEqual(result["content_html"].count(f"<p>{paragraphs[0]}</p>"), 2)
            self.assertIn("Section 43 reports", result["content_html"])
            self.assertEqual(provider.calls, 0)
            legacy_row = store.get(item.id, item.content_fingerprint)
            self.assertIsNotNone(legacy_row)
            self.assertEqual(legacy_row.content_html, old_assessment.safe_html)
            store.close()

    def test_insufficient_legacy_cache_falls_back_without_returning_provider_chrome(self) -> None:
        item = entry()
        sentence = "Researchers compared coastal sensor readings across three independent observation sites. "
        body = "<article>" + "".join(
            f"<p>Section {index}. {sentence * 4}</p>" for index in range(4)
        ) + "</article>"
        old_content = body + f"<p>{REAL_WALLHOP_FOOTER}</p>"
        old_assessment = assess_content(item.title, old_content)
        self.assertTrue(old_assessment.sufficient)
        store = MemoryRecoveryStore()
        store.put(
            item.id,
            item.content_fingerprint,
            StoredRecovery(
                source_fingerprint=item.content_fingerprint,
                content_html=old_assessment.safe_html,
                validation=old_assessment.public_dict(),
                provider="wallhop.io",
                fetched_at="2026-11-07T00:00:00+00:00",
            ),
        )

        result = ContentFallbackService(
            miniflux=FakeMiniflux({item.id: item}),
            policies=enabled_registry(),
            provider=PartialProvider(),
            store=store,
        ).recover(item.id)

        self.assertEqual((result["status"], result["reason"]), ("incomplete", "short_or_partial_prose"))
        self.assertEqual(result["content_origin"], "miniflux")
        self.assertNotIn("wafflehacker", result["content_html"].casefold())
        self.assertIsNone(store.get(item.id, item.content_fingerprint))

    def test_ambiguous_legacy_cache_is_rejected_and_reason_is_logged(self) -> None:
        item = entry()
        ambiguous = full_article_html() + (
            "<p>WaffleHacker and everywall mention ladder tools in this report.</p>"
        )
        assessment = assess_content(item.title, ambiguous)
        store = MemoryRecoveryStore()
        store.put(
            item.id,
            item.content_fingerprint,
            StoredRecovery(
                source_fingerprint=item.content_fingerprint,
                content_html=assessment.safe_html,
                validation=assessment.public_dict(),
                provider="wallhop.io",
                fetched_at="2026-11-07T00:00:00+00:00",
            ),
        )

        service = ContentFallbackService(
            miniflux=FakeMiniflux({item.id: item}),
            policies=enabled_registry(),
            provider=PartialProvider(),
            store=store,
        )
        with self.assertLogs("newsflux.content_fallback", level=logging.WARNING) as logs:
            result = service.recover(item.id)

        self.assertEqual((result["status"], result["content_origin"]), ("incomplete", "miniflux"))
        self.assertNotIn("wafflehacker", result["content_html"].casefold())
        self.assertIn(
            "ambiguous_provider_chrome",
            [getattr(record, "reason", None) for record in logs.records],
        )
        rendered_logs = "\n".join(logs.output)
        self.assertIn("ambiguous_provider_chrome", rendered_logs)
        self.assertNotIn("WaffleHacker", rendered_logs)

    def test_provider_failure_logs_hide_source_url_token_and_source_html(self) -> None:
        item = entry(url="https://www.nytimes.com/story/URL_SENTINEL?ref=QUERY_SENTINEL")
        source_html_sentinel = "SOURCE_HTML_SECRET_SENTINEL TOKEN_SENTINEL"
        request_urls: list[str] = []

        def request(url, pinned_ip, port, headers, timeout, max_bytes):
            del pinned_ip, port, headers, timeout, max_bytes
            request_urls.append(url)
            return HTTPResponse(
                200,
                {"content-type": "text/html"},
                f"<p>{source_html_sentinel}</p>".encode(),
                url,
            )

        http = PinnedHTTPClient(
            resolver=lambda _host, _port, _private: "93.184.216.34",
            requester=request,
        )
        provider = WallHopProvider(http=http, sleep=lambda _seconds: None)
        service = ContentFallbackService(
            miniflux=FakeMiniflux({item.id: item}),
            policies=enabled_registry(),
            provider=provider,
        )

        with self.assertLogs("newsflux.content_fallback", level=logging.INFO) as logs:
            result = service.recover(item.id)

        rendered_logs = "\n".join(logs.output)
        self.assertEqual(result["status"], "incomplete")
        for secret in ("URL_SENTINEL", "QUERY_SENTINEL", "SOURCE_HTML_SECRET_SENTINEL", "TOKEN_SENTINEL"):
            self.assertNotIn(secret, rendered_logs)

        protected_item = entry(entry_id=43, url="https://www.nytimes.com/story?access_token=URL_TOKEN_SENTINEL")
        protected_service = ContentFallbackService(
            miniflux=FakeMiniflux({protected_item.id: protected_item}),
            policies=enabled_registry(),
            provider=provider,
        )
        with self.assertLogs("newsflux.content_fallback", level=logging.INFO) as protected_logs:
            protected_service.recover(protected_item.id)
        self.assertNotIn("URL_TOKEN_SENTINEL", "\n".join(protected_logs.output))
        self.assertEqual(len(request_urls), 2, "sensitive source URLs must never reach the transport")

    def test_public_feed_uses_miniflux_native_scraper_on_demand(self) -> None:
        item = entry(url="https://public-feed.example.org/story")
        miniflux = FakeMiniflux({item.id: item})
        wallhop = FakeProvider()
        native = MinifluxScraperProvider(miniflux, resolver=lambda _host, _port, _private: "93.184.216.34")
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=native_registry(),
            provider=wallhop,
            miniflux_provider=native,
        ).recover(item.id)
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["content_origin"], "miniflux_scraper")
        self.assertEqual(result["provenance"]["provider"], "miniflux")
        self.assertEqual(
            miniflux.native_calls,
            [("GET_FEED", 7), ("GET_FETCH_CONTENT", item.id), ("GET_FEED", 7)],
        )
        self.assertEqual(wallhop.calls, 0)

    def test_native_scraper_refuses_feed_url_rewrite_rules(self) -> None:
        item = entry(url="https://public-feed.example.org/story")
        miniflux = FakeMiniflux({item.id: item})
        miniflux.urlrewrite_rules = "rewrite original URL"
        native = MinifluxScraperProvider(miniflux, resolver=lambda _host, _port, _private: "93.184.216.34")
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=native_registry(),
            miniflux_provider=native,
        ).recover(item.id)
        self.assertEqual(result["status"], "skipped_security")
        self.assertEqual(result["reason"], "miniflux_url_rewrite_rules_present")
        self.assertEqual(miniflux.native_calls, [("GET_FEED", 7)])
        self.assertEqual(result["content_origin"], "miniflux")

    def test_native_scraper_discards_result_if_url_rewrite_rules_change(self) -> None:
        item = entry(url="https://public-feed.example.org/story")

        class ChangingFeedRules(FakeMiniflux):
            def __init__(self, entries):
                super().__init__(entries)
                self.rule_reads = 0

            def get_feed_urlrewrite_rules(self, feed_id: int) -> str:
                self.native_calls.append(("GET_FEED", feed_id))
                self.rule_reads += 1
                return "" if self.rule_reads == 1 else "new rewrite rule"

        miniflux = ChangingFeedRules({item.id: item})
        native = MinifluxScraperProvider(miniflux, resolver=lambda _host, _port, _private: "93.184.216.34")
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=native_registry(),
            miniflux_provider=native,
        ).recover(item.id)
        self.assertEqual(result["status"], "skipped_security")
        self.assertEqual(result["reason"], "miniflux_url_rewrite_rules_changed")
        self.assertEqual(
            miniflux.native_calls,
            [("GET_FEED", 7), ("GET_FETCH_CONTENT", item.id), ("GET_FEED", 7)],
        )
        self.assertEqual(result["content_origin"], "miniflux")

    def test_native_scraper_refuses_non_public_source_address(self) -> None:
        item = entry(url="https://public-feed.example.org/story")
        miniflux = FakeMiniflux({item.id: item})

        def private_resolver(_host: str, _port: int, _allow_private: bool) -> str:
            raise UnsafeURL("private network host")

        native = MinifluxScraperProvider(miniflux, resolver=private_resolver)
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=native_registry(),
            miniflux_provider=native,
        ).recover(item.id)
        self.assertEqual(result["status"], "skipped_security")
        self.assertEqual(result["reason"], "unsafe_source_url")
        self.assertEqual(miniflux.native_calls, [])

    def test_saved_recovery_is_reused_by_a_new_service_instance(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "content-fallback.sqlite3"
            first_store = SQLiteRecoveryStore(path)
            first_provider = FakeProvider()
            first = ContentFallbackService(
                miniflux=miniflux,
                policies=enabled_registry(),
                provider=first_provider,
                store=first_store,
            ).recover(item.id)
            self.assertEqual(first["status"], "recovered")
            first_store.close()

            second_store = SQLiteRecoveryStore(path)
            second_provider = FakeProvider()
            second = ContentFallbackService(
                miniflux=miniflux,
                policies=enabled_registry(),
                provider=second_provider,
                store=second_store,
            ).recover(item.id)
            self.assertEqual(second["status"], "recovered")
            self.assertTrue(second["cache_hit"])
            self.assertEqual(second_provider.calls, 0)
            second_store.close()

    def test_persisted_wallhop_recovery_is_not_reused_for_miniflux_policy(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "content-fallback.sqlite3"
            first_store = SQLiteRecoveryStore(path)
            first = ContentFallbackService(
                miniflux=miniflux,
                policies=enabled_registry(),
                provider=FakeProvider(),
                store=first_store,
            ).recover(item.id)
            self.assertEqual(first["status"], "recovered")
            first_store.close()

            second_store = SQLiteRecoveryStore(path)
            native = MinifluxScraperProvider(
                miniflux,
                resolver=lambda _host, _port, _allow_private: "93.184.216.34",
            )
            second = ContentFallbackService(
                miniflux=miniflux,
                policies=native_registry(),
                miniflux_provider=native,
                store=second_store,
            ).recover(item.id)
            self.assertEqual(second["status"], "recovered")
            self.assertEqual(second["provenance"]["provider"], "miniflux")
            self.assertFalse(second["cache_hit"])
            self.assertEqual(miniflux.native_calls[1], ("GET_FETCH_CONTENT", item.id))
            second_store.close()

    def test_persisted_miniflux_recovery_is_not_reused_for_wallhop_policy(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "content-fallback.sqlite3"
            first_store = SQLiteRecoveryStore(path)
            native = MinifluxScraperProvider(
                miniflux,
                resolver=lambda _host, _port, _allow_private: "93.184.216.34",
            )
            first = ContentFallbackService(
                miniflux=miniflux,
                policies=native_registry(),
                miniflux_provider=native,
                store=first_store,
            ).recover(item.id)
            self.assertEqual(first["status"], "recovered")
            first_store.close()

            second_store = SQLiteRecoveryStore(path)
            wallhop = FakeProvider()
            second = ContentFallbackService(
                miniflux=miniflux,
                policies=enabled_registry(),
                provider=wallhop,
                store=second_store,
            ).recover(item.id)
            self.assertEqual(second["status"], "recovered")
            self.assertEqual(second["provenance"]["provider"], "wallhop.io")
            self.assertFalse(second["cache_hit"])
            self.assertEqual(wallhop.calls, 1)
            second_store.close()

    def test_disabled_policy_blocks_and_invalidates_persisted_recovery(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        store = MemoryRecoveryStore()
        ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=FakeProvider(),
            store=store,
        ).recover(item.id)
        disabled = PolicyRegistry.from_dict(
            {"enabled": True, "domains": {"nytimes.com": {"state": "DISABLED"}}}
        )
        blocked_provider = FakeProvider()
        blocked = ContentFallbackService(
            miniflux=miniflux,
            policies=disabled,
            provider=blocked_provider,
            store=store,
        ).recover(item.id)
        self.assertEqual(blocked["status"], "disabled")
        self.assertEqual(blocked_provider.calls, 0)

        next_provider = FakeProvider()
        retried = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=next_provider,
            store=store,
        ).recover(item.id)
        self.assertEqual(retried["status"], "recovered")
        self.assertFalse(retried["cache_hit"])
        self.assertEqual(next_provider.calls, 1)

    def test_saved_recovery_is_invalidated_when_miniflux_content_changes(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        store = MemoryRecoveryStore()
        ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=FakeProvider(),
            store=store,
        ).recover(item.id)

        refreshed = entry(content="<article><p>Refreshed short feed excerpt.</p></article>")
        miniflux.entries[item.id] = refreshed
        provider = FakeProvider()
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
            store=store,
        ).recover(item.id)
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(provider.calls, 1)

    def test_original_sufficient_content_skips_wallhop(self) -> None:
        item = entry(content=full_article_html())
        miniflux = FakeMiniflux({item.id: item})
        provider = FakeProvider()
        result = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider).recover(item.id)
        self.assertEqual(result["status"], "original_sufficient")
        self.assertEqual(provider.calls, 0)
        self.assertEqual(len(miniflux.calls), 1)

    def test_unknown_domain_does_not_call_provider(self) -> None:
        item = entry(url="https://unknown.example.org/story")
        miniflux = FakeMiniflux({item.id: item})
        provider = FakeProvider()
        result = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider).recover(item.id)
        self.assertEqual((result["status"], result["reason"]), ("disabled", "unknown_domain"))
        self.assertEqual(provider.calls, 0)

    def test_disabled_domain_does_not_call_provider(self) -> None:
        policies = PolicyRegistry.from_dict(
            {"enabled": True, "domains": {"nytimes.com": {"state": "DISABLED"}}}
        )
        miniflux = FakeMiniflux({42: entry()})
        provider = FakeProvider()
        result = ContentFallbackService(miniflux=miniflux, policies=policies, provider=provider).recover(42)
        self.assertEqual((result["status"], result["reason"]), ("disabled", "domain_disabled"))
        self.assertEqual(provider.calls, 0)

    def test_global_default_is_disabled(self) -> None:
        miniflux = FakeMiniflux({42: entry()})
        provider = FakeProvider()
        result = ContentFallbackService(
            miniflux=miniflux,
            policies=PolicyRegistry.from_dict({}),
            provider=provider,
        ).recover(42)
        self.assertEqual((result["status"], result["reason"]), ("disabled", "feature_disabled"))
        self.assertEqual(provider.calls, 0)

    def test_on_demand_recovery_preserves_miniflux_identity_and_state(self) -> None:
        item = entry(status="unread", starred=True)
        miniflux = FakeMiniflux({item.id: item})
        provider = FakeProvider()
        result = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider).recover(item.id)
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["entry_id"], item.id)
        self.assertEqual(result["url_fingerprint"], hashlib.sha256(item.url.encode()).hexdigest())
        self.assertEqual(result["content_origin"], "wallhop")
        self.assertEqual(item.url, "https://www.nytimes.com/2026/11/07/example-story.html")
        self.assertEqual(item.title, "Research Update")
        self.assertEqual(item.status, "unread")
        self.assertTrue(item.starred)
        self.assertEqual(item.feed_id, 7)
        # The only Miniflux calls made by this service are GET /v1/entries/{id}.
        self.assertEqual(miniflux.calls, [("GET", item.id), ("GET", item.id)])

    def test_read_state_and_starred_state_are_never_written(self) -> None:
        item = entry(status="read", starred=False)
        miniflux = FakeMiniflux({item.id: item})
        provider = FakeProvider()
        ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider).recover(item.id)
        self.assertEqual(item.status, "read")
        self.assertFalse(item.starred)
        self.assertTrue(all(method == "GET" for method, _ in miniflux.calls))

    def test_refresh_overwrite_behavior_is_detected_and_ignored(self) -> None:
        first = entry()
        refreshed = entry(content="<article><p>New feed content.</p></article>", url="https://www.nytimes.com/updated")
        miniflux = FakeMiniflux({first.id: [first, refreshed]})
        provider = FakeProvider()
        result = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider).recover(first.id)
        self.assertEqual(result["status"], "stale")
        self.assertEqual(result["content_origin"], "miniflux")
        self.assertEqual(result["url_fingerprint"], hashlib.sha256(refreshed.url.encode()).hexdigest())
        self.assertNotIn("wallhop", result["content_html"])
        self.assertEqual(miniflux.calls, [("GET", first.id), ("GET", first.id)])

    def test_partial_wallhop_response_keeps_original_miniflux_content(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({item.id: item})
        original = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=PartialProvider()).recover(item.id)
        self.assertEqual(original["status"], "incomplete")
        self.assertEqual(original["content_origin"], "miniflux")
        self.assertIn("Short feed teaser", original["content_html"])

    def test_read_and_star_changes_during_recovery_preserve_recovered_content(self) -> None:
        transitions = (
            ("unread", "read", False, False),
            ("read", "unread", False, False),
            ("unread", "unread", False, True),
            ("read", "unread", False, True),
        )
        for before_status, after_status, before_starred, after_starred in transitions:
            with self.subTest(
                before=(before_status, before_starred),
                after=(after_status, after_starred),
            ):
                before = entry(status=before_status, starred=before_starred)
                after = entry(status=after_status, starred=after_starred)
                miniflux = FakeMiniflux({42: [before, after]})
                release = threading.Event()
                provider = FakeProvider(block=release)
                service = ContentFallbackService(
                    miniflux=miniflux,
                    policies=enabled_registry(),
                    provider=provider,
                )
                result: dict[str, object] = {}
                thread = threading.Thread(target=lambda: result.update(service.recover(42)))
                thread.start()
                self.assertTrue(provider.started.wait(1))
                release.set()
                thread.join(1)

                self.assertFalse(thread.is_alive())
                self.assertEqual(result["status"], "recovered")
                self.assertEqual(result["content_origin"], "wallhop")

    def test_identity_and_content_changes_during_recovery_remain_stale(self) -> None:
        original = entry()
        changed = (
            entry(content="<article><p>New feed content.</p></article>"),
            entry(url="https://www.nytimes.com/updated"),
            EntrySnapshot(**{**original.__dict__, "title": "Updated title"}),
            EntrySnapshot(**{**original.__dict__, "published_at": "2026-11-08T10:00:00Z"}),
            EntrySnapshot(**{**original.__dict__, "feed_id": 8}),
            entry(entry_id=43),
        )
        for latest in changed:
            with self.subTest(latest=latest):
                miniflux = FakeMiniflux({original.id: [original, latest]})
                result = ContentFallbackService(
                    miniflux=miniflux,
                    policies=enabled_registry(),
                    provider=FakeProvider(),
                ).recover(original.id)
                self.assertEqual(result["status"], "stale")
                self.assertEqual(result["content_origin"], "miniflux")

    def test_cache_deduplicates_repeated_entry_request(self) -> None:
        item = entry()
        miniflux = FakeMiniflux({42: item})
        provider = FakeProvider()
        service = ContentFallbackService(miniflux=miniflux, policies=enabled_registry(), provider=provider)
        first = service.recover(42)
        second = service.recover(42)
        self.assertEqual(first["status"], "recovered")
        self.assertEqual(second["status"], "recovered")
        self.assertTrue(second["cache_hit"])
        self.assertEqual(provider.calls, 1)

    def test_concurrent_request_limit_is_enforced(self) -> None:
        items = {number: entry(number) for number in range(1, 6)}
        miniflux = FakeMiniflux(items)
        release = threading.Event()
        provider = FakeProvider(block=release)
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
            max_concurrent=5,
            max_concurrent_per_domain=2,
            follower_wait_seconds=0.01,
        )
        results: dict[int, dict[str, object]] = {}
        threads = [
            threading.Thread(target=lambda n=n: results.__setitem__(n, service.recover(n)))
            for n in items
        ]
        for thread in threads:
            thread.start()
        self.assertTrue(provider.started.wait(1))
        time.sleep(0.05)
        self.assertLessEqual(provider.max_active, 2)
        self.assertEqual(sum(result.get("status") == "busy" for result in results.values()), 3)
        release.set()
        for thread in threads:
            thread.join(1)
        self.assertEqual(provider.calls, 2)

    def test_global_request_limit_is_enforced_across_domains(self) -> None:
        items = {
            number: entry(number, url=f"https://source{number}.nytimes.com/article/{number}")
            for number in range(1, 6)
        }
        miniflux = FakeMiniflux(items)
        release = threading.Event()
        provider = FakeProvider(block=release)
        service = ContentFallbackService(
            miniflux=miniflux,
            policies=enabled_registry(),
            provider=provider,
            max_concurrent=2,
            max_concurrent_per_domain=5,
            follower_wait_seconds=0.01,
        )
        results: dict[int, dict[str, object]] = {}
        threads = [
            threading.Thread(target=lambda n=n: results.__setitem__(n, service.recover(n)))
            for n in items
        ]
        for thread in threads:
            thread.start()
        self.assertTrue(provider.started.wait(1))
        time.sleep(0.05)
        self.assertLessEqual(provider.max_active, 2)
        self.assertEqual(sum(result.get("status") == "busy" for result in results.values()), 3)
        release.set()
        for thread in threads:
            thread.join(1)
        self.assertEqual(provider.calls, 2)

    def test_13ft_public_fallback_remains_closed_until_security_gate(self) -> None:
        with self.assertRaisesRegex(ValueError, "security-gated"):
            DomainPolicy.from_dict({"state": "ON_DEMAND", "provider": "13ft"})

    def test_13ft_security_gate_is_not_overridable_by_runtime_config(self) -> None:
        with self.assertRaises(ValueError):
            PolicyRegistry.from_dict(
                {"enabled": True, "domains": {"public.example": {"state": "ON_DEMAND", "provider": "13ft"}}}
            )


if __name__ == "__main__":
    unittest.main()
