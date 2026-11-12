#!/usr/bin/env python3
"""Read-only pilot preflight; no configuration values or secrets are printed."""
from __future__ import annotations

import ipaddress
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


def fail(code: str) -> None:
    print(f"PREFLIGHT=FAIL_{code}")
    raise SystemExit(1)


def run(*args: str) -> str:
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
    except (OSError, subprocess.SubprocessError):
        fail("COMMAND_UNAVAILABLE")


def required(name: str) -> str:
    value = os.environ.get(name, "")
    if not value or "\n" in value:
        fail("MISSING_INPUT")
    return value


def private_file(name: str, *, owner: int | None = None) -> Path:
    file = Path(required(name))
    try:
        details = file.lstat()
    except OSError:
        fail("PRIVATE_FILE_UNAVAILABLE")
    if not stat.S_ISREG(details.st_mode) or stat.S_IMODE(details.st_mode) != 0o600:
        fail("PRIVATE_FILE_PERMISSIONS")
    if owner is not None and details.st_uid != owner:
        fail("KEY_OWNER")
    return file


def main() -> None:
    if any(name in os.environ for name in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG")):
        fail("DOCKER_OVERRIDE")
    sha = required("NEWSFLUX_PILOT_APPROVED_SHA")
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        fail("APPROVED_SHA")
    previous_config_sha = required("NEWSFLUX_PILOT_PREVIOUS_CONFIG_SHA256")
    if not re.fullmatch(r"[a-f0-9]{64}", previous_config_sha):
        fail("PREVIOUS_CONFIG_SHA256")
    if run("git", "rev-parse", "HEAD") != sha or run("git", "status", "--porcelain"):
        fail("CHECKOUT_IDENTITY")
    if run("docker", "context", "show") != "default":
        fail("DOCKER_CONTEXT")
    for name in ("NEWSFLUX_PILOT_WEB_IMAGE", "NEWSFLUX_PILOT_SUMMARY_IMAGE"):
        image = required(name)
        if not re.fullmatch(r"[^\s@]+@sha256:[a-f0-9]{64}", image):
            fail("IMAGE_REFERENCE")
        revision = run("docker", "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}', image)
        if revision != sha:
            fail("IMAGE_REVISION")
    for name in ("NEWSFLUX_PILOT_TRUSTED_PROXY_IP", "NEWSFLUX_PILOT_CADDY_IP"):
        try:
            ipaddress.ip_address(required(name))
        except ValueError:
            fail("PROXY_IP")
    try:
        subnet = ipaddress.ip_network(required("NEWSFLUX_PILOT_PRIVATE_SUBNET"), strict=True)
        if ipaddress.ip_address(required("NEWSFLUX_PILOT_CADDY_IP")) not in subnet:
            fail("PRIVATE_SUBNET")
    except ValueError:
        fail("PRIVATE_SUBNET")
    private_file("NEWSFLUX_PILOT_PRIVATE_ENV_FILE")
    private_file("NEWSFLUX_PILOT_KEY_FILE", owner=10001)
    ledger = Path(required("NEWSFLUX_PILOT_LEDGER_DIR"))
    try:
        info = ledger.lstat()
    except OSError:
        fail("LEDGER_DIRECTORY")
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 10001 or stat.S_IMODE(info.st_mode) != 0o700:
        fail("LEDGER_PERMISSIONS")
    previous_container = required("NEWSFLUX_PILOT_PREVIOUS_CONTAINER")
    previous_image = required("NEWSFLUX_PILOT_PREVIOUS_IMAGE_ID")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", previous_container) or not re.fullmatch(r"sha256:[a-f0-9]{64}", previous_image):
        fail("PREVIOUS_IDENTITY")
    if run("docker", "inspect", "--format", "{{.Image}}", previous_container) != previous_image:
        fail("PREVIOUS_IMAGE_MISMATCH")
    if run("docker", "image", "inspect", "--format", "{{.Id}}", previous_image) != previous_image:
        fail("PREVIOUS_IMAGE_UNAVAILABLE")
    active_config_line = run("docker", "exec", previous_container, "sha256sum", "/etc/caddy/Caddyfile")
    active_config_sha = active_config_line.split(maxsplit=1)[0] if active_config_line else ""
    if active_config_sha != previous_config_sha:
        fail("PREVIOUS_CONFIG_MISMATCH")
    print("PREFLIGHT=PASS_IDENTITY_CONFIG_AND_FILE_METADATA_ONLY")
    print("MANUAL_GATES=PROXY_NETWORK_GATEWAY_BUDGET_PRIVACY_AND_ROLLBACK_STILL_REQUIRED")


if __name__ == "__main__":
    main()
