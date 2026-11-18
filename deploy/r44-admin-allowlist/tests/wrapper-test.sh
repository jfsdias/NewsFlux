#!/usr/bin/env bash
# R4.4B read-only A/B wrapper tests on the disposable topology. Runs the operator command as written, with
# only these test substitutions: no sudo; clone from the local repository; the tool is started through
# fault_runner.py (terminal answers from a file); the expected image is the disposable test image.
#   bash wrapper-test.sh [OLD_WRAPPER OLD_TOOL_SHA_PIN]   (optional RED control with the R4.4 command)
set -u
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
PY="${R44_PY:-python3}"
export R44T_HOME="${R44T_HOME:-$(mktemp -d /tmp/r44w.XXXXXX)}"
T="$R44T_HOME/topo-privatecanary"
EXP_IMAGE="$(docker image inspect -f '{{.Id}}' r44-summary:test)"
OWNER=tok-owner-CANARYKEY7
pass=0; fail=0

variant() { # out_file wrapper fault answers [expect_image]
  local f=$1 w=$2 fault=$3 ans=$4 img=${5:-$EXP_IMAGE}
  printf '%b' "$ans" > "$R44T_HOME/ans.$(basename "$f")"
  sed -e 's|^sudo -v && ||' \
      -e "s|https://github.com/jfsdias/NewsFlux.git|file://$repo|" \
      -e "s|^EXP_SUMMARY_IMAGE=.*|EXP_SUMMARY_IMAGE=$img|" \
      -e "s|sudo python3 -I \"\$D/src/\$T\"|$PY -I \"$here/fault_runner.py\" \"\$D/src/\$T\" $fault \"$R44T_HOME/ans.$(basename "$f")\"|" \
      "$w" > "$f"
}
case_() { # name wrapper fault answers expect_exit [expect_image] -- patterns
  local n=$1 w=$2 fault=$3 ans=$4 ex=$5 img=$6; shift 6
  local f="$R44T_HOME/w.$n.sh" out rc ok=1
  : > "$R44T_HOME/asks.log"
  variant "$f" "$w" "$fault" "$ans" "$img"
  out="$(R44T_ASKLOG="$R44T_HOME/asks.log" bash "$f" 2>&1)"; rc=$?
  printf '### %s rc=%s\n%s\n' "$n" "$rc" "$out" >> "$R44T_HOME/wrapper.log"
  [ "$rc" = "$ex" ] || { ok=0; echo "  [$n] exit=$rc want=$ex"; }
  for p in "$@"; do
    if [ "${p:0:1}" = '!' ]; then grep -qE -- "${p:1}" <<<"$out" && { ok=0; echo "  [$n] unexpected ${p:1}"; }
    else grep -qxE -- "$p" <<<"$out" || { ok=0; echo "  [$n] missing $p"; }; fi
  done
  if grep -qE 'privatecanary|CANARY|miniflux\.test|rehearsal\.test|tok-|/' <<<"$(grep -v '^WRAPPER_EXIT' <<<"$out")"; then ok=0; echo "  [$n] output not sanitized"; fi
  grep -qx 'STAGING_CLEANED=YES' <<<"$out" || { ok=0; echo "  [$n] staging not cleaned"; }
  ASKS="$(cat "$R44T_HOME/asks.log")"
  [ $ok = 1 ] && { echo "R44B_WRAPPER_TEST $n=PASS"; pass=$((pass+1)); } || { echo "R44B_WRAPPER_TEST $n=FAIL"; fail=$((fail+1)); }
}
no_secret_asked() { grep -q 'TEST_SECRET_ASKS=[1-9]' <<<"$ASKS" && { echo "  secret was requested"; fail=$((fail+1)); pass=$((pass-1)); }; return 0; }

bash "$here/teardown.sh" "$T"; rm -rf "$R44T_HOME/state"; : > "$R44T_HOME/wrapper.log"
bash "$here/setup.sh" "$T"
W="$here/../r44b-readonly-ab.sh"
ZERO="sha256:$(printf '0%.0s' {1..64})"

case_ ab_pass "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 0 "$EXP_IMAGE" TOOL_INTEGRITY=PASS AUDIT_GATE=PASS IDENTITY_GATE_FINAL=PASS \
  ADMIN_ID_CANDIDATE=7 ADMIN_IDS=7 R44_AUDIT_EXIT=0 R44_IDENTITY_EXIT=0 R44B_AB_RESULT=PASS WRAPPER_EXIT=0 R44_AUDIT_NONKV_LINES=0
case_ ab_bad_key "$W" none "tok-wrong-CANARYKEY0\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" ME_LOOKUP=UNAUTHENTICATED R44_IDENTITY_EXIT=3 R44B_AB_RESULT=NO_GO WRAPPER_EXIT=3
case_ ab_not_admin "$W" none "tok-user-CANARYKEY9\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" MINIFLUX_IS_ADMIN=NO R44B_AB_RESULT=NO_GO WRAPPER_EXIT=3
case_ ab_empty_key "$W" none "\n" 3 "$EXP_IMAGE" API_KEY_INPUT=INVALID_FORMAT R44B_AB_RESULT=NO_GO
touch "$T/state/users500"
case_ ab_users_endpoint_fails "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" USERS_LOOKUP=MINIFLUX_UNAVAILABLE R44B_AB_RESULT=NO_GO
rm -f "$T/state/users500"
case_ ab_enumeration_declined "$W" none "$OWNER\n\n" 4 "$EXP_IMAGE" ADMIN_ENUMERATION=DECLINED_BY_OWNER R44B_AB_RESULT=OWNER_DECISION_REQUIRED WRAPPER_EXIT=4
touch "$T/state/multi"
case_ ab_multi_admin "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 4 "$EXP_IMAGE" ADMIN_IDS=7,8 OWNER_SELECTION=OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS R44B_AB_RESULT=OWNER_DECISION_REQUIRED
rm -f "$T/state/multi"
case_ ab_audit_inventory_fail "$W" inspect_fail:other-svc "$OWNER\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" HOST_INVENTORY=INSPECT_FAILED \
  AUDIT_GATE=HOLD IDENTITY_GATE_FINAL=NOT_RUN_AUDIT_FAILED R44B_AB_RESULT=NO_GO '!R44_IDENTITY_EXIT'; no_secret_asked
case_ ab_runtime_untrusted "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 3 "$ZERO" RUNTIME_IMAGE_PINNED=MISMATCH RUNTIME_TRUST_GATE=HOLD \
  IDENTITY_GATE_FINAL=NOT_RUN_AUDIT_FAILED R44B_AB_RESULT=NO_GO; no_secret_asked
docker stop -t 1 miniflux >/dev/null
case_ ab_miniflux_down "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" PROTECTED_MINIFLUX_STATUS=NOT_RUNNING R44B_AB_RESULT=NO_GO; no_secret_asked
docker start miniflux >/dev/null; sleep 1
docker stop -t 1 newsflux >/dev/null
case_ ab_docker_reader_down "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" READER_CADDYFILE_SHA256=UNVERIFIED R44B_AB_RESULT=NO_GO
docker start newsflux >/dev/null
sed 's|^EXP_TOOL=.*|EXP_TOOL=0000000000000000000000000000000000000000000000000000000000000000|' "$W" > "$R44T_HOME/tampered.sh"
case_ ab_tool_pin_mismatch "$R44T_HOME/tampered.sh" none "" 93 "$EXP_IMAGE" TOOL_INTEGRITY=FAIL R44B_AB_RESULT=NO_GO WRAPPER_EXIT=93
mv "$T/compose.yaml" "$T/compose.yaml.moved"
case_ ab_compose_error "$W" none "$OWNER\nLIST-ADMIN-IDS\n" 3 "$EXP_IMAGE" 'COMPOSE_CONFIG_FILE_1=[0-9a-f]{12}:UNREADABLE' R44B_AB_RESULT=NO_GO; no_secret_asked
mv "$T/compose.yaml.moved" "$T/compose.yaml"

if [ $# -ge 1 ]; then  # RED control: the R4.4 command masked a failed identity with exit 0
  OLD="$1"; f="$R44T_HOME/old.sh"; printf '%b' "tok-wrong-CANARYKEY0\n" > "$R44T_HOME/ans.old"
  sed -e 's|^sudo -v && ||' -e "s|https://github.com/jfsdias/NewsFlux.git|file://$repo|" \
      -e "s|sudo python3 -I \"\$D/src/\$T\"|$PY -I \"$here/fault_runner.py\" \"\$D/src/\$T\" none \"$R44T_HOME/ans.old\"|" "$OLD" > "$f"
  out="$(R44T_ASKLOG="$R44T_HOME/asks.log" bash "$f" 2>&1)"; rc=$?
  if [ "$rc" = 0 ] && grep -qx 'R44_IDENTITY_EXIT=3' <<<"$out"; then
    echo "R44B_WRAPPER_RED r44_command_masks_identity_failure=REPRODUCED (identity exit 3, wrapper exit 0)"
  else echo "R44B_WRAPPER_RED r44_command_masks_identity_failure=NOT_REPRODUCED rc=$rc"; fi
  grep -qE '^(COMPOSE_WORKING_DIR|ENV_SOURCE_FILE)=/' <<<"$out" && echo "R44B_WRAPPER_RED r44_command_prints_paths=REPRODUCED"
fi
bash "$here/teardown.sh" "$T"
echo "R44B_WRAPPER_TESTS_PASSED=$pass R44B_WRAPPER_TESTS_FAILED=$fail"
[ "$fail" -eq 0 ]
