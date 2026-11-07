from __future__ import annotations

import hashlib
import threading
import tempfile
import time
import unittest
from pathlib import Path

from services.content_fallback.content import assess_content
from services.content_fallback.http_client import UnsafeURL
from services.content_fallback.miniflux import EntrySnapshot
from services.content_fallback.policy import DomainPolicy, PolicyRegistry
from services.content_fallback.service import (
    ContentFallbackService,
    MinifluxScraperProvider,
    ProviderResult,
    RecoveryError,
)
from services.content_fallback.store import MemoryRecoveryStore, SQLiteRecoveryStore


def full_article_html() -> str:
    return "<article>" + "".join(
        "<p>Researchers reported a clear change in the coastal current during the "
        f"observation period {index}. The team compared the readings with earlier "
        "measurements and found the same pattern across several independent sites. "
        "Analysts said the results need another season of study before broad conclusions "
        "can be made about the evidence.</p>"
        for index in range(8)
    ) + "</article>"


def entry(
    entry_id: int = 42,
    *,
    status: str = "unread",
    starred: bool = True,
    content: str = "<article><p>Short feed teaser.</p></article>",
    url: str = "https://www.nytimes.com/2026/11/07/example-story.html",
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
