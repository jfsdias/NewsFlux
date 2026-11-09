from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ops" / "article-intel-a2-readonly-gap-collector.sh"


class A2ReadOnlyGapCollectorTests(unittest.TestCase):
    def _install_success_path_tools(
        self,
        fake_bin: Path,
        log_path: Path,
        include_nft: bool,
    ) -> None:
        for utility in ("bash", "awk", "tail", "sed", "python3"):
            executable = shutil.which(utility, path="/usr/bin:/bin")
            self.assertIsNotNone(executable, f"required test utility unavailable: {utility}")
            (fake_bin / utility).symlink_to(executable)

        docker_body = r'''#!/bin/sh
printf 'docker %s\n' "$*" >> "$MOCK_COMMAND_LOG"
case "${1:-}" in
  context)
    case "${2:-}" in
      show) printf '%s\n' 'default' ;;
      inspect) printf '%s\n' 'unix:///var/run/docker.sock' ;;
      *) exit 2 ;;
    esac ;;
  info)
    if [ "${3:-}" = '{{.DockerRootDir}}' ]; then
      printf '%s\n' '/dockerdata/docker'
    else
      printf '%s\n' 'DockerRootDir=/dockerdata/docker OperatingSystem=Debian GNU/Linux 13 Architecture=x86_64 CPUs=12 MemoryBytes=32212254720'
    fi ;;
  version) printf '%s\n' '29.9.3' ;;
  inspect)
    if [ "${2:-}" = '--format' ]; then
      template=${3:-}
      container=${4:-unknown}
    elif [ "${3:-}" = '--format' ]; then
      container=${2:-unknown}
      template=${4:-}
    else
      exit 0
    fi
    case "$template" in
      '{{.Config.Image}}') printf '%s\n' 'newsflux-local:1fdfd08dd201' ;;
      '{{.Image}}') printf '%s\n' 'sha256:4ec48a15cd547aaa63bbbe40d910d93d3efc1d0c78f3fcbeb77ee1ae950fc641' ;;
      *) printf 'container=/%s image=synthetic state=running published_ports=none\n' "$container" ;;
    esac ;;
  network)
    if [ "${2:-}" != 'inspect' ]; then exit 2; fi
    if [ "${3:-}" = '--format' ]; then
      printf 'network=%s driver=bridge internal=false ipam=synthetic-endpoints\n' "${5:-unknown}"
    fi ;;
  *) exit 2 ;;
esac
'''
        self._write_fake_command(fake_bin, "docker", docker_body)

        for utility, version in (("iptables", "iptables v1.8.10 (nf_tables)"), ("ip6tables", "ip6tables v1.8.10 (nf_tables)")):
            body = (
                "#!/bin/sh\n"
                f'printf "%s\\n" "{utility} $*" >> "$MOCK_COMMAND_LOG"\n'
                f"printf '%s\\n' '{version}'\n"
            )
            self._write_fake_command(fake_bin, utility, body)

        firewall_save_body = r'''#!/bin/sh
printf '%s %s\n' "${0##*/}" "$*" >> "$MOCK_COMMAND_LOG"
if [ "${MOCK_FAIL_FIREWALL_SAVE:-}" = "${0##*/}:$2" ]; then
  exit 1
fi
printf '%s\n' '*filter' ':INPUT ACCEPT [0:0]' '-A INPUT -m comment --comment "SYNTHETIC_IPTABLES_COMMENT_SENTINEL" -j ACCEPT' '-A INPUT -j LOG --log-prefix "SYNTHETIC_IPTABLES_LOG_SENTINEL"' 'COMMIT'
'''
        self._write_fake_command(fake_bin, "iptables-save", firewall_save_body)
        self._write_fake_command(fake_bin, "ip6tables-save", firewall_save_body)

        self._write_fake_command(
            fake_bin,
            "vmstat",
            "#!/bin/sh\nprintf '%s\\n' 'procs memory swap io system cpu' 'sample 1' 'sample 2' 'sample 3' 'sample 4'\n",
        )
        self._write_fake_command(fake_bin, "swapon", "#!/bin/sh\nexit 0\n")
        self._write_fake_command(
            fake_bin,
            "findmnt",
            "#!/bin/sh\nprintf '%s\\n' '/dockerdata /dev/synthetic ext4 rw,relatime'\n",
        )
        self._write_fake_command(
            fake_bin,
            "df",
            "#!/bin/sh\nprintf '%s\\n' 'Filesystem Type 1K-blocks Used Available Use% Mounted on' 'synthetic ext4 1000 100 900 10% /dockerdata'\n",
        )

        if include_nft:
            nft_body = r'''#!/bin/sh
printf 'nft %s\n' "$*" >> "$MOCK_COMMAND_LOG"
case "$*" in
  --version) printf '%s\n' 'nftables v1.1.1' ;;
  '-j list ruleset') printf '%s\n' '{"nftables":[{"table":{"family":"inet","name":"filter","comment":"SYNTHETIC_NFT_COMMENT_SENTINEL"}},{"chain":{"family":"inet","table":"filter","name":"forward","hook":"forward","comment":"SYNTHETIC_NFT_CHAIN_SENTINEL"}},{"rule":{"family":"inet","table":"filter","chain":"forward","expr":[{"log":{"prefix":"SYNTHETIC_NFT_LOG_SENTINEL","group":3}},{"accept":null}],"comment":"SYNTHETIC_NFT_RULE_SENTINEL"}},{"rule":{"family":"inet","table":"filter","chain":"forward","expr":[{"drop":null}],"comment":"SYNTHETIC_NFT_SECOND_RULE_SENTINEL"}},{"chain":{"family":"inet","table":"unrelated","name":"other"}},{"rule":{"family":"inet","table":"unrelated","chain":"other","expr":[{"accept":null}]}}]}' ;;
  *) exit 2 ;;
esac
'''
            self._write_fake_command(fake_bin, "nft", nft_body)

    @staticmethod
    def _write_fake_command(directory: Path, name: str, source: str) -> None:
        executable = directory / name
        executable.write_text(source, encoding="utf-8")
        executable.chmod(0o755)

    def _run_success_path(
        self,
        include_nft: bool,
        fail_firewall_save: str | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], list[str]]:
        temp_context = tempfile.TemporaryDirectory()
        self.addCleanup(temp_context.cleanup)
        temp = Path(temp_context.name)
        fake_bin = temp / "bin"
        fake_bin.mkdir()
        log_path = temp / "command-calls.txt"
        self._install_success_path_tools(fake_bin, log_path, include_nft)
        test_env = {"PATH": str(fake_bin), "MOCK_COMMAND_LOG": str(log_path)}
        if fail_firewall_save is not None:
            test_env["MOCK_FAIL_FIREWALL_SAVE"] = fail_firewall_save
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            check=False,
            capture_output=True,
            text=True,
            env=test_env,
        )
        calls = log_path.read_text(encoding="utf-8").splitlines()
        return result, calls

    def test_success_path_with_nft_reaches_read_only_mutation_guard(self) -> None:
        result, calls = self._run_success_path(include_nft=True)
        output = result.stdout + result.stderr

        self.assertEqual(result.returncode, 3, output)
        self.assertIn("TARGET_GUARD=PASS_OPERATOR_SUPPLIED_OMV_IDENTITY", output)
        self.assertIn("iptables_version=iptables v1.8.10 (nf_tables)", output)
        self.assertIn("ip6tables_version=ip6tables v1.8.10 (nf_tables)", output)
        self.assertIn("nft_version=nftables v1.1.1", output)
        self.assertIn("nft_object=", output)
        self.assertIn("output_review=before sharing, redact sensitive internal addresses", output)
        self.assertIn("[COLLECTOR_COMPLETENESS]", output)
        self.assertIn("COLLECTOR_COMPLETENESS=PARTIAL", output)
        self.assertIn("SECTION_UNAVAILABLE=operator_input:miniflux_https_base_url", output)
        self.assertIn("SECTION_UNAVAILABLE=operator_input:api_https_route", output)
        self.assertIn("SECTION_UNAVAILABLE=operator_input:backup_target", output)
        self.assertIn("[READ_ONLY_COMMAND_AUDIT]", output)
        self.assertIn("READ_ONLY_COMMAND_AUDIT=STATIC_SOURCE_AND_SYNTHETIC_INVOCATION_TESTED", output)
        self.assertIn("[MUTATION_GUARD]", output)
        self.assertIn("MUTATION_GUARD=DECLARATIVE_ONLY_NOT_A_RUNTIME_COUNTER", output)
        self.assertNotIn("SYNTHETIC_NFT_", output)
        self.assertNotIn("SYNTHETIC_IPTABLES_", output)
        nft_lines = [line.removeprefix("nft_object=") for line in output.splitlines() if line.startswith("nft_object=")]
        self.assertEqual(len(nft_lines), 3, output)
        nft_rules = [json.loads(line)["rule"] for line in nft_lines if "\"rule\"" in line]
        self.assertEqual(len(nft_rules), 2, nft_lines)
        self.assertEqual(nft_rules[0]["expr"], [{"log": {"group": 3}}, {"accept": None}])
        self.assertEqual(nft_rules[1]["expr"], [{"drop": None}])
        self.assertNotIn("unrelated", output)
        self.assertIn("iptables-save -t filter", calls)
        self.assertIn("ip6tables-save -t nat", calls)
        self.assertIn("nft -j list ruleset", calls)
        self._assert_call_log_is_read_only(calls)

    def test_success_path_without_nft_reports_explicit_absence(self) -> None:
        result, calls = self._run_success_path(include_nft=False)
        output = result.stdout + result.stderr

        self.assertEqual(result.returncode, 3, output)
        self.assertIn("TARGET_GUARD=PASS_OPERATOR_SUPPLIED_OMV_IDENTITY", output)
        self.assertIn("[COLLECTOR_COMPLETENESS]", output)
        self.assertIn("COLLECTOR_COMPLETENESS=PARTIAL", output)
        self.assertIn("nft=UNAVAILABLE", output)
        self.assertIn("SECTION_UNAVAILABLE=firewall:nft", output)
        self.assertIn("MUTATION_GUARD=DECLARATIVE_ONLY_NOT_A_RUNTIME_COUNTER", output)
        self.assertNotIn("SYNTHETIC_NFT_", output)
        self.assertNotIn("SYNTHETIC_IPTABLES_", output)
        self.assertNotIn("nft --version", "\n".join(calls))
        self.assertNotIn("unbound variable", output)
        self._assert_call_log_is_read_only(calls)

    def _assert_call_log_is_read_only(self, calls: list[str]) -> None:
        mutation = re.compile(
            r"^(?:docker (?:compose )?(?:up|down|rm|run|create|exec|start|stop|restart|kill|pull|push|build|network (?:connect|disconnect|create|rm)|volume (?:create|rm))\b|(?:ip6?tables)\s+.*\s-[AIDFZNPXRC]\b|nft\s+(?:add|insert|delete|flush|replace)\b)",
            re.IGNORECASE,
        )
        self.assertTrue(calls)
        self.assertFalse([call for call in calls if mutation.search(call)])

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
            self.assertIn("COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED", result.stdout)
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
            self.assertIn("TARGET_GUARD=BLOCKED_DOCKER_ENV_OVERRIDE_SET (values suppressed)", result.stdout)
            self.assertIn("COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED", result.stdout)
            self.assertFalse(log_path.exists())
            self.assertNotIn("suppressed-test-value", result.stdout + result.stderr)

    def test_docker_config_override_blocks_before_invoking_docker(self) -> None:
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
                    "DOCKER_CONFIG": "suppressed-docker-config-sentinel",
                },
            )

            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn("TARGET_GUARD=BLOCKED_DOCKER_ENV_OVERRIDE_SET (values suppressed)", result.stdout)
            self.assertIn("COLLECTOR_COMPLETENESS=NOT_STARTED_TARGET_GUARD_BLOCKED", result.stdout)
            self.assertFalse(log_path.exists(), "Docker must not be inspected when DOCKER_CONFIG is set")
            self.assertNotIn("suppressed-docker-config-sentinel", result.stdout + result.stderr)

    def test_unavailable_firewall_section_marks_collection_partial(self) -> None:
        result, calls = self._run_success_path(include_nft=True, fail_firewall_save="ip6tables-save:nat")
        output = result.stdout + result.stderr

        self.assertEqual(result.returncode, 3, output)
        self.assertIn("TARGET_GUARD=PASS_OPERATOR_SUPPLIED_OMV_IDENTITY", output)
        self.assertIn("SECTION_UNAVAILABLE=firewall:ip6tables:nat", output)
        self.assertIn("COLLECTOR_COMPLETENESS=PARTIAL", output)
        self.assertNotIn("ip6tables:nat:*filter", output)
        self.assertIn("[READ_ONLY_COMMAND_AUDIT]", output)
        self.assertIn("[MUTATION_GUARD]", output)
        self._assert_call_log_is_read_only(calls)

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
        self.assertIn("if [[ ${DOCKER_HOST+x} || ${DOCKER_CONTEXT+x} || ${DOCKER_CONFIG+x} ]]; then", source)
        self.assertNotIn("docker_mutations=0", source)
        self.assertNotIn("firewall_mutations=0", source)
        self.assertIn("READ_ONLY_COMMAND_AUDIT_SCOPE=runtime_syscalls_not_traced_by_collector", source)

    def test_nft_report_includes_relevant_table_and_excludes_other_tables(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        marker = "if python3 -c '\n"
        self.assertIn(marker, source)
        parser = source.split(marker, 1)[1].split("\n' <<< \"$nft_snapshot\"; then", 1)[0]
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
