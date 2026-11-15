"""Offline tests for the fail-closed G2C read-only parser."""

import unittest

from audit import LEGACY, container_status, expanded_host_block, names_legacy, proxy_pass_targets


def sample(name, *, network=True, volume=True):
    return {
        "Name": "/" + name,
        "State": {"Running": True},
        "NetworkSettings": {"Networks": {"npm-proxyyml_default": {}} if network else {}},
        "Mounts": [{"Type": "volume", "Destination": "/data", "RW": True}] if volume else [],
    }


class Npm111AuditTests(unittest.TestCase):
    def test_only_active_proxy_pass(self):
        text = """# proxy_pass http://newsflux-pr188-content-fallback:8790;
proxy_pass http://newsflux-pr188-content-fallback:8790;
# proxy_pass http://decoy:8790;"""
        self.assertEqual(proxy_pass_targets(text), ["http://newsflux-pr188-content-fallback:8790"])

    def test_exact_host_not_alias_substring(self):
        self.assertFalse(names_legacy("http://prefix-" + LEGACY + ":8790"))
        self.assertFalse(names_legacy("http://" + LEGACY + "-decoy:8790"))
        self.assertTrue(names_legacy("http://" + LEGACY + ":8790"))

    def test_section_specificity(self):
        dump = """# configuration file /etc/nginx/nginx.conf:
proxy_pass http://unrelated;
# configuration file /data/nginx/proxy_host/111.conf:
proxy_pass http://newsflux-pr188-content-fallback:8790;
# configuration file /data/nginx/proxy_host/37.conf:
proxy_pass http://other;"""
        self.assertEqual(proxy_pass_targets(expanded_host_block(dump)),
                         ["http://newsflux-pr188-content-fallback:8790"])

    def test_duplicate_section_fails(self):
        dump = """# configuration file /data/nginx/proxy_host/111.conf:
proxy_pass http://one;
# configuration file /data/nginx/proxy_host/111.conf:
proxy_pass http://two;"""
        self.assertIsNone(expanded_host_block(dump))

    def test_other_host_is_not_111(self):
        dump = """# configuration file /data/nginx/proxy_host/37.conf:
proxy_pass http://newsflux-pr188-content-fallback;"""
        self.assertIsNone(expanded_host_block(dump))

    def test_running_network_and_volume(self):
        self.assertTrue(all(container_status([sample("npm"), sample(LEGACY)]).values()))
        self.assertFalse(container_status([sample("npm"), sample(LEGACY, network=False)])["LEGACY_NPM_NETWORK"])
        self.assertFalse(container_status([sample("npm"), sample(LEGACY, volume=False)])["LEGACY_RW_DATA_VOLUME"])

    def test_missing_container_fails(self):
        with self.assertRaises(ValueError):
            container_status([sample("npm"), sample("different")])


if __name__ == "__main__":
    unittest.main()
