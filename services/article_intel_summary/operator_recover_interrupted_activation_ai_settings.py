"""Supervised operator-only recovery of a first activation interrupted before its record.

No HTTP route. Run inside the existing Summary container as the service UID; works with
admin writes disabled. Symptom: the store reports CONFIG_UNAVAILABLE and the read-only
preflight prints INTERRUPTED_ACTIVATION=YES (activation.pending journal present).

- Journal present, record committed and matching the journal digests: roll forward (stays
  MANAGED; allowed with inference ON); only the journal is removed.
- Journal present, record absent: roll back to the bootstrap, refused while
  NEWSFLUX_AI_INFERENCE_ENABLED=true. A strict manifest (name, SHA-256, size) is staged
  before any move; every move is verified before and after; the readback must be the
  bootstrap; recovery.done is written last. Nothing is deleted; the journal is preserved.
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
        print("FILES_VERIFIED_SHA256_AND_SIZE=YES")
        print("COMPLETION_RECEIPT=WRITTEN_AFTER_READBACK")
    else:
        print("RECOVERY=PASS_COMMITTED_ACTIVATION_COMPLETED")
    # The journal is transaction metadata, not data: report its fate separately and truthfully.
    print(f"JOURNAL_REMOVED={'YES' if result['journal_removed'] else 'NO'}")
    print(f"JOURNAL_PRESERVED_IN_BACKUP={'YES' if result['journal_preserved'] else 'NO'}")
    print(f"DATA_FILES_DELETED={int(result['data_files_deleted'])}")
    print(f"KEY_SOURCE={'MANAGED' if status['managed'] else 'BOOTSTRAP'}")
    print(f"POLICY_SOURCE={status['policy_source'].upper()}")
    print("RAW_CREDENTIAL_EXPORTED=NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
