"""ai-settings-readonly-preflight.sh: classifications only, no secrets, no writes, HOLD on doubt."""
from __future__ import annotations

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
STAGE1 = "56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6"
REPO = HERE.parent.parent
SECRET_PATH = "/run/secrets/newsflux-litellm-virtual-key"
ORIGIN = "https://news.private.example"

# Fake docker driven by a JSON state file: containers with env, user, mounts and exec answers.
FAKE_DOCKER = textwrap.dedent(r'''
    #!/usr/bin/env python3
    import json, os, sys
    state = json.load(open(os.environ["FAKE_STATE"]))
    open(os.environ["FAKE_LOG"], "a").write(" ".join(sys.argv[1:]) + "\n")
    a = sys.argv[1:]
    def ctr(name):
        return state["containers"].get(name)
    if a[0] == "ps":
        filters = [a[i + 1] for i, x in enumerate(a) if x == "--filter"]
        if any(f.endswith("=wallhop") or f == "name=wallhop" for f in filters):
            sys.exit(0)
        if any("service=summary-api" in f for f in filters) and "summary" in state["containers"]:
            print("summary"); sys.exit(0)
        sys.exit(0)
    if a[0] == "network":
        sys.exit(0)
    if a[0] == "image" and a[1] == "inspect":
        print(state["revision"]); sys.exit(0)
    if a[0] == "inspect" and len(a) == 2:
        sys.exit(0 if ctr(a[1]) is not None else 1)
    if a[0] == "inspect":
        fmt, name = a[2], a[3]
        c = ctr(name)
        if c is None: sys.exit(1)
        if ".Config.Env" in fmt: print("\n".join(f"{k}={v}" for k, v in c["env"].items())); sys.exit(0)
        if "Destination \"/data\"" in fmt: print(c.get("data_type", "")); sys.exit(0)
        if "/etc/caddy/Caddyfile" in fmt: print(c.get("caddy", "")); sys.exit(0)
        if fmt == "{{.Image}}": print("sha256:img-" + name); sys.exit(0)
        if ".Config.User" in fmt: print(c.get("user", "")); sys.exit(0)
        if "Health" in fmt: print("healthy"); sys.exit(0)
        if "PortBindings" in fmt: print(0); sys.exit(0)
        if "config_files" in fmt: print("/a.yaml,/b.yaml"); sys.exit(0)
        if "compose.service" in fmt: print("newsflux"); sys.exit(0)
        if ".State.Running" in fmt: print("true" if c.get("running", True) else "false"); sys.exit(0)
        sys.exit(1)
    if a[0] == "exec":
        name, cmd = a[1], " ".join(a[2:])
        c = ctr(name)
        if "stat -c" in cmd: print(c.get("data_stat", "")); sys.exit(0)
        if "newsflux-ai-settings" in cmd: print("ABSENT"); sys.exit(0)
        if "sha256sum /etc/caddy/Caddyfile" in cmd:
            import hashlib
            print(hashlib.sha256(open(c["caddy"], "rb").read()).hexdigest() + "  /etc/caddy/Caddyfile"); sys.exit(0)
        sys.exit(1)
    sys.exit(1)
''').lstrip()


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
        self.state = {
            "revision": "d54eda2bdb8bc5c3d1bd58d40236f48da762e852",
            "containers": {
                "summary": {
                    "user": "10001:10001", "data_type": "bind", "data_stat": "10001 700",
                    "env": {
                        "NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS": "1",
                        "NEWSFLUX_AI_ALLOWED_WEB_ORIGINS": ORIGIN,
                        "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": SECRET_PATH,
                        "NEWSFLUX_AI_INFERENCE_ENABLED": "false",
                    },
                },
                "newsflux": {"caddy": str(self.caddy), "env": {"NEWSFLUX_PILOT_TRUSTED_PROXY_IP": "172.18.0.9"}},
                "miniflux": {"env": {}}, "miniflux-db": {"env": {}},
            },
        }
        self.env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}",
                    "FAKE_STATE": str(self.state_file), "FAKE_LOG": str(self.log),
                    "NEWSFLUX_RELEASE_LOCK": str(root / "no.lock")}

    def run_preflight(self):
        self.state_file.write_text(json.dumps(self.state))
        before = sorted(p.name for p in Path(self.tmp.name).iterdir() if p.name != "docker.log")
        result = subprocess.run(["bash", str(SCRIPT)], env=self.env, capture_output=True, text=True)
        after = sorted(p.name for p in Path(self.tmp.name).iterdir() if p.name != "docker.log")
        self.assertEqual(before, after)  # nothing created
        out = result.stdout + result.stderr
        for secret in (SECRET_PATH, ORIGIN, "172.18.0.9", str(self.caddy)):
            self.assertNotIn(secret, out)
        return result.returncode, dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)

    def test_stage1_ready_host_passes_with_flags_off(self):
        code, out = self.run_preflight()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["CADDY_STATE"], "STAGE1_ACCEPTED_PRIOR")
        self.assertEqual(out["ACTIVE_CADDY_SHA256"], STAGE1)
        self.assertEqual(out["DATA_OWNER"], "UID10001")
        self.assertEqual(out["ADMIN_ALLOWLIST"], "CONFIGURED")
        self.assertEqual(out["ALLOWED_ORIGINS"], "HTTPS_COUNT_1")
        self.assertEqual(out["INFERENCE_ENABLED"], "OFF")
        self.assertEqual(out["ADMIN_CONFIG_WRITES_ENABLED"], "OFF")
        self.assertEqual(out["ENV_MODEL_POLICY"], "ABSENT_LEGACY")
        self.assertEqual(out["SECRET_PRINTED"], "NO")
        self.assertEqual(out["PREFLIGHT"], "PASS")

    def test_unknown_caddy_state_is_hold(self):
        self.caddy.write_bytes(self.caddy.read_bytes() + b"# edited\n")
        code, out = self.run_preflight()
        self.assertEqual(code, 3)
        self.assertEqual(out["CADDY_STATE"], "UNKNOWN_DRIFT")

    def test_wrong_data_owner_and_empty_allowlist_are_hold(self):
        self.state["containers"]["summary"]["data_stat"] = "0 755"
        del self.state["containers"]["summary"]["env"]["NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS"]
        code, out = self.run_preflight()
        self.assertEqual(code, 3)
        self.assertEqual(out["DATA_OWNER"], "NOT_10001")
        self.assertEqual(out["ADMIN_ALLOWLIST"], "EMPTY")

    def test_protected_service_down_is_hold(self):
        self.state["containers"]["miniflux"]["running"] = False
        code, out = self.run_preflight()
        self.assertEqual(code, 3)
        self.assertEqual(out["PROTECTED_miniflux"], "NOT_RUNNING")

    def test_symlinked_caddy_mount_is_hold(self):
        link = self.caddy.with_name("link")
        link.symlink_to(self.caddy)
        self.state["containers"]["newsflux"]["caddy"] = str(link)
        code, out = self.run_preflight()
        self.assertEqual(code, 3)
        self.assertEqual(out["CADDYFILE_MOUNT"], "SYMLINK")

    def test_script_contains_no_mutating_command(self):
        text = SCRIPT.read_text()
        body = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
        for pattern in (r"docker (run|rm|stop|start|restart|kill|compose|pull|build|cp|network (create|rm))",
                        r"\brm\b", r"\bmv\b", r"\bcp\b", r"\bchmod\b", r"\bchown\b", r"\btee\b", r"curl", r"wget",
                        r"caddy reload", r">\s*[^&/]"):
            self.assertIsNone(re.search(pattern, body), pattern)
        docker_calls = self.log.read_text() if self.log.exists() else ""
        self.assertNotIn("run ", docker_calls)


if __name__ == "__main__":
    unittest.main()
