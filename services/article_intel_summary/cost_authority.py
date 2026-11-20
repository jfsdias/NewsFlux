"""D1 successor: LiteLLM as the cost authority, proven by real gateway evidence bound to the actual key.

The declaration (NEWSFLUX_AI_LITELLM_COST_AUTHORITY) states which kind of authority is claimed; it proves
nothing by itself. The evidence file (NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE) is built at release time
from the contract-validated read-only diagnostic receipt (s5_db_readonly_audit through s5-r3-omv-readonly-run.sh)
and carries the domain-separated fingerprint of the key the Summary holds. At runtime the Summary recomputes that
fingerprint, so a rotated or replaced key invalidates the evidence; evidence older than MAX_EVIDENCE_AGE expires.

No price, budget amount or spend amount is read, stored or shown by NewsFlux: only the receipt's enum facts.

    python -m services.article_intel_summary.cost_authority build --receipt <receipt.txt> \
        --declaration gateway_budget_enforced|explicit_unlimited --key-fingerprint <hex> \
        --captured-at <ISO-8601 UTC> --out <evidence.json> [--owner-decision-ref <url>]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from datetime import datetime, timedelta, timezone
from typing import Any

from services.article_intel_summary.s5_preflight import key_fingerprint

EVIDENCE_SCHEMA = "newsflux.d1-cost-authority-evidence/v1"
DECLARATIONS = ("gateway_budget_enforced", "explicit_unlimited")
MAX_EVIDENCE_AGE = timedelta(days=7)
MAX_EVIDENCE_BYTES = 16 * 1024
FACT_NAMES = ("KEY_MATCH", "KEY_VALIDITY", "KEY_MAX_BUDGET", "KEY_BUDGET_DURATION", "KEY_SPEND_VS_MAX")
POSITIVE_BUDGET = frozenset({"OK", "APP_CAP_MISSING", "ABOVE_APP_CAP"})   # a positive gateway max_budget exists
RECOGNIZED_WINDOWS = frozenset({"CALENDAR_MONTH", "DAILY", "WEEKLY", "OTHER_WINDOW"})
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not _TIME.match(value):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def check_facts(declaration: str, facts: dict[str, str], owner_decision_ref: object = None) -> str | None:
    """None when the facts support the declaration, else the reason (shared by runtime and builder)."""
    if facts.get("KEY_MATCH") != "ONE":
        return "KEY_NOT_MATCHED"
    if facts.get("KEY_VALIDITY") != "PASS":
        return "KEY_INVALID"
    budget = facts.get("KEY_MAX_BUDGET")
    if declaration == "gateway_budget_enforced":
        if budget not in POSITIVE_BUDGET:
            return "BUDGET_NOT_ENFORCED"
        if facts.get("KEY_BUDGET_DURATION") not in RECOGNIZED_WINDOWS:
            return "BUDGET_WINDOW_UNRECOGNIZED"
        if facts.get("KEY_SPEND_VS_MAX") != "BELOW":
            return "BUDGET_EXHAUSTED"
        return None
    if declaration == "explicit_unlimited":
        if budget != "MISSING":
            return "UNLIMITED_BUT_BUDGET_PRESENT"
        if not isinstance(owner_decision_ref, str) or not owner_decision_ref.startswith("https://"):
            return "UNLIMITED_NOT_EXPLICIT"
        return None
    return "DECLARATION_UNKNOWN"


def _read_evidence(path: str) -> tuple[str | None, Any]:
    try:
        info = os.lstat(path)
    except OSError:
        return "EVIDENCE_MISSING", None
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o002 or info.st_size > MAX_EVIDENCE_BYTES:
        return "EVIDENCE_UNSAFE_FILE", None   # no symlink, not world-writable, bounded
    try:
        with open(path, encoding="utf-8") as handle:
            return None, json.load(handle)
    except (OSError, ValueError, UnicodeDecodeError):
        return "EVIDENCE_MALFORMED", None


def evaluate(declaration: str | None, evidence_path: str | None, virtual_key: str | None, *,
             now: datetime | None = None) -> tuple[str, str]:
    """("PROVEN", GATEWAY_BUDGET_ENFORCED|EXPLICIT_UNLIMITED) or ("UNPROVEN", reason). Never raises."""
    now = now or datetime.now(timezone.utc)
    declaration = (declaration or "").strip()
    if declaration not in DECLARATIONS:
        return "UNPROVEN", "DECLARATION_MISSING" if not declaration else "DECLARATION_UNKNOWN"
    if not evidence_path:
        return "UNPROVEN", "EVIDENCE_MISSING"
    problem, document = _read_evidence(evidence_path)
    if problem:
        return "UNPROVEN", problem
    if not isinstance(document, dict):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if document.get("schema") != EVIDENCE_SCHEMA:
        return "UNPROVEN", "EVIDENCE_SCHEMA"
    facts = document.get("facts")
    if not isinstance(facts, dict) or not all(isinstance(facts.get(name), str) for name in FACT_NAMES):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if not isinstance(document.get("key_fingerprint"), str) or not _HEX64.match(document["key_fingerprint"]):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    captured = _parse_time(document.get("captured_at"))
    if captured is None:
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if not virtual_key:
        return "UNPROVEN", "KEY_UNAVAILABLE"
    if document["key_fingerprint"] != key_fingerprint(virtual_key):
        return "UNPROVEN", "KEY_MISMATCH"
    if captured > now + timedelta(minutes=5):
        return "UNPROVEN", "EVIDENCE_FUTURE"
    if now - captured > MAX_EVIDENCE_AGE:
        return "UNPROVEN", "EVIDENCE_STALE"
    if document.get("declaration") != declaration:
        return "UNPROVEN", "DECLARATION_MISMATCH"
    reason = check_facts(declaration, facts, document.get("owner_decision_ref"))
    if reason:
        return "UNPROVEN", reason
    return "PROVEN", declaration.upper()


# ------------------------------------------------------------------------------------------------ builder
_RECEIPT_LINE = re.compile(r"^S5R1_([A-Z0-9_]{1,64})=([A-Z0-9_,]{1,512})$")


def facts_from_receipt(text: str) -> tuple[str | None, dict[str, str]]:
    """Only a complete, validated diagnostic receipt is usable (the wrapper prints nothing else on success)."""
    lines = text.splitlines()
    if "S5R3_RUN_RESULT=COMPLETE_DIAGNOSTIC_ONLY_READONLY" not in lines or "S5R1_AUDIT=COMPLETE_DIAGNOSTIC_ONLY" not in lines:
        return "RECEIPT_NOT_COMPLETE", {}
    facts: dict[str, str] = {}
    for line in lines:
        match = _RECEIPT_LINE.match(line)
        if match and match.group(1) in FACT_NAMES:
            if match.group(1) in facts:
                return "RECEIPT_DUPLICATE_FIELD", {}
            facts[match.group(1)] = match.group(2)
    if set(facts) != set(FACT_NAMES):
        return "RECEIPT_MISSING_FIELD", {}
    return None, facts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build")
    build.add_argument("--receipt", required=True)
    build.add_argument("--declaration", required=True, choices=DECLARATIONS)
    build.add_argument("--key-fingerprint", required=True)
    build.add_argument("--captured-at", required=True)
    build.add_argument("--out", required=True)
    build.add_argument("--owner-decision-ref")
    args = parser.parse_args(argv)
    if not _HEX64.match(args.key_fingerprint) or _parse_time(args.captured_at) is None:
        print("D1_EVIDENCE=NOT_WRITTEN_USAGE")
        return 2
    try:
        with open(args.receipt, "rb") as handle:
            raw = handle.read(256 * 1024)
        text = raw.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        print("D1_EVIDENCE=NOT_WRITTEN_RECEIPT_UNREADABLE")
        return 2
    problem, facts = facts_from_receipt(text)
    if problem is None:
        problem = check_facts(args.declaration, facts, args.owner_decision_ref)
    if problem:
        print(f"D1_EVIDENCE=NOT_WRITTEN_{problem}")
        return 2
    document = {"schema": EVIDENCE_SCHEMA, "declaration": args.declaration, "key_fingerprint": args.key_fingerprint,
                "captured_at": args.captured_at, "source": "s5_db_readonly_audit",
                "receipt_sha256": hashlib.sha256(raw).hexdigest(), "facts": facts}
    if args.owner_decision_ref:
        document["owner_decision_ref"] = args.owner_decision_ref
    descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
        handle.write("\n")
    os.chmod(args.out, 0o640)
    print("D1_EVIDENCE=WRITTEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
