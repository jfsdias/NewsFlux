#!/usr/bin/env python3
"""Historical G4 Compose config assertions; never starts containers."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy/wallhop-isolated"))
from g4_ipam_gate import CANDIDATE_EGRESS, CANDIDATE_READER, render_override

env = {
    **os.environ,
    "WALLHOP_SIDECAR_IMAGE": "sha256:" + "a" * 64,
    "WALLHOP_EGRESS_IMAGE": "haproxy@sha256:" + "b" * 64,
    "WALLHOP_MINIFLUX_PUBLIC_HOST": "miniflux.example.test",
    "WALLHOP_MINIFLUX_PUBLIC_URL": "https://miniflux.example.test",
    "WALLHOP_MINIFLUX_API_TOKEN": "synthetic-miniflux-only",
    "WALLHOP_RECOVERY_API_TOKEN": "synthetic-service-only-0123456789",
    "WALLHOP_HAPROXY_CONFIG": "/tmp/haproxy-synthetic.cfg",
}
with tempfile.TemporaryDirectory() as directory:
    override = Path(directory) / "g4-override.yaml"
    override.write_text(render_override(CANDIDATE_READER, CANDIDATE_EGRESS))
    run = subprocess.run(
        ["docker", "compose", "-f", str(ROOT / "deploy/wallhop-isolated/compose.yaml"),
         "-f", str(override), "config", "--format", "json"],
        env=env, capture_output=True, text=True, check=True, timeout=25,
    )
config = json.loads(run.stdout)
nets = config["networks"]
assert nets["reader_internal"]["ipam"]["config"][0]["subnet"] == CANDIDATE_READER
assert nets["egress_internal"]["ipam"]["config"][0]["subnet"] == CANDIDATE_EGRESS
relay = config["services"]["wallhop-egress"]["environment"]
assert relay["WALLHOP_UPSTREAM"] == "127.0.0.1:9"
assert relay["MINIFLUX_UPSTREAM"] == "127.0.0.1:9"
print("G4_COMPOSE_EXPLICIT_IPAM=PASS")
print("G4_EXTERNAL_BACKENDS=BLACKHOLED")
print("G4_PRODUCTION_MUTATIONS=NONE")
