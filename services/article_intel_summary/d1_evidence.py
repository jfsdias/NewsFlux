"""D1 cost-authority evidence, schema v3 (D1-R7-01): one capture binds key, time, identities, policy and receipt.

Stdlib only and importable by file path: the OMV capture (ops/deploy/release-governance/d1_capture.py, run as root
on the host, where the Summary's Python dependencies are not installed) and the Summary runtime/preflight
(services.article_intel_summary.cost_authority) judge the same document with the same code.

What one capture proves (and how)
  key        the authorized auditor (57c536f, sha256 pinned) reads the Summary key fingerprint and matches it
             against the LiteLLM DB in ONE run; with --private-prestate it writes that same fingerprint into a
             root-only prestate (binding.fingerprint) and prints the prestate's sha256 in its own receipt. No
             later docker exec is involved, so a key changed afterwards cannot inherit the observed policy.
  time       binding.captured_at is set by the auditor's probe at read time, inside the hashed prestate; it must
             lie inside the capture window [started_at, finished_at] recorded by the same root process.
  identity   Summary and LiteLLM identity lines (ID, image, start time, restarts, state, compose labels) are
             read before and after the auditor and must be identical; LiteLLM image ID and repo digest pinned.
  receipt    the auditor's stdout is kept whole and judged by the verbatim admitted contract
             (d1_receipt_contract), including the exit-code coherence rules; the exit code is stored and must be 0.
  policy     budget facts, plus the non-financial gates (scope, routes, auth, fallback, callbacks, object
             permissions) from the same receipt.
  external   the evidence digest is recorded in the homeserver ledger and pinned in the deployment config
             (NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256); a document re-dated or rebuilt has another
             digest. The owner decision (explicit_unlimited only) is checked against the ledger git history.

Trust model, stated: root on the OMV is the operational authority (no new signer, no PKI). Root could forge a
capture; the ledger record of the digest, made at capture time, is the external witness.
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import subprocess
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

EVIDENCE_SCHEMA = "newsflux.d1-cost-authority-evidence/v3"
DECLARATIONS = ("gateway_budget_enforced", "explicit_unlimited")
# Auditor builds whose contract is admitted (PM: G2_REMOTE_CI=ACCEPTED_EXACT_SHA for 57c536f).
ADMITTED_AUDITOR_SHA256 = frozenset({"6e5bef4ed383e43b16264ce4a94bd82ad5f4b0523b1bbf2b57e7576490f14d11"})
# LiteLLM images whose enforcement of a key-level max_budget was proven in the disposable lab with a positive
# control (rehearse-d1-budget-enforcement.sh): (image ID, repo digest). The production pin is the R5 operator
# command's --expect-image-id / --expect-repo-digest. Version strings alone are not enough.
# The same immutable image has two IDs depending on the Docker image store: the config digest on the classic
# store (the OMV: 95017a67…) and the index digest on the containerd snapshotter (eb7a0ad…, = the repo digest).
_LITELLM_1_110_0 = "ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a"
BUDGET_ENFORCEMENT_PROVEN_IMAGES = frozenset({
    ("sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab", _LITELLM_1_110_0),
    ("sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a", _LITELLM_1_110_0),
})
MAX_CAPTURE_WINDOW = timedelta(minutes=10)
POSITIVE_BUDGET = frozenset({"OK", "APP_CAP_MISSING", "ABOVE_APP_CAP"})
RECOGNIZED_WINDOWS = frozenset({"CALENDAR_MONTH", "DAILY", "WEEKLY", "OTHER_WINDOW"})
SCOPED_KEY = frozenset({"EXACT_ALIAS", "EXTRA_MODELS", "OTHER_MODEL"})   # an explicit model list (never "all")
PRESTATE_WRITTEN = "S5R3_PRIVATE_PRESTATE=WRITTEN"
PRESTATE_SHA = re.compile(r"^S5R3_PRIVATE_PRESTATE_SHA256=([0-9a-f]{64})$")
AUDIT_COMPLETE = "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY"
OWNER_DECISION_REF = re.compile(
    r"^https://github\.com/jfsdias/homeserver/blob/([0-9a-f]{40})/(ledger/decisions/[A-Za-z0-9._-]{1,120}\.md)$")
OWNER_MARKER = re.compile(r"^NEWSFLUX_D1_EXPLICIT_UNLIMITED key_fingerprint_prefix=([0-9a-f]{16}) until=(\d{4}-\d{2}-\d{2})$",
                          re.M)
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_IMAGE = re.compile(r"^sha256:[0-9a-f]{64}$")
_REPO_DIGEST = re.compile(r"^[a-z0-9./_-]{1,200}@sha256:[0-9a-f]{64}$")
_VERSION = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,6}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _load_contract():
    spec = importlib.util.spec_from_file_location("newsflux_d1_receipt_contract",
                                                  Path(__file__).with_name("d1_receipt_contract.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


contract = _load_contract()


def fmt(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not _TIME.match(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_iso(value: object) -> datetime | None:
    """The auditor's prestate timestamp (datetime.isoformat with an explicit UTC offset)."""
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment.astimezone(timezone.utc) if moment.tzinfo is not None else None


def split_receipt(text: str) -> tuple[str | None, str, str]:
    """(problem, contract_text, prestate_sha256). The auditor's prestate mode adds exactly two lines right before
    S5R1_AUDIT; everything else is judged by the verbatim contract (which itself refuses any PRESTATE line)."""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    try:
        audit = lines.index(AUDIT_COMPLETE)
    except ValueError:
        return "RECEIPT_NOT_COMPLETE", "", ""
    if audit < 2 or lines[audit - 2] != PRESTATE_WRITTEN:
        return "RECEIPT_PRESTATE_NOT_WRITTEN", "", ""
    match = PRESTATE_SHA.match(lines[audit - 1])
    if not match:
        return "RECEIPT_PRESTATE_NOT_WRITTEN", "", ""
    rest = lines[:audit - 2] + lines[audit:]
    return None, "\n".join(rest) + "\n", match.group(1)


def receipt_facts(contract_text: str, exit_code: object, version_token: str) -> tuple[str | None, dict[str, str]]:
    if type(exit_code) is not int:  # noqa: E721 - bool is not an exit code
        return "AUDITOR_EXIT_MISSING", {}
    verdict, kept = contract.validate(contract_text, exit_code, version_token)
    if verdict != "OK":
        return "RECEIPT_" + verdict if not verdict.startswith(("RECEIPT_", "AUDITOR_")) else verdict, {}
    facts = {}
    for line in kept:
        name, _, value = line.partition("=")
        facts[name.removeprefix("S5R1_")] = value
    return None, facts


def nonfinancial_gates(facts: dict[str, str]) -> dict[str, str]:
    """D1 keeps every non-financial gate: key identity/validity, scope, routes, auth, fallback, callbacks,
    object permissions. Each is PASS or the observed classification."""
    def gate(ok: bool, observed: str | None) -> str:
        return "PASS" if ok else (observed or "MISSING")
    return {
        "KEY_IDENTITY": gate(facts.get("KEY_MATCH") == "ONE", facts.get("KEY_MATCH")),
        "KEY_VALIDITY": gate(facts.get("KEY_VALIDITY") == "PASS", facts.get("KEY_VALIDITY")),
        "KEY_SCOPE": gate(facts.get("KEY_SCOPE_DETAIL") in SCOPED_KEY and facts.get("KEY_SCOPE_TOKEN", "NONE") == "NONE",
                          facts.get("KEY_SCOPE_DETAIL")),
        "KEY_ROUTES": gate(facts.get("KEY_ROUTES") == "PASS", facts.get("KEY_ROUTES")),
        "KEY_TYPE": gate(facts.get("KEY_TYPE", "NONE") != "MANAGEMENT", facts.get("KEY_TYPE")),
        "AUTH_JWT": gate(facts.get("JWT_AUTH") == "DISABLED", facts.get("JWT_AUTH")),
        "INDIRECTION": gate(facts.get("KEY_EXTRA_INDIRECTION", "NONE") == "NONE", facts.get("KEY_EXTRA_INDIRECTION")),
        "OBJECT_PERMISSION": gate(facts.get("OBJPERM_EFFECTIVE", "NONE") in ("NONE", "EMPTY"), facts.get("OBJPERM_EFFECTIVE")),
        "FALLBACK": gate(facts.get("FALLBACK_GATE") == "PASS", facts.get("FALLBACK_GATE")),
        "CALLBACKS": gate(facts.get("CALLBACK_GATE") == "PASS", facts.get("CALLBACK_GATE")),
    }


def classify(declaration: str, facts: dict[str, str], litellm: dict[str, Any]) -> tuple[str, str]:
    failed = [name for name, value in nonfinancial_gates(facts).items() if value != "PASS"]
    if failed:
        return "UNPROVEN", "NONFINANCIAL_GATE_" + failed[0]
    budget = facts.get("KEY_MAX_BUDGET")
    if declaration == "gateway_budget_enforced":
        if budget not in POSITIVE_BUDGET:
            return "UNPROVEN", "BUDGET_NOT_PRESENT"
        if facts.get("KEY_BUDGET_DURATION") not in RECOGNIZED_WINDOWS:
            return "UNPROVEN", "BUDGET_WINDOW_UNRECOGNIZED"
        if facts.get("KEY_SPEND_VS_MAX") != "BELOW":
            return "UNPROVEN", "BUDGET_EXHAUSTED"
        if facts.get("KEY_LIMIT_SOURCE") != "KEY":
            return "UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"   # budget-table enforcement not lab-proven
        if (litellm.get("image_id"), litellm.get("repo_digest")) not in BUDGET_ENFORCEMENT_PROVEN_IMAGES:
            return "UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"   # enforcement not proven for this exact image
        return "PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"
    if declaration == "explicit_unlimited":
        if budget != "MISSING":
            return "UNPROVEN", "UNLIMITED_BUT_BUDGET_PRESENT"
        return "PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"
    return "UNPROVEN", "DECLARATION_UNKNOWN"


def check_owner_decision(decision: object, fingerprint: str, today: date) -> str | None:
    """Internal consistency of the embedded owner decision. Its correspondence with the ledger is checked
    separately (verify_owner_decision_in_ledger) where a homeserver checkout exists."""
    if not isinstance(decision, dict):
        return "UNLIMITED_NOT_AUTHORIZED"
    ref, text, digest = decision.get("ref"), decision.get("text"), decision.get("sha256")
    if not isinstance(ref, str) or not OWNER_DECISION_REF.match(ref):
        return "OWNER_DECISION_REF_INVALID"
    if not isinstance(text, str) or not isinstance(digest, str) or hashlib.sha256(text.encode("utf-8")).hexdigest() != digest:
        return "OWNER_DECISION_DIGEST_MISMATCH"
    markers = OWNER_MARKER.findall(text)
    if len(markers) != 1:
        return "OWNER_DECISION_MARKER_MISSING"
    prefix, until = markers[0]
    if prefix != fingerprint[:16]:
        return "OWNER_DECISION_OTHER_KEY"
    try:
        if date.fromisoformat(until) < today:
            return "OWNER_DECISION_EXPIRED"
    except ValueError:
        return "OWNER_DECISION_MARKER_MISSING"
    return None


def verify_owner_decision_in_ledger(decision: dict[str, Any], ledger_repo: str, *, main_ref: str = "refs/remotes/origin/main",
                                    git=None) -> str | None:
    """The embedded decision must be byte-identical to the file at the pinned commit of a homeserver checkout, and
    that commit must be on the ledger's main line. Uses git only (no network)."""
    git = git or (lambda *args: subprocess.run(["git", "-C", ledger_repo, *args], capture_output=True, timeout=30, check=False))
    match = OWNER_DECISION_REF.match(str(decision.get("ref", "")))
    if not match:
        return "OWNER_DECISION_REF_INVALID"
    commit, path = match.groups()
    if git("cat-file", "-e", commit + "^{commit}").returncode != 0:
        return "OWNER_DECISION_COMMIT_UNKNOWN"
    if git("merge-base", "--is-ancestor", commit, main_ref).returncode != 0:
        return "OWNER_DECISION_NOT_ON_LEDGER_MAIN"
    shown = git("show", f"{commit}:{path}")
    if shown.returncode != 0:
        return "OWNER_DECISION_NOT_IN_LEDGER"
    if shown.stdout != str(decision.get("text", "")).encode("utf-8"):
        return "OWNER_DECISION_DIFFERS_FROM_LEDGER"
    return None


def _identity(line: object, container_id: str, image_id: str) -> bool:
    if not isinstance(line, str) or len(line) > 400:
        return False
    parts = line.split("|")
    return len(parts) == 7 and parts[0] == container_id and parts[1] == image_id and parts[4] == "running"


def verify(document: object, *, check_classification: bool = True) -> tuple[str, str, dict[str, Any]]:
    """("PROVEN", classification, info) or ("UNPROVEN", reason, {}). Everything except the key comparison,
    freshness, file trust, digest pin and ledger check, which depend on where it is evaluated."""
    if not isinstance(document, dict):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if document.get("schema") != EVIDENCE_SCHEMA:
        return "UNPROVEN", "EVIDENCE_SCHEMA", {}
    declaration = document.get("declaration")
    if declaration not in DECLARATIONS:
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    capture = document.get("capture")
    if not isinstance(capture, dict):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    summary, litellm = capture.get("summary"), capture.get("litellm")
    if not isinstance(summary, dict) or not isinstance(litellm, dict):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if capture.get("auditor_sha256") not in ADMITTED_AUDITOR_SHA256:
        return "UNPROVEN", "AUDITOR_NOT_ADMITTED", {}
    if capture.get("contract_sha256") != contract_sha256():
        return "UNPROVEN", "CONTRACT_NOT_ADMITTED", {}
    receipt = capture.get("receipt_text")
    if not isinstance(receipt, str) or len(receipt) > 32 * 1024:
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if capture.get("receipt_sha256") != hashlib.sha256(receipt.encode("utf-8")).hexdigest():
        return "UNPROVEN", "RECEIPT_DIGEST_MISMATCH", {}
    version = litellm.get("version")
    if not isinstance(version, str) or not _VERSION.match(version):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    problem, contract_text, prestate_sha = split_receipt(receipt)
    if problem:
        return "UNPROVEN", problem, {}
    if capture.get("auditor_exit") != 0 or type(capture.get("auditor_exit")) is not int:  # noqa: E721
        return "UNPROVEN", "AUDITOR_EXIT_NOT_ZERO", {}
    problem, facts = receipt_facts(contract_text, capture.get("auditor_exit"), version.replace(".", "_"))
    if problem:
        return "UNPROVEN", problem, {}
    if capture.get("prestate_sha256") != prestate_sha:
        return "UNPROVEN", "PRESTATE_DIGEST_MISMATCH", {}
    fingerprint = capture.get("key_fingerprint")
    if not isinstance(fingerprint, str) or not _HEX64.match(fingerprint):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    started, finished = parse_time(capture.get("started_at")), parse_time(capture.get("finished_at"))
    captured = parse_iso(capture.get("prestate_captured_at"))
    if started is None or finished is None or captured is None:
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if not (started - timedelta(seconds=1) <= captured <= finished + timedelta(seconds=1)) or finished - started > MAX_CAPTURE_WINDOW:
        return "UNPROVEN", "CAPTURE_TIME_INCOHERENT", {}
    for field, pattern in (("container_id", _HEX64), ("image_id", _IMAGE)):
        if not isinstance(summary.get(field), str) or not pattern.match(summary[field]):
            return "UNPROVEN", "EVIDENCE_MALFORMED", {}
        if not isinstance(litellm.get(field), str) or not pattern.match(litellm[field]):
            return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if not isinstance(summary.get("revision"), str) or not _HEX40.match(summary["revision"]):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    if not isinstance(litellm.get("repo_digest"), str) or not _REPO_DIGEST.match(litellm["repo_digest"]):
        return "UNPROVEN", "EVIDENCE_MALFORMED", {}
    before, after = capture.get("identity_before"), capture.get("identity_after")
    if (not isinstance(before, list) or len(before) != 2 or before != after
            or not _identity(before[0], summary["container_id"], summary["image_id"])
            or not _identity(before[1], litellm["container_id"], litellm["image_id"])):
        return "UNPROVEN", "CAPTURE_IDENTITY_CHANGED", {}
    verdict, reason = classify(declaration, facts, litellm)
    if verdict != "PROVEN":
        return verdict, reason, {}
    if check_classification and document.get("classification") != reason:
        return "UNPROVEN", "CLASSIFICATION_MISMATCH", {}
    info = {"declaration": declaration, "key_fingerprint": fingerprint, "captured_at": captured,
            "litellm": dict(litellm), "summary": dict(summary), "facts": facts}
    return "PROVEN", reason, info


def contract_sha256() -> str:
    return contract.__dict__.get("VERBATIM_SHA256", "")
