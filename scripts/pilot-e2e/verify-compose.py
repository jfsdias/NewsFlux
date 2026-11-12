#!/usr/bin/env python3
"""Fail closed on published API ports or non-private pilot networks."""
import json
import sys
from pathlib import Path


def verify(document: dict) -> None:
    services = document.get("services")
    if not isinstance(services, dict):
        raise ValueError("missing services")
    required_services = {"pilot-reader", "summary-api", "pilot-test-ingress", "pilot-e2e"}
    if not required_services.issubset(services):
        raise ValueError("missing required pilot services")
    for name in required_services:
        ports = services[name].get("ports") or []
        if ports:
            raise ValueError(f"published host port on {name}")

    required_networks = {
        "pilot-reader": {"frontend", "summary_private"},
        "summary-api": {"gateway", "summary_private"},
        "pilot-test-ingress": {"frontend", "summary_private"},
        "pilot-e2e": {"frontend", "summary_private"},
    }
    for name, expected in required_networks.items():
        actual = set(services[name].get("networks", {}))
        if not expected.issubset(actual):
            raise ValueError(f"missing required network on {name}")

    networks = document.get("networks", {})
    if networks.get("summary_private", {}).get("internal") is not True:
        raise ValueError("summary_private must be internal")
    if networks.get("gateway", {}).get("internal") is not True:
        raise ValueError("test gateway network must be internal")


def main(path: str) -> None:
    verify(json.loads(Path(path).read_text(encoding="utf-8")))
    print("COMPOSE_PORT_AND_NETWORK_GATE=PASS")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify-compose.py /path/to/compose-config.json")
    try:
        main(sys.argv[1])
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"COMPOSE_PORT_AND_NETWORK_GATE=FAIL_{type(error).__name__}") from None
