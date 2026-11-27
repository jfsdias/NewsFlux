#!/usr/bin/env python3
"""Validate expanded standalone WallHop Compose without printing secrets or configs.

Input is JSON from 'docker compose config --format json'. This command is
read-only; neither validator nor unit tests access Docker runtime.
"""

from __future__ import annotations

import json
import re
import sys


class TopologyError(Exception):
    pass


def must(condition: bool, code: str) -> None:
    if not condition:
        raise TopologyError(code)


def image_pinned(value: object) -> bool:
    return isinstance(value, str) and bool(
        re.fullmatch(r"sha256:[0-9a-f]{64}", value)
        or re.fullmatch(r"[^@\s]+@sha256:[0-9a-f]{64}", value)
    )


def names(service: dict) -> set[str]:
    networks = service.get("networks", {})
    return set(networks) if isinstance(networks, (dict, list)) else set()


def validate(compose: dict) -> None:
    must(compose.get("name") == "newsflux-wallhop-isolated", "PROJECT_IDENTITY")
    services = compose.get("services", {})
    must(set(services) == {"wallhop-recovery", "wallhop-egress"}, "SERVICE_SCOPE")
    recovery, relay = services["wallhop-recovery"], services["wallhop-egress"]
    must(recovery.get("container_name") == "newsflux-wallhop-recovery", "RECOVERY_IDENTITY")
    must(relay.get("container_name") == "newsflux-wallhop-egress", "RELAY_IDENTITY")
    must(image_pinned(recovery.get("image")) and image_pinned(relay.get("image")),
         "EXACT_IMAGE_DIGEST")
    must(names(recovery) == {"reader_internal", "egress_internal"}, "RECOVERY_NETWORKS")
    must(names(relay) == {"egress_internal", "npm_proxy"}, "RELAY_NETWORKS")
    networks = compose.get("networks", {})
    must(networks.get("reader_internal", {}).get("internal") is True, "READER_NETWORK_INTERNAL")
    must(networks.get("egress_internal", {}).get("internal") is True, "EGRESS_NETWORK_INTERNAL")
    must(networks.get("npm_proxy", {}).get("external") is True, "NPM_NETWORK_EXTERNAL")
    must(networks.get("npm_proxy", {}).get("name") == "npm-proxyyml_default", "NPM_NETWORK_IDENTITY")
    for name, service in services.items():
        must(not service.get("ports") and not service.get("expose"), "NO_PUBLISHED_PORTS_" + name.upper().replace("-", "_"))
        must(service.get("read_only") is True, "READ_ONLY_FILESYSTEM")
        must(service.get("privileged", False) is False, "NO_PRIVILEGED")
        must("ALL" in service.get("cap_drop", []), "ALL_CAPABILITIES_DROPPED")
        must("no-new-privileges:true" in service.get("security_opt", []), "NO_NEW_PRIVILEGES")
        must(str(service.get("restart", "no")).casefold() == "no", "NO_AUTO_RESTART")
        must(service.get("network_mode", "") not in {"host", "service:npm", "container:npm"},
             "NO_HOST_NETWORK")
    must(not recovery.get("volumes"), "NO_RECOVERY_RW_VOLUME")
    tmpfs = recovery.get("tmpfs", [])
    must(len(tmpfs) == 1 and str(tmpfs[0]).startswith("/data:"), "RECOVERY_TMPFS")
    must(recovery.get("user") == "10001:10001", "RECOVERY_NONROOT")
    must(relay.get("user") == "99:99", "RELAY_NONROOT")

    environment = recovery.get("environment", {})
    must(environment.get("CONTENT_FALLBACK_POLICIES_JSON") == '{"enabled":false}',
         "POLICY_DEFAULT_DISABLED")
    must(environment.get("CONTENT_FALLBACK_READER_ENABLED") == "false", "READER_BRIDGE_DISABLED")
    must(environment.get("CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY") == "true", "RELAY_REQUIRED")
    must(environment.get("CONTENT_FALLBACK_EGRESS_RELAY") == "wallhop-egress", "RELAY_ID")
    must(environment.get("MINIFLUX_BASE_URL", "").startswith("https://"), "MINIFLUX_HTTPS")
    allowed = environment.get("CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS", "").split(",")
    must(len(allowed) == 2 and allowed[0] == "wallhop.io"
         and bool(re.fullmatch(r"[a-z0-9][a-z0-9.-]*[a-z0-9]", allowed[1])),
         "EGRESS_ALLOWLIST_EXACT")
    must(len(environment.get("MINIFLUX_API_TOKEN", "")) >= 1
         and len(environment.get("CONTENT_FALLBACK_API_TOKEN", "")) >= 32,
         "SEPARATE_TOKENS_REQUIRED")

    mounts = relay.get("volumes", [])
    must(len(mounts) == 1 and mounts[0].get("target") ==
         "/usr/local/etc/haproxy/haproxy.cfg" and mounts[0].get("read_only") is True,
         "RELAY_CONFIG_READONLY")
    must(not compose.get("volumes"), "NO_DURABLE_VOLUMES")


def main() -> int:
    try:
        document = json.load(sys.stdin)
        validate(document)
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, TopologyError) as exc:
        code = str(exc) if isinstance(exc, TopologyError) else "INVALID_CONFIG"
        print("WALLHOP_ISOLATED_TOPOLOGY=BLOCKED CODE=" + code)
        return 2
    print("WALLHOP_ISOLATED_TOPOLOGY=PASS")
    print("LEGACY_PR188_RECREATE=NO_IN_DECLARED_SCOPE")
    print("NPM_HOST111_WRITE=NO_IN_DECLARED_SCOPE")
    print("READER_BRIDGE=DISABLED")
    print("POLICY=DISABLED")
    print("STORAGE=EPHEMERAL_TMPFS")
    print("LIVE_RUNTIME_GATE=NOT_RUN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
