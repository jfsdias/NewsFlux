from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_HARNESS = REPOSITORY_ROOT / "scripts" / "content_fallback_runtime_01.py"


class ContentFallbackRuntimeHarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        cls.result = subprocess.run(
            [sys.executable, str(RUNTIME_HARNESS)],
            cwd=REPOSITORY_ROOT,
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        cls.summary = None
        if cls.result.stdout.strip():
            try:
                cls.summary = json.loads(cls.result.stdout)
            except json.JSONDecodeError:
                cls.summary = None

    def test_loopback_runtime_rehearsal_passes(self) -> None:
        self.assertEqual(self.result.returncode, 0, self.result.stderr)
        self.assertIsInstance(self.summary, dict)
        self.assertEqual(self.summary.get("runtime_gate"), "PASS")
        self.assertEqual(self.summary.get("bind_host"), "127.0.0.1")
        self.assertEqual(self.summary.get("external_network_requests"), 0)

    def test_read_only_and_mock_provider_gates_pass(self) -> None:
        self.assertIsInstance(self.summary, dict)
        for gate in (
            "health_gate",
            "service_auth_gate",
            "miniflux_read_only_gate",
            "policy_gate",
            "wallhop_mock_gate",
            "content_validation_gate",
            "fallback_gate",
            "stale_entry_gate",
            "sqlite_persistence_gate",
            "secret_redaction_gate",
        ):
            with self.subTest(gate=gate):
                self.assertEqual(self.summary.get(gate), "PASS")
        self.assertEqual(self.summary.get("miniflux_write_requests"), 0)
        self.assertEqual(self.summary.get("wallhop_live_requests"), 0)

    def test_summary_does_not_print_credentials_urls_or_article_text(self) -> None:
        output = self.result.stdout + self.result.stderr
        self.assertNotIn("runtime-test-miniflux-token", output)
        self.assertNotIn("runtime-test-content-token", output)
        self.assertNotIn("news.example.test", output)
        self.assertNotIn("synthetic recovered paragraph", output)

    def test_container_image_has_local_healthcheck(self) -> None:
        dockerfile = (REPOSITORY_ROOT / "services" / "content_fallback" / "Dockerfile").read_text()
        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn("127.0.0.1:8790/healthz", dockerfile)


if __name__ == "__main__":
    unittest.main()
