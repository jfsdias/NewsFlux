sudo -v && bash <<'NF_R44D'
set -u
SHA=4c3e07529d706ffc37115aa8de808f36cccdc244
EXP_PREFLIGHT=86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196
EXP_BASELINE=7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d
EXP_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
PROD=/dockerdata/compose/newsflux/repo
P=deploy/release-governance
KV='^[A-Z][A-Z0-9_]*=[A-Za-z0-9_.:,+-]{0,128}$'
WALLHOP_EXPECTED=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
echo "R44D_PREFLIGHT_RUN=START"
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44d-preflight.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; echo "RECEIPT_GATE=NO_GO"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
case "$(readlink -f "$D")/" in "$(readlink -f "$PROD" 2>/dev/null || echo /nonexistent)"/*) echo "STAGING=INSIDE_PRODUCTION_REPO"; echo "RECEIPT_GATE=NO_GO"; exit 91;; esac
prod_head() {
  local v
  v="$(sudo git -c safe.directory="$PROD" -C "$PROD" rev-parse --verify -q 'HEAD^{commit}' 2>/dev/null)" || v=""
  [[ "$v" =~ ^[0-9a-f]{40}$ ]] && printf '%s' "$v" || printf 'INVALID'
}
PROD_BEFORE="$(prod_head)"
export GIT_TERMINAL_PROMPT=0
if ! git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1; then
  echo "CHECKOUT_INTEGRITY=CLONE_FAILED"; echo "PREFLIGHT=NOT_RUN"; echo "RECEIPT_GATE=NO_GO"; exit 92
fi
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SHA" >/dev/null 2>&1
CO="$(git -C "$D/src" rev-parse HEAD 2>/dev/null || echo NONE)"
echo "CHECKOUT_SHA=$CO"
h() { sha256sum "$D/src/$1" 2>/dev/null | cut -c1-64; }
ok=YES
[ "$CO" = "$SHA" ] || ok=NO
[ "$(h $P/ai-settings-readonly-preflight.sh)" = "$EXP_PREFLIGHT" ] || ok=NO
[ "$(h $P/ai-settings-flag-baseline.json)" = "$EXP_BASELINE" ] || ok=NO
[ "$(h deploy/article-intel-pilot/Caddyfile)" = "$EXP_CADDY" ] || ok=NO
[ -z "$(git -C "$D/src" status --porcelain 2>/dev/null)" ] || ok=NO
if [ "$ok" != YES ]; then echo "CHECKOUT_INTEGRITY=FAIL"; echo "PREFLIGHT=NOT_RUN"; echo "RECEIPT_GATE=NO_GO"; exit 93; fi
echo "CHECKOUT_INTEGRITY=PASS"
cd "$D" || { echo "RECEIPT_GATE=NO_GO"; exit 94; }
sudo env NEWSFLUX_PROTECTED_CONTAINERS="miniflux miniflux-db npm" NEWSFLUX_WALLHOP_EXPECTED_SHA256="$WALLHOP_EXPECTED" \
  bash "$D/src/$P/ai-settings-readonly-preflight.sh" >"$D/out" 2>"$D/err"
rc=$?
sed -nE 's/^PROTECTED_([A-Za-z0-9_.-]+)=(RUNNING|ABSENT|NOT_RUNNING)( .*)?$/\1 \2/p' "$D/out" | while read -r n s; do
  echo "PROTECTED_$(printf '%s' "$n" | tr 'a-z.-' 'A-Z__')_STATUS=$s"; done > "$D/prot"
cat "$D/prot"
grep -E "$KV" "$D/out"
echo "PREFLIGHT_NONKV_STDOUT_LINES=$(grep -cvE "$KV|^PROTECTED_[A-Za-z0-9_.-]+=(RUNNING|ABSENT|NOT_RUNNING)( .*)?$" "$D/out")"
echo "PREFLIGHT_STDERR_LINES=$(wc -l <"$D/err" | tr -d ' ')"
PROD_AFTER="$(prod_head)"
if [ "$PROD_BEFORE" = INVALID ] || [ "$PROD_AFTER" = INVALID ]; then W=UNVERIFIED
elif [ "$PROD_BEFORE" = "$PROD_AFTER" ]; then W=YES
else W=NO; fi
echo "PROD_REPO_HEAD_UNCHANGED=$W"
echo "EXIT_CODE=$rc"
f() { grep -qx "$1" "$D/out"; }
p() { grep -qx "$1" "$D/prot"; }
if [ "$rc" -eq 0 ] && [ "$W" = YES ] && f "PREFLIGHT=PASS" && f "HOLD_COUNT=0" && f "WRITES_PERFORMED=NO" && f "SECRET_PRINTED=NO" \
  && f "ADMIN_ALLOWLIST=CONFIGURED_COUNT_1" && f "WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY" \
  && p "PROTECTED_MINIFLUX_STATUS=RUNNING" && p "PROTECTED_MINIFLUX_DB_STATUS=RUNNING" && p "PROTECTED_NPM_STATUS=RUNNING" \
  && [ "$(wc -l <"$D/prot" | tr -d ' ')" = 3 ]; then
  echo "RECEIPT_GATE=PASS"; exit 0
fi
echo "RECEIPT_GATE=NO_GO"
[ "$rc" -ne 0 ] && exit "$rc" || exit 4
NF_R44D
echo "WRAPPER_EXIT=$?"
