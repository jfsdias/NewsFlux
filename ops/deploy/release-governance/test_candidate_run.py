"""candidate-run: the one-off container must not inherit the running service's fixed addresses.

On the OMV, summary-api has a fixed ipv4_address on each of its networks; `docker compose run` with the target
configuration asked the daemon for the same addresses and was refused ("Address already in use"), so the D1
preflight produced no output (TARGET_CONFIGURATION_NOT_PASS). candidate-run now adds a run-only override that
`!reset`s ipv4_address, ipv6_address and mac_address on every network of the service. That file is outside the
manifest, its hashes and promote/rollback, and is removed in a `finally`.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import release


class FakeDocker:
    def __init__(self, networks=("gateway", "summary_private", "frontend"), fail=None):
        self.networks = list(networks)
        self.fail = fail
        self.calls = []
        self.override_text = None
        self.identity = SimpleNamespace(container_id="c" * 64, config_hash="h1")

    def service_container(self, project, service):
        return self.identity

    def service_network_keys(self, identity, files, service):
        self.calls.append(("config", list(files)))
        return sorted(self.networks)

    def compose_run(self, identity, files, service, argv):
        self.calls.append(("run", list(files), service, list(argv)))
        override = Path(files[-1])
        self.override_text = override.read_text(encoding="utf-8")
        self.override_mode = override.stat().st_mode & 0o777
        if self.fail:
            raise self.fail
        return 0, "D1_PREFLIGHT=PASS\nnot a gate line\n"


class CandidateRunOverrideTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.manifest = {"project": "newsflux", "service": "summary-api", "release_dir": self.tmp.name,
                         "candidate_image": "sha256:" + "a" * 64}
        self.candidate_files = ["/srv/compose.yaml", "/srv/compose.ai.yaml", f"{self.tmp.name}/candidate.override.json"]
        for name, value in (("verify_manifest", None), ("_check_configuration", None), ("_check_protected", None),
                            ("_write_override", None)):
            patcher = mock.patch.object(release, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for name, value in (("_state", "PREVIOUS"), ("_candidate_files", self.candidate_files)):
            patcher = mock.patch.object(release, name, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        lock = mock.patch.object(release, "release_lock", mock.MagicMock())
        lock.start()
        self.addCleanup(lock.stop)

    def leftovers(self):
        return [p for p in os.listdir(self.tmp.name) if p.startswith("candidate-run.")]

    def test_run_only_override_resets_static_addresses_on_every_network(self):
        docker = FakeDocker()
        code, lines = release.candidate_run(docker, self.manifest, set(), ["python", "-m", "x"], lock="/tmp/l")
        self.assertEqual((code, lines), (0, ["D1_PREFLIGHT=PASS"]))
        run = [c for c in docker.calls if c[0] == "run"][0]
        self.assertEqual(run[1][:3], self.candidate_files)            # target configuration, unchanged order
        self.assertEqual(len(run[1]), 4)                               # plus exactly one run-only override, last
        self.assertTrue(run[1][3].endswith(".override.yaml"))
        expected = ['services:', '  "summary-api":', '    networks:']
        for key in ("frontend", "gateway", "summary_private"):
            expected += [f'      "{key}":', '        ipv4_address: !reset null', '        ipv6_address: !reset null',
                         '        mac_address: !reset null']
        self.assertEqual(docker.override_text, "\n".join(expected) + "\n")
        self.assertEqual(docker.override_mode, 0o600)
        self.assertEqual(self.leftovers(), [])                         # removed after the run

    def test_override_is_removed_even_when_the_run_fails(self):
        docker = FakeDocker(fail=release.GateError("BOOM"))
        with self.assertRaises(release.GateError):
            release.candidate_run(docker, self.manifest, set(), ["true"], lock="/tmp/l")
        self.assertIsNotNone(docker.override_text)
        self.assertEqual(self.leftovers(), [])

    def test_override_never_enters_the_manifest_or_its_hashes(self):
        before = json.dumps(self.manifest, sort_keys=True)
        release.candidate_run(FakeDocker(), self.manifest, set(), ["true"], lock="/tmp/l")
        self.assertEqual(json.dumps(self.manifest, sort_keys=True), before)
        self.assertNotIn("candidate-run", json.dumps(self.manifest))

    def test_service_without_networks_gets_a_service_only_override(self):
        self.assertEqual(release._run_override_document("summary-api", []), 'services:\n  "summary-api":\n')

    def test_document_is_valid_compose_reset_syntax(self):
        text = release._run_override_document("summary-api", ["a b", 'q"x'])
        self.assertIn('      "a b":', text)
        self.assertIn('      "q\\"x":', text)
        self.assertEqual(text.count("!reset null"), 6)


class CandidateMountsTests(unittest.TestCase):
    def test_added_bind_replaces_a_mount_with_the_same_destination(self):
        """OMV: a D1 release over an earlier D1 release (old evidence bind at the same target) was VOLUME_DRIFT."""
        current = [["bind", "/old/evidence.json", "/run/newsflux-d1/evidence.json", False], ["volume", "ledger", "/data", True]]
        added = [["bind", "/new/evidence.json", "/run/newsflux-d1/evidence.json", False]]
        self.assertEqual(release.candidate_mounts(current, added),
                         [["bind", "/new/evidence.json", "/run/newsflux-d1/evidence.json", False], ["volume", "ledger", "/data", True]])

    def test_new_destination_is_added(self):
        current = [["volume", "ledger", "/data", True]]
        added = [["bind", "/e.json", "/run/newsflux-d1/evidence.json", False]]
        self.assertEqual(release.candidate_mounts(current, added), sorted(current + added))


class NetworkKeysTests(unittest.TestCase):
    def test_mapping_list_and_unreadable(self):
        identity = SimpleNamespace(project="p", working_dir="/w", env_files=())
        cases = {json.dumps({"services": {"s": {"networks": {"b": {"ipv4_address": "10.0.0.2"}, "a": None}}}}): ["a", "b"],
                 json.dumps({"services": {"s": {"networks": ["y", "x"]}}}): ["x", "y"],
                 json.dumps({"services": {"s": {}}}): []}
        for output, expected in cases.items():
            docker = release.Docker(runner=lambda _args, out=output: out)
            self.assertEqual(docker.service_network_keys(identity, ["f.yaml"], "s"), expected)
        docker = release.Docker(runner=lambda _args: "not json")
        with self.assertRaises(release.GateError) as raised:
            docker.service_network_keys(identity, ["f.yaml"], "s")
        self.assertEqual(raised.exception.code, "CANDIDATE_RUN_CONFIG_UNREADABLE")


if __name__ == "__main__":
    unittest.main()
