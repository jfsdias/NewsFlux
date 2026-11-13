#!/usr/bin/env python3
"""Verify and adapt a hash-pinned, read-only copy of the active Caddyfile."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FRAGMENT = ROOT / "deploy/content-fallback-reader-pilot/reader-recovery.caddy"
CADDY_IMAGE = "caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af"
READER_ROUTE_MARKERS = ("/api/content-fallback/reader/", "/api/content-fallback/*")
ENV_REFERENCE = re.compile(r"\{\$([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}|\{env\.([A-Za-z_][A-Za-z0-9_]*)\}")


class GateError(RuntimeError):
    """A safe-to-report gate failure with no source configuration text."""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_matches(data: bytes, expected: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-fA-F]{64}", expected)) and sha256_bytes(data).lower() == expected.lower()


def _without_comment(line: str) -> str:
    quote: str | None = None
    escaped = False
    index = 0
    while index < len(line):
        char = line[index]
        if quote == '"':
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quote = None
        elif quote == "`":
            if char == "`":
                quote = None
        elif char in ('"', "`"):
            quote = char
        elif char == "#":
            return line[:index]
        index += 1
    return line


def _address_matches(candidate: str, requested: str) -> bool:
    candidate = candidate.rstrip(",")
    if candidate == requested:
        return True
    if requested.startswith(":") and candidate.endswith(requested):
        return True
    return False


def _site_block_closures(source: str, requested_address: str) -> list[int]:
    """Return line indexes closing top-level site blocks matching the address."""
    lines = source.splitlines(keepends=True)
    stack: list[bool] = []
    closures: list[int] = []
    for line_index, line in enumerate(lines):
        stripped = _without_comment(line).strip()
        if not stripped:
            continue
        if stripped == "}":
            if not stack:
                raise GateError("CADDY_BLOCK_STRUCTURE_INVALID")
            is_target = stack.pop()
            if is_target:
                closures.append(line_index)
            continue
        if stripped.endswith("{"):
            header = stripped[:-1].strip()
            is_target = False
            if not stack:
                try:
                    addresses = shlex.split(header.replace(",", " "))
                except ValueError as error:
                    raise GateError("CADDY_BLOCK_HEADER_INVALID") from error
                is_target = any(_address_matches(value, requested_address) for value in addresses)
            stack.append(is_target)
    if stack:
        raise GateError("CADDY_BLOCK_STRUCTURE_INVALID")
    return closures


def inject_import(source: str, site_address: str, import_path: str) -> str:
    """Insert one import into every matching site block without changing other text."""
    if not site_address or "\n" in site_address or "\n" in import_path:
        raise GateError("CADDY_IMPORT_ARGUMENT_INVALID")
    if import_path in source:
        raise GateError("CADDY_IMPORT_ALREADY_PRESENT")
    lines = source.splitlines(keepends=True)
    closures = _site_block_closures(source, site_address)
    if not closures:
        raise GateError("CADDY_SITE_BLOCK_NOT_FOUND")
    for line_index in reversed(closures):
        closing = lines[line_index]
        indent = re.match(r"\s*", closing).group(0)  # type: ignore[union-attr]
        newline = "\r\n" if closing.endswith("\r\n") else "\n"
        lines.insert(line_index, f"{indent}\timport {import_path}{newline}")
    return "".join(lines)


def _routes(config: dict[str, Any]) -> list[dict[str, Any]]:
    servers = config.get("apps", {}).get("http", {}).get("servers", {})
    result: list[dict[str, Any]] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            if "handle" in value:
                result.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    for server in servers.values():
        visit(server.get("routes", []))
    return result


def _route_text(route: dict[str, Any]) -> str:
    return json.dumps(route, sort_keys=True, separators=(",", ":")).lower()


def _route_local_text(route: dict[str, Any]) -> str:
    def remove_children(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: remove_children(child) for key, child in value.items() if key != "routes"}
        if isinstance(value, list):
            return [remove_children(child) for child in value]
        return value

    return json.dumps(remove_children(route), sort_keys=True, separators=(",", ":")).lower()


def _is_reader_route(route: Any) -> bool:
    if not isinstance(route, dict):
        return False
    matcher_text = json.dumps(route.get("match", []), sort_keys=True, separators=(",", ":")).lower()
    return any(marker in matcher_text for marker in READER_ROUTE_MARKERS)


def _remove_reader_routes(value: Any) -> Any:
    """Remove only fragment routes, retaining Caddy's parent subroute groups."""
    if isinstance(value, dict):
        return {key: _remove_reader_routes(child) for key, child in value.items()}
    if isinstance(value, list):
        kept = []
        for child in value:
            if _is_reader_route(child):
                continue
            kept.append(_remove_reader_routes(child))
        return kept
    return value


def _stable_digest(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:12]


def _count_reader_routes(value: Any) -> int:
    if isinstance(value, dict):
        own = 1 if _is_reader_route(value) else 0
        return own + sum(_count_reader_routes(child) for child in value.values())
    if isinstance(value, list):
        return sum(_count_reader_routes(child) for child in value)
    return 0


def _normalize_group_ids(value: Any) -> Any:
    """Normalize Caddy's generated group labels while preserving group membership."""
    labels: dict[str, str] = {}

    def visit(node: Any) -> Any:
        if isinstance(node, dict):
            result = {}
            for key, child in node.items():
                if key == "group" and isinstance(child, str):
                    if child not in labels:
                        labels[child] = f"normalized-{len(labels)}"
                    result[key] = labels[child]
                else:
                    result[key] = visit(child)
            return result
        if isinstance(node, list):
            return [visit(child) for child in node]
        return node

    return visit(value)


def _category_routes(routes: list[dict[str, Any]], category: str) -> list[dict[str, Any]]:
    patterns = {
        "summary": re.compile(r"summary", re.IGNORECASE),
        "story": re.compile(r"story|ranker", re.IGNORECASE),
        "static": re.compile(r'"handler":"file_server"'),
        "spa": re.compile(r"index\.html|try_files", re.IGNORECASE),
    }
    matcher = patterns[category]
    return [route for route in routes if matcher.search(_route_local_text(route))]


def compare_route_parity(baseline: dict[str, Any], candidate: dict[str, Any]) -> dict[str, bool]:
    baseline_routes = _routes(baseline)
    candidate_routes = [route for route in _routes(candidate) if not _is_reader_route(route)]
    baseline_servers = baseline.get("apps", {}).get("http", {}).get("servers", {})
    candidate_servers = _remove_reader_routes(candidate.get("apps", {}).get("http", {}).get("servers", {}))
    all_preserved = json.dumps(_normalize_group_ids(baseline_servers), sort_keys=True, separators=(",", ":")) == json.dumps(
        _normalize_group_ids(candidate_servers), sort_keys=True, separators=(",", ":")
    )
    result = {"routes_preserved": all_preserved}
    for category in ("summary", "story", "static", "spa"):
        original = _category_routes(baseline_routes, category)
        present = _category_routes(candidate_routes, category)
        normalized_original = _normalize_group_ids(original)
        normalized_present = _normalize_group_ids(present)
        result[category] = bool(original) and Counter(map(_route_text, normalized_original)) == Counter(
            map(_route_text, normalized_present)
        )
    return result


def _synthetic_env(source: str, trusted_proxy_ip: str) -> dict[str, str]:
    values: dict[str, str] = {"NEWSFLUX_PILOT_TRUSTED_PROXY_IP": trusted_proxy_ip}
    for match in ENV_REFERENCE.finditer(source):
        name = match.group(1) or match.group(2)
        if name in values:
            continue
        upper = name.upper()
        if "IP" in upper:
            values[name] = "192.0.2.77"
        elif "PORT" in upper:
            values[name] = "2000"
        elif "EMAIL" in upper:
            values[name] = "pilot@example.invalid"
        elif "HOST" in upper or "DOMAIN" in upper:
            values[name] = "newsflux.test"
        else:
            values[name] = "synthetic-r4-value"
    return values


def _run_caddy(temp_dir: Path, config_name: str, command: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    docker_command = ["docker", "run", "--rm", "--network", "none", "--volume", f"{temp_dir}:/work:ro"]
    for name, value in env.items():
        docker_command.extend(("--env", f"{name}={value}"))
    docker_command.extend((CADDY_IMAGE, "caddy", command, "--config", f"/work/{config_name}", "--adapter", "caddyfile"))
    try:
        return subprocess.run(docker_command, capture_output=True, text=True, check=False)
    except OSError as error:
        raise GateError("CADDY_TOOL_UNAVAILABLE") from error


def _adapt(temp_dir: Path, config_name: str, env: dict[str, str]) -> dict[str, Any]:
    result = _run_caddy(temp_dir, config_name, "adapt", env)
    if result.returncode != 0:
        raise GateError("CADDY_ADAPT_FAILED")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise GateError("CADDY_ADAPT_OUTPUT_INVALID") from error
    if not isinstance(value, dict):
        raise GateError("CADDY_ADAPT_OUTPUT_INVALID")
    return value


def _validate(temp_dir: Path, config_name: str, env: dict[str, str]) -> None:
    result = _run_caddy(temp_dir, config_name, "validate", env)
    if result.returncode != 0:
        raise GateError("CADDY_VALIDATE_FAILED")


def run_gate(active_path: Path, expected_sha256: str, site_address: str) -> dict[str, Any]:
    try:
        source_bytes = active_path.read_bytes()
    except OSError as error:
        raise GateError("ACTIVE_CADDY_COPY_UNREADABLE") from error
    if not sha256_matches(source_bytes, expected_sha256):
        raise GateError("ACTIVE_CADDY_SHA256_MISMATCH")
    try:
        source = source_bytes.decode("utf-8")
        fragment_bytes = FRAGMENT.read_bytes()
        fragment = fragment_bytes.decode("utf-8")
    except (UnicodeDecodeError, OSError) as error:
        raise GateError("CADDY_INPUT_INVALID") from error

    with tempfile.TemporaryDirectory(prefix="newsflux-r4-caddy-") as temp_name:
        temp_dir = Path(temp_name)
        os.chmod(temp_dir, 0o700)
        baseline_path = temp_dir / "baseline.Caddyfile"
        candidate_path = temp_dir / "candidate.Caddyfile"
        fragment_path = temp_dir / "reader-recovery.caddy"
        baseline_path.write_bytes(source_bytes)
        candidate_path.write_text(
            inject_import(source, site_address, "/work/reader-recovery.caddy"), encoding="utf-8"
        )
        fragment_path.write_bytes(fragment_bytes)
        for path in (baseline_path, candidate_path, fragment_path):
            os.chmod(path, 0o600)
        if baseline_path.read_bytes() != source_bytes:
            raise GateError("ACTIVE_CADDY_TEMP_COPY_MISMATCH")

        # The file is mounted read-only and Caddy diagnostics are never emitted.
        env = _synthetic_env(source + fragment, "192.0.2.45")
        _validate(temp_dir, "baseline.Caddyfile", env)
        baseline = _adapt(temp_dir, "baseline.Caddyfile", env)
        _validate(temp_dir, "candidate.Caddyfile", env)
        candidate = _adapt(temp_dir, "candidate.Caddyfile", env)
        parity = compare_route_parity(baseline, candidate)
        if not parity["routes_preserved"]:
            baseline_servers = baseline.get("apps", {}).get("http", {}).get("servers", {})
            candidate_servers = candidate.get("apps", {}).get("http", {}).get("servers", {})
            cleaned_servers = _remove_reader_routes(candidate_servers)
            raise GateError(
                "BASELINE_ROUTE_PARITY_FAILED"
                f"_base={_stable_digest(baseline_servers)}"
                f"_candidate={_stable_digest(cleaned_servers)}"
                f"_base_nodes={len(_routes(baseline))}"
                f"_candidate_nodes={len(_routes(candidate))}"
                f"_reader_nodes={_count_reader_routes(candidate_servers)}"
                f"_clean_nodes={len(_routes({'apps': {'http': {'servers': cleaned_servers}}}))}"
            )
        return {
            "sha256": sha256_bytes(source_bytes),
            "parity": parity,
            "reader_route_present": any("/api/content-fallback/reader/" in _route_text(route) for route in _routes(candidate)),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--active-caddyfile", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--site-address", default=":2000")
    args = parser.parse_args()
    try:
        result = run_gate(args.active_caddyfile, args.expected_sha256, args.site_address)
    except GateError as error:
        print(f"ACTIVE_CADDY_BASELINE=FAIL ({error})")
        print("CADDY_MERGED_CONFIG_GATE=NOT_VERIFIED")
        return 1

    parity = result["parity"]
    print("ACTIVE_CADDY_BASELINE=PASS")
    print("ACTIVE_CADDY_SHA256=PASS")
    print(f"ACTIVE_CADDY_SHA256_VALUE={result['sha256']}")
    print("CADDY_BASELINE_VALIDATE=PASS")
    print("CADDY_MERGED_CONFIG_GATE=PASS")
    print(f"BASELINE_ROUTE_PARITY={'PASS' if parity['routes_preserved'] else 'FAIL'}")
    for category, gate in (("summary", "SUMMARY_ROUTE_PRESERVED"), ("story", "STORY_ROUTE_PRESERVED"), ("static", "STATIC_ASSET_ROUTING_PRESERVED"), ("spa", "SPA_ROUTING_PRESERVED")):
        print(f"{gate}={'PASS' if parity[category] else 'NOT_VERIFIED'}")
    print(f"READER_ROUTE_ADAPTED={'PASS' if result['reader_route_present'] else 'FAIL'}")
    print("CONFIG_CONTENT_LOGGED=NO")
    required_routes = all(parity[name] for name in ("summary", "story", "static", "spa"))
    return 0 if result["reader_route_present"] and required_routes else 1


if __name__ == "__main__":
    sys.exit(main())
