"""G5 reusable DARK-only isolated deploy: operator admission and safety contract.

Offline-only. These tests never contact Docker, OMV or external providers.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest

DIR = Path(__file__).resolve().parent
SCRIPT = DIR / "g5-dark-deploy.sh"
SHA = "a" * 40
FP = "b" * 16
NPM_SHA = "c" * 64
IMAGE_ID = "sha256:" + "d" * 64


def run(*args: str, extra: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("NEWSFLUX_G5_ACK", None)
    if extra:
        env.update(extra)
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True,
                          timeout=10, env=env, check=False)


def params() -> tuple[str, ...]:
    return ("--source-sha", SHA, "--expected-protected-fingerprint", FP,
            "--expected-npm111-sha", NPM_SHA, "--egress-image-id", IMAGE_ID)


class G5DarkDeployAdmissionTests(unittest.TestCase):
    def test_script_exists_and_bash_syntax(self):
        self.assertTrue(SCRIPT.exists())
        self.assertEqual(subprocess.run(["bash", "-n", str(SCRIPT)],
                                        check=False).returncode, 0)

    def test_default_is_safe_noop(self):
        p = run()
        self.assertEqual(p.returncode, 0)
        self.assertIn("G5_MODE=SAFE_NOOP", p.stdout)

    def test_help_is_non_mutating(self):
        p = run("--help")
        self.assertEqual(p.returncode, 0)
        self.assertIn("G5_MODE=HELP", p.stdout)

    def test_unknown_mode_refused(self):
        p = run("--enable-production", *params())
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED", p.stdout)

    def test_partial_identity_refused(self):
        p = run("--check-only", "--source-sha", SHA)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED", p.stdout)

    def test_malformed_source_sha_refused_before_docker(self):
        p = run("--check-only", "--source-sha", "main", *params()[2:])
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED CODE=INVALID_EXACT_IDENTITIES", p.stdout)

    def test_malformed_image_id_refused_before_docker(self):
        p = run("--check-only", *params()[:-1], "haproxy:latest")
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED CODE=INVALID_EXACT_IDENTITIES", p.stdout)

    def test_execute_without_ack_refused_before_docker(self):
        p = run("--execute", *params())
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED", p.stdout)

    def test_execute_with_wrong_ack_refused(self):
        p = run("--execute", *params(), extra={"NEWSFLUX_G5_ACK": "GO"})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED", p.stdout)

    def test_ci_cannot_execute_with_ack(self):
        p = run("--execute", *params(),
                extra={"NEWSFLUX_G5_ACK": "ISOLATED_DARK_DEPLOY_ONLY", "GITHUB_ACTIONS": "true"})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("G5_ADMISSION=BLOCKED CODE=OMV_ROOT_ONLY", p.stdout)

    def test_authorization_is_dark_only_and_canary_is_not_reused(self):
        s = SCRIPT.read_text()
        self.assertNotIn("bash g4-dark-canary.sh", s)
        self.assertNotIn("docker network disconnect", s)
        self.assertNotIn("docker stop npm", s)
        self.assertNotIn("docker rm -f newsflux-pr188", s)
        self.assertIn("CONTENT_FALLBACK_READER_ENABLED", s)
        self.assertIn("CONTENT_FALLBACK_POLICIES_JSON", s)
        self.assertIn("127.0.0.1:9", s)
        self.assertIn("miniflux.example.test", s)
        self.assertIn("G5_EXTERNAL_ARTICLE_REQUESTS=DISABLED_BY_CONFIG", s)

    def test_pinned_commit_and_protected_fingerprint_are_checked_before_start(self):
        s = SCRIPT.read_text()
        self.assertIn('REMOTE_MAIN" != "$SOURCE_SHA"', s)
        self.assertIn('BASE_FP" != "$EXPECTED_FP"', s)
        self.assertIn('BASE_NPM111_SHA" != "$EXPECTED_NPM111_SHA"', s)
        self.assertLess(s.index("G5_EXACT_SOURCE=PASS"), s.index("docker compose -f \"$COMPOSE\" -f \"$OVERRIDE\" up"))
        self.assertIn("G5_IPAM_GATE=PASS", s)
        self.assertIn("RELAY_IMAGE_NOT_APPROVED_HAPROXY", s)
        self.assertIn("G5_WRAPPER_SOURCE_IDENTITY=PASS", s)
        self.assertIn("WRAPPER_BYTES_DRIFT", s)
        self.assertIn("haproxy:3.0.5-alpine", s)

    def test_failed_start_rolls_back_only_new_project(self):
        s = SCRIPT.read_text()
        self.assertIn("trap 'cleanup $?' EXIT", s)
        self.assertIn('docker compose -f "$COMPOSE" -f "$OVERRIDE" down', s)
        self.assertIn("candidate_absent", s)
        self.assertIn("G5_ROLLBACK=PASS", s)
        self.assertIn("G5_ROLLBACK=FAIL", s)

    def test_success_is_staged_dark_not_external_production(self):
        s = SCRIPT.read_text()
        self.assertIn("G5_DARK_DEPLOY=PASS", s)
        self.assertIn("G5_READER_BRIDGE=DISABLED", s)
        self.assertIn("G5_PROVIDER_CONTRACT=HOLD", s)
        self.assertIn("G5_PRODUCT_ACTIVATION=NOT_AUTHORIZED", s)
        self.assertIn("G5_PERSISTENCE=EPHEMERAL_TMPFS", s)
        self.assertIn("G5_RUNTIME_TMPFS=PASS", s)
        self.assertIn("RUNTIME_TMPFS_NOT_EFFECTIVE", s)


if __name__ == "__main__":
    unittest.main()
