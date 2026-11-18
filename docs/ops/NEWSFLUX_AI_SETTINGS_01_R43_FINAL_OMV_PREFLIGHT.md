# NEWSFLUX-AI-SETTINGS-01 — R4.3 final OMV preflight & merge release gate

Date: 2026-11-18 · Status: **NO-GO (pending operator receipt)** · Merges: none · Deploy: none · Production mutations: 0

## Gate A — pinned operator command

- Source pinned to `4c3e07529d706ffc37115aa8de808f36cccdc244` (#265 HEAD).
- `jfsdias/NewsFlux` is **public**: the OMV clones anonymously (`credential.helper=` empty, `GIT_TERMINAL_PROMPT=0`). No token, key or credential is read, requested or printed.
- Staging is a fresh `mktemp -d /tmp/nf-r43-preflight.XXXXXX`, refused if it resolves inside `/dockerdata/compose/newsflux/repo`, and removed by `trap` on every exit path. The production repo is only read (`rev-parse HEAD` before/after → `PROD_REPO_HEAD_UNCHANGED`).
- Integrity pins, computed from the commit object:

| File @ 4c3e075                                                | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `deploy/release-governance/ai-settings-readonly-preflight.sh` | `86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196` |
| `deploy/release-governance/ai-settings-flag-baseline.json`    | `7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d` |
| `deploy/article-intel-pilot/Caddyfile`                        | `56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6` |

- Any mismatch, dirty tree or clone failure → `CHECKOUT_INTEGRITY=FAIL|CLONE_FAILED`, `PREFLIGHT=NOT_RUN`, exit 92/93; the preflight never runs on an unverified checkout.
- Output: only `KEY=VALUE` lines matching `^[A-Z][A-Z0-9_]*=[A-Za-z0-9_.:,+-]{0,128}$`; anything else is counted (`PREFLIGHT_NONKV_STDOUT_LINES`, `PREFLIGHT_STDERR_LINES`), never printed. Exit captured with `rc=$?` (0 = PASS, 3 = HOLD, other = crash → treated as HOLD).
- Self-test in the cloud session (staging/integrity path only, stopped before the preflight): clean pin → `CHECKOUT_INTEGRITY=PASS`, staging cleaned; tampered baseline pin → `CHECKOUT_INTEGRITY=FAIL`, `PREFLIGHT=NOT_RUN`, exit 93. The preflight itself was **not** run or simulated outside the OMV.

Paste on the OMV as the admin user (sudo is used only for read-only docker/git reads inside the preflight and the HEAD witness):

```bash
sudo -v && bash <<'NF_R43'
set -u
SHA=4c3e07529d706ffc37115aa8de808f36cccdc244
EXP_PREFLIGHT=86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196
EXP_BASELINE=7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d
EXP_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
PROD=/dockerdata/compose/newsflux/repo
P=deploy/release-governance
echo "R43_PREFLIGHT_RUN=START"
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r43-preflight.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
case "$(readlink -f "$D")/" in "$(readlink -f "$PROD" 2>/dev/null || echo /nonexistent)"/*) echo "STAGING=INSIDE_PRODUCTION_REPO"; exit 91;; esac
prod_head() { sudo git -c safe.directory="$PROD" -C "$PROD" rev-parse HEAD 2>/dev/null || echo ABSENT; }
PROD_BEFORE="$(prod_head)"
export GIT_TERMINAL_PROMPT=0
if ! git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1; then
  echo "CHECKOUT_INTEGRITY=CLONE_FAILED"; echo "PREFLIGHT=NOT_RUN"; exit 92
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
if [ "$ok" != YES ]; then echo "CHECKOUT_INTEGRITY=FAIL"; echo "PREFLIGHT=NOT_RUN"; exit 93; fi
echo "CHECKOUT_INTEGRITY=PASS"
cd "$D" || exit 94
sudo env NEWSFLUX_PROTECTED_CONTAINERS="miniflux miniflux-db npm" \
  bash "$D/src/$P/ai-settings-readonly-preflight.sh" >"$D/out" 2>"$D/err"
rc=$?
grep -E '^[A-Z][A-Z0-9_]*=[A-Za-z0-9_.:,+-]{0,128}$' "$D/out"
echo "PREFLIGHT_NONKV_STDOUT_LINES=$(grep -cvE '^[A-Z][A-Z0-9_]*=[A-Za-z0-9_.:,+-]{0,128}$' "$D/out")"
echo "PREFLIGHT_STDERR_LINES=$(wc -l <"$D/err" | tr -d ' ')"
PROD_AFTER="$(prod_head)"
[ "$PROD_BEFORE" = "$PROD_AFTER" ] && echo "PROD_REPO_HEAD_UNCHANGED=YES" || echo "PROD_REPO_HEAD_UNCHANGED=NO"
echo "EXIT_CODE=$rc"
exit "$rc"
NF_R43
echo "WRAPPER_EXIT=$?"
```

Return the full printed block (all lines are sanitized classifications, digests and counts).

## Gate B — execution status

`OMV_READONLY_PREFLIGHT=PENDING_OPERATOR_RECEIPT`. The cloud session has no attached OMV folder/host (only non-OMV workstation folders, all `not_available`), so it cannot execute on the OMV and does not simulate it.

## Gate C — HOLD classification (applies when the receipt arrives)

Each HOLD is classified by the predicate key that raised it, read-only, without editing the preflight, baseline or production to obtain PASS. A HOLD on `WALLHOP_*` records inventory only; it does not prove historical integrity.

## Gate D — PR HEAD revalidation (2026-11-18)

| PR   | HEAD                                       | vs R4.2 tree 48d77c0                   | Checks                                                                    |
| ---- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| #267 | `e88849e6bb8fc2deaa1efd4207e77fa0aedd1078` | identical                              | 16 success / 3 skipped                                                    |
| #265 | `4c3e07529d706ffc37115aa8de808f36cccdc244` | identical                              | 15 success / 3 skipped                                                    |
| #262 | `683d60cf791046060ce0b3405ef77fd0ef5b28f7` | identical                              | 16 success / 3 skipped                                                    |
| #263 | `8b7960d6e49b91d29f0666a0834b6c238a11d8ec` | identical                              | 1 known structural failure: exact-source pilot gate (stacked base ≠ main) |
| #264 | `2641010b78839150b4c227f9939d7e373462f971` | identical                              | 1 known structural failure: `UPGRADE_PREFLIGHT_ON_STAGE1` (fixed by #265) |
| #261 | `978433044ffd7fc25d752fb6845009d2baad7ff4` | 79ed826 + R4.2 doc only (1 file, docs) | 14 success / 3 skipped                                                    |

`main` = `d54eda2b` is an ancestor of 48d77c0 → the integration tree remains representative. #266 (forbidden) and #260 (privacy HOLD) stay excluded. Both standalone failures pass in the integration tree (release run 44374260248, pilot 44374266347).

## Gate E — ledger

Source: this file on #261. Central: `jfsdias/homeserver` branch `claude/intelligent-edison-5053ez` (not on main). `DUAL_SYNC=PENDING`, `REASON=CENTRAL_LEDGER_MERGE_NOT_AUTHORIZED`.

## Decision

`MERGE_READY_CHAIN=NO`. Next gate: operator receipt with `CHECKOUT_INTEGRITY=PASS`, `PREFLIGHT=PASS`, `EXIT_CODE=0`, `PROD_REPO_HEAD_UNCHANGED=YES`, `WRITES_PERFORMED=NO`, `SECRET_PRINTED=NO` → then `MERGE_READY_CHAIN=YES_PENDING_PM_VERIFICATION`. No merge without the user's explicit authorization.
