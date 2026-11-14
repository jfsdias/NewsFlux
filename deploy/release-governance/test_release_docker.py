"""Real Docker Compose rehearsal of release.py in a disposable project.

Runs only when RELEASE_DOCKER_TESTS=1 and a Docker daemon is reachable. Every
resource is named nfrel-<random> and removed afterwards. No production host,
article, credential or external provider is involved.
"""
from __future__ import annotations

import fcntl
import json
import os
import secrets
import subprocess
import tempfile
import unittest
from pathlib import Path

import release

BASE_IMAGE = "busybox:1.36.1"


def docker(*args: str) -> str:
    return subprocess.run(["docker", *args], check=True, capture_output=True, text=True, timeout=300).stdout.strip()


def build_image(directory: Path, tag: str, revision: str, healthy: bool | None, *, ready_file: bool = True) -> str:
    dockerfile = directory / f"Dockerfile.{tag.split(':')[0].rsplit('-', 1)[-1]}"
    health = (
        ""
        if healthy is None
        else f"HEALTHCHECK --interval=1s --timeout=2s --retries=2 --start-period=1s CMD {'true' if healthy else 'false'}\n"
    )
    command = "touch /tmp/ready; sleep 3600" if ready_file else "sleep 3600"
    dockerfile.write_text(
        f"FROM {BASE_IMAGE}\n"
        f"LABEL org.opencontainers.image.revision={revision}\n"
        f"{health}"
        f'CMD ["sh", "-c", "{command}"]\n',
        encoding="utf-8",
    )
    docker("build", "-q", "-f", str(dockerfile), "-t", tag, str(directory))
    return docker("image", "inspect", "--format", "{{.Id}}", tag)


@unittest.skipUnless(os.environ.get("RELEASE_DOCKER_TESTS") == "1", "set RELEASE_DOCKER_TESTS=1 to run the Docker rehearsal")
class DockerReleaseRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.run_id = f"nfrel-{secrets.token_hex(4)}"
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        cls.sha_previous = "a" * 40
        cls.sha_candidate = "b" * 40
        cls.sha_broken = "c" * 40
        cls.previous = build_image(cls.dir, f"{cls.run_id}-previous:test", cls.sha_previous, True)
        cls.candidate = build_image(cls.dir, f"{cls.run_id}-candidate:test", cls.sha_candidate, True)
        cls.broken = build_image(cls.dir, f"{cls.run_id}-broken:test", cls.sha_broken, False)
        cls.other = build_image(cls.dir, f"{cls.run_id}-other:test", "d" * 40, True)
        # Reader-like images: no Docker healthcheck, readiness only provable by a probe.
        cls.web_previous = build_image(cls.dir, f"{cls.run_id}-webprev:test", cls.sha_previous, None)
        cls.web_candidate = build_image(cls.dir, f"{cls.run_id}-webcand:test", cls.sha_candidate, None)
        cls.web_unready = build_image(cls.dir, f"{cls.run_id}-webbad:test", cls.sha_broken, None, ready_file=False)

    @classmethod
    def tearDownClass(cls) -> None:
        for tag in ("previous", "candidate", "broken", "other", "webprev", "webcand", "webbad"):
            subprocess.run(["docker", "image", "rm", "-f", f"{cls.run_id}-{tag}:test"], capture_output=True)
        cls.tmp.cleanup()

    def setUp(self) -> None:
        self.project = f"{self.run_id}-{secrets.token_hex(2)}"
        work = self.dir / self.project
        work.mkdir()
        self.base = work / "compose.yaml"
        self.overlay = work / "compose.override-layer.yaml"
        # Two ordered layers, a protected peer and a protected "miniflux" service on an internal network.
        self.base.write_text(
            json.dumps(
                {
                    "services": {
                        "summary-api": {"image": f"{self.run_id}-previous:test", "networks": ["private"], "volumes": ["ledger:/data"]},
                        "web": {"image": self.web_previous, "networks": ["private"]},
                        "reader": {"image": self.previous, "networks": ["private"]},
                        "miniflux": {"image": self.previous, "networks": ["private"]},
                    },
                    "networks": {"private": {"internal": True}},
                    "volumes": {"ledger": {}},
                }
            ),
            encoding="utf-8",
        )
        self.overlay.write_text(json.dumps({"services": {"summary-api": {"environment": {"LAYER": "2"}}}}), encoding="utf-8")
        self.compose = ["compose", "-p", self.project, "--project-directory", str(work), "-f", str(self.base), "-f", str(self.overlay)]
        docker(*self.compose, "up", "-d", "--wait")
        self.release_dir = work / "release"
        self.lock = str(work / "release.lock")
        self.policy = {(self.project, "summary-api"), (self.project, "web")}
        self.client = release.Docker()
        self.protected = [f"{self.project}-reader-1", f"{self.project}-miniflux-1"]
        self.protected_before = {name: self.client.container_by_name(name).protected_fingerprint() for name in self.protected}
        self.summary_before = self.current()

    def tearDown(self) -> None:
        subprocess.run(["docker", *self.compose, "down", "-v", "--remove-orphans"], capture_output=True, timeout=300)

    def plan(self, image: str, sha: str) -> dict:
        return release.build_manifest(
            self.client, project=self.project, service="summary-api", candidate_image=image,
            approved_sha=sha, protected=self.protected, policy=self.policy, release_dir=self.release_dir,
        )

    def current(self) -> release.ContainerIdentity:
        return self.client.service_container(self.project, "summary-api")

    def assert_protected_unchanged(self) -> None:
        after = {name: self.client.container_by_name(name).protected_fingerprint() for name in self.protected}
        self.assertEqual(after, self.protected_before)

    def test_exact_image_promotion_and_idempotent_rollback(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        self.assertEqual([item["path"] for item in manifest["compose_files"]], [str(self.base), str(self.overlay)])
        self.assertEqual(release.promote(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertEqual(self.current().image_id, self.candidate)
        self.assertEqual(self.current().health, "healthy")
        self.assertEqual(release.promote(self.client, manifest, self.policy, lock=self.lock), "ALREADY_APPLIED")
        self.assert_protected_unchanged()
        self.assertEqual(release.rollback(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertEqual(self.current().image_id, self.previous)
        self.assertEqual(release.rollback(self.client, manifest, self.policy, lock=self.lock), "ALREADY_APPLIED")
        self.assert_protected_unchanged()
        journal = (self.release_dir / "journal.jsonl").read_text(encoding="utf-8")
        self.assertIn("promote_completed", journal)
        self.assertIn("rollback_completed", journal)

    def test_forced_health_failure_restores_previous_image(self) -> None:
        manifest = self.plan(self.broken, self.sha_broken)
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest, self.policy, lock=self.lock, timeout=30)
        self.assertEqual(raised.exception.code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertEqual(self.current().image_id, self.previous)
        self.assertTrue(self.current().running)
        self.assert_protected_unchanged()

    def test_configuration_drift_blocks_without_change(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        self.overlay.write_text(json.dumps({"services": {"summary-api": {"environment": {"LAYER": "changed"}}}}), encoding="utf-8")
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "CONFIGURATION_DRIFT")
        self.assertEqual(self.current().image_id, self.previous)

    def test_concurrent_release_is_blocked(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        Path(self.lock).parent.mkdir(parents=True, exist_ok=True)
        with open(self.lock, "a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            with self.assertRaises(release.GateError) as raised:
                release.promote(self.client, manifest, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "CONCURRENT_RELEASE_BLOCKED")
        self.assertEqual(self.current().image_id, self.previous)

    def test_rollback_refused_when_live_state_no_longer_matches(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        release.promote(self.client, manifest, self.policy, lock=self.lock)
        # Someone else deploys a third image outside this release.
        override = self.release_dir / "foreign.json"
        override.write_text(json.dumps({"services": {"summary-api": {"image": self.other}}}), encoding="utf-8")
        docker(*self.compose, "-f", str(override), "up", "-d", "--no-deps", "--wait", "summary-api")
        with self.assertRaises(release.GateError) as raised:
            release.rollback(self.client, manifest, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "LIVE_STATE_DOES_NOT_MATCH_RELEASE")
        self.assertEqual(self.current().image_id, self.other)

    def test_protected_drift_blocks_promotion(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        docker(*self.compose, "up", "-d", "--force-recreate", "--no-deps", "--wait", "reader")
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "PROTECTED_SERVICE_DRIFT")
        self.assertEqual(self.current().image_id, self.previous)

    def test_plan_rejects_revision_mismatch_unauthorized_and_tampering(self) -> None:
        with self.assertRaises(release.GateError) as raised:
            self.plan(self.candidate, self.sha_broken)
        self.assertEqual(raised.exception.code, "CANDIDATE_REVISION_MISMATCH")
        with self.assertRaises(release.GateError) as raised:
            release.build_manifest(
                self.client, project=self.project, service="reader", candidate_image=self.candidate,
                approved_sha=self.sha_candidate, protected=self.protected, policy=self.policy, release_dir=self.release_dir,
            )
        self.assertEqual(raised.exception.code, "SERVICE_NOT_AUTHORIZED")
        with self.assertRaises(release.GateError):
            self.plan(f"{self.run_id}-candidate:test", self.sha_candidate)
        manifest = self.plan(self.candidate, self.sha_candidate)
        manifest["candidate_image"] = self.other
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "MANIFEST_TAMPERED")
        self.assertEqual(self.current().image_id, self.previous)

    PROBE = ["test", "-f", "/tmp/ready"]

    def web(self) -> release.ContainerIdentity:
        return self.client.service_container(self.project, "web")

    def plan_web(self, image: str, sha: str, probe=None) -> dict:
        return release.build_manifest(
            self.client, project=self.project, service="web", candidate_image=image, approved_sha=sha,
            protected=self.protected + [f"{self.project}-summary-api-1"], policy=self.policy,
            release_dir=self.release_dir / "web", ready_probe=probe,
        )

    def test_rollback_restores_exact_base_configuration_hash(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        self.assertTrue(manifest["base_resolves_to_previous"])
        release.promote(self.client, manifest, self.policy, lock=self.lock)
        self.assertNotEqual(self.current().config_hash, self.summary_before.config_hash)
        release.rollback(self.client, manifest, self.policy, lock=self.lock)
        after = self.current()
        self.assertEqual(after.image_id, self.previous)
        self.assertEqual(list(after.config_files), [str(self.base), str(self.overlay)])
        self.assertEqual(after.config_hash, self.summary_before.config_hash)

    def test_moved_base_tag_never_brings_up_another_image_on_rollback(self) -> None:
        manifest = self.plan(self.candidate, self.sha_candidate)
        release.promote(self.client, manifest, self.policy, lock=self.lock)
        docker("tag", f"{self.run_id}-other:test", f"{self.run_id}-previous:test")
        try:
            self.assertEqual(release.rollback(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
            self.assertEqual(self.current().image_id, self.previous)
            self.assertEqual(self.current().config_files[-1], str(self.release_dir / "rollback.override.json"))
        finally:
            docker("tag", self.previous, f"{self.run_id}-previous:test")

    def test_service_without_healthcheck_requires_a_readiness_probe(self) -> None:
        with self.assertRaises(release.GateError) as raised:
            self.plan_web(self.web_candidate, self.sha_candidate)
        self.assertEqual(raised.exception.code, "READINESS_UNDEFINED")
        manifest = self.plan_web(self.web_candidate, self.sha_candidate, probe=self.PROBE)
        self.assertEqual(release.promote(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertEqual(self.web().image_id, self.web_candidate)
        self.assert_protected_unchanged()

    def test_unready_candidate_without_healthcheck_is_rolled_back(self) -> None:
        manifest = self.plan_web(self.web_unready, self.sha_broken, probe=self.PROBE)
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest, self.policy, lock=self.lock, timeout=15)
        self.assertEqual(raised.exception.code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertEqual(self.web().image_id, self.web_previous)

    def test_configuration_only_override_applies_and_rolls_back_exactly(self) -> None:
        policy = self.release_dir.parent / "policy.override.json"
        policy.write_text(json.dumps({"services": {"summary-api": {"environment": {"FEATURE_ENABLED": "true"}}}}), encoding="utf-8")
        manifest = release.build_manifest(
            self.client, project=self.project, service="summary-api", candidate_image=self.previous,
            approved_sha=self.sha_previous, protected=self.protected, policy=self.policy,
            release_dir=self.release_dir, extra_overrides=[str(policy)],
        )
        self.assertEqual(release.promote(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        env = docker("inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", self.current().container_id)
        self.assertIn("FEATURE_ENABLED=true", env)
        self.assertEqual(release.rollback(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertEqual(self.current().config_hash, self.summary_before.config_hash)
        env = docker("inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", self.current().container_id)
        self.assertNotIn("FEATURE_ENABLED", env)
        # The approved override file itself is hash-pinned.
        manifest2 = release.build_manifest(
            self.client, project=self.project, service="summary-api", candidate_image=self.previous,
            approved_sha=self.sha_previous, protected=self.protected, policy=self.policy,
            release_dir=self.release_dir / "second", extra_overrides=[str(policy)],
        )
        policy.write_text(json.dumps({"services": {"summary-api": {"environment": {"FEATURE_ENABLED": "evil"}}}}), encoding="utf-8")
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, manifest2, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "CONFIGURATION_DRIFT")
    def test_override_may_add_a_declared_network_and_rollback_removes_it(self) -> None:
        network = f"{self.project}-wallhop"
        docker("network", "create", "--internal", network)
        self.addCleanup(subprocess.run, ["docker", "network", "rm", network], capture_output=True)
        overlay = self.release_dir.parent / "network.override.json"
        overlay.write_text(
            json.dumps(
                {
                    "services": {"summary-api": {"networks": {"wallhop": {}}}},
                    "networks": {"wallhop": {"external": True, "name": network}},
                }
            ),
            encoding="utf-8",
        )
        undeclared = release.build_manifest(
            self.client, project=self.project, service="summary-api", candidate_image=self.previous,
            approved_sha=self.sha_previous, protected=self.protected, policy=self.policy,
            release_dir=self.release_dir / "undeclared", extra_overrides=[str(overlay)],
        )
        with self.assertRaises(release.GateError) as raised:
            release.promote(self.client, undeclared, self.policy, lock=self.lock)
        self.assertEqual(raised.exception.code, "PROMOTION_FAILED_ROLLED_BACK:NETWORK_DRIFT")
        manifest = release.build_manifest(
            self.client, project=self.project, service="summary-api", candidate_image=self.previous,
            approved_sha=self.sha_previous, protected=self.protected, policy=self.policy,
            release_dir=self.release_dir / "declared", extra_overrides=[str(overlay)], networks_added=[network],
        )
        self.assertEqual(release.promote(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertIn(network, self.current().networks)
        self.assertEqual(release.rollback(self.client, manifest, self.policy, lock=self.lock), "APPLIED")
        self.assertNotIn(network, self.current().networks)
        self.assertEqual(self.current().config_hash, self.summary_before.config_hash)

class PolicyTests(unittest.TestCase):
    def test_policy_rejects_forbidden_services(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            for project, service in (("miniflux", "miniflux"), ("newsflux", "miniflux-db"), ("npm-proxyyml", "app")):
                path.write_text(json.dumps({"version": "newsflux-release-policy-v1", "allowed": [{"project": project, "service": service}]}))
                with self.assertRaises(release.GateError):
                    release.load_policy(path)

    def test_repository_policy_is_closed_and_loads(self) -> None:
        allowed = release.load_policy(release.DEFAULT_POLICY)
        self.assertIn(("newsflux", "summary-api"), allowed)
        self.assertTrue(all(service not in release.ALWAYS_FORBIDDEN_SERVICES for _, service in allowed))


if __name__ == "__main__":
    unittest.main()
