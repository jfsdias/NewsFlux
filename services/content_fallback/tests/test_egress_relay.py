"""Controlled egress: only allowlisted HTTPS hosts, always via the private relay. No network."""
from __future__ import annotations

import unittest

from services.content_fallback.http_client import EgressRelayResolver, HTTPResponse, PinnedHTTPClient, UnsafeURL
from services.content_fallback.server import build_egress_http

RELAY_IP = "172.30.9.2"


def relay(allowed=("wallhop.io", "miniflux.example.com")):
    seen = []

    def resolver(host, port, allow_private):
        seen.append((host, port, allow_private))
        return RELAY_IP

    return EgressRelayResolver("wallhop-egress", frozenset(allowed), resolver=resolver), seen


class EgressRelayTests(unittest.TestCase):
    def test_allowlisted_https_host_is_pinned_to_the_relay(self) -> None:
        resolver, seen = relay()
        self.assertEqual(resolver("WallHop.io.", 443), RELAY_IP)
        self.assertEqual(seen, [("wallhop-egress", 443, True)])

    def test_other_hosts_ip_literals_ports_and_ipv6_fail_closed(self) -> None:
        resolver, seen = relay()
        for host, port in (
            ("evil.example", 443),
            ("wallhop.io", 80),
            ("wallhop.io", 8443),
            ("93.184.216.34", 443),
            ("::1", 443),
            ("169.254.169.254", 443),
            ("miniflux", 8080),
            ("wallhop.io.evil.example", 443),
        ):
            with self.assertRaises(UnsafeURL, msg=(host, port)):
                resolver(host, port)
        self.assertEqual(seen, [])

    def test_allowlist_rejects_ip_literals_and_malformed_entries(self) -> None:
        for bad in (("10.0.0.1",), ("wallhop.io:443",), ("https://wallhop.io",), ()):
            with self.assertRaises(ValueError):
                EgressRelayResolver("wallhop-egress", frozenset(bad))

    def test_redirect_to_non_allowlisted_host_is_refused_before_connecting(self) -> None:
        resolver, _ = relay()
        connections = []

        def requester(url, ip, port, headers, timeout, max_bytes):
            connections.append((url, ip))
            return HTTPResponse(302, {"location": "https://attacker.example/x"}, b"", url)

        client = PinnedHTTPClient(resolver=resolver, requester=requester)
        with self.assertRaises(UnsafeURL):
            client.get("https://wallhop.io/raw/https://publisher.example/a")
        self.assertEqual(connections, [("https://wallhop.io/raw/https://publisher.example/a", RELAY_IP)])

    def test_https_downgrade_redirect_is_refused(self) -> None:
        resolver, _ = relay()
        client = PinnedHTTPClient(
            resolver=resolver,
            requester=lambda url, *a: HTTPResponse(301, {"location": "http://wallhop.io/raw/x"}, b"", url),
        )
        with self.assertRaises(UnsafeURL):
            client.get("https://wallhop.io/raw/x")

    def test_startup_requires_relay_when_policy_demands_it(self) -> None:
        self.assertIsNone(build_egress_http({}))
        with self.assertRaises(ValueError):
            build_egress_http({"CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY": "true"})
        with self.assertRaises(ValueError):
            build_egress_http({"CONTENT_FALLBACK_EGRESS_RELAY": "wallhop-egress", "CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS": ""})
        client = build_egress_http(
            {"CONTENT_FALLBACK_EGRESS_RELAY": "wallhop-egress", "CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS": "wallhop.io,miniflux.example.com"}
        )
        self.assertIsInstance(client, PinnedHTTPClient)


if __name__ == "__main__":
    unittest.main()


class WallHopThroughRelayTests(unittest.TestCase):
    """Regression: with the relay, publisher SSRF validation must use public DNS, not the egress map."""

    def _provider(self, publisher_answer):
        from services.content_fallback.content import assess_content
        from services.content_fallback.service import WallHopProvider

        calls = []

        def underlying(host, port, allow_private):
            calls.append((host, port, allow_private))
            if host == "wallhop-egress":
                return RELAY_IP
            if isinstance(publisher_answer, Exception):
                raise publisher_answer
            return publisher_answer

        sentences = (
            "Researchers compared water temperature, wind direction and shoreline movement at several coastal stations.",
            "Field notes recorded rainfall totals and tide levels across the northern survey locations every week.",
            "Analysts checked the collected records for gaps before comparing results from each monitoring station.",
            "Local observers documented conditions and shared dated reports with the coordinating research group.",
        )
        paragraphs = "".join(f"<p>{' '.join(sentences)} Survey number {i} extended the same method.</p>" for i in range(10))

        def requester(url, ip, port, headers, timeout, max_bytes):
            self.assertEqual(ip, RELAY_IP)
            return HTTPResponse(200, {"content-type": "text/html"}, f"<article>{paragraphs}</article>".encode(), url)

        resolver = EgressRelayResolver("wallhop-egress", frozenset({"wallhop.io"}), resolver=underlying)
        provider = WallHopProvider(http=PinnedHTTPClient(resolver=resolver, requester=requester), sleep=lambda _s: None)
        entry = type("Entry", (), {"url": "https://publisher.example/a", "title": "Synthetic story"})()
        original = assess_content("Synthetic story", "<p>Short teaser.</p>")
        return provider, entry, original, calls

    def test_public_publisher_is_validated_by_public_dns_then_fetched_via_relay(self) -> None:
        provider, entry, original, calls = self._provider("93.184.216.34")
        result = provider.recover(entry, original)
        self.assertEqual(result.provider, "wallhop.io")
        self.assertIn(("publisher.example", 443, False), calls)

    def test_private_publisher_address_is_still_refused(self) -> None:
        provider, entry, original, _ = self._provider(UnsafeURL("private"))
        with self.assertRaises(UnsafeURL):
            provider.recover(entry, original)
