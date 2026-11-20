"""D1-R7-01: cost-authority evidence bound to ONE capture (key, time, identities, policy, receipt, exit code).

Evidence v3 is produced by deploy/release-governance/d1_capture.py on the OMV (root, one invocation) and judged by
services.article_intel_summary.d1_evidence (shared) plus cost_authority (pin, file, mount, key, freshness).
Every negative is COST_AUTHORITY_UNPROVEN, never "unlimited".
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from services.article_intel_summary import cost_authority as ca
from services.article_intel_summary import d1_evidence as ev
from services.article_intel_summary.s5_preflight import key_fingerprint

KEY = "sk-synthetic-virtual-key-000000000000"
OTHER_KEY = "sk-synthetic-virtual-key-111111111111"
NOW = datetime(2026, 11, 20, 20, 0, tzinfo=timezone.utc)
SUMMARY_ID, LITELLM_ID = "c" * 64, "a" * 64
SUMMARY_IMAGE = "sha256:" + "d" * 64
LITELLM_IMAGE, LITELLM_DIGEST = ("sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab",
                                 "ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a")
REVISION = "e" * 40
AUDITOR_SHA = next(iter(ev.ADMITTED_AUDITOR_SHA256))
REPO = Path(__file__).resolve().parents[3]
BUDGET_FACTS = {"KEY_MATCH": "ONE", "KEY_VALIDITY": "PASS", "KEY_SCOPE_DETAIL": "EXACT_ALIAS", "KEY_SCOPE": "PASS",
                "KEY_ROUTES": "PASS", "KEY_TYPE": "LLM_API", "KEY_MAX_BUDGET": "APP_CAP_MISSING",
                "KEY_BUDGET_DURATION": "CALENDAR_MONTH", "KEY_SPEND_VS_MAX": "BELOW", "KEY_LIMIT_SOURCE": "KEY",
                "OBJPERM_EFFECTIVE": "NONE", "JWT_AUTH": "DISABLED", "FALLBACK_GATE": "PASS", "CALLBACK_GATE": "PASS"}
UNLIMITED_FACTS = {**BUDGET_FACTS, "KEY_MAX_BUDGET": "MISSING", "KEY_BUDGET_DURATION": "MISSING",
                   "KEY_SPEND_VS_MAX": "NOT_APPLICABLE"}
BASE_FACTS = {"DB_READ_ONLY": "VERIFIED", "KEY_LOOKUP": "EXACT_FINGERPRINT", "KEY_POLICY_GATE": "NOT_VERIFIED",
              "KEY_POLICY_GATE_R3": "NOT_VERIFIED", "KEY_POLICY_GATE_R3_REASONS": "NONE", "KEY_SCHEMA_COMPAT": "LAB_EXACT",
              "LITELLM_VERSION": "1_110_0", "LITELLM_VERSION_CLASS": "LAB_REHEARSED", "MODEL_ROUTE_GATE": "PASS",
              "PRICING_GATE": "NOT_VERIFIED", "PROVIDER_PRIVACY_GATE": "NOT_VERIFIED_OPERATOR_TERMS_REQUIRED",
              "OFFICIAL_ATTESTATION": "HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE",
              "EVIDENCE_KIND": "DIAGNOSTIC_DB_CONFIG_READONLY", "S5_PREFLIGHT_EFFECT": "NONE",
              "INFERENCE_EFFECTIVE": "OFF_EXPLICIT", "EXTERNAL_TRANSFER_EFFECTIVE": "OFF_EXPLICIT",
              "FLAGS_RUNTIME_PARSER": "CONFIRMED_OFF", "SUMMARY_BINDING": "EXACT_ID_IMAGE_LABELS_LIFECYCLE",
              "LITELLM_BINDING": "EXACT_ID_IMAGE_LIFECYCLE", "DELIBERATE_DB_CONFIG_WRITES": "NONE",
              "CONTAINER_IDENTITY": "UNCHANGED", "FILESYSTEM_INTEGRITY": "NOT_PROVEN"}
DECISION_REF = "https://github.com/jfsdias/homeserver/blob/" + "f" * 40 + "/ledger/decisions/d1-unlimited.md"
ROOT = os.geteuid() == 0


def receipt_lines(facts=None, *, prestate_sha="b" * 64, prestate=True):
    lines = [f"S5R1_{name}={value}" for name, value in {**BASE_FACTS, **(facts or BUDGET_FACTS)}.items()]
    if prestate:
        lines += ["S5R3_PRIVATE_PRESTATE=WRITTEN", f"S5R3_PRIVATE_PRESTATE_SHA256={prestate_sha}"]
    return lines + ["S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY", ev.contract.NEXT_LINE]


def receipt_text(facts=None, **kwargs):
    return "\n".join(receipt_lines(facts, **kwargs)) + "\n"


def identity(cid, image, project="", service=""):
    return f"{cid}|{image}|2026-11-20T10:00:00.000000000Z|0|running|{project}|{service}"


IDENTITIES = [identity(SUMMARY_ID, SUMMARY_IMAGE, "newsflux", "summary-api"), identity(LITELLM_ID, LITELLM_IMAGE)]


def owner_decision(key=KEY, until="2026-12-31", ref=DECISION_REF, marker=True):
    text = "# D1 explicit unlimited (owner)\n\nAprovado pelo owner.\n"
    if marker:
        text += f"NEWSFLUX_D1_EXPLICIT_UNLIMITED key_fingerprint_prefix={key_fingerprint(key)[:16]} until={until}\n"
    return {"ref": ref, "text": text, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}


def evidence(declaration="gateway_budget_enforced", facts=None, key=KEY, captured=NOW - timedelta(hours=1), *,
             text=None, decision=None, litellm=None, capture=None, **extra):
    """A v3 document as d1_capture.py writes it (shared with the key-authority and canary tests)."""
    if facts is None:
        facts = UNLIMITED_FACTS if declaration == "explicit_unlimited" else BUDGET_FACTS
    prestate_sha = "b" * 64
    text = receipt_text(facts, prestate_sha=prestate_sha) if text is None else text
    document = {
        "schema": ev.EVIDENCE_SCHEMA, "declaration": declaration,
        "capture": {
            "tool": "d1_capture/v1", "started_at": ev.fmt(captured - timedelta(seconds=20)),
            "finished_at": ev.fmt(captured + timedelta(seconds=20)), "auditor_sha256": AUDITOR_SHA,
            "contract_sha256": ev.contract_sha256(), "auditor_exit": 0, "receipt_text": text,
            "receipt_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "prestate_sha256": prestate_sha,
            "prestate_captured_at": captured.isoformat(), "key_fingerprint": key_fingerprint(key),
            "summary": {"container_id": SUMMARY_ID, "image_id": SUMMARY_IMAGE, "revision": REVISION,
                        "project": "newsflux", "service": "summary-api"},
            "litellm": litellm or {"container_id": LITELLM_ID, "image_id": LITELLM_IMAGE, "repo_digest": LITELLM_DIGEST,
                                   "version": "1.110.0"},
            "identity_before": list(IDENTITIES), "identity_after": list(IDENTITIES),
            **(capture or {}),
        },
    }
    _, reason, _ = ev.verify(document, check_classification=False)
    document["classification"] = reason
    if declaration == "explicit_unlimited":
        until = (captured + timedelta(days=60)).date().isoformat()
        document["owner_decision"] = decision if decision is not None else owner_decision(key, until=until)
    document.update(extra)
    return document


def write_trusted(directory, name, document, mode=0o644):
    """Owned by the trusted user (see trust_current_user), not group/other-writable. Returns the path."""
    path = Path(directory) / name
    path.write_text(document if isinstance(document, str) else json.dumps(document), encoding="utf-8")
    path.chmod(mode)
    return str(path)


def sha_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def trust_current_user(test, *, readonly_mount=True):
    """CI runs unprivileged and without bind mounts: the trusted owner (root in production) becomes the test user
    and the mount table answers `readonly_mount`. Both are module constants, never environment settings."""
    for patcher in (mock.patch.object(ca, "TRUSTED_UID", os.geteuid()),
                    mock.patch.object(ca, "mount_is_readonly", lambda _path: readonly_mount)):
        patcher.start()
        test.addCleanup(patcher.stop)


def trusted_dir(test, **kwargs):
    trust_current_user(test, **kwargs)
    tmp = tempfile.TemporaryDirectory()
    test.addCleanup(tmp.cleanup)
    os.chmod(tmp.name, 0o755)
    return tmp.name


class ReceiptContractVendoringTests(unittest.TestCase):
    def test_vendored_block_is_the_admitted_contract_verbatim(self):
        text = (REPO / "services/article_intel_summary/d1_receipt_contract.py").read_text(encoding="utf-8")
        block = text.split("# ---BEGIN VERBATIM CONTRACT_PY---\n", 1)[1].split("# ---END VERBATIM CONTRACT_PY---", 1)[0]
        self.assertEqual(hashlib.sha256(block.encode("utf-8")).hexdigest(), ev.contract.VERBATIM_SHA256)
        self.assertEqual(ev.contract_sha256(), "7aa686a3d3b970c0417ad4d827574cd3893a1cc6b6451b01ba70db25ebde1d71")

    def test_full_contract_not_a_subset(self):
        _, contract_text, _ = ev.split_receipt(receipt_text())
        self.assertEqual(ev.receipt_facts(contract_text, 0, "1_110_0")[0], None)
        for name in ev.contract.REQUIRED:
            if name == "AUDIT":
                continue
            lines = [line for line in receipt_lines() if not line.startswith(f"S5R1_{name}=")]
            _, contract_text, _ = ev.split_receipt("\n".join(lines))
            self.assertEqual(ev.receipt_facts(contract_text, 0, "1_110_0")[0], "RECEIPT_MISSING_REQUIRED", name)
        bad = [line.replace("JWT_AUTH=DISABLED", "JWT_AUTH=MAYBE") for line in receipt_lines()]
        _, contract_text, _ = ev.split_receipt("\n".join(bad))
        self.assertEqual(ev.receipt_facts(contract_text, 0, "1_110_0")[0], "RECEIPT_VALUE_NOT_ALLOWED")


class EvidenceVerifyTests(unittest.TestCase):
    def verdict(self, document):
        return ev.verify(document)[:2]

    def test_positive_budget_and_unlimited(self):
        self.assertEqual(self.verdict(evidence()), ("PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"))
        self.assertEqual(self.verdict(evidence("explicit_unlimited")), ("PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"))

    def test_incomplete_receipt(self):
        lines = receipt_lines()
        cases = {
            "RECEIPT_NOT_COMPLETE": "\n".join(lines[:-2]),                                    # no audit footer
            "RECEIPT_PRESTATE_NOT_WRITTEN": receipt_text(prestate=False),                     # capture without prestate
            "RECEIPT_EXIT_INCOHERENT": "\n".join(lines[:-1]),                                # NEXT line missing
            "RECEIPT_DUPLICATE_FIELD": "\n".join(lines[:1] + lines),
            "RECEIPT_UNEXPECTED_LINE": "\n".join(["note: ok"] + lines),
        }
        for reason, text in cases.items():
            self.assertEqual(self.verdict(evidence(text=text)), ("UNPROVEN", reason), reason)

    def test_exit_code_must_be_recorded_zero_and_coherent(self):
        for value in (2, 3, None, True, "0"):
            self.assertEqual(self.verdict(evidence(capture={"auditor_exit": value})), ("UNPROVEN", "AUDITOR_EXIT_NOT_ZERO"), value)

    def test_receipt_and_prestate_digests(self):
        document = evidence()
        document["capture"]["receipt_text"] = document["capture"]["receipt_text"].replace("KEY_ROUTES=PASS", "KEY_ROUTES=FAIL")
        self.assertEqual(self.verdict(document), ("UNPROVEN", "RECEIPT_DIGEST_MISMATCH"))
        self.assertEqual(self.verdict(evidence(capture={"prestate_sha256": "0" * 64})), ("UNPROVEN", "PRESTATE_DIGEST_MISMATCH"))

    def test_capture_time_comes_from_the_auditor_inside_the_window(self):
        late = evidence(capture={"prestate_captured_at": (NOW + timedelta(hours=3)).isoformat()})
        self.assertEqual(self.verdict(late), ("UNPROVEN", "CAPTURE_TIME_INCOHERENT"))
        naive = evidence(capture={"prestate_captured_at": "2026-11-20T19:00:00"})
        self.assertEqual(self.verdict(naive), ("UNPROVEN", "EVIDENCE_MALFORMED"))
        long = evidence(capture={"started_at": ev.fmt(NOW - timedelta(hours=2))})
        self.assertEqual(self.verdict(long), ("UNPROVEN", "CAPTURE_TIME_INCOHERENT"))

    def test_gateway_and_summary_identity(self):
        changed = evidence(capture={"identity_after": [IDENTITIES[0], identity(LITELLM_ID, "sha256:" + "9" * 64)]})
        self.assertEqual(self.verdict(changed), ("UNPROVEN", "CAPTURE_IDENTITY_CHANGED"))
        restarted = evidence(capture={"identity_after": [IDENTITIES[0], IDENTITIES[1].replace("|0|", "|1|")]})
        self.assertEqual(self.verdict(restarted), ("UNPROVEN", "CAPTURE_IDENTITY_CHANGED"))
        other_gateway = evidence(litellm={"container_id": LITELLM_ID, "image_id": LITELLM_IMAGE,
                                          "repo_digest": "ghcr.io/berriai/litellm@sha256:" + "1" * 64, "version": "1.110.0"})
        self.assertEqual(self.verdict(other_gateway), ("UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"))
        other_version = evidence(litellm={"container_id": LITELLM_ID, "image_id": LITELLM_IMAGE, "repo_digest": LITELLM_DIGEST,
                                          "version": "1.109.1"})
        self.assertEqual(self.verdict(other_version), ("UNPROVEN", "RECEIPT_VERSION_MISMATCH"))

    def test_admitted_auditor_and_contract_only(self):
        self.assertEqual(self.verdict(evidence(capture={"auditor_sha256": "0" * 64})), ("UNPROVEN", "AUDITOR_NOT_ADMITTED"))
        self.assertEqual(self.verdict(evidence(capture={"contract_sha256": "0" * 64})), ("UNPROVEN", "CONTRACT_NOT_ADMITTED"))
        self.assertEqual(self.verdict(evidence(schema="newsflux.d1-cost-authority-evidence/v2")), ("UNPROVEN", "EVIDENCE_SCHEMA"))
        self.assertEqual(self.verdict(evidence(classification="EXPLICIT_UNLIMITED_AUTHORIZED")),
                         ("UNPROVEN", "CLASSIFICATION_MISMATCH"))

    def test_nonfinancial_gates_are_kept(self):
        cases = {"KEY_IDENTITY": {"KEY_MATCH": "NONE"}, "KEY_VALIDITY": {"KEY_VALIDITY": "FAIL"},      # revoked/expired
                 "KEY_SCOPE": {"KEY_SCOPE_DETAIL": "UNRESTRICTED_ALL_MODELS"}, "KEY_ROUTES": {"KEY_ROUTES": "FAIL"},
                 "KEY_TYPE": {"KEY_TYPE": "MANAGEMENT"}, "AUTH_JWT": {"JWT_AUTH": "ENABLED"},
                 "FALLBACK": {"FALLBACK_GATE": "FAIL"}, "CALLBACKS": {"CALLBACK_GATE": "FAIL"},
                 "OBJECT_PERMISSION": {"OBJPERM_EFFECTIVE": "GRANTS_PRESENT"}}
        for gate, change in cases.items():
            self.assertEqual(self.verdict(evidence(facts={**BUDGET_FACTS, **change})),
                             ("UNPROVEN", "NONFINANCIAL_GATE_" + gate), gate)
        wildcard = {**BUDGET_FACTS, "KEY_SCOPE_DETAIL": "WILDCARD", "KEY_SCOPE_TOKEN": "STAR"}
        self.assertEqual(self.verdict(evidence(facts=wildcard)), ("UNPROVEN", "NONFINANCIAL_GATE_KEY_SCOPE"))

    def test_budget_classification(self):
        cases = {"BUDGET_NOT_PRESENT": {"KEY_MAX_BUDGET": "NONPOSITIVE"},
                 "BUDGET_WINDOW_UNRECOGNIZED": {"KEY_BUDGET_DURATION": "UNRECOGNIZED"},
                 "BUDGET_EXHAUSTED": {"KEY_SPEND_VS_MAX": "AT_OR_ABOVE"},
                 "GATEWAY_POLICY_OBSERVED_ONLY": {"KEY_LIMIT_SOURCE": "BUDGET_TABLE"}}
        for reason, change in cases.items():
            self.assertEqual(self.verdict(evidence(facts={**BUDGET_FACTS, **change})), ("UNPROVEN", reason), reason)
        self.assertEqual(self.verdict(evidence("explicit_unlimited", BUDGET_FACTS)), ("UNPROVEN", "UNLIMITED_BUT_BUDGET_PRESENT"))


class OwnerDecisionLedgerTests(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.repo, True)

        def git(*args):
            return subprocess.run(["git", "-C", self.repo, *args], capture_output=True, check=True, text=True,
                                  env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                                       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}).stdout.strip()
        self.git = git
        git("init", "-q", "-b", "main")
        path = Path(self.repo) / "ledger/decisions"
        path.mkdir(parents=True)
        self.decision = owner_decision()
        (path / "d1-unlimited.md").write_text(self.decision["text"], encoding="utf-8")
        git("add", ".")
        git("commit", "-q", "-m", "decision")
        self.commit = git("rev-parse", "HEAD")
        git("update-ref", "refs/remotes/origin/main", self.commit)
        self.decision["ref"] = DECISION_REF.replace("f" * 40, self.commit)

    def check(self, decision):
        return ev.verify_owner_decision_in_ledger(decision, self.repo)

    def test_decision_must_match_the_ledger_file_on_main(self):
        self.assertIsNone(self.check(self.decision))
        edited = dict(self.decision, text=self.decision["text"] + "edited\n")
        self.assertEqual(self.check(edited), "OWNER_DECISION_DIFFERS_FROM_LEDGER")
        self.assertEqual(self.check(dict(self.decision, ref=DECISION_REF.replace("f" * 40, "1" * 40))),
                         "OWNER_DECISION_COMMIT_UNKNOWN")
        self.assertEqual(self.check(dict(self.decision, ref=self.decision["ref"].replace("d1-unlimited", "other"))),
                         "OWNER_DECISION_NOT_IN_LEDGER")
        self.git("checkout", "-q", "-b", "side")
        Path(self.repo, "ledger/decisions/d1-unlimited.md").write_text("side\n", encoding="utf-8")
        self.git("commit", "-q", "-am", "side")
        side = self.git("rev-parse", "HEAD")
        self.assertEqual(self.check(dict(self.decision, ref=DECISION_REF.replace("f" * 40, side), text="side\n")),
                         "OWNER_DECISION_NOT_ON_LEDGER_MAIN")
        self.assertEqual(self.check(dict(self.decision, ref="https://example.com/x.md")), "OWNER_DECISION_REF_INVALID")

    def test_embedded_decision_consistency(self):
        fp = key_fingerprint(KEY)
        self.assertIsNone(ev.check_owner_decision(owner_decision(until="2026-11-20"), fp, date(2026, 11, 20)))
        self.assertEqual(ev.check_owner_decision(owner_decision(until="2026-11-20"), fp, date(2026, 11, 21)),
                         "OWNER_DECISION_EXPIRED")
        self.assertEqual(ev.check_owner_decision(owner_decision(key=OTHER_KEY), fp, date(2026, 11, 20)),
                         "OWNER_DECISION_OTHER_KEY")
        self.assertEqual(ev.check_owner_decision(owner_decision(marker=False), fp, date(2026, 11, 20)),
                         "OWNER_DECISION_MARKER_MISSING")
        tampered = owner_decision()
        tampered["text"] += "x"
        self.assertEqual(ev.check_owner_decision(tampered, fp, date(2026, 11, 20)), "OWNER_DECISION_DIGEST_MISMATCH")
        self.assertEqual(ev.check_owner_decision(None, fp, date(2026, 11, 20)), "UNLIMITED_NOT_AUTHORIZED")


class RuntimeEvaluateTests(unittest.TestCase):
    def setUp(self):
        self.dir = trusted_dir(self)

    def check(self, declaration, document, key=KEY, now=NOW, pin=True, **kwargs):
        if document is None:
            return ca.evaluate(declaration, str(Path(self.dir) / "absent.json"), key, "0" * 64, now=now, **kwargs)
        path = write_trusted(self.dir, "evidence.json", document)
        return ca.evaluate(declaration, path, key, sha_of(path) if pin is True else pin, now=now, **kwargs)

    def test_positive(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence()), ("PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"))
        self.assertEqual(self.check("explicit_unlimited", evidence("explicit_unlimited")),
                         ("PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"))

    def test_key_changed_in_the_same_container(self):
        """The capture bound key A; the container now holds key B (same container ID): never PROVEN."""
        self.assertEqual(self.check("gateway_budget_enforced", evidence(key=KEY), key=OTHER_KEY), ("UNPROVEN", "KEY_MISMATCH"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(), key=None), ("UNPROVEN", "KEY_UNAVAILABLE"))

    def test_digest_pin(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(), pin=None), ("UNPROVEN", "EVIDENCE_DIGEST_NOT_PINNED"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(), pin="0" * 64), ("UNPROVEN", "EVIDENCE_DIGEST_MISMATCH"))

    def test_old_receipt_and_redating(self):
        """Freshness is the auditor's read time inside the hashed document; re-dating changes the digest, so the
        ledger-pinned digest no longer matches, and an old capture is stale."""
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW - timedelta(days=8))),
                         ("UNPROVEN", "EVIDENCE_STALE"))
        pinned = write_trusted(self.dir, "old.json", evidence(captured=NOW - timedelta(days=8)))
        digest = sha_of(pinned)
        redated = json.loads(Path(pinned).read_text())
        redated["capture"]["prestate_captured_at"] = (NOW - timedelta(hours=1)).isoformat()
        path = write_trusted(self.dir, "old.json", redated)
        self.assertEqual(ca.evaluate("gateway_budget_enforced", path, KEY, digest, now=NOW),
                         ("UNPROVEN", "EVIDENCE_DIGEST_MISMATCH"))
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW + timedelta(hours=1))),
                         ("UNPROVEN", "EVIDENCE_FUTURE"))

    def test_file_mtime_is_irrelevant(self):
        path = write_trusted(self.dir, "e.json", evidence(captured=NOW - timedelta(days=8)))
        moment = (NOW - timedelta(minutes=1)).timestamp()
        os.utime(path, (moment, moment))
        self.assertEqual(ca.evaluate("gateway_budget_enforced", path, KEY, sha_of(path), now=NOW), ("UNPROVEN", "EVIDENCE_STALE"))

    def test_preflight_window_is_shorter(self):
        self.assertEqual(self.check("gateway_budget_enforced", evidence(captured=NOW - timedelta(hours=25)),
                                    max_age=ca.MAX_PREFLIGHT_AGE), ("UNPROVEN", "EVIDENCE_STALE"))

    def test_declaration(self):
        for declaration in (None, "", "unlimited", "true"):
            self.assertEqual(self.check(declaration, evidence())[0], "UNPROVEN", declaration)
        self.assertEqual(self.check("explicit_unlimited", evidence()), ("UNPROVEN", "DECLARATION_MISMATCH"))

    def test_unlimited_owner_decision_is_rechecked(self):
        expired = evidence("explicit_unlimited", decision=owner_decision(until="2026-11-19"))
        self.assertEqual(self.check("explicit_unlimited", expired), ("UNPROVEN", "OWNER_DECISION_EXPIRED"))
        missing = evidence("explicit_unlimited")
        missing.pop("owner_decision")
        self.assertEqual(self.check("explicit_unlimited", missing), ("UNPROVEN", "UNLIMITED_NOT_AUTHORIZED"))

    def test_missing_or_malformed(self):
        self.assertEqual(self.check("gateway_budget_enforced", None), ("UNPROVEN", "EVIDENCE_MISSING"))
        self.assertEqual(ca.evaluate("gateway_budget_enforced", None, KEY, "0" * 64), ("UNPROVEN", "EVIDENCE_MISSING"))
        self.assertEqual(self.check("gateway_budget_enforced", "{not json"), ("UNPROVEN", "EVIDENCE_MALFORMED"))
        self.assertEqual(self.check("gateway_budget_enforced", "[]"), ("UNPROVEN", "EVIDENCE_MALFORMED"))

    def test_untrusted_file(self):
        path = write_trusted(self.dir, "e.json", evidence())
        digest = sha_of(path)

        def verdict(target=path, **kwargs):
            return ca.evaluate("gateway_budget_enforced", target, KEY, digest, now=NOW, **kwargs)
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
        os.chmod(self.dir, 0o777)
        self.assertEqual(verdict(), untrusted)
        os.chmod(self.dir, 0o755)
        self.assertEqual(verdict(trusted_uid=os.geteuid() + 1), untrusted)

    def test_writable_mount_is_refused(self):
        path = write_trusted(self.dir, "e.json", evidence())
        with mock.patch.object(ca, "mount_is_readonly", lambda _p: False):
            self.assertEqual(ca.evaluate("gateway_budget_enforced", path, KEY, sha_of(path), now=NOW),
                             ("UNPROVEN", "EVIDENCE_MOUNT_NOT_READ_ONLY"))

    def test_mountinfo_parsing(self):
        info = ("22 1 0:20 / / rw,relatime - overlay overlay rw\n"
                "30 22 8:1 /root/newsflux-d1.ab/evidence.json /run/newsflux-d1/evidence.json ro,relatime - ext4 /dev/sda1 rw\n"
                "31 22 8:1 /data /data rw,relatime - ext4 /dev/sda1 rw\n")
        self.assertTrue(ca.on_readonly_mount("/run/newsflux-d1/evidence.json", info))
        self.assertFalse(ca.on_readonly_mount("/data/evidence.json", info))
        self.assertFalse(ca.on_readonly_mount("/run/newsflux-d1/other.json", info))      # falls back to rw root
        self.assertFalse(ca.on_readonly_mount("/x", ""))


class ReleasePreflightTests(unittest.TestCase):
    def setUp(self):
        self.dir = trusted_dir(self)

    def env(self, document=None, **values):
        env = {"NEWSFLUX_AI_MODEL_AUTHORITY": "litellm_key", "NEWSFLUX_AI_LITELLM_COST_AUTHORITY": "gateway_budget_enforced",
               "NEWSFLUX_AI_INFERENCE_ENABLED": "true", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "true",
               "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true"}
        if document is not None:
            self.count = getattr(self, "count", 0) + 1
            path = write_trusted(self.dir, f"e{self.count}.json", document)
            env.update(NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE=path,
                       NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256=sha_of(path))
        env.update(values)
        return {k: v for k, v in env.items() if v is not None}

    def run_preflight(self, env, *, key=KEY, models=2, callbacks="PASS"):
        return ca.preflight(env, now=NOW, key_loader=lambda _e: key, catalog=lambda _v: models,
                            callbacks=lambda _v, _k: callbacks)

    def test_mode_off_is_not_applicable_never_an_admission(self):
        for mode in (None, "", "operator_policy", "LITELLM_KEY"):
            self.assertEqual(self.run_preflight(self.env(NEWSFLUX_AI_MODEL_AUTHORITY=mode)),
                             (0, ["D1_MODEL_AUTHORITY=OFF", "D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT"]), mode)

    def test_target_configuration_passes(self):
        code, lines = self.run_preflight(self.env(evidence()))
        self.assertEqual(code, 0, lines)
        for line in ("D1_FLAGS=PASS", "D1_NO_DUPLICATE_COST_CONTROL=PASS",
                     "D1_COST_AUTHORITY=PROVEN_GATEWAY_ENFORCEMENT_EVIDENCE", "D1_NONFINANCIAL_GATES=PASS",
                     "D1_CATALOG=PASS_MODELS_2", "D1_LIVE_CALLBACKS=PASS", "D1_PREFLIGHT=PASS"):
            self.assertIn(line, lines)

    def test_holds(self):
        cases = {
            "D1_FLAGS=HOLD_INFERENCE_TRANSFER_OR_DISCOVERY_OFF":
                (self.env(evidence(), NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER="false"), {}),
            "D1_NO_DUPLICATE_COST_CONTROL=HOLD_NEWSFLUX_COST_CONFIGURED":
                (self.env(evidence(), NEWSFLUX_AI_MONTHLY_BUDGET_USD="5"), {}),
            "D1_COST_AUTHORITY=UNPROVEN_EVIDENCE_MISSING": (self.env(), {}),
            "D1_COST_AUTHORITY=UNPROVEN_EVIDENCE_STALE": (self.env(evidence(captured=NOW - timedelta(hours=25))), {}),
            "D1_COST_AUTHORITY=UNPROVEN_KEY_MISMATCH": (self.env(evidence(key=OTHER_KEY)), {}),
            "D1_CATALOG=HOLD_MODELS_0": (self.env(evidence()), {"models": 0}),
            "D1_CATALOG_UNAVAILABLE=COMPATIBILITY_UNVERIFIED:2": (self.env(evidence()), {"models": (0, "COMPATIBILITY_UNVERIFIED:2")}),
            "D1_LIVE_CALLBACKS=FAIL": (self.env(evidence()), {"callbacks": "FAIL"}),
        }
        for expected, (env, kwargs) in cases.items():
            code, lines = self.run_preflight(env, **kwargs)
            self.assertEqual(code, 3, expected)
            self.assertIn(expected, lines)
            self.assertEqual(lines[-1], "D1_PREFLIGHT=HOLD")

    def test_empty_cost_variables_count_as_absent(self):
        code, lines = self.run_preflight(self.env(evidence(), NEWSFLUX_AI_MONTHLY_BUDGET_USD=""))
        self.assertEqual(code, 0, lines)

    def test_unreadable_key_holds_and_nothing_secret_is_printed(self):
        def broken(_env):
            raise RuntimeError(KEY)
        code, lines = ca.preflight(self.env(evidence()), now=NOW, key_loader=broken)
        self.assertEqual(code, 3)
        self.assertIn("D1_COST_AUTHORITY=UNPROVEN_KEY_UNAVAILABLE", lines)
        self.assertNotIn(KEY, "\n".join(lines))
        self.assertNotIn(key_fingerprint(KEY), "\n".join(lines))

    def test_offline_only_is_never_a_plain_pass(self):
        code, lines = ca.preflight(self.env(evidence()), now=NOW, key_loader=lambda _e: KEY, live=False)
        self.assertEqual(code, 0)
        self.assertIn("D1_LIVE_GATES=NOT_RUN", lines)
        self.assertEqual(lines[-1], "D1_PREFLIGHT=PASS_OFFLINE_ONLY")

    def test_cli_mode_off(self):
        with mock.patch.dict(os.environ, {"NEWSFLUX_AI_MODEL_AUTHORITY": ""}), mock.patch("builtins.print") as printed:
            self.assertEqual(ca.main(["preflight"]), 0)
        self.assertIn("D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT", printed.call_args[0][0])


def load_capture_tool():
    spec = importlib.util.spec_from_file_location("d1_capture", REPO / "deploy/release-governance/d1_capture.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(ROOT, "the capture runs as root on the OMV (needs a root-owned /root directory)")
class CaptureToolTests(unittest.TestCase):
    """d1_capture.py: one invocation, real file writes, a fake Docker and a fake auditor (the lab runs the real ones)."""

    def setUp(self):
        self.tool = load_capture_tool()
        out = tempfile.mkdtemp(prefix="newsflux-d1.", dir="/root")
        while not self.tool.OUT_DIR.match(out):          # mktemp XXXXXXXX is alphanumeric; mkdtemp may add "_"
            os.rmdir(out)
            out = tempfile.mkdtemp(prefix="newsflux-d1.", dir="/root")
        self.addCleanup(shutil.rmtree, out, True)
        os.chmod(out, 0o700)
        self.out = out
        scratch = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, scratch, True)
        auditor = Path(scratch) / "auditor.py"
        auditor.write_text("# stand-in\n")
        self.auditor = str(auditor)
        self.auditor_sha = hashlib.sha256(auditor.read_bytes()).hexdigest()
        self.after = None
        self.audit_exit = 0
        self.facts = BUDGET_FACTS
        self.calls = []
        self.lib = self.tool.load_evidence_lib(str(REPO / "services/article_intel_summary"))
        for patcher in (mock.patch.object(self.tool, "load_evidence_lib", lambda _d: self.lib),
                        mock.patch.object(self.lib, "ADMITTED_AUDITOR_SHA256", frozenset({self.auditor_sha}))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def fake_run(self, argv, stdin=None):
        self.calls.append(argv)
        audited = any(call[0] == "python3" for call in self.calls[:-1])
        if argv[:2] == ["docker", "inspect"]:
            source = self.after if (self.after and audited) else IDENTITIES
            return SimpleNamespace(returncode=0, stdout=source[0 if argv[-1] == SUMMARY_ID else 1] + "\n")
        if argv[:3] == ["docker", "image", "inspect"]:
            if "RepoDigests" in argv[4]:
                return SimpleNamespace(returncode=0, stdout=json.dumps([LITELLM_DIGEST]))
            return SimpleNamespace(returncode=0, stdout=REVISION + "\n")
        if argv[0] == "python3":
            prestate = argv[argv.index("--private-prestate") + 1]
            data = json.dumps({"binding": {"fingerprint": key_fingerprint(KEY), "key_match": "ONE",
                                           "captured_at": datetime.now(timezone.utc).isoformat()}}).encode()
            Path(prestate).write_bytes(data)
            os.chmod(prestate, 0o600)
            text = receipt_text(self.facts, prestate_sha=hashlib.sha256(data).hexdigest())
            return SimpleNamespace(returncode=self.audit_exit, stdout=text)
        raise AssertionError(argv)

    def capture(self, euid=0, **overrides):
        values = dict(auditor=self.auditor, expect_auditor_sha256=self.auditor_sha,
                      evidence_lib=str(REPO / "services/article_intel_summary"), summary_container=SUMMARY_ID,
                      litellm_container=LITELLM_ID, expect_litellm_image=LITELLM_IMAGE, expect_repo_digest=LITELLM_DIGEST,
                      expect_litellm_version="1.110.0", project="newsflux", summary_service="summary-api",
                      declaration="gateway_budget_enforced", out_dir=self.out, owner_decision_file=None,
                      owner_decision_ref=None, ledger_repo=None)
        values.update(overrides)
        self.calls = []
        with mock.patch("builtins.print") as printed:
            code = self.tool.capture(SimpleNamespace(**values), run=self.fake_run, euid=euid)
        return code, [call.args[0] for call in printed.call_args_list]

    def clear(self):
        for name in os.listdir(self.out):
            os.unlink(os.path.join(self.out, name))

    def test_one_invocation_writes_evidence_the_runtime_accepts(self):
        code, lines = self.capture()
        self.assertEqual(code, 0, lines)
        self.assertIn("D1CAPTURE_RESULT=EVIDENCE_WRITTEN", lines)
        path = Path(self.out) / "evidence.json"
        self.assertEqual(path.stat().st_mode & 0o777, 0o644)
        self.assertEqual((Path(self.out) / "prestate.json").stat().st_mode & 0o777, 0o600)
        digest = [line.split("=", 1)[1] for line in lines if line.startswith("D1CAPTURE_EVIDENCE_SHA256=")][0]
        self.assertEqual(digest, sha_of(path))
        document = json.loads(path.read_text())
        self.assertEqual(self.lib.verify(document)[:2], ("PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"))
        self.assertNotIn(KEY, path.read_text())
        self.assertEqual(sum(1 for c in self.calls if c[0] == "python3"), 1)          # the auditor runs once
        self.assertFalse([c for c in self.calls if c[:2] == ["docker", "exec"]])        # no later exec of our own

    def test_refusals(self):
        cases = {
            "HOLD_NOT_ROOT": {"euid": 1000},
            "HOLD_OUT_DIR": {"out_dir": "/tmp/x"},
            "HOLD_AUDITOR_SHA256": {"expect_auditor_sha256": "0" * 64},
            "HOLD_LITELLM_IDENTITY": {"expect_litellm_image": "sha256:" + "2" * 64},
            "HOLD_LITELLM_REPO_DIGEST": {"expect_repo_digest": "ghcr.io/x@sha256:" + "3" * 64},
            "HOLD_SUMMARY_IDENTITY": {"project": "other"},
        }
        for result, overrides in cases.items():
            code, lines = self.capture(**overrides)
            self.assertEqual(code, 2, result)
            self.assertIn(f"D1CAPTURE_RESULT={result}", lines)
            self.clear()
        self.facts = UNLIMITED_FACTS
        code, lines = self.capture(declaration="explicit_unlimited")
        self.assertIn("D1CAPTURE_RESULT=HOLD_UNLIMITED_NOT_AUTHORIZED", lines)
        self.assertFalse(os.path.exists(Path(self.out) / "evidence.json"))

    def test_identity_change_during_the_audit(self):
        self.after = [IDENTITIES[0], IDENTITIES[1].replace("|0|", "|1|")]
        _, lines = self.capture()
        self.assertIn("D1CAPTURE_RESULT=HOLD_IDENTITY_CHANGED", lines)
        self.assertFalse(os.path.exists(Path(self.out) / "evidence.json"))

    def test_auditor_failure_or_unproven_policy_writes_nothing(self):
        self.audit_exit = 3
        _, lines = self.capture()
        self.assertIn("D1CAPTURE_RESULT=HOLD_AUDITOR_EXIT_NOT_ZERO", lines)
        self.clear()
        self.audit_exit, self.facts = 0, {**BUDGET_FACTS, "KEY_LIMIT_SOURCE": "BUDGET_TABLE"}
        _, lines = self.capture()
        self.assertIn("D1CAPTURE_RESULT=HOLD_GATEWAY_POLICY_OBSERVED_ONLY", lines)
        self.assertFalse(os.path.exists(Path(self.out) / "evidence.json"))


if __name__ == "__main__":
    unittest.main()
