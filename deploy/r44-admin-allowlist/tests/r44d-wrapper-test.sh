#!/usr/bin/env bash
set -u
S="$(cd "$(dirname "$0")" && pwd)"; W="$(mktemp -d "$S/r44d-t.XXXX")"
awk '/bash <<.NF_R44D.$/{f=1;next} /^NF_R44D$/{f=0} f' "$S/../r44d-preflight-receipt.sh" > "$W/inner.sh"
pass=0; fail=0
mk() { local n=$1 prod=$2 body=$3 pin=${4:-}
  printf '%s\n' "$body" > "$W/$n.fake"
  { echo 'sudo() { "$@"; }'
    sed -e "s|^PROD=.*|PROD=$prod|" -e "s|https://github.com/jfsdias/NewsFlux.git|file://$(git -C "$S" rev-parse --show-toplevel)|" \
        -e "s|bash \"\$D/src/\$P/ai-settings-readonly-preflight.sh\"|bash \"$W/$n.fake\"|" ${pin:+-e "$pin"} "$W/inner.sh"; } > "$W/$n.sh"; }
run() { local n=$1 ex=$2; shift 2; local out rc ok=1
  out="$(bash "$W/$n.sh" 2>&1)"; rc=$?
  [ "$rc" = "$ex" ] || { ok=0; echo "  [$n] exit=$rc want=$ex"; }
  for p in "$@"; do
    if [ "${p:0:1}" = '!' ]; then grep -qE -- "${p:1}" <<<"$out" && { ok=0; echo "  [$n] unexpected: ${p:1}"; }
    else grep -qxE -- "$p" <<<"$out" || { ok=0; echo "  [$n] missing: $p"; }; fi; done
  grep -qx STAGING_CLEANED=YES <<<"$out" || { ok=0; echo "  [$n] staging not cleaned"; }
  [ $ok = 1 ] && { echo "R44D_TEST $n=PASS"; pass=$((pass+1)); } || { echo "R44D_TEST $n=FAIL"; echo "$out" | sed 's/^/    | /'; fail=$((fail+1)); }; }
repo() { git init -q "$1" && git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init; }
WH=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
P3='echo "PROTECTED_miniflux=RUNNING sha256:aaa"; echo "PROTECTED_miniflux-db=RUNNING postgres:17-secretish-tag"; echo "PROTECTED_npm=RUNNING sha256:ccc"'
TAIL='echo "FAKE_SAW_WALLHOP=${NEWSFLUX_WALLHOP_EXPECTED_SHA256:-NONE}"; printf "%s\n" SECRET_PRINTED=NO WRITES_PERFORMED=NO'
GOOD="echo ADMIN_ALLOWLIST=CONFIGURED_COUNT_1; $P3; echo WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=0 PREFLIGHT=PASS; exit 0"
before=$(ls -d /tmp/nf-r44d-preflight.* 2>/dev/null | wc -l)
repo "$W/p1"; mk all_pass "$W/p1" "$GOOD"
run all_pass 0 PROTECTED_MINIFLUX_STATUS=RUNNING PROTECTED_MINIFLUX_DB_STATUS=RUNNING PROTECTED_NPM_STATUS=RUNNING ADMIN_ALLOWLIST=CONFIGURED_COUNT_1 \
  FAKE_SAW_WALLHOP=$WH PREFLIGHT_NONKV_STDOUT_LINES=0 PROD_REPO_HEAD_UNCHANGED=YES RECEIPT_GATE=PASS '!secretish|sha256:aaa'
repo "$W/p2"; mk admin_empty_hold "$W/p2" "echo ADMIN_ALLOWLIST=EMPTY; $P3; echo WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=1 PREFLIGHT=HOLD; exit 3"
run admin_empty_hold 3 ADMIN_ALLOWLIST=EMPTY PROTECTED_NPM_STATUS=RUNNING RECEIPT_GATE=NO_GO
repo "$W/p3"; mk npm_not_running "$W/p3" "echo ADMIN_ALLOWLIST=CONFIGURED_COUNT_1; echo 'PROTECTED_miniflux=RUNNING x'; echo 'PROTECTED_miniflux-db=RUNNING y'; echo PROTECTED_npm=NOT_RUNNING; echo WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=1 PREFLIGHT=HOLD; exit 3"
run npm_not_running 3 PROTECTED_NPM_STATUS=NOT_RUNNING RECEIPT_GATE=NO_GO
repo "$W/p4"; mk protected_line_missing "$W/p4" "echo ADMIN_ALLOWLIST=CONFIGURED_COUNT_1; echo 'PROTECTED_miniflux=RUNNING x'; echo 'PROTECTED_npm=RUNNING z'; echo WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=0 PREFLIGHT=PASS; exit 0"
run protected_line_missing 4 RECEIPT_GATE=NO_GO '!PROTECTED_MINIFLUX_DB_STATUS'
repo "$W/p5"; mk wallhop_changed "$W/p5" "echo ADMIN_ALLOWLIST=CONFIGURED_COUNT_1; $P3; echo WALLHOP_INTEGRITY=CHANGED_SINCE_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=1 PREFLIGHT=HOLD; exit 3"
run wallhop_changed 3 RECEIPT_GATE=NO_GO
repo "$W/p6"; mk admin_count_2 "$W/p6" "echo ADMIN_ALLOWLIST=CONFIGURED_COUNT_2; $P3; echo WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY; $TAIL; printf '%s\n' HOLD_COUNT=0 PREFLIGHT=PASS; exit 0"
run admin_count_2 4 RECEIPT_GATE=NO_GO
mk head_absent "$W/none" "$GOOD"; run head_absent 4 PROD_REPO_HEAD_UNCHANGED=UNVERIFIED RECEIPT_GATE=NO_GO
repo "$W/p7"; mk head_divergent "$W/p7" "git -C '$W/p7' -c user.email=t@t -c user.name=t commit -q --allow-empty -m drift; $GOOD"
run head_divergent 4 PROD_REPO_HEAD_UNCHANGED=NO RECEIPT_GATE=NO_GO
repo "$W/p8"; mk hash_tampered "$W/p8" "$GOOD" 's/^EXP_PREFLIGHT=86/EXP_PREFLIGHT=00/'
run hash_tampered 93 CHECKOUT_INTEGRITY=FAIL PREFLIGHT=NOT_RUN RECEIPT_GATE=NO_GO
after=$(ls -d /tmp/nf-r44d-preflight.* 2>/dev/null | wc -l)
[ "$before" = "$after" ] && { echo "R44D_TEST no_staging_leftover=PASS"; pass=$((pass+1)); } || { echo "R44D_TEST no_staging_leftover=FAIL"; fail=$((fail+1)); }
rm -rf "$W"; echo "R44D_TESTS_PASSED=$pass R44D_TESTS_FAILED=$fail"; [ $fail = 0 ]
