"""R4.1: the FULL read-only preflight against the EXACT Summary image, plus code-root safety.

Complements test-preflight-backend-check-image.sh (which runs the extracted check string): here the real
ai-settings-readonly-preflight.sh is executed end to end against a disposable Summary container.

Runs only when RELEASE_DOCKER_TESTS=1. Builds services/article_intel_summary/Dockerfile exactly as the
pilot-image workflow does (``docker build -f services/article_intel_summary/Dockerfile --build-arg
SOURCE_COMMIT=<sha> .``), or reuses NEWSFLUX_SUMMARY_TEST_IMAGE when it is set to such an image. Every
container is disposable (``--network none``, synthetic origins, label ``nfr41=<run id>``) and removed
afterwards. The real ``ai-settings-readonly-preflight.sh`` is executed against the real Docker daemon, so
the backend check runs exactly as on the host: ``docker exec <summary> python -I -c BACKEND_ORIGIN_CHECK``.
No production host, credential, article or provider is involved.
"""
from __future__ import annotations

import ast
import os
import re
import secrets
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCRIPT = HERE / "ai-settings-readonly-preflight.sh"


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], check=check, capture_output=True, text=True, timeout=600)


def backend_check_source() -> str:
    text = SCRIPT.read_text(encoding="utf-8")
    match = re.search(r"^BACKEND_ORIGIN_CHECK = (\(.*?\n\))", text, re.S | re.M)
    if match is None:
        raise AssertionError("BACKEND_ORIGIN_CHECK not found in the preflight script")
    return ast.literal_eval(match.group(1))


@unittest.skipUnless(os.environ.get("RELEASE_DOCKER_TESTS") == "1", "set RELEASE_DOCKER_TESTS=1 to run the exact-image check")
class ExactSummaryImageOriginCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.run_id = f"nfr41-{secrets.token_hex(4)}"
        image = os.environ.get("NEWSFLUX_SUMMARY_TEST_IMAGE")
        if not image:
            sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, check=True, capture_output=True, text=True).stdout.strip()
            image = f"{cls.run_id}-summary:{sha[:12]}"
            build = ["build", "-q", "-f", "services/article_intel_summary/Dockerfile", "--build-arg", f"SOURCE_COMMIT={sha}", "-t", image]
            if os.environ.get("NEWSFLUX_TEST_BUILD_NETWORK"):
                build += ["--network", os.environ["NEWSFLUX_TEST_BUILD_NETWORK"]]
            subprocess.run(["docker", *build, "."], cwd=REPO, check=True, capture_output=True, text=True, timeout=900)
            cls.built = image
        else:
            cls.built = None
        cls.image = image
        inspect = docker("image", "inspect", "-f", "{{.Config.User}} {{.Config.WorkingDir}}", image).stdout.split()
        assert inspect == ["10001:10001", "/app"], inspect

    @classmethod
    def tearDownClass(cls) -> None:
        ids = docker("ps", "-aq", "--filter", f"label=nfr41={cls.run_id}").stdout.split()
        if ids:
            docker("rm", "-f", "-v", *ids)
        if cls.built:
            docker("image", "rm", "-f", cls.built, check=False)
        left = docker("ps", "-aq", "--filter", f"label=nfr41={cls.run_id}").stdout.split()
        assert left == [], left

    def start(self, origins: str, project: str) -> str:
        return docker(
            "run", "-d", "--network", "none", "--label", f"nfr41={self.run_id}",
            "--label", f"com.docker.compose.project={project}", "--label", "com.docker.compose.service=summary-api",
            "-e", "NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.example",
            "-e", f"NEWSFLUX_AI_ALLOWED_WEB_ORIGINS={origins}",
            self.image,
        ).stdout.strip()

    def preflight(self, origins: str) -> dict[str, str]:
        project = f"{self.run_id}-{secrets.token_hex(3)}"
        cid = self.start(origins, project)
        self.addCleanup(docker, "rm", "-f", "-v", cid)
        env = {**os.environ, "NEWSFLUX_PROJECT": project, "NEWSFLUX_READER_CONTAINER": f"{project}-no-reader",
               "NEWSFLUX_PROTECTED_CONTAINERS": "", "NEWSFLUX_RELEASE_LOCK": f"/nonexistent/{project}.lock"}
        env.pop("PYTHONPATH", None)
        result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=300)
        out = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        self.assertIn(result.returncode, (0, 3), result.stdout + result.stderr)
        self.assertEqual(out.get("SUMMARY_CONTAINER"), "UNIQUE", out)
        self.assertEqual(out.get("WRITES_PERFORMED"), "NO", out)
        return out

    def test_real_preflight_backend_check_is_valid_in_exact_image(self):
        for origins in ("https://news.example", "https://news.example,https://news2.example:8443"):
            with self.subTest(origins=origins):
                self.assertEqual(self.preflight(origins).get("ALLOWED_ORIGINS_BACKEND"), "VALID")

    def test_real_preflight_backend_check_rejects_invalid_origins_in_exact_image(self):
        for origins in ("http://news.example", "https://news.example/path", "https://*.example",
                        "https://news.example,http://news.example"):
            with self.subTest(origins=origins):
                out = self.preflight(origins)
                self.assertEqual(out.get("ALLOWED_ORIGINS_BACKEND"), "INVALID", out)
                self.assertEqual(out.get("PREFLIGHT"), "HOLD", out)

    def test_writable_app_tree_in_exact_image_is_unsafe(self):
        cid = self.start("https://news.example", f"{self.run_id}-unsafe")
        self.addCleanup(docker, "rm", "-f", "-v", cid)
        for path in ("/app/services/article_intel_auth/config.py", "/app/services",
                     "/app/services/content_fallback/http_client.py"):
            with self.subTest(path=path):
                docker("exec", "-u", "0", cid, "chmod", "o+w", path)
                out = docker("exec", cid, "python", "-I", "-c", backend_check_source(), check=False)
                self.assertEqual(out.stdout.strip(), "UNSAFE_IMPORT_PATH", out.stdout + out.stderr)
                docker("exec", "-u", "0", cid, "chmod", "o-w", path)
        out = docker("exec", cid, "python", "-I", "-c", backend_check_source(), check=False)
        self.assertEqual(out.stdout.strip(), "VALID", out.stdout + out.stderr)
        self.assertEqual(docker("exec", cid, "sh", "-c", "find /app -name __pycache__ | wc -l").stdout.strip(), "0")


if __name__ == "__main__":
    unittest.main()
