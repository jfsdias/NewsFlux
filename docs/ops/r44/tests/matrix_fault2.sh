#!/usr/bin/env bash
set -u
H="$(cd "$(dirname "$0")" && pwd)"; T="$H/topo"; TOOL="${R44_TOOL:?}"
export R44_STATE_DIR="$H/state" R44_RELEASE_LOCK="$H/lock" R44_HEALTH_TIMEOUT=90
bash "$H/teardown.sh" "$T"; rm -rf "$H/state" "$H/lock"; bash "$H/setup.sh" "$T"
E0=$(sha256sum "$T/private/summary.env" | cut -c1-64)
printf 'owner-token\nAPPLY-R44-ADMIN-7\n' > "$H/in"
OUT="$(R44_FAULT=restart_protected R44_INPUT_FILE="$H/in" ${R44_PY:-python3} -I "$TOOL" apply 7 2>&1)"; RC=$?
ok=1
[ "$RC" = 6 ] || { ok=0; echo "rc=$RC want 6"; }
for k in PROTECTED_SERVICES_UNCHANGED=FAIL CONFIG_CHANGE_RESULT=FAILED_ROLLING_BACK ROLLBACK_ENV_FILE_RESTORED=YES ROLLBACK_ENV=PASS ROLLBACK_OTHER_CONTAINERS=FAIL ROLLBACK=FAIL; do
  grep -qx "$k" <<<"$OUT" || { ok=0; echo "missing $k"; }; done
[ "$(sha256sum "$T/private/summary.env" | cut -c1-64)" = "$E0" ] || { ok=0; echo env_not_restored; }
[ $ok = 1 ] && echo "R44_TEST protected_restart_detected_rollback_flags_operator=PASS" || { echo "R44_TEST protected_restart_detected=FAIL"; echo "$OUT" | tail -25; }
bash "$H/teardown.sh" "$T"
