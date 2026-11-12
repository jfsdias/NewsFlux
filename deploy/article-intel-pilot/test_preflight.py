import importlib.util
import os
import stat
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("pilot_preflight", Path(__file__).with_name("preflight.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def test_rejects_unsafe_docker_overrides_before_running_commands(self):
        with patch.dict(os.environ, {"DOCKER_HOST": "unix:///wrong"}, clear=True), patch.object(preflight, "run") as run:
            with self.assertRaises(SystemExit):
                preflight.main()
            run.assert_not_called()

    def test_rejects_non_full_sha_before_running_commands(self):
        with patch.dict(os.environ, {"NEWSFLUX_PILOT_APPROVED_SHA": "abc123"}, clear=True), patch.object(preflight, "run") as run:
            with self.assertRaises(SystemExit):
                preflight.main()
            run.assert_not_called()

    def test_rejects_dirty_checkout_before_docker_inspection(self):
        sha = "a" * 40
        env = {
            "NEWSFLUX_PILOT_APPROVED_SHA": sha,
            "NEWSFLUX_PILOT_PREVIOUS_CONFIG_SHA256": "b" * 64,
        }
        with patch.dict(os.environ, env, clear=True), patch.object(preflight, "run", side_effect=[sha, " M file"]) as run:
            with self.assertRaises(SystemExit):
                preflight.main()
            self.assertEqual(run.call_count, 2)

    def test_requires_previous_config_fingerprint_before_running_commands(self):
        sha = "a" * 40
        with patch.dict(os.environ, {"NEWSFLUX_PILOT_APPROVED_SHA": sha}, clear=True), patch.object(preflight, "run") as run:
            with self.assertRaises(SystemExit):
                preflight.main()
            run.assert_not_called()

    def test_rejects_previous_config_drift_in_the_running_container(self):
        sha = "a" * 40
        image_id = "sha256:" + "b" * 64
        expected_config = "c" * 64
        env = {
            "NEWSFLUX_PILOT_APPROVED_SHA": sha,
            "NEWSFLUX_PILOT_PREVIOUS_CONFIG_SHA256": expected_config,
            "NEWSFLUX_PILOT_WEB_IMAGE": "reader@sha256:" + "d" * 64,
            "NEWSFLUX_PILOT_SUMMARY_IMAGE": "summary@sha256:" + "e" * 64,
            "NEWSFLUX_PILOT_TRUSTED_PROXY_IP": "172.30.0.2",
            "NEWSFLUX_PILOT_CADDY_IP": "172.30.1.2",
            "NEWSFLUX_PILOT_PRIVATE_SUBNET": "172.30.1.0/24",
            "NEWSFLUX_PILOT_PRIVATE_ENV_FILE": "/tmp/private.env",
            "NEWSFLUX_PILOT_KEY_FILE": "/tmp/key",
            "NEWSFLUX_PILOT_LEDGER_DIR": "/tmp/ledger",
            "NEWSFLUX_PILOT_PREVIOUS_CONTAINER": "newsflux",
            "NEWSFLUX_PILOT_PREVIOUS_IMAGE_ID": image_id,
        }
        commands = [
            sha,
            "",
            "default",
            sha,
            sha,
            image_id,
            image_id,
            "f" * 64 + "  /etc/caddy/Caddyfile",
        ]
        directory_info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=10001)
        with (
            patch.dict(os.environ, env, clear=True),
            patch.object(preflight, "run", side_effect=commands) as run,
            patch.object(preflight, "private_file"),
            patch.object(preflight.Path, "lstat", return_value=directory_info),
        ):
            with self.assertRaises(SystemExit):
                preflight.main()
        self.assertEqual(run.call_args.args, ("docker", "exec", "newsflux", "sha256sum", "/etc/caddy/Caddyfile"))


if __name__ == "__main__":
    unittest.main()
