#!/usr/bin/env bash
# Rehearsal of r44-allowlist.sh on the disposable topology (never a real host). Runs as root (CI: sudo -E).
# Uses the real release.py and policy from main and the pinned #265 preflight, exactly as on the OMV;
# owner answers come from fd 3 instead of a terminal.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
PROC="$here/../r44-allowlist.sh"
export R44T_HOME="${R44T_HOME:-$(mktemp -d /tmp/r44p.XXXXXX)}"
T="$R44T_HOME/topo-privatecanary"
IMG="$(docker image inspect -f '{{.Id}}' r44-summary:test)"
REV="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' r44-summary:test)"
OWNER=tok-owner-CANARYKEY7
LOG="$R44T_HOME/procedure.log"; : > "$LOG"
pass=0; fail=0; FAILS=()
[ "$(id -u)" = 0 ] || { echo "procedure-test must run as root (sudo -E)"; exit 2; }

reset() { bash "$here/teardown.sh" "$T"; rm -rf "$R44T_HOME/rel" "$R44T_HOME/lock"; bash "$here/setup.sh" "$T"; }
sid() { docker ps -q --no-trunc --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api; }
label() { docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}} {{.Image}}' "$(sid)"; }
envsha() { sha256sum "$T/private/summary.env" | cut -c1-64; }
others() { docker inspect -f '{{.Name}} {{.Id}} {{.State.StartedAt}}' newsflux miniflux miniflux-db npm other-svc; }
snap() { E0=$(envsha); L0=$(label); C0=$(sid); O0=$(others); }
penv() { echo env R44_EXPECT_IMAGE="${XIMG:-$IMG}" R44_EXPECT_REVISION="$REV" R44_RELEASE_ROOT="$R44T_HOME/rel" R44_LOCK="$R44T_HOME/lock"; }
run() { # name expect answers [VAR=value...]
  N=$1; local ex=$2 ans=$3; shift 3; printf '%b' "$ans" > "$R44T_HOME/in.$N"
  OUT="$($(penv) "$@" bash "${PROCX:-$PROC}" 3<"$R44T_HOME/in.$N" 2>"$R44T_HOME/err.$N")"; RC=$?
  printf '### %s rc=%s\n%s\n' "$N" "$RC" "$OUT" >> "$LOG"; CHK=(); [ "$RC" = "$ex" ] || CHK+=("exit=$RC want=$ex")
}
bg() { # name answers [VAR=value...] : own session, SIGINT at default like a foreground terminal process
  N=$1; local ans=$2; shift 2; printf '%b' "$ans" > "$R44T_HOME/in.$N"
  setsid $(penv) "$@" python3 -c 'import os, signal, sys; signal.signal(signal.SIGINT, signal.SIG_DFL); os.execvp("bash", ["bash", sys.argv[1]])' \
    "$PROC" 3<"$R44T_HOME/in.$N" >"$R44T_HOME/out.$N" 2>"$R44T_HOME/err.$N" &
  PID=$!
}
waitline() { local i; for i in $(seq 1 240); do grep -qx "$1" "$R44T_HOME/out.$N" 2>/dev/null && return 0; sleep 0.5; done; return 1; }
finish_bg() { wait "$PID"; RC=$?; OUT="$(cat "$R44T_HOME/out.$N")"; printf '### %s rc=%s\n%s\n' "$N" "$RC" "$OUT" >> "$LOG"; CHK=(); }
has() { grep -qxE -- "$1" <<<"$OUT" || CHK+=("missing:$1"); }
hasnt() { grep -qE -- "$1" <<<"$OUT" && CHK+=("unexpected:$1"); return 0; }
check() { "$@" || CHK+=("check:$*"); }
done_() {
  grep -qE 'privatecanary|CANARY|miniflux\.test|rehearsal\.test|tok-|/' <<<"$OUT" && CHK+=(output_not_sanitized)
  grep -vqE '^[A-Z][A-Z0-9_]{0,63}=[A-Za-z0-9_.:,+-]{0,96}$' <<<"$OUT" && CHK+=(non_kv_output)
  if [ ${#CHK[@]} -eq 0 ]; then echo "R44P_TEST $N=PASS"; pass=$((pass+1))
  else echo "R44P_TEST $N=FAIL ${CHK[*]}"; fail=$((fail+1)); FAILS+=("$N"); sed 's/^/    | /' <<<"$OUT"; fi
}
unchanged() { [ "$(envsha)" = "$E0" ] && [ "$(label)" = "$L0" ] && [ "$(sid)" = "$C0" ] && [ "$(others)" = "$O0" ]; }
APPLY="$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n"

reset; snap
run readonly_pass 0 "$OWNER\nLIST-ADMIN-IDS\n"; has TOOL_PINS=PASS; has RUNTIME_TRUST=PASS; has ADMIN_ID_CANDIDATE=7
  has OWNER_SELECTION=SINGLE_ADMIN_IS_CALLER; has WRITES_PERFORMED=NO; has R44_RESULT=READ_ONLY_PASS; check unchanged; done_
run readonly_bad_key 3 "tok-wrong-CANARYKEY0\nLIST-ADMIN-IDS\n"; has ME_LOOKUP=UNAUTHENTICATED; done_
run readonly_not_admin 3 "tok-user-CANARYKEY9\nLIST-ADMIN-IDS\n"; has OWNER_SELECTION=CALLER_NOT_MINIFLUX_ADMIN; done_
run readonly_enumeration_declined 4 "$OWNER\n\n"; has OWNER_SELECTION=OWNER_DECISION_REQUIRED_ENUMERATION_DECLINED; hasnt ADMIN_IDS; done_
touch "$T/state/multi"
run readonly_multi_admin 4 "$OWNER\nLIST-ADMIN-IDS\n"; has ADMIN_IDS=7,8; has OWNER_SELECTION=OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS; done_
rm -f "$T/state/multi"
XIMG="sha256:$(printf '0%.0s' {1..64})" run trust_image_mismatch 3 "$OWNER\n"; has RUNTIME_IMAGE=MISMATCH; hasnt ADMIN_ID_CANDIDATE; done_
run apply_wrong_phrase 3 "$OWNER\nLIST-ADMIN-IDS\nyes\n" R44_MODE=apply R44_ADMIN_ID=7; has CONFIG_CHANGE_AUTHORIZED=NO; hasnt PLAN; check unchanged; done_
run apply_id_mismatch 3 "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-9\n" R44_MODE=apply R44_ADMIN_ID=9; has ADMIN_ID_VERIFIED=MISMATCH_WITH_LIVE_IDENTITY; check unchanged; done_
run apply_success 0 "$APPLY" R44_MODE=apply R44_ADMIN_ID=7
  has PLAN=PASS; has PROMOTE=APPLIED; has EFFECTIVE_ADMIN_ALLOWLIST=CONFIGURED_COUNT_1; has GATE_D_ADMIN_ALLOWLIST=CONFIGURED_COUNT_1
  has GATE_D_WRITES_PERFORMED=NO; has GATE_D_PROTECTED_NPM_STATUS=RUNNING; has 'R44_RESULT=APPLIED_VERIFIED_GATE_D_(PASS|HOLD)'
  check test "$(envsha)" = "$E0"; check test "$(others)" = "$O0"; done_
REL=$(ls "$R44T_HOME/rel" | tail -1)
run apply_again_refused 3 "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" R44_MODE=apply R44_ADMIN_ID=7; has ADMIN_ALLOWLIST_STATE=CONFIGURED; done_
run rollback_wrong_phrase 3 "no\n" R44_MODE=rollback R44_RELEASE_ID="$REL"; has ROLLBACK_AUTHORIZED=NO; done_
run rollback 0 "ROLLBACK-R44\n" R44_MODE=rollback R44_RELEASE_ID="$REL"; has ROLLBACK=APPLIED; has ADMIN_ALLOWLIST_AFTER=EMPTY
  check test "$(envsha)" = "$E0"; check test "$(label)" = "$L0"; check test "$(others)" = "$O0"; done_
run rollback_idempotent 0 "ROLLBACK-R44\n" R44_MODE=rollback R44_RELEASE_ID="$REL"; has ROLLBACK=ALREADY_APPLIED; done_

# Ctrl+C / SIGTERM / SIGHUP to the whole process group during promote: the critical section is not interruptible.
reset; snap
bg interrupt_during_promote "$APPLY" R44_MODE=apply R44_ADMIN_ID=7
waitline PLAN=PASS; sleep 1; kill -s INT -- "-$PID"; sleep 0.3; kill -s TERM -- "-$PID"; sleep 0.3; kill -s HUP -- "-$PID"
finish_bg; check test "$RC" = 0; has PROMOTE=APPLIED; has EFFECTIVE_ADMIN_ALLOWLIST=CONFIGURED_COUNT_1
check test "$(envsha)" = "$E0"; check test "$(others)" = "$O0"; done_
# Same signals while still read-only (before the plan): the procedure stops, nothing changed.
reset; snap
mkfifo "$R44T_HOME/slow"; N=interrupt_before_change
setsid $(penv) R44_MODE=apply R44_ADMIN_ID=7 python3 -c 'import os, signal, sys; signal.signal(signal.SIGINT, signal.SIG_DFL); os.execvp("bash", ["bash", sys.argv[1]])' \
  "$PROC" 3<>"$R44T_HOME/slow" >"$R44T_HOME/out.$N" 2>/dev/null &
PID=$!; waitline RUNTIME_TRUST=PASS; sleep 0.5; kill -s INT -- "-$PID"
finish_bg; check test "$RC" != 0; hasnt PLAN; check unchanged; done_; rm -f "$R44T_HOME/slow"
# SIGKILL of release.py mid-promote (not interceptable): truthful exit 6, then supervised rollback restores.
reset; snap
bg sigkill_release_mid_promote "$APPLY" R44_MODE=apply R44_ADMIN_ID=7
waitline PLAN=PASS; sleep 1.5; pkill -KILL -f "release.py.*promote"
finish_bg; check test "$RC" = 6; has R44_RESULT=SUPERVISED_RECOVERY_REQUIRED; done_
sleep 8; REL=$(ls "$R44T_HOME/rel" | tail -1)
run supervised_rollback_after_sigkill 0 "ROLLBACK-R44\n" R44_MODE=rollback R44_RELEASE_ID="$REL"; has ADMIN_ALLOWLIST_AFTER=EMPTY
  check test "$(envsha)" = "$E0"; check test "$(label)" = "$L0"; check test "$(others)" = "$O0"; done_
# The operator's clone is owned by the operator, the procedure runs as root (git safe.directory).
rm -rf "$R44T_HOME/clone"; git clone -q "$repo" "$R44T_HOME/clone" 2>/dev/null || cp -a "$repo" "$R44T_HOME/clone"
cp "$PROC" "$R44T_HOME/clone/deploy/r44-admin-allowlist/r44-allowlist.sh"; chown -R nobody "$R44T_HOME/clone"
PROCX="$R44T_HOME/clone/deploy/r44-admin-allowlist/r44-allowlist.sh" run clone_owned_by_operator 0 "$OWNER\nLIST-ADMIN-IDS\n"
  has TOOL_PINS=PASS; has R44_RESULT=READ_ONLY_PASS; done_
# Tampered pinned tool -> nothing runs.
cp -a "$R44T_HOME/clone" "$R44T_HOME/tampered" 2>/dev/null; sed -i 's/^PIN_RELEASE_PY=8/PIN_RELEASE_PY=0/' "$R44T_HOME/tampered/deploy/r44-admin-allowlist/r44-allowlist.sh"
PROCX="$R44T_HOME/tampered/deploy/r44-admin-allowlist/r44-allowlist.sh" run tool_pin_mismatch 3 "$OWNER\n"; has TOOL_PINS=MISMATCH; hasnt ADMIN_ID_CANDIDATE; done_

bash "$here/teardown.sh" "$T"
echo "R44P_TESTS_PASSED=$pass R44P_TESTS_FAILED=$fail"
[ "$fail" -eq 0 ] || echo "R44P_FAILED_TESTS=${FAILS[*]}"
[ "$fail" -eq 0 ]
