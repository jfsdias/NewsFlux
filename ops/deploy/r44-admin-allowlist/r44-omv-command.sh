# NEWSFLUX-AI-SETTINGS-01 R4.4 — single OMV procedure. Paste as the admin user with the owner at the terminal.
# MODE=readonly first (no change). MODE=apply only after the specific production GO, with ADMIN_ID from the
# read-only receipt. MODE=rollback with RELEASE_ID if recovery is ever needed. The owner types the key and any
# phrase at the hidden/terminal prompt; nothing secret is passed on the command line or printed.
MODE=readonly
ADMIN_ID=
RELEASE_ID=
sudo -v && MODE="$MODE" ADMIN_ID="$ADMIN_ID" RELEASE_ID="$RELEASE_ID" bash <<'NF_R44'
set -u
SRC=019a11e7a138094adac8ba77112f811b629e123e
EXP_PROC=797708f18e24c7001188dab110fc3dcf53d9b54d6aa38619a7adacd43d3e0f6e
EXP_SUMMARY_IMAGE=sha256:db40e22a12ce3776c2f00666bc7523c7cfbf2127f7e265182d0941dc3b711049
EXP_SUMMARY_REVISION=d54eda2bdb8bc5c3d1bd58d40236f48da762e852
P=deploy/r44-admin-allowlist/r44-allowlist.sh
KV='^[A-Z][A-Z0-9_]{0,63}=[A-Za-z0-9_.:,+-]{0,96}$'
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44.XXXXXX)" || { echo "R44_COMMAND=NO_GO"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
export GIT_TERMINAL_PROMPT=0
git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1 \
  || { echo "PROCEDURE_INTEGRITY=CLONE_FAILED"; echo "R44_COMMAND=NO_GO"; exit 92; }
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SRC" >/dev/null 2>&1
if [ "$(git -C "$D/src" rev-parse HEAD 2>/dev/null)" != "$SRC" ] || [ "$(sha256sum "$D/src/$P" 2>/dev/null | cut -c1-64)" != "$EXP_PROC" ] \
  || [ -n "$(git -C "$D/src" status --porcelain 2>/dev/null)" ]; then
  echo "PROCEDURE_INTEGRITY=FAIL"; echo "R44_COMMAND=NO_GO"; exit 93
fi
echo "PROCEDURE_INTEGRITY=PASS"
sudo env R44_MODE="$MODE" R44_ADMIN_ID="$ADMIN_ID" R44_RELEASE_ID="$RELEASE_ID" \
  R44_EXPECT_IMAGE="$EXP_SUMMARY_IMAGE" R44_EXPECT_REVISION="$EXP_SUMMARY_REVISION" \
  bash "$D/src/$P" >"$D/out"; rc=$?
grep -E "$KV" "$D/out"
echo "R44_NONKV_LINES=$(grep -cvE "$KV" "$D/out")"
echo "R44_EXIT=$rc"
exit "$rc"
NF_R44
rc=$?; echo "WRAPPER_EXIT=$rc"; (exit "$rc")
