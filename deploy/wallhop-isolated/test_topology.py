"""Deterministic negative tests for isolated WallHop Compose invariants."""

from __future__ import annotations

import copy
import unittest

from topology_guard import TopologyError, validate


def valid():
    return {
        "name": "newsflux-wallhop-isolated",
        "services": {
            "wallhop-recovery": {
                "container_name": "newsflux-wallhop-recovery",
                "image": "sha256:" + "a" * 64,
                "read_only": True,
                "user": "10001:10001",
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "tmpfs": ["/data:rw,noexec,nosuid,size=32m"],
                "networks": {"reader_internal": {}, "egress_internal": {}},
                "restart": "no",
                "environment": {
                    "CONTENT_FALLBACK_POLICIES_JSON": '{"enabled":false}',
                    "CONTENT_FALLBACK_READER_ENABLED": "false",
                    "CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY": "true",
                    "CONTENT_FALLBACK_EGRESS_RELAY": "wallhop-egress",
                    "MINIFLUX_BASE_URL": "https://miniflux.example.test",
                    "CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS": "wallhop.io,miniflux.example.test",
                    "MINIFLUX_API_TOKEN": "synthetic",
                    "CONTENT_FALLBACK_API_TOKEN": "synthetic-only-" + "x" * 32,
                },
            },
            "wallhop-egress": {
                "container_name": "newsflux-wallhop-egress",
                "image": "haproxy@sha256:" + "b" * 64,
                "read_only": True,
                "user": "99:99",
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "networks": {"egress_internal": {}, "npm_proxy": {}},
                "restart": "no",
                "volumes": [
                    {"target": "/usr/local/etc/haproxy/haproxy.cfg", "read_only": True},
                ],
            },
        },
        "networks": {
            "reader_internal": {"internal": True},
            "egress_internal": {"internal": True},
            "npm_proxy": {"external": True, "name": "npm-proxyyml_default"},
        },
    }


class WallHopTopologyTests(unittest.TestCase):
    def test_dark_independent_topology_accepted(self):
        validate(valid())

    def test_old_pr188_name_is_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["container_name"] = "newsflux-pr188-content-fallback"
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_direct_npm_network_for_sidecar_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["networks"]["npm_proxy"] = {}
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_shared_rw_volume_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["volumes"] = [{"source": "legacy-data", "target": "/data"}]
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_public_sidecar_port_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["ports"] = [{"published": "8790", "target": 8790}]
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_policy_accidentally_enabled_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["environment"]["CONTENT_FALLBACK_POLICIES_JSON"] = '{"enabled":true}'
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_reader_bridge_enabled_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["environment"]["CONTENT_FALLBACK_READER_ENABLED"] = "true"
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_unpinned_image_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["image"] = "newsflux-wallhop:latest"
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_unrestricted_external_sidecar_rejected(self):
        doc = valid()
        doc["networks"]["egress_internal"]["internal"] = False
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_implicit_paid_external_call_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["environment"]["CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS"] += ",others.example.test"
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_privileged_sidecar_rejected(self):
        doc = valid()
        doc["services"]["wallhop-recovery"]["privileged"] = True
        with self.assertRaises(TopologyError):
            validate(doc)

    def test_protected_service_added_rejected(self):
        doc = valid()
        doc["services"]["miniflux"] = {"image": "example"}
        with self.assertRaises(TopologyError):
            validate(doc)


if __name__ == "__main__":
    unittest.main()
