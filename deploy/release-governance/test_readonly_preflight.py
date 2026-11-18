"""ai-settings-readonly-preflight.sh (R4): fail-closed classification, no secrets, no writes.

The real script runs against a fake `docker` on PATH that answers from a JSON state file with full
`docker inspect` documents (health, port bindings, network mode, env, mounts, RW flags), in-container
`stat` / `sha256sum` answers and the backend's own origin validator. Every case asserts the exit code,
the sanitized output and that no mutating Docker call was made.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "ai-settings-readonly-preflight.sh"
BASELINE = HERE / "ai-settings-flag-baseline.json"
STAGE1 = "56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6"
REPO = HERE.parent.parent
SECRET_PATH = "/run/secrets/newsflux-litellm-virtual-key"
ORIGIN = "https://news.private.example"
PROXY_IP = "172.18.0.9"
SECRETS = (SECRET_PATH, ORIGIN, "news.private.example", PROXY_IP, "miniflux.private.example")

FAKE_DOCKER = textwrap.dedent(r'''
    #!/usr/bin/env python3
    import hashlib, json, os, subprocess, sys
    state = json.load(open(os.environ["FAKE_STATE"]))
    with open(os.environ["FAKE_LOG"], "a") as log:
        log.write(json.dumps(sys.argv[1:]) + "\n")
    a = sys.argv[1:]
    if state.get("docker_down"):
        print("Cannot connect to the Docker daemon", file=sys.stderr); sys.exit(1)
    def ctr(name):
        return state["containers"].get(name)
    if a[0] == "ps":
        filters = [a[i + 1] for i, x in enumerate(a) if x == "--filter"]
        if "name=wallhop" in filters:
            for line in state.get("wallhop_containers", []):
                print(line)
            sys.exit(0)
        if any("service=summary-api" in f for f in filters):
            for name in state.get("summary_names", ["summary"]):
                print(name)
            sys.exit(0)
        sys.exit(0)
    if a[0] == "network" and a[1] == "ls":
        for line in state.get("wallhop_networks", []):
            print(line)
        sys.exit(0)
    if a[0] == "image" and a[1] == "inspect":
        print(json.dumps([{"Id": a[-1], "Config": {"Labels": {"org.opencontainers.image.revision": state["revision"]}}}]))
        sys.exit(0)
    if a[0] == "inspect":
        name = a[-1]
        c = ctr(name)
        if c is None or c.get("inspect_fails"):
            print("Error: No such object", file=sys.stderr); sys.exit(1)
        print(json.dumps([c["doc"]])); sys.exit(0)
    if a[0] == "exec":
        name, cmd = a[1], a[2:]
        c = ctr(name) or {}
        if cmd[:2] == ["stat", "-c"]:
            answer = c.get("stat", {}).get(cmd[-1])
            if answer is None:
                sys.exit(1)
            print(answer); sys.exit(0)
        if cmd[:2] == ["sha256sum", "/etc/caddy/Caddyfile"]:
            print(hashlib.sha256(open(c["caddy_host"], "rb").read()).hexdigest() + "  /etc/caddy/Caddyfile"); sys.exit(0)
        if cmd[0] == "python" and "-c" in cmd:
            if c.get("backend_exec_fails"):
                sys.exit(1)
            env = {e.split("=", 1)[0]: e.split("=", 1)[1] for e in c["doc"]["Config"]["Env"]}
            env["PYTHONPATH"] = os.environ["FAKE_REPO"]
            run = subprocess.run([sys.executable, "-c", cmd[cmd.index("-c") + 1]], env=env, capture_output=True, text=True)
            sys.stdout.write(run.stdout); sys.exit(run.returncode)
        sys.exit(1)
    sys.exit(1)
''').lstrip()

READ_ONLY_DOCKER = {"ps", "inspect", "image", "exec", "network"}


def summary_doc(env=None, **over):
    doc = {
        "Id": "summary-id", "Image": "sha256:img-summary", "Name": "/newsflux-summary-api-1",
        "State": {"Status": "running", "Running": True, "Health": {"Status": "healthy"}},
        "Config": {
            "User": "10001:10001",
            "Env": [f"{k}={v}" for k, v in (env or {}).items()],
            "Labels": {"com.docker.compose.project.config_files": "/a.yaml,/b.yaml",
                       "com.docker.compose.service": "summary-api"},
        },
        "HostConfig": {"PortBindings": {}, "NetworkMode": "newsflux_summary_private"},
        "NetworkSettings": {"Ports": {"8788/tcp": None}},
        "Mounts": [
            {"Type": "bind", "Source": "/srv/private-ledger", "Destination": "/data", "RW": True},
            {"Type": "bind", "Source": SECRET_PATH, "Destination": SECRET_PATH, "RW": False},
        ],
    }
    for key, value in over.items():
        doc[key] = value
    return doc


class ReadonlyPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.caddy = root / "Caddyfile"
        self.caddy.write_bytes(subprocess.run(
            ["git", "show", "57f1c6aaa22b44a087cdf7c7bc0dfbb83f521c37:deploy/article-intel-pilot/Caddyfile"],
            cwd=REPO, check=True, capture_output=True).stdout)
        bindir = root / "bin"
        bindir.mkdir()
        (bindir / "docker").write_text(FAKE_DOCKER)
        (bindir / "docker").chmod(0o755)
        self.state_file = root / "state.json"
        self.log = root / "docker.log"
        self.env_vars = {
            "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS": "1",
            "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": ORIGIN,
            "NEWSFLUX_AI_MINIFLUX_BASE_URL": "https://miniflux.private.example",
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": SECRET_PATH,
            "NEWSFLUX_AI_INFERENCE_ENABLED": "false",
        }
        self.state = {
            "revision": "d54eda2bdb8bc5c3d1bd58d40236f48da762e852",
            "containers": {
                "summary": {
                    "stat": {"/data": "10001 10001 700 directory"},
                },
                "newsflux": {
                    "caddy_host": str(self.caddy),
                    "doc": {
                        "Id": "reader-id", "Image": "sha256:img-reader", "Name": "/newsflux",
                        "State": {"Status": "running", "Running": True},
                        "Config": {"Env": [f"NEWSFLUX_PILOT_TRUSTED_PROXY_IP={PROXY_IP}"],
                                   "Labels": {"com.docker.compose.service": "newsflux"}},
                        "HostConfig": {"PortBindings": {}}, "NetworkSettings": {"Ports": {}},
                        "Mounts": [{"Type": "bind", "Source": str(self.caddy),
                                    "Destination": "/etc/caddy/Caddyfile", "RW": False}],
                    },
                },
                "miniflux": {"doc": {"Id": "mf", "Image": "sha256:mf", "State": {"Running": True}}},
                "miniflux-db": {"doc": {"Id": "mfdb", "Image": "sha256:mfdb", "State": {"Running": True}}},
            },
        }
        self.summary_over = {}
        self.env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}",
                    "FAKE_STATE": str(self.state_file), "FAKE_LOG": str(self.log), "FAKE_REPO": str(REPO),
                    "NEWSFLUX_RELEASE_LOCK": str(root / "no.lock")}

    def run_preflight(self, extra_env=None):
        summary = self.state["containers"]["summary"]
        summary["doc"] = summary_doc(self.env_vars, **self.summary_over)
        self.state_file.write_text(json.dumps(self.state))
        watched = Path(self.tmp.name)
        before = {p.name: p.stat().st_mtime_ns for p in watched.iterdir() if p.name != "docker.log"}
        caddy_before = self.caddy.read_bytes() if self.caddy.exists() and not self.caddy.is_symlink() else None
        result = subprocess.run(["bash", str(SCRIPT)], env={**self.env, **(extra_env or {})},
                                capture_output=True, text=True, timeout=120)
        after = {p.name: p.stat().st_mtime_ns for p in watched.iterdir() if p.name != "docker.log"}
        self.assertEqual(before, after, "preflight created or modified a file")
        if caddy_before is not None:
            self.assertEqual(self.caddy.read_bytes(), caddy_before)
        out = result.stdout + result.stderr
        for secret in SECRETS + (str(self.caddy),):
            self.assertNotIn(secret, out)
        for line in self.log.read_text().splitlines() if self.log.exists() else []:
            call = json.loads(line)
            self.assertIn(call[0], READ_ONLY_DOCKER, call)
            if call[0] == "image":
                self.assertEqual(call[1], "inspect", call)
            if call[0] == "network":
                self.assertEqual(call[1], "ls", call)
        parsed = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        self.assertIn(parsed.get("PREFLIGHT"), {"PASS", "HOLD"}, result.stdout + result.stderr)
        self.assertEqual(result.returncode, 0 if parsed["PREFLIGHT"] == "PASS" else 3, out)
        return result.returncode, parsed

    def assert_hold(self, key, value, **kw):
        code, out = self.run_preflight(**kw)
        self.assertEqual(code, 3, out)
        self.assertEqual(out["PREFLIGHT"], "HOLD")
        self.assertEqual(out.get(key), value, out)
        return out

    # --- safe baseline -------------------------------------------------------------------

    def test_safe_stage1_baseline_passes(self):
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)
        expected = {
            "SUMMARY_HEALTH": "healthy", "SUMMARY_PUBLISHED_PORTS": "0", "SUMMARY_USER": "UID10001",
            "DATA_MOUNT": "bind", "DATA_MOUNT_RW": "RW", "DATA_OWNER": "UID10001", "DATA_TYPE": "DIRECTORY",
            "DATA_WRITABLE_BY_UID10001": "PROVEN_BY_METADATA", "ADMIN_ALLOWLIST": "CONFIGURED_COUNT_1",
            "ALLOWED_ORIGINS": "VALID_COUNT_1", "ALLOWED_ORIGINS_BACKEND": "VALID",
            "ADMIN_CONFIG_WRITES_ENABLED": "OFF", "INFERENCE_ENABLED": "OFF",
            "ALLOW_EXTERNAL_ARTICLE_TRANSFER": "OFF", "ALLOW_PAID_INFERENCE": "OFF",
            "ALLOW_LOCAL_ARTICLE_PROCESSING": "OFF", "LOCAL_PROCESSING_BASELINE": "OFF",
            "LOCAL_PROCESSING_BASELINE_GATE": "MATCH", "CADDY_STATE": "STAGE1_ACCEPTED_PRIOR",
            "ACTIVE_CADDY_SHA256": STAGE1, "CADDY_CONTAINER_READBACK": "MATCH",
            "TRUSTED_PROXY_IP": "CONFIGURED", "WALLHOP_RESOURCES": "0",
            "WALLHOP_INTEGRITY": "UNVERIFIED_NO_BASELINE", "SECRET_PRINTED": "NO", "WRITES_PERFORMED": "NO",
            "PREFLIGHT": "PASS",
        }
        for key, value in expected.items():
            self.assertEqual(out.get(key), value, key)
        self.assertNotIn("WALLHOP_UNAUTHORIZED_MUTATIONS", out)

    # --- AI flags ------------------------------------------------------------------------

    def test_each_canary_flag_on_is_hold(self):
        for name, key in (
            ("NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED", "ADMIN_CONFIG_WRITES_ENABLED"),
            ("NEWSFLUX_AI_INFERENCE_ENABLED", "INFERENCE_ENABLED"),
            ("NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER", "ALLOW_EXTERNAL_ARTICLE_TRANSFER"),
            ("NEWSFLUX_AI_ALLOW_PAID_INFERENCE", "ALLOW_PAID_INFERENCE"),
        ):
            for value in ("true", "TRUE", " True "):
                with self.subTest(name=name, value=value):
                    self.env_vars[name] = value
                    self.assert_hold(key, "ON")
                    self.env_vars[name] = "false"

    def test_malformed_flag_value_is_hold(self):
        for value in ("yes", "1", "on", "enabled", "fals"):
            with self.subTest(value=value):
                self.env_vars["NEWSFLUX_AI_INFERENCE_ENABLED"] = value
                self.assert_hold("INFERENCE_ENABLED", "MALFORMED")

    def test_local_processing_drift_from_baseline_is_hold(self):
        self.env_vars["NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING"] = "true"
        out = self.assert_hold("LOCAL_PROCESSING_BASELINE_GATE", "DRIFT")
        self.assertEqual(out["ALLOW_LOCAL_ARTICLE_PROCESSING"], "ON")

    def test_local_processing_preserved_explicit_false_passes(self):
        self.env_vars["NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING"] = "false"
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["LOCAL_PROCESSING_BASELINE_GATE"], "MATCH")

    def test_baseline_is_a_reviewed_repository_file_not_an_env_override(self):
        baseline = json.loads(BASELINE.read_text())
        self.assertEqual(baseline["flags"]["NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING"], "OFF")
        self.env_vars["NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING"] = "true"
        self.assert_hold("LOCAL_PROCESSING_BASELINE_GATE", "DRIFT",
                         extra_env={"NEWSFLUX_LOCAL_PROCESSING_BASELINE": "ON",
                                    "LOCAL_PROCESSING_BASELINE": "ON"})

    def test_missing_or_malformed_baseline_file_is_hold(self):
        copy_dir = Path(self.tmp.name) / "copy"
        copy_dir.mkdir()
        lone = copy_dir / SCRIPT.name
        lone.write_text(SCRIPT.read_text())
        self.state["containers"]["summary"]["doc"] = summary_doc(self.env_vars)
        self.state_file.write_text(json.dumps(self.state))
        result = subprocess.run(["bash", str(lone)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 3)
        self.assertIn("LOCAL_PROCESSING_BASELINE=UNAVAILABLE", result.stdout)
        self.assertIn("PREFLIGHT=HOLD", result.stdout)

    # --- Summary health and exposure -----------------------------------------------------

    def test_summary_health_not_healthy_is_hold(self):
        for health, expected in (({"Status": "unhealthy"}, "unhealthy"), ({"Status": "starting"}, "starting"),
                                 (None, "none")):
            with self.subTest(health=health):
                self.summary_over["State"] = {"Status": "running", "Running": True, **({"Health": health} if health else {})}
                self.assert_hold("SUMMARY_HEALTH", expected)

    def test_published_summary_port_is_hold(self):
        self.summary_over["HostConfig"] = {"PortBindings": {"8788/tcp": [{"HostIp": "", "HostPort": "8788"}]},
                                           "NetworkMode": "bridge"}
        self.summary_over["NetworkSettings"] = {"Ports": {"8788/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8788"}]}}
        out = self.assert_hold("SUMMARY_PUBLISHED_PORTS_GATE", "HOLD")
        self.assertNotEqual(out["SUMMARY_PUBLISHED_PORTS"], "0")

    def test_runtime_only_port_mapping_is_hold(self):
        self.summary_over["NetworkSettings"] = {"Ports": {"8788/tcp": [{"HostIp": "127.0.0.1", "HostPort": "18788"}]}}
        self.assert_hold("SUMMARY_PUBLISHED_PORTS_GATE", "HOLD")

    def test_host_network_mode_is_hold(self):
        self.summary_over["HostConfig"] = {"PortBindings": {}, "NetworkMode": "host"}
        self.assert_hold("SUMMARY_NETWORK_MODE", "HOST")

    def test_summary_not_uid_10001_is_hold(self):
        self.summary_over["Config"] = {**summary_doc(self.env_vars)["Config"], "User": "root"}
        self.assert_hold("SUMMARY_USER", "NOT_10001")

    def test_summary_not_unique_is_hold(self):
        self.state["summary_names"] = ["summary", "summary"]
        self.assert_hold("SUMMARY_CONTAINER", "NOT_UNIQUE")

    # --- origins and allowlist -----------------------------------------------------------

    def test_valid_origin_list_passes(self):
        self.env_vars["NEWSFLUX_AI_ALLOWED_WEB_ORIGINS"] = f"{ORIGIN},https://news2.private.example:8443"
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["ALLOWED_ORIGINS"], "VALID_COUNT_2")

    def test_invalid_origins_are_hold(self):
        for raw in (
            f"{ORIGIN},http://news.private.example",
            "http://news.private.example",
            "https://user:pw@news.private.example",
            "https://*.private.example",
            "https://news.private.example?x=1",
            "https://news.private.example#f",
            "https://news.private.example/path",
            f"{ORIGIN},,https://b.example",
            f"{ORIGIN}, ",
            "https://",
            "",
        ):
            with self.subTest(raw=raw):
                self.env_vars["NEWSFLUX_AI_ALLOWED_WEB_ORIGINS"] = raw
                self.assert_hold("ALLOWED_ORIGINS", "INVALID" if raw else "EMPTY")

    def test_backend_origin_validator_unavailable_is_hold(self):
        self.state["containers"]["summary"]["backend_exec_fails"] = True
        self.assert_hold("ALLOWED_ORIGINS_BACKEND", "UNVERIFIED")

    def test_admin_allowlist_empty_or_invalid_is_hold(self):
        del self.env_vars["NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS"]
        self.assert_hold("ADMIN_ALLOWLIST", "EMPTY")
        for raw in ("1,abc", "0", "-1", "1,,2"):
            with self.subTest(raw=raw):
                self.env_vars["NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS"] = raw
                self.assert_hold("ADMIN_ALLOWLIST", "INVALID")

    def test_missing_bootstrap_key_file_is_hold(self):
        del self.env_vars["NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"]
        self.assert_hold("BOOTSTRAP_KEY_FILE_CONFIGURED", "NO")

    # --- /data ---------------------------------------------------------------------------

    def test_data_mount_absent_is_hold(self):
        self.summary_over["Mounts"] = []
        self.assert_hold("DATA_MOUNT", "ABSENT")

    def test_data_mount_read_only_is_hold(self):
        self.summary_over["Mounts"] = [{"Type": "bind", "Source": "/x", "Destination": "/data", "RW": False}]
        self.assert_hold("DATA_MOUNT_RW", "RO")

    def test_data_mount_tmpfs_is_hold(self):
        self.summary_over["Mounts"] = [{"Type": "tmpfs", "Source": "", "Destination": "/data", "RW": True}]
        self.assert_hold("DATA_MOUNT", "TYPE_NOT_ALLOWED")

    def test_data_owner_or_permissions_wrong_is_hold(self):
        for stat_line, key, value in (
            ("0 0 755 directory", "DATA_OWNER", "NOT_10001"),
            ("10001 10001 500 directory", "DATA_WRITABLE_BY_UID10001", "UNVERIFIED"),
            ("10001 10001 777 directory", "DATA_WORLD_WRITABLE", "YES"),
            ("10001 10001 700 symbolic link", "DATA_TYPE", "NOT_DIRECTORY"),
            ("garbage", "DATA_STAT", "MALFORMED"),
        ):
            with self.subTest(stat_line=stat_line):
                self.state["containers"]["summary"]["stat"] = {"/data": stat_line}
                self.assert_hold(key, value)

    def test_data_permissions_not_verifiable_is_hold(self):
        self.state["containers"]["summary"]["stat"] = {}
        self.assert_hold("DATA_STAT", "UNVERIFIED")

    def test_managed_store_present_must_be_private(self):
        self.state["containers"]["summary"]["stat"] = {
            "/data": "10001 10001 700 directory",
            "/data/newsflux-ai-settings": "10001 10001 700 directory",
        }
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["MANAGED_SETTINGS_DIR"], "PRESENT_PRIVATE")
        self.state["containers"]["summary"]["stat"]["/data/newsflux-ai-settings"] = "10001 10001 755 directory"
        self.assert_hold("MANAGED_SETTINGS_DIR", "PRESENT_UNSAFE")

    # --- Caddy, Reader, protected services, Docker ----------------------------------------

    def test_unknown_caddy_state_is_hold(self):
        self.caddy.write_bytes(self.caddy.read_bytes() + b"# edited\n")
        self.assert_hold("CADDY_STATE", "UNKNOWN_DRIFT")

    def test_repository_target_caddyfile_is_already_applied(self):
        target = (HERE.parent / "article-intel-pilot" / "Caddyfile").read_bytes()
        self.caddy.write_bytes(target)
        code, out = self.run_preflight()
        if hashlib.sha256(target).hexdigest() == STAGE1:
            self.assertEqual(out["CADDY_STATE"], "STAGE1_ACCEPTED_PRIOR")
        else:
            self.assertEqual(out["CADDY_STATE"], "TARGET_ALREADY_APPLIED")
        self.assertEqual(code, 0, out)

    def test_env_cannot_declare_an_arbitrary_target_caddy(self):
        self.caddy.write_bytes(b"# arbitrary\n")
        self.assert_hold("CADDY_STATE", "UNKNOWN_DRIFT",
                         extra_env={"NEWSFLUX_TARGET_CADDY_SHA": hashlib.sha256(b"# arbitrary\n").hexdigest()})

    def test_symlinked_caddy_mount_is_hold(self):
        link = self.caddy.with_name("link")
        link.symlink_to(self.caddy)
        self.state["containers"]["newsflux"]["doc"]["Mounts"][0]["Source"] = str(link)
        self.assert_hold("CADDYFILE_MOUNT", "SYMLINK")

    def test_trusted_proxy_absent_or_invalid_is_hold(self):
        self.state["containers"]["newsflux"]["doc"]["Config"]["Env"] = []
        self.assert_hold("TRUSTED_PROXY_IP", "ABSENT")
        self.state["containers"]["newsflux"]["doc"]["Config"]["Env"] = ["NEWSFLUX_PILOT_TRUSTED_PROXY_IP=0.0.0.0/0"]
        self.assert_hold("TRUSTED_PROXY_IP", "INVALID")

    def test_protected_service_absent_or_down_is_hold(self):
        self.state["containers"]["miniflux"]["doc"]["State"] = {"Running": False}
        self.assert_hold("PROTECTED_miniflux", "NOT_RUNNING")
        del self.state["containers"]["miniflux"]
        self.assert_hold("PROTECTED_miniflux", "ABSENT")

    def test_docker_inspect_failure_is_hold(self):
        self.state["containers"]["newsflux"]["inspect_fails"] = True
        self.assert_hold("READER_CONTAINER", "INSPECT_FAILED")

    def test_docker_unavailable_is_hold(self):
        self.state["docker_down"] = True
        self.assert_hold("DOCKER", "UNAVAILABLE")

    def test_unexpected_inspect_shape_is_hold(self):
        self.summary_over["State"] = "garbage"
        self.assert_hold("SUMMARY_HEALTH", "UNKNOWN")

    # --- WallHop no-touch ------------------------------------------------------------------

    def test_wallhop_without_baseline_is_unverified_not_integrity_pass(self):
        self.state["wallhop_containers"] = ["abc sha256:w1 wallhop-reader"]
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)  # pre-existing WallHop is not a reason to block
        self.assertEqual(out["WALLHOP_RESOURCES"], "1")
        self.assertEqual(out["WALLHOP_INTEGRITY"], "UNVERIFIED_NO_BASELINE")
        self.assertNotIn("WALLHOP_UNAUTHORIZED_MUTATIONS", out)

    def test_wallhop_matching_prior_inventory_confirms_no_mutation(self):
        self.state["wallhop_containers"] = ["abc sha256:w1 wallhop-reader"]
        self.state["wallhop_networks"] = ["net1 wallhop_private"]
        _, first = self.run_preflight()
        digest = first["WALLHOP_INVENTORY_SHA256"]
        code, out = self.run_preflight(extra_env={"NEWSFLUX_WALLHOP_EXPECTED_SHA256": digest})
        self.assertEqual(code, 0, out)
        self.assertEqual(out["WALLHOP_UNAUTHORIZED_MUTATIONS"], "0")
        self.assertEqual(out["WALLHOP_INTEGRITY"], "MATCHES_PRIOR_INVENTORY")
        self.state["wallhop_containers"] = ["def sha256:w2 wallhop-reader"]
        out = self.assert_hold("WALLHOP_INTEGRITY", "CHANGED_SINCE_PRIOR_INVENTORY",
                               extra_env={"NEWSFLUX_WALLHOP_EXPECTED_SHA256": digest})
        self.assertEqual(out["WALLHOP_UNAUTHORIZED_MUTATIONS"], "DETECTED")

    def test_malformed_expected_wallhop_digest_is_hold(self):
        self.assert_hold("WALLHOP_INTEGRITY", "EXPECTED_DIGEST_MALFORMED",
                         extra_env={"NEWSFLUX_WALLHOP_EXPECTED_SHA256": "not-a-digest"})

    # --- read-only guarantees --------------------------------------------------------------

    def test_script_contains_no_mutating_command(self):
        text = SCRIPT.read_text()
        code_lines = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
        for pattern in (r"\b(rm|mv|cp|chmod|chown|touch|mkdir|tee|truncate|dd)\b\s", r"\bcurl\b", r"\bwget\b",
                        r"caddy reload", r"open\([^()]*(\([^()]*\)[^()]*)*,\s*['\"][^'\"]*[wax+]", r"write_(text|bytes)\(",
                        r"\"(run|rm|stop|start|restart|kill|compose|pull|build|cp|create|update)\""):
            self.assertIsNone(re.search(pattern, code_lines), pattern)
        self.assertIn("READ_ONLY_DOCKER", text)


if __name__ == "__main__":
    unittest.main()
