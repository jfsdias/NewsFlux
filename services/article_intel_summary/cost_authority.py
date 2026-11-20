"""D1 successor: LiteLLM as the cost authority, admitted only with trusted evidence (D1-R6-01).

Trust chain (proportional to a read-only diagnostic; no new signing infrastructure):

1. CAPTURE  the authorized read-only executor (s5-r3-omv-executor.sh) writes the contract-validated receipt to
            its private root-only workdir (/root/s5r3-exec.XXXXXXXX/run/receipt.txt, 0600). The builder runs as
            root on that host and reads ONLY that file: the capture instant is the receipt's own mtime, the
            digest is computed here, and nothing about the capture is accepted from the command line.
2. KEY      the builder asks the Summary container named in the receipt (after re-checking its full ID and
            image) for the fingerprint of the key it holds, with the auditor's own code path. The fingerprint
            is a one-way digest; the key never leaves the container.
3. RECEIPT  the evidence embeds the whole sanitized receipt. The runtime and the release preflight re-hash it
            and re-validate the complete contract (single success footer, no HOLD, no duplicate field,
            admitted diagnostic HEAD, unchanged identity) instead of trusting a summary of it.
4. POLICY   GATEWAY_POLICY_OBSERVED (a positive key-level max_budget, a recognized window, spend below) is not
            enough: it becomes GATEWAY_ENFORCEMENT_EVIDENCE only for a LiteLLM version whose enforcement of key
            max_budget was proven in the disposable lab (rehearse-d1-budget-enforcement.sh). Budgets that come
            from a budget table are observed only.
5. OWNER    explicit_unlimited needs the owner's decision document (homeserver ledger, pinned commit) embedded
            in the evidence with its digest; it must carry the marker line bound to this key's fingerprint
            prefix and an expiry date. An arbitrary URL is not a decision.
6. FILE     the evidence file is root-owned, not group/other-writable, read through O_NOFOLLOW and checked on
            the open descriptor (no lstat/open race).

Limits (stated, not hidden): root on the OMV is the trust anchor; a policy change on the same key, a removed
budget or a revoked key is not visible to NewsFlux until the next capture (the virtual key cannot read its
own policy). Evidence therefore expires: runtime after MAX_EVIDENCE_AGE, release preflight after
MAX_PREFLIGHT_AGE; any LiteLLM key edit requires a new capture. A revoked key also makes discovery fail, so
nothing is offered. No price, budget amount or spend amount is read, stored or shown by NewsFlux.

    python -m services.article_intel_summary.cost_authority build --exec-workdir /root/s5r3-exec.XXXXXXXX/run \
        --declaration gateway_budget_enforced|explicit_unlimited --out <evidence.json> \
        [--owner-decision-file <ledger copy> --owner-decision-ref <pinned homeserver URL>]
    python -m services.article_intel_summary.cost_authority preflight      # inside the Summary container
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from collections.abc import Callable, Mapping
from datetime import date, datetime, timedelta, timezone
from typing import Any

from services.article_intel_summary.s5_preflight import key_fingerprint

EVIDENCE_SCHEMA = "newsflux.d1-cost-authority-evidence/v2"
DECLARATIONS = ("gateway_budget_enforced", "explicit_unlimited")
MAX_EVIDENCE_AGE = timedelta(days=7)
MAX_PREFLIGHT_AGE = timedelta(hours=24)
MAX_BUILD_DELAY = timedelta(hours=24)
MAX_EVIDENCE_BYTES = 64 * 1024
MAX_RECEIPT_BYTES = 32 * 1024
TRUSTED_UID = 0
# Diagnostic HEADs whose executor/receipt contract is admitted (PM: G2_REMOTE_CI=ACCEPTED_EXACT_SHA).
ADMITTED_DIAGNOSTIC_HEADS = frozenset({"57c536fb583a52bb42a88d9a1b051869abc64b1f"})
# LiteLLM versions whose enforcement of a key-level max_budget was proven in the lab
# (deploy/release-governance/rehearse-d1-budget-enforcement.sh: over-budget key refused with
# budget_exceeded before routing, under-budget key admitted; 2026-11-20).
BUDGET_ENFORCEMENT_PROVEN_VERSIONS = frozenset({"1_109_1", "1_110_0"})
POSITIVE_BUDGET = frozenset({"OK", "APP_CAP_MISSING", "ABOVE_APP_CAP"})
RECOGNIZED_WINDOWS = frozenset({"CALENDAR_MONTH", "DAILY", "WEEKLY", "OTHER_WINDOW"})
SUCCESS_FOOTER = "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY"
OWNER_DECISION_REF = re.compile(
    r"^https://github\.com/jfsdias/homeserver/blob/[0-9a-f]{40}/ledger/decisions/[A-Za-z0-9._-]{1,120}\.md$")
OWNER_MARKER = re.compile(r"^NEWSFLUX_D1_EXPLICIT_UNLIMITED key_fingerprint_prefix=([0-9a-f]{16}) until=(\d{4}-\d{2}-\d{2})$",
                          re.M)
EXEC_WORKDIR = re.compile(r"^/root/s5r3-exec\.[A-Za-z0-9]{8}/run$")
_LINE = re.compile(r"^(S5R3_RUN|S5R1)_([A-Z0-9_]{1,64})=([A-Za-z0-9_,.:-]{1,512})$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_HEX40 = re.compile(r"^[0-9a-f]{40}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# Same code path as the auditor's SUMMARY_SNIPPET (s5_db_readonly_audit.py): the key that KEY_MATCH refers to.
# If the admin store holds a different (managed) key, the runtime key differs and the evidence is KEY_MISMATCH.
FINGERPRINT_SNIPPET = (
    "import os;"
    "from services.article_intel_summary.litellm_adapter import load_litellm_settings;"
    "from services.article_intel_summary.s5_preflight import key_fingerprint, simulated_environment;"
    "s=load_litellm_settings(simulated_environment(os.environ));"
    "print(key_fingerprint(s.virtual_key) if s.virtual_key else '')"
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _fmt(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not _TIME.match(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ------------------------------------------------------------------------------------------------ trusted read
def read_trusted(path: str, *, max_bytes: int, private: bool = False, uid: int | None = None) -> tuple[str | None, bytes]:
    """(problem, data). Regular file owned by `uid` (default TRUSTED_UID, root), not group/other-writable (private:
    no group/other access at all), opened with O_NOFOLLOW and checked on the descriptor itself, in a directory
    owned by the same uid and not group/other-writable. Not configurable from the environment."""
    uid = TRUSTED_UID if uid is None else uid
    try:
        parent = os.lstat(os.path.dirname(os.path.abspath(path)) or "/")
    except OSError:
        return "UNTRUSTED_FILE", b""
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != uid or parent.st_mode & 0o022:
        return "UNTRUSTED_FILE", b""
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    except FileNotFoundError:
        return "MISSING", b""
    except OSError:
        return "UNTRUSTED_FILE", b""
    try:
        info = os.fstat(descriptor)
        mask = 0o077 if private else 0o022
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & mask or info.st_size > max_bytes:
            return "UNTRUSTED_FILE", b""
        data = os.read(descriptor, max_bytes + 1)
        if len(data) > max_bytes:
            return "UNTRUSTED_FILE", b""
        return None, data
    finally:
        os.close(descriptor)


# ------------------------------------------------------------------------------------------------ receipt contract
def parse_receipt(text: str) -> tuple[str | None, dict[str, str], dict[str, str]]:
    """(problem, S5R1 facts, capture identity) from a complete success receipt of the authorized executor."""
    lines = [line for line in text.split("\n") if line != ""]
    if not lines or lines[-1] != SUCCESS_FOOTER:
        return "RECEIPT_NOT_COMPLETE", {}, {}
    run: dict[str, str] = {}
    facts: dict[str, str] = {}
    for line in lines:
        match = _LINE.match(line)
        if not match:
            return "RECEIPT_UNEXPECTED_LINE", {}, {}
        family, name, value = match.groups()
        target = run if family == "S5R3_RUN" else facts
        if name in target:
            return "RECEIPT_DUPLICATE_FIELD", {}, {}
        if value.startswith("HOLD") or value == "FAIL" and name.endswith("_GATE"):
            return "RECEIPT_HOLD", {}, {}
        target[name] = value
    expected = {"RESULT": "COMPLETE_DIAGNOSTIC_ONLY_READONLY", "POST_GATES": "PASS", "PRIVATE_PRESTATE": "OFF",
                "SOURCE_GATE": "PASS_EXACT_HEAD", "SUMMARY_REVISION_GATE": "PASS", "LITELLM_IDENTITY_GATE": "PASS"}
    if any(run.get(name) != value for name, value in expected.items()):
        return "RECEIPT_NOT_COMPLETE", {}, {}
    if facts.get("AUDIT") != "COMPLETE_DIAGNOSTIC_ONLY" or facts.get("CONTAINER_IDENTITY") != "UNCHANGED":
        return "RECEIPT_NOT_COMPLETE", {}, {}
    if run.get("CI_HEAD_SHA") not in ADMITTED_DIAGNOSTIC_HEADS:
        return "RECEIPT_HEAD_NOT_ADMITTED", {}, {}
    capture = {"diagnostic_head": run["CI_HEAD_SHA"], "summary_container_id": run.get("SUMMARY_CONTAINER_ID", ""),
               "summary_image_id": run.get("SUMMARY_IMAGE_ID", ""), "live_summary_revision": run.get("LIVE_SUMMARY_REVISION", ""),
               "litellm_version": facts.get("LITELLM_VERSION", ""), "image_version_binding": run.get("IMAGE_VERSION_BINDING", "")}
    if (not _HEX64.match(capture["summary_container_id"]) or not re.fullmatch(r"sha256:[0-9a-f]{64}", capture["summary_image_id"])
            or not _HEX40.match(capture["live_summary_revision"])
            or capture["image_version_binding"] != "PASS_" + capture["litellm_version"]):
        return "RECEIPT_IDENTITY_INCOMPLETE", {}, {}
    return None, facts, capture


def classify(declaration: str, facts: Mapping[str, str], capture: Mapping[str, str]) -> tuple[str, str]:
    """GATEWAY_ENFORCEMENT_EVIDENCE / EXPLICIT_UNLIMITED (pending owner check) / reasons. Policy observed alone is
    reported as GATEWAY_POLICY_OBSERVED_ONLY and never admits."""
    if facts.get("KEY_MATCH") != "ONE":
        return "UNPROVEN", "KEY_NOT_MATCHED"
    if facts.get("KEY_VALIDITY") != "PASS":
        return "UNPROVEN", "KEY_INVALID"
    budget = facts.get("KEY_MAX_BUDGET")
    if declaration == "gateway_budget_enforced":
        if budget not in POSITIVE_BUDGET:
            return "UNPROVEN", "BUDGET_NOT_PRESENT"
        if facts.get("KEY_BUDGET_DURATION") not in RECOGNIZED_WINDOWS:
            return "UNPROVEN", "BUDGET_WINDOW_UNRECOGNIZED"
        if facts.get("KEY_SPEND_VS_MAX") != "BELOW":
            return "UNPROVEN", "BUDGET_EXHAUSTED"
        if facts.get("KEY_LIMIT_SOURCE") != "KEY":
            return "UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"     # budget-table enforcement not lab-proven
        if capture.get("litellm_version") not in BUDGET_ENFORCEMENT_PROVEN_VERSIONS:
            return "UNPROVEN", "GATEWAY_POLICY_OBSERVED_ONLY"     # enforcement not proven for this version
        return "PROVEN", "GATEWAY_ENFORCEMENT_EVIDENCE"
    if declaration == "explicit_unlimited":
        if budget != "MISSING":
            return "UNPROVEN", "UNLIMITED_BUT_BUDGET_PRESENT"
        return "PROVEN", "EXPLICIT_UNLIMITED_AUTHORIZED"
    return "UNPROVEN", "DECLARATION_UNKNOWN"


def check_owner_decision(decision: object, fingerprint: str, today: date) -> str | None:
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


# ------------------------------------------------------------------------------------------------ runtime / preflight
def evaluate(declaration: str | None, evidence_path: str | None, virtual_key: str | None, *,
             now: datetime | None = None, max_age: timedelta = MAX_EVIDENCE_AGE,
             trusted_uid: int | None = None) -> tuple[str, str]:
    """("PROVEN", GATEWAY_ENFORCEMENT_EVIDENCE|EXPLICIT_UNLIMITED_AUTHORIZED) or ("UNPROVEN", reason). Never raises."""
    now = now or _now()
    declaration = (declaration or "").strip()
    if declaration not in DECLARATIONS:
        return "UNPROVEN", "DECLARATION_MISSING" if not declaration else "DECLARATION_UNKNOWN"
    if not evidence_path:
        return "UNPROVEN", "EVIDENCE_MISSING"
    problem, raw = read_trusted(evidence_path, max_bytes=MAX_EVIDENCE_BYTES, uid=trusted_uid)
    if problem:
        return "UNPROVEN", "EVIDENCE_MISSING" if problem == "MISSING" else "EVIDENCE_UNTRUSTED_FILE"
    try:
        document = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if not isinstance(document, dict):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if document.get("schema") != EVIDENCE_SCHEMA:
        return "UNPROVEN", "EVIDENCE_SCHEMA"
    receipt = document.get("receipt_text")
    if not isinstance(receipt, str) or len(receipt.encode("utf-8")) > MAX_RECEIPT_BYTES:
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if document.get("receipt_sha256") != hashlib.sha256(receipt.encode("utf-8")).hexdigest():
        return "UNPROVEN", "RECEIPT_DIGEST_MISMATCH"
    problem, facts, capture = parse_receipt(receipt)
    if problem:
        return "UNPROVEN", problem
    if document.get("capture") != capture:
        return "UNPROVEN", "CAPTURE_IDENTITY_MISMATCH"
    fingerprint = document.get("key_fingerprint")
    if not isinstance(fingerprint, str) or not _HEX64.match(fingerprint):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    captured = _parse_time(document.get("captured_at"))
    if captured is None:
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if not virtual_key:
        return "UNPROVEN", "KEY_UNAVAILABLE"
    if fingerprint != key_fingerprint(virtual_key):
        return "UNPROVEN", "KEY_MISMATCH"
    if captured > now + timedelta(minutes=5):
        return "UNPROVEN", "EVIDENCE_FUTURE"
    if now - captured > max_age:
        return "UNPROVEN", "EVIDENCE_STALE"
    if document.get("declaration") != declaration:
        return "UNPROVEN", "DECLARATION_MISMATCH"
    verdict, reason = classify(declaration, facts, capture)
    if verdict != "PROVEN":
        return verdict, reason
    if declaration == "explicit_unlimited":
        owner_problem = check_owner_decision(document.get("owner_decision"), fingerprint, now.date())
        if owner_problem:
            return "UNPROVEN", owner_problem
    return verdict, reason


def effective_virtual_key(values: Mapping[str, str]) -> str | None:
    """The key the catalog would use: the managed key when the admin store has one, else the bootstrap key file.
    A store that cannot be read gives no key (fail closed, as the catalog does)."""
    from services.article_intel_summary.admin_settings import ManagedSettingsStore
    from services.article_intel_summary.litellm_adapter import _read_private_secret_file
    try:
        managed = ManagedSettingsStore(values).effective_values(values).get("__newsflux_managed_virtual_key")
    except Exception:  # noqa: BLE001 - unreadable managed state: no key
        return None
    if managed:
        return managed
    return _read_private_secret_file(values.get("NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE"))


def preflight(values: Mapping[str, str], *, now: datetime | None = None, key_loader: Callable[[Mapping[str, str]], str | None] | None = None,
              trusted_uid: int | None = None) -> tuple[int, list[str]]:
    """Release preflight (inside the Summary container). Mode off: not applicable, legacy contract unchanged."""
    mode = (values.get("NEWSFLUX_AI_MODEL_AUTHORITY") or "").strip()
    if mode != "litellm_key":
        return 0, ["D1_MODEL_AUTHORITY=OFF", "D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT"]
    key_loader = key_loader or effective_virtual_key
    try:
        key = key_loader(values)
    except Exception:  # noqa: BLE001 - a key that cannot be read is simply unavailable
        key = None
    verdict, reason = evaluate(values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY"),
                               values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE"), key,
                               now=now, max_age=MAX_PREFLIGHT_AGE, trusted_uid=trusted_uid)
    lines = ["D1_MODEL_AUTHORITY=LITELLM_KEY", f"D1_COST_AUTHORITY={verdict}_{reason}", "SECRET_PRINTED=NO"]
    lines.append("D1_PREFLIGHT=PASS" if verdict == "PROVEN" else "D1_PREFLIGHT=HOLD")
    return (0 if verdict == "PROVEN" else 3), lines


# ------------------------------------------------------------------------------------------------ builder (OMV, root)
def _docker(argv: list[str]) -> str:
    return subprocess.run(argv, capture_output=True, text=True, check=True, timeout=60).stdout


def build(workdir: str, declaration: str, out: str, *, owner_decision_file: str | None = None,
          owner_decision_ref: str | None = None, run: Callable[[list[str]], str] = _docker,
          euid: int | None = None, now: datetime | None = None) -> tuple[str, dict[str, Any] | None]:
    now = now or _now()
    if (os.geteuid() if euid is None else euid) != 0:
        return "NOT_ROOT", None
    if declaration not in DECLARATIONS:
        return "DECLARATION_UNKNOWN", None
    if not EXEC_WORKDIR.match(workdir):
        return "WORKDIR_NOT_AUTHORIZED_EXECUTOR", None
    try:
        info = os.lstat(workdir)
    except OSError:
        return "WORKDIR_MISSING", None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        return "WORKDIR_UNTRUSTED", None
    receipt_path = os.path.join(workdir, "receipt.txt")
    problem, raw = read_trusted(receipt_path, max_bytes=MAX_RECEIPT_BYTES, private=True, uid=0)
    if problem:
        return "RECEIPT_" + ("MISSING" if problem == "MISSING" else "UNTRUSTED_FILE"), None
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        return "RECEIPT_UNREADABLE", None
    captured = datetime.fromtimestamp(os.stat(receipt_path, follow_symlinks=False).st_mtime, tz=timezone.utc)
    if captured > now + timedelta(minutes=5):
        return "CAPTURE_IN_FUTURE", None
    if now - captured > MAX_BUILD_DELAY:
        return "CAPTURE_TOO_OLD", None
    problem, facts, capture = parse_receipt(text)
    if problem:
        return problem, None
    verdict, reason = classify(declaration, facts, capture)
    if verdict != "PROVEN":
        return reason, None
    # The Summary container of the capture, still the same one, reports the fingerprint of the key it holds.
    try:
        identity = run(["docker", "inspect", "--format", "{{.Id}} {{.Image}} {{.State.Status}}",
                        capture["summary_container_id"]]).split()
    except (OSError, subprocess.SubprocessError):
        return "SUMMARY_CONTAINER_UNAVAILABLE", None
    if identity != [capture["summary_container_id"], capture["summary_image_id"], "running"]:
        return "SUMMARY_CONTAINER_CHANGED", None
    try:
        fingerprint = run(["docker", "exec", "-u", "10001", capture["summary_container_id"], "python", "-B", "-c",
                           FINGERPRINT_SNIPPET]).strip()
    except (OSError, subprocess.SubprocessError):
        return "FINGERPRINT_UNAVAILABLE", None
    if not _HEX64.match(fingerprint):
        return "FINGERPRINT_UNAVAILABLE", None
    document: dict[str, Any] = {
        "schema": EVIDENCE_SCHEMA, "declaration": declaration, "captured_at": _fmt(captured), "built_at": _fmt(now),
        "source": "s5-r3-omv-executor/receipt.txt", "receipt_text": text,
        "receipt_sha256": hashlib.sha256(raw).hexdigest(), "capture": capture, "key_fingerprint": fingerprint,
        "classification": reason,
    }
    if declaration == "explicit_unlimited":
        if not owner_decision_file or not owner_decision_ref:
            return "UNLIMITED_NOT_AUTHORIZED", None
        problem, decision_raw = read_trusted(owner_decision_file, max_bytes=MAX_EVIDENCE_BYTES // 2, uid=0)
        if problem:
            return "OWNER_DECISION_UNTRUSTED_FILE", None
        decision_text = decision_raw.decode("utf-8", "replace")
        document["owner_decision"] = {"ref": owner_decision_ref, "text": decision_text,
                                      "sha256": hashlib.sha256(decision_text.encode("utf-8")).hexdigest()}
        owner_problem = check_owner_decision(document["owner_decision"], fingerprint, now.date())
        if owner_problem:
            return owner_problem, None
    descriptor = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
        handle.write("\n")
    os.chmod(out, 0o644)
    return "WRITTEN", document


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build")
    b.add_argument("--exec-workdir", required=True)
    b.add_argument("--declaration", required=True, choices=DECLARATIONS)
    b.add_argument("--out", required=True)
    b.add_argument("--owner-decision-file")
    b.add_argument("--owner-decision-ref")
    sub.add_parser("preflight")
    args = parser.parse_args(argv)
    if args.command == "preflight":
        code, lines = preflight(os.environ)
        print("\n".join(lines))
        return code
    status, document = build(args.exec_workdir, args.declaration, args.out,
                             owner_decision_file=args.owner_decision_file, owner_decision_ref=args.owner_decision_ref)
    if status != "WRITTEN":
        print(f"D1_EVIDENCE=NOT_WRITTEN_{status}")
        return 2
    print(f"D1_EVIDENCE=WRITTEN classification={document['classification']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
