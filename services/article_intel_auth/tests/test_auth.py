from __future__ import annotations

import hashlib
import json
import unittest
from collections.abc import Callable

from services.article_intel_auth.auth import AuthError, AuthSettings, MinifluxAuthService
from services.content_fallback.http_client import FetchError, HTTPResponse, PinnedHTTPClient


TRUSTED_MINIFLUX = "https://miniflux.example/reader"
TRUSTED_WEB_ORIGIN = "https://newsflux.example"
USER_KEY = "synthetic-user-key-7"
OTHER_KEY = "synthetic-user-key-12"


def response(payload: object, *, status: int = 200, url: str = "") -> HTTPResponse:
    return HTTPResponse(
        status=status,
        headers={"content-type": "application/json; charset=utf-8"},
        body=json.dumps(payload).encode("utf-8"),
        url=url,
    )


def me(*, user_id: int = 7, is_admin: bool = False, **changes: object) -> dict[str, object]:
    value: dict[str, object] = {"id": user_id, "username": f"user-{user_id}", "is_admin": is_admin}
    value.update(changes)
    return value


def entry(*, entry_id: int = 42, user_id: int = 7, feed_user_id: int | None = None, **changes: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": entry_id,
        "user_id": user_id,
        "feed_id": 3,
        "title": "Synthetic article",
        "url": "https://publisher.example/story",
        "content": "Synthetic article body.",
        "feed": {"id": 3, "user_id": user_id if feed_user_id is None else feed_user_id},
    }
    value.update(changes)
    return value


class FakeHTTP:
    def __init__(self, handler: Callable[[str, dict[str, str]], HTTPResponse]) -> None:
        self.handler = handler
        self.calls: list[dict[str, object]] = []

    def get(self, url: str, **options: object) -> HTTPResponse:
        headers = dict(options.get("headers", {}))
        self.calls.append({"method": "GET", "url": url, **options, "headers": headers})
        return self.handler(url, headers)


def service(http: FakeHTTP, *, admin_ids: frozenset[int] = frozenset({7}), state: str = "configured") -> MinifluxAuthService:
    settings = AuthSettings(
        miniflux_base_url=TRUSTED_MINIFLUX,
        allowed_web_origins=frozenset({TRUSTED_WEB_ORIGIN}),
        admin_user_ids=admin_ids,
        admin_allowlist_state=state,
    )
    return MinifluxAuthService(settings, http=http)


class MinifluxAuthTests(unittest.TestCase):
    def test_real_pinned_http_client_path_uses_fixed_origin_and_synthetic_transport(self) -> None:
        requests: list[dict[str, object]] = []

        def resolver(host: str, port: int, allow_private: bool) -> str:
            self.assertEqual(host, "miniflux.example")
            self.assertEqual(port, 443)
            self.assertTrue(allow_private)
            return "10.0.0.4"

        def requester(url: str, pinned_ip: str, port: int, headers: dict[str, str], timeout: float, max_bytes: int) -> HTTPResponse:
            requests.append({"url": url, "ip": pinned_ip, "port": port, "headers": headers, "timeout": timeout, "max_bytes": max_bytes})
            payload = me() if url.endswith("/v1/me") else entry()
            return response(payload, url=url)

        transport = PinnedHTTPClient(resolver=resolver, requester=requester)
        result = service(transport).authorize_entry(
            api_key=USER_KEY,
            claimed_miniflux_base_url=TRUSTED_MINIFLUX,
            request_origin=TRUSTED_WEB_ORIGIN,
            request_is_secure=True,
            entry_id=42,
        )
        self.assertEqual(result.user_id, 7)
        self.assertEqual([request["url"] for request in requests], [
            f"{TRUSTED_MINIFLUX}/v1/me",
            f"{TRUSTED_MINIFLUX}/v1/entries/42",
        ])
        self.assertTrue(all(request["ip"] == "10.0.0.4" for request in requests))
        self.assertTrue(all(request["headers"]["X-Auth-Token"] == USER_KEY for request in requests))

    def test_cleartext_request_is_rejected_before_miniflux_authentication(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        with self.assertRaises(AuthError) as caught:
            service(http).authenticate(
                api_key=USER_KEY,
                claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                request_origin=TRUSTED_WEB_ORIGIN,
                request_is_secure=False,
            )
        self.assertEqual(caught.exception.code, "https_required")
        self.assertEqual(http.calls, [])

    def test_identity_is_verified_by_get_me_using_only_the_supplied_key(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        principal = service(http).authenticate(
            api_key=USER_KEY,
            claimed_miniflux_base_url=TRUSTED_MINIFLUX,
            request_origin=TRUSTED_WEB_ORIGIN,
            request_is_secure=True,
        )

        self.assertEqual((principal.miniflux_base_url, principal.user_id, principal.username), (TRUSTED_MINIFLUX, 7, "user-7"))
        self.assertFalse(principal.is_admin)
        self.assertEqual(len(http.calls), 1)
        call = http.calls[0]
        self.assertEqual(call["method"], "GET")
        self.assertEqual(call["url"], f"{TRUSTED_MINIFLUX}/v1/me")
        self.assertEqual(call["headers"]["X-Auth-Token"], USER_KEY)
        self.assertNotIn("Authorization", call["headers"])
        self.assertNotIn("Cookie", call["headers"])
        self.assertNotIn("Origin", call["headers"])
        self.assertEqual(call["max_redirects"], 0)
        self.assertEqual(call["max_bytes"], 65536)
        self.assertEqual(call["timeout"], 5.0)
        self.assertNotIn("api_key", principal.__dict__)
        self.assertNotIn("token", principal.__dict__)

    def test_missing_or_malformed_api_key_is_rejected_before_upstream_call(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        verifier = service(http)
        for value in (None, "", "   ", "key\r\nX-Injected: yes", "x\x00y", "api key", "café", "x" * 4097):
            with self.subTest(value=repr(value)), self.assertRaises(AuthError):
                verifier.authenticate(
                    api_key=value,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
        self.assertEqual(http.calls, [])

    def test_invalid_or_revoked_key_is_rejected_each_time_without_positive_cache(self) -> None:
        status = {"value": 200}
        http = FakeHTTP(lambda url, _headers: response(me(), status=status["value"], url=url))
        verifier = service(http)
        args = {
            "api_key": USER_KEY,
            "claimed_miniflux_base_url": TRUSTED_MINIFLUX,
            "request_origin": TRUSTED_WEB_ORIGIN,
            "request_is_secure": True,
        }

        self.assertEqual(verifier.authenticate(**args).user_id, 7)
        status["value"] = 401
        with self.assertRaises(AuthError) as caught:
            verifier.authenticate(**args)
        self.assertEqual(caught.exception.code, "unauthenticated")
        self.assertEqual(len(http.calls), 2)

    def test_server_status_and_timeout_fail_closed_without_upstream_details(self) -> None:
        secret = USER_KEY
        for handler in (
            lambda url, _headers: response({"error": secret}, status=503, url=url),
            lambda _url, _headers: (_ for _ in ()).throw(FetchError(f"timeout while using {secret}")),
            lambda _url, _headers: (_ for _ in ()).throw(TimeoutError(f"timeout while using {secret}")),
        ):
            verifier = service(FakeHTTP(handler))
            with self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=secret,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "miniflux_unavailable")
            self.assertNotIn(secret, str(caught.exception))
            self.assertNotIn(secret, repr(caught.exception))

    def test_invalid_json_content_type_or_oversized_response_is_rejected(self) -> None:
        malformed = HTTPResponse(200, {"content-type": "application/json"}, b"{", f"{TRUSTED_MINIFLUX}/v1/me")
        wrong_type = HTTPResponse(200, {"content-type": "text/html"}, b"{}", f"{TRUSTED_MINIFLUX}/v1/me")
        too_large = HTTPResponse(200, {"content-type": "application/json"}, b" " * 65537, f"{TRUSTED_MINIFLUX}/v1/me")
        for upstream_response in (malformed, wrong_type, too_large):
            verifier = service(FakeHTTP(lambda _url, _headers: upstream_response))
            with self.subTest(upstream_response=upstream_response), self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "invalid_miniflux_response")

    def test_missing_or_malformed_identity_fields_are_rejected(self) -> None:
        for payload in (
            {},
            me(user_id=True),
            me(user_id=0),
            me(username=""),
            me(username="bad\nname"),
            me(is_admin="true"),
            {"id": 7, "username": "user-7"},
        ):
            verifier = service(FakeHTTP(lambda url, _headers, payload=payload: response(payload, url=url)))
            with self.subTest(payload=payload), self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "invalid_miniflux_response")

    def test_only_exact_configured_miniflux_base_is_used_and_origin_mismatch_makes_no_call(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        verifier = service(http)
        for claimed_base in (
            "https://other.example",
            "http://miniflux.example/reader",
            "https://miniflux.example/reader?token=leak",
            "http://127.0.0.1:8080",
        ):
            with self.subTest(claimed_base=claimed_base), self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=claimed_base,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "miniflux_origin_not_authorized")
        self.assertEqual(http.calls, [])

    def test_untrusted_web_origin_is_rejected_before_token_is_sent(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        verifier = service(http)
        for origin in ("https://attacker.example", "http://newsflux.example", "null", "*"):
            with self.subTest(origin=origin), self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=origin,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "request_origin_not_allowed")
        self.assertEqual(http.calls, [])

    def test_redirect_is_never_followed_with_the_miniflux_key(self) -> None:
        http = FakeHTTP(
            lambda url, _headers: HTTPResponse(
                302,
                {"content-type": "application/json", "location": "https://attacker.example/collect"},
                b"{}",
                url,
            )
        )
        with self.assertRaises(AuthError) as caught:
            service(http).authenticate(
                api_key=USER_KEY,
                claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                request_origin=TRUSTED_WEB_ORIGIN,
                request_is_secure=True,
            )
        self.assertEqual(caught.exception.code, "miniflux_unavailable")
        self.assertEqual(len(http.calls), 1)
        self.assertEqual(http.calls[0]["url"], f"{TRUSTED_MINIFLUX}/v1/me")
        self.assertEqual(http.calls[0]["headers"]["X-Auth-Token"], USER_KEY)

    def test_client_user_id_and_admin_claims_are_rejected(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(user_id=12, is_admin=True), url=url))
        verifier = service(http)
        for claims in ({"user_id": 7}, {"is_admin": True}, {"role": "admin"}, {"principal_id": "7"}):
            with self.subTest(claims=claims), self.assertRaises(AuthError) as caught:
                verifier.authenticate(
                    api_key=OTHER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                    client_claims=claims,
                )
            self.assertEqual(caught.exception.code, "client_identity_claim_not_allowed")
        self.assertEqual(http.calls, [])

    def test_admin_requires_verified_miniflux_admin_and_configured_allowlist(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(is_admin=True), url=url))
        principal = service(http).authorize_admin(
            api_key=USER_KEY,
            claimed_miniflux_base_url=TRUSTED_MINIFLUX,
            request_origin=TRUSTED_WEB_ORIGIN,
            request_is_secure=True,
        )
        self.assertTrue(principal.is_admin)

        for is_admin, ids, state, user_id in (
            (False, frozenset({7}), "configured", 7),
            (True, frozenset({12}), "configured", 7),
            (True, frozenset(), "empty", 7),
            (True, frozenset(), "missing", 7),
            (True, frozenset(), "invalid", 7),
            (True, frozenset({7}), "configured", 12),
        ):
            verifier = service(FakeHTTP(lambda url, _headers, is_admin=is_admin, user_id=user_id: response(me(user_id=user_id, is_admin=is_admin), url=url)), admin_ids=ids, state=state)
            with self.subTest(is_admin=is_admin, ids=ids, state=state, user_id=user_id), self.assertRaises(AuthError) as caught:
                verifier.authorize_admin(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                )
            self.assertEqual(caught.exception.code, "admin_not_authorized")

    def test_entry_is_fetched_with_same_user_key_and_requires_entry_and_feed_ownership(self) -> None:
        http = FakeHTTP(
            lambda url, headers: response(me(), url=url)
            if url.endswith("/v1/me")
            else response(entry(), url=url)
        )
        authorized = service(http).authorize_entry(
            api_key=USER_KEY,
            claimed_miniflux_base_url=TRUSTED_MINIFLUX,
            request_origin=TRUSTED_WEB_ORIGIN,
            request_is_secure=True,
            entry_id=42,
        )
        self.assertEqual((authorized.entry_id, authorized.user_id, authorized.feed_id), (42, 7, 3))
        self.assertEqual(authorized.content_html, "Synthetic article body.")
        self.assertEqual(len(authorized.content_sha256), 64)
        self.assertEqual(
            authorized.url_fingerprint,
            hashlib.sha256(b"https://publisher.example/story").hexdigest(),
        )
        self.assertEqual([call["url"] for call in http.calls], [f"{TRUSTED_MINIFLUX}/v1/me", f"{TRUSTED_MINIFLUX}/v1/entries/42"])
        self.assertTrue(all(call["headers"]["X-Auth-Token"] == USER_KEY for call in http.calls))
        self.assertTrue(all(call["max_redirects"] == 0 for call in http.calls))
        self.assertNotIn("api_key", authorized.__dict__)
        self.assertNotIn("url", authorized.__dict__)

        for payload in (
            entry(entry_id=43),
            entry(user_id=12),
            entry(feed_user_id=12),
            entry(feed={"id": 4, "user_id": 7}),
            entry(feed={"id": 3}),
            entry(feed=None),
            entry(url="https://publisher.example/story\r\nX-Leak: yes"),
            entry(content=12),
            entry(feed_id=True),
        ):
            http = FakeHTTP(lambda url, _headers, payload=payload: response(me(), url=url) if url.endswith("/v1/me") else response(payload, url=url))
            with self.subTest(payload=payload), self.assertRaises(AuthError) as caught:
                service(http).authorize_entry(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                    entry_id=42,
                )
            self.assertIn(caught.exception.code, {"entry_not_accessible", "invalid_miniflux_response"})

    def test_invalid_entry_ids_are_rejected_without_upstream_call(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        verifier = service(http)
        for entry_id in (0, -1, True, False, 1.5, "42", 2**63, None):
            with self.subTest(entry_id=entry_id), self.assertRaises(AuthError) as caught:
                verifier.authorize_entry(
                    api_key=USER_KEY,
                    claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                    request_origin=TRUSTED_WEB_ORIGIN,
                    request_is_secure=True,
                    entry_id=entry_id,
                )
            self.assertEqual(caught.exception.code, "invalid_request")
        self.assertEqual(http.calls, [])

    def test_unavailable_or_inaccessible_article_is_not_disclosed(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url) if url.endswith("/v1/me") else response({"error": "secret details"}, status=404, url=url))
        with self.assertRaises(AuthError) as caught:
            service(http).authorize_entry(
                api_key=USER_KEY,
                claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                request_origin=TRUSTED_WEB_ORIGIN,
                request_is_secure=True,
                entry_id=404,
            )
        self.assertEqual(caught.exception.code, "entry_not_accessible")
        self.assertNotIn("secret details", str(caught.exception))

    def test_different_users_never_share_request_identity_or_entry_context(self) -> None:
        users = {USER_KEY: 7, OTHER_KEY: 12}
        http = FakeHTTP(
            lambda url, headers: response(me(user_id=users[headers["X-Auth-Token"]]), url=url)
            if url.endswith("/v1/me")
            else response(entry(user_id=users[headers["X-Auth-Token"]], feed_user_id=users[headers["X-Auth-Token"]]), url=url)
        )
        verifier = service(http)
        first = verifier.authorize_entry(api_key=USER_KEY, claimed_miniflux_base_url=TRUSTED_MINIFLUX, request_origin=TRUSTED_WEB_ORIGIN, request_is_secure=True, entry_id=42)
        second = verifier.authorize_entry(api_key=OTHER_KEY, claimed_miniflux_base_url=TRUSTED_MINIFLUX, request_origin=TRUSTED_WEB_ORIGIN, request_is_secure=True, entry_id=42)
        self.assertEqual((first.user_id, second.user_id), (7, 12))
        self.assertEqual([call["headers"]["X-Auth-Token"] for call in http.calls], [USER_KEY, USER_KEY, OTHER_KEY, OTHER_KEY])

    def test_logout_request_without_the_cleared_key_is_denied(self) -> None:
        http = FakeHTTP(lambda url, _headers: response(me(), url=url))
        with self.assertRaises(AuthError) as caught:
            service(http).authenticate(
                api_key="",
                claimed_miniflux_base_url=TRUSTED_MINIFLUX,
                request_origin=TRUSTED_WEB_ORIGIN,
                request_is_secure=True,
            )
        self.assertEqual(caught.exception.code, "unauthenticated")
        self.assertEqual(http.calls, [])


if __name__ == "__main__":
    unittest.main()
