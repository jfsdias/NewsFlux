from __future__ import annotations

import unittest

from services.article_intel_auth.auth import AuthError, AuthSettings, MinifluxAuthService
from services.article_intel_auth.origin import OriginPolicy
from services.content_fallback.http_client import HTTPResponse


TRUSTED_ORIGIN = "https://newsflux.example"


class OriginPolicyTests(unittest.TestCase):
    def test_cors_headers_reflect_only_the_exact_configured_origin(self) -> None:
        policy = OriginPolicy({TRUSTED_ORIGIN})
        headers = policy.cors_headers("HTTPS://NewsFlux.Example:443/")
        self.assertEqual(headers["Access-Control-Allow-Origin"], TRUSTED_ORIGIN)
        self.assertNotIn("*", headers["Access-Control-Allow-Origin"])
        self.assertNotIn("Access-Control-Allow-Credentials", headers)
        self.assertEqual(headers["Vary"], "Origin")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_cross_origin_and_opaque_null_origins_are_rejected(self) -> None:
        policy = OriginPolicy({TRUSTED_ORIGIN})
        for origin in ("https://attacker.example", "http://newsflux.example", "null", "*"):
            with self.subTest(origin=origin), self.assertRaises(AuthError):
                policy.cors_headers(origin)

    def test_preflight_allows_only_expected_methods_and_auth_headers(self) -> None:
        policy = OriginPolicy({TRUSTED_ORIGIN})
        headers = policy.preflight_headers(
            TRUSTED_ORIGIN,
            "POST",
            "Content-Type, X-Miniflux-API-Key, X-NewsFlux-Miniflux-Server",
        )
        self.assertEqual(headers["Access-Control-Allow-Origin"], TRUSTED_ORIGIN)
        self.assertEqual(headers["Access-Control-Max-Age"], "600")
        for method, requested_headers in (
            ("TRACE", "X-Miniflux-API-Key"),
            ("POST", "X-Miniflux-API-Key, X-Forwarded-User"),
        ):
            with self.subTest(method=method, requested_headers=requested_headers), self.assertRaises(AuthError):
                policy.preflight_headers(TRUSTED_ORIGIN, method, requested_headers)

    def test_origin_is_not_authentication(self) -> None:
        settings = AuthSettings(
            miniflux_base_url="https://miniflux.example",
            allowed_web_origins=frozenset({TRUSTED_ORIGIN}),
            admin_user_ids=frozenset(),
            admin_allowlist_state="empty",
        )

        class UnusedHTTP:
            calls = 0

            def get(self, _url: str, **_options: object) -> HTTPResponse:
                self.calls += 1
                return HTTPResponse(200, {"content-type": "application/json"}, b"{}", _url)

        http = UnusedHTTP()
        verifier = MinifluxAuthService(settings, http=http)
        with self.assertRaises(AuthError) as caught:
            verifier.authenticate(
                api_key="",
                claimed_miniflux_base_url=settings.miniflux_base_url,
                request_origin=TRUSTED_ORIGIN,
                request_is_secure=True,
            )
        self.assertEqual(caught.exception.code, "unauthenticated")
        self.assertEqual(http.calls, 0)


if __name__ == "__main__":
    unittest.main()
