from __future__ import annotations

import json
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ops" / "article-intel-a2-readonly-gap-collector.sh"


class A2ReadOnlyGapCollectorTests(unittest.TestCase):
    def test_wrong_docker_target_stops_before_network_or_firewall_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            fake_bin = temp / "bin"
            fake_bin.mkdir()
            log_path = temp / "docker-calls.txt"
            fake_docker = fake_bin / "docker"
            fake_docker.write_text(
                "#!/bin/sh\n"
                "printf '%s\\n' \"$*\" >> \"$MOCK_DOCKER_LOG\"\n"
                "case \"$1 $2 $3\" in\n"
                "  'context show ') echo default ;;\n"
                "  'context inspect default') echo unix:///var/run/docker.sock ;;\n"
                "  'info --format {{.DockerRootDir}}') echo /not/the/omv/docker/root ;;\n"
                "  'version --format {{.Server.Version}}') echo 29.9.3 ;;\n"
                "  'inspect newsflux --format')\n"
                "    case \"$4\" in\n"
                "      '{{.Config.Image}}') echo newsflux-local:1fdfd08dd201 ;;\n"
                "      '{{.Image}}') echo sha256:4ec48a15cd547aaa63bbbe40d910d93d3efc1d0c78f3fcbeb77ee1ae950fc641 ;;\n"
                "    esac ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                check=False,
                capture_output=True,
                text=True,
                env={
                    "PATH": f"{fake_bin}:/usr/bin:/bin",
                    "MOCK_DOCKER_LOG": str(log_path),
                },
            )

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("TARGET_GUARD=BLOCKED_TARGET_MISMATCH", result.stdout)
            self.assertIn("No further inventory was collected.", result.stdout)
            calls = log_path.read_text(encoding="utf-8").splitlines()
            self.assertTrue(
                all(
                    "inspect newsflux" in call
                    or call.startswith("context show")
                    or call.startswith("context inspect default")
                    or call.startswith("info ")
                    or call.startswith("version ")
                    for call in calls
                )
            )
            self.assertFalse(any("network inspect" in call for call in calls))

    def test_remote_docker_endpoint_stops_before_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            fake_bin = temp / "bin"
            fake_bin.mkdir()
            log_path = temp / "docker-calls.txt"
            fake_docker = fake_bin / "docker"
            fake_docker.write_text(
                "#!/bin/sh\n"
                "printf '%s\\n' \"$*\" >> \"$MOCK_DOCKER_LOG\"\n"
                "case \"$1 $2 $3\" in\n"
                "  'context show ') echo default ;;\n"
                "  'context inspect default') echo tcp://192.0.2.10:2376 ;;\n"
                "  'info --format {{.DockerRootDir}}') echo /dockerdata/docker ;;\n"
                "  'version --format {{.Server.Version}}') echo 29.9.3 ;;\n"
                "  'inspect newsflux --format')\n"
                "    case \"$4\" in\n"
                "      '{{.Config.Image}}') echo newsflux-local:1fdfd08dd201 ;;\n"
                "      '{{.Image}}') echo sha256:4ec48a15cd547aaa63bbbe40d910d93d3efc1d0c78f3fcbeb77ee1ae950fc641 ;;\n"
                "    esac ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                check=False,
                capture_output=True,
                text=True,
                env={"PATH": f"{fake_bin}:/usr/bin:/bin", "MOCK_DOCKER_LOG": str(log_path)},
            )

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("TARGET_GUARD=BLOCKED_TARGET_MISMATCH", result.stdout)
            self.assertIn("observed_endpoint=tcp://192.0.2.10:2376", result.stdout)
            calls = log_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(calls), 6)
            self.assertFalse(any("network inspect" in call for call in calls))

    def test_docker_endpoint_override_blocks_before_invoking_docker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            fake_bin = temp / "bin"
            fake_bin.mkdir()
            log_path = temp / "docker-calls.txt"
            fake_docker = fake_bin / "docker"
            fake_docker.write_text(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MOCK_DOCKER_LOG\"\n",
                encoding="utf-8",
            )
            fake_docker.chmod(0o755)
            result = subprocess.run(
                ["bash", str(SCRIPT)],
                check=False,
                capture_output=True,
                text=True,
                env={
                    "PATH": f"{fake_bin}:/usr/bin:/bin",
                    "MOCK_DOCKER_LOG": str(log_path),
                    "DOCKER_HOST": "suppressed-test-value",
                },
            )

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("TARGET_GUARD=BLOCKED_DOCKER_OVERRIDE_SET (value suppressed)", result.stdout)
            self.assertFalse(log_path.exists())
            self.assertNotIn("suppressed-test-value", result.stdout + result.stderr)

    def test_script_contains_no_known_mutating_docker_or_firewall_commands(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        forbidden = (
            r"\bdocker\s+(?:compose\s+)?(?:up|down|rm|run|create|exec|start|stop|restart|kill|pull|push|build|network\s+(?:connect|disconnect|create|rm)|volume\s+(?:create|rm))\b",
            r"\b(?:iptables|ip6tables)\b[^\n]*(?:\s-[AIDFZNPXRC]\s)",
            r"\bnft\s+(?:add|insert|delete|flush|replace)\b",
            r"\b(?:curl|wget)\b",
        )
        for pattern in forbidden:
            self.assertIsNone(re.search(pattern, source, re.IGNORECASE), pattern)
        self.assertNotIn(".Config.Env", source)
        self.assertIn("docker_endpoint", source)
        self.assertIn("selected_tables.add", source)
        self.assertIn('print("nft_object=" + json.dumps({kind: clean(value)}, sort_keys=True))', source)

    def test_nft_report_includes_relevant_table_and_excludes_other_tables(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        marker = "nft -j list ruleset 2>/dev/null | python3 -c '\n"
        self.assertIn(marker, source)
        parser = source.split(marker, 1)[1].split("\n' 2>/dev/null || out", 1)[0]
        fixture = {
            "nftables": [
                {
                    "chain": {
                        "family": "inet",
                        "table": "filter",
                        "name": "forward",
                        "type": "filter",
                        "hook": "forward",
                        "prio": 0,
                        "policy": "accept",
                    }
                },
                {"chain": {"family": "inet", "table": "filter", "name": "policy_custom"}},
                {"chain": {"family": "inet", "table": "other", "name": "unrelated"}},
                {"rule": {"family": "inet", "table": "filter", "chain": "forward", "expr": [{"jump": {"target": "policy_custom"}}]}},
                {"rule": {"family": "inet", "table": "filter", "chain": "policy_custom", "expr": [{"drop": None}]}},
                {"rule": {"family": "inet", "table": "other", "chain": "unrelated", "expr": [{"accept": None}]}},
            ]
        }
        result = subprocess.run(
            ["python3", "-c", parser],
            input=json.dumps(fixture),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"name": "policy_custom"', result.stdout)
        self.assertIn('"chain": "policy_custom"', result.stdout)
        self.assertNotIn('"name": "unrelated"', result.stdout)


if __name__ == "__main__":
    unittest.main()
