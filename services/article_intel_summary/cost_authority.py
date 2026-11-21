"""D1 successor: LiteLLM as model and cost authority, admitted only with trusted capture evidence (D1-R7).

The evidence (schema v3) comes from ONE root capture on the OMV (deploy/release-governance/d1_capture.py) and
is judged by services.article_intel_summary.d1_evidence, the same code the capture used. This module adds what
depends on where the evidence is evaluated:

  pin        the evidence sha256 recorded in the homeserver ledger is pinned in the deployment config
             (NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256); no pin or another digest is UNPROVEN;
  file       root-owned, not group/other-writable, parent likewise, O_NOFOLLOW, checked on the descriptor;
  mount      in the container the file must sit on a read-only mount (/proc/self/mountinfo);
  key        the captured fingerprint must equal the fingerprint of the key the catalog actually uses
             (managed key if present): a key changed after the capture is KEY_MISMATCH at once;
  freshness  the auditor's read time; runtime window MAX_EVIDENCE_AGE, release preflight MAX_PREFLIGHT_AGE.

Validity, stated: a policy change on the same key (budget removed, raised, routes widened) is not visible until
the next capture; it is bounded by the window, and any LiteLLM key edit requires a new capture before the next
release. A revoked key fails discovery and authentication, so nothing is offered; there is no instant
revocation signal beyond that. No price, budget or spend amount is read, stored or shown by NewsFlux.

    python -m services.article_intel_summary.cost_authority preflight   # target configuration (release)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta, timezone
from typing import Any

from services.article_intel_summary import d1_evidence
from services.article_intel_summary.s5_preflight import key_fingerprint

EVIDENCE_SCHEMA = d1_evidence.EVIDENCE_SCHEMA
DECLARATIONS = d1_evidence.DECLARATIONS
MAX_EVIDENCE_AGE = timedelta(days=7)
MAX_PREFLIGHT_AGE = timedelta(hours=24)
MAX_EVIDENCE_BYTES = 128 * 1024
TRUSTED_UID = 0
EVIDENCE_PATH = "/run/newsflux-d1/evidence.json"
# NewsFlux-side money controls that D1 replaces (LiteLLM governs cost): none may be configured in D1 mode.
DUPLICATE_COST_ENV = (
    "NEWSFLUX_AI_MONTHLY_BUDGET_USD",
    "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION",
    "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION",
)
D1_REQUIRED_FLAGS = ("NEWSFLUX_AI_INFERENCE_ENABLED", "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER",
                     "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------------------------------------ trusted read
def read_trusted(path: str, *, max_bytes: int, private: bool = False, uid: int | None = None) -> tuple[str | None, bytes]:
    """(problem, data). Regular file owned by `uid` (default TRUSTED_UID, root), not group/other-writable (private:
    no group/other access), opened with O_NOFOLLOW and checked on the descriptor itself, in a directory owned by
    the same uid and not group/other-writable. Not configurable from the environment."""
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


def on_readonly_mount(path: str, mountinfo: str | None = None) -> bool:
    """True when the deepest mount containing `path` is mounted read-only (mountinfo field 6 has "ro")."""
    if mountinfo is None:
        try:
            with open("/proc/self/mountinfo", encoding="utf-8") as handle:
                mountinfo = handle.read()
        except OSError:
            return False
    target = os.path.abspath(path)
    best, readonly = "", False
    for line in mountinfo.splitlines():
        fields = line.split(" ")
        if len(fields) < 6:
            continue
        point = fields[4].replace("\\040", " ")
        inside = target == point or target.startswith(point.rstrip("/") + "/") or point == "/"
        if inside and len(point) >= len(best):
            best, readonly = point, "ro" in fields[5].split(",")
    return bool(best) and readonly


# Indirection so tests can stand in for the container mount table.
mount_is_readonly: Callable[[str], bool] = on_readonly_mount


# ------------------------------------------------------------------------------------------------ evaluation
def evaluate(declaration: str | None, evidence_path: str | None, virtual_key: str | None, expected_sha256: str | None = None,
             *, now: datetime | None = None, max_age: timedelta = MAX_EVIDENCE_AGE,
             trusted_uid: int | None = None) -> tuple[str, str]:
    """("PROVEN", GATEWAY_ENFORCEMENT_EVIDENCE|EXPLICIT_UNLIMITED_AUTHORIZED) or ("UNPROVEN", reason). Never raises."""
    now = now or _now()
    declaration = (declaration or "").strip()
    if declaration not in DECLARATIONS:
        return "UNPROVEN", "DECLARATION_MISSING" if not declaration else "DECLARATION_UNKNOWN"
    if not evidence_path:
        return "UNPROVEN", "EVIDENCE_MISSING"
    expected = (expected_sha256 or "").strip()
    if not _HEX64.match(expected):
        return "UNPROVEN", "EVIDENCE_DIGEST_NOT_PINNED"
    problem, raw = read_trusted(evidence_path, max_bytes=MAX_EVIDENCE_BYTES, uid=trusted_uid)
    if problem:
        return "UNPROVEN", "EVIDENCE_MISSING" if problem == "MISSING" else "EVIDENCE_UNTRUSTED_FILE"
    if hashlib.sha256(raw).hexdigest() != expected:
        return "UNPROVEN", "EVIDENCE_DIGEST_MISMATCH"
    if not mount_is_readonly(evidence_path):
        return "UNPROVEN", "EVIDENCE_MOUNT_NOT_READ_ONLY"
    try:
        document = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    try:
        verdict, reason, info = d1_evidence.verify(document)
    except Exception:  # noqa: BLE001 - a document that breaks the verifier is not evidence
        return "UNPROVEN", "EVIDENCE_MALFORMED"
    if verdict != "PROVEN":
        return "UNPROVEN", reason
    if not virtual_key:
        return "UNPROVEN", "KEY_UNAVAILABLE"
    if info["key_fingerprint"] != key_fingerprint(virtual_key):
        return "UNPROVEN", "KEY_MISMATCH"
    captured = info["captured_at"]
    if captured > now + timedelta(minutes=5):
        return "UNPROVEN", "EVIDENCE_FUTURE"
    if now - captured > max_age:
        return "UNPROVEN", "EVIDENCE_STALE"
    if info["declaration"] != declaration:
        return "UNPROVEN", "DECLARATION_MISMATCH"
    if declaration == "explicit_unlimited":
        owner_problem = d1_evidence.check_owner_decision(document.get("owner_decision"), info["key_fingerprint"], now.date())
        if owner_problem:
            return "UNPROVEN", owner_problem
    return "PROVEN", reason


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


# ------------------------------------------------------------------------------------------------ release preflight
def _true(values: Mapping[str, str], name: str) -> bool:
    return (values.get(name) or "").strip().casefold() == "true"


def live_catalog(values: Mapping[str, str], *, attempts: int = 4, pause: float = 15.0,
                 sleep: Callable[[float], None] | None = None) -> tuple[int, str]:
    """Available models in the real catalog for this exact configuration (GET-only discovery, no inference).
    The usage ledger goes to a throwaway file so the preflight never writes the service's volume. A discovery that
    is not OK (e.g. the key's rate limit right after a restart) is retried; the detail then says DISCOVERY_<status>
    instead of an empty, reason-less catalog."""
    import time

    from services.article_intel_summary.catalog import create_model_router
    sleep = sleep or time.sleep
    document: dict[str, Any] = {}
    for attempt in range(attempts):
        with tempfile.TemporaryDirectory() as scratch:
            probe = dict(values, NEWSFLUX_AI_USAGE_DATABASE_PATH=os.path.join(scratch, "usage.sqlite3"),
                         NEWSFLUX_AI_MODEL_DISCOVERY_TTL_SECONDS="0")
            router, _ = create_model_router(probe, default_adapter=object())
            try:
                document = router.catalog_document()
            finally:
                if router.ledger_owner is not None:
                    router.ledger_owner.__exit__(None, None, None)
        if (document.get("discovery") or {}).get("status") == "OK" or attempt == attempts - 1:
            break
        sleep(pause)
    status = str((document.get("discovery") or {}).get("status") or "UNKNOWN")
    models = document.get("models", [])
    reasons: dict[str, int] = {}
    for model in models:
        if not model.get("available"):
            reason = str(model.get("unavailable_reason") or "UNKNOWN")
            reasons[reason] = reasons.get(reason, 0) + 1
    detail = ",".join(f"{name}:{count}" for name, count in sorted(reasons.items())) or "NONE"
    if status != "OK":
        detail = "DISCOVERY_" + re.sub(r"[^A-Z0-9_]", "_", status.upper())
    return sum(1 for model in models if model.get("available")), detail


def live_callbacks(values: Mapping[str, str], key: str) -> str:
    """PASS when the gateway's success callbacks are within NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS (GET only)."""
    from dataclasses import replace

    from services.article_intel_summary.litellm_adapter import load_gateway_settings
    from services.article_intel_summary.s5_preflight import _gateway_getter
    settings = replace(load_gateway_settings(values, read_key=False), virtual_key=key)
    readiness = _gateway_getter(settings)("/health/readiness")
    callbacks = {str(item) for item in (readiness.get("success_callbacks") or [])}
    allowed = {item.strip() for item in (values.get("NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS") or "").split(",") if item.strip()}
    return "PASS" if callbacks <= allowed else "FAIL"


def preflight(values: Mapping[str, str], *, now: datetime | None = None,
              key_loader: Callable[[Mapping[str, str]], str | None] | None = None,
              catalog: Callable[[Mapping[str, str]], int] | None = None,
              callbacks: Callable[[Mapping[str, str], str], str] | None = None,
              trusted_uid: int | None = None, live: bool = True) -> tuple[int, list[str]]:
    """Release preflight, run in the TARGET configuration (release.py candidate-run), never the running container.
    Mode off: NOT_APPLICABLE (legacy contract unchanged); that is never an admission of D1."""
    mode = (values.get("NEWSFLUX_AI_MODEL_AUTHORITY") or "").strip()
    if mode != "litellm_key":
        return 0, ["D1_MODEL_AUTHORITY=OFF", "D1_PREFLIGHT=NOT_APPLICABLE_LEGACY_CONTRACT"]
    lines = ["D1_MODEL_AUTHORITY=LITELLM_KEY"]
    hold = False
    flags_ok = all(_true(values, name) for name in D1_REQUIRED_FLAGS)
    lines.append(f"D1_FLAGS={'PASS' if flags_ok else 'HOLD_INFERENCE_TRANSFER_OR_DISCOVERY_OFF'}")
    duplicated = [name for name in DUPLICATE_COST_ENV if (values.get(name) or "").strip()]
    lines.append(f"D1_NO_DUPLICATE_COST_CONTROL={'PASS' if not duplicated else 'HOLD_NEWSFLUX_COST_CONFIGURED'}")
    hold = hold or not flags_ok or bool(duplicated)
    try:
        key = (key_loader or effective_virtual_key)(values)
    except Exception:  # noqa: BLE001 - a key that cannot be read is simply unavailable
        key = None
    verdict, reason = evaluate(values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY"),
                               values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE"), key,
                               values.get("NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256"),
                               now=now, max_age=MAX_PREFLIGHT_AGE, trusted_uid=trusted_uid)
    lines.append(f"D1_COST_AUTHORITY={verdict}_{reason}")
    lines.append(f"D1_NONFINANCIAL_GATES={'PASS' if verdict == 'PROVEN' else 'NOT_PROVEN'}")
    hold = hold or verdict != "PROVEN"
    offline_only = not live and not hold
    if not hold and key and live:
        try:
            result = (catalog or live_catalog)(values)
            available, detail = result if isinstance(result, tuple) else (result, None)
            lines.append(f"D1_CATALOG={'PASS' if available else 'HOLD'}_MODELS_{min(available, 999)}")
            if detail is not None:
                lines.append(f"D1_CATALOG_UNAVAILABLE={detail}")   # reason codes only, e.g. COMPATIBILITY_UNVERIFIED:2
            hold = hold or not available
        except Exception:  # noqa: BLE001
            lines.append("D1_CATALOG=HOLD_UNVERIFIED")
            hold = True
        try:
            result = (callbacks or live_callbacks)(values, key)
            lines.append(f"D1_LIVE_CALLBACKS={result}")
            hold = hold or result != "PASS"
        except Exception:  # noqa: BLE001
            lines.append("D1_LIVE_CALLBACKS=NOT_VERIFIED")
            hold = True
    else:
        lines.append("D1_LIVE_GATES=NOT_RUN")
    lines.append("SECRET_PRINTED=NO")
    # Without the live gates (operator preflight without --check-gateway) the result is never a plain PASS.
    lines.append("D1_PREFLIGHT=HOLD" if hold else ("D1_PREFLIGHT=PASS_OFFLINE_ONLY" if offline_only else "D1_PREFLIGHT=PASS"))
    return (3 if hold else 0), lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    pre = sub.add_parser("preflight")
    # --offline: the gates that need no network (flags, cost control, evidence, mount, key, non-financial gates).
    # Used in the one-off candidate container, which cannot use the service's fixed addresses (the gateway path
    # may allow only those); the live gates then run in the promoted container, with automatic rollback.
    pre.add_argument("--offline", action="store_true")
    args = parser.parse_args(argv)
    code, lines = preflight(os.environ, live=not args.offline)
    print("\n".join(lines))
    return code


if __name__ == "__main__":
    sys.exit(main())
