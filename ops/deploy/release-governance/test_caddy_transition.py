"""Caddy state-transition model of ai-functional-release.sh (update-caddy / rollback-caddy).

Runs the real operator script against a fake `docker` on PATH that simulates the Reader's single-file
bind mount (the container reads the same host inode), `caddy validate` and `caddy reload`. No Docker
daemon, network or host path is used. The end-to-end Docker rehearsal is rehearse-stage1-upgrade.sh.
"""
from __future__ import annotations

import hashlib
import os
import stat
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "ai-functional-release.sh"
PRE_STAGE1 = "6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108"
STAGE1 = "56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6"
AI_SETTINGS = "201d453332bd2cbc82f645471a9386b6a39acb9c26a63f607df41f7539346371"
REPO = HERE.parent.parent.parent

FAKE_DOCKER = textwrap.dedent(r'''
    #!/usr/bin/env bash
    # Fake docker: Reader container "newsflux" bind-mounts $FAKE_CADDY at /etc/caddy/Caddyfile.
    set -u
    echo "$*" >>"$FAKE_LOG"
    case "$1" in
      inspect)
        if [[ "$*" == *".Mounts"* ]]; then printf '%s\n' "$FAKE_CADDY"; exit 0; fi
        if [[ "$*" == *"{{.Image}}"* ]]; then echo sha256:fake-reader; exit 0; fi
        exit 1 ;;
      run)
        [[ "$*" == *"caddy validate"* ]] || exit 1
        [[ "${FAKE_VALIDATE_FAIL:-}" == 1 ]] && exit 1
        exit 0 ;;
      exec)
        if [[ "$*" == *"sha256sum /etc/caddy/Caddyfile"* ]]; then sha256sum "$FAKE_CADDY" | sed "s#$FAKE_CADDY#/etc/caddy/Caddyfile#"; exit 0; fi
        if [[ "$*" == *"caddy reload"* ]]; then
          [[ -f "${FAKE_RELOAD_FAIL_ONCE:-/nonexistent}" ]] && { rm -f "$FAKE_RELOAD_FAIL_ONCE"; exit 1; }
          [[ "${FAKE_RELOAD_FAIL:-}" == 1 ]] && exit 1
          echo reload >>"$FAKE_RELOADS"; exit 0
        fi
        exit 1 ;;
    esac
    exit 1
''').lstrip()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class CaddyTransitionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        # Exact historical prior states from git history.
        self.pre_stage1 = subprocess.run(
            ["git", "show", "a398387905bf399ca767c6c25fa32b7fc00f3620:deploy/article-intel-pilot/Caddyfile"],
            cwd=REPO, check=True, capture_output=True).stdout
        self.stage1 = subprocess.run(
            ["git", "show", "57f1c6aaa22b44a087cdf7c7bc0dfbb83f521c37:deploy/article-intel-pilot/Caddyfile"],
            cwd=REPO, check=True, capture_output=True).stdout
        assert hashlib.sha256(self.pre_stage1).hexdigest() == PRE_STAGE1
        assert hashlib.sha256(self.stage1).hexdigest() == STAGE1
        self.ai_settings = subprocess.run(
            ["git", "show", "c7e40fc5cfdc834596ca036f1f1fe73f5ff8a3ee:deploy/article-intel-pilot/Caddyfile"],
            cwd=REPO, check=True, capture_output=True).stdout
        assert hashlib.sha256(self.ai_settings).hexdigest() == AI_SETTINGS
        self.target = self.stage1 + b"\n# synthetic release target: admin routes would be added here\n"
        # Exact source repo the release script requires (clean checkout at APPROVED_SHA).
        src_repo = root / "origin"
        (src_repo / "ops/deploy/article-intel-pilot").mkdir(parents=True)
        (src_repo / "ops/deploy/article-intel-pilot/Caddyfile").write_bytes(self.target)
        git("init", "-q", cwd=src_repo)
        git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A", cwd=src_repo)
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "target", cwd=src_repo)
        self.sha = git("rev-parse", "HEAD", cwd=src_repo)
        self.release_root = root / "releases"
        self.release_dir = self.release_root / f"ai-functional-{self.sha[:12]}"
        self.release_dir.mkdir(parents=True, mode=0o700)
        git("clone", "-q", str(src_repo), str(self.release_dir / "source"), cwd=root)
        # Live bind-mounted Caddyfile, world-readable like a real mount source.
        self.caddy = root / "stack" / "Caddyfile"
        self.caddy.parent.mkdir()
        self.caddy.write_bytes(self.stage1)
        self.caddy.chmod(0o644)
        bindir = root / "bin"
        bindir.mkdir()
        (bindir / "docker").write_text(FAKE_DOCKER)
        (bindir / "docker").chmod(0o755)
        self.log = root / "docker.log"
        self.reloads = root / "reloads"
        self.env = {
            **os.environ,
            "PATH": f"{bindir}:{os.environ['PATH']}",
            "APPROVED_SHA": self.sha,
            "NEWSFLUX_RELEASE_ROOT": str(self.release_root),
            "NEWSFLUX_RELEASE_LOCK": str(root / "release.lock"),
            "FAKE_CADDY": str(self.caddy),
            "FAKE_LOG": str(self.log),
            "FAKE_RELOADS": str(self.reloads),
        }
        self.state = self.release_dir / "caddy"

    def op(self, command, **env):
        result = subprocess.run(["bash", str(SCRIPT), command], env={**self.env, **env},
                                capture_output=True, text=True)
        return result.returncode, result.stdout + result.stderr

    def identity(self):
        info = self.caddy.stat()
        return info.st_ino, sha(self.caddy)

    # --- forward migration ---------------------------------------------------------------

    def test_stage1_to_target_backup_inplace_readback(self):
        inode = self.caddy.stat().st_ino
        code, out = self.op("update-caddy")
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_UPDATE=PASS", out)
        self.assertIn(f"CADDY_FROM_SHA256={STAGE1}", out)
        self.assertEqual(self.identity(), (inode, hashlib.sha256(self.target).hexdigest()))
        self.assertEqual((self.state / "before.Caddyfile").read_bytes(), self.stage1)
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode), 0o700)
        for name in ("before.Caddyfile", "before.sha256", "target.sha256", "before.stat", "transition.log"):
            self.assertEqual(stat.S_IMODE((self.state / name).stat().st_mode), 0o600, name)
        self.assertIn("mode=644", (self.state / "before.stat").read_text())
        self.assertEqual(self.reloads.read_text().count("reload"), 1)
        # Validation ran before any write, isolated from the network.
        lines = self.log.read_text().splitlines()
        validate = next(i for i, l in enumerate(lines) if "caddy validate" in l)
        reload = next(i for i, l in enumerate(lines) if "caddy reload" in l)
        self.assertLess(validate, reload)
        self.assertIn("--network none", lines[validate])

    def test_pre_stage1_is_an_accepted_prior_state(self):
        self.caddy.write_bytes(self.pre_stage1)
        code, out = self.op("update-caddy")
        self.assertEqual(code, 0, out)
        code, out = self.op("rollback-caddy")
        self.assertEqual(code, 0, out)
        self.assertEqual(sha(self.caddy), PRE_STAGE1)

    def test_ai_settings_state_is_an_accepted_prior_state(self):
        # The state live through 193b3ae1 must migrate to the reading-signals Caddyfile and roll back exactly.
        self.caddy.write_bytes(self.ai_settings)
        code, out = self.op("update-caddy")
        self.assertEqual(code, 0, out)
        self.assertIn(f"CADDY_FROM_SHA256={AI_SETTINGS}", out)
        code, out = self.op("rollback-caddy")
        self.assertEqual(code, 0, out)
        self.assertEqual(sha(self.caddy), AI_SETTINGS)

    def test_main_caddyfile_routes_reading_signals_only_from_the_trusted_edge(self):
        source = (REPO / "ops/deploy/article-intel-pilot/Caddyfile").read_text()
        block = source.split("@readingSignals {", 1)[1].split("}", 1)[0]
        self.assertIn("remote_ip {$NEWSFLUX_PILOT_TRUSTED_PROXY_IP}", block)
        self.assertIn("header X-Forwarded-Proto https", block)
        paths = next(line.split()[1:] for line in block.splitlines() if line.strip().startswith("path "))
        self.assertEqual(sorted(paths), sorted(f"/api/reading-signals{p}" for p in (
            "/healthz", "/v1/signals", "/v1/signals/reset", "/v1/affinity", "/v1/export")))
        self.assertIn("handle /api/reading-signals/* {\n    respond 403\n}", source)
        # The route must precede the static and SPA handlers so it is never served as index.html.
        self.assertLess(source.index("@readingSignals {"), source.index("@staticFiles"))

    def test_update_is_idempotent(self):
        self.assertEqual(self.op("update-caddy")[0], 0)
        before = self.identity()
        code, out = self.op("update-caddy")
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_UPDATE=ALREADY_APPLIED_BY_THIS_RELEASE", out)
        self.assertEqual(self.identity(), before)
        self.assertEqual(self.reloads.read_text().count("reload"), 1)

    def test_unknown_state_is_drift_and_nothing_is_written(self):
        self.caddy.write_bytes(self.stage1 + b"# operator edit\n")
        before = self.identity()
        code, out = self.op("update-caddy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=ACTIVE_CADDY_DRIFT", out)
        self.assertEqual(self.identity(), before)
        self.assertFalse(self.state.exists())

    def test_env_cannot_widen_accepted_states(self):
        self.caddy.write_bytes(b"# unknown\n")
        code, out = self.op("update-caddy", EXPECTED_ACTIVE_CADDY_SHA=sha(self.caddy))
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=ACTIVE_CADDY_DRIFT", out)

    def test_symlinked_mount_source_is_refused(self):
        real = self.caddy.with_name("real")
        real.write_bytes(self.stage1)
        self.caddy.unlink()
        self.caddy.symlink_to(real)
        code, out = self.op("update-caddy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=CADDYFILE_IS_SYMLINK", out)
        self.assertEqual(real.read_bytes(), self.stage1)

    def test_invalid_target_blocks_before_any_write(self):
        before = self.identity()
        code, out = self.op("update-caddy", FAKE_VALIDATE_FAIL="1")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=NEW_CADDYFILE_INVALID", out)
        self.assertEqual(self.identity(), before)
        self.assertFalse(self.reloads.exists())

    # --- failure injection ---------------------------------------------------------------

    def test_fault_before_write_leaves_live_file_untouched_then_retry_succeeds(self):
        before = self.identity()
        code, out = self.op("update-caddy", NEWSFLUX_REHEARSAL_FAULT="caddy-before-write")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=REHEARSAL_FAULT_BEFORE_WRITE", out)
        self.assertEqual(self.identity(), before)
        code, out = self.op("update-caddy")
        self.assertEqual(code, 0, out)

    def test_fault_during_write_restores_exact_bytes_and_inode(self):
        before = self.identity()
        code, out = self.op("update-caddy", NEWSFLUX_REHEARSAL_FAULT="caddy-during-write")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=WRITE_FAILED_RESTORED", out)
        self.assertEqual(self.identity(), before)
        self.assertEqual(self.caddy.read_bytes(), self.stage1)

    def test_reload_failure_restores_and_reloads_prior_state(self):
        before = self.identity()
        once = Path(self.tmp.name) / "fail-once"
        once.write_text("x")
        code, out = self.op("update-caddy", FAKE_RELOAD_FAIL_ONCE=str(once))
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=RELOAD_FAILED_RESTORED", out)
        self.assertEqual(self.identity(), before)
        self.assertEqual(self.reloads.read_text().count("reload"), 1)  # the restore reload

    def test_injected_reload_fault_restores(self):
        before = self.identity()
        code, out = self.op("update-caddy", NEWSFLUX_REHEARSAL_FAULT="caddy-reload")
        self.assertIn("CODE=RELOAD_FAILED_RESTORED", out)
        self.assertNotEqual(code, 0)
        self.assertEqual(self.identity(), before)

    def test_fault_hook_is_ignored_for_the_production_release_root(self):
        script = SCRIPT.read_text()
        self.assertIn('[[ "$RELEASE_ROOT" == /dockerdata/compose/newsflux/.releases ]] && REHEARSAL_FAULT=""', script)

    # --- rollback ------------------------------------------------------------------------

    def test_rollback_restores_exact_prior_bytes_inode_and_is_idempotent(self):
        before = self.identity()
        self.assertEqual(self.op("update-caddy")[0], 0)
        code, out = self.op("rollback-caddy")
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_ROLLBACK=PASS", out)
        self.assertEqual(self.identity(), before)
        self.assertEqual(self.caddy.read_bytes(), self.stage1)
        code, out = self.op("rollback-caddy")
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_ROLLBACK=ALREADY_RESTORED", out)
        self.assertEqual(self.identity(), before)

    def test_rollback_refuses_concurrent_external_change(self):
        self.assertEqual(self.op("update-caddy")[0], 0)
        drifted = self.caddy.read_bytes() + b"# edited after release\n"
        self.caddy.write_bytes(drifted)
        code, out = self.op("rollback-caddy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=DRIFT_SINCE_RELEASE", out)
        self.assertEqual(self.caddy.read_bytes(), drifted)  # never silently overwritten

    def test_rollback_refuses_tampered_backup(self):
        self.assertEqual(self.op("update-caddy")[0], 0)
        backup = self.state / "before.Caddyfile"
        backup.write_bytes(b"tampered\n")
        code, out = self.op("rollback-caddy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=BACKUP_CORRUPT", out)
        self.assertEqual(sha(self.caddy), hashlib.sha256(self.target).hexdigest())

    def test_rollback_without_backup_or_unchanged_marker_blocks(self):
        code, out = self.op("rollback-caddy")
        self.assertNotEqual(code, 0)
        self.assertIn("CODE=BACKUP_MISSING", out)

    def test_unchanged_release_is_a_verified_noop(self):
        (self.release_dir / "source/ops/deploy/article-intel-pilot/Caddyfile").write_bytes(self.stage1)
        src = self.release_dir / "source"
        git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "same", cwd=src)
        env = {"APPROVED_SHA": git("rev-parse", "HEAD", cwd=src)}
        # Same release dir name is derived from the SHA: move the checkout there.
        new_dir = self.release_root / f"ai-functional-{env['APPROVED_SHA'][:12]}"
        self.release_dir.rename(new_dir)
        code, out = self.op("update-caddy", **env)
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_UPDATE=ALREADY_APPLIED", out)
        code, out = self.op("rollback-caddy", **env)
        self.assertEqual(code, 0, out)
        self.assertIn("CADDY_ROLLBACK=NOT_APPLICABLE_UNCHANGED_BY_THIS_RELEASE", out)

    def test_release_lock_is_honoured(self):
        import fcntl
        with open(self.env["NEWSFLUX_RELEASE_LOCK"], "a+") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = self.identity()
            code, out = self.op("update-caddy")
            self.assertNotEqual(code, 0)
            self.assertIn("CODE=RELEASE_LOCKED", out)
            self.assertEqual(self.identity(), before)
        self.assertEqual(self.op("update-caddy")[0], 0)


if __name__ == "__main__":
    unittest.main()
