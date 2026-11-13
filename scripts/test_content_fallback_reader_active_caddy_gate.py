from __future__ import annotations

import hashlib
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("content-fallback-reader-active-caddy-gate.py")
SPEC = importlib.util.spec_from_file_location("active_caddy_gate", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class ActiveCaddyGateTests(unittest.TestCase):
    def test_sha256_matches_only_exact_input(self) -> None:
        payload = b":2000 {\n\trespond ok\n}\n"
        digest = hashlib.sha256(payload).hexdigest()
        self.assertEqual(GATE.sha256_bytes(payload), digest)
        self.assertTrue(GATE.sha256_matches(payload, digest))
        self.assertFalse(GATE.sha256_matches(payload, "0" * 64))

    def test_run_gate_rejects_mismatched_hash_before_running_caddy(self) -> None:
        with TemporaryDirectory() as temp:
            config = Path(temp) / "Caddyfile"
            config.write_text(":2000 {\n\trespond synthetic\n}\n", encoding="utf-8")
            with patch.object(GATE, "_run_caddy") as caddy:
                with self.assertRaisesRegex(GATE.GateError, "ACTIVE_CADDY_SHA256_MISMATCH"):
                    GATE.run_gate(config, "0" * 64, ":2000")
                caddy.assert_not_called()

    def test_import_is_inserted_inside_matching_site_without_touching_other_sites(self) -> None:
        source = (
            "# :2000 { this is only a comment\n"
            ":2000 {\n"
            "  @assets path /assets/*\n"
            "  handle /assets/* {\n"
            "    header X-Template {http.request.host}\n"
            "  }\n"
            "}\n"
            "newsflux.home:2000 {\n"
            "  respond ok\n"
            "}\n"
            ":2010 {\n"
            "  respond untouched\n"
            "}\n"
        )
        merged = GATE.inject_import(source, ":2000", "/work/reader-recovery.caddy")
        self.assertEqual(merged.count("import /work/reader-recovery.caddy"), 2)
        self.assertEqual(merged.count("respond untouched"), 1)
        self.assertLess(merged.index("import /work/reader-recovery.caddy"), merged.index("respond ok"))
        self.assertIn("header X-Template {http.request.host}", merged)

    def test_import_fails_closed_when_site_is_absent(self) -> None:
        with self.assertRaises(GATE.GateError):
            GATE.inject_import(":80 {\n respond ok\n}\n", ":2000", "/work/reader.caddy")

    def test_baseline_routes_and_required_route_families_are_preserved(self) -> None:
        baseline = {
            "apps": {
                "http": {
                    "servers": {
                        "srv0": {
                            "routes": [
                                {"match": [{"path": ["/api/summary/*"]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "summary-api:8080"}]}]},
                                {"match": [{"path": ["/api/story-ranker/*"]}], "handle": [{"handler": "reverse_proxy", "upstreams": [{"dial": "ranker:8080"}]}]},
                                {"handle": [{"handler": "file_server", "root": "/srv/www"}]},
                                {"handle": [{"handler": "rewrite", "uri": "/index.html"}, {"handler": "file_server", "root": "/srv/www"}]},
                            ]
                        }
                    }
                }
            }
        }
        candidate = json.loads(json.dumps(baseline))
        candidate["apps"]["http"]["servers"]["srv0"]["routes"].insert(
            0,
            {"match": [{"path": ["/api/content-fallback/reader/v1/entries/*"]}], "handle": [{"handler": "reverse_proxy"}]},
        )
        result = GATE.compare_route_parity(baseline, candidate)
        self.assertTrue(result["routes_preserved"])
        self.assertTrue(result["summary"])
        self.assertTrue(result["story"])
        self.assertTrue(result["static"])
        self.assertTrue(result["spa"])

    def test_reader_route_removal_keeps_sibling_routes_inside_caddy_subroute_group(self) -> None:
        baseline = {
            "apps": {
                "http": {
                    "servers": {
                        "srv0": {
                            "routes": [
                                {
                                    "handle": [
                                        {
                                            "handler": "subroute",
                                            "routes": [
                                                {"group": "group0", "match": [{"path": ["/api/summary/*"]}], "handle": [{"handler": "reverse_proxy"}]},
                                                {"group": "group1", "match": [{"path": ["/api/story-ranker/*"]}], "handle": [{"handler": "reverse_proxy"}]},
                                            ],
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        }
        candidate = json.loads(json.dumps(baseline))
        candidate["apps"]["http"]["servers"]["srv0"]["routes"][0]["handle"][0]["routes"].append(
            {"group": "group0", "match": [{"path_regexp": {"name": "reader", "pattern": "^/api/content-fallback/reader/entries/1/recover$"}}], "handle": [{"handler": "reverse_proxy"}]}
        )
        candidate["apps"]["http"]["servers"]["srv0"]["routes"][0]["handle"][0]["routes"][0]["group"] = "group1"
        candidate["apps"]["http"]["servers"]["srv0"]["routes"][0]["handle"][0]["routes"][1]["group"] = "group2"
        result = GATE.compare_route_parity(baseline, candidate)
        self.assertTrue(result["routes_preserved"])
        self.assertTrue(result["summary"])
        self.assertTrue(result["story"])

    def test_configuration_placeholders_are_replaced_only_with_synthetic_values(self) -> None:
        env = GATE._synthetic_env(
            "{$MINIFLUX_API_KEY} {$PUBLIC_HOST} {$SMTP_PORT} {env.READER_TOKEN}",
            "192.0.2.45",
        )
        self.assertEqual(env["NEWSFLUX_PILOT_TRUSTED_PROXY_IP"], "192.0.2.45")
        self.assertNotIn("API_KEY", env["MINIFLUX_API_KEY"])
        self.assertEqual(env["PUBLIC_HOST"], "newsflux.test")
        self.assertEqual(env["SMTP_PORT"], "2000")
        self.assertEqual(env["READER_TOKEN"], "synthetic-r4-value")

    def test_caddy_errors_are_reported_without_adapter_output(self) -> None:
        failed = GATE.subprocess.CompletedProcess(
            args=["docker"], returncode=1, stdout="private config", stderr="synthetic secret"
        )
        with patch.object(GATE.subprocess, "run", return_value=failed):
            with self.assertRaises(GATE.GateError) as error:
                GATE._adapt(Path("/private/tmp"), "candidate.Caddyfile", {})
        self.assertNotIn("synthetic secret", str(error.exception))
        self.assertNotIn("private config", str(error.exception))


if __name__ == "__main__":
    unittest.main()
