sudo -v && bash <<'NF_R44B_AB'
# NEWSFLUX-AI-SETTINGS-01 R4.4B Gates A/B — READ-ONLY. No allowlist change, no compose up, no restart.
# Runs audit first (runtime trust + host inventory + config source); the owner's Miniflux key is requested
# only if the audit passes. Aggregate result and exit code: PASS=0, OWNER_DECISION_REQUIRED=4, NO_GO=nonzero.
set -u
SRC=b56d35fdb6d6a9e0399c3911d02980e7cc5e5f92
EXP_TOOL=2625148cc5c5d9602cf70961881f9398eeae83d8571ea80b3cb30e0a6842d9a8
EXP_SUMMARY_IMAGE=sha256:db40e22a12ce3776c2f00666bc7523c7cfbf2127f7e265182d0941dc3b711049
EXP_SUMMARY_REVISION=d54eda2bdb8bc5c3d1bd58d40236f48da762e852
T=deploy/r44-admin-allowlist/r44_admin_allowlist.py
KV='^[A-Z][A-Z0-9_]{0,63}=[A-Za-z0-9_.:,+-]{0,96}$'
echo "R44B_AB_RUN=START_READ_ONLY"
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44b.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; echo "R44B_AB_RESULT=NO_GO"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
export GIT_TERMINAL_PROMPT=0
if ! git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1; then
  echo "TOOL_INTEGRITY=CLONE_FAILED"; echo "R44B_AB_RESULT=NO_GO"; exit 92
fi
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SRC" >/dev/null 2>&1
if [ "$(git -C "$D/src" rev-parse HEAD 2>/dev/null)" != "$SRC" ] \
  || [ "$(sha256sum "$D/src/$T" 2>/dev/null | cut -c1-64)" != "$EXP_TOOL" ] \
  || ! git -C "$D/src" cat-file -e "$EXP_SUMMARY_REVISION^{commit}" 2>/dev/null \
  || [ -n "$(git -C "$D/src" status --porcelain 2>/dev/null)" ]; then
  echo "TOOL_INTEGRITY=FAIL"; echo "R44B_AB_RESULT=NO_GO"; exit 93
fi
echo "TOOL_INTEGRITY=PASS"
echo "TOOL_SOURCE_SHA=$SRC"
OMV_PY="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>/dev/null || echo NONE)"
echo "OMV_PYTHON=$OMV_PY"
cd "$D" || { echo "R44B_AB_RESULT=NO_GO"; exit 94; }
TRUST=(--expect-image "$EXP_SUMMARY_IMAGE" --expect-revision "$EXP_SUMMARY_REVISION" --source-repo "$D/src")
run() { # mode — prompts go to the terminal only; stdout is shown only if it matches the KEY=VALUE contract
  local m="$1" M rc nonkv errl
  M="$(printf %s "$1" | tr a-z A-Z)"
  sudo python3 -I "$D/src/$T" "$m" "${TRUST[@]}" </dev/null 2>"$D/$m.err" | tee "$D/$m.out" | grep --line-buffered -E "$KV"
  rc="${PIPESTATUS[0]}"
  nonkv="$(grep -cvE "$KV" "$D/$m.out")"; errl="$(wc -l <"$D/$m.err" | tr -d ' ')"
  echo "R44_${M}_NONKV_LINES=$nonkv"
  echo "R44_${M}_STDERR_LINES=$errl"
  echo "R44_${M}_EXIT=$rc"
  if [ "$rc" = 0 ] && { [ "$nonkv" != 0 ] || [ "$errl" != 0 ]; }; then rc=3; echo "R44_${M}_CONTRACT=VIOLATED"; fi
  return "$rc"
}
gate() { sed -n "s/^$2=//p" "$D/$1.out" 2>/dev/null | tail -n1; }
run audit; RA=$?
AG="$(gate audit AUDIT_GATE)"
if [ "$RA" = 0 ] && [ "$AG" = PASS ]; then
  run identity; RI=$?
  IG="$(gate identity IDENTITY_GATE_FINAL)"
else
  RI=3; IG=NOT_RUN_AUDIT_FAILED
  echo "IDENTITY_GATE_FINAL=NOT_RUN_AUDIT_FAILED"
fi
if [ "$RA" = 0 ] && [ "$AG" = PASS ] && [ "$RI" = 0 ] && [ "$IG" = PASS ]; then
  echo "R44B_AB_RESULT=PASS"; exit 0
fi
if [ "$RA" = 0 ] && [ "$AG" = PASS ] && [ "$RI" = 4 ] && [ "$IG" = OWNER_DECISION_REQUIRED ]; then
  echo "R44B_AB_RESULT=OWNER_DECISION_REQUIRED"; exit 4
fi
echo "R44B_AB_RESULT=NO_GO"
if [ "$RA" != 0 ]; then exit "$RA"; fi
if [ "$RI" != 0 ] && [ "$RI" != 4 ]; then exit "$RI"; fi
exit 3
NF_R44B_AB
rc=$?; echo "WRAPPER_EXIT=$rc"; (exit "$rc")
