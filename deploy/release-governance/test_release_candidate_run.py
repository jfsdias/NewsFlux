"""Unit tests for candidate-run's ephemeral address-reset override (no Docker daemon).

A FakeDocker records the Compose file sequence and the override bytes at run time.
The resolved Compose document stays in memory and is never written.
"""
from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path

import release

CANDIDATE = "sha256:" + "c" * 64
PREVIOUS = "sha256:" + "a" * 64
SECRET = "token=super-secret-value"
POLICY = {("newsflux", "summary-api")}

FIXED_CONFIG = {
    "services": {
        "summary-api": {
            "image": "example.invalid/summary:test",
            "environment": {"LITELLM_API_KEY": SECRET},
            "mac_address": "FIXED_MAC_SERVICE",
            "networks": {
                "internal_net": {"ipv4_address": "FIXED_V4_INTERNAL"},
                "acl_net": {
                    "ipv4_address": "FIXED_V4_ACL",
                    "ipv6_address": "FIXED_V6_ACL",
                    "link_local_ips": ["FIXED_LL_ACL"],
                    "mac_address": "FIXED_MAC_ACL",
                },
                "private_net": {"ipv4_address": "FIXED_V4_PRIVATE"},
                "plain_net": None,
            },
        }
    }
}

NO_ADDRESS_CONFIG = {
    "services": {
        "summary-api": {
            "networks": {
                "internal_net": None,
                "acl_net": {},
            }
        }
    }
}


def _identity(**overrides):
    values = dict(
        container_id="ctr-live",
        name="newsflux-summary-api-1",
        project="newsflux",
        service="summary-api",
        image_id=PREVIOUS,
        config_hash="live-hash",
        config_files=(),
        working_dir="/work",
        env_files=(),
        networks=("internal_net", "acl_net", "private_net"),
        mounts=(),
        published_ports=0,
        health="healthy",
        running=True,
    )
    values.update(overrides)
    return release.ContainerIdentity(**values)


class FakeDocker:
    def __init__(self, identity, protected, document, *, result=(0, "D1_PREFLIGHT=PASS\n", ""), error=None):
        self.identity = identity
        self.protected = protected
        self.document = document
        self.result = result
        self.error = error
        self.compose_config_files: list[str] | None = None
        self.run_files: list[str] | None = None
        self.override_at_run: str | None = None
        self.override_mode_at_run: int | None = None
        self.override_exists_after_run: bool | None = None

    def service_container(self, project, service):
        assert project == self.identity.project and service == self.identity.service
        return self.identity

    def container_by_name(self, name):
        return self.protected[name]

    def compose_config(self, identity, files):
        self.compose_config_files = list(files)
        return self.document

    def compose_run(self, identity, files, service, argv):
        self.run_files = list(files)
        override = next((Path(item) for item in files if item.endswith(release._RUN_OVERRIDE_NAME)), None)
        if override is not None:
            self.override_at_run = override.read_text(encoding="utf-8")
            self.override_mode_at_run = stat.S_IMODE(override.stat().st_mode)
        if self.error is not None:
            raise self.error
        return self.result


class CandidateRunOverrideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.work = self.root / "work"
        self.work.mkdir()
        self.release_dir = self.root / "release"
        self.release_dir.mkdir()
        self.lock = str(self.root / "lock")
        self.compose = self.work / "compose.yaml"
        self.compose.write_text("services: {}\n", encoding="utf-8")
        self.extra = self.work / "policy.override.json"
        self.extra.write_text("{}\n", encoding="utf-8")
        protected = _identity(
            container_id="ctr-protected",
            name="miniflux",
            service="miniflux",
            image_id="sha256:" + "b" * 64,
            config_hash="prot-hash",
            config_files=(str(self.compose),),
            working_dir=str(self.work),
        )
        self.protected = {"miniflux": protected}
        self.identity = _identity(
            config_files=(str(self.compose),),
            working_dir=str(self.work),
        )
        self.manifest = {
            "version": release.MANIFEST_VERSION,
            "project": "newsflux",
            "service": "summary-api",
            "candidate_image": CANDIDATE,
            "previous_image": PREVIOUS,
            "working_dir": str(self.work),
            "compose_files": [{"path": str(self.compose), "sha256": release.sha256_file(self.compose)}],
            "extra_overrides": [{"path": str(self.extra), "sha256": release.sha256_file(self.extra)}],
            "env_files": [],
            "protected": {"miniflux": protected.protected_fingerprint()},
            "release_dir": str(self.release_dir),
        }
        self.manifest["manifest_sha256"] = release._manifest_digest(self.manifest)

    def docker(self, **kwargs) -> FakeDocker:
        return FakeDocker(self.identity, self.protected, kwargs.pop("document", FIXED_CONFIG), **kwargs)

    def run_candidate(self, docker: FakeDocker, argv=("true",)) -> tuple[int, list[str]]:
        return release.candidate_run(docker, self.manifest, POLICY, argv, lock=self.lock)

    def test_run_override_yaml_resets_each_fixed_address_and_omits_secrets(self) -> None:
        yaml_text = release.run_override_yaml(FIXED_CONFIG, "summary-api")
        self.assertIsNotNone(yaml_text)
        assert yaml_text is not None
        self.assertIn("mac_address: !reset null", yaml_text)
        self.assertIn('"internal_net":', yaml_text)
        self.assertIn('"acl_net":', yaml_text)
        self.assertIn('"private_net":', yaml_text)
        self.assertIn("ipv4_address: !reset null", yaml_text)
        self.assertIn("ipv6_address: !reset null", yaml_text)
        self.assertIn("link_local_ips: !reset null", yaml_text)
        self.assertNotIn("plain_net", yaml_text)
        self.assertNotIn("FIXED_V4_", yaml_text)
        self.assertNotIn("FIXED_V6_", yaml_text)
        self.assertNotIn("FIXED_LL_", yaml_text)
        self.assertNotIn("FIXED_MAC_", yaml_text)
        self.assertNotIn(SECRET, yaml_text)
        self.assertNotIn("LITELLM_API_KEY", yaml_text)
        self.assertNotIn("environment", yaml_text)
        # Every network that had a fixed address has !reset on each present field.
        self.assertEqual(yaml_text.count("ipv4_address: !reset null"), 3)
        self.assertEqual(yaml_text.count("ipv6_address: !reset null"), 1)
        self.assertEqual(yaml_text.count("link_local_ips: !reset null"), 1)
        # Service-level mac plus the per-network mac on acl_net.
        self.assertEqual(yaml_text.count("mac_address: !reset null"), 2)

    def test_run_override_yaml_is_none_when_no_fixed_addresses(self) -> None:
        self.assertIsNone(release.run_override_yaml(NO_ADDRESS_CONFIG, "summary-api"))

    def test_candidate_run_passes_ephemeral_override_and_deletes_it(self) -> None:
        docker = self.docker()
        files_before = list(release._candidate_files(self.manifest))
        digest_before = release._manifest_digest(self.manifest)
        state_before = release._state(self.manifest, self.identity)
        code, lines = self.run_candidate(docker)
        self.assertEqual(code, 0)
        self.assertEqual(lines, ["D1_PREFLIGHT=PASS"])
        self.assertEqual(docker.compose_config_files, files_before)
        self.assertIsNotNone(docker.run_files)
        assert docker.run_files is not None
        self.assertEqual(docker.run_files[:-1], files_before)
        self.assertEqual(docker.run_files[-1], str(self.release_dir / release._RUN_OVERRIDE_NAME))
        self.assertEqual(docker.override_at_run, release.run_override_yaml(FIXED_CONFIG, "summary-api"))
        self.assertEqual(docker.override_mode_at_run, 0o644)
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())
        # Durable candidate pin is written as before; the ephemeral file is not part of it.
        self.assertTrue(Path(release._candidate_override(self.manifest)).is_file())
        self.assertEqual(release._candidate_files(self.manifest), files_before)
        self.assertNotIn(release._RUN_OVERRIDE_NAME, " ".join(release._candidate_files(self.manifest)))
        self.assertEqual(release._manifest_digest(self.manifest), digest_before)
        self.assertEqual(release._state(self.manifest, self.identity), state_before)
        self.assertEqual(state_before, "PREVIOUS")
        # Nothing from the resolved config was written under the release dir except the known pin.
        written = [path.name for path in self.release_dir.iterdir()]
        self.assertNotIn(release._RUN_OVERRIDE_NAME, written)
        self.assertNotIn(SECRET, "".join(p.read_text(encoding="utf-8") for p in self.release_dir.iterdir() if p.is_file()))

    def test_ephemeral_override_removed_when_compose_run_returns_error(self) -> None:
        stderr = f"Error response from daemon: failed to set up container networking: Address already in use {SECRET}\n"
        docker = self.docker(result=(1, "", stderr))
        code, lines = self.run_candidate(docker)
        self.assertEqual(code, 1)
        self.assertEqual(lines, ["CANDIDATE_RUN_DIAG=NETWORK_ADDRESS_IN_USE"])
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())
        self.assertIsNotNone(docker.override_at_run)
        self.assertNotIn(SECRET, "\n".join(lines))
        self.assertNotIn("Address already in use", "\n".join(lines))

    def test_ephemeral_override_removed_when_compose_run_raises(self) -> None:
        docker = self.docker(error=release.GateError("DOCKER_COMMAND_FAILED"))
        with self.assertRaises(release.GateError) as raised:
            self.run_candidate(docker)
        self.assertEqual(raised.exception.code, "DOCKER_COMMAND_FAILED")
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())
        self.assertIsNotNone(docker.override_at_run)

    def test_diag_compose_error_when_exit_nonzero_without_gate_lines(self) -> None:
        docker = self.docker(result=(1, "not a gate line\n", "compose: failed to create container\n"))
        code, lines = self.run_candidate(docker)
        self.assertEqual(code, 1)
        self.assertEqual(lines, ["CANDIDATE_RUN_DIAG=COMPOSE_ERROR"])

    def test_no_diag_when_gate_lines_already_explain_the_failure(self) -> None:
        docker = self.docker(result=(1, "D1_PREFLIGHT=FAIL\nREASON=BUDGET\n", "ignored\n"))
        code, lines = self.run_candidate(docker)
        self.assertEqual(code, 1)
        self.assertEqual(lines, ["D1_PREFLIGHT=FAIL", "REASON=BUDGET"])

    def test_no_ephemeral_file_when_no_fixed_addresses(self) -> None:
        docker = self.docker(document=NO_ADDRESS_CONFIG)
        files_before = list(release._candidate_files(self.manifest))
        code, lines = self.run_candidate(docker)
        self.assertEqual(code, 0)
        self.assertEqual(lines, ["D1_PREFLIGHT=PASS"])
        self.assertEqual(docker.run_files, files_before)
        self.assertIsNone(docker.override_at_run)
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())

    def test_existing_checks_still_block_and_still_delete_the_override(self) -> None:
        docker = self.docker()
        # After the run, the live container identity changes: the service was touched.
        real = docker.service_container
        calls = {"n": 0}

        def counting(project, service):
            calls["n"] += 1
            if calls["n"] > 1 and docker.run_files is not None:
                return _identity(
                    container_id="ctr-mutated",
                    config_files=self.identity.config_files,
                    working_dir=self.identity.working_dir,
                    image_id=self.identity.image_id,
                    config_hash=self.identity.config_hash,
                )
            return real(project, service)

        docker.service_container = counting
        with self.assertRaises(release.GateError) as raised:
            self.run_candidate(docker)
        self.assertEqual(raised.exception.code, "CANDIDATE_RUN_TOUCHED_SERVICE")
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())

    def test_requires_previous_state_before_any_run(self) -> None:
        docker = self.docker()
        docker.identity = _identity(
            image_id=CANDIDATE,
            config_files=tuple(release._candidate_files(self.manifest)),
            working_dir=str(self.work),
        )
        with self.assertRaises(release.GateError) as raised:
            self.run_candidate(docker)
        self.assertEqual(raised.exception.code, "CANDIDATE_RUN_REQUIRES_PREVIOUS_STATE")
        self.assertIsNone(docker.run_files)
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())

    def test_protected_drift_still_blocks_before_the_run(self) -> None:
        docker = self.docker()
        docker.protected = {
            "miniflux": _identity(
                container_id="ctr-other",
                name="miniflux",
                service="miniflux",
                image_id="sha256:" + "d" * 64,
                config_hash="changed",
                config_files=(str(self.compose),),
                working_dir=str(self.work),
            )
        }
        with self.assertRaises(release.GateError) as raised:
            self.run_candidate(docker)
        self.assertEqual(raised.exception.code, "PROTECTED_SERVICE_DRIFT")
        self.assertIsNone(docker.run_files)
        self.assertFalse((self.release_dir / release._RUN_OVERRIDE_NAME).exists())

    def test_promote_file_helpers_do_not_include_the_ephemeral_override(self) -> None:
        self.assertNotIn(release._RUN_OVERRIDE_NAME, release._candidate_override(self.manifest))
        self.assertNotIn(release._RUN_OVERRIDE_NAME, release._rollback_override(self.manifest))
        self.assertNotIn(release._RUN_OVERRIDE_NAME, " ".join(release._candidate_files(self.manifest)))
        self.assertNotIn(release._RUN_OVERRIDE_NAME, " ".join(release._base(self.manifest)))


if __name__ == "__main__":
    unittest.main()
