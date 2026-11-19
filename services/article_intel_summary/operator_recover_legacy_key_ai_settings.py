"""Supervised operator-only recovery of a LEGACY server whose bootstrap LiteLLM key fails.

No HTTP route. Run inside the existing Summary container as the service UID. Works with
admin writes disabled. The replacement key is read only from an owner-only (0600, not a
symlink) file given with --key-file; it is never accepted on the command line, from the
environment or printed.

1. --plan: read-only. Refused unless the source is LEGACY with legacy aliases and the
   current bootstrap key fails discovery (not a rotation tool). Verifies the candidate key
   and each legacy model with it, then prints PLAN_DIGEST.
2. --apply --plan-digest <digest> --confirm RECOVER-LEGACY-KEY-AND-MIGRATE: re-checks
   everything under the write lock and, if the plan is unchanged, stores the verified key
   and an explicit empty allowlist (no model approved) with a migration manifest. The
   bootstrap key file is never modified and the revoked key is never reinstated.
"""
from __future__ import annotations

import argparse
import re
import sys

from services.article_intel_summary.admin_settings import (
    KEY_RECOVERY_CONFIRMATION, ManagedSettingsError, ManagedSettingsStore,
)
from services.article_intel_summary.litellm_adapter import _read_private_secret_file


def main(argv: list[str] | None = None, *, store_factory=ManagedSettingsStore) -> int:
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--key-file", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--apply", action="store_true")
    parser.add_argument("--plan-digest")
    parser.add_argument("--confirm")
    args = parser.parse_args(argv)
    candidate = _read_private_secret_file(args.key_file)
    if candidate is None:
        print("RECOVERY=HOLD_KEY_FILE_UNSAFE")
        return 2
    if args.apply:
        if args.confirm != KEY_RECOVERY_CONFIRMATION:
            print("RECOVERY=HOLD_NOT_CONFIRMED")
            return 2
        if not re.fullmatch(r"[0-9a-f]{64}", args.plan_digest or ""):
            print("RECOVERY=HOLD_INVALID_PLAN_DIGEST")
            return 2
    try:
        store = store_factory()
        if args.plan:
            plan = store.operator_plan_legacy_key_recovery(candidate)
            print("RECOVERY_PLAN=READY")
            print("CURRENT_KEY=UNVERIFIED")
            print("CANDIDATE_KEY=VERIFIED")
            print(f"LEGACY_MODELS={len(plan['models'])}")
            print(f"LEGACY_MODELS_FOUND={sum(1 for m in plan['models'] if m['discovered'])}")
            print(f"LEGACY_MODELS_NEEDING_CONSENT={sum(1 for m in plan['models'] if m['consents_required'])}")
            print("MODELS_APPROVED_BY_APPLY=0")
            print(f"PLAN_DIGEST={plan['plan_digest']}")
            print("WRITES_PERFORMED=NO")
        else:
            status = store.operator_recover_legacy_key("bootstrap", candidate, args.plan_digest, args.confirm)
            if not status["managed"] or status["policy_models"] != 0:
                print("RECOVERY=HOLD_READBACK")
                return 3
            print("RECOVERY=PASS_KEY_REPLACED_POLICY_MIGRATED")
            print("MODELS_APPROVED=0")
            print("BOOTSTRAP_KEY_FILE_MODIFIED=NO")
    except ManagedSettingsError as error:
        print("RECOVERY=HOLD_" + error.code)
        return 2
    except Exception:
        print("RECOVERY=HOLD_UNVERIFIED")
        return 2
    print("RAW_CREDENTIAL_EXPORTED=NO")
    return 0


if __name__ == "__main__":
    sys.exit(main())
