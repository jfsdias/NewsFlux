import importlib.util
import os
import unittest
from pathlib import Path
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
        with patch.dict(os.environ, {"NEWSFLUX_PILOT_APPROVED_SHA": sha}, clear=True), patch.object(preflight, "run", side_effect=[sha, " M file"]) as run:
            with self.assertRaises(SystemExit):
                preflight.main()
            self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
