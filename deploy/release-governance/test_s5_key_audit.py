"""Operator S5 key audit tool. Synthetic gateway only; never operator evidence."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import stat
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import s5_key_audit

KEY = "sk-synthetic-virtual-key-000000000000"
ADMIN = "sk-synthetic-admin-viewer-000000000000"
ALIAS = "newsflux-s5-free"
NOW = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)


def fake_gateway(*, rows=None, model_data=None, fail=None):
    calls = []

    def request(method, path, body):
        calls.append((method, path, body))
        if fail and path in fail:
            raise s5_key_audit.AuditError(fail[path])
        if (method, path) == ("POST", "/v2/key/info"):
            return {"key": body["keys"], "info": rows if rows is not None else [{
                "models": [ALIAS], "max_budget": 0.5, "budget_duration": "30d", "spend": 0.0,
                "tpm_limit": 20000, "rpm_limit": 5, "blocked": None, "expires": None,
                "allowed_routes": ["llm_api_routes"], "user_id": "u-1", "metadata": {"secret": "x"},
            }]}
        if (method, path) == ("GET", "/model/info"):
            return {"data": model_data if model_data is not None else [
                {"model_name": ALIAS, "litellm_params": {"api_key": "provider-secret"},
                 "model_info": {"input_cost_per_token": 0.0, "output_cost_per_token": 0.0}},
                {"model_name": "mistral-small", "model_info": {"input_cost_per_token": 1e-7}},
            ]}
        raise AssertionError((method, path))

    return request, calls


class S5KeyAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.key_file = self.dir / "virtual.key"
        self.key_file.write_text(KEY + "\n")
        self.key_file.chmod(0o400)
        self.admin_file = self.dir / "admin.key"
        self.admin_file.write_text(ADMIN + "\n")
        self.admin_file.chmod(0o600)
        self.out = self.dir / "s5-key-attestation.json"

    def run_main(self, request, *extra):
        argv = [
            "--gateway-url", "https://litellm.example", "--admin-key-file", str(self.admin_file),
            "--virtual-key-file", str(self.key_file), "--alias", ALIAS, "--out", str(self.out), *extra,
        ]
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = s5_key_audit.main(argv, request=request, now=NOW)
        return code, buffer.getvalue()

    def test_writes_private_bound_attestation_with_only_policy_fields(self) -> None:
        request, calls = fake_gateway()
        code, output = self.run_main(request, "--confirm-provider-cost-zero", "--reference", "terms reviewed")
        self.assertEqual(code, 0, output)
        self.assertEqual(stat.S_IMODE(os.stat(self.out).st_mode), 0o600)
        document = json.loads(self.out.read_text())
        self.assertEqual(document["key_fingerprint"], s5_key_audit.key_fingerprint(KEY))
        self.assertEqual(set(document["key"]) - set(s5_key_audit.KEY_FIELDS), set())
        self.assertEqual(document["pricing"], [{"input_cost_per_token": 0.0, "output_cost_per_token": 0.0}])
        self.assertTrue(document["operator"]["provider_cost_zero_confirmed"])
        # Read-only: exactly one body lookup and one listing; the hash never goes into a URL.
        self.assertEqual([(m, p) for m, p, _ in calls], [("POST", "/v2/key/info"), ("GET", "/model/info")])
        self.assertTrue(all("?" not in p for _, p, _ in calls))

    def test_no_secret_reaches_terminal_or_file(self) -> None:
        request, _ = fake_gateway()
        _, output = self.run_main(request)
        text = output + self.out.read_text()
        for secret in (KEY, ADMIN, hashlib.sha256(KEY.encode()).hexdigest(), "provider-secret", "litellm.example", "u-1"):
            self.assertNotIn(secret, text)
        self.assertNotIn(s5_key_audit.key_fingerprint(KEY), output)

    def test_without_operator_confirmation_provider_cost_is_missing(self) -> None:
        request, _ = fake_gateway()
        code, output = self.run_main(request)
        self.assertEqual(code, 0)
        self.assertIn("PROVIDER_COST_CONFIRMATION=MISSING", output)
        self.assertFalse(json.loads(self.out.read_text())["operator"]["provider_cost_zero_confirmed"])

    def test_confirmation_requires_a_reference(self) -> None:
        request, _ = fake_gateway()
        code, output = self.run_main(request, "--confirm-provider-cost-zero")
        self.assertEqual(code, 1)
        self.assertIn("CODE=PROVIDER_CONFIRMATION_NEEDS_REFERENCE", output)
        self.assertFalse(self.out.exists())

    def test_key_not_found_ambiguous_or_gateway_errors_fail_without_output(self) -> None:
        for kwargs, code_text in (
            ({"rows": []}, "KEY_NOT_FOUND"),
            ({"rows": [{}, {}]}, "KEY_INFO_AMBIGUOUS"),
            ({"rows": "x"}, "KEY_INFO_MALFORMED"),
            ({"fail": {"/v2/key/info": "V2_KEY_INFO_HTTP_403"}}, "V2_KEY_INFO_HTTP_403"),
            ({"fail": {"/model/info": "MODEL_INFO_HTTP_401"}}, "MODEL_INFO_HTTP_401"),
        ):
            request, _ = fake_gateway(**kwargs)
            code, output = self.run_main(request)
            self.assertEqual(code, 1, kwargs)
            self.assertIn(f"CODE={code_text}", output)
            self.assertFalse(self.out.exists())

    def test_open_permissions_on_key_files_are_refused(self) -> None:
        self.key_file.chmod(0o644)
        request, calls = fake_gateway()
        code, output = self.run_main(request)
        self.assertEqual(code, 1)
        self.assertIn("CODE=VIRTUAL_KEY_FILE_PERMISSIONS_TOO_OPEN", output)
        self.assertEqual(calls, [])
        self.key_file.chmod(0o400)
        self.admin_file.chmod(0o640)
        with self.assertRaises(s5_key_audit.AuditError) as caught:
            s5_key_audit.read_private_file(str(self.admin_file), "ADMIN_KEY_FILE")
        self.assertEqual(str(caught.exception), "ADMIN_KEY_FILE_PERMISSIONS_TOO_OPEN")

    def test_gateway_url_must_be_a_plain_https_origin(self) -> None:
        for url in ("http://litellm.example", "https://user@litellm.example", "https://litellm.example/x", "https://litellm.example/?a=1"):
            with self.assertRaises(s5_key_audit.AuditError):
                s5_key_audit.http_requester(url, ADMIN, None)


if __name__ == "__main__":
    unittest.main()
