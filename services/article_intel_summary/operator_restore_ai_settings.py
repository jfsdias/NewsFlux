"""Supervised operator-only rollback of a managed NewsFlux LiteLLM settings record.

No HTTP route. Run only inside the existing Summary container as the service UID,
with an exact current revision and an explicit confirmation marker. No secrets are
printed; old key/model-policy data never leave the private store.
"""
from __future__ import annotations

import argparse
import re
import sys

from services.article_intel_summary.admin_settings import ManagedSettingsError, ManagedSettingsStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--confirm", required=True)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-f]{32}", args.expected_revision):
        print("RESTORE=HOLD_INVALID_REVISION")
        return 2
    if args.confirm != "RESTORE_PREVIOUS_NEWSFLUX_AI_CONFIG":
        print("RESTORE=HOLD_NOT_CONFIRMED")
        return 2
    try:
        status = ManagedSettingsStore().operator_restore_previous(args.expected_revision)
        if not status["managed"] or status["revision"] == args.expected_revision:
            print("RESTORE=HOLD_READBACK")
            return 3
    except ManagedSettingsError as error:
        print("RESTORE=HOLD_" + error.code)
        return 2
    except Exception:
        print("RESTORE=HOLD_UNVERIFIED")
        return 2
    print("RESTORE=PASS_OPERATOR_PREVIOUS_RECORD")
    print("NEW_REVISION_SET=YES")
    print("RAW_CREDENTIAL_EXPORTED=NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
