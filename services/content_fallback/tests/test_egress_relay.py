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
