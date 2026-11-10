from __future__ import annotations

import ipaddress
import json
import os
import secrets
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from provenance import SourceProvenanceError, validate_source_provenance

EVENT_NAME = os.environ.get("GITHUB_EVENT_NAME", "")
EXPECTED_BASE_SHA = os.environ.get("NEWSFLUX_EXPECTED_BASE_SHA", "")
CANDIDATE_SHA = os.environ.get("NEWSFLUX_CANDIDATE_SHA", os.environ.get("GITHUB_SHA", ""))
APP_HOST = "newsflux.test"
APP_PORT = 8443
APP_ORIGIN = f"https://{APP_HOST}:{APP_PORT}"
APP_CONNECT_IP = "127.0.0.1"
MINIFLUX_BASE_URL = f"{APP_ORIGIN}/miniflux"
USER_ID = 7
READER_PATH = "/api/content-fallback/reader/v1/entries"
PYTHON_BASE = "python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704"
# Docker Hub's official nginx:1.27-alpine OCI index digest, resolved 2026-11-10.
PROXY_IMAGE = "nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
WORKFLOW_RUN = os.environ.get("GITHUB_RUN_ID", "local")
WORKFLOW_ATTEMPT = os.environ.get("GITHUB_RUN_ATTEMPT", "1")

ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = Path(os.environ.get("NEWSFLUX_SOURCE_ROOT", ROOT / "source")).resolve()
OUTPUT_ROOT = Path(os.environ.get("NEWSFLUX_OUTPUT_ROOT", ROOT / "test-results" / "reader-wallhop-p1-r2")).resolve()
FIXTURE_FILE = ROOT / "scripts" / "reader-wallhop-p1-r2" / "fixture_server.py"
BROWSER_FILE = ROOT / "scripts" / "reader-wallhop-p1-r2" / "browser.mjs"

RESULT: dict[str, Any] = {
    "MAIN_SHA": "NOT_VERIFIED",
    "EXPECTED_BASE_SHA": "NOT_VERIFIED",
    "CANDIDATE_SHA": "NOT_VERIFIED",
    "SOURCE_SHA": "NOT_VERIFIED",
    "DOCKER_VERSION": "NOT_VERIFIED",
    "PROXY_IMAGE_REFERENCE": PROXY_IMAGE,
    "PROXY_IMAGE_ID": "NOT_PULLED",
    "FRONTEND_IMAGE_ID": "NOT_BUILT",
    "SIDECAR_IMAGE_ID": "NOT_BUILT",
    "DOCKER_IMAGE_GATE": "NOT_RUN",
    "FRONTEND_BUILD_GATE": "NOT_RUN",
    "SIDECAR_STARTUP_GATE": "NOT_RUN",
    "TLS_INGRESS_GATE": "NOT_RUN",
    "SAME_ORIGIN_GATE": "NOT_RUN",
    "PROXY_TRUST_GATE": "NOT_RUN",
    "AUTHORIZATION_GATE": "NOT_RUN",
    "NEGATIVE_SECURITY_TESTS": "NOT_RUN",
    "READER_BROWSER_GATE": "NOT_RUN",
    "SESSION_PROTECTION": "NOT_RUN",
    "ORIGINAL_FALLBACK": "NOT_RUN",
    "MINIFLUX_WRITES": "NOT_RUN",
    "REAL_WALLHOP_REQUESTS": "NOT_RUN",
    "CLEANUP_GATE": "NOT_RUN",
    "FINAL": "FAIL",
}

CONTAINERS: list[str] = []
IMAGES: list[str] = []
NETWORK_NAME = ""
TEMP_ROOT: Path | None = None
CURRENT_STEP = "PREFLIGHT"
USER_KEY = secrets.token_urlsafe(32)
ROTATED_KEY = secrets.token_urlsafe(32)
OTHER_USER_KEY = secrets.token_urlsafe(32)
ADMIN_KEY = secrets.token_urlsafe(32)
PRIVATE_SERVICE_KEY = secrets.token_urlsafe(48)


def redact_secrets(value: str) -> str:
    for secret in (USER_KEY, ROTATED_KEY, OTHER_USER_KEY, ADMIN_KEY, PRIVATE_SERVICE_KEY):
        value = value.replace(secret, "[redacted]")
    return value


def command(
    args: list[str],
    *,
    step: str,
    check: bool = True,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    global CURRENT_STEP
    CURRENT_STEP = step
    result = subprocess.run(
        args,
        check=False,
        capture_output=True,
        text=True,
        env=env,
        input=input_text,
    )
    if check and result.returncode != 0:
        tail = (result.stderr or result.stdout).splitlines()[-16:]
        safe_tail = redact_secrets("\n".join(tail))
        if safe_tail:
            print(f"STEP_DIAGNOSTIC_BEGIN={step}", flush=True)
            print(safe_tail, flush=True)
            print(f"STEP_DIAGNOSTIC_END={step}", flush=True)
        raise RuntimeError(f"{step} failed with exit code {result.returncode}")
    return result


def docker_json(args: list[str], *, step: str) -> Any:
    result = command(["docker", *args], step=step)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{step} returned invalid JSON") from exc


def inspect_container(name: str) -> dict[str, Any]:
    return docker_json(["inspect", name], step=f"Inspect {name}")[0]


def check_exact_source(live_main_sha: str) -> str:
    global CURRENT_STEP
    CURRENT_STEP = "EXACT_SOURCE_SHA"
    actual = command(
        ["git", "-C", str(SOURCE_ROOT), "rev-parse", "--verify", "HEAD"],
        step=CURRENT_STEP,
    ).stdout.strip()
    status = command(
        ["git", "-C", str(SOURCE_ROOT), "status", "--porcelain"],
        step="SOURCE_TREE_CLEAN",
    ).stdout.strip()
    if status:
        raise RuntimeError("Source checkout was not clean before creating the test-only build environment")

    base_is_ancestor = command(
        [
            "git",
            "-C",
            str(SOURCE_ROOT),
            "merge-base",
            "--is-ancestor",
            EXPECTED_BASE_SHA,
            CANDIDATE_SHA,
        ],
        step="CANDIDATE_BASE_PROVENANCE",
        check=False,
    ).returncode == 0
    try:
        provenance = validate_source_provenance(
            event_name=EVENT_NAME,
            expected_base_sha=EXPECTED_BASE_SHA,
            candidate_sha=CANDIDATE_SHA,
            live_main_sha=live_main_sha,
            checkout_sha=actual,
            candidate_is_based_on_base=base_is_ancestor,
        )
    except SourceProvenanceError as exc:
        raise RuntimeError(str(exc)) from exc

    RESULT["EXPECTED_BASE_SHA"] = provenance["base_sha"]
    RESULT["CANDIDATE_SHA"] = provenance["candidate_sha"]
    RESULT["SOURCE_SHA"] = actual
    return actual


def verify_live_main() -> str:
    global CURRENT_STEP
    CURRENT_STEP = "LIVE_MAIN_SHA"
    result = command(
        ["git", "ls-remote", "https://github.com/jfsdias/NewsFlux.git", "refs/heads/main"],
        step=CURRENT_STEP,
    )
    actual = result.stdout.split()[0] if result.stdout.split() else ""
    RESULT["MAIN_SHA"] = actual or "UNAVAILABLE"
    if not actual:
        raise RuntimeError("Live main SHA was unavailable")
    return actual


def choose_subnet() -> str:
    raw_ids = command(["docker", "network", "ls", "-q"], step="List Docker networks")
    occupied: list[ipaddress.IPv4Network] = []
    for network_id in raw_ids.stdout.split():
        info = docker_json(["network", "inspect", network_id], step="Inspect Docker network")
        ipam = info[0].get("IPAM") or {}
        for item in ipam.get("Config") or []:
            subnet = item.get("Subnet")
            if subnet:
                try:
                    network = ipaddress.ip_network(subnet, strict=False)
                except ValueError:
                    continue
                if isinstance(network, ipaddress.IPv4Network):
                    occupied.append(network)
    for candidate in (
        "172.29.248.0/24",
        "172.30.248.0/24",
        "172.31.248.0/24",
        "10.230.248.0/24",
        "10.231.248.0/24",
    ):
        subnet = ipaddress.ip_network(candidate)
        if not any(subnet.overlaps(current) for current in occupied):
            return candidate
    raise RuntimeError("No isolated Docker subnet was available")


def create_test_ca(temp_root: Path) -> tuple[Path, Path, Path, Path]:
    ca_key = temp_root / "test-ca.key"
    ca_cert = temp_root / "test-ca.crt"
    leaf_key = temp_root / "newsflux.test.key"
    leaf_csr = temp_root / "newsflux.test.csr"
    leaf_cert = temp_root / "newsflux.test.crt"
    extensions = temp_root / "server.ext"
    command(["openssl", "genrsa", "-out", str(ca_key), "2048"], step="Generate ephemeral test CA key")
    command(
        [
            "openssl",
            "req",
            "-x509",
            "-new",
            "-nodes",
            "-key",
            str(ca_key),
            "-sha256",
            "-days",
            "2",
            "-subj",
            "/CN=NewsFlux P1 R2 isolated test CA",
            "-out",
            str(ca_cert),
        ],
        step="Create ephemeral test CA",
    )
    command(["openssl", "genrsa", "-out", str(leaf_key), "2048"], step="Generate ephemeral TLS leaf key")
    command(
        [
            "openssl",
            "req",
            "-new",
            "-key",
            str(leaf_key),
            "-subj",
            f"/CN={APP_HOST}",
            "-out",
            str(leaf_csr),
        ],
        step="Create HTTPS test certificate request",
    )
    extensions.write_text(
        "subjectAltName=DNS:newsflux.test\n"
        "keyUsage=digitalSignature,keyEncipherment\n"
        "extendedKeyUsage=serverAuth\n"
        "basicConstraints=CA:FALSE\n",
        encoding="utf-8",
    )
    command(
        [
            "openssl",
            "x509",
            "-req",
            "-in",
            str(leaf_csr),
            "-CA",
            str(ca_cert),
            "-CAkey",
            str(ca_key),
            "-CAcreateserial",
            "-out",
            str(leaf_cert),
            "-days",
            "2",
            "-sha256",
            "-extfile",
            str(extensions),
        ],
        step="Sign ephemeral HTTPS certificate",
    )
    os.chmod(leaf_key, 0o644)

    browser_home = temp_root / "browser-home"
    nss_db = browser_home / ".pki" / "nssdb"
    nss_db.mkdir(parents=True)
    command(
        ["certutil", "-N", "-d", f"sql:{nss_db}", "--empty-password"],
        step="Create isolated Chromium certificate store",
    )
    command(
        [
            "certutil",
            "-A",
            "-d",
            f"sql:{nss_db}",
            "-n",
            "NewsFlux P1 R2 test CA",
            "-t",
            "CT,,",
            "-i",
            str(ca_cert),
        ],
        step="Trust isolated HTTPS test CA in Chromium store",
    )
    return ca_cert, leaf_cert, leaf_key, browser_home


def write_proxy_config(path: Path) -> None:
    config = """
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;

events {
    worker_connections 512;
}

http {
    log_format sanitized '$request_method $uri $status $ssl_protocol $remote_addr';
    access_log /dev/stdout sanitized;
    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    client_max_body_size 1m;

    server {
        listen 8443 ssl;
        server_name newsflux.test;
        ssl_certificate /run/test-tls/newsflux.test.crt;
        ssl_certificate_key /run/test-tls/newsflux.test.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_cache shared:TLS:2m;

        location = /healthz {
            return 404;
        }

        location ^~ /api/content-fallback/reader/ {
            proxy_pass http://content-fallback:8790/reader/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header Forwarded "";
            proxy_set_header Connection close;
            proxy_redirect off;
        }

        location ^~ /api/content-fallback/ {
            return 404;
        }

        location ^~ /reader/ {
            return 404;
        }

        location ^~ /miniflux/ {
            proxy_pass http://synthetic-miniflux:8080/;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header Forwarded "";
            proxy_set_header Connection close;
            proxy_redirect off;
        }

        location / {
            proxy_pass http://newsflux-frontend:2000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header Forwarded "";
            proxy_set_header Connection close;
            proxy_redirect off;
        }
    }

    server {
        listen 8080;
        server_name _;
        return 444;
    }
}
"""
    path.write_text(config.lstrip(), encoding="utf-8")


def image_id(image: str) -> str:
    return command(
        ["docker", "image", "inspect", "--format", "{{.Id}}", image],
        step=f"Read image ID for {image}",
    ).stdout.strip()


def verify_image_labels(image: str, expected_revision: str) -> bool:
    info = docker_json(["image", "inspect", image], step=f"Inspect OCI labels for {image}")[0]
    labels = info.get("Config", {}).get("Labels") or {}
    return labels.get("org.opencontainers.image.revision") == expected_revision


def expected_container_not_published(name: str, container_port: str) -> bool:
    info = inspect_container(name)
    host_bindings = info.get("HostConfig", {}).get("PortBindings") or {}
    actual_ports = info.get("NetworkSettings", {}).get("Ports") or {}
    port_value = actual_ports.get(container_port)
    return not any(bindings for bindings in host_bindings.values()) and (
        not actual_ports or all(value is None for value in actual_ports.values())
    ) and (port_value is None or port_value == [])


def wait_for_https(ca_cert: Path, timeout: float = 60.0) -> tuple[int, str]:
    global CURRENT_STEP
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        try:
            status, body, _headers = curl_request(
                ca_cert,
                "GET",
                APP_ORIGIN + "/",
                expected_statuses=None,
                timeout=5,
            )
            if status == 200 and "<html" in body.casefold():
                return status, body
        except RuntimeError as exc:
            last_error = str(exc)
        time.sleep(1)
    failure_step = CURRENT_STEP
    diagnose_https_startup(ca_cert)
    CURRENT_STEP = failure_step
    for container_name in ("newsflux-p1-r2-proxy", "newsflux-p1-r2-frontend"):
        result = command(
            ["docker", "logs", "--tail", "40", container_name],
            step=f"Read {container_name} HTTPS startup diagnostics",
            check=False,
        )
        log_tail = redact_secrets("\n".join((result.stdout + result.stderr).splitlines()[-30:]))
        if log_tail:
            print(f"HTTPS_DIAGNOSTIC_BEGIN={container_name}", flush=True)
            print(log_tail, flush=True)
            print(f"HTTPS_DIAGNOSTIC_END={container_name}", flush=True)
    last_error = redact_secrets(last_error)[:300]
    raise RuntimeError(f"HTTPS ingress did not serve the frontend before timeout; last probe: {last_error}")


def diagnose_https_startup(ca_cert: Path) -> None:
    """Capture only proxy state and a secret-free internal HTTPS reachability probe."""
    try:
        proxy_info = inspect_container("newsflux-p1-r2-proxy")
        state = proxy_info.get("State") or {}
        settings = proxy_info.get("NetworkSettings") or {}
        networks = settings.get("Networks") or {}
        safe_inspect = {
            "status": state.get("Status"),
            "running": state.get("Running"),
            "exit_code": state.get("ExitCode"),
            "error": redact_secrets(str(state.get("Error") or ""))[:200],
            "port_bindings": proxy_info.get("HostConfig", {}).get("PortBindings") or {},
            "ports": settings.get("Ports") or {},
            "networks": {
                name: {"ip": details.get("IPAddress"), "aliases": details.get("Aliases")}
                for name, details in networks.items()
            },
        }
        print(f"HTTPS_PROXY_INSPECT={json.dumps(safe_inspect, sort_keys=True)}", flush=True)
    except Exception as exc:
        print(f"HTTPS_PROXY_INSPECT_ERROR={type(exc).__name__}: {str(exc)[:200]}", flush=True)

    probe = (
        "import ssl,urllib.request;"
        "context=ssl._create_unverified_context();"
        "request=urllib.request.Request('https://newsflux-proxy:8443/',headers={'Host':'newsflux.test:8443'});"
        "response=urllib.request.urlopen(request,context=context,timeout=5);"
        "print('status='+str(response.status))"
    )
    result = command(
        ["docker", "exec", "newsflux-p1-r2-miniflux", "python", "-c", probe],
        step="Probe HTTPS proxy from isolated synthetic network",
        check=False,
    )
    detail = redact_secrets((result.stdout + result.stderr).strip())[-300:]
    print(
        f"HTTPS_INTERNAL_PROXY_PROBE_EXIT={result.returncode}"
        + (f" DETAIL={detail}" if detail else ""),
        flush=True,
    )
    host_probe = command(
        [
            "curl",
            "--noproxy",
            "*",
            "--silent",
            "--show-error",
            "--max-time",
            "5",
            "--cacert",
            str(ca_cert),
            "--resolve",
            f"{APP_HOST}:{APP_PORT}:{APP_CONNECT_IP}",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
            APP_ORIGIN + "/",
        ],
        step="Probe HTTPS proxy from isolated runner host",
        check=False,
    )
    host_detail = redact_secrets((host_probe.stderr or host_probe.stdout).strip())[-300:]
    print(
        f"HTTPS_HOST_PROXY_PROBE_EXIT={host_probe.returncode}"
        + (f" STATUS={host_probe.stdout.strip()}" if host_probe.stdout.strip() else "")
        + (f" DETAIL={host_detail}" if host_detail else ""),
        flush=True,
    )


def curl_request(
    ca_cert: Path,
    method: str,
    url: str,
    *,
    headers: list[tuple[str, str]] | None = None,
    expected_statuses: set[int] | None,
    timeout: int = 20,
) -> tuple[int, str, dict[str, str]]:
    command_args = [
        "curl",
        "--noproxy",
        "*",
        "--silent",
        "--show-error",
        "--max-time",
        str(timeout),
        "--cacert",
        str(ca_cert),
        "--resolve",
        f"{APP_HOST}:{APP_PORT}:{APP_CONNECT_IP}",
        "-X",
        method,
    ]
    for key, value in headers or []:
        command_args.extend(["-H", f"{key}: {value}"])
    command_args.extend(
        [
            "-D",
            "-",
            "-o",
            "-",
            "-w",
            "\n__NEWSFLUX_STATUS__%{http_code}",
            url,
        ]
    )
    result = command(command_args, step=f"HTTPS request {method} {url}", check=False)
    if result.returncode != 0:
        detail = redact_secrets((result.stderr or result.stdout).strip())[-300:]
        raise RuntimeError(f"HTTPS request failed with curl exit {result.returncode}: {detail}")
    marker = "\n__NEWSFLUX_STATUS__"
    if marker not in result.stdout:
        raise RuntimeError("HTTPS response did not include a status")
    response_text, status_text = result.stdout.rsplit(marker, 1)
    status = int(status_text.strip())
    header_text, separator, body = response_text.partition("\r\n\r\n")
    if not separator:
        header_text, separator, body = response_text.partition("\n\n")
    response_headers: dict[str, str] = {}
    for line in header_text.splitlines()[1:]:
        key, sep, value = line.partition(":")
        if sep:
            response_headers[key.strip().casefold()] = value.strip()
    if expected_statuses is not None and status not in expected_statuses:
        raise RuntimeError(f"Unexpected HTTP status {status} for {method} {url}")
    return status, body, response_headers


def reader_headers(api_key: str, *, origin: str = APP_ORIGIN, miniflux: str = MINIFLUX_BASE_URL) -> list[tuple[str, str]]:
    return [
        ("Origin", origin),
        ("X-Miniflux-API-Key", api_key),
        ("X-NewsFlux-Miniflux-Server", miniflux),
        ("X-Forwarded-Proto", "http"),
        ("X-Forwarded-For", "198.51.100.77"),
        ("Forwarded", "for=198.51.100.77;proto=http"),
    ]


def proxy_direct_peer_test(container_name: str, sidecar_ip: str) -> int:
    python_code = (
        "import urllib.error,urllib.request;"
        "url='http://"
        + sidecar_ip
        + ":8790/reader/v1/entries/701/recover';"
        "req=urllib.request.Request(url,data=b'',method='POST',headers={"
        "'Origin':'"
        + APP_ORIGIN
        + "','X-Miniflux-API-Key':'"
        + USER_KEY
        + "','X-NewsFlux-Miniflux-Server':'"
        + MINIFLUX_BASE_URL
        + "','X-Forwarded-Proto':'https'});"
        "\ntry:\n r=urllib.request.urlopen(req,timeout=5); print('status='+str(r.status))"
        "\nexcept urllib.error.HTTPError as e:\n print('status='+str(e.code))"
    )
    result = command(
        ["docker", "exec", container_name, "python", "-c", python_code],
        step="Reject untrusted direct caller spoofing X-Forwarded-Proto",
    )
    value = result.stdout.strip().split("=")[-1]
    return int(value)


def fixture_state(container_name: str) -> dict[str, Any]:
    code = (
        "import json,urllib.request;"
        "print(urllib.request.urlopen('http://127.0.0.1:8080/__harness__/state',timeout=5).read().decode())"
    )
    result = command(
        ["docker", "exec", container_name, "python", "-c", code],
        step="Read synthetic Miniflux state",
    )
    return json.loads(result.stdout)


def fixture_fingerprint_mode(container_name: str, enabled: bool) -> None:
    mode = "1" if enabled else "0"
    code = (
        "import urllib.request;"
        "urllib.request.urlopen('http://127.0.0.1:8080/__harness__/fingerprint-mode?enabled="
        + mode
        + "',timeout=5).read()"
    )
    command(
        ["docker", "exec", container_name, "python", "-c", code],
        step="Set synthetic fingerprint fixture mode",
    )


def add_container(name: str) -> None:
    CONTAINERS.append(name)


def docker_run(args: list[str], name: str, *, step: str) -> None:
    command(["docker", "run", "-d", "--name", name, *args], step=step)
    add_container(name)


def run() -> None:
    global TEMP_ROOT, NETWORK_NAME, CURRENT_STEP, APP_CONNECT_IP
    CURRENT_STEP = "PREFLIGHT"
    main_sha = verify_live_main()
    source_sha = check_exact_source(main_sha)
    docker_version = command(["docker", "version", "--format", "{{.Server.Version}}"], step="Docker server version")
    RESULT["DOCKER_VERSION"] = docker_version.stdout.strip()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    TEMP_ROOT = Path(tempfile.mkdtemp(prefix="newsflux-reader-wallhop-p1-r2-"))
    ca_cert, leaf_cert, leaf_key, browser_home = create_test_ca(TEMP_ROOT)
    proxy_config = TEMP_ROOT / "nginx.conf"
    write_proxy_config(proxy_config)
    sidecar_ca_dir = TEMP_ROOT / "sidecar-ca"
    sidecar_ca_dir.mkdir()
    shutil.copyfile(ca_cert, sidecar_ca_dir / "ca.crt")
    proxy_tls_dir = TEMP_ROOT / "proxy-tls"
    proxy_tls_dir.mkdir()
    shutil.copyfile(leaf_cert, proxy_tls_dir / "newsflux.test.crt")
    shutil.copyfile(leaf_key, proxy_tls_dir / "newsflux.test.key")
    os.chmod(proxy_tls_dir / "newsflux.test.key", 0o644)

    source_env = SOURCE_ROOT / ".env.production.local"
    if source_env.exists():
        raise RuntimeError("Exact source checkout unexpectedly contains .env.production.local")
    build_env_created = False
    try:
        source_env.write_text(
            "VITE_CONTENT_FALLBACK_READER_BASE_PATH=/api/content-fallback\n",
            encoding="utf-8",
        )
        build_env_created = True
        source_date = command(
            ["git", "-C", str(SOURCE_ROOT), "show", "-s", "--format=%cI", "HEAD"],
            step="Read exact source commit date",
        ).stdout.strip()
        short_run = f"{WORKFLOW_RUN}-{WORKFLOW_ATTEMPT}"
        frontend_image = f"newsflux-p1-r2-frontend:{short_run}"
        sidecar_image = f"newsflux-p1-r2-sidecar:{short_run}"
        IMAGES.extend((frontend_image, sidecar_image))

        command(
            [
                "docker",
                "build",
                "--pull",
                "--label",
                f"org.opencontainers.image.revision={source_sha}",
                "--build-arg",
                f"SOURCE_COMMIT={source_sha}",
                "--build-arg",
                f"SOURCE_COMMIT_DATE={source_date}",
                "--build-arg",
                "VITE_BASE_PATH=/",
                "-t",
                frontend_image,
                "-f",
                str(SOURCE_ROOT / "Dockerfile"),
                str(SOURCE_ROOT),
            ],
            step="Build exact-SHA NewsFlux frontend image with isolated Reader base path",
        )
        source_env.unlink(missing_ok=True)
        build_env_created = False
        if command(
            ["git", "-C", str(SOURCE_ROOT), "status", "--porcelain"],
            step="Confirm exact source checkout was restored",
        ).stdout.strip():
            raise RuntimeError("Temporary Reader base-path configuration left changes in the source checkout")
        RESULT["FRONTEND_IMAGE_ID"] = image_id(frontend_image)
        if not verify_image_labels(frontend_image, source_sha):
            raise RuntimeError("Frontend OCI revision label did not match the exact source SHA")
        frontend_bundle = command(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "sh",
                frontend_image,
                "-c",
                "grep -R -l '/api/content-fallback' /srv >/dev/null",
            ],
            step="Verify Reader base path exists in isolated frontend bundle",
        )
        del frontend_bundle
        RESULT["FRONTEND_BUILD_GATE"] = "PASS"

        command(
            [
                "docker",
                "build",
                "--pull",
                "--label",
                f"org.opencontainers.image.revision={source_sha}",
                "--label",
                "org.opencontainers.image.source=https://github.com/jfsdias/NewsFlux",
                "-t",
                sidecar_image,
                "-f",
                str(SOURCE_ROOT / "services" / "content_fallback" / "Dockerfile"),
                str(SOURCE_ROOT),
            ],
            step="Build exact-SHA Content Fallback sidecar image",
        )
        RESULT["SIDECAR_IMAGE_ID"] = image_id(sidecar_image)
        if not verify_image_labels(sidecar_image, source_sha):
            raise RuntimeError("Sidecar OCI revision label did not match the exact source SHA")
        sidecar_info = docker_json(["image", "inspect", sidecar_image], step="Inspect sidecar image")
        sidecar_config = sidecar_info[0].get("Config", {})
        if sidecar_config.get("User") != "10001:10001" or not sidecar_config.get("Healthcheck"):
            raise RuntimeError("Sidecar image must declare its non-root user and healthcheck")
        command(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                "none",
                "--entrypoint",
                "python",
                sidecar_image,
                "-c",
                "import services.article_intel_auth.auth, services.content_fallback.server, services.content_fallback.reader_bridge",
            ],
            step="Import auth, sidecar server and Reader bridge as image user",
        )
        RESULT["SIDECAR_IMAGE_GATE"] = "PASS"

        IMAGES.extend((PYTHON_BASE, PROXY_IMAGE))
        command(["docker", "pull", PYTHON_BASE], step="Pull digest-pinned synthetic Miniflux fixture base")
        command(["docker", "pull", PROXY_IMAGE], step="Pull temporary reverse proxy image")
        fixture_image_id = image_id(PYTHON_BASE)
        nginx_image_id = image_id(PROXY_IMAGE)
        if not fixture_image_id or not nginx_image_id:
            raise RuntimeError("Fixture or reverse-proxy image ID was unavailable")
        RESULT["PROXY_IMAGE_ID"] = nginx_image_id

        network_suffix = secrets.token_hex(3)
        candidate_network = f"reader-p1-r2-{WORKFLOW_RUN}-{network_suffix}"
        subnet = choose_subnet()
        command(
            [
                "docker",
                "network",
                "create",
                "--internal",
                "--subnet",
                subnet,
                candidate_network,
            ],
            step="Create isolated internal Docker network",
        )
        NETWORK_NAME = candidate_network
        network_ip = ipaddress.ip_network(subnet)
        proxy_ip = str(network_ip.network_address + 2)
        sidecar_ip = str(network_ip.network_address + 3)
        frontend_ip = str(network_ip.network_address + 4)
        miniflux_ip = str(network_ip.network_address + 5)

        docker_run(
            [
                "--network",
                NETWORK_NAME,
                "--ip",
                miniflux_ip,
                "--network-alias",
                "synthetic-miniflux",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=8m",
                "--user",
                "10001:10001",
                "-e",
                "PYTHONDONTWRITEBYTECODE=1",
                "-e",
                f"NEWSFLUX_TEST_USER_KEY={USER_KEY}",
                "-e",
                f"NEWSFLUX_TEST_ROTATED_KEY={ROTATED_KEY}",
                "-e",
                f"NEWSFLUX_TEST_OTHER_USER_KEY={OTHER_USER_KEY}",
                "-e",
                f"NEWSFLUX_TEST_ADMIN_KEY={ADMIN_KEY}",
                "-v",
                f"{FIXTURE_FILE.parent}:/harness:ro",
                "--entrypoint",
                "python",
                PYTHON_BASE,
                "/harness/fixture_server.py",
            ],
            "newsflux-p1-r2-miniflux",
            step="Start non-admin synthetic Miniflux fixture",
        )
        docker_run(
            [
                "--network",
                NETWORK_NAME,
                "--ip",
                frontend_ip,
                "--network-alias",
                "newsflux-frontend",
                "--user",
                "1000:1000",
                "-e",
                "XDG_DATA_HOME=/tmp/caddy-data",
                "-e",
                "XDG_CONFIG_HOME=/tmp/caddy-config",
                "-e",
                "HOME=/tmp",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=16m",
                frontend_image,
            ],
            "newsflux-p1-r2-frontend",
            step="Start isolated non-root frontend container",
        )

        policies = json.dumps(
            {
                "enabled": True,
                "domains": {
                    "publisher.example.test": {
                        "state": "ON_DEMAND",
                        "provider": "miniflux",
                    }
                },
            },
            separators=(",", ":"),
        )
        docker_run(
            [
                "--network",
                NETWORK_NAME,
                "--ip",
                sidecar_ip,
                "--network-alias",
                "content-fallback",
                "--add-host",
                "publisher.example.test:93.184.216.34",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=8m",
                "--tmpfs",
                "/data:rw,noexec,nosuid,size=16m,uid=10001,gid=10001",
                "-v",
                f"{sidecar_ca_dir}:/run/test-ca:ro",
                "-e",
                "SSL_CERT_FILE=/run/test-ca/ca.crt",
                "-e",
                f"MINIFLUX_BASE_URL={MINIFLUX_BASE_URL}",
                "-e",
                f"MINIFLUX_API_TOKEN={USER_KEY}",
                "-e",
                f"CONTENT_FALLBACK_API_TOKEN={PRIVATE_SERVICE_KEY}",
                "-e",
                "CONTENT_FALLBACK_PORT=8790",
                "-e",
                "CONTENT_FALLBACK_HOST=0.0.0.0",
                "-e",
                "CONTENT_FALLBACK_DB_PATH=/data/ephemeral-test.sqlite3",
                "-e",
                "CONTENT_FALLBACK_PRIVATE_URL=http://127.0.0.1:8790",
                "-e",
                f"CONTENT_FALLBACK_POLICIES_JSON={policies}",
                "-e",
                "CONTENT_FALLBACK_READER_ENABLED=true",
                "-e",
                f"CONTENT_FALLBACK_READER_USER_ID={USER_ID}",
                "-e",
                f"CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS={proxy_ip}",
                "-e",
                f"NEWSFLUX_AI_MINIFLUX_BASE_URL={MINIFLUX_BASE_URL}",
                "-e",
                f"NEWSFLUX_AI_ALLOWED_WEB_ORIGINS={APP_ORIGIN}",
                "-e",
                "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=99",
                "-e",
                "PYTHONDONTWRITEBYTECODE=1",
                sidecar_image,
            ],
            "newsflux-p1-r2-sidecar",
            step="Start isolated non-root sidecar with fixture-only ON_DEMAND policy",
        )
        command(
            [
                "docker",
                "run",
                "--rm",
                "--network",
                NETWORK_NAME,
                "--user",
                "101:101",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=16m",
                "--tmpfs",
                "/var/cache/nginx:rw,noexec,nosuid,size=16m,uid=101,gid=101,mode=0750",
                "-v",
                f"{proxy_config}:/etc/nginx/nginx.conf:ro",
                "-v",
                f"{proxy_tls_dir}:/run/test-tls:ro",
                "--entrypoint",
                "nginx",
                PROXY_IMAGE,
                "-t",
                "-c",
                "/etc/nginx/nginx.conf",
            ],
            step="Validate isolated reverse-proxy configuration",
        )
        docker_run(
            [
                "--network",
                NETWORK_NAME,
                "--ip",
                proxy_ip,
                "--network-alias",
                APP_HOST,
                "--network-alias",
                "newsflux-proxy",
                "--user",
                "101:101",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,size=16m",
                "--tmpfs",
                "/var/cache/nginx:rw,noexec,nosuid,size=16m,uid=101,gid=101,mode=0750",
                "-v",
                f"{proxy_config}:/etc/nginx/nginx.conf:ro",
                "-v",
                f"{proxy_tls_dir}:/run/test-tls:ro",
                "--entrypoint",
                "nginx",
                PROXY_IMAGE,
                "-g",
                "daemon off;",
                "-c",
                "/etc/nginx/nginx.conf",
            ],
            "newsflux-p1-r2-proxy",
            step="Start HTTPS reverse proxy on the isolated Docker network",
        )

        network_info = docker_json(["network", "inspect", NETWORK_NAME], step="Inspect test network")[0]
        if network_info.get("Internal") is not True:
            raise RuntimeError("Test Docker network is not internal")
        fixture_info = inspect_container("newsflux-p1-r2-miniflux")
        proxy_info = inspect_container("newsflux-p1-r2-proxy")
        sidecar_info = inspect_container("newsflux-p1-r2-sidecar")
        frontend_info = inspect_container("newsflux-p1-r2-frontend")
        proxy_networks = proxy_info["NetworkSettings"].get("Networks") or {}
        actual_proxy_ip = proxy_networks.get(NETWORK_NAME, {}).get("IPAddress", "")
        if actual_proxy_ip != proxy_ip:
            attached_networks = ",".join(sorted(proxy_networks)) or "none"
            raise RuntimeError(
                f"Proxy IP mismatch: expected {proxy_ip}, observed {actual_proxy_ip or 'missing'}; "
                f"attached networks: {attached_networks}"
            )
        APP_CONNECT_IP = actual_proxy_ip
        sidecar_networks = sidecar_info["NetworkSettings"].get("Networks") or {}
        actual_sidecar_ip = sidecar_networks.get(NETWORK_NAME, {}).get("IPAddress", "")
        if actual_sidecar_ip != sidecar_ip:
            raise RuntimeError(
                f"Sidecar IP mismatch: expected {sidecar_ip}, observed {actual_sidecar_ip or 'missing'}"
            )
        if sidecar_info["Config"].get("User") != "10001:10001":
            raise RuntimeError("Sidecar process was not configured as non-root")
        if frontend_info["Config"].get("User") != "1000:1000":
            raise RuntimeError("Frontend process was not configured as non-root")
        if fixture_info["Config"].get("User") != "10001:10001":
            raise RuntimeError("Synthetic Miniflux fixture was not configured as non-root")
        if proxy_info["Config"].get("User") != "101:101":
            raise RuntimeError("Reverse proxy was not configured as non-root")
        sidecar_runtime_uid = command(
            [
                "docker",
                "exec",
                "newsflux-p1-r2-sidecar",
                "python",
                "-c",
                "import os; print(os.geteuid())",
            ],
            step="Verify actual sidecar process UID",
        ).stdout.strip()
        frontend_runtime_uid = command(
            ["docker", "exec", "newsflux-p1-r2-frontend", "sh", "-c", "id -u"],
            step="Verify actual frontend process UID",
        ).stdout.strip()
        proxy_runtime_uid = command(
            ["docker", "exec", "newsflux-p1-r2-proxy", "sh", "-c", "id -u"],
            step="Verify actual reverse-proxy process UID",
        ).stdout.strip()
        fixture_runtime_uid = command(
            [
                "docker",
                "exec",
                "newsflux-p1-r2-miniflux",
                "python",
                "-c",
                "import os; print(os.geteuid())",
            ],
            step="Verify actual synthetic Miniflux process UID",
        ).stdout.strip()
        if (sidecar_runtime_uid, frontend_runtime_uid, proxy_runtime_uid, fixture_runtime_uid) != (
            "10001",
            "1000",
            "101",
            "10001",
        ):
            raise RuntimeError("At least one isolated service did not run as its configured non-root user")
        sidecar_runtime_env = sidecar_info["Config"].get("Env", [])
        policy_value = next(
            (item.split("=", 1)[1] for item in sidecar_runtime_env if item.startswith("CONTENT_FALLBACK_POLICIES_JSON=")),
            "",
        )
        scoped_policy = json.loads(policy_value)
        test_rules = scoped_policy.get("domains", {})
        if (
            scoped_policy.get("enabled") is not True
            or list(test_rules) != ["publisher.example.test"]
            or test_rules["publisher.example.test"] != {"state": "ON_DEMAND", "provider": "miniflux"}
        ):
            raise RuntimeError("Sidecar recovery policy was not exclusively scoped to the synthetic fixture")
        if not expected_container_not_published("newsflux-p1-r2-sidecar", "8790/tcp"):
            raise RuntimeError("Sidecar port was published outside the isolated network")
        if not expected_container_not_published("newsflux-p1-r2-frontend", "2000/tcp"):
            raise RuntimeError("Frontend port was published outside the isolated network")
        if not expected_container_not_published("newsflux-p1-r2-proxy", "8443/tcp"):
            raise RuntimeError("Reverse proxy port was published outside the isolated Docker network")

        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            health = inspect_container("newsflux-p1-r2-sidecar").get("State", {}).get("Health", {}).get("Status")
            if health == "healthy":
                break
            if health == "unhealthy":
                raise RuntimeError("Sidecar Docker healthcheck reported unhealthy")
            time.sleep(2)
        else:
            raise RuntimeError("Sidecar healthcheck did not become healthy")
        RESULT["SIDECAR_STARTUP_GATE"] = "PASS"
        RESULT["DOCKER_IMAGE_GATE"] = "PASS"

        https_status, _index = wait_for_https(ca_cert)
        if https_status != 200:
            raise RuntimeError("The private Docker-network HTTPS ingress did not serve the frontend")
        plaintext = command(
            [
                "curl",
                "--noproxy",
                "*",
                "--silent",
                "--show-error",
                "--max-time",
                "5",
                "--resolve",
                f"{APP_HOST}:{APP_PORT}:{APP_CONNECT_IP}",
                "-o",
                "/dev/null",
                "-w",
                "%{http_code}",
                f"http://{APP_HOST}:{APP_PORT}/",
            ],
            step="Verify the isolated ingress does not serve plaintext HTTP",
            check=False,
        )
        plain_status = int(plaintext.stdout.strip() or "0")
        if 200 <= plain_status < 400:
            raise RuntimeError("Plain HTTP unexpectedly returned a successful or redirect response")
        RESULT["TLS_INGRESS_GATE"] = "PASS"
        RESULT["SAME_ORIGIN_GATE"] = "PASS"

        miniflux_status, miniflux_body, _ = curl_request(
            ca_cert,
            "GET",
            APP_ORIGIN + "/miniflux/v1/me",
            headers=[
                ("X-Auth-Token", USER_KEY),
                ("X-Forwarded-Proto", "http"),
                ("X-Forwarded-For", "198.51.100.77"),
                ("Forwarded", "for=198.51.100.77;proto=http"),
            ],
            expected_statuses={200},
        )
        if miniflux_status != 200:
            raise RuntimeError("Synthetic Miniflux did not respond through same-origin HTTPS")
        identity = json.loads(miniflux_body)
        if identity.get("id") != USER_ID or identity.get("is_admin") is not False:
            raise RuntimeError("Synthetic Miniflux identity was not the expected non-admin account")
        miniflux_observation = fixture_state("newsflux-p1-r2-miniflux")
        observed = [
            event
            for event in miniflux_observation.get("events", [])
            if event.get("path") == "/v1/me"
        ]
        if not observed:
            raise RuntimeError("Proxy header observations were missing from synthetic Miniflux")
        last_observation = observed[-1]
        if (
            last_observation.get("forwarded_proto") != "https"
            or last_observation.get("forwarded_for") == "198.51.100.77"
            or last_observation.get("forwarded_host") != APP_HOST
            or last_observation.get("forwarded_header") not in {None, ""}
        ):
            raise RuntimeError("Client-supplied forwarded headers were not overwritten or removed")

        untrusted_direct_status = proxy_direct_peer_test("newsflux-p1-r2-miniflux", sidecar_ip)
        if untrusted_direct_status != 400:
            raise RuntimeError("An untrusted direct caller spoofing X-Forwarded-Proto was not rejected")
        RESULT["PROXY_TRUST_GATE"] = "PASS"

        valid_status, valid_body, valid_headers = curl_request(
            ca_cert,
            "POST",
            APP_ORIGIN + READER_PATH + "/701/recover",
            headers=reader_headers(USER_KEY),
            expected_statuses=None,
        )
        if valid_status != 200:
            try:
                safe_error = json.loads(valid_body).get("error")
            except (json.JSONDecodeError, AttributeError):
                safe_error = "unavailable"
            fixture_after_failure = fixture_state("newsflux-p1-r2-miniflux")
            safe_events = [
                {
                    "method": event.get("method"),
                    "path": event.get("path"),
                    "status": event.get("status"),
                    "update_content": event.get("update_content", []),
                }
                for event in fixture_after_failure.get("events", [])
            ]
            print(
                "VALID_RECOVERY_FAILURE_DIAGNOSTIC="
                + json.dumps(
                    {
                        "status": valid_status,
                        "error": safe_error if isinstance(safe_error, str) else "unavailable",
                        "miniflux_events": safe_events,
                    },
                    sort_keys=True,
                ),
                flush=True,
            )
            raise RuntimeError(f"Valid synthetic recovery failed with HTTP {valid_status}: {safe_error}")
        valid = json.loads(valid_body)
        if (
            valid_status != 200
            or valid.get("status") != "recovered"
            or valid.get("entry_id") != 701
            or valid_headers.get("location")
        ):
            raise RuntimeError("Valid same-origin Reader authorization did not complete without redirect")
        RESULT["AUTHORIZATION_GATE"] = "PASS"

        cases = (
            ("invalid API key", USER_KEY + "-invalid", 701, APP_ORIGIN, MINIFLUX_BASE_URL, {401}),
            ("user identity mismatch", OTHER_USER_KEY, 801, APP_ORIGIN, MINIFLUX_BASE_URL, {404}),
            ("admin account", ADMIN_KEY, 991, APP_ORIGIN, MINIFLUX_BASE_URL, {404}),
            ("foreign article", USER_KEY, 902, APP_ORIGIN, MINIFLUX_BASE_URL, {404}),
            ("unauthorized origin", USER_KEY, 701, "https://evil.test", MINIFLUX_BASE_URL, {403}),
            ("unapproved Miniflux identity", USER_KEY, 701, APP_ORIGIN, "https://evil.test/miniflux", {403}),
        )
        for label, key, entry_id, request_origin, miniflux_url, statuses in cases:
            result_status, body, response_headers = curl_request(
                ca_cert,
                "POST",
                APP_ORIGIN + READER_PATH + f"/{entry_id}/recover",
                headers=reader_headers(key, origin=request_origin, miniflux=miniflux_url),
                expected_statuses=statuses,
            )
            if response_headers.get("location"):
                raise RuntimeError(f"Unexpected redirect from negative security test: {label}")
            try:
                payload = json.loads(body)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid JSON on negative security test: {label}") from exc
            if result_status not in statuses or not payload.get("error"):
                raise RuntimeError(f"Negative security test did not fail closed: {label}")

        fixture_fingerprint_mode("newsflux-p1-r2-miniflux", True)
        fingerprint_status, fingerprint_body, _ = curl_request(
            ca_cert,
            "POST",
            APP_ORIGIN + READER_PATH + "/901/recover",
            headers=reader_headers(USER_KEY),
            expected_statuses={502},
        )
        fixture_fingerprint_mode("newsflux-p1-r2-miniflux", False)
        if fingerprint_status != 502 or json.loads(fingerprint_body).get("error") != "recovery_identity_mismatch":
            raise RuntimeError("A divergent recovery fingerprint was not rejected")

        health_route_status, health_route_body, _ = curl_request(
            ca_cert,
            "GET",
            APP_ORIGIN + "/api/content-fallback/healthz",
            expected_statuses={404},
        )
        direct_service = command(
            [
                "curl",
                "--noproxy",
                "*",
                "--silent",
                "--show-error",
                "--max-time",
                "3",
                "http://127.0.0.1:8790/healthz",
            ],
            step="Verify the sidecar service port is not reachable from the runner host",
            check=False,
        )
        if direct_service.returncode == 0 or "healthy" in health_route_body.casefold():
            raise RuntimeError("The internal health endpoint was exposed through the HTTPS ingress")

        RESULT["NEGATIVE_SECURITY_TESTS"] = "PASS"
        RESULT["PROXY_TRUST_GATE"] = "PASS"
        RESULT["TLS_INGRESS_GATE"] = "PASS"
        RESULT["SAME_ORIGIN_GATE"] = "PASS"

        runner_home = Path(os.environ.get("HOME", str(Path.home()))).expanduser()
        playwright_browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or str(
            runner_home / ".cache" / "ms-playwright"
        )
        node_env = os.environ.copy()
        node_env.update(
            {
                "HOME": str(browser_home),
                "PLAYWRIGHT_BROWSERS_PATH": playwright_browsers_path,
                "NEWSFLUX_SOURCE_ROOT": str(SOURCE_ROOT),
                "NEWSFLUX_OUTPUT_ROOT": str(OUTPUT_ROOT),
                "NEWSFLUX_APP_ORIGIN": APP_ORIGIN,
                "NEWSFLUX_INGRESS_IP": APP_CONNECT_IP,
                "NEWSFLUX_MINIFLUX_BASE_URL": MINIFLUX_BASE_URL,
                "NEWSFLUX_TEST_USER_KEY": USER_KEY,
                "NEWSFLUX_TEST_ROTATED_KEY": ROTATED_KEY,
            }
        )
        command(
            ["node", str(BROWSER_FILE)],
            step="Run Chromium through isolated trusted HTTPS proxy",
            env=node_env,
        )
        RESULT["READER_BROWSER_GATE"] = "PASS"
        RESULT["SESSION_PROTECTION"] = "PASS"
        RESULT["ORIGINAL_FALLBACK"] = "PASS"

        final_fixture_state = fixture_state("newsflux-p1-r2-miniflux")
        if final_fixture_state.get("writes") != []:
            raise RuntimeError("A synthetic Miniflux mutation was observed")
        if final_fixture_state.get("real_wallhop_requests") != 0:
            raise RuntimeError("A WallHop request was observed")
        if not any(
            item.get("path") == "/v1/entries/701"
            and item.get("forwarded_proto") == "https"
            and item.get("forwarded_for") not in {None, "", "198.51.100.77"}
            for item in final_fixture_state.get("events", [])
        ):
            raise RuntimeError("Forwarded-header rewrite was not observed on a Miniflux API request")
        for identifier in (501, 502):
            if f"/v1/entries/{identifier}/fetch-content" not in final_fixture_state.get(
                "reader_recovery_gets", []
            ):
                raise RuntimeError(f"Expected explicit synthetic provider fetch was not observed for {identifier}")
        provider_fetches = [
            event
            for event in final_fixture_state.get("events", [])
            if str(event.get("path", "")).endswith("/fetch-content")
        ]
        if not provider_fetches or any(event.get("update_content") != ["false"] for event in provider_fetches):
            raise RuntimeError("Synthetic provider requests were not response-only Miniflux GETs")
        RESULT["MINIFLUX_WRITES"] = "0"
        RESULT["REAL_WALLHOP_REQUESTS"] = "0"

        service_logs = command(
            ["docker", "logs", "newsflux-p1-r2-sidecar"],
            step="Read sidecar logs for credential leakage check",
        ).stdout
        proxy_logs = command(
            ["docker", "logs", "newsflux-p1-r2-proxy"],
            step="Read proxy logs for credential leakage check",
        ).stdout
        fixture_logs = command(
            ["docker", "logs", "newsflux-p1-r2-miniflux"],
            step="Read synthetic Miniflux logs for credential leakage check",
        ).stdout
        frontend_logs = command(
            ["docker", "logs", "newsflux-p1-r2-frontend"],
            step="Read frontend logs for credential leakage check",
        ).stdout
        all_logs = service_logs + proxy_logs + fixture_logs + frontend_logs
        for secret in (USER_KEY, ROTATED_KEY, OTHER_USER_KEY, ADMIN_KEY, PRIVATE_SERVICE_KEY):
            if secret in all_logs:
                raise RuntimeError("A synthetic credential appeared in service logs")
        if "Synthetic recovered paragraph" in all_logs or "fingerprint-changed" in all_logs:
            raise RuntimeError("Synthetic article content or query material appeared in service logs")
        RESULT["FINAL"] = "PASS"
    finally:
        failure_step_before_cleanup = CURRENT_STEP
        had_runtime_failure = RESULT["FINAL"] != "PASS"
        if build_env_created and source_env.exists():
            source_env.unlink(missing_ok=True)
        cleanup_ok = True
        for container_name in reversed(CONTAINERS):
            cleanup_ok = cleanup_resource(
                ["docker", "rm", "-f", container_name],
                f"Remove container {container_name}",
            ) and cleanup_ok
        if NETWORK_NAME:
            cleanup_ok = cleanup_resource(
                ["docker", "network", "rm", NETWORK_NAME],
                "Remove isolated Docker network",
            ) and cleanup_ok
        for image in reversed(IMAGES):
            cleanup_ok = cleanup_resource(
                ["docker", "image", "rm", image],
                f"Remove local test image {image.split('@')[0]}",
            ) and cleanup_ok
        if TEMP_ROOT is not None:
            try:
                shutil.rmtree(TEMP_ROOT)
            except OSError:
                cleanup_ok = False
        RESULT["CLEANUP_GATE"] = "PASS" if cleanup_ok else "FAIL"
        if not cleanup_ok:
            RESULT["FINAL"] = "FAIL"
        if had_runtime_failure:
            RESULT["FAILURE_STEP"] = failure_step_before_cleanup


def cleanup_resource(args: list[str], step: str) -> bool:
    """Keep cleanup failures visible without hiding the original runtime failure."""
    try:
        result = command(args, step=step, check=False)
    except Exception as exc:
        print(f"CLEANUP_FAILURE_STEP={step}", flush=True)
        print(f"CLEANUP_FAILURE_CLASS={type(exc).__name__}", flush=True)
        return False
    if result.returncode == 0:
        return True
    diagnostic = (result.stderr or result.stdout).splitlines()[-4:]
    if diagnostic:
        print(f"CLEANUP_DIAGNOSTIC_BEGIN={step}", flush=True)
        print("\n".join(diagnostic), flush=True)
        print(f"CLEANUP_DIAGNOSTIC_END={step}", flush=True)
    return False


def main() -> int:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        run()
    except Exception as exc:
        RESULT["FINAL"] = "FAIL"
        RESULT.setdefault("FAILURE_STEP", CURRENT_STEP)
        RESULT["FAILURE_CLASS"] = type(exc).__name__
        failure_detail = redact_secrets(str(exc))
        RESULT["FAILURE_DETAIL"] = failure_detail[:400]
        print(f"HARNESS_FAILURE_STEP={RESULT['FAILURE_STEP']}", flush=True)
        print(f"HARNESS_FAILURE_CLASS={type(exc).__name__}", flush=True)
        if failure_detail:
            print(f"HARNESS_FAILURE_DETAIL={failure_detail[:400]}", flush=True)
    finally:
        if TEMP_ROOT is not None and RESULT["CLEANUP_GATE"] == "NOT_RUN":
            try:
                shutil.rmtree(TEMP_ROOT)
                RESULT["CLEANUP_GATE"] = "PASS"
            except OSError:
                RESULT["CLEANUP_GATE"] = "FAIL"
        output_file = OUTPUT_ROOT / "runtime-receipt.json"
        output_file.write_text(json.dumps(RESULT, indent=2) + "\n", encoding="utf-8")
        fields = (
            "MAIN_SHA",
            "EXPECTED_BASE_SHA",
            "CANDIDATE_SHA",
            "SOURCE_SHA",
            "DOCKER_VERSION",
            "PROXY_IMAGE_REFERENCE",
            "PROXY_IMAGE_ID",
            "FRONTEND_IMAGE_ID",
            "SIDECAR_IMAGE_ID",
            "DOCKER_IMAGE_GATE",
            "FRONTEND_BUILD_GATE",
            "SIDECAR_STARTUP_GATE",
            "TLS_INGRESS_GATE",
            "SAME_ORIGIN_GATE",
            "PROXY_TRUST_GATE",
            "AUTHORIZATION_GATE",
            "NEGATIVE_SECURITY_TESTS",
            "READER_BROWSER_GATE",
            "SESSION_PROTECTION",
            "ORIGINAL_FALLBACK",
            "MINIFLUX_WRITES",
            "REAL_WALLHOP_REQUESTS",
            "CLEANUP_GATE",
            "FINAL",
        )
        for name in fields:
            print(f"{name}={RESULT.get(name, 'NOT_RUN')}", flush=True)
    return 0 if RESULT["FINAL"] == "PASS" and RESULT["CLEANUP_GATE"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
