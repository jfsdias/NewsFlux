from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urljoin, urlsplit, urlunsplit

MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_REDIRECTS = 3
DEFAULT_TIMEOUT_SECONDS = 8


class FetchError(RuntimeError):
    """A bounded, safe-to-log outbound request failure."""


class UnsafeURL(FetchError):
    pass


@dataclass(frozen=True)
class HTTPResponse:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str


Resolver = Callable[[str, int, bool], str]
Requester = Callable[[str, str, int, dict[str, str], float, int], HTTPResponse]
PostRequester = Callable[[str, str, int, dict[str, str], float, int, bytes], HTTPResponse]


def _origin(url: str) -> tuple[str, str, int]:
    parts = urlsplit(url)
    scheme = parts.scheme.casefold()
    host = (parts.hostname or "").casefold()
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeURL("invalid port") from exc
    return scheme, host, port


def _validate_url(url: str) -> str:
    if not isinstance(url, str) or not url or len(url) > 8192:
        raise UnsafeURL("invalid URL")
    parts = urlsplit(url)
    if parts.scheme.casefold() not in {"http", "https"} or not parts.hostname:
        raise UnsafeURL("only absolute HTTP and HTTPS URLs are allowed")
    if parts.username is not None or parts.password is not None:
        raise UnsafeURL("URLs containing credentials are not allowed")
    if any(char in url for char in "\r\n\x00"):
        raise UnsafeURL("URL contains invalid characters")
    if parts.fragment:
        parts = parts._replace(fragment="")
    return urlunsplit(parts)


def resolve_host(host: str, port: int, allow_private: bool = False) -> str:
    """Resolve all answers and pin the request to one validated address."""

    if not host:
        raise UnsafeURL("hostname is missing")
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, socket.gaierror) as exc:
        raise FetchError("DNS resolution failed") from exc
    if not answers:
        raise FetchError("DNS returned no addresses")
    addresses: list[str] = []
    for answer in answers:
        raw_address = answer[4][0].split("%", 1)[0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise UnsafeURL("DNS returned an invalid address") from exc
        classified = address
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
            classified = address.ipv4_mapped
        if not allow_private and (not classified.is_global or classified.is_multicast):
            raise UnsafeURL("URL resolves to a non-public address")
        addresses.append(str(address))
    return addresses[0]


def _request_pinned(
    url: str,
    pinned_ip: str,
    port: int,
    headers: dict[str, str],
    timeout: float,
    max_bytes: int,
) -> HTTPResponse:
    parts = urlsplit(url)
    host = parts.hostname or ""
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query
    if target.startswith("//") or "\r" in target or "\n" in target:
        raise UnsafeURL("invalid request path")

    request_headers = {
        "Host": host
        if (parts.scheme.casefold() == "http" and port == 80)
        or (parts.scheme.casefold() == "https" and port == 443)
        else f"{host}:{port}",
        "Connection": "close",
        "Accept-Encoding": "identity",
        "User-Agent": "NewsFlux-ContentFallback/0.1",
        **headers,
    }
    sock: socket.socket | None = None
    connection: http.client.HTTPConnection | None = None
    try:
        sock = socket.create_connection((pinned_ip, port), timeout=timeout)
        sock.settimeout(timeout)
        if parts.scheme.casefold() == "https":
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        connection_type = http.client.HTTPSConnection if parts.scheme.casefold() == "https" else http.client.HTTPConnection
        connection = connection_type(host, port=port, timeout=timeout)
        connection.sock = sock
        sock = None
        connection.request("GET", target, headers=request_headers)
        response = connection.getresponse()
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise FetchError("response exceeds the configured size limit")
        response_headers = {key.casefold(): value for key, value in response.getheaders()}
        if response_headers.get("content-encoding", "identity").casefold() not in {"", "identity"}:
            raise FetchError("compressed responses are not accepted")
        return HTTPResponse(response.status, response_headers, body, url)
    except (OSError, http.client.HTTPException, ssl.SSLError, TimeoutError) as exc:
        raise FetchError("upstream request failed") from exc
    finally:
        if connection is not None:
            connection.close()
        if sock is not None:
            sock.close()


def _request_pinned_post(
    url: str,
    pinned_ip: str,
    port: int,
    headers: dict[str, str],
    timeout: float,
    max_bytes: int,
    body: bytes,
) -> HTTPResponse:
    parts = urlsplit(url)
    host = parts.hostname or ""
    target = parts.path or "/"
    if parts.query:
        target += "?" + parts.query
    if target.startswith("//") or "\r" in target or "\n" in target:
        raise UnsafeURL("invalid request path")

    request_headers = {
        "Host": host
        if (parts.scheme.casefold() == "http" and port == 80)
        or (parts.scheme.casefold() == "https" and port == 443)
        else f"{host}:{port}",
        "Connection": "close",
        "Accept-Encoding": "identity",
        "User-Agent": "NewsFlux-ContentFallback/0.1",
        "Content-Length": str(len(body)),
        **headers,
    }
    sock: socket.socket | None = None
    connection: http.client.HTTPConnection | None = None
    try:
        sock = socket.create_connection((pinned_ip, port), timeout=timeout)
        sock.settimeout(timeout)
        if parts.scheme.casefold() == "https":
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        connection_type = http.client.HTTPSConnection if parts.scheme.casefold() == "https" else http.client.HTTPConnection
        connection = connection_type(host, port=port, timeout=timeout)
        connection.sock = sock
        sock = None
        connection.request("POST", target, body=body, headers=request_headers)
        response = connection.getresponse()
        response_body = response.read(max_bytes + 1)
        if len(response_body) > max_bytes:
            raise FetchError("response exceeds the configured size limit")
        response_headers = {key.casefold(): value for key, value in response.getheaders()}
        if response_headers.get("content-encoding", "identity").casefold() not in {"", "identity"}:
            raise FetchError("compressed responses are not accepted")
        return HTTPResponse(response.status, response_headers, response_body, url)
    except (OSError, http.client.HTTPException, ssl.SSLError, TimeoutError) as exc:
        raise FetchError("upstream request failed") from exc
    finally:
        if connection is not None:
            connection.close()
        if sock is not None:
            sock.close()


class PinnedHTTPClient:
    """GET-only client with DNS pinning and validation at every redirect hop."""

    def __init__(
        self,
        *,
        resolver: Resolver = resolve_host,
        requester: Requester = _request_pinned,
        post_requester: PostRequester = _request_pinned_post,
    ) -> None:
        self._resolver = resolver
        self._requester = requester
        self._post_requester = post_requester

    def get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_bytes: int = MAX_RESPONSE_BYTES,
        max_redirects: int = MAX_REDIRECTS,
        same_origin: str | None = None,
        allow_private_origin: bool = False,
    ) -> HTTPResponse:
        initial_url = _validate_url(url)
        current_url = initial_url
        allowed_origin = _origin(same_origin) if same_origin else None
        initial_origin = _origin(initial_url)
        if allowed_origin is not None and initial_origin != allowed_origin:
            raise UnsafeURL("request is outside the configured service origin")
        current_headers = dict(headers or {})

        for redirect_count in range(max_redirects + 1):
            current_url = _validate_url(current_url)
            scheme, host, port = _origin(current_url)
            if allowed_origin is not None and _origin(current_url) != allowed_origin:
                raise UnsafeURL("redirect is outside the configured service origin")
            pinned_ip = self._resolver(host, port, allow_private_origin and allowed_origin is not None)
            response = self._requester(current_url, pinned_ip, port, current_headers, timeout, max_bytes)
            if len(response.body) > max_bytes:
                raise FetchError("response exceeds the configured size limit")
            if response.status not in {301, 302, 303, 307, 308}:
                if response.headers.get("content-encoding", "identity").casefold() not in {"", "identity"}:
                    raise FetchError("compressed responses are not accepted")
                return response
            location = response.headers.get("location")
            if not location:
                raise FetchError("redirect has no destination")
            next_url = _validate_url(urljoin(current_url, location))
            next_origin = _origin(next_url)
            if initial_origin[0] == "https" and next_origin[0] != "https":
                raise UnsafeURL("HTTPS redirects may not downgrade to HTTP")
            if allowed_origin is not None and next_origin != allowed_origin:
                raise UnsafeURL("redirect is outside the configured service origin")
            if redirect_count >= max_redirects:
                raise FetchError("too many redirects")
            if next_origin != _origin(current_url):
                # Never carry credentials or caller headers across origins.
                current_headers = {}
            current_url = next_url
        raise FetchError("too many redirects")

    def post(
        self,
        url: str,
        body: bytes,
        *,
        headers: dict[str, str] | None = None,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_bytes: int = MAX_RESPONSE_BYTES,
        same_origin: str,
        allow_private_origin: bool = False,
    ) -> HTTPResponse:
        if not isinstance(body, bytes):
            raise UnsafeURL("request body must be bytes")
        initial_url = _validate_url(url)
        allowed_origin = _origin(same_origin)
        if _origin(initial_url) != allowed_origin:
            raise UnsafeURL("request is outside the configured service origin")
        _, host, port = _origin(initial_url)
        pinned_ip = self._resolver(host, port, allow_private_origin)
        response = self._post_requester(
            initial_url,
            pinned_ip,
            port,
            dict(headers or {}),
            timeout,
            max_bytes,
            body,
        )
        if len(response.body) > max_bytes:
            raise FetchError("response exceeds the configured size limit")
        if response.headers.get("content-encoding", "identity").casefold() not in {"", "identity"}:
            raise FetchError("compressed responses are not accepted")
        return response


class EgressRelayResolver:
    """Route only allowlisted HTTPS destinations through the private egress relay.

    The sidecar has no direct route to the Internet or to Miniflux. Each allowlisted
    (host, 443) pair is pinned to the relay's private address; TLS still validates the
    original hostname end-to-end, and the relay forwards by SNI only for the same
    allowlist. Any other host, any IP literal, any other port, and therefore any redirect
    to such a destination, fails closed before a connection is opened.
    """

    def __init__(self, relay_host: str, allowed_hosts: frozenset[str], *, resolver: Resolver = resolve_host) -> None:
        if not relay_host or not allowed_hosts:
            raise ValueError("egress relay host and allowlist are required")
        normalized = set()
        for host in allowed_hosts:
            candidate = host.strip().casefold().rstrip(".")
            try:
                ipaddress.ip_address(candidate)
            except ValueError:
                pass
            else:
                raise ValueError("egress allowlist must contain hostnames, not IP literals")
            if not candidate or "/" in candidate or ":" in candidate:
                raise ValueError("egress allowlist entries must be bare hostnames")
            normalized.add(candidate)
        self.relay_host = relay_host
        self.allowed_hosts = frozenset(normalized)
        self._resolver = resolver

    def __call__(self, host: str, port: int, allow_private: bool = False) -> str:
        del allow_private
        candidate = (host or "").casefold().rstrip(".")
        if port != 443 or candidate not in self.allowed_hosts:
            raise UnsafeURL("destination is outside the egress allowlist")
        # The relay is a private service on an internal network; nothing else may be private.
        return self._resolver(self.relay_host, 443, True)
