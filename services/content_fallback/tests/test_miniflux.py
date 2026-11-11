from __future__ import annotations

import json
import unittest

from services.content_fallback.http_client import HTTPResponse
from services.content_fallback.miniflux import (
    EntrySnapshot,
    MinifluxClient,
    MinifluxError,
    ReaderRecoveryScope,
)


class FakeHTTP:
    def __init__(self, payload: object, status: int = 200) -> None:
        self.payload = payload
        self.status = status
        self.calls: list[dict[str, object]] = []

    def get(self, url: str, **kwargs) -> HTTPResponse:
        self.calls.append({"method": "GET", "url": url, **kwargs})
        return HTTPResponse(
            self.status,
            {"content-type": "application/json"},
            json.dumps(self.payload).encode(),
            url,
        )


def entry_data(**changes) -> dict[str, object]:
    value: dict[str, object] = {
        "id": 42,
        "feed_id": 7,
        "title": "Original title",
        "url": "https://publisher.example/article/42",
        "published_at": "2026-11-07T10:00:00Z",
        "status": "unread",
        "starred": True,
        "content": "<p>Feed excerpt</p>",
    }
    value.update(changes)
    return value


def identity_data(**changes) -> dict[str, object]:
    value: dict[str, object] = {"id": 7, "username": "reader", "is_admin": False}
    value.update(changes)
    return value


class MinifluxClientTests(unittest.TestCase):
    def test_reader_recovery_scope_contains_only_resource_ids_and_fingerprints(self) -> None:
        payload = {
            "reader_scope": {
                "entry_id": 42,
                "feed_id": 7,
                "url_fingerprint": "a" * 64,
                "title_sha256": "b" * 64,
                "content_sha256": "c" * 64,
            }
        }
        scope = ReaderRecoveryScope.from_payload(payload, expected_entry_id=42)
        self.assertEqual(scope.to_dict(), payload["reader_scope"])

        invalid_payloads = (
            {"reader_scope": {**payload["reader_scope"], "is_admin": True}},
            {"reader_scope": {**payload["reader_scope"], "user_id": 1}},
            {"reader_scope": {**payload["reader_scope"], "url_fingerprint": "not-a-digest"}},
            {"reader_scope": {**payload["reader_scope"], "client_api_key": "secret"}},
            {"reader_scope": {**payload["reader_scope"], "entry_id": 43}},
        )
        for invalid in invalid_payloads:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                ReaderRecoveryScope.from_payload(invalid, expected_entry_id=42)

    def test_service_credential_identity_is_verified_with_get_me(self) -> None:
        http = FakeHTTP(identity_data())
        client = MinifluxClient("http://miniflux:8080", "api-token", http=http)
        identity = client.get_current_user_identity()
        self.assertEqual((identity.id, identity.username, identity.is_admin), (7, "reader", False))
        self.assertEqual(http.calls[0]["method"], "GET")
        self.assertEqual(http.calls[0]["url"], "http://miniflux:8080/v1/me")
        self.assertEqual(http.calls[0]["headers"]["X-Auth-Token"], "api-token")
        self.assertEqual(http.calls[0]["max_redirects"], 0)

    def test_service_identity_preserves_admin_flag_and_rejects_malformed_user(self) -> None:
        admin = MinifluxClient(
            "http://miniflux:8080", "api-token", http=FakeHTTP(identity_data(is_admin=True))
        ).get_current_user_identity()
        self.assertTrue(admin.is_admin)
        for payload in (
            identity_data(id=True),
            identity_data(username=""),
            identity_data(is_admin="false"),
        ):
            with self.subTest(payload=payload), self.assertRaises(MinifluxError):
                MinifluxClient("http://miniflux:8080", "api-token", http=FakeHTTP(payload)).get_current_user_identity()

    def test_content_fingerprint_ignores_read_and_star_state(self) -> None:
        unread = snapshot()
        read_and_starred = snapshot(status="read", starred=False)
        self.assertEqual(unread.content_fingerprint, read_and_starred.content_fingerprint)
        self.assertNotEqual(unread.fingerprint, read_and_starred.fingerprint)

    def test_content_fingerprint_changes_when_original_body_changes(self) -> None:
        original = snapshot()
        updated = snapshot(content="<p>Feed excerpt</p> New feed text.")
        self.assertNotEqual(original.content_fingerprint, updated.content_fingerprint)

    def test_entry_identity_and_read_state_are_loaded_by_get_only(self) -> None:
        http = FakeHTTP(entry_data())
        client = MinifluxClient("http://miniflux:8080", "api-token", http=http)
        snapshot = client.get_entry(42)
        self.assertEqual(snapshot.id, 42)
        self.assertEqual(snapshot.feed_id, 7)
        self.assertEqual(snapshot.title, "Original title")
        self.assertEqual(snapshot.url, "https://publisher.example/article/42")
        self.assertEqual(snapshot.published_at, "2026-11-07T10:00:00Z")
        self.assertEqual(snapshot.status, "unread")
        self.assertTrue(snapshot.starred)
        self.assertEqual(http.calls[0]["method"], "GET")
        self.assertEqual(http.calls[0]["url"], "http://miniflux:8080/v1/entries/42")
        self.assertEqual(http.calls[0]["headers"], {"X-Auth-Token": "api-token", "Accept": "application/json"})
        self.assertEqual(http.calls[0]["max_redirects"], 0)
        self.assertFalse(hasattr(client, "put"))

    def test_entry_snapshot_carries_article_and_feed_ownership(self) -> None:
        payload = {
            **entry_data(),
            "user_id": 1,
            "feed": {"id": 7, "user_id": 1},
        }
        snapshot = MinifluxClient(
            "http://miniflux:8080", "api-token", http=FakeHTTP(payload)
        ).get_entry(42)

        self.assertEqual((snapshot.user_id, snapshot.feed_user_id), (1, 1))

    def test_entry_snapshot_rejects_a_different_nested_feed(self) -> None:
        payload = {**entry_data(), "feed": {"id": 8, "user_id": 7}}
        with self.assertRaisesRegex(MinifluxError, "different feed ID"):
            MinifluxClient(
                "http://miniflux:8080", "api-token", http=FakeHTTP(payload)
            ).get_entry(42)

    def test_native_scraper_uses_explicit_response_only_get(self) -> None:
        http = FakeHTTP({"content": "<article><p>Scraped content</p></article>", "reading_time": 4})
        client = MinifluxClient("http://miniflux:8080", "api-token", http=http)
        content = client.fetch_entry_content(42)
        self.assertEqual(content, "<article><p>Scraped content</p></article>")
        self.assertEqual(http.calls[0]["method"], "GET")
        self.assertEqual(
            http.calls[0]["url"],
            "http://miniflux:8080/v1/entries/42/fetch-content?update_content=false",
        )
        self.assertFalse(hasattr(client, "put"))

    def test_feed_url_rewrite_configuration_is_read_by_feed_id(self) -> None:
        http = FakeHTTP({"id": 7, "urlrewrite_rules": "^https://example.com/(.*),https://m.example.com/$1"})
        client = MinifluxClient("http://miniflux:8080", "api-token", http=http)
        rules = client.get_feed_urlrewrite_rules(7)
        self.assertEqual(rules, "^https://example.com/(.*),https://m.example.com/$1")
        self.assertEqual(http.calls[0]["method"], "GET")
        self.assertEqual(http.calls[0]["url"], "http://miniflux:8080/v1/feeds/7")

    def test_mismatched_entry_id_is_rejected(self) -> None:
        client = MinifluxClient("http://miniflux:8080", "api-token", http=FakeHTTP(entry_data(id=43)))
        with self.assertRaisesRegex(MinifluxError, "different entry ID"):
            client.get_entry(42)

    def test_entry_not_found_is_reported_without_write(self) -> None:
        client = MinifluxClient("http://miniflux:8080", "api-token", http=FakeHTTP({}, status=404))
        with self.assertRaisesRegex(MinifluxError, "entry not found"):
            client.get_entry(42)

    def test_miniflux_base_url_rejects_embedded_credentials(self) -> None:
        with self.assertRaisesRegex(ValueError, "credentials"):
            MinifluxClient("http://user:pass@miniflux:8080", "api-token", http=FakeHTTP({}))


def snapshot(**changes) -> EntrySnapshot:
    data = entry_data(**changes)
    return EntrySnapshot(
        id=data["id"],
        feed_id=data["feed_id"],
        title=data["title"],
        url=data["url"],
        published_at=data["published_at"],
        status=data["status"],
        starred=data["starred"],
        content=data["content"],
    )


if __name__ == "__main__":
    unittest.main()
