"""G4 operator script admission and non-mutating default regression tests.

All tests run without Docker or OMV; they must fail before the script exists.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import unittest


ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "g4-dark-canary.sh"


def invoke(*args: str, extras: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("NEWSFLUX_G4_ACK", None)
    if extras:
        env.update(extras)
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=8,
        env=env,
        check=False,
    )


class G4OperatorAdmissionTests(unittest.TestCase):
    def test_shell_syntax(self) -> None:
        self.assertTrue(SCRIPT.is_file(), "The G4 wrapper must exist")
        rc = subprocess.run(["bash", "-n", str(SCRIPT)], check=False).returncode
        self.assertEqual(rc, 0)

    def test_no_argument_cannot_launch_canary(self) -> None:
        result = invoke()
        self.assertEqual(result.returncode, 0)
        self.assertIn("G4_MODE=SAFE_NOOP", result.stdout)

    def test_help_does_not_contact_docker(self) -> None:
        result = invoke("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("G4_MODE=HELP", result.stdout)

    def test_invalid_mode_is_blocked(self) -> None:
        result = invoke("--deploy")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("G4_ADMISSION=BLOCKED", result.stdout)

    def test_execute_without_ack_is_blocked_before_docker(self) -> None:
        result = invoke("--execute")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("G4_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED", result.stdout)

    def test_execute_with_wrong_ack_is_blocked_before_docker(self) -> None:
        result = invoke("--execute", extras={"NEWSFLUX_G4_ACK": "GO"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("G4_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED", result.stdout)

    def test_canary_pass_is_emitted_only_after_successful_rollback(self) -> None:
        source = SCRIPT.read_text()
        self.assertIn("G4_ROLLBACK=PASS", source)
        self.assertIn("G4_DARK_CANARY=PASS", source)
        self.assertLess(source.index("G4_ROLLBACK=PASS"), source.index("G4_DARK_CANARY=PASS"))
        self.assertIn("if (( original == 0 )); then", source)

    def test_dark_relay_backends_are_locally_blackholed(self) -> None:
        source = SCRIPT.read_text()
        self.assertIn('WALLHOP_UPSTREAM: "127.0.0.1:9"', source)
        self.assertIn('MINIFLUX_UPSTREAM: "127.0.0.1:9"', source)
        self.assertIn("G4_EXTERNAL_BACKENDS=BLACKHOLED", source)
        self.assertIn(' -f "$OVERRIDE"', source)

    def test_ci_environment_cannot_execute(self) -> None:
        result = invoke(
            "--execute",
            extras={
                "NEWSFLUX_G4_ACK": "ISOLATED_DARK_ONLY",
                "GITHUB_ACTIONS": "true",
            },
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("G4_ADMISSION=BLOCKED CODE=OMV_ROOT_ONLY", result.stdout)

    def test_signal_handler_uses_exit_rollback(self) -> None:
        source = SCRIPT.read_text()
        self.assertIn("trap 'exit 130' INT TERM HUP", source)
        self.assertIn("trap 'cleanup $?' EXIT", source)

    def test_protected_services_must_remain_running(self) -> None:
        source = SCRIPT.read_text()
        self.assertIn("protected_running()", source)
        self.assertIn("G4_PROTECTED_SERVICES_RUNNING=PASS", source)
        self.assertIn("protected_running ||", source)

    def test_operator_script_never_manages_legacy_by_name(self) -> None:
        source = SCRIPT.read_text()
        self.assertNotIn('docker rm -f "$LEGACY"', source)
        self.assertNotIn("docker stop npm", source)
        self.assertNotIn("docker network disconnect", source)
        self.assertNotIn("deploy/wallhop-b/", source)
        self.assertIn("G4_SOURCE_SHA=f2984fcc06d858d3a68bd263371c9e7f4d8775c1", source)


if __name__ == "__main__":
    unittest.main()
