"""Supervised operator-only revert of an explicit LEGACY -> MANAGED policy migration.

No HTTP route. Run only inside the existing Summary container as the service UID,
with the exact current revision and an explicit confirmation marker. It works with
admin writes disabled. Managed files are moved (never deleted) into a private
legacy-revert-<revision> directory; the bootstrap key file and environment are never
touched. Re-running with the same revision completes an interrupted revert. No secrets
are printed.
"""
from __future__ import annotations

import argparse
import re
import sys

from services.article_intel_summary.admin_settings import ManagedSettingsError, ManagedSettingsStore

CONFIRMATION = "REVERT_NEWSFLUX_AI_LEGACY_MIGRATION"


def main(argv: list[str] | None = None, *, store_factory=ManagedSettingsStore) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-f]{32}", args.expected_revision):
        print("REVERT=HOLD_INVALID_REVISION")
        return 2
    if args.confirm != CONFIRMATION:
        print("REVERT=HOLD_NOT_CONFIRMED")
        return 2
    try:
        status = store_factory().operator_revert_legacy_migration(args.expected_revision)
        if status["managed"] or status.get("policy_source") != "legacy":
            print("REVERT=HOLD_READBACK")
            return 3
    except ManagedSettingsError as error:
        print("REVERT=HOLD_" + error.code)
        return 2
    except Exception:
        print("REVERT=HOLD_UNVERIFIED")
        return 2
    print("REVERT=PASS_LEGACY_BOOTSTRAP_RESTORED")
    print("MANAGED_FILES_MOVED_TO_PRIVATE_BACKUP=YES")
    print("RAW_CREDENTIAL_EXPORTED=NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
