"""R12F-09 safety gate: forensic capture and journaling must never prevent the automatic rollback.

Unit level (no Docker): the promotion transition fails, then ENOSPC on failure-*.json, a failing
`docker logs`, and failing journal writes are injected. The rollback must still be attempted, the
operator must see only safe codes, and a real rollback failure must be reported distinctly.
The Docker-level proof with seven Compose files is in rehearse-r12f09.sh.
"""
from __future__ import annotations

import contextlib
import errno
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import release

CANDIDATE = "sha256:" + "c" * 64
PREVIOUS = "sha256:" + "a" * 64
RAW_LOG_MARKER = "PermissionError: [Errno 13] token=super-secret-value"


def enospc(*_args, **_kwargs):
    raise OSError(errno.ENOSPC, "No space left on device")


class FakeDocker:
    def __init__(self, release_dir: str) -> None:
        self.release_dir = release_dir

    def service_container(self, project, service):
        return release.ContainerIdentity(
            container_id="cand", name="newsflux-summary-api-1", project=project, service=service,
            image_id=CANDIDATE, config_hash="x", config_files=("/c/1.yaml",), working_dir="/c",
            env_files=(), networks=("n",), mounts=(), published_ports=0, health="unhealthy", running=False,
        )

    def run(self, args):
        if args[:1] == ["inspect"]:
            return '[{"State": {"Status": "exited", "ExitCode": 1, "OOMKilled": false}, "RestartCount": 0}]'
        return ""


class FailureIOTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.manifest = {
            "project": "newsflux", "service": "summary-api", "candidate_image": CANDIDATE,
            "previous_image": PREVIOUS, "release_dir": self.tmp.name, "manifest_sha256": "m",
            "compose_files": [{"path": "/c/1.yaml"}], "base_resolves_to_previous": True,
        }
        self.docker = FakeDocker(self.tmp.name)
        self.applied: list[str] = []
        patches = [
            mock.patch.object(release, "verify_manifest", lambda *_a: None),
            mock.patch.object(release, "_transition", side_effect=release.GateError("READINESS_FAILED")),
            mock.patch.object(release, "_apply", side_effect=lambda _d, _m, _i, target, _t: self.applied.append(target)),
            mock.patch.object(release, "_check_protected", lambda *_a: None),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def promote(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(release.GateError) as raised:
                release.promote(self.docker, self.manifest, set(), lock=str(Path(self.tmp.name) / "lock"))
        return raised.exception.code, stderr.getvalue()

    def journal_fails_after_start(self):
        real = release._journal
        calls = {"n": 0}

        def flaky(manifest, event, **details):
            calls["n"] += 1
            if event != "promote_started":
                raise OSError(errno.ENOSPC, "No space left on device")
            return real(manifest, event, **details)

        return mock.patch.object(release, "_journal", side_effect=flaky)

    def test_enospc_on_forensic_file_still_rolls_back(self) -> None:
        with mock.patch.object(release, "_atomic_write", side_effect=enospc):
            code, stderr = self.promote()
        self.assertEqual(self.applied, ["PREVIOUS"])
        self.assertEqual(code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertIn("FORENSIC_CAPTURE=UNAVAILABLE", stderr)

    def test_docker_logs_failure_still_rolls_back_and_keeps_partial_forensics(self) -> None:
        with mock.patch.object(release.subprocess, "run", side_effect=OSError("docker logs failed")):
            code, stderr = self.promote()
        self.assertEqual(self.applied, ["PREVIOUS"])
        self.assertEqual(code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertIn("FORENSIC_CAPTURE=PARTIAL", stderr)
        self.assertEqual(len(list(Path(self.tmp.name).glob("failure-*.json"))), 1)

    def test_journal_write_failure_still_rolls_back(self) -> None:
        with self.journal_fails_after_start():
            code, stderr = self.promote()
        self.assertEqual(self.applied, ["PREVIOUS"])
        self.assertEqual(code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertIn("JOURNAL=UNAVAILABLE", stderr)

    def test_all_io_failing_at_once_still_rolls_back(self) -> None:
        with mock.patch.object(release, "_atomic_write", side_effect=enospc), mock.patch.object(
            release.subprocess, "run", side_effect=OSError("x")
        ), self.journal_fails_after_start():
            code, stderr = self.promote()
        self.assertEqual(self.applied, ["PREVIOUS"])
        self.assertEqual(code, "PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED")
        self.assertIn("FORENSIC_CAPTURE=UNAVAILABLE", stderr)
        self.assertIn("JOURNAL=UNAVAILABLE", stderr)

    def test_real_rollback_failure_is_reported_distinctly(self) -> None:
        with mock.patch.object(release, "_apply", side_effect=release.GateError("READINESS_FAILED")):
            code, _ = self.promote()
        self.assertEqual(code, "ROLLBACK_FAILED:READINESS_FAILED:AFTER:READINESS_FAILED")
        with mock.patch.object(release, "_apply", side_effect=enospc):
            code, _ = self.promote()
        self.assertEqual(code, "ROLLBACK_FAILED:IO_ERROR:AFTER:READINESS_FAILED")

    def test_raw_application_logs_never_reach_the_operator_terminal(self) -> None:
        completed = mock.Mock(stdout=RAW_LOG_MARKER + "\n", stderr="")
        with mock.patch.object(release.subprocess, "run", return_value=completed):
            _, stderr = self.promote()
        self.assertNotIn("PermissionError", stderr)
        self.assertNotIn("super-secret-value", stderr)
        stored = next(Path(self.tmp.name).glob("failure-*.json")).read_text()
        self.assertIn("PermissionError", stored)
        self.assertNotIn("super-secret-value", stored)

    def test_journal_unavailable_before_any_change_blocks_without_mutation(self) -> None:
        transition = release._transition
        with mock.patch.object(release, "_journal", side_effect=enospc):
            code, _ = self.promote()
        self.assertEqual(code, "JOURNAL_UNAVAILABLE_BEFORE_CHANGE")
        transition.assert_not_called()
        self.assertEqual(self.applied, [])


if __name__ == "__main__":
    unittest.main()


class CrashLoopForensicsTests(unittest.TestCase):
    """A restart-policy crash loop can be inspected while briefly `running` (ExitCode reset to 0).
    Forensics must wait (bounded) for the real exited/restarting state instead of recording exit 0."""

    def identity(self):
        return release.ContainerIdentity(
            container_id="cand", name="newsflux-summary-api-1", project="newsflux", service="summary-api",
            image_id=CANDIDATE, config_hash="x", config_files=("/c/1.yaml",), working_dir="/c",
            env_files=(), networks=("n",), mounts=(), published_ports=0, health="starting", running=True,
        )

    def capture(self, states):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        answers = iter(states)
        last = {"value": states[-1]}

        class Docker:
            def run(self, args):
                if args[:1] == ["inspect"]:
                    try:
                        last["value"] = next(answers)
                    except StopIteration:
                        pass
                    return last["value"]
                return ""

        with mock.patch.object(release.time, "sleep", lambda _s: None):
            return release._capture_failure(Docker(), {"release_dir": tmp.name}, self.identity(), "READINESS_FAILED")

    def test_running_crash_loop_waits_for_real_exit_code(self):
        running = '[{"State": {"Status": "running", "ExitCode": 0}, "RestartCount": 2}]'
        exited = '[{"State": {"Status": "restarting", "ExitCode": 1}, "RestartCount": 3}]'
        diagnostic = self.capture([running, running, exited])
        self.assertEqual(diagnostic["status"], "restarting")
        self.assertEqual(diagnostic["exit_code"], 1)
        self.assertTrue(diagnostic["crash_loop_observed"])

    def test_bounded_when_state_never_settles(self):
        running = '[{"State": {"Status": "running", "ExitCode": 0}, "RestartCount": 2}]'
        diagnostic = self.capture([running] * 200)
        self.assertEqual(diagnostic["status"], "running")
        self.assertTrue(diagnostic["crash_loop_observed"])
        self.assertEqual(diagnostic["forensic_capture"], "CAPTURED")

    def test_healthy_running_without_restarts_is_not_delayed(self):
        calls = []
        running = '[{"State": {"Status": "running", "ExitCode": 0}, "RestartCount": 0}]'
        with mock.patch.object(release.time, "sleep", lambda s: calls.append(s)):
            tmp = tempfile.TemporaryDirectory()
            self.addCleanup(tmp.cleanup)

            class Docker:
                def run(self, args):
                    return running if args[:1] == ["inspect"] else ""

            diagnostic = release._capture_failure(Docker(), {"release_dir": tmp.name}, self.identity(), "READINESS_FAILED")
        self.assertEqual(calls, [])
        self.assertNotIn("crash_loop_observed", diagnostic)
