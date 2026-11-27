#!/usr/bin/env python3
"""NPM111 read-only nginx file expansion audit.

nginx -T tests files on disk, NOT the configuration loaded in worker memory.
Never prints raw config, credentials, HTTP requests, IP addresses or headers.
Never changes Docker/NPM/PR188 or sends HTTP traffic.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys

LEGACY = "newsflux-pr188-content-fallback"
NPM = "npm"
HOST_FILE = "/data/nginx/proxy_host/111.conf"
MAX_BYTES = 16 * 1024 * 1024
PROXY_PASS = re.compile(r"(?m)^[ \t]*proxy_pass[ \t]+([^;\r\n]+);")
CONFIG_HEADER = re.compile(r"(?m)^# configuration file ([^:\r\n]+):[ \t]*$")


def proxy_pass_targets(contents: str) -> list[str]:
    return [m.strip() for m in PROXY_PASS.findall(contents)]


def names_legacy(target: str) -> bool:
    return bool(re.search(r"(?<![a-zA-Z0-9_-])" + re.escape(LEGACY) +
                          r"(?![a-zA-Z0-9_-])", target))


def expanded_host_block(dump: str) -> str | None:
    headers = list(CONFIG_HEADER.finditer(dump))
    found = []
    for i, marker in enumerate(headers):
        if marker.group(1).endswith("/proxy_host/111.conf"):
            end = headers[i + 1].start() if i + 1 < len(headers) else len(dump)
            found.append(dump[marker.end():end])
    return found[0] if len(found) == 1 else None


def output(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, capture_output=True, timeout=20, check=False)
    if len(proc.stdout) + len(proc.stderr) > MAX_BYTES:
        raise ValueError("OUTPUT_LIMIT")
    return proc.returncode, (proc.stdout + b"\n" + proc.stderr).decode("utf-8", "replace")


def container_status(items: list[dict]) -> dict[str, bool]:
    by_name = {item["Name"].lstrip("/"): item for item in items}
    if len(items) != 2 or set(by_name) != {NPM, LEGACY}:
        raise ValueError("CONTAINER_IDENTITY")
    npm, legacy = by_name[NPM], by_name[LEGACY]
    return {
        "NPM_RUNNING": npm["State"]["Running"] is True,
        "LEGACY_RUNNING": legacy["State"]["Running"] is True,
        "LEGACY_NPM_NETWORK": "npm-proxyyml_default" in legacy["NetworkSettings"]["Networks"],
        "LEGACY_RW_DATA_VOLUME": any(
            m.get("Destination") == "/data"
            and m.get("RW") is True
            and m.get("Type") == "volume"
            for m in legacy.get("Mounts", [])
        ),
    }


def main() -> int:
    print("=== NEWSFLUX NPM111 G2C EFFECTIVE FILE AUDIT (READ ONLY) ===")
    try:
        rc, raw = output(["docker", "inspect", NPM, LEGACY])
        if rc != 0:
            raise ValueError("CONTAINER_INSPECT")
        old = json.loads(raw)
        status = container_status(old)
        for key, value in status.items():
            print(f"{key}={str(value).lower()}")
        if not all(status.values()):
            raise ValueError("IDENTITY_GATE")

        rc, on_disk = output(["docker", "exec", NPM, "cat", HOST_FILE])
        if rc != 0:
            raise ValueError("PERSISTED_CONFIG_NOT_FOUND")
        target_disk = proxy_pass_targets(on_disk)
        print("NPM111_ON_DISK_PASS_COUNT=" + str(len(target_disk)))
        print("NPM111_ON_DISK_LEGACY=" + str(any(map(names_legacy, target_disk))).lower())
        if len(target_disk) != 1 or not names_legacy(target_disk[0]):
            raise ValueError("DISK_TARGET_MISMATCH")

        rc, expanded = output(["docker", "exec", NPM, "nginx", "-T"])
        print("NGINX_T_RETURN_CODE=" + str(rc))
        if rc != 0:
            raise ValueError("NGINX_T_NOT_VALID")
        block = expanded_host_block(expanded)
        print("NGINX_T_HOST111_SECTION=" + ("FOUND" if block is not None else "MISSING_OR_AMBIGUOUS"))
        if block is None:
            raise ValueError("NGINX_T_HOST111_UNVERIFIED")
        targets = proxy_pass_targets(block)
        print("NGINX_T_HOST111_PASS_COUNT=" + str(len(targets)))
        matching = targets == target_disk
        print("NGINX_T_EQUALS_DISK_TARGET=" + str(matching).lower())
        if not matching:
            raise ValueError("NGINX_T_TARGET_DRIFT")

        rc, after_raw = output(["docker", "inspect", NPM, LEGACY])
        if rc != 0:
            raise ValueError("POSTSTATE_INSPECT")
        before = {x["Name"]: (x["Id"], x["Image"], x["State"]["Running"]) for x in old}
        after = {x["Name"]: (x["Id"], x["Image"], x["State"]["Running"])
                 for x in json.loads(after_raw)}
        same = before == after
        print("DOCKER_IDENTITY_UNCHANGED=" + str(same).lower())
        if not same:
            raise ValueError("DOCKER_DRIFT")

        print("NGINX_ON_DISK_PARSE_AND_EXPANSION=PASS")
        print("NGINX_LOADED_PROCESS_CONFIG=UNVERIFIED")
        print("TRAFFIC_UPSTREAM_ATTRIBUTION=PENDING")
        print("PRODUCTION_MUTATIONS=NONE_BY_TOOL")
        return 0
    except (ValueError, KeyError, TypeError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        reason = str(exc) if isinstance(exc, ValueError) else "UNVERIFIED"
        if not re.fullmatch(r"[A-Z_]+", reason):
            reason = "UNVERIFIED"
        print("G2C_FILE_GATE=BLOCKED CODE=" + reason)
        print("NGINX_LOADED_PROCESS_CONFIG=UNVERIFIED")
        print("TRAFFIC_UPSTREAM_ATTRIBUTION=PENDING")
        print("PRODUCTION_MUTATIONS=NONE_BY_TOOL")
        return 2


if __name__ == "__main__":
    sys.exit(main())
