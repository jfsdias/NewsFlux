"""Regression tests for the isolated Compose network/port gate."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "pilot_compose_verifier", Path(__file__).with_name("verify-compose.py")
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def valid_compose_config():
    return {
        "services": {
            "pilot-reader": {"ports": [], "networks": {"frontend": {}, "summary_private": {}}},
            "summary-api": {"ports": [], "networks": {"gateway": {}, "summary_private": {}}},
            "pilot-test-ingress": {"ports": [], "networks": {"frontend": {}, "summary_private": {}}},
            "pilot-e2e": {"ports": [], "networks": {"frontend": {}, "summary_private": {}}},
        },
        "networks": {
            "summary_private": {"internal": True},
            "gateway": {"internal": True},
        },
    }


class ComposeGateTests(unittest.TestCase):
    def test_accepts_private_compose_topology_without_host_ports(self):
        verifier.verify(valid_compose_config())

    def test_rejects_any_published_service_port(self):
        config = valid_compose_config()
        config["services"]["summary-api"]["ports"] = [{"published": "8788", "target": 8788}]
        with self.assertRaisesRegex(ValueError, "published host port"):
            verifier.verify(config)

    def test_requires_summary_api_on_internal_gateway_network(self):
        config = valid_compose_config()
        config["services"]["summary-api"]["networks"].pop("gateway")
        with self.assertRaisesRegex(ValueError, "missing required network on summary-api"):
            verifier.verify(config)

    def test_requires_internal_networks(self):
        config = valid_compose_config()
        config["networks"]["summary_private"]["internal"] = False
        with self.assertRaisesRegex(ValueError, "summary_private must be internal"):
            verifier.verify(config)


if __name__ == "__main__":
    unittest.main()
