from __future__ import annotations

import hashlib
import ipaddress
import json
import socket
import unittest
from unittest.mock import patch

from services.article_intel_auth.auth import AuthError
from services.content_fallback.reader_bridge import (
    ContentFallbackPrivateClient,
    ReaderBridgeError,
    ReaderBridgeRuntimeConfig,
    ReaderContentBridge,
)
from services.content_fallback.http_client import HTTPResponse, UnsafeURL
from services.content_fallback.miniflux import ReaderRecoveryScope


BASE_URL = "https://miniflux.example"
ORIGIN = "https://newsflux.example"
API_KEY = "synthetic-user-key"
ENTRY_ID = 42
SOURCE_URL = "https://publisher.example/story"
URL_FINGERPRINT = hashlib.sha256(SOURCE_URL.encode()).hexdigest()


class FakeAuth:
    def __init__(
        self,
        *,
        user_id: int = 7,
        is_admin: bool = False,
        accessible: bool = True,
        url_fingerprint: str | None = URL_FINGERPRINT,
    ) -> None:
        self.user_id = user_id
        self.is_admin = is_admin
        self.accessible = accessible
        self.url_fingerprint = url_fingerprint
        self.calls = []

    def authorize_entry(self, **kwargs):
        self.calls.append(kwargs)
        if not self.accessible:
            raise ReaderBridgeError("entry_not_accessible")
        return type(
            "AuthorizedEntryFixture",
            (),
            {
                "entry_id": ENTRY_ID,
                "user_id": self.user_id,
                "is_admin": self.is_admin,
                "feed_id": 3,
                "title": "Synthetic article",
                "content_sha256": hashlib.sha256(b"Synthetic body.").hexdigest(),
                "url_fingerprint": self.url_fingerprint,
            },
        )()


class FakeMiniflux:
    def __init__(self, *, user_id: int = 7, is_admin: bool = False) -> None:
        self.user_id = user_id
        self.is_admin = is_admin
        self.calls = 0

    def get_current_user_identity(self):
        self.calls += 1
        return type(
            "MinifluxIdentityFixture",
            (),
            {"id": self.user_id, "username": f"user-{self.user_id}", "is_admin": self.is_admin},
        )()


class FakeRecovery:
    def __init__(self, response=None):
        self.response = response or {
            "entry_id": ENTRY_ID,
            "url_fingerprint": URL_FINGERPRINT,
            "content_html": "<p>Verified full story.</p>",
            "content_origin": "wallhop",
            "status": "recovered",
            "validation": {"state": "SUFFICIENT", "word_count": 190, "sentence_count": 6, "paragraph_count": 4},
            "provenance": {"provider": "wallhop.io", "fetched_at": "2026-11-01T12:00:00+00:00"},
        }
        self.calls = []
        self.scopes = []

    def recover(self, entry_id, *, reader_scope=None):
        self.calls.append(entry_id)
        self.scopes.append(reader_scope)
        return dict(self.response)


class FakePostHTTP:
    def __init__(self, *, status=200, payload=None):
        self.status = status
        self.payload = payload or {"entry_id": ENTRY_ID, "status": "recovered"}
        self.calls = []

    def post(self, url, body, **kwargs):
        self.calls.append({"url": url, "body": body, **kwargs})
        return HTTPResponse(
            self.status,
            {"content-type": "application/json; charset=utf-8"},
            json.dumps(self.payload).encode(),
            url,
        )


def make_bridge(*, auth=None, miniflux=None, recovery=None, allowed_user_id=7):
    return ReaderContentBridge(
        auth=auth or FakeAuth(),
        miniflux=miniflux or FakeMiniflux(),
        recovery=recovery or FakeRecovery(),
        allowed_user_id=allowed_user_id,
    )


class ReaderContentBridgeTests(unittest.TestCase):
    def test_private_client_posts_only_to_fixed_sidecar_endpoint_with_internal_token(self):
        http = FakePostHTTP()
        client = ContentFallbackPrivateClient(
            "http://127.0.0.1:8790/",
            "s" * 40,
            http=http,
        )
        self.assertEqual(client.recover(ENTRY_ID), {"entry_id": ENTRY_ID, "status": "recovered"})
        self.assertEqual(len(http.calls), 1)
        call = http.calls[0]
        self.assertEqual(call["url"], "http://127.0.0.1:8790/v1/entries/42/recover")
        self.assertEqual(call["body"], b"")
        self.assertEqual(call["headers"]["Authorization"], "Bearer " + "s" * 40)
        self.assertEqual(call["same_origin"], "http://127.0.0.1:8790")
        self.assertTrue(call["allow_private_origin"])

    def test_private_client_sends_only_nonsecret_request_scoped_identity_and_fingerprints(self):
        http = FakePostHTTP()
        scope = ReaderRecoveryScope(
            entry_id=ENTRY_ID,
            feed_id=3,
            url_fingerprint="a" * 64,
            title_sha256="b" * 64,
            content_sha256="c" * 64,
        )
        client = ContentFallbackPrivateClient(
            "http://127.0.0.1:8790",
            "s" * 40,
            http=http,
        )

        client.recover(ENTRY_ID, reader_scope=scope)

        call = http.calls[0]
        self.assertEqual(json.loads(call["body"]), {"reader_scope": scope.to_dict()})
        self.assertEqual(call["headers"]["Content-Type"], "application/json")
        self.assertNotIn(API_KEY.encode(), call["body"])
        self.assertNotIn("user_id", scope.to_dict())
        self.assertNotIn("is_admin", scope.to_dict())

    def test_private_client_rejects_redirect_or_malformed_sidecar_response(self):
        client = ContentFallbackPrivateClient("http://127.0.0.1:8790", "s" * 40, http=FakePostHTTP(status=302))
        with self.assertRaises(ReaderBridgeError):
            client.recover(ENTRY_ID)
        with self.assertRaises(ValueError):
            ContentFallbackPrivateClient("http://user:pass@127.0.0.1:8790", "s" * 40)

    def test_private_service_resolver_rejects_public_or_link_local_destinations(self):
        from services.content_fallback.reader_bridge import _resolve_private_service

        def answer(address, port):
            parsed = ipaddress.ip_address(address)
            family = socket.AF_INET if parsed.version == 4 else socket.AF_INET6
            sockaddr = (address, port) if parsed.version == 4 else (address, port, 0, 0)
            return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)

        with patch("socket.getaddrinfo", return_value=[answer("10.0.0.4", 8790)]):
            self.assertEqual(_resolve_private_service("content-fallback", 8790, True), "10.0.0.4")
        for address in ("93.184.216.34", "169.254.169.254", "0.0.0.0", "224.0.0.1"):
            with patch("socket.getaddrinfo", return_value=[answer(address, 8790)]), self.assertRaises(UnsafeURL):
                _resolve_private_service("content-fallback", 8790, True)

    def test_runtime_bridge_is_disabled_by_default_and_requires_explicit_single_user_config(self):
        self.assertIsNone(ReaderBridgeRuntimeConfig.from_env({}))
        with self.assertRaisesRegex(ValueError, "USER_ID"):
            ReaderBridgeRuntimeConfig.from_env({"CONTENT_FALLBACK_READER_ENABLED": "true"})
        with self.assertRaisesRegex(ValueError, "USER_ID"):
            ReaderBridgeRuntimeConfig.from_env(
                {
                    "CONTENT_FALLBACK_READER_ENABLED": "true",
                    "CONTENT_FALLBACK_READER_USER_ID": "9223372036854775808",
                }
            )

        config = ReaderBridgeRuntimeConfig.from_env(
            {
                "CONTENT_FALLBACK_READER_ENABLED": "true",
                "CONTENT_FALLBACK_READER_USER_ID": "7",
                "CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS": "10.0.0.2, 127.0.0.1",
                "NEWSFLUX_AI_MINIFLUX_BASE_URL": BASE_URL,
                "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": ORIGIN,
            }
        )
        self.assertEqual(config.allowed_user_id, 7)
        self.assertEqual(config.trusted_proxy_ips, frozenset({"10.0.0.2", "127.0.0.1"}))

    def test_authorized_same_user_recovery_returns_only_validated_fields(self):
        recovery = FakeRecovery()
        bridge = make_bridge(recovery=recovery)
        result = bridge.recover(
            entry_id=ENTRY_ID,
            api_key=API_KEY,
            claimed_miniflux_base_url=BASE_URL,
            request_origin=ORIGIN,
            request_is_secure=True,
        )
        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["entry_id"], ENTRY_ID)
        self.assertEqual(result["url_fingerprint"], URL_FINGERPRINT)
        self.assertEqual(result["content_html"], "<p>Verified full story.</p>")
        self.assertEqual(result["content_origin"], "wallhop")
        self.assertNotIn("token", result)
        self.assertNotIn("url", result)
        self.assertEqual(recovery.scopes[0].entry_id, ENTRY_ID)
        self.assertNotIn("user_id", recovery.scopes[0].to_dict())
        self.assertNotIn("is_admin", recovery.scopes[0].to_dict())
        self.assertNotIn(API_KEY, repr(recovery.scopes[0]))

    def test_verified_admin_identity_can_recover_its_own_entry_without_a_bypass(self):
        recovery = FakeRecovery()
        bridge = make_bridge(
            auth=FakeAuth(user_id=1, is_admin=True),
            miniflux=FakeMiniflux(user_id=1, is_admin=True),
            recovery=recovery,
            allowed_user_id=1,
        )

        result = bridge.recover(
            entry_id=ENTRY_ID,
            api_key=API_KEY,
            claimed_miniflux_base_url=BASE_URL,
            request_origin=ORIGIN,
            request_is_secure=True,
        )

        self.assertEqual(result["status"], "recovered")
        self.assertEqual(recovery.calls, [ENTRY_ID])
        self.assertEqual(recovery.scopes[0].entry_id, ENTRY_ID)
        self.assertNotIn("user_id", recovery.scopes[0].to_dict())
        self.assertNotIn("is_admin", recovery.scopes[0].to_dict())

    def test_service_identity_must_match_request_identity_and_role(self):
        for miniflux in (
            FakeMiniflux(user_id=12),
            FakeMiniflux(user_id=7, is_admin=True),
        ):
            recovery = FakeRecovery()
            bridge = make_bridge(miniflux=miniflux, recovery=recovery)
            with self.subTest(miniflux=miniflux), self.assertRaises(ReaderBridgeError):
                bridge.recover(
                    entry_id=ENTRY_ID,
                    api_key=API_KEY,
                    claimed_miniflux_base_url=BASE_URL,
                    request_origin=ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(recovery.calls, [])

    def test_revoked_request_key_is_rechecked_before_recovered_result_is_returned(self):
        class RevokedAfterFirstAuthorization(FakeAuth):
            def authorize_entry(self, **kwargs):
                if self.calls:
                    self.calls.append(kwargs)
                    raise AuthError("unauthenticated", 401)
                return super().authorize_entry(**kwargs)

        auth = RevokedAfterFirstAuthorization()
        recovery = FakeRecovery()
        bridge = make_bridge(auth=auth, recovery=recovery)

        with self.assertRaises(AuthError) as caught:
            bridge.recover(
                entry_id=ENTRY_ID,
                api_key=API_KEY,
                claimed_miniflux_base_url=BASE_URL,
                request_origin=ORIGIN,
                request_is_secure=True,
            )

        self.assertEqual(caught.exception.code, "unauthenticated")
        self.assertEqual(len(auth.calls), 2)
        self.assertEqual(recovery.calls, [ENTRY_ID])

    def test_changed_authorized_fingerprint_invalidates_the_recovery_result(self):
        class ChangedAfterRecovery(FakeAuth):
            def authorize_entry(self, **kwargs):
                authorized = super().authorize_entry(**kwargs)
                if len(self.calls) > 1:
                    authorized.url_fingerprint = "0" * 64
                return authorized

        recovery = FakeRecovery()
        bridge = make_bridge(auth=ChangedAfterRecovery(), recovery=recovery)

        with self.assertRaises(ReaderBridgeError) as caught:
            bridge.recover(
                entry_id=ENTRY_ID,
                api_key=API_KEY,
                claimed_miniflux_base_url=BASE_URL,
                request_origin=ORIGIN,
                request_is_secure=True,
            )

        self.assertEqual(caught.exception.code, "recovery_identity_mismatch")

    def test_entry_outside_single_user_allowlist_never_reaches_recovery_service(self):
        recovery = FakeRecovery()
        bridge = make_bridge(auth=FakeAuth(user_id=12), recovery=recovery)
        with self.assertRaises(ReaderBridgeError):
            bridge.recover(
                entry_id=ENTRY_ID,
                api_key=API_KEY,
                claimed_miniflux_base_url=BASE_URL,
                request_origin=ORIGIN,
                request_is_secure=True,
            )
        self.assertEqual(recovery.calls, [])

    def test_service_credential_must_be_same_non_admin_user(self):
        for miniflux in (FakeMiniflux(user_id=12), FakeMiniflux(is_admin=True)):
            recovery = FakeRecovery()
            bridge = make_bridge(miniflux=miniflux, recovery=recovery)
            with self.assertRaises(ReaderBridgeError):
                bridge.recover(
                    entry_id=ENTRY_ID,
                    api_key=API_KEY,
                    claimed_miniflux_base_url=BASE_URL,
                    request_origin=ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(recovery.calls, [])

    def test_wrong_entry_or_url_fingerprint_is_rejected(self):
        for change in ({"entry_id": ENTRY_ID + 1}, {"url_fingerprint": "0" * 64}):
            response = dict(FakeRecovery().response)
            response.update(change)
            with self.subTest(change=change), self.assertRaises(ReaderBridgeError):
                make_bridge(recovery=FakeRecovery(response)).recover(
                    entry_id=ENTRY_ID,
                    api_key=API_KEY,
                    claimed_miniflux_base_url=BASE_URL,
                    request_origin=ORIGIN,
                    request_is_secure=True,
                )

    def test_missing_or_invalid_authorized_url_fingerprint_blocks_private_recovery(self):
        for fingerprint in (None, "not-a-sha256", "0" * 63):
            recovery = FakeRecovery()
            bridge = make_bridge(auth=FakeAuth(url_fingerprint=fingerprint), recovery=recovery)
            with self.subTest(fingerprint=fingerprint), self.assertRaises(ReaderBridgeError):
                bridge.recover(
                    entry_id=ENTRY_ID,
                    api_key=API_KEY,
                    claimed_miniflux_base_url=BASE_URL,
                    request_origin=ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(recovery.calls, [])

    def test_unsuccessful_or_unsafe_results_are_not_returned(self):
        for change in (
            {"status": "incomplete"},
            {"content_origin": "unknown"},
            {"content_html": "<p>OK</p><script>alert(1)</script>"},
            {"content_html": "<p class=\"remote\">OK</p>"},
            {"validation": {"state": "TEASER"}},
        ):
            response = dict(FakeRecovery().response)
            response.update(change)
            with self.subTest(change=change), self.assertRaises(ReaderBridgeError):
                make_bridge(recovery=FakeRecovery(response)).recover(
                    entry_id=ENTRY_ID,
                    api_key=API_KEY,
                    claimed_miniflux_base_url=BASE_URL,
                    request_origin=ORIGIN,
                    request_is_secure=True,
                )


if __name__ == "__main__":
    unittest.main()
