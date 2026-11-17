"""Read-only operator preflight: classifications only, no secrets, no writes."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from services.article_intel_summary.admin_settings import ManagedSettingsStore
from services.article_intel_summary.operator_preflight_ai_settings import run
from services.article_intel_summary.tests.test_dynamic_catalog import FakeGateway, model_info

KEY = "sk-synthetic-preflight-key-abcdefghij"


class OperatorPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.key = Path(self.tmp.name) / "key"
        self.key.write_text(KEY, encoding="ascii")
        self.key.chmod(0o600)
        self.root = Path(self.tmp.name) / "managed"
        self.gateway = FakeGateway(listed=("m1",), infos=[model_info("m1")])
        self.env = {
            "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(self.key),
            "NEWSFLUX_AI_LITELLM_BASE_URL": "https://gateway.example",
            "NEWSFLUX_AI_ADMIN_SETTINGS_DIR": str(self.root),
            "NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED": "true",
        }

    def factory(self, env):
        return ManagedSettingsStore(env, getter_factory=lambda *_: self.gateway)

    def test_bootstrap_ready_pass_without_writes_or_secret(self):
        code, lines = run(self.env, check_gateway=True, store_factory=self.factory)
        text = "\n".join(lines)
        self.assertEqual(code, 0, text)
        self.assertIn("KEY_SOURCE=BOOTSTRAP", lines)
        self.assertIn("MANAGED_DIR=ABSENT_CREATABLE", lines)
        self.assertIn("GATEWAY_DISCOVERY=PASS_MODELS_1", lines)
        self.assertIn("INFERENCE_ENABLED=OFF", lines)
        self.assertNotIn(KEY, text)
        self.assertNotIn(str(self.root), text)
        self.assertFalse(self.root.exists())

    def test_unsafe_dir_mode_is_hold(self):
        self.root.mkdir(mode=0o755)
        os.chmod(self.root, 0o755)
        code, lines = run(self.env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("MANAGED_DIR=UNSAFE_MODE", lines)
        self.assertIn("PREFLIGHT=HOLD", lines)

    def test_marker_without_record_is_hold_not_bootstrap(self):
        self.root.mkdir(mode=0o700)
        marker = self.root / "activated"
        marker.write_bytes(b"v1\n")
        marker.chmod(0o600)
        code, lines = run(self.env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("STORE=HOLD_CONFIG_UNAVAILABLE", lines)

    def test_missing_key_and_gateway_failure_are_hold(self):
        env = {**self.env, "NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE": str(Path(self.tmp.name) / "none")}
        code, lines = run(env, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("BOOTSTRAP_KEY_READABLE=NO", lines)
        self.assertIn("KEY_CONFIGURED=NO", lines)
        self.gateway.errors["/v1/models"] = RuntimeError(KEY)
        code, lines = run(self.env, check_gateway=True, store_factory=self.factory)
        self.assertEqual(code, 3)
        self.assertIn("GATEWAY_DISCOVERY=HOLD_KEY_UNVERIFIED", lines)
        self.assertNotIn(KEY, "\n".join(lines))


if __name__ == "__main__":
    unittest.main()
