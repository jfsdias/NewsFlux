# NEWSFLUX-AI-SETTINGS-01 — R4.3A operator receipt hardening

Date: 2026-11-18 · Status: **NO-GO (pending operator receipt)** · Merges: none · Deploy: none · Production mutations: 0

Supersedes the operator command in `NEWSFLUX_AI_SETTINGS_01_R43_FINAL_OMV_PREFLIGHT.md`. Only the operational wrapper changes. The preflight (#265 @ `4c3e075`), its three SHA-256 pins, the application and the runtime are unchanged.

## Defect (PM finding, reproduced)

In R4.3, `prod_head()` printed `ABSENT` on any read failure, so when the production HEAD couldn't be read both before and after, the wrapper printed a false `PROD_REPO_HEAD_UNCHANGED=YES`. RED control with the R4.3 wrapper and the production repo absent: `PROD_REPO_HEAD_UNCHANGED=YES`, `EXIT_CODE=0`.

## Fix

- `prod_head()` reads `rev-parse --verify -q 'HEAD^{commit}'` and accepts only `^[0-9a-f]{40}$`; anything else is `INVALID`.
- Either read `INVALID` → `PROD_REPO_HEAD_UNCHANGED=UNVERIFIED`; two valid SHAs that differ → `NO`; two valid SHAs that are equal → `YES`.
- New final line, `RECEIPT_GATE=PASS`, is printed only if `EXIT_CODE=0`, `PROD_REPO_HEAD_UNCHANGED=YES`, `PREFLIGHT=PASS`, `WRITES_PERFORMED=NO` and `SECRET_PRINTED=NO` are all present (with `CHECKOUT_INTEGRITY=PASS` a precondition for the run). Otherwise `RECEIPT_GATE=NO_GO`, with the preflight's exit code or `4`.
- Preserved: isolated `mktemp` staging (refused inside the production repo, trap-cleaned), anonymous pinned clone, the three SHA-256 pins, the `KEY=VALUE` allowlist with counted non-KV lines, and `rc=$?` capture.

## Tests (wrapper only, disposable fakes: production repo, preflight, pass-through sudo)

```ini
R43A_TEST valid_equal=PASS          # YES, RECEIPT_GATE=PASS, exit 0
R43A_TEST head_absent=PASS          # UNVERIFIED, NO_GO, exit 4
R43A_TEST head_not_repo=PASS        # UNVERIFIED
R43A_TEST head_unborn=PASS          # UNVERIFIED (repo with no commit)
R43A_TEST head_lost_after=PASS      # UNVERIFIED (readable before, not after)
R43A_TEST head_divergent=PASS       # NO, NO_GO
R43A_TEST hash_tampered=PASS        # CHECKOUT_INTEGRITY=FAIL, PREFLIGHT=NOT_RUN, exit 93
R43A_TEST preflight_hold=PASS       # exit 3, NO_GO
R43A_TEST missing_field=PASS        # PASS without WRITES_PERFORMED=NO -> NO_GO
R43A_TEST sanitized=PASS            # URL/raw/stderr lines counted, never printed
R43A_TEST no_staging_leftover=PASS
R43A_TESTS_PASSED=11 R43A_TESTS_FAILED=0
```

The hash checks run against the real files at `4c3e075`. The real preflight was not run or simulated outside the OMV.

## Operator command (paste on the OMV as the admin user)

```bash
sudo -v && bash <<'NF_R43A'
set -u
SHA=4c3e07529d706ffc37115aa8de808f36cccdc244
EXP_PREFLIGHT=86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196
EXP_BASELINE=7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d
EXP_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
PROD=/dockerdata/compose/newsflux/repo
P=deploy/release-governance
KV='^[A-Z][A-Z0-9_]*=[A-Za-z0-9_.:,+-]{0,128}$'
echo "R43A_PREFLIGHT_RUN=START"
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r43a-preflight.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; echo "RECEIPT_GATE=NO_GO"; exit 90; }
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
sudo env NEWSFLUX_PROTECTED_CONTAINERS="miniflux miniflux-db npm" \
  bash "$D/src/$P/ai-settings-readonly-preflight.sh" >"$D/out" 2>"$D/err"
rc=$?
grep -E "$KV" "$D/out"
echo "PREFLIGHT_NONKV_STDOUT_LINES=$(grep -cvE "$KV" "$D/out")"
echo "PREFLIGHT_STDERR_LINES=$(wc -l <"$D/err" | tr -d ' ')"
PROD_AFTER="$(prod_head)"
if [ "$PROD_BEFORE" = INVALID ] || [ "$PROD_AFTER" = INVALID ]; then W=UNVERIFIED
elif [ "$PROD_BEFORE" = "$PROD_AFTER" ]; then W=YES
else W=NO; fi
echo "PROD_REPO_HEAD_UNCHANGED=$W"
echo "EXIT_CODE=$rc"
f() { grep -qx "$1" "$D/out"; }
if [ "$rc" -eq 0 ] && [ "$W" = YES ] && f "PREFLIGHT=PASS" && f "WRITES_PERFORMED=NO" && f "SECRET_PRINTED=NO"; then
  echo "RECEIPT_GATE=PASS"; exit 0
fi
echo "RECEIPT_GATE=NO_GO"
[ "$rc" -ne 0 ] && exit "$rc" || exit 4
NF_R43A
echo "WRAPPER_EXIT=$?"
```

Return the full printed block.

## GO criteria (all required, otherwise NO-GO with read-only diagnosis)

```ini
CHECKOUT_INTEGRITY=PASS
PREFLIGHT=PASS
EXIT_CODE=0
PROD_REPO_HEAD_UNCHANGED=YES
WRITES_PERFORMED=NO
SECRET_PRINTED=NO
RECEIPT_GATE=PASS
```

Ledger: `DUAL_SYNC=PENDING`, `REASON=CENTRAL_LEDGER_MERGE_NOT_AUTHORIZED`. `MERGE_READY_CHAIN=NO` until the receipt.

<details><summary>Test harness used (wrapper only)</summary>

```bash
#!/usr/bin/env bash
set -u
S="$(cd "$(dirname "$0")" && pwd)"; W="$(mktemp -d "$S/r43a-t.XXXX")"
awk '/bash <<.NF_R43A.$/{f=1;next} /^NF_R43A$/{f=0} f' "$S/r43a-omv.sh" > "$W/inner.sh"
pass=0; fail=0
mk() { # name prodpath fakebody [pinsed]
  local n=$1 prod=$2 body=$3 pin=${4:-}
  printf '%s\n' "$body" > "$W/$n.fake"
  { echo 'sudo() { "$@"; }'
    sed -e "s|^PROD=.*|PROD=$prod|" \
        -e "s|https://github.com/jfsdias/NewsFlux.git|file:///home/user/NewsFlux|" \
        -e "s|bash \"\$D/src/\$P/ai-settings-readonly-preflight.sh\"|bash \"$W/$n.fake\"|" \
        ${pin:+-e "$pin"} "$W/inner.sh"; } > "$W/$n.sh"
}
run() { # name expect_exit grep-patterns... ; neg patterns prefixed with '!'
  local n=$1 ex=$2; shift 2
  local out rc ok=1
  out="$(bash "$W/$n.sh" 2>&1)"; rc=$?
  [ "$rc" = "$ex" ] || { ok=0; echo "  [$n] exit=$rc want=$ex"; }
  for p in "$@"; do
    if [ "${p:0:1}" = '!' ]; then grep -qE -- "${p:1}" <<<"$out" && { ok=0; echo "  [$n] unexpected: ${p:1}"; }
    else grep -qxE -- "$p" <<<"$out" || { ok=0; echo "  [$n] missing: $p"; }; fi
  done
  grep -qx STAGING_CLEANED=YES <<<"$out" || { ok=0; echo "  [$n] staging not cleaned"; }
  [ $ok = 1 ] && { echo "R43A_TEST $n=PASS"; pass=$((pass+1)); } || { echo "R43A_TEST $n=FAIL"; echo "$out" | sed 's/^/    | /'; fail=$((fail+1)); }
}
repo() { git init -q "$1" && git -C "$1" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init; }
GOOD='printf "%s\n" PREFLIGHT=PASS HOLD_COUNT=0 WRITES_PERFORMED=NO SECRET_PRINTED=NO; exit 0'
before=$(ls -d /tmp/nf-r43a-preflight.* 2>/dev/null | wc -l)

repo "$W/prod1"; mk valid_equal "$W/prod1" "$GOOD"
run valid_equal 0 CHECKOUT_INTEGRITY=PASS PROD_REPO_HEAD_UNCHANGED=YES EXIT_CODE=0 RECEIPT_GATE=PASS

mk head_absent "$W/does-not-exist" "$GOOD"
run head_absent 4 PROD_REPO_HEAD_UNCHANGED=UNVERIFIED RECEIPT_GATE=NO_GO '!RECEIPT_GATE=PASS'

mkdir "$W/notrepo"; mk head_not_repo "$W/notrepo" "$GOOD"
run head_not_repo 4 PROD_REPO_HEAD_UNCHANGED=UNVERIFIED RECEIPT_GATE=NO_GO

git init -q "$W/unborn"; mk head_unborn "$W/unborn" "$GOOD"
run head_unborn 4 PROD_REPO_HEAD_UNCHANGED=UNVERIFIED RECEIPT_GATE=NO_GO

repo "$W/prod2"; mk head_lost_after "$W/prod2" "rm -rf '$W/prod2/.git'; $GOOD"
run head_lost_after 4 PROD_REPO_HEAD_UNCHANGED=UNVERIFIED RECEIPT_GATE=NO_GO

repo "$W/prod3"; mk head_divergent "$W/prod3" "git -C '$W/prod3' -c user.email=t@t -c user.name=t commit -q --allow-empty -m drift; $GOOD"
run head_divergent 4 PROD_REPO_HEAD_UNCHANGED=NO RECEIPT_GATE=NO_GO

repo "$W/prod4"; mk hash_tampered "$W/prod4" "$GOOD" 's/^EXP_BASELINE=7e/EXP_BASELINE=00/'
run hash_tampered 93 CHECKOUT_INTEGRITY=FAIL PREFLIGHT=NOT_RUN RECEIPT_GATE=NO_GO '!CHECKOUT_INTEGRITY=PASS'

repo "$W/prod5"; mk preflight_hold "$W/prod5" 'printf "%s\n" PREFLIGHT=HOLD HOLD_COUNT=1 WRITES_PERFORMED=NO SECRET_PRINTED=NO; exit 3'
run preflight_hold 3 PROD_REPO_HEAD_UNCHANGED=YES EXIT_CODE=3 RECEIPT_GATE=NO_GO

repo "$W/prod6"; mk missing_field "$W/prod6" 'printf "%s\n" PREFLIGHT=PASS SECRET_PRINTED=NO; exit 0'
run missing_field 4 EXIT_CODE=0 RECEIPT_GATE=NO_GO

repo "$W/prod7"; mk sanitized "$W/prod7" "echo 'TOKEN=https://u:p@x.example/secret value'; echo 'raw line'; echo leak >&2; $GOOD"
run sanitized 0 PREFLIGHT_NONKV_STDOUT_LINES=2 PREFLIGHT_STDERR_LINES=1 RECEIPT_GATE=PASS '!x\.example' '!raw line' '!leak'

after=$(ls -d /tmp/nf-r43a-preflight.* 2>/dev/null | wc -l)
[ "$before" = "$after" ] && { echo "R43A_TEST no_staging_leftover=PASS"; pass=$((pass+1)); } || { echo "R43A_TEST no_staging_leftover=FAIL"; fail=$((fail+1)); }
rm -rf "$W"
echo "R43A_TESTS_PASSED=$pass R43A_TESTS_FAILED=$fail"; [ $fail = 0 ]
```

</details>
