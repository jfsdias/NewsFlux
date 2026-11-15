"""G5 DARK teardown admission; offline only, no Docker/OMV execution."""
from __future__ import annotations
import os
from pathlib import Path
import subprocess
import unittest

DIR = Path(__file__).resolve().parent
SCRIPT = DIR / "g5-dark-teardown.sh"
SHA = "a" * 40
FP = "b" * 16
NPM = "c" * 64
REC = "sha256:" + "d" * 64
RELAY = "sha256:" + "e" * 64


def args() -> tuple[str, ...]:
    return ("--source-sha", SHA, "--expected-protected-fingerprint", FP,
            "--expected-npm111-sha", NPM,
            "--expected-recovery-image-id", REC, "--expected-relay-image-id", RELAY)


def invoke(*options: str, extra: dict[str, str] | None = None):
    env = os.environ.copy()
    env.pop("NEWSFLUX_G5_STOP_ACK", None)
    if extra: env.update(extra)
    return subprocess.run(["bash", str(SCRIPT), *options],
                          capture_output=True, text=True, check=False, timeout=10, env=env)


class TeardownG5Tests(unittest.TestCase):
    def test_syntax(self):
        self.assertTrue(SCRIPT.is_file())
        self.assertEqual(subprocess.run(["bash", "-n", str(SCRIPT)], check=False).returncode, 0)

    def test_noop(self):
        r = invoke()
        self.assertEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_MODE=SAFE_NOOP", r.stdout)

    def test_help(self):
        r = invoke("--help")
        self.assertEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_MODE=HELP", r.stdout)

    def test_not_a_general_container_removal_tool(self):
        r = invoke("--remove-all", *args())
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_ADMISSION=BLOCKED", r.stdout)

    def test_invalid_sha_blocked(self):
        r = invoke("--check-only", "--source-sha", "main", *args()[2:])
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_ADMISSION=BLOCKED CODE=INVALID_IDENTITIES", r.stdout)

    def test_unacknowledged_stop_blocked_before_docker(self):
        r = invoke("--execute", *args())
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED", r.stdout)

    def test_ci_stop_blocked(self):
        r = invoke("--execute", *args(),
                   extra={"NEWSFLUX_G5_STOP_ACK":"STOP_ISOLATED_DARK_ONLY",
                          "GITHUB_ACTIONS":"true"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("G5_TEARDOWN_ADMISSION=BLOCKED CODE=OMV_ROOT_ONLY", r.stdout)

    def test_limited_targets_and_identity_verification(self):
        script = SCRIPT.read_text()
        self.assertIn('NEW_RECOVERY=newsflux-wallhop-recovery', script)
        self.assertIn('NEW_RELAY=newsflux-wallhop-egress', script)
        self.assertIn("docker rm -f \"$NEW_RECOVERY\" \"$NEW_RELAY\"", script)
        self.assertIn("docker network rm newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated", script)
        self.assertIn('org.opencontainers.image.revision', script)
        self.assertIn("G5_TEARDOWN_PRECHECK=PASS", script)
        self.assertIn("G5_TEARDOWN=PASS", script)
        self.assertIn("G5_TEARDOWN=PARTIAL_HOLD", script)
        self.assertNotIn("docker system prune", script)
        self.assertNotIn("docker volume rm", script)
        self.assertNotIn("docker stop npm", script)
        self.assertNotIn("docker rm -f newsflux-pr188", script)


if __name__ == "__main__":
    unittest.main()
