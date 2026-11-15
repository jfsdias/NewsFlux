#!/usr/bin/env python3
"""G4 only: fail-closed Docker IPAM and locally advertised VPN route preflight.

No networks/containers or host config are modified. Writes ONLY the G4
ephemeral Compose override once all read-only gates pass. Never prints
raw Docker network inspection, peer identities, VPN state or credentials.
Remote networks invisible to both the host routes and active VPN peer route
advertisements remain outside the scope of this evidence.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import pathlib
import re
import shutil
import subprocess
import sys

CANDIDATE_READER = "10.240.0.96/28"
CANDIDATE_EGRESS = "10.240.0.112/28"


class GateError(ValueError):
    pass


def parse_ipv4(prefix: str) -> ipaddress.IPv4Network | None:
    try:
        network = ipaddress.ip_network(prefix, strict=False)
    except (ValueError, TypeError) as exc:
        raise GateError("INVALID_PREFIX") from exc
    return network if isinstance(network, ipaddress.IPv4Network) else None


def validate_inventory(reader: str, egress: str, occupied: list[str], *, vpn_verified: bool) -> None:
    """Require canonical private IPv4 /28s not overlapping each other or any observed prefix."""
    try:
        a = ipaddress.ip_network(reader, strict=True)
        b = ipaddress.ip_network(egress, strict=True)
    except (ValueError, TypeError) as exc:
        raise GateError("INVALID_CANDIDATE") from exc
    if any(not isinstance(n, ipaddress.IPv4Network) or n.prefixlen != 28 or not n.is_private for n in (a, b)):
        raise GateError("INVALID_CANDIDATE")
    if a.overlaps(b):
        raise GateError("CANDIDATE_OVERLAP")
    if not vpn_verified:
        raise GateError("VPN_ROUTES_UNVERIFIED")
    for prefix in occupied:
        network = parse_ipv4(prefix)
        if network is not None and (a.overlaps(network) or b.overlaps(network)):
            raise GateError("OVERLAP")


def extract_vpn_prefixes(output: str) -> set[str]:
    """Parse 'wg show all allowed-ips': interface, peer key, comma/space separated CIDRs."""
    out = set()
    for line in output.splitlines():
        cols = line.split(maxsplit=2)
        if len(cols) != 3:
            raise GateError("WG_ALLOWED_IPS_UNVERIFIED")
        for token in re.split(r"[\s,]+", cols[2].strip()):
            if token:
                parsed = parse_ipv4(token)
                if parsed is not None:
                    out.add(str(parsed))
    return out


def render_override(reader: str, egress: str) -> str:
    # These are validated before writing to the operator's temp staging directory.
    validate_inventory(reader, egress, [], vpn_verified=True)
    return (
        'services:\n'
        '  wallhop-egress:\n'
        '    environment:\n'
        '      WALLHOP_UPSTREAM: "127.0.0.1:9"\n'
        '      MINIFLUX_UPSTREAM: "127.0.0.1:9"\n'
        'networks:\n'
        '  reader_internal:\n'
        '    ipam:\n'
        '      config:\n'
        f'        - subnet: "{reader}"\n'
        '  egress_internal:\n'
        '    ipam:\n'
        '      config:\n'
        f'        - subnet: "{egress}"\n'
    )


def command(*parts: str) -> str:
    try:
        process = subprocess.run(parts, capture_output=True, text=True, check=False, timeout=45)
    except (OSError, subprocess.SubprocessError) as exc:
        raise GateError("READ_ONLY_QUERY_UNAVAILABLE") from exc
    if process.returncode != 0 or len(process.stdout) > 8_000_000:
        raise GateError("READ_ONLY_QUERY_UNAVAILABLE")
    return process.stdout


def as_json(*parts: str):
    try:
        return json.loads(command(*parts))
    except (json.JSONDecodeError, ValueError) as exc:
        if isinstance(exc, GateError):
            raise
        raise GateError("INVALID_JSON_RESPONSE") from exc


def discover_occupied() -> tuple[list[str], dict[str, int | str]]:
    ids = command("docker", "network", "ls", "-q").split()
    networks = as_json("docker", "network", "inspect", *ids) if ids else []
    occupied = []
    network_prefixes = 0
    for n in networks:
        configs = (n.get("IPAM") or {}).get("Config") or []
        if not configs and n.get("Driver") not in {"host", "null"}:
            raise GateError("NETWORK_CIDR_UNVERIFIED")
        for item in configs:
            if item.get("Subnet"):
                prefix = parse_ipv4(item["Subnet"])
                if prefix is not None:
                    occupied.append(str(prefix))
                    network_prefixes += 1
            elif n.get("Driver") not in {"host", "null"}:
                raise GateError("NETWORK_CIDR_UNVERIFIED")

    routes = as_json("ip", "-j", "-4", "route", "show", "table", "all")
    route_count = 0
    for entry in routes:
        dst = entry.get("dst", "default")
        if dst == "default":
            continue
        prefix = parse_ipv4(dst)
        if prefix is None:
            raise GateError("UNPARSED_IPV4_ROUTE")
        occupied.append(str(prefix))
        route_count += 1

    interfaces = as_json("ip", "-j", "-4", "addr", "show")
    address_count = 0
    for interface in interfaces:
        for addr in interface.get("addr_info", []):
            if addr.get("family") != "inet":
                continue
            prefix = parse_ipv4(f'{addr.get("local")}/{addr.get("prefixlen")}')
            if prefix is None:
                raise GateError("IPV4_INTERFACE_UNVERIFIED")
            occupied.append(str(prefix))
            address_count += 1

    links = as_json("ip", "-j", "-d", "link", "show")
    wg_present = any(
        (link.get("linkinfo") or {}).get("info_kind") == "wireguard"
        for link in links
    )
    tailscale_present = any(str(link.get("ifname", "")).startswith("tailscale") for link in links)

    wg_status = "NOT_ACTIVE"
    if shutil.which("wg"):
        wg_output = command("wg", "show", "all", "allowed-ips")
        vpn_prefixes = extract_vpn_prefixes(wg_output)
        occupied.extend(sorted(vpn_prefixes))
        wg_status = "QUERY_PASS"
    elif wg_present:
        raise GateError("WG_ROUTES_UNVERIFIED")

    tailscale_status = "NOT_ACTIVE"
    if shutil.which("tailscale"):
        try:
            state = as_json("tailscale", "status", "--json")
        except GateError as exc:
            if tailscale_present:
                raise GateError("TAILSCALE_ROUTES_UNVERIFIED") from exc
            state = {"BackendState": "Stopped"}
        backend = state.get("BackendState", "Unknown")
        if backend == "Running":
            peers = state.get("Peer") or {}
            tailscale_prefixes = []
            for peer in peers.values():
                # Treat missing peer route information as unknown, not as no routes.
                if not any(field in peer for field in ("AllowedIPs", "PrimaryRoutes")):
                    raise GateError("TAILSCALE_REMOTE_ROUTES_UNVERIFIED")
                for field in ("AllowedIPs", "PrimaryRoutes"):
                    val = peer.get(field) or []
                    if not isinstance(val, list):
                        raise GateError("TAILSCALE_REMOTE_ROUTES_UNVERIFIED")
                    for item in val:
                        prefix = parse_ipv4(item)
                        if prefix is not None:
                            tailscale_prefixes.append(str(prefix))
            occupied.extend(tailscale_prefixes)
            tailscale_status = "PEER_ROUTE_FIELDS_PARSED"
        elif tailscale_present:
            raise GateError("TAILSCALE_ROUTES_UNVERIFIED")
    elif tailscale_present:
        raise GateError("TAILSCALE_ROUTES_UNVERIFIED")
    return occupied, {
        "DOCKER_NETWORK_COUNT": len(networks),
        "DOCKER_IPV4_PREFIX_COUNT": network_prefixes,
        "HOST_IPV4_ROUTE_COUNT": route_count,
        "HOST_IPV4_INTERFACE_COUNT": address_count,
        "WIREGUARD_LOCAL_GATE": wg_status,
        "TAILSCALE_LOCAL_GATE": tailscale_status,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="G4 only, no Docker mutations")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        occupied, stats = discover_occupied()
        validate_inventory(
            CANDIDATE_READER, CANDIDATE_EGRESS,
            occupied, vpn_verified=True
        )
        rendered = render_override(CANDIDATE_READER, CANDIDATE_EGRESS)
        output = pathlib.Path(args.output)
        if output.is_symlink() or not output.parent.is_dir() or output.exists():
            raise GateError("OVERRIDE_PATH_UNSAFE")
        with output.open("x", encoding="utf-8") as handle:
            handle.write(rendered)
        output.chmod(0o600)
    except (GateError, OSError) as exc:
        code = str(exc) if isinstance(exc, GateError) else "OVERRIDE_WRITE_ERROR"
        if not re.fullmatch(r"[A-Z_]+", code):
            code = "UNVERIFIED"
        print("G4_IPAM_GATE=BLOCKED CODE=" + code)
        print("DOCKER_NETWORK_MUTATIONS=NONE_BY_IPAM_GATE")
        return 2
    print("G4_IPAM_GATE=PASS_LOCAL_OBSERVED_ROUTES")
    for key, value in stats.items():
        print(f"{key}={value}")
    print(f"G4_READER_SUBNET={CANDIDATE_READER}")
    print(f"G4_EGRESS_SUBNET={CANDIDATE_EGRESS}")
    print("UNOBSERVED_REMOTE_VPN_ROUTES=NOT_INFERRED")
    print("DOCKER_NETWORK_MUTATIONS=NONE_BY_IPAM_GATE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
