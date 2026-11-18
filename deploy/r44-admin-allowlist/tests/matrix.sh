#!/usr/bin/env bash
# R4.4B tool matrix on the disposable topology (real Summary image, fake Miniflux). Never a real host.
#   R44_TOOL=<tool.py> [R44_PY=python3.11] [R44T_ONLY=regex] bash matrix.sh
# Requires: docker, image r44-summary:test (build-test-image.sh), a git checkout containing the image revision.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
TOOL="${R44_TOOL:?tool path}"; PY="${R44_PY:-python3}"
export R44T_HOME="${R44T_HOME:-$(mktemp -d /tmp/r44t.XXXXXX)}"
T="$R44T_HOME/topo-privatecanary"
SRC_REPO="${R44T_SOURCE_REPO:-$(git -C "$here" rev-parse --show-toplevel)}"
EXP_IMAGE="$(docker image inspect -f '{{.Id}}' r44-summary:test)"
EXP_REV="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' r44-summary:test)"
TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO")
OWNER=tok-owner-CANARYKEY7; USER9=tok-user-CANARYKEY9
LOG="$R44T_HOME/matrix.log"; : > "$LOG"
pass=0; fail=0; FAILS=()

reset() { bash "$here/teardown.sh" "$T"; rm -rf "$R44T_HOME/state" "$R44T_HOME/lock"; R44T_NO_KEY_LINE="${1:-0}" bash "$here/setup.sh" "$T"; }
run() { # name expect_rc fault answers mode [args...]   (trust args appended)
  N=$1; local ex=$2 fault=$3 inp=$4; shift 4
  printf '%b' "$inp" > "$R44T_HOME/in"
  OUT="$("$PY" -I "$here/fault_runner.py" "$TOOL" "$fault" "$R44T_HOME/in" "$@" "${TRUST[@]}" 2>"$R44T_HOME/err")"; RC=$?
  ERR="$(cat "$R44T_HOME/err")"
  printf '### %s rc=%s\n%s\n--- stderr\n%s\n' "$N" "$RC" "$OUT" "$ERR" >> "$LOG"
  CHK=()
  [ "$RC" = "$ex" ] || CHK+=("exit=$RC want=$ex")
  # Output contract: no path, URL, host, origin, key, username or env value may appear.
  if grep -qE 'privatecanary|CANARY|miniflux\.test|rehearsal\.test|tok-|/' <<<"$OUT"; then CHK+=(output_not_sanitized); fi
  if grep -qE 'CANARY|tok-' <<<"$ERR"; then CHK+=(stderr_leak); fi
}
has() { grep -qxE -- "$1" <<<"$OUT" || CHK+=("missing:$1"); }
hasnt() { grep -qE -- "$1" <<<"$OUT" && CHK+=("unexpected:$1"); return 0; }
asks() { grep -qx "TEST_SECRET_ASKS=$1" <<<"$ERR" || CHK+=("secret_asks!=$1"); }
check() { "$@" || CHK+=("check:$*"); }
done_() {
  if [ ${#CHK[@]} -eq 0 ]; then echo "R44B_TEST $N=PASS"; pass=$((pass+1))
  else echo "R44B_TEST $N=FAIL ${CHK[*]}"; fail=$((fail+1)); FAILS+=("$N")
    # The tool's stdout is sanitized by contract (and checked above), so it is safe to show for diagnosis.
    grep -vE 'CANARY|tok-' <<<"$OUT" | sed 's/^/    | /'; fi
}
want() { [ -z "${R44T_ONLY:-}" ] || grep -qE "$R44T_ONLY" <<<"$1"; }
envsha() { sha256sum "$T/private/summary.env" | cut -c1-64; }
envstat() { stat -c '%a %u %g' "$T/private/summary.env"; }
sid() { docker ps -aq --no-trunc --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api; }
others() { docker inspect -f '{{.Name}} {{.Id}} {{.State.StartedAt}}' newsflux miniflux miniflux-db npm other-svc; }
unchanged() { [ "$(envsha)" = "$E0" ] && [ "$(envstat)" = "$S0" ] && [ "$(sid)" = "$C0" ] && [ "$(others)" = "$O0" ]; }
snap() { E0=$(envsha); S0=$(envstat); C0=$(sid); O0=$(others); }

reset; snap
# ---------------------------------------------------------------- read-only: audit + runtime trust
if want audit_clean; then run audit_clean 0 none "" audit
  has AUDIT_GATE=PASS; has RUNTIME_TRUST_GATE=PASS; has 'RUNTIME_CODE_MANIFEST=MATCH_COUNT_[0-9]+'; has RUNTIME_FS_DRIFT=NONE
  has 'HOST_INVENTORY=COMPLETE_COUNT_[0-9]+'; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has DEPLOYED_ADMIN_ROUTE_CALLERS=0
  has 'COMPOSE_PROJECT_DIR_FP=[0-9a-f]{12}'; has 'ENV_SOURCE_PATH_FP=[0-9a-f]{12}'; has PROTECTED_NPM_STATUS=RUNNING
  check unchanged; done_; fi
if want trust_source_clone_other_owner; then  # OMV: clone made by the operator, tool run as root
  if [ "$(id -u)" = 0 ]; then
    rm -rf "$R44T_HOME/othersrc"; git clone -q --no-checkout "$SRC_REPO" "$R44T_HOME/othersrc"; chown -R nobody "$R44T_HOME/othersrc"
    TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$R44T_HOME/othersrc")
    run trust_source_clone_other_owner 0 none "" audit; has 'RUNTIME_CODE_MANIFEST=MATCH_COUNT_[0-9]+'; has AUDIT_GATE=PASS
    TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO"); done_
  else echo "R44B_TEST trust_source_clone_other_owner=SKIPPED_NOT_ROOT"; fi
fi
if want audit_semantic_path; then run audit_semantic_path 0 hash_divergent "" audit
  has RENDERED_CONFIG_HASH_MATCHES_RUNNING=NO; has RENDER_EQUIVALENCE=SEMANTIC_ALL_FIELDS; has AUDIT_GATE=PASS; done_; fi
if want audit_inventory_fail_closed; then run audit_inventory_fail_closed 3 inspect_fail:other-svc "" audit
  has HOST_INVENTORY=INSPECT_FAILED; has AUDIT_GATE=HOLD; done_; fi
# ---------------------------------------------------------------- identity
if want identity_owner_consent; then run identity_owner_consent 0 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has RUNTIME_TRUST_GATE=PASS; has ADMIN_ID_CANDIDATE=7; has MINIFLUX_IS_ADMIN=YES; has ADMIN_ENUMERATION=CONSENTED
  has ADMIN_COUNT=1; has ADMIN_IDS=7; has OWNER_SELECTION=SINGLE_ADMIN_IS_CALLER; has IDENTITY_GATE_FINAL=PASS
  hasnt USERS_TOTAL; asks 1; done_; fi
if want identity_enumeration_declined; then run identity_enumeration_declined 4 none "$OWNER\n\n" identity
  has ADMIN_ENUMERATION=DECLINED_BY_OWNER; has OWNER_SELECTION=OWNER_DECISION_REQUIRED_ENUMERATION_DECLINED
  has IDENTITY_GATE_FINAL=OWNER_DECISION_REQUIRED; hasnt ADMIN_IDS; done_; fi
if want identity_multi_admin; then touch "$T/state/multi"
  run identity_multi_admin 4 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has ADMIN_COUNT=2; has ADMIN_IDS=7,8; has OWNER_SELECTION=OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS
  has IDENTITY_GATE_FINAL=OWNER_DECISION_REQUIRED; rm -f "$T/state/multi"; done_; fi
if want identity_not_admin; then run identity_not_admin 3 none "$USER9\nLIST-ADMIN-IDS\n" identity
  has MINIFLUX_IS_ADMIN=NO; has OWNER_SELECTION=CALLER_NOT_MINIFLUX_ADMIN; has IDENTITY_GATE_FINAL=HOLD; done_; fi
if want identity_bad_key; then run identity_bad_key 3 none "tok-wrong-CANARYKEY0\nLIST-ADMIN-IDS\n" identity
  has ME_LOOKUP=UNAUTHENTICATED; has IDENTITY_GATE_FINAL=HOLD; done_; fi
if want identity_empty_key; then run identity_empty_key 3 none "\n" identity; has API_KEY_INPUT=INVALID_FORMAT; done_; fi
if want identity_users_endpoint_fails; then touch "$T/state/users500"
  run identity_users_endpoint_fails 3 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has USERS_LOOKUP=MINIFLUX_UNAVAILABLE; has IDENTITY_GATE_FINAL=HOLD; rm -f "$T/state/users500"; done_; fi
if want identity_miniflux_down; then docker stop -t 1 miniflux >/dev/null
  run identity_miniflux_down 3 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has ME_LOOKUP=MINIFLUX_UNAVAILABLE; has IDENTITY_GATE_FINAL=HOLD; docker start miniflux >/dev/null; sleep 1; done_; fi
# ---------------------------------------------------------------- runtime trust before the secret
if want trust_image_mismatch; then
  TRUST=(--expect-image "sha256:$(printf '0%.0s' {1..64})" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO")
  run trust_image_mismatch 3 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has RUNTIME_IMAGE_PINNED=MISMATCH; has RUNTIME_TRUST_GATE=HOLD; asks 0; hasnt ME_LOOKUP
  TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO"); done_; fi
if want trust_revision_mismatch; then
  TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$(printf 'a%.0s' {1..40})" --source-repo "$SRC_REPO")
  run trust_revision_mismatch 3 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has RUNTIME_REVISION=MISMATCH; has RUNTIME_TRUST_GATE=HOLD; asks 0
  TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO"); done_; fi
if want trust_missing_expectations; then printf '%b' "$OWNER\n" > "$R44T_HOME/in"
  OUT="$("$PY" -I "$here/fault_runner.py" "$TOOL" none "$R44T_HOME/in" identity 2>"$R44T_HOME/err")"; RC=$?; ERR="$(cat "$R44T_HOME/err")"
  N=trust_missing_expectations; CHK=(); [ "$RC" = 3 ] || CHK+=("exit=$RC"); has RUNTIME_EXPECTATIONS=MISSING; asks 0; done_; fi
if want trust_code_tampered; then
  docker exec -u 0 "$(sid)" sh -c 'printf "\n# tampered\n" >> /app/services/article_intel_auth/auth.py'
  run trust_code_tampered 3 none "$OWNER\nLIST-ADMIN-IDS\n" identity
  has RUNTIME_FS_DRIFT=DETECTED; has RUNTIME_CODE_MANIFEST=MISMATCH; has RUNTIME_TRUST_GATE=HOLD; asks 0; done_
  reset; snap; fi
# ---------------------------------------------------------------- apply refusals (nothing may change)
if want apply_wrong_phrase; then run apply_wrong_phrase 3 none "$OWNER\nLIST-ADMIN-IDS\nyes\n" apply 7
  has CONFIG_CHANGE_AUTHORIZED=NO; hasnt CONFIG_CHANGE_EXECUTED; check unchanged; done_; fi
if want apply_id_mismatch; then run apply_id_mismatch 3 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-9\n" apply 9
  has ADMIN_ID_VERIFIED=MISMATCH_WITH_LIVE_IDENTITY; check unchanged; done_; fi
if want apply_non_admin_key; then run apply_non_admin_key 3 none "$USER9\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-9\n" apply 9
  has OWNER_SELECTION=CALLER_NOT_MINIFLUX_ADMIN; check unchanged; done_; fi
if want apply_bad_arg; then run apply_bad_arg 3 none "" apply 07x; has ADMIN_ID_ARGUMENT=INVALID; check unchanged; done_; fi
if want apply_inventory_fail_closed; then run apply_inventory_fail_closed 3 inspect_fail:other-svc "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has HOST_INVENTORY=INSPECT_FAILED; hasnt CONFIG_CHANGE_EXECUTED; asks 0; check unchanged; done_; fi
if want apply_trust_mismatch_no_secret; then
  TRUST=(--expect-image "sha256:$(printf '0%.0s' {1..64})" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO")
  run apply_trust_mismatch_no_secret 3 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has RUNTIME_TRUST_GATE=HOLD; asks 0; check unchanged
  TRUST=(--expect-image "$EXP_IMAGE" --expect-revision "$EXP_REV" --source-repo "$SRC_REPO"); done_; fi
# ---------------------------------------------------------------- P0: failure after os.replace must roll back
if want apply_fsync_after_replace; then run apply_fsync_after_replace 5 fsync_after_replace "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has CONFIG_CHANGE_RESULT=FAILED_ROLLING_BACK; has ROLLBACK_ENV_FILE_RESTORED=YES; has ROLLBACK_ENV_FILE_DURABLE=YES
  has ROLLBACK_CONFIG_EQUIVALENT=PASS; has ROLLBACK_ENV=PASS; has ROLLBACK_OTHER_CONTAINERS=PASS; has ROLLBACK=PASS
  hasnt CONFIG_CHANGE_RESULT=APPLIED_VERIFIED; check unchanged; done_; fi
if want apply_fsync_always_incomplete; then run apply_fsync_always_incomplete 6 fsync_after_replace_always "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has ROLLBACK_ENV_FILE_RESTORED=YES; has ROLLBACK_ENV_FILE_DURABLE=NO; has ROLLBACK=FAIL; has R44_RESULT=ROLLBACK_INCOMPLETE
  hasnt CONFIG_CHANGE_RESULT=APPLIED_VERIFIED
  check test "$(envsha)" = "$E0"; check test "$(sid)" = "$C0"; done_; fi
if want apply_drift_rollback; then run apply_drift_rollback 5 drift_env "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has FAULT_INJECTED=DRIFT_ENV; has ROLLBACK=PASS; has ROLLBACK_ENV=PASS
  check test "$(envsha)" = "$E0"; done_
  run audit_after_drift_rollback 0 none "" audit; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has 'RENDER_EQUIVALENCE=(CONFIG_HASH|SEMANTIC_ALL_FIELDS)'; done_; fi
# ---------------------------------------------------------------- success, re-apply refusal, manual rollback
if want apply_success; then reset; snap
  run apply_success 0 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  for k in PRESTATE_GATE=PASS RUNTIME_TRUST_GATE=PASS ADMIN_ID_VERIFIED=7 CONFIG_CHANGE_AUTHORIZED=YES_OWNER_TYPED_PHRASE BACKUP_GATE=PASS \
    'BACKUP_ID=r44-[0-9]{8}T[0-9]{6}Z' RENDER_DIFF_GATE=PASS_ONLY_ADMIN_KEY IMAGE_IDENTITY_PRESERVED=PASS OTHER_ENV_UNCHANGED=PASS \
    SUMMARY_MOUNTS_PRESERVED=PASS SUMMARY_HEALTH=PASS EFFECTIVE_ALLOWLIST_CONFIGURED_COUNT_1=PASS ADMIN_AUTHZ_PROBE=PASS \
    PROTECTED_SERVICES_UNCHANGED=PASS READER_CADDYFILE_UNCHANGED=PASS FLAG_INFERENCE_ENABLED_UNCHANGED=PASS \
    CONFIG_CHANGE_RESULT=APPLIED_VERIFIED R44_RESULT=APPLIED_VERIFIED; do has "$k"; done
  check test "$(others)" = "$O0"
  BK=$(ls -d "$R44T_HOME/state"/r44-* 2>/dev/null | head -1)
  check diff -q <(grep -v ADMIN_USER_IDS "$BK/env-source.orig") <(grep -v ADMIN_USER_IDS "$T/private/summary.env")
  check grep -qx 'NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=7' "$T/private/summary.env"
  check test "$(envstat)" = "$S0"
  check test "$(stat -c %a "$R44T_HOME/state")" = 700
  check test "$(stat -c %a "$BK/env-source.orig")" = 600
  done_
  BID=$(basename "$BK")
  run audit_after_apply 0 none "" audit; has ADMIN_ALLOWLIST_RUNTIME=CONFIGURED_COUNT_1; has 'RENDER_EQUIVALENCE=(CONFIG_HASH|SEMANTIC_ALL_FIELDS)'; done_
  run apply_again_refused 3 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7; has PRESTATE_GATE=ALLOWLIST_ALREADY_SET; asks 0; done_
  run rollback_bad_id 3 none "ROLLBACK-R44\n" rollback ../etc; has BACKUP_ID_ARGUMENT=INVALID; done_
  run rollback_wrong_phrase 3 none "no\n" rollback "$BID"; has ROLLBACK_AUTHORIZED=NO; done_
  run rollback_manual 0 none "ROLLBACK-R44\n" rollback "$BID"
  has BACKUP_INTEGRITY=PASS; has ROLLBACK=PASS; has ROLLBACK_ENV=PASS; has ROLLBACK_IMAGE=PASS
  check test "$(envsha)" = "$E0"; done_
  run audit_after_manual_rollback 0 none "" audit; has ADMIN_ALLOWLIST_RUNTIME=EMPTY; has AUDIT_GATE=PASS; done_; fi
# ---------------------------------------------------------------- drift and the append form
if want apply_refused_on_source_drift; then printf 'NEWSFLUX_AI_EXTRA_DRIFT=1\n' >> "$T/private/summary.env"; snap
  run audit_source_drift 3 none "" audit; has RENDER_EQUIVALENCE=MISMATCH; has AUDIT_GATE=HOLD; done_
  run audit_semantic_detects_drift 3 hash_divergent "" audit; has RENDER_EQUIVALENCE=MISMATCH; has RENDER_EQUIVALENCE_FIELDS=ENVIRONMENT; done_
  run apply_refused_on_source_drift 3 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has PRESTATE_GATE=HOLD; hasnt CONFIG_CHANGE_EXECUTED; asks 0; check unchanged; done_; fi
if want apply_restart_protected; then reset; snap
  run apply_restart_protected 6 restart_protected "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has PROTECTED_SERVICES_UNCHANGED=FAIL; has ROLLBACK_ENV=PASS; has ROLLBACK_OTHER_CONTAINERS=FAIL; has R44_RESULT=ROLLBACK_INCOMPLETE
  check test "$(envsha)" = "$E0"; done_; fi
if want apply_success_semantic_path; then reset; snap
  run apply_success_semantic_path 0 hash_divergent "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has RENDER_EQUIVALENCE=SEMANTIC_ALL_FIELDS; has RENDERED_EQUIVALENT_AFTER=PASS; has CONFIG_CHANGE_RESULT=APPLIED_VERIFIED
  check test "$(others)" = "$O0"; done_; fi
if want rollback_semantic_path; then reset; snap  # Compose versions where config --hash differs from the up label
  run apply_fsync_after_replace_semantic 5 hash_divergent+fsync_after_replace "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has ROLLBACK=PASS; has ROLLBACK_CONFIG_EQUIVALENT=PASS; hasnt ROLLBACK_RECREATE; check unchanged; done_
  run apply_drift_rollback_semantic 5 hash_divergent+drift_env "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has ROLLBACK=PASS; has ROLLBACK_CONFIG_EQUIVALENT=PASS; has ROLLBACK_ENV=PASS; check test "$(envsha)" = "$E0"; done_
  run apply_success_semantic_for_rollback 0 hash_divergent "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7
  has CONFIG_CHANGE_RESULT=APPLIED_VERIFIED; done_
  BID=$(basename "$(ls -d "$R44T_HOME/state"/r44-* | tail -1)")
  run rollback_manual_semantic 0 hash_divergent "ROLLBACK-R44\n" rollback "$BID"
  has ROLLBACK=PASS; has ROLLBACK_CONFIG_EQUIVALENT=PASS; has ROLLBACK_ENV=PASS; check test "$(envsha)" = "$E0"; done_
fi
if want apply_append_form; then reset 1
  run apply_append_form 0 none "$OWNER\nLIST-ADMIN-IDS\nAPPLY-R44-ADMIN-7\n" apply 7; has CONFIG_CHANGE_RESULT=APPLIED_VERIFIED
  check test "$(tail -n1 "$T/private/summary.env")" = NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=7; done_; fi

bash "$here/teardown.sh" "$T"
echo "R44B_TESTS_PASSED=$pass R44B_TESTS_FAILED=$fail"
[ "$fail" -eq 0 ] || echo "R44B_FAILED_TESTS=${FAILS[*]}"
echo "R44B_LOG=$LOG"
[ "$fail" -eq 0 ]
