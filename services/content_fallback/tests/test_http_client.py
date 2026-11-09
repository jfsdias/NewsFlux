from __future__ import annotations

import ipaddress
import socket
import unittest
from unittest.mock import patch

from services.content_fallback.http_client import (
    FetchError,
    HTTPResponse,
    PinnedHTTPClient,
    UnsafeURL,
    resolve_host,
)


def address_info(address: str, port: int):
    parsed = ipaddress.ip_address(address)
    family = socket.AF_INET if parsed.version == 4 else socket.AF_INET6
    sockaddr = (address, port) if parsed.version == 4 else (address, port, 0, 0)
    return family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr


class ResolveHostTests(unittest.TestCase):
    def test_public_ipv4_is_accepted_and_returned_for_pinning(self) -> None:
        answer = address_info("93.184.216.34", 443)
        with patch("socket.getaddrinfo", return_value=[answer]) as getaddrinfo:
            result = resolve_host("public.example", 443)

        self.assertEqual(result, "93.184.216.34")
        getaddrinfo.assert_called_once_with("public.example", 443, type=socket.SOCK_STREAM)

    def test_private_ipv4_loopback_link_local_and_cloud_metadata_are_blocked(self) -> None:
        addresses = {
            "private": "10.20.30.40",
            "loopback": "127.0.0.1",
            "link-local": "169.254.12.34",
            "cloud metadata": "169.254.169.254",
        }
        for label, address in addresses.items():
            with self.subTest(label=label), patch(
                "socket.getaddrinfo", return_value=[address_info(address, 443)]
            ):
                with self.assertRaises(UnsafeURL):
                    resolve_host("probe.example", 443)

    def test_public_ipv6_is_accepted(self) -> None:
        answer = address_info("2606:4700:4700::1111", 443)
        with patch("socket.getaddrinfo", return_value=[answer]):
            self.assertEqual(resolve_host("public.example", 443), "2606:4700:4700::1111")

    def test_ipv6_ula_and_loopback_are_blocked(self) -> None:
        for address in ("fd00::1", "::1"):
            with self.subTest(address=address), patch(
                "socket.getaddrinfo", return_value=[address_info(address, 443)]
            ):
                with self.assertRaises(UnsafeURL):
                    resolve_host("probe.example", 443)

    def test_ipv4_mapped_ipv6_uses_the_mapped_ipv4_classification(self) -> None:
        public_mapped = address_info("::ffff:93.184.216.34", 443)
        private_mapped = address_info("::ffff:10.20.30.40", 443)
        with patch("socket.getaddrinfo", return_value=[public_mapped]):
            self.assertEqual(resolve_host("public.example", 443), "::ffff:93.184.216.34")
        with patch("socket.getaddrinfo", return_value=[private_mapped]):
            with self.assertRaises(UnsafeURL):
                resolve_host("probe.example", 443)

    def test_mixed_public_and_private_dns_answers_are_rejected(self) -> None:
        answers = [
            address_info("2606:4700:4700::1111", 443),
            address_info("10.20.30.40", 443),
        ]
        with patch("socket.getaddrinfo", return_value=answers):
            with self.assertRaises(UnsafeURL):
                resolve_host("mixed.example", 443)

    def test_invalid_address_and_dns_errors_fail_with_controlled_errors(self) -> None:
        invalid_answer = (
            socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            ("not-an-ip", 443),
        )
        with patch("socket.getaddrinfo", return_value=[invalid_answer]):
            with self.assertRaises(UnsafeURL):
                resolve_host("invalid.example", 443)

        with patch("socket.getaddrinfo", side_effect=socket.gaierror("no answer")):
            with self.assertRaises(FetchError):
                resolve_host("missing.example", 443)

        with patch("socket.getaddrinfo", return_value=[]):
            with self.assertRaises(FetchError):
                resolve_host("empty.example", 443)


class PinnedHTTPClientTests(unittest.TestCase):
    def test_private_post_pins_the_configured_origin_and_never_follows_redirects(self) -> None:
        requests = []

        def resolver(host, port, allow_private):
            self.assertEqual((host, port, allow_private), ("content-fallback", 8790, True))
            return "10.0.0.8"

        def post_requester(url, pinned_ip, port, headers, timeout, max_bytes, body):
            requests.append((url, pinned_ip, port, headers, timeout, max_bytes, body))
            return HTTPResponse(200, {"content-type": "application/json"}, b"{}", url)

        client = PinnedHTTPClient(resolver=resolver, post_requester=post_requester)
        response = client.post(
            "http://content-fallback:8790/v1/entries/42/recover",
            b"",
            headers={"Authorization": "Bearer internal-only"},
            same_origin="http://content-fallback:8790",
            allow_private_origin=True,
        )
        self.assertEqual(response.body, b"{}")
        self.assertEqual(requests[0][1], "10.0.0.8")
        self.assertEqual(requests[0][-1], b"")
        self.assertEqual(requests[0][3]["Authorization"], "Bearer internal-only")

    def test_private_post_rejects_another_origin_before_network_access(self) -> None:
        calls = []
        client = PinnedHTTPClient(
            resolver=lambda *_args: "10.0.0.8",
            post_requester=lambda *args: calls.append(args),
        )
        with self.assertRaises(UnsafeURL):
            client.post(
                "http://attacker.example/v1/entries/42/recover",
                b"",
                same_origin="http://content-fallback:8790",
                allow_private_origin=True,
            )
        self.assertEqual(calls, [])

    def test_http_client_uses_default_dns_resolver_with_mocked_transport(self) -> None:
        requests: list[tuple[str, str]] = []
        answer = address_info("93.184.216.34", 443)

        def requester(url, pinned_ip, _port, _headers, _timeout, _max_bytes):
            requests.append((url, pinned_ip))
            return HTTPResponse(200, {"content-type": "text/html"}, b"ok", url)

        with patch("socket.getaddrinfo", return_value=[answer]) as getaddrinfo:
            client = PinnedHTTPClient(requester=requester)
            result = client.get("https://wallhop.io/raw/encoded")

        self.assertEqual(result.body, b"ok")
        self.assertEqual(requests, [("https://wallhop.io/raw/encoded", "93.184.216.34")])
        getaddrinfo.assert_called_once_with("wallhop.io", 443, type=socket.SOCK_STREAM)

    def test_raw_wallhop_url_query_and_percent_escapes_reach_http_request_unchanged(self) -> None:
        request_targets: list[tuple[str, str]] = []

        class FakeSocket:
            def settimeout(self, _timeout):
                pass

            def close(self):
                pass

        class FakeResponse:
            status = 200

            def read(self, _limit):
                return b"ok"

            def getheaders(self):
                return [("content-type", "text/plain")]

        class FakeConnection:
            def __init__(self, _host, *, port, timeout):
                self.port = port
                self.timeout = timeout
                self.sock = None

            def request(self, method, target, *, headers):
                request_targets.append((method, target))

            def getresponse(self):
                return FakeResponse()

            def close(self):
                pass

        class FakeSSLContext:
            def wrap_socket(self, sock, *, server_hostname):
                self.server_hostname = server_hostname
                return sock

        source = "https://example.com/a%2Fb?next=%3Fpage%3D2&label=a%26b"
        url = "https://wallhop.io/raw/" + source
        with (
            patch("socket.getaddrinfo", return_value=[address_info("93.184.216.34", 443)]),
            patch("socket.create_connection", return_value=FakeSocket()),
            patch("ssl.create_default_context", return_value=FakeSSLContext()),
            patch("http.client.HTTPSConnection", FakeConnection),
        ):
            response = PinnedHTTPClient().get(url, max_redirects=0)

        self.assertEqual(response.body, b"ok")
        self.assertEqual(
            request_targets,
            [("GET", "/raw/https://example.com/a%2Fb?next=%3Fpage%3D2&label=a%26b")],
        )

    def test_default_dns_resolver_repins_each_redirect_with_mocked_transport(self) -> None:
        requests: list[tuple[str, str]] = []
        responses = [
            HTTPResponse(302, {"location": "https://cdn.example.test/article"}, b"", ""),
            HTTPResponse(200, {"content-type": "text/html"}, b"ok", ""),
        ]
        answers = [
            [address_info("93.184.216.34", 443)],
            [address_info("1.1.1.1", 443)],
        ]

        def requester(url, pinned_ip, _port, _headers, _timeout, _max_bytes):
            requests.append((url, pinned_ip))
            return responses.pop(0)

        with patch("socket.getaddrinfo", side_effect=answers) as getaddrinfo:
            client = PinnedHTTPClient(requester=requester)
            result = client.get("https://wallhop.io/raw/encoded", max_redirects=1)

        self.assertEqual(result.body, b"ok")
        self.assertEqual(
            requests,
            [
                ("https://wallhop.io/raw/encoded", "93.184.216.34"),
                ("https://cdn.example.test/article", "1.1.1.1"),
            ],
        )
        self.assertEqual(getaddrinfo.call_count, 2)

    def test_each_redirect_is_resolved_and_pinned(self) -> None:
        calls: list[tuple[str, str]] = []
        responses = [
            HTTPResponse(302, {"location": "https://cdn.example.test/article"}, b"", ""),
            HTTPResponse(200, {"content-type": "text/html"}, b"ok", ""),
        ]

        def resolver(host: str, _port: int, _allow_private: bool) -> str:
            return {"wallhop.io": "203.0.113.10", "cdn.example.test": "203.0.113.11"}[host]

        def requester(url, ip, _port, _headers, _timeout, _max_bytes):
            calls.append((url, ip))
            return responses.pop(0)

        client = PinnedHTTPClient(resolver=resolver, requester=requester)
        result = client.get("https://wallhop.io/raw/encoded", max_redirects=1)
        self.assertEqual(result.body, b"ok")
        self.assertEqual(calls[0][1], "203.0.113.10")
        self.assertEqual(calls[1][1], "203.0.113.11")

    def test_private_redirect_is_rejected_before_request(self) -> None:
        requested: list[str] = []

        def requester(url, _ip, _port, _headers, _timeout, _max_bytes):
            requested.append(url)
            return HTTPResponse(302, {"location": "http://10.20.30.40/admin"}, b"", url)

        answers = [[address_info("93.184.216.34", 443)], [address_info("10.20.30.40", 80)]]
        with patch("socket.getaddrinfo", side_effect=answers):
            client = PinnedHTTPClient(requester=requester)
            with self.assertRaises(UnsafeURL):
                client.get("https://wallhop.io/raw/encoded")
        self.assertEqual(len(requested), 1)

    def test_private_miniflux_origin_requires_the_trusted_same_origin_path(self) -> None:
        requests: list[tuple[str, str]] = []
        url = "http://miniflux:8080/v1/entries/42"
        origin = "http://miniflux:8080"
        answer = address_info("10.0.0.4", 8080)

        def requester(request_url, pinned_ip, _port, _headers, _timeout, _max_bytes):
            requests.append((request_url, pinned_ip))
            return HTTPResponse(200, {"content-type": "application/json"}, b"{}", request_url)

        with patch("socket.getaddrinfo", return_value=[answer]):
            client = PinnedHTTPClient(requester=requester)
            with self.assertRaises(UnsafeURL):
                client.get(url, same_origin=origin)
            with self.assertRaises(UnsafeURL):
                client.get(url, allow_private_origin=True)
            result = client.get(url, same_origin=origin, allow_private_origin=True)

        self.assertEqual(result.body, b"{}")
        self.assertEqual(requests, [(url, "10.0.0.4")])

    def test_miniflux_service_redirect_must_stay_on_configured_origin(self) -> None:
        calls: list[str] = []

        def requester(url, _ip, _port, _headers, _timeout, _max_bytes):
            calls.append(url)
            return HTTPResponse(302, {"location": "http://127.0.0.1/private"}, b"", url)

        client = PinnedHTTPClient(
            resolver=lambda *_args: "10.0.0.4",
            requester=requester,
        )
        with self.assertRaises(UnsafeURL):
            client.get(
                "http://miniflux:8080/v1/entries/42",
                headers={"X-Auth-Token": "token"},
                max_redirects=0,
                same_origin="http://miniflux:8080",
                allow_private_origin=True,
            )
        self.assertEqual(len(calls), 1)

    def test_response_size_is_checked_even_for_injected_transport(self) -> None:
        client = PinnedHTTPClient(
            resolver=lambda *_args: "203.0.113.10",
            requester=lambda url, *_args: HTTPResponse(200, {}, b"12345", url),
        )
        with self.assertRaisesRegex(Exception, "size limit"):
            client.get("https://wallhop.io/raw/x", max_bytes=4)

    def test_https_redirect_cannot_downgrade_to_http(self) -> None:
        client = PinnedHTTPClient(
            resolver=lambda *_args: "203.0.113.10",
            requester=lambda url, *_args: HTTPResponse(302, {"location": "http://wallhop.io/x"}, b"", url),
        )
        with self.assertRaisesRegex(UnsafeURL, "downgrade"):
            client.get("https://wallhop.io/raw/x")


if __name__ == "__main__":
    unittest.main()
