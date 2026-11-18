#!/usr/bin/env bash
# R4.4 tool test matrix on the disposable topology (real Summary image @ deployed main, fake Miniflux).
set -u
H="$(cd "$(dirname "$0")" && pwd)"; T="$H/topo"; TOOL="${R44_TOOL:?}"
export R44_STATE_DIR="$H/state" R44_RELEASE_LOCK="$H/lock" R44_HEALTH_TIMEOUT=90
pass=0; fail=0; LOG="$H/matrix.log"; : > "$LOG"
reset() { bash "$H/teardown.sh" "$T"; rm -rf "$H/state" "$H/lock"; R44T_NO_KEY_LINE="${1:-0}" bash "$H/setup.sh" "$T"; }
run() { # name expect_rc input mode [arg] ; sets OUT
  local n=$1 ex=$2 inp=$3; shift 3
  printf '%b' "$inp" > "$H/in"
  OUT="$(R44_INPUT_FILE="$H/in" ${R44_PY:-python3} -I "$TOOL" "$@" 2>&1)"; RC=$?
  printf '### %s rc=%s\n%s\n' "$n" "$RC" "$OUT" >> "$LOG"
  [ "$RC" = "$ex" ] || { CHK_FAIL+=("exit=$RC want=$ex"); }
}
has() { grep -qxE -- "$1" <<<"$OUT" || CHK_FAIL+=("missing $1"); }
hasnt() { grep -qE -- "$1" <<<"$OUT" && CHK_FAIL+=("unexpected $1"); return 0; }
verdict() { if [ ${#CHK_FAIL[@]} -eq 0 ]; then echo "R44_TEST $1=PASS"; pass=$((pass+1)); else echo "R44_TEST $1=FAIL: ${CHK_FAIL[*]}"; fail=$((fail+1)); fi; CHK_FAIL=(); }
CHK_FAIL=()
envsha() { sha256sum "$T/private/summary.env" | cut -c1-64; }
sid() { docker ps -aq --no-trunc --filter label=com.docker.compose.service=summary-api; }
secret_free() { hasnt 'owner-token|user-token|admin2-token|miniflux\.test|rehearsal\.test'; }

reset
E0=$(envsha); C0=$(sid)
run audit_clean 0 "" audit; has AUDIT_GATE=PASS; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has DEPLOYED_ADMIN_ROUTE_CALLERS=0; has PROTECTED_NPM_STATUS=RUNNING; secret_free; verdict audit_clean
run identity_owner 0 "owner-token\n" identity; has ADMIN_ID_CANDIDATE=7; has MINIFLUX_IS_ADMIN=YES; has ADMIN_COUNT=1; has OWNER_SELECTION=SINGLE_ADMIN_IS_CALLER; has MINIFLUX_BASE_ROUTE=DIRECT_PROTECTED_MINIFLUX; secret_free; verdict identity_owner
run identity_not_admin 3 "user-token\n" identity; has MINIFLUX_IS_ADMIN=NO; has OWNER_SELECTION=CALLER_NOT_MINIFLUX_ADMIN; secret_free; verdict identity_not_admin
run identity_bad_key 3 "wrong-key\n" identity; has ME_LOOKUP=UNAUTHENTICATED; secret_free; verdict identity_bad_key
run identity_empty_key 3 "\n" identity; has API_KEY_INPUT=INVALID_FORMAT; verdict identity_empty_key
touch "$T/state/multi"
run identity_multi_admin 0 "owner-token\n" identity; has ADMIN_COUNT=2; has ADMIN_IDS=7,8; has OWNER_SELECTION=OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS; verdict identity_multi_admin
rm -f "$T/state/multi"
run apply_wrong_phrase 3 "owner-token\nyes\n" apply 7; has CONFIG_CHANGE_AUTHORIZED=NO; hasnt CONFIG_CHANGE_EXECUTED; [ "$(envsha)" = "$E0" ] && [ "$(sid)" = "$C0" ] || CHK_FAIL+=(state_changed); verdict apply_wrong_phrase
run apply_id_mismatch 3 "owner-token\nAPPLY-R44-ADMIN-9\n" apply 9; has ADMIN_ID_VERIFIED=MISMATCH_WITH_LIVE_IDENTITY; [ "$(envsha)" = "$E0" ] && [ "$(sid)" = "$C0" ] || CHK_FAIL+=(state_changed); verdict apply_id_mismatch
run apply_non_admin_key 3 "user-token\nAPPLY-R44-ADMIN-9\n" apply 9; has OWNER_SELECTION=CALLER_NOT_MINIFLUX_ADMIN; [ "$(envsha)" = "$E0" ] || CHK_FAIL+=(state_changed); verdict apply_non_admin_key
run apply_bad_arg 3 "" apply 07x; has ADMIN_ID_ARGUMENT=INVALID; verdict apply_bad_arg

R44_FAULT=drift_env run apply_fault_rollback 5 "owner-token\nAPPLY-R44-ADMIN-7\n" apply 7
has CONFIG_CHANGE_EXECUTED=ENV_FILE_WRITTEN; has FAULT_INJECTED=DRIFT_ENV; has ROLLBACK=PASS; has ROLLBACK_ENV=PASS; has ROLLBACK_OTHER_CONTAINERS=PASS
[ "$(envsha)" = "$E0" ] || CHK_FAIL+=(env_not_restored); secret_free; verdict apply_fault_rollback
run audit_after_rollback 0 "" audit; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has RENDERED_CONFIG_HASH_MATCHES_RUNNING=YES; verdict audit_after_rollback

reset; E0=$(envsha); RID=$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' newsflux miniflux miniflux-db npm)
run apply_success 0 "owner-token\nAPPLY-R44-ADMIN-7\n" apply 7
for k in PRESTATE_GATE=PASS ADMIN_ID_VERIFIED=7 CONFIG_CHANGE_AUTHORIZED=YES_OWNER_TYPED_PHRASE BACKUP_GATE=PASS RENDER_DIFF_GATE=PASS_ONLY_ADMIN_KEY \
  IMAGE_IDENTITY_PRESERVED=PASS OTHER_ENV_UNCHANGED=PASS SUMMARY_MOUNTS_PRESERVED=PASS SUMMARY_HEALTH=PASS EFFECTIVE_ALLOWLIST_CONFIGURED_COUNT_1=PASS \
  ADMIN_AUTHZ_PROBE=PASS PROTECTED_SERVICES_UNCHANGED=PASS READER_CADDYFILE_UNCHANGED=PASS FLAG_INFERENCE_ENABLED_UNCHANGED=PASS CONFIG_CHANGE_RESULT=APPLIED_VERIFIED; do has "$k"; done
secret_free
[ "$RID" = "$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' newsflux miniflux miniflux-db npm)" ] || CHK_FAIL+=(protected_restarted)
diff <(grep -v ADMIN_USER_IDS "$H/state"/r44-*/env-source.orig) <(grep -v ADMIN_USER_IDS "$T/private/summary.env") >/dev/null || CHK_FAIL+=(other_lines_changed)
grep -qx 'NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=7' "$T/private/summary.env" || CHK_FAIL+=(key_not_set)
[ "$(stat -c %a "$T/private/summary.env")" = 600 ] || CHK_FAIL+=(mode_changed)
[ "$(stat -c %a "$H/state")" = 700 ] && [ "$(stat -c %a "$H/state"/r44-*/env-source.orig)" = 600 ] || CHK_FAIL+=(backup_perms)
verdict apply_success
BK=$(ls -d "$H/state"/r44-*)
run audit_after_apply 0 "" audit; has ADMIN_ALLOWLIST_RUNTIME=CONFIGURED_COUNT_1; has RENDERED_CONFIG_HASH_MATCHES_RUNNING=YES; verdict audit_after_apply
run apply_again_refused 3 "owner-token\nAPPLY-R44-ADMIN-7\n" apply 7; has PRESTATE_GATE=ALLOWLIST_ALREADY_SET; verdict apply_again_refused
run rollback_wrong_phrase 3 "no\n" rollback "$BK"; has ROLLBACK_AUTHORIZED=NO; verdict rollback_wrong_phrase
run rollback_manual 0 "ROLLBACK-R44\n" rollback "$BK"; has ROLLBACK=PASS; has ROLLBACK_ENV=PASS; has ROLLBACK_IMAGE=PASS
[ "$(envsha)" = "$E0" ] || CHK_FAIL+=(env_not_restored); verdict rollback_manual
run audit_after_manual_rollback 0 "" audit; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has AUDIT_GATE=PASS; verdict audit_after_manual_rollback

printf 'NEWSFLUX_AI_EXTRA_DRIFT=1\n' >> "$T/private/summary.env"
run audit_source_drift 3 "" audit; has RENDERED_CONFIG_HASH_MATCHES_RUNNING=NO; has AUDIT_GATE=HOLD; verdict audit_source_drift
E1=$(envsha); C1=$(sid)
run apply_refused_on_drift 3 "owner-token\nAPPLY-R44-ADMIN-7\n" apply 7; has PRESTATE_GATE=HOLD; hasnt CONFIG_CHANGE_EXECUTED
[ "$(envsha)" = "$E1" ] && [ "$(sid)" = "$C1" ] || CHK_FAIL+=(state_changed); verdict apply_refused_on_drift

reset 1
run apply_append_form 0 "owner-token\nAPPLY-R44-ADMIN-7\n" apply 7; has CONFIG_CHANGE_RESULT=APPLIED_VERIFIED
[ "$(tail -n1 "$T/private/summary.env")" = NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=7 ] || CHK_FAIL+=(append); verdict apply_append_form

bash "$H/teardown.sh" "$T"
echo "R44_TESTS_PASSED=$pass R44_TESTS_FAILED=$fail"; [ "$fail" = 0 ]
