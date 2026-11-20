"""D1-R6-01: LiteLLM as cost authority only with evidence bound to a real capture (PM review of #274).

The declaration alone never proves anything. Evidence (schema v2) embeds the whole receipt of the authorized
read-only executor and is re-validated at runtime and at release preflight:
  receipt      complete success contract, single footer, no HOLD, no duplicate field, admitted diagnostic HEAD;
  digest       receipt_sha256 is the digest of the embedded receipt;
  capture      Summary container/image/revision and LiteLLM version as printed in the receipt;
  key          fingerprint of the key the Summary holds (from the live container at build time);
  time         captured_at = receipt mtime; runtime window 7 days, release preflight 24 hours;
  policy       GATEWAY_POLICY_OBSERVED is not enough: GATEWAY_ENFORCEMENT_EVIDENCE needs a key-level budget on a
               LiteLLM version whose enforcement was proven in the lab;
  owner        explicit_unlimited needs the embedded owner decision (pinned ledger ref, digest, key-bound marker);
  file         root-owned, not group/other-writable, no symlink.
Every negative is COST_AUTHORITY_UNPROVEN (never "unlimited").
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from services.article_intel_summary import cost_authority as ca
from services.article_intel_summary.s5_preflight import key_fingerprint

KEY = "sk-synthetic-virtual-key-000000000000"
OTHER_KEY = "sk-synthetic-virtual-key-111111111111"
NOW = datetime(2026, 11, 20, 20, 0, tzinfo=timezone.utc)
HEAD = "57c536fb583a52bb42a88d9a1b051869abc64b1f"
CONTAINER = "c" * 64
IMAGE = "sha256:" + "d" * 64
REVISION = "e" * 40
BUDGET_FACTS = {"KEY_MATCH": "ONE", "KEY_VALIDITY": "PASS", "KEY_MAX_BUDGET": "OK",
                "KEY_BUDGET_DURATION": "CALENDAR_MONTH", "KEY_SPEND_VS_MAX": "BELOW", "KEY_LIMIT_SOURCE": "KEY"}
UNLIMITED_FACTS = {"KEY_MATCH": "ONE", "KEY_VALIDITY": "PASS", "KEY_MAX_BUDGET": "MISSING",
                   "KEY_BUDGET_DURATION": "MISSING", "KEY_SPEND_VS_MAX": "NOT_APPLICABLE", "KEY_LIMIT_SOURCE": "NONE"}
DECISION_REF = "https://github.com/jfsdias/homeserver/blob/" + "f" * 40 + "/ledger/decisions/d1-unlimited.md"
ROOT = os.geteuid() == 0


def receipt_lines(facts=None, *, head=HEAD, version="1_110_0"):
    run = [("PRIVATE_PRESTATE", "OFF"), ("SOURCE_GATE", "PASS_EXACT_HEAD"),
           ("CI_WORKFLOW", "SUMMARY_RELEASE_REHEARSAL"), ("CI_RUN_ID", "44797429438"), ("CI_RUN_ATTEMPT", "1"),
           ("CI_HEAD_SHA", head), ("CI_JOB", "SYNTHETIC_RELEASE"), ("CI_JOBS_LISTING", "COMPLETE"),
           ("CI_RUN_CONCLUSION", "SUCCESS"), ("CI_JOB_CONCLUSION", "SUCCESS"),
           ("CI_GATE", "PASS_EXACT_RUN_ATTEMPT_JOB_SHA"), ("G2_MODE", "REMOTE_CI"),
           ("LITELLM_IDENTITY_GATE", "PASS"), ("LITELLM_IMAGE_GATE", "PASS"), ("IMAGE_VERSION_BINDING", "PASS_" + version),
           ("SUMMARY_DEPLOY_AUTHORIZED", "PASS_TABLE"), ("SUMMARY_REVISION_GATE", "PASS"),
           ("LIVE_SUMMARY_REVISION", REVISION), ("SUMMARY_CONTAINER_ID", CONTAINER), ("SUMMARY_IMAGE_ID", IMAGE)]
    lines = [f"S5R3_RUN_{name}={value}" for name, value in run]
    s5r1 = {"LITELLM_VERSION": version, "FILESYSTEM_INTEGRITY": "NOT_PROVEN", **(facts or BUDGET_FACTS),
            "CONTAINER_IDENTITY": "UNCHANGED", "AUDIT": "COMPLETE_DIAGNOSTIC_ONLY"}
    lines += [f"S5R1_{name}={value}" for name, value in s5r1.items()]
    return lines + ["S5R3_RUN_POST_GATES=PASS", ca.SUCCESS_FOOTER]


def receipt_text(facts=None, **kwargs):
    return "\n".join(receipt_lines(facts, **kwargs)) + "\n"


def owner_decision(key=KEY, until="2026-12-31", ref=DECISION_REF, marker=True):
    text = "# D1 explicit unlimited (owner)\n\nAprovado pelo owner.\n"
    if marker:
        text += f"NEWSFLUX_D1_EXPLICIT_UNLIMITED key_fingerprint_prefix={key_fingerprint(key)[:16]} until={until}\n"
    return {"ref": ref, "text": text, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}


def evidence(declaration="gateway_budget_enforced", facts=None, key=KEY, captured=NOW - timedelta(hours=1), *,
             text=None, decision=None, **extra):
    """Evidence as the root-run builder writes it from a receipt (shared with the key-authority tests)."""
    if facts is None:
        facts = UNLIMITED_FACTS if declaration == "explicit_unlimited" else BUDGET_FACTS
    text = receipt_text(facts) if text is None else text
    stamp = captured.strftime("%Y-%m-%dT%H:%M:%SZ")
    _, _, capture = ca.parse_receipt(text)
    document = {"schema": ca.EVIDENCE_SCHEMA, "declaration": declaration, "key_fingerprint": key_fingerprint(key),
                "captured_at": stamp, "built_at": stamp, "source": "s5-r3-omv-executor/receipt.txt",
                "receipt_text": text, "receipt_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "capture": capture, "classification": "test"}
    if declaration == "explicit_unlimited":
        until = (captured + timedelta(days=60)).date().isoformat()
        document["owner_decision"] = decision if decision is not None else owner_decision(key, until=until)
    document.update(extra)
    return document


def write_trusted(directory, name, document, mode=0o644):
    """Owned by the trusted user (see trust_current_user), not group/other-writable."""
    path = Path(directory) / name
    path.write_text(document if isinstance(document, str) else json.dumps(document), encoding="utf-8")
    path.chmod(mode)
    return str(path)


def trust_current_user(test):
    """CI runs as an unprivileged user: the trusted owner is the module constant (root in production), patched here
    to the test user. The builder tests, which need /root and chown, run only as root."""
    patcher = mock.patch.object(ca, "TRUSTED_UID", os.geteuid())
    patcher.start()
    test.addCleanup(patcher.stop)


def trusted_dir(test):
    trust_current_user(test)
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    os.chmod(tmp.name, 0o755)
    return tmp.name


class CostAuthorityEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = trusted_dir(self)

    def check(self, declaration, document, key=KEY, now=NOW, **kwargs):
        path = write_trusted(self.dir, "evidence.json", document) if document is not None else \
            str(Path(self.dir) / "absent.json")
        return ca.evaluate(declaration, path, key, now=now, **kwargs)

    # --- positives -----------------------------------------------------------------------------------------
    def test_key_budget_on_a_lab_proven_version_is_gateway_enforcement_evidence(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence()), ("PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"))

    def test_explicit_unlimited_with_a_key_bound_owner_decision(self):
        self.assertEqual(self.check("explicit_unlimited", evidence("explicit_unlimited")),
                         ("PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"))

    # --- policy classification ------------------------------------------------------------------------------
    def test_policy_observed_is_not_enforcement_evidence(self):
        table = {**BUDGET_FACTS, "KEY_LIMIT_SOURCE": "BUDGET_TABLE"}
        self.assertEqual(self.check("gateway_budget_enforced", evidence(facts=table)),
                         ("UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"))
        unproven_version = evidence(text=receipt_text(BUDGET_FACTS, version="1_200_0"))
        self.assertEqual(self.check("gateway_budget_enforced", unproven_version),
                         ("UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"))

    def test_budget_classification_negatives(self):
        cases = {"BUDGET_NOT_PRESENT": {"KEY_MAX_BUDGET": "NONPOSITIVE"},
                 "BUDGET_WINDOW_UNRECOGNIZED": {"KEY_BUDGET_DURATION": "MISSING"},
                 "BUDGET_EXHAUSTED": {"KEY_SPEND_VS_MAX": "AT_OR_ABOVE"},
                 "KEY_NOT_MATCHED": {"KEY_MATCH": "NONE"}, "KEY_INVALID": {"KEY_VALIDITY": "EXPIRED"}}
        for reason, change in cases.items():
            self.assertEqual(self.check("gateway_budget_enforced", evidence(facts={**BUDGET_FACTS, **change})),
                             ("UNPROVEN", reason), reason)

    def test_missing_or_unknown_declaration_is_never_unlimited(self):
        for declaration in (None, "", "unlimited", "true", "yes"):
            self.assertEqual(self.check(declaration, evidence())[0], "UNPROVEN", declaration)

    def test_declaration_must_match_the_evidence(self):
        self.assertEqual(self.check("explicit_unlimited", evidence()), ("UNPROVEN", "DECLARATION_MISMATCH"))
        with_budget = evidence("explicit_unlimited", BUDGET_FACTS)
        self.assertEqual(self.check("explicit_unlimited", with_budget), ("UNPROVEN", "UNLIMITED_BUT_BUDGET_PRESENT"))

    # --- R6 negatives -------------------------------------------------------------------------------------
    def test_old_receipt_re_presented_with_a_new_date(self):
        """The builder binds captured_at to the receipt mtime and refuses receipts older than 24h (builder tests).
        At runtime the date window bounds what any re-dated document can claim; stated limit: whoever can write a
        root-owned file on the host is the trust anchor and could re-date it."""
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW - timedelta(days=8))),
                         ("UNPROVEN", "EVIDENCE_STALE"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW + timedelta(hours=2))),
                         ("UNPROVEN", "EVIDENCE_FUTURE"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured_at="2026-11-20")),
                         ("UNPROVEN", "EVIDENCE_MALFORMED"))

    def test_receipt_of_another_key(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(key=OTHER_KEY)), ("UNPROVEN", "KEY_MISMATCH"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(), key=None), ("UNPROVEN", "KEY_UNAVAILABLE"))

    def test_synthetic_receipt_presented_as_real(self):
        v1 = {"schema": "newsflux.d1-cost-authority-evidence/v1", "declaration": "gateway_budget_enforced",
              "key_fingerprint": key_fingerprint(KEY), "captured_at": "2026-11-20T19:00:00Z", "facts": BUDGET_FACTS}
        self.assertEqual(self.check("gateway_budget_enforced", v1), ("UNPROVEN", "EVIDENCE_SCHEMA"))
        stub = evidence(text="S5R3_RUN_PRIVATE_PRESTATE=OFF\n" + ca.SUCCESS_FOOTER + "\n")
        self.assertEqual(self.check("gateway_budget_enforced", stub), ("UNPROVEN", "RECEIPT_NOT_COMPLETE"))
        no_identity = [line for line in receipt_lines() if "SUMMARY_CONTAINER_ID" not in line]
        self.assertEqual(self.check("gateway_budget_enforced", evidence(text="\n".join(no_identity) + "\n")),
                         ("UNPROVEN", "RECEIPT_IDENTITY_INCOMPLETE"))

    def test_edited_receipt(self):
        document = evidence()
        document["receipt_text"] = document["receipt_text"].replace("KEY_LIMIT_SOURCE=KEY", "KEY_LIMIT_SOURCE=KEY_")
        self.assertEqual(self.check("gateway_budget_enforced", document), ("UNPROVEN", "RECEIPT_DIGEST_MISMATCH"))
        document = evidence()
        document["capture"] = {**document["capture"], "summary_image_id": "sha256:" + "0" * 64}
        self.assertEqual(self.check("gateway_budget_enforced", document), ("UNPROVEN", "CAPTURE_IDENTITY_MISMATCH"))

    def test_duplicate_or_contradictory_conclusion(self):
        lines = receipt_lines()
        cases = {
            "RECEIPT_DUPLICATE_FIELD": [lines[:-1] + ["S5R1_KEY_MAX_BUDGET=MISSING", lines[-1]], lines + [lines[-1]]],
            "RECEIPT_NOT_COMPLETE": [lines[:-1] + ["S5R3_RUN_RESULT=HOLD_AUDIT"], lines[:-1]],
            "RECEIPT_HOLD": [lines[:-2] + ["S5R1_FILESYSTEM_GATE=FAIL"] + lines[-2:]],
            "RECEIPT_UNEXPECTED_LINE": [lines[:-1] + ["note: all good", lines[-1]]],
        }
        for reason, variants in cases.items():
            for variant in variants:
                self.assertEqual(self.check("gateway_budget_enforced", evidence(text="\n".join(variant))),
                                 ("UNPROVEN", reason), reason)

    def test_non_admitted_origin(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(text=receipt_text(head="0" * 40))),
                         ("UNPROVEN", "RECEIPT_HEAD_NOT_ADMITTED"))

    def test_wrong_hash(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(receipt_sha256="a" * 64)),
                         ("UNPROVEN", "RECEIPT_DIGEST_MISMATCH"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(key_fingerprint="xyz")),
                         ("UNPROVEN", "EVIDENCE_MALFORMED"))

    def test_unlimited_with_an_arbitrary_reference(self):
        def unlimited(decision):
            return self.check("explicit_unlimited", evidence("explicit_unlimited", decision=decision))
        self.assertEqual(unlimited(owner_decision(ref="https://example.com/ok.md")), ("UNPROVEN", "OWNER_DECISION_REF_INVALID"))
        self.assertEqual(unlimited(owner_decision(ref=DECISION_REF.replace("f" * 40, "main"))),
                         ("UNPROVEN", "OWNER_DECISION_REF_INVALID"))
        tampered = owner_decision()
        tampered["text"] += "edited\n"
        self.assertEqual(unlimited(tampered), ("UNPROVEN", "OWNER_DECISION_DIGEST_MISMATCH"))
        self.assertEqual(unlimited(owner_decision(marker=False)), ("UNPROVEN", "OWNER_DECISION_MARKER_MISSING"))
        self.assertEqual(unlimited(owner_decision(key=OTHER_KEY)), ("UNPROVEN", "OWNER_DECISION_OTHER_KEY"))
        self.assertEqual(unlimited(owner_decision(until="2026-11-19")), ("UNPROVEN", "OWNER_DECISION_EXPIRED"))
        double = owner_decision()
        double["text"] += double["text"].splitlines()[-1] + "\n"
        double["sha256"] = hashlib.sha256(double["text"].encode()).hexdigest()
        self.assertEqual(unlimited(double), ("UNPROVEN", "OWNER_DECISION_MARKER_MISSING"))
        document = evidence("explicit_unlimited")
        document.pop("owner_decision")
        self.assertEqual(self.check("explicit_unlimited", document), ("UNPROVEN", "UNLIMITED_NOT_AUTHORIZED"))

    def test_untrusted_file(self):
        path = write_trusted(self.dir, "e.json", evidence())

        def verdict(target=path, **kwargs):
            return ca.evaluate("gateway_budget_enforced", target, KEY, now=NOW, **kwargs)
        self.assertEqual(verdict()[0], "PROVEN")
        untrusted = ("UNPROVEN", "EVIDENCE_UNTRUSTED_FILE")
        for mode in (0o666, 0o646, 0o664):
            os.chmod(path, mode)
            self.assertEqual(verdict(), untrusted, oct(mode))
        os.chmod(path, 0o644)
        if ROOT:
            os.chown(path, 12345, 12345)
            self.assertEqual(verdict(), untrusted)
            os.chown(path, 0, 0)
        link = Path(self.dir) / "link.json"
        link.symlink_to(path)
        self.assertEqual(verdict(str(link)), untrusted)
        os.chmod(self.dir, 0o777)                       # writable directory: the file could be swapped
        self.assertEqual(verdict(), untrusted)
        os.chmod(self.dir, 0o755)
        os.mkdir(Path(self.dir) / "dir.json")
        self.assertEqual(verdict(str(Path(self.dir) / "dir.json")), untrusted)
        self.assertEqual(verdict(write_trusted(self.dir, "big.json", "x" * (ca.MAX_EVIDENCE_BYTES + 1))), untrusted)
        self.assertEqual(verdict(trusted_uid=os.geteuid() + 1), untrusted)      # owned by someone else

    def test_same_key_policy_change_is_seen_only_at_the_next_capture(self):
        """Stated limit: the virtual key cannot read its own policy. A budget removed after the capture stays
        invisible until expiry; the next capture of the same key with the budget removed no longer proves it."""
        before = evidence(captured=NOW - timedelta(days=6))
        self.assertEqual(self.check("gateway_budget_enforced", before)[0], "PROVEN")
        self.assertEqual(self.check("gateway_budget_enforced", before, now=NOW + timedelta(days=1, hours=1)),
                         ("UNPROVEN", "EVIDENCE_STALE"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(facts=UNLIMITED_FACTS)),
                         ("UNPROVEN", "BUDGET_NOT_PRESENT"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(facts={**BUDGET_FACTS, "KEY_LIMIT_SOURCE": "BUDGET_TABLE"})),
                         ("UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"))

    def test_expiry_windows(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW - ca.MAX_EVIDENCE_AGE))[0], "PROVEN")
        self.assertEqual(self.check("gateway_budget_enforced",
                                    evidence(captured=NOW - ca.MAX_EVIDENCE_AGE - timedelta(seconds=1))),
                         ("UNPROVEN", "EVIDENCE_STALE"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW - timedelta(hours=25)),
                                    max_age=ca.MAX_PREFLIGHT_AGE), ("UNPROVEN", "EVIDENCE_STALE"))

    def test_missing_or_malformed_evidence(self):
        self.assertEqual(self.check("gateway_budget_enforced", None), ("UNPROVEN", "EVIDENCE_MISSING"))
        self.assertEqual(ca.evaluate("gateway_budget_enforced", None, KEY, now=NOW), ("UNPROVEN", "EVIDENCE_MISSING"))
        for broken in ("{not json", "[]"):
            self.assertEqual(self.check("gateway_budget_enforced", broken), ("UNPROVEN", "EVIDENCE_MALFORMED"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(receipt_text=7)), ("UNPROVEN", "EVIDENCE_MALFORMED"))


class ReleasePreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = trusted_dir(self)

    def run_preflight(self, document=None, key_loader=lambda _env: KEY, **values):
        env = {"NEWSFLUX_AI_MODEL_AUTHORITY": "litellm_key", "NEWSFLUX_AI_LITELLM_COST_AUTHORITY": "gateway_budget_enforced"}
        if document is not None:
            env["NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE"] = write_trusted(self.dir, "e.json", document)
        env.update(values)
        env = {k: v for k, v in env.items() if v is not None}
        return ca.preflight(env, now=NOW, key_loader=key_loader)

    def test_mode_off_is_not_applicable_and_keeps_the_legacy_contract(self):
        for mode in (None, "", "operator_policy", "LITELLM_KEY"):
            self.assertEqual(self.run_preflight(NEWSFLUX_AI_MODEL_AUTHORITY=mode),
                             (0, ["D1_MODEL_AUTHORITY=OFF", "D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT"]), mode)

    def test_fresh_bound_evidence_passes(self):
        code, lines = self.run_preflight(evidence())
        self.assertEqual(code, 0)
        self.assertIn("D1_COST_AUTHORITY=PROVEN_GATEWAY_ENFORCEMENT_EVIDENCE", lines)
        self.assertEqual(lines[-1], "D1_PREFLIGHT=PASS")

    def test_release_preflight_failures_hold(self):
        cases = {"EVIDENCE_MISSING": (None, {}),
                 "EVIDENCE_STALE": (evidence(captured=NOW - timedelta(hours=25)), {}),   # valid at runtime, not at release
                 "KEY_MISMATCH": (evidence(key=OTHER_KEY), {}),
                 "DECLARATION_MISSING": (evidence(), {"NEWSFLUX_AI_LITELLM_COST_AUTHORITY": None})}
        for reason, (document, values) in cases.items():
            code, lines = self.run_preflight(document, **values)
            self.assertEqual(code, 3, reason)
            self.assertIn(f"D1_COST_AUTHORITY=UNPROVEN_{reason}", lines)
            self.assertEqual(lines[-1], "D1_PREFLIGHT=HOLD")

    def test_unreadable_key_holds_and_nothing_secret_is_printed(self):
        def broken(_env):
            raise RuntimeError(KEY)
        code, lines = self.run_preflight(evidence(), key_loader=broken)
        self.assertEqual(code, 3)
        self.assertIn("D1_COST_AUTHORITY=UNPROVEN_KEY_UNAVAILABLE", lines)
        self.assertNotIn(KEY, "\n".join(lines))
        self.assertNotIn(key_fingerprint(KEY), "\n".join(lines))


@unittest.skipUnless(ROOT, "the builder runs as root on the OMV")
class EvidenceBuilderTests(unittest.TestCase):
    """build() reads only the authorized executor's private workdir; nothing about the capture comes from argv."""

    def setUp(self) -> None:
        root = tempfile.mkdtemp(prefix="s5r3-exec.", dir="/root")
        while not ca.EXEC_WORKDIR.match(root + "/run"):        # mktemp XXXXXXXX is alphanumeric; mkdtemp may add "_"
            os.rmdir(root)
            root = tempfile.mkdtemp(prefix="s5r3-exec.", dir="/root")
        self.addCleanup(shutil.rmtree, root, True)
        os.chmod(root, 0o700)
        self.workdir = os.path.join(root, "run")
        os.mkdir(self.workdir, 0o700)
        self.out_dir = trusted_dir(self)
        self.calls: list[list[str]] = []
        self.fingerprint = key_fingerprint(KEY)
        self.inspect = f"{CONTAINER} {IMAGE} running\n"

    def receipt(self, text=None, age=timedelta(minutes=10), mode=0o600):
        path = os.path.join(self.workdir, "receipt.txt")
        Path(path).write_text(receipt_text() if text is None else text, encoding="utf-8")
        os.chmod(path, mode)
        moment = (NOW - age).timestamp()
        os.utime(path, (moment, moment))

    def fake_docker(self, argv):
        self.calls.append(argv)
        return self.inspect if argv[1] == "inspect" else self.fingerprint + "\n"

    def build(self, declaration="gateway_budget_enforced", workdir=None, euid=0, name="out.json", **kwargs):
        out = os.path.join(self.out_dir, name)
        return ca.build(workdir or self.workdir, declaration, out, run=self.fake_docker, euid=euid, now=NOW, **kwargs), out

    def test_builds_evidence_the_runtime_accepts(self):
        self.receipt()
        (status, document), out = self.build()
        self.assertEqual(status, "WRITTEN")
        self.assertEqual(document["captured_at"], "2026-11-20T19:50:00Z")       # receipt mtime, not argv
        self.assertEqual(document["receipt_sha256"], hashlib.sha256(receipt_text().encode()).hexdigest())
        self.assertEqual(document["classification"], "GATEWAY_ENFORCEMENT_EVIDENCE")
        self.assertEqual(os.stat(out).st_mode & 0o777, 0o644)
        self.assertEqual(ca.evaluate("gateway_budget_enforced", out, KEY, now=NOW), ("PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"))
        self.assertEqual(self.calls[0][:2], ["docker", "inspect"])
        self.assertEqual(self.calls[1][:5], ["docker", "exec", "-u", "10001", CONTAINER])
        self.assertNotIn(KEY, Path(out).read_text())

    def test_builder_refusals(self):
        self.receipt()
        self.assertEqual(self.build(euid=1000)[0][0], "NOT_ROOT")
        self.assertEqual(self.build(workdir="/tmp/anything/run")[0][0], "WORKDIR_NOT_AUTHORIZED_EXECUTOR")
        os.chmod(self.workdir, 0o755)
        self.assertEqual(self.build()[0][0], "WORKDIR_UNTRUSTED")
        os.chmod(self.workdir, 0o700)
        self.receipt(mode=0o644)
        self.assertEqual(self.build()[0][0], "RECEIPT_UNTRUSTED_FILE")
        self.receipt(age=timedelta(hours=25))                                     # old receipt, new build
        self.assertEqual(self.build()[0][0], "CAPTURE_TOO_OLD")
        self.receipt(age=-timedelta(hours=1))
        self.assertEqual(self.build()[0][0], "CAPTURE_IN_FUTURE")
        self.receipt(text="\n".join(receipt_lines()[:-1]))
        self.assertEqual(self.build()[0][0], "RECEIPT_NOT_COMPLETE")
        self.receipt(receipt_text(UNLIMITED_FACTS))
        self.assertEqual(self.build()[0][0], "BUDGET_NOT_PRESENT")
        self.receipt()
        self.inspect = f"{'1' * 64} {IMAGE} running\n"                           # container replaced since capture
        self.assertEqual(self.build()[0][0], "SUMMARY_CONTAINER_CHANGED")
        self.inspect = f"{CONTAINER} {IMAGE} running\n"
        self.fingerprint = "not-a-fingerprint"
        self.assertEqual(self.build()[0][0], "FINGERPRINT_UNAVAILABLE")
        os.unlink(os.path.join(self.workdir, "receipt.txt"))
        self.assertEqual(self.build()[0][0], "RECEIPT_MISSING")

    def test_unlimited_requires_a_trusted_key_bound_owner_decision(self):
        self.receipt(receipt_text(UNLIMITED_FACTS))
        self.assertEqual(self.build("explicit_unlimited")[0][0], "UNLIMITED_NOT_AUTHORIZED")
        path = write_trusted(self.out_dir, "decision.md", owner_decision()["text"])
        (status, _), out = self.build("explicit_unlimited", owner_decision_file=path, owner_decision_ref=DECISION_REF,
                                      name="u.json")
        self.assertEqual(status, "WRITTEN")
        self.assertEqual(ca.evaluate("explicit_unlimited", out, KEY, now=NOW), ("PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"))
        (status, _), _ = self.build("explicit_unlimited", owner_decision_file=path,
                                    owner_decision_ref="https://example.com/x.md", name="v.json")
        self.assertEqual(status, "OWNER_DECISION_REF_INVALID")

    def test_existing_output_is_never_overwritten(self):
        self.receipt()
        self.build()
        with self.assertRaises(FileExistsError):
            self.build()


class ReceiptContractUnitTests(unittest.TestCase):
    def test_parse_receipt_capture(self):
        problem, facts, capture = ca.parse_receipt(receipt_text())
        self.assertIsNone(problem)
        self.assertEqual(facts["KEY_LIMIT_SOURCE"], "KEY")
        self.assertEqual(capture, {"diagnostic_head": HEAD, "summary_container_id": CONTAINER, "summary_image_id": IMAGE,
                                   "live_summary_revision": REVISION, "litellm_version": "1_110_0",
                                   "image_version_binding": "PASS_1_110_0"})

    def test_version_binding_must_match_the_reported_version(self):
        lines = [line.replace("PASS_1_110_0", "PASS_1_109_1") for line in receipt_lines()]
        self.assertEqual(ca.parse_receipt("\n".join(lines))[0], "RECEIPT_IDENTITY_INCOMPLETE")

    def test_owner_decision_until_is_inclusive(self):
        decision = owner_decision(until="2026-11-20")
        self.assertIsNone(ca.check_owner_decision(decision, key_fingerprint(KEY), date(2026, 11, 20)))
        self.assertEqual(ca.check_owner_decision(decision, key_fingerprint(KEY), date(2026, 11, 21)), "OWNER_DECISION_EXPIRED")

    def test_cli_preflight_mode_off(self):
        with mock.patch.dict(os.environ, {"NEWSFLUX_AI_MODEL_AUTHORITY": ""}), mock.patch("builtins.print") as printed:
            self.assertEqual(ca.main(["preflight"]), 0)
        self.assertIn("D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT", printed.call_args[0][0])


if __name__ == "__main__":
    unittest.main()
