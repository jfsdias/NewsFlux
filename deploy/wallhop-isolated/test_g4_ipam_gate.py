"""Fail-closed G4 IPAM admission. All data is synthetic; never contacts OMV."""
from __future__ import annotations

import ipaddress
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from g4_ipam_gate import (  # red: module intentionally introduced after tests
    GateError,
    CANDIDATE_READER, CANDIDATE_EGRESS,
    validate_inventory,
    render_override,
    extract_vpn_prefixes,
    extract_tailscale_prefixes,
)


class G4IPAMTests(unittest.TestCase):
    def test_candidate_pairs_are_distinct_28_ipv4(self):
        self.assertEqual(str(ipaddress.ip_network(CANDIDATE_READER)), "10.240.0.96/28")
        self.assertEqual(str(ipaddress.ip_network(CANDIDATE_EGRESS)), "10.240.0.112/28")
        self.assertFalse(ipaddress.ip_network(CANDIDATE_READER).overlaps(
            ipaddress.ip_network(CANDIDATE_EGRESS)
        ))

    def test_accept_known_non_overlapping_local_and_vpn_prefixes(self):
        occupied = ["10.10.0.0/16", "172.19.0.0/16", "100.64.0.0/10", "192.168.1.0/24"]
        validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS, occupied, vpn_verified=True)

    def test_reject_overlapping_docker_prefix(self):
        with self.assertRaisesRegex(GateError, "OVERLAP"):
            validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS,
                               ["10.240.0.0/24"], vpn_verified=True)

    def test_reject_overlapping_host_route(self):
        with self.assertRaisesRegex(GateError, "OVERLAP"):
            validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS,
                               ["10.240.0.112/28"], vpn_verified=True)

    def test_reject_unverified_remote_vpn_routes(self):
        with self.assertRaisesRegex(GateError, "VPN_ROUTES_UNVERIFIED"):
            validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS,
                               ["192.168.1.0/24"], vpn_verified=False)

    def test_reject_prefixes_that_overlap_each_other(self):
        with self.assertRaisesRegex(GateError, "CANDIDATE_OVERLAP"):
            validate_inventory("10.240.0.96/28", "10.240.0.96/28", [], vpn_verified=True)

    def test_reject_wrong_size_or_unspecified_candidate(self):
        for reader in ("10.240.0.0/16", "10.240.0.100/28", "0.0.0.0/0"):
            with self.subTest(reader=reader), self.assertRaises(GateError):
                validate_inventory(reader, CANDIDATE_EGRESS, [], vpn_verified=True)

    def test_reject_invalid_occupied_cidr(self):
        with self.assertRaisesRegex(GateError, "INVALID_PREFIX"):
            validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS,
                               ["not-a-network"], vpn_verified=True)

    def test_extract_wireguard_allowed_ips(self):
        lines = "wg0\tpeerkey\t10.50.0.0/16, 192.168.8.0/24\nwg1\tpeerkey2\t100.100.1.1/32\n"
        result = extract_vpn_prefixes(lines)
        self.assertEqual(result, {"10.50.0.0/16", "192.168.8.0/24", "100.100.1.1/32"})

    def test_tailscale_advertised_remote_subnet_is_included(self):
        state = {
            "BackendState": "Running",
            "Peer": {
                "node1": {"AllowedIPs": ["100.88.1.2/32", "10.240.0.0/24"]},
            },
        }
        self.assertIn("10.240.0.0/24", extract_tailscale_prefixes(state))

    def test_tailscale_unknown_advertised_routes_fail_closed(self):
        state = {
            "BackendState": "Running",
            "Peer": {"node1": {"HostName": "synthetic"}},
        }
        with self.assertRaisesRegex(GateError, "TAILSCALE_REMOTE_ROUTES_UNVERIFIED"):
            extract_tailscale_prefixes(state)

    def test_check_only_does_not_create_overlay(self):
        import tempfile
        from unittest.mock import patch
        from g4_ipam_gate import main
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "must-not-exist.yaml"
            occupied = ["192.168.1.0/24"]
            with patch("g4_ipam_gate.discover_occupied", return_value=(occupied, {})):
                with patch.object(sys, "argv", ["g4_ipam_gate.py", "--check-only"]):
                    self.assertEqual(main(), 0)
            self.assertFalse(target.exists())

    def test_render_override_blackholes_both_upstreams(self):
        data = render_override(CANDIDATE_READER, CANDIDATE_EGRESS)
        self.assertIn('WALLHOP_UPSTREAM: "127.0.0.1:9"', data)
        self.assertIn('MINIFLUX_UPSTREAM: "127.0.0.1:9"', data)
        self.assertIn('subnet: "10.240.0.96/28"', data)
        self.assertIn('subnet: "10.240.0.112/28"', data)
        self.assertNotIn("newsflux-pr188-content-fallback", data)
        self.assertNotIn("npm-proxyyml_default", data)

    def test_reject_zero_default_routes_from_vpn(self):
        with self.assertRaisesRegex(GateError, "OVERLAP"):
            validate_inventory(CANDIDATE_READER, CANDIDATE_EGRESS,
                               ["0.0.0.0/0"], vpn_verified=True)


if __name__ == "__main__":
    unittest.main()
