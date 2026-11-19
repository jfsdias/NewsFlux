"""Supervised operator-only recovery of a first activation interrupted before its record.

No HTTP route. Run inside the existing Summary container as the service UID; works with
admin writes disabled. Symptom: the store reports CONFIG_UNAVAILABLE and the read-only
preflight prints INTERRUPTED_ACTIVATION=YES (marker and activation.pending journal present,
settings.json absent).

- Journal present, record absent: nothing was committed. The marker, journal, previous.json,
  migration.json and any .new-* partial write are moved (never deleted) into
  interrupted-activation-<revision>/ with recovery.json listing each file's SHA-256; the
  readback must show the unchanged bootstrap.
- Journal present, record committed: the stale journal is removed (roll forward).
- No journal: refused. A record missing after a completed activation is a deletion or
  corruption, not an interruption, and stays fail-closed for forensic review.
"""
from __future__ import annotations

import argparse
import sys

from services.article_intel_summary.admin_settings import (
    INTERRUPTED_ACTIVATION_CONFIRMATION, ManagedSettingsError, ManagedSettingsStore,
)


def main(argv: list[str] | None = None, *, store_factory=ManagedSettingsStore) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args(argv)
    if args.confirm != INTERRUPTED_ACTIVATION_CONFIRMATION:
        print("RECOVERY=HOLD_NOT_CONFIRMED")
        return 2
    try:
        result = store_factory().operator_recover_interrupted_activation(args.confirm)
    except ManagedSettingsError as error:
        print("RECOVERY=HOLD_" + error.code)
        return 2
    except Exception:
        print("RECOVERY=HOLD_UNVERIFIED")
        return 2
    status = result["status"]
    if result["outcome"] == "rolled_back_to_bootstrap":
        print("RECOVERY=PASS_ROLLED_BACK_TO_BOOTSTRAP")
        print(f"FILES_MOVED_TO_PRIVATE_BACKUP={len(result['moved'])}")
    else:
        print("RECOVERY=PASS_COMMITTED_ACTIVATION_COMPLETED")
    print(f"KEY_SOURCE={'MANAGED' if status['managed'] else 'BOOTSTRAP'}")
    print(f"POLICY_SOURCE={status['policy_source'].upper()}")
    print("FILES_DELETED=0")
    print("RAW_CREDENTIAL_EXPORTED=NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
