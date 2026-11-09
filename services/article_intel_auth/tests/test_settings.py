from __future__ import annotations

import unittest

from services.article_intel_auth.config import (
    AuthConfigurationError,
    AuthSettings,
    canonicalize_miniflux_base_url,
    canonicalize_web_origin,
    parse_admin_user_ids,
)


class AuthSettingsTests(unittest.TestCase):
    def test_miniflux_base_url_is_canonicalized_without_changing_its_path(self) -> None:
        self.assertEqual(
            canonicalize_miniflux_base_url(" HTTPS://Miniflux.Example:443/reader/ "),
            "https://miniflux.example/reader",
        )

    def test_miniflux_base_url_rejects_non_https_credentials_query_and_fragment(self) -> None:
        for value in (
            "http://miniflux.example",
            "https://user:password@miniflux.example",
            "https://miniflux.example/?token=secret",
            "https://miniflux.example/#fragment",
            "https://miniflux.example/reader/../admin",
            "https://miniflux.example/reader%2f..%2fadmin",
        ):
            with self.subTest(value=value), self.assertRaises(AuthConfigurationError):
                canonicalize_miniflux_base_url(value)

    def test_web_origin_requires_exact_https_origin_without_path(self) -> None:
        self.assertEqual(canonicalize_web_origin("HTTPS://NewsFlux.Example:443/"), "https://newsflux.example")
        for value in (
            "http://newsflux.example",
            "https://newsflux.example/reader",
            "https://newsflux.example?x=1",
            "null",
            "*",
            "https://user:password@newsflux.example",
        ):
            with self.subTest(value=value), self.assertRaises(AuthConfigurationError):
                canonicalize_web_origin(value)

    def test_admin_allowlist_is_all_or_nothing_and_fails_closed(self) -> None:
        self.assertEqual(parse_admin_user_ids(None), (frozenset(), "missing"))
        self.assertEqual(parse_admin_user_ids("  "), (frozenset(), "empty"))
        self.assertEqual(parse_admin_user_ids("7,12,7"), (frozenset({7, 12}), "configured"))
        self.assertEqual(parse_admin_user_ids("7,invalid"), (frozenset(), "invalid"))
        self.assertEqual(parse_admin_user_ids("0"), (frozenset(), "invalid"))
        self.assertEqual(parse_admin_user_ids("-1"), (frozenset(), "invalid"))

    def test_environment_requires_one_trusted_miniflux_base_and_web_origin(self) -> None:
        with self.assertRaises(AuthConfigurationError):
            AuthSettings.from_env({})

        settings = AuthSettings.from_env(
            {
                "NEWSFLUX_AI_MINIFLUX_BASE_URL": "https://miniflux.example/",
                "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": "https://newsflux.example,https://admin.newsflux.example",
                "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS": "7,12",
            }
        )
        self.assertEqual(settings.miniflux_base_url, "https://miniflux.example")
        self.assertEqual(
            settings.allowed_web_origins,
            frozenset({"https://newsflux.example", "https://admin.newsflux.example"}),
        )
        self.assertEqual(settings.admin_user_ids, frozenset({7, 12}))
        self.assertEqual(settings.admin_allowlist_state, "configured")

    def test_invalid_admin_allowlist_does_not_enable_any_admin_user(self) -> None:
        settings = AuthSettings.from_env(
            {
                "NEWSFLUX_AI_MINIFLUX_BASE_URL": "https://miniflux.example",
                "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": "https://newsflux.example",
                "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS": "7,nope",
            }
        )
        self.assertEqual(settings.admin_user_ids, frozenset())
        self.assertEqual(settings.admin_allowlist_state, "invalid")


if __name__ == "__main__":
    unittest.main()
