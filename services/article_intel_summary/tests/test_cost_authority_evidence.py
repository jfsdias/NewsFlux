"""D1 cost authority bound to real gateway evidence (PM review of #274).

The declaration alone never proves anything. The key-authority catalog accepts LiteLLM as the cost authority
only with an evidence file built from the read-only diagnostic receipt, bound to the fingerprint of the key the
Summary actually holds, fresh, and consistent with the declaration:
  gateway_budget_enforced -> KEY_MATCH=ONE, KEY_VALIDITY=PASS, a positive max_budget, a recognized budget
                             window, spend below the maximum;
  explicit_unlimited      -> KEY_MATCH=ONE, KEY_VALIDITY=PASS, no max_budget at all, and an owner decision ref.
Unknown, stale, other-key, mismatched or malformed evidence is COST_AUTHORITY_UNPROVEN (never "unlimited").
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.article_intel_summary import cost_authority as ca
from services.article_intel_summary.s5_preflight import key_fingerprint

KEY = "sk-synthetic-virtual-key-000000000000"
OTHER_KEY = "sk-synthetic-virtual-key-111111111111"
NOW = datetime(2026, 11, 20, 20, 0, tzinfo=timezone.utc)
BUDGET_FACTS = {"KEY_MATCH": "ONE", "KEY_VALIDITY": "PASS", "KEY_MAX_BUDGET": "OK",
                "KEY_BUDGET_DURATION": "CALENDAR_MONTH", "KEY_SPEND_VS_MAX": "BELOW"}
UNLIMITED_FACTS = {"KEY_MATCH": "ONE", "KEY_VALIDITY": "PASS", "KEY_MAX_BUDGET": "MISSING",
                   "KEY_BUDGET_DURATION": "MISSING", "KEY_SPEND_VS_MAX": "NOT_APPLICABLE"}


def evidence(declaration="gateway_budget_enforced", facts=None, key=KEY, captured=NOW - timedelta(days=1), **extra):
    document = {"schema": ca.EVIDENCE_SCHEMA, "declaration": declaration, "key_fingerprint": key_fingerprint(key),
                "captured_at": captured.strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "s5_db_readonly_audit",
                "receipt_sha256": "a" * 64, "facts": dict(facts or BUDGET_FACTS)}
    if declaration == "explicit_unlimited":
        document["owner_decision_ref"] = "https://github.com/jfsdias/homeserver/blob/main/ledger/decisions/x.md"
    document.update(extra)
    return document


class CostAuthorityEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, document, name="evidence.json"):
        path = Path(self.tmp.name) / name
        path.write_text(json.dumps(document) if not isinstance(document, str) else document, encoding="utf-8")
        path.chmod(0o640)
        return str(path)

    def check(self, declaration, document, key=KEY, now=NOW):
        path = self.write(document) if document is not None else str(Path(self.tmp.name) / "absent.json")
        return ca.evaluate(declaration, path, key, now=now)

    def test_gateway_budget_evidence_bound_to_the_key_is_proven(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence()), ("PROVEN", "GATEWAY_BUDGET_ENFORCED"))

    def test_explicit_unlimited_needs_no_budget_and_an_owner_decision(self):
        self.assertEqual(self.check("explicit_unlimited", evidence("explicit_unlimited", UNLIMITED_FACTS)),
                         ("PROVEN", "EXPLICIT_UNLIMITED"))
        no_ref = evidence("explicit_unlimited", UNLIMITED_FACTS)
        no_ref.pop("owner_decision_ref")
        self.assertEqual(self.check("explicit_unlimited", no_ref), ("UNPROVEN", "UNLIMITED_NOT_EXPLICIT"))
        with_budget = evidence("explicit_unlimited", BUDGET_FACTS)
        self.assertEqual(self.check("explicit_unlimited", with_budget), ("UNPROVEN", "UNLIMITED_BUT_BUDGET_PRESENT"))

    def test_missing_or_unknown_declaration_is_never_unlimited(self):
        for declaration in (None, "", "unlimited", "true", "yes"):
            self.assertEqual(self.check(declaration, evidence())[0], "UNPROVEN", declaration)

    def test_evidence_must_exist_and_be_well_formed(self):
        self.assertEqual(self.check("gateway_budget_enforced", None), ("UNPROVEN", "EVIDENCE_MISSING"))
        self.assertEqual(ca.evaluate("gateway_budget_enforced", None, KEY, now=NOW), ("UNPROVEN", "EVIDENCE_MISSING"))
        self.assertEqual(self.check("gateway_budget_enforced", "{not json"), ("UNPROVEN", "EVIDENCE_MALFORMED"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(schema="other/v1")), ("UNPROVEN", "EVIDENCE_SCHEMA"))
        broken = evidence()
        broken["facts"] = "x"
        self.assertEqual(self.check("gateway_budget_enforced", broken), ("UNPROVEN", "EVIDENCE_MALFORMED"))

    def test_evidence_for_another_key_or_a_rotated_key_is_rejected(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(key=OTHER_KEY)), ("UNPROVEN", "KEY_MISMATCH"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(), key=None), ("UNPROVEN", "KEY_UNAVAILABLE"))

    def test_freshness(self):
        stale = evidence(captured=NOW - ca.MAX_EVIDENCE_AGE - timedelta(minutes=1))
        self.assertEqual(self.check("gateway_budget_enforced", stale), ("UNPROVEN", "EVIDENCE_STALE"))
        future = evidence(captured=NOW + timedelta(hours=1))
        self.assertEqual(self.check("gateway_budget_enforced", future), ("UNPROVEN", "EVIDENCE_FUTURE"))
        bad_time = evidence(captured_at="yesterday")
        self.assertEqual(self.check("gateway_budget_enforced", bad_time), ("UNPROVEN", "EVIDENCE_MALFORMED"))

    def test_declaration_must_match_the_evidence(self):
        self.assertEqual(self.check("explicit_unlimited", evidence()), ("UNPROVEN", "DECLARATION_MISMATCH"))

    def test_budget_evidence_must_show_enforcement(self):
        cases = (
            ({"KEY_MATCH": "NONE"}, "KEY_NOT_MATCHED"),
            ({"KEY_MATCH": "MULTIPLE"}, "KEY_NOT_MATCHED"),
            ({"KEY_VALIDITY": "FAIL"}, "KEY_INVALID"),
            ({"KEY_MAX_BUDGET": "MISSING"}, "BUDGET_NOT_ENFORCED"),
            ({"KEY_MAX_BUDGET": "NONPOSITIVE"}, "BUDGET_NOT_ENFORCED"),
            ({"KEY_MAX_BUDGET": "INVALID"}, "BUDGET_NOT_ENFORCED"),
            ({"KEY_BUDGET_DURATION": "UNRECOGNIZED"}, "BUDGET_WINDOW_UNRECOGNIZED"),
            ({"KEY_BUDGET_DURATION": "MISSING"}, "BUDGET_WINDOW_UNRECOGNIZED"),
            ({"KEY_SPEND_VS_MAX": "AT_OR_ABOVE"}, "BUDGET_EXHAUSTED"),
        )
        for change, reason in cases:
            self.assertEqual(self.check("gateway_budget_enforced", evidence(facts={**BUDGET_FACTS, **change})),
                             ("UNPROVEN", reason), change)
        # app-level caps are not the authority any more: their absence does not matter
        for value in ("APP_CAP_MISSING", "ABOVE_APP_CAP"):
            self.assertEqual(self.check("gateway_budget_enforced",
                                        evidence(facts={**BUDGET_FACTS, "KEY_MAX_BUDGET": value}))[0], "PROVEN", value)

    def test_unsafe_evidence_files_are_refused(self):
        path = self.write(evidence())
        link = Path(self.tmp.name) / "link.json"
        os.symlink(path, link)
        self.assertEqual(ca.evaluate("gateway_budget_enforced", str(link), KEY, now=NOW), ("UNPROVEN", "EVIDENCE_UNSAFE_FILE"))
        os.chmod(path, 0o666)
        self.assertEqual(ca.evaluate("gateway_budget_enforced", path, KEY, now=NOW), ("UNPROVEN", "EVIDENCE_UNSAFE_FILE"))
        big = self.write("{" + " " * (ca.MAX_EVIDENCE_BYTES + 1) + "}", "big.json")
        self.assertEqual(ca.evaluate("gateway_budget_enforced", big, KEY, now=NOW), ("UNPROVEN", "EVIDENCE_UNSAFE_FILE"))


class EvidenceBuilderTests(unittest.TestCase):
    """build: from the contract-validated diagnostic receipt (no secret) + the Summary's own fingerprint."""

    RECEIPT = "\n".join([
        "S5R3_RUN_PRIVATE_PRESTATE=OFF", "S5R1_KEY_MATCH=ONE", "S5R1_KEY_VALIDITY=PASS", "S5R1_KEY_MAX_BUDGET=OK",
        "S5R1_KEY_BUDGET_DURATION=CALENDAR_MONTH", "S5R1_KEY_SPEND_VS_MAX=BELOW", "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY",
        "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY"]) + "\n"

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.receipt = Path(self.tmp.name) / "receipt.txt"
        self.receipt.write_text(self.RECEIPT)
        self.out = Path(self.tmp.name) / "evidence.json"

    def build(self, *extra, receipt=None):
        if receipt is not None:
            self.receipt.write_text(receipt)
        argv = ["build", "--receipt", str(self.receipt), "--key-fingerprint", key_fingerprint(KEY),
                "--captured-at", "2026-11-20T19:00:00Z", "--out", str(self.out), *extra]
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = ca.main(argv)
        return code, out.getvalue()

    def test_builds_evidence_that_the_runtime_accepts(self):
        code, _ = self.build("--declaration", "gateway_budget_enforced")
        self.assertEqual(code, 0)
        self.assertEqual(oct(self.out.stat().st_mode & 0o777), "0o640")
        self.assertEqual(ca.evaluate("gateway_budget_enforced", str(self.out), KEY, now=NOW),
                         ("PROVEN", "GATEWAY_BUDGET_ENFORCED"))
        document = json.loads(self.out.read_text())
        self.assertNotIn(KEY, json.dumps(document))

    def test_refuses_an_incomplete_held_or_failed_receipt(self):
        for receipt in (self.RECEIPT.replace("S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY", "S5R3_RUN_RESULT=HOLD_X"),
                        self.RECEIPT.replace("S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY\n", ""),
                        self.RECEIPT.replace("S5R1_KEY_MATCH=ONE\n", ""),
                        self.RECEIPT + "S5R1_KEY_MATCH=NONE\n"):
            code, _ = self.build("--declaration", "gateway_budget_enforced", receipt=receipt)
            self.assertEqual(code, 2)
            self.assertFalse(self.out.exists())

    def test_builder_never_upgrades_unknown_evidence(self):
        receipt = self.RECEIPT.replace("S5R1_KEY_MAX_BUDGET=OK", "S5R1_KEY_MAX_BUDGET=MISSING")
        code, out = self.build("--declaration", "gateway_budget_enforced", receipt=receipt)
        self.assertEqual(code, 2)
        self.assertIn("BUDGET_NOT_ENFORCED", out)
        code, out = self.build("--declaration", "explicit_unlimited", receipt=receipt)
        self.assertEqual(code, 2)                                   # no owner decision ref
        code, _ = self.build("--declaration", "explicit_unlimited", "--owner-decision-ref",
                             "https://github.com/jfsdias/homeserver/blob/main/ledger/decisions/x.md", receipt=receipt)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
