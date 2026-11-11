from __future__ import annotations

import base64
import hashlib
import subprocess
import tempfile
import unittest
from pathlib import Path

from run import certificate_spki_sha256


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


if __name__ == "__main__":
    unittest.main()
