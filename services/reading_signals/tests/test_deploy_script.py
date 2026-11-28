"""Owner-run deploy script for the reading-signals sidecar (ops/deploy/reading-signals/deploy.sh).

Runs the real script against a fake `docker` on PATH and a local git origin. No Docker daemon, network or host
path is used.
"""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "ops/deploy/reading-signals/deploy.sh"
IMAGE = "sha256:" + "ab" * 32

FAKE_DOCKER = textwrap.dedent(r'''
    #!/usr/bin/env bash
    set -u
    echo "$*" >>"$FAKE_LOG"
    case "$1" in
      network)
        [[ "$3" == "${FAKE_MISSING_NETWORK:-}" ]] && exit 1
        exit 0 ;;
      build) echo "$FAKE_IMAGE"; exit 0 ;;
      compose)
        [[ "$*" == *" up "* ]] && touch "$FAKE_RUNNING"
        [[ "$*" == *" down "* || "$*" == *" down" ]] && rm -f "$FAKE_RUNNING"
        exit 0 ;;
      inspect)
        if [[ "$*" == *"NetworkSettings.Networks"* ]]; then
          [[ -n "${FAKE_READER_IP:-}" ]] || exit 0
          printf '%s\n' "$FAKE_READER_IP"; exit 0
        fi
        [[ "$*" == *"newsflux-reading-signals"* ]] || exit 1
        [[ -f "$FAKE_RUNNING" ]] || exit 1
        if [[ "$*" == *"State.Health"* ]]; then printf '%s\n' "${FAKE_HEALTH:-healthy}"; exit 0; fi
        if [[ "$*" == *"{{.Image}}"* ]]; then printf '%s\n' "$FAKE_IMAGE"; exit 0; fi
        exit 0 ;;
    esac
    exit 1
''').lstrip()


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class DeployScriptTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        origin = root / "origin"
        compose = origin / "ops/deploy/reading-signals/compose.yaml"
        compose.parent.mkdir(parents=True)
        compose.write_text((REPO / "ops/deploy/reading-signals/compose.yaml").read_text())
        dockerfile = origin / "services/reading_signals/Dockerfile"
        dockerfile.parent.mkdir(parents=True)
        dockerfile.write_text("FROM scratch\n")
        git("init", "-q", cwd=origin)
        git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A", cwd=origin)
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "source", cwd=origin)
        self.sha = git("rev-parse", "HEAD", cwd=origin)
        bindir = root / "bin"
        bindir.mkdir()
        (bindir / "docker").write_text(FAKE_DOCKER)
        (bindir / "docker").chmod(0o755)
        self.log = root / "docker.log"
        self.state = root / "state"
        self.release = self.state / self.sha[:12]
        self.env = {
            **os.environ,
            "PATH": f"{bindir}:{os.environ['PATH']}",
            "APPROVED_SHA": self.sha,
            "NEWSFLUX_REPO_URL": str(origin),
            "READING_SIGNALS_STATE_ROOT": str(self.state),
            "READING_SIGNALS_HEALTH_TIMEOUT": "4",
            "READING_SIGNALS_READER_NETWORK": "newsflux_pilot_summary_private",
            "READING_SIGNALS_EGRESS_NETWORK": "ai_internal",
            "READING_SIGNALS_MINIFLUX_BASE_URL": "https://miniflux.example.test",
            "READING_SIGNALS_ALLOWED_WEB_ORIGINS": "https://news.example.test",
            "FAKE_LOG": str(self.log),
            "FAKE_RUNNING": str(root / "running"),
            "FAKE_IMAGE": IMAGE,
            "FAKE_READER_IP": "10.254.254.18",
        }

    def run_script(self, command, **env):
        result = subprocess.run(["bash", str(SCRIPT), command], env={**self.env, **env},
                                capture_output=True, text=True, timeout=60)
        return result.returncode, result.stdout + result.stderr

    def docker_calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_apply_builds_the_approved_commit_and_trusts_only_the_fixed_reader_ip(self):
        code, out = self.run_script("apply")
        self.assertEqual(code, 0, out)
        for line in ("PREFLIGHT=PASS", "TRUSTED_PROXY_IP=10.254.254.18", "SOURCE=PASS", "BUILD=PASS",
                     f"IMAGE={IMAGE}", "APPLY=PASS", "PREVIOUS_IMAGE=none"):
            self.assertIn(line, out)
        self.assertIn(f"ROLLBACK=sudo -E APPROVED_SHA={self.sha} bash", out)
        env_file = self.release / "reading-signals.env"
        self.assertEqual(stat.S_IMODE(env_file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.release.stat().st_mode), 0o700)
        self.assertEqual(env_file.read_text().splitlines(), [
            f"READING_SIGNALS_IMAGE={IMAGE}",
            "READING_SIGNALS_ENABLED=true",
            "READING_SIGNALS_TRUSTED_PROXY_IPS=10.254.254.18",
            "READING_SIGNALS_MINIFLUX_BASE_URL=https://miniflux.example.test",
            "READING_SIGNALS_ALLOWED_WEB_ORIGINS=https://news.example.test",
            "READING_SIGNALS_READER_NETWORK=newsflux_pilot_summary_private",
            "READING_SIGNALS_EGRESS_NETWORK=ai_internal",
        ])
        self.assertEqual(git("rev-parse", "HEAD", cwd=self.release / "source"), self.sha)
        calls = self.docker_calls()
        build = next(c for c in calls if c.startswith("build "))
        self.assertIn(f"org.opencontainers.image.revision={self.sha}", build)
        up = next(c for c in calls if c.startswith("compose ") and " up " in c)
        self.assertIn("-p newsflux-reading-signals", up)
        self.assertIn("--profile reading-signals", up)
        self.assertIn("--no-build", up)
        self.assertLess(calls.index(build), calls.index(up))
        self.assertEqual((self.state / "CURRENT").read_text().strip(), self.sha)

    def test_invalid_inputs_block_before_any_write(self):
        cases = {
            "APPROVED_SHA_INVALID": {"APPROVED_SHA": "main"},
            "MINIFLUX_URL_INVALID": {"READING_SIGNALS_MINIFLUX_BASE_URL": "http://miniflux.example.test"},
            "ORIGINS_INVALID": {"READING_SIGNALS_ALLOWED_WEB_ORIGINS": "https://news.example.test/path"},
            "READER_NETWORK_INVALID": {"READING_SIGNALS_READER_NETWORK": "bad name"},
            "NETWORKS_MUST_DIFFER": {"READING_SIGNALS_EGRESS_NETWORK": "newsflux_pilot_summary_private"},
            "EGRESS_NETWORK_MISSING": {"FAKE_MISSING_NETWORK": "ai_internal"},
            "READER_IP_NOT_FIXED": {"FAKE_READER_IP": ""},
        }
        for code_name, env in cases.items():
            with self.subTest(code_name):
                code, out = self.run_script("apply", **env)
                self.assertNotEqual(code, 0)
                self.assertIn(f"CODE={code_name}", out)
                self.assertFalse(self.state.exists())
                self.assertFalse(any(c.startswith(("build", "compose")) for c in self.docker_calls()))

    def test_unhealthy_container_blocks_and_prints_the_rollback(self):
        code, out = self.run_script("apply", FAKE_HEALTH="unhealthy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=HEALTH_unhealthy", out)
        self.assertIn("ROLLBACK=", out)
        self.assertFalse((self.state / "CURRENT").exists())

    def test_rollback_stops_the_sidecar_and_keeps_the_data_volume(self):
        self.assertEqual(self.run_script("apply")[0], 0)
        code, out = self.run_script("rollback")
        self.assertEqual(code, 0, out)
        self.assertIn("ROLLBACK=PASS", out)
        self.assertIn("DATA_VOLUME=KEPT", out)
        down = next(c for c in self.docker_calls() if c.startswith("compose ") and " down" in c)
        self.assertNotIn(" -v", down)
        self.assertNotIn("--volumes", down)
        code, out = self.run_script("status")
        self.assertEqual(code, 0, out)
        self.assertIn("STATE=absent", out)

    def test_rollback_without_an_applied_release_is_refused(self):
        code, out = self.run_script("rollback")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=RELEASE_NOT_APPLIED", out)


if __name__ == "__main__":
    unittest.main()
