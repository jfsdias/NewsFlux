#!/usr/bin/env python3
"""Exercise the isolated Caddy Reader Bridge route using synthetic containers."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CADDY_IMAGE = "caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af"
NGINX_IMAGE = "nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
PYTHON_IMAGE = "python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704"

MOCK_SIDECAR = r"""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer

state = {"requests": 0}
service = os.environ.get("MOCK_SERVICE", "reader")
port = int(os.environ.get("MOCK_PORT", "8790"))

class Handler(BaseHTTPRequestHandler):
    def _handle(self):
        state["requests"] += 1
        length = int(self.headers.get("content-length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        payload = {
            "service": service,
            "count": state["requests"],
            "method": self.command,
            "path": self.path,
            "body_bytes": len(body),
            "origin": self.headers.get("Origin"),
            "miniflux_key": self.headers.get("X-Miniflux-API-Key"),
            "miniflux_server": self.headers.get("X-NewsFlux-Miniflux-Server"),
            "forwarded_proto": self.headers.get("X-Forwarded-Proto"),
            "forwarded_for": self.headers.get("X-Forwarded-For"),
            "forwarded_host": self.headers.get("X-Forwarded-Host"),
            "forwarded": self.headers.get("Forwarded"),
            "authorization": self.headers.get("Authorization"),
            "cookie": self.headers.get("Cookie"),
            "client_certificate": self.headers.get("X-Forwarded-Client-Cert"),
            "forwarded_user": self.headers.get("X-Forwarded-User"),
            "forwarded_prefix": self.headers.get("X-Forwarded-Prefix"),
            "forwarded_port": self.headers.get("X-Forwarded-Port"),
            "forwarded_server": self.headers.get("X-Forwarded-Server"),
            "forwarded_ssl": self.headers.get("X-Forwarded-SSL"),
            "real_ip": self.headers.get("X-Real-IP"),
        }
        encoded = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    do_POST = _handle
    do_GET = _handle
    do_OPTIONS = _handle

    def log_message(self, *_args):
        pass

HTTPServer(("0.0.0.0", port), Handler).serve_forever()
"""

FORWARDED_HTTP_SPOOF_CLIENT = r"""
import os
import urllib.error
import urllib.request

url = "http://" + os.environ["CADDY_IP"] + ":2000/api/content-fallback/reader/v1/entries/42/recover"
headers = {
    "Host": "newsflux.test",
    "Origin": "https://newsflux.test",
    "X-Forwarded-Proto": "http",
    "X-Miniflux-API-Key": "synthetic-reader-key",
    "X-NewsFlux-Miniflux-Server": "http://miniflux.test",
}
request = urllib.request.Request(url, data=b"", headers=headers, method="POST")
try:
    with urllib.request.urlopen(request, timeout=3) as response:
        response.read()
        status = response.status
except urllib.error.HTTPError as error:
    status = error.code
assert status == 404, f"expected HTTP forwarding spoof to be denied, got {status}"
print("HTTP_FORWARDING_SPOOF_DENIED=PASS")
"""

TEST_CLIENT = r"""
import json
import time
import urllib.error
import urllib.request

proxy = "http://pilot-proxy:8080"
caddy = "http://reader-caddy:2000"
headers = {
    "Host": "newsflux.test",
    "Origin": "https://newsflux.test",
    "X-Miniflux-API-Key": "synthetic-reader-key",
    "X-NewsFlux-Miniflux-Server": "http://miniflux.test",
    "X-Forwarded-Proto": "http",
    "X-Forwarded-For": "198.51.100.77",
    "X-Forwarded-Host": "attacker.example",
    "Forwarded": "proto=http;host=attacker.example",
    "Authorization": "Bearer synthetic-decoy",
    "Cookie": "session=synthetic-decoy",
    "X-Forwarded-Client-Cert": "synthetic-decoy",
    "X-Forwarded-User": "synthetic-decoy",
    "X-Forwarded-Prefix": "/attacker",
    "X-Forwarded-Port": "4444",
    "X-Forwarded-Server": "attacker.example",
    "X-Forwarded-SSL": "off",
    "X-Real-IP": "198.51.100.77",
}

def request(url, path, method="POST", request_headers=None):
    req = urllib.request.Request(url + path, data=b"" if method == "POST" else None,
                                 headers=request_headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=2) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()

ready = False
for _ in range(50):
    try:
        status, _ = request(proxy, "/health", "GET", {"Host": "newsflux.test"})
        ready = status == 200
        if ready:
            break
    except Exception:
        pass
    time.sleep(0.1)
if not ready:
    raise SystemExit("TEST_PROXY_NOT_READY")

allowed = "/api/content-fallback/reader/v1/entries/42/recover"
status, body = request(proxy, allowed, "POST", headers)
assert status == 200, f"expected allowed route, got {status}"
received = json.loads(body)
assert received["count"] == 1
assert received["service"] == "reader"
assert received["method"] == "POST"
assert received["path"] == "/reader/v1/entries/42/recover"
assert received["body_bytes"] == 0
assert received["origin"] == "https://newsflux.test"
assert received["miniflux_key"] == "synthetic-reader-key"
assert received["miniflux_server"] == "http://miniflux.test"
assert received["forwarded_proto"] == "https"
assert received["forwarded_host"] == "newsflux.test"
assert received["forwarded_for"] != "198.51.100.77"
assert received["forwarded"] is None
assert received["authorization"] is None
assert received["cookie"] is None
assert received["client_certificate"] is None
assert received["forwarded_user"] is None
assert received["forwarded_prefix"] is None
assert received["forwarded_port"] is None
assert received["forwarded_server"] is None
assert received["forwarded_ssl"] is None
assert received["real_ip"] is None
print("CADDY_PATH_REWRITE=PASS")
print("CADDY_FORWARDED_HEADER_OVERWRITE=PASS")
print("CADDY_CREDENTIAL_HEADER_STRIP=PASS")
print("READER_ROUTE_ALLOWED_POST=PASS")
print("READER_PATH_REWRITE=PASS")
print("AUTHORIZATION_HEADER_STRIPPED=PASS")
print("COOKIE_HEADER_STRIPPED=PASS")

status, body = request(proxy, "/api/summary/r4-probe", "GET", {"Host": "newsflux.test"})
assert status == 200, f"synthetic Summary route returned {status}"
summary = json.loads(body)
assert summary["service"] == "summary" and summary["path"] == "/api/summary/r4-probe"
print("SUMMARY_ROUTE_PRESERVED=PASS")

status, body = request(proxy, "/api/story-ranker/r4-probe", "GET", {"Host": "newsflux.test"})
assert status == 200, f"synthetic Story route returned {status}"
story = json.loads(body)
assert story["service"] == "story" and story["path"] == "/api/story-ranker/r4-probe"
print("STORY_ROUTE_PRESERVED=PASS")

status, body = request(proxy, "/assets/r4-probe.txt", "GET", {"Host": "newsflux.test"})
assert status == 200 and body == b"NEWSFLUX_R4_STATIC_ASSET", "static asset route changed"
print("STATIC_ASSET_ROUTING_PRESERVED=PASS")

status, body = request(proxy, "/r4/spa/deep-link", "GET", {"Host": "newsflux.test"})
assert status == 200 and body == b"NEWSFLUX_R4_SPA_ENTRY", "SPA fallback route changed"
print("SPA_ROUTING_PRESERVED=PASS")

for method, path in [
    ("GET", allowed),
    ("OPTIONS", allowed),
    ("POST", "/api/content-fallback/v1/entries/42/recover"),
    ("POST", allowed + "/extra"),
    ("GET", "/api/content-fallback/healthz"),
]:
    status, _ = request(proxy, path, method, headers)
    assert status == 404, f"unexpected public route {method} {path}: {status}"

status, _ = request(caddy, allowed, "POST", headers)
assert status == 404, f"untrusted direct peer reached the bridge: {status}"
request(caddy, "/v1/entries/42/recover", "POST", headers)
request(caddy, "/healthz", "GET", headers)
status, body = request(proxy, allowed, "POST", headers)
assert status == 200, f"expected second allowed route, got {status}"
assert json.loads(body)["count"] == 2, "a denied or private-path request reached the sidecar"
print("CADDY_METHOD_AND_PRIVATE_PATH_DENY=PASS")
print("CADDY_UNTRUSTED_DIRECT_PEER_DENY=PASS")
print("CADDY_PRIVATE_ENDPOINTS_UNROUTED=PASS")
print("DENIED_REQUESTS_NOT_FORWARDED=PASS")
print("WRONG_METHOD_DENIED=PASS")
print("UNTRUSTED_PROXY_DENIED=PASS")
print("PRIVATE_SIDECAR_ENDPOINT_DENIED=PASS")
print("HEALTH_ENDPOINT_NOT_PUBLIC=PASS")
"""


def run(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if check and result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or "command failed"
        raise RuntimeError(f"{args[0]} failed: {message[-1200:]}")
    return result


def inspect_container(name: str) -> dict[str, object]:
    return json.loads(run(["docker", "inspect", name]).stdout)[0]


def container_ip(name: str, network: str) -> str:
    template = f"{{{{with index .NetworkSettings.Networks {json.dumps(network)}}}}}{{{{.IPAddress}}}}{{{{end}}}}"
    return run(["docker", "inspect", "--format", template, name]).stdout.strip()


def assert_no_published_ports(*names: str) -> None:
    for name in names:
        container = inspect_container(name)
        bindings = container.get("HostConfig", {}).get("PortBindings") or {}
        assert not any(bindings.values()), f"unexpected published port on {name}"


def main() -> None:
    suffix = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    network = f"newsflux-reader-route-{suffix}"
    names = [
        f"newsflux-reader-route-caddy-{suffix}",
        f"newsflux-reader-route-proxy-{suffix}",
        f"newsflux-reader-route-sidecar-{suffix}",
        f"newsflux-reader-route-summary-{suffix}",
        f"newsflux-reader-route-story-{suffix}",
    ]
    created_network = False
    try:
        with tempfile.TemporaryDirectory(prefix="newsflux-reader-caddy-") as temp:
            temp_path = Path(temp)
            fragment = ROOT / "deploy/content-fallback-reader-pilot/reader-recovery.caddy"
            caddyfile = temp_path / "Caddyfile"
            caddyfile.write_text(
                ":2000 {\n"
                "\t@summary path /api/summary/*\n"
                "\thandle @summary {\n"
                "\t\treverse_proxy newsflux-summary:8791\n"
                "\t}\n"
                "\t@story path /api/story-ranker/*\n"
                "\thandle @story {\n"
                "\t\treverse_proxy newsflux-story:8792\n"
                "\t}\n"
                "\thandle /assets/* {\n"
                "\t\troot * /srv/newsflux\n"
                "\t\tfile_server\n"
                "\t}\n"
                "\thandle {\n"
                "\t\troot * /srv/newsflux\n"
                "\t\ttry_files {path} /index.html\n"
                "\t\tfile_server\n"
                "\t}\n"
                "\timport /etc/caddy/reader-recovery.caddy\n"
                "}\n",
                encoding="utf-8",
            )
            static_root = temp_path / "www"
            (static_root / "assets").mkdir(parents=True)
            (static_root / "assets/r4-probe.txt").write_text("NEWSFLUX_R4_STATIC_ASSET", encoding="utf-8")
            (static_root / "index.html").write_text("NEWSFLUX_R4_SPA_ENTRY", encoding="utf-8")
            proxy_config = temp_path / "default.conf"
            proxy_config.write_text(
                "server {\n"
                "  listen 8080;\n"
                "  location / {\n"
                "    proxy_set_header Host $host;\n"
                "    proxy_set_header Origin $http_origin;\n"
                "    proxy_set_header X-Miniflux-API-Key $http_x_miniflux_api_key;\n"
                "    proxy_set_header X-NewsFlux-Miniflux-Server $http_x_newsflux_miniflux_server;\n"
                "    proxy_set_header X-Forwarded-Proto https;\n"
                "    proxy_set_header X-Forwarded-For $remote_addr;\n"
                "    proxy_set_header X-Forwarded-Host $host;\n"
                "    proxy_pass http://reader-caddy:2000;\n"
                "  }\n"
                "}\n",
                encoding="utf-8",
            )

            run(["docker", "network", "create", "--internal", network])
            created_network = True
            run(
                [
                    "docker", "run", "--detach", "--name", names[2], "--network", network,
                    "--network-alias", "content-fallback-reader", PYTHON_IMAGE,
                    "python3", "-u", "-c", MOCK_SIDECAR,
                ]
            )
            run(
                [
                    "docker", "run", "--detach", "--name", names[3], "--network", network,
                    "--network-alias", "newsflux-summary", "--env", "MOCK_SERVICE=summary",
                    "--env", "MOCK_PORT=8791", PYTHON_IMAGE, "python3", "-u", "-c", MOCK_SIDECAR,
                ]
            )
            run(
                [
                    "docker", "run", "--detach", "--name", names[4], "--network", network,
                    "--network-alias", "newsflux-story", "--env", "MOCK_SERVICE=story",
                    "--env", "MOCK_PORT=8792", PYTHON_IMAGE, "python3", "-u", "-c", MOCK_SIDECAR,
                ]
            )
            run(
                [
                    "docker", "run", "--detach", "--name", names[1], "--network", network,
                    "--network-alias", "pilot-proxy", "--mount",
                    f"type=bind,src={proxy_config},dst=/etc/nginx/conf.d/default.conf,readonly",
                    NGINX_IMAGE,
                ]
            )
            proxy_ip = container_ip(names[1], network)
            if not proxy_ip:
                raise RuntimeError("could not resolve the synthetic trusted proxy address")
            run(
                [
                    "docker", "run", "--detach", "--name", names[0], "--network", network,
                    "--network-alias", "reader-caddy", "--env",
                    f"NEWSFLUX_PILOT_TRUSTED_PROXY_IP={proxy_ip}", "--mount",
                    f"type=bind,src={caddyfile},dst=/etc/caddy/Caddyfile,readonly", "--mount",
                    f"type=bind,src={fragment},dst=/etc/caddy/reader-recovery.caddy,readonly",
                    "--mount", f"type=bind,src={static_root},dst=/srv/newsflux,readonly",
                    CADDY_IMAGE, "caddy", "run", "--config", "/etc/caddy/Caddyfile",
                    "--adapter", "caddyfile",
                ]
            )
            assert_no_published_ports(*names)
            network_info = json.loads(run(["docker", "network", "inspect", network]).stdout)[0]
            assert network_info.get("Internal") is True
            client_result = run(
                [
                    "docker", "run", "--rm", "--network", network, PYTHON_IMAGE,
                    "python3", "-c", TEST_CLIENT,
                ]
            )
            print("CADDY_CONFIG_PARSE=PASS")
            print(client_result.stdout.strip())
            caddy_ip = container_ip(names[0], network)
            if not caddy_ip:
                raise RuntimeError("could not resolve the synthetic Caddy address")
            spoof_result = run(
                [
                    "docker", "run", "--rm", "--network", f"container:{names[1]}",
                    "--env", f"CADDY_IP={caddy_ip}", PYTHON_IMAGE, "python3", "-c",
                    FORWARDED_HTTP_SPOOF_CLIENT,
                ]
            )
            print(spoof_result.stdout.strip())
            print("MINIFLUX_IDENTITY_HEADERS_PRESERVED=PASS")
            print("PRIVATE_TEST_NETWORK=PASS")
            print("NO_PUBLISHED_TEST_PORTS=PASS")
            print("MINIFLUX_WRITES=0")
            print("REAL_WALLHOP_REQUESTS=0")
            print("LITELLM_REQUESTS=0")
            print("FINAL=PASS")
    finally:
        for name in names:
            run(["docker", "rm", "--force", name], check=False)
        if created_network:
            run(["docker", "network", "rm", network], check=False)


if __name__ == "__main__":
    main()
