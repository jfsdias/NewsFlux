from __future__ import annotations

import base64
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from run import certificate_spki_sha256, fingerprint_mismatch_gate_passed


class CertificatePinTests(unittest.TestCase):
    def test_pin_matches_ephemeral_ca_subject_public_key_info(self) -> None:
        with tempfile.TemporaryDirectory(prefix="reader-wallhop-ca-pin-") as directory:
            cert_path = Path(directory) / "ca.crt"
            subprocess.run(
                [
                    "openssl",
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    str(Path(directory) / "ca.key"),
                    "-out",
                    str(cert_path),
                    "-days",
                    "1",
                    "-subj",
                    "/CN=Ephemeral test CA",
                ],
                capture_output=True,
                check=True,
            )
            public_key = subprocess.run(
                ["openssl", "x509", "-in", str(cert_path), "-pubkey", "-noout"],
                capture_output=True,
                check=True,
            ).stdout
            public_key_der = subprocess.run(
                ["openssl", "pkey", "-pubin", "-outform", "DER"],
                input=public_key,
                capture_output=True,
                check=True,
            ).stdout

            self.assertEqual(
                certificate_spki_sha256(cert_path),
                base64.b64encode(hashlib.sha256(public_key_der).digest()).decode("ascii"),
            )


class FingerprintMismatchGateTests(unittest.TestCase):
    def test_public_failure_is_accepted_only_after_observed_mismatch_and_no_provider_call(self) -> None:
        body = b'{"error":"recovery_unavailable"}'
        fixture_state = {
            "fingerprint_mismatch_enabled": True,
            "fingerprint_mismatch_entry_reads": 2,
            "reader_recovery_gets": ["/v1/entries/501/fetch-content"],
        }

        self.assertTrue(fingerprint_mismatch_gate_passed(502, body, fixture_state))

    def test_success_or_wrong_public_error_does_not_pass(self) -> None:
        fixture_state = {"fingerprint_mismatch_entry_reads": 2, "reader_recovery_gets": []}

        self.assertFalse(
            fingerprint_mismatch_gate_passed(200, b'{"status":"recovered"}', fixture_state)
        )
        self.assertFalse(
            fingerprint_mismatch_gate_passed(502, b'{"error":"another_error"}', fixture_state)
        )

    def test_unobserved_mutation_or_provider_fetch_does_not_pass(self) -> None:
        body = b'{"error":"recovery_unavailable"}'

        self.assertFalse(
            fingerprint_mismatch_gate_passed(
                502,
                body,
                {
                    "fingerprint_mismatch_enabled": True,
                    "fingerprint_mismatch_entry_reads": 1,
                    "reader_recovery_gets": [],
                },
            )
        )
        self.assertFalse(
            fingerprint_mismatch_gate_passed(
                502,
                body,
                {
                    "fingerprint_mismatch_enabled": True,
                    "fingerprint_mismatch_entry_reads": 2,
                    "reader_recovery_gets": ["/v1/entries/901/fetch-content"],
                },
            )
        )
        self.assertFalse(
            fingerprint_mismatch_gate_passed(
                502,
                body,
                {
                    "fingerprint_mismatch_enabled": False,
                    "fingerprint_mismatch_entry_reads": 2,
                    "reader_recovery_gets": [],
                },
            )
        )


if __name__ == "__main__":
    unittest.main()
