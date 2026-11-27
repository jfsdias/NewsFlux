# NEWSFLUX-AI-SETTINGS-01 — R4.4 admin allowlist remediation

Date: 2026-11-18 · Status: **NO-GO, pending operator receipts (Gates A/B, then C on a specific GO, then D)** · Merges: none · Deploy: none · Production mutations so far: 0

> **Superseded by R4.4B — do not run any command in this document.** The PM red-team review (2026-11-18) found a P0 rollback gap after `os.replace`, a read-only command that could exit 0 after a failed identity check, raw paths in the output, an inventory that skipped uninspectable containers, and a key requested before the runtime was proven. The tool referenced below (`946b899`) was removed from this PR. The corrected tooling lives in its own operator PR, [jfsdias/NewsFlux#268](https://github.com/jfsdias/NewsFlux/pull/268), documented in `NEWSFLUX_AI_SETTINGS_01_R44B_REDTEAM_REMEDIATION.md`. This document is kept as history.

Single HOLD to resolve: `ADMIN_ALLOWLIST=EMPTY` (R4.3A real receipt). No change to #265, the application, the preflight or the security policy.

## What was established in code (deployed `main` = `d54eda2b`)

- Admin authorization requires both `is_admin=true` from Miniflux `GET /v1/me` and the ID in `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` (`MinifluxAuthService.authorize_admin`).
- On the deployed version **nothing calls `authorize_admin`** (only the auth module and tests). Setting the allowlist therefore has no behavioural effect on the running Summary until the AI settings PRs are merged and deployed. The audit re-checks this inside the running image (`DEPLOYED_ADMIN_ROUTE_CALLERS`).
- The Summary builds its auth service as `MinifluxAuthService(AuthSettings.from_env())`. The identity probe runs exactly that inside the running Summary container, so the Miniflux instance, TLS and DNS pinning are the ones the Summary really uses.

## Tooling (pinned)

`docs/ops/r44/r44_admin_allowlist.py` @ `946b8990bf1a6ca79019fa75ed8607573a5a4e01`, SHA-256 `320637bc924cb2e613be722a41d86eb4559706d0e7989e40e1a26477bf55afe5`.

| Mode       | Writes                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity` | none                        | Owner types their own Miniflux API key at a hidden terminal prompt (never echoed, stored, logged, or placed in argv/env; passed to the container on stdin). `GET /v1/me` → `id`, `is_admin`; if admin, `GET /v1/users` → only IDs and admin flags. No usernames, URLs or tokens are printed. If there is more than one admin: `OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `audit`    | none                        | Summary identity, image and revision, health, UID, ports, mounts; flag classes; Compose labels, config files and SHA-256; `docker compose config --hash` vs the running config-hash; rendered image ID and env vs running; dependents with `restart: true`; fixed IP; locates the env file that defines the key and proves it against the runtime; Reader Caddyfile SHA-256; protected service status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `apply`    | env file + Summary recreate | Re-runs the audit (any HOLD stops) and re-verifies the live identity with the owner's key (ID must equal the argument and be an admin). The owner types `APPLY-R44-ADMIN-<id>`. Then: private backup (`/root/newsflux-r44/r44-<UTC>/`, 0700/0600, SHA-256 verified), edit of **only** the key line (other lines byte-identical, mode/owner kept, atomic replace), and a rendered-config diff gate (only that key may change in the whole project). Then `docker compose … up -d --no-deps --no-build --pull never summary-api` with the labelled project files. Post-checks: same image ID, config-hash as rendered, env = old + key, same UID/mounts/networks, no ports, healthy, effective allowlist `configured` = {id}, authz probe, every other container on the host unchanged (ID and StartedAt), Caddyfile unchanged, five flags unchanged. Any failure → automatic rollback with verification. |
| `rollback` | env file + Summary recreate | Owner types `ROLLBACK-R44`. Verifies backup integrity, restores bytes/mode/owner, proves the source hash equals the pre-change hash, recreates only the Summary if needed, verifies config-hash, image, env digest (salted HMAC from the backup), health and that no other container changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Only Compose write: `up -d` restricted to the single named service with `--no-deps --no-build --pull never`. It runs only after the rendered project is proven to differ from the running one by that one key, with the image reference resolving to the running image ID. That is the minimum mechanism that keeps Compose as the source of truth; it is called out here for PM review.

Recreation risk: the Summary is briefly unavailable (until healthy). With AI flags OFF there is no inference traffic. The Reader `depends_on` the Summary (healthy) and is not restarted (`--no-deps`; the audit HOLDs if any dependent has `restart: true`). The audit HOLDs on a fixed IP, a build section, or rendered/running drift.

## Tests (disposable, never a real host)

Real Summary image built from `d54eda2b` with the project Dockerfile (test build adds only this session's proxy CA for pip). Fake Miniflux over HTTPS with a test CA; `miniflux`, `miniflux-db`, `npm` and Reader stand-ins; a two-file Compose project with an interpolated `env_file`. Harness: `docs/ops/r44/tests/`.

```ini
R44_TEST audit_clean=PASS                    R44_TEST apply_fault_rollback=PASS        # drift injected → ROLLBACK=PASS, env restored
R44_TEST identity_owner=PASS                 R44_TEST audit_after_rollback=PASS
R44_TEST identity_not_admin=PASS             R44_TEST apply_success=PASS               # 15 post-checks PASS, other containers unchanged
R44_TEST identity_bad_key=PASS               R44_TEST audit_after_apply=PASS           # CONFIGURED_COUNT_1, hash matches
R44_TEST identity_empty_key=PASS             R44_TEST apply_again_refused=PASS
R44_TEST identity_multi_admin=PASS           R44_TEST rollback_wrong_phrase=PASS
R44_TEST apply_wrong_phrase=PASS             R44_TEST rollback_manual=PASS
R44_TEST apply_id_mismatch=PASS              R44_TEST audit_after_manual_rollback=PASS
R44_TEST apply_non_admin_key=PASS            R44_TEST audit_source_drift=PASS          # edited source → HOLD
R44_TEST apply_bad_arg=PASS                  R44_TEST apply_refused_on_drift=PASS
R44_TEST apply_append_form=PASS              R44_TEST protected_restart_detected=PASS  # restart of a protected container → rollback, exit 6 (operator)
R44_TESTS_PASSED=22 R44_TESTS_FAILED=0       # Python 3.11 and 3.13; no key, Miniflux host or origin in any output
R44D_TESTS_PASSED=10 R44D_TESTS_FAILED=0     # Gate D wrapper
OPERATOR_COMMANDS_E2E=PASS                   # A/B, C and rollback commands, real clone + SHA-256 check, on the topology
```

## Gates A + B — read-only (run first; owner present at the terminal)

The command prompts once for the owner's Miniflux API key, at a hidden prompt.

```bash
sudo -v && bash <<'NF_R44AB'
set -u
SRC=946b8990bf1a6ca79019fa75ed8607573a5a4e01
EXP_TOOL=320637bc924cb2e613be722a41d86eb4559706d0e7989e40e1a26477bf55afe5
T=docs/ops/r44/r44_admin_allowlist.py
OK='^[A-Z][A-Z0-9_]*=[^[:cntrl:]]{0,300}$'
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
export GIT_TERMINAL_PROMPT=0
git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1 || { echo "TOOL_INTEGRITY=CLONE_FAILED"; exit 92; }
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SRC" >/dev/null 2>&1
if [ "$(git -C "$D/src" rev-parse HEAD 2>/dev/null)" != "$SRC" ] || [ "$(sha256sum "$D/src/$T" 2>/dev/null | cut -c1-64)" != "$EXP_TOOL" ]; then
  echo "TOOL_INTEGRITY=FAIL"; exit 93
fi
echo "TOOL_INTEGRITY=PASS"
cd "$D" || exit 94
run() { # mode [arg] — live, filtered to KEY=VALUE; key/phrase prompts go to the terminal only
  local m="$1"; shift
  sudo python3 -I "$D/src/$T" "$m" "$@" </dev/null 2>"$D/$m.err" | tee "$D/$m.out" | grep --line-buffered -E "$OK"
  local rc="${PIPESTATUS[0]}"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_NONKV_LINES=$(grep -cvE "$OK" "$D/$m.out")"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_STDERR_LINES=$(wc -l <"$D/$m.err" | tr -d ' ')"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_EXIT=$rc"
  return "$rc"
}
echo "R44AB_RUN=START_READ_ONLY"
run identity
run audit
exit 0
NF_R44AB
```

Decision after this receipt:

- `IDENTITY_GATE_FINAL=PASS` and `OWNER_SELECTION=SINGLE_ADMIN_IS_CALLER` → `ADMIN_ID_CANDIDATE` is the allowlist value (`CONFIGURED_COUNT_1`).
- `OWNER_DECISION_REQUIRED_MULTIPLE_ADMINS` → the owner decides; only the caller's own verified ID can be applied (`apply` enforces it).
- Any HOLD in either mode (identity or audit) → NO-GO, classified read-only; nothing is changed.

## Gate C — production configuration change (only after a specific GO for this procedure)

Merge authorization does not count as this GO. Fill `ADMIN_ID`; the tool asks again for the key and for the exact phrase.

```bash
# Fill ADMIN_ID with ADMIN_ID_CANDIDATE from the R4.4 A/B receipt, only after the owner selected it.
ADMIN_ID=
sudo -v && ADMIN_ID="$ADMIN_ID" bash <<'NF_R44C'
set -u
[[ "$ADMIN_ID" =~ ^[1-9][0-9]{0,18}$ ]] || { echo "ADMIN_ID_ARGUMENT=MISSING_OR_INVALID"; exit 2; }
echo "R44C_RUN=START_PRODUCTION_CHANGE_REQUIRES_OWNER_PHRASE"
SRC=946b8990bf1a6ca79019fa75ed8607573a5a4e01
EXP_TOOL=320637bc924cb2e613be722a41d86eb4559706d0e7989e40e1a26477bf55afe5
T=docs/ops/r44/r44_admin_allowlist.py
OK='^[A-Z][A-Z0-9_]*=[^[:cntrl:]]{0,300}$'
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
export GIT_TERMINAL_PROMPT=0
git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1 || { echo "TOOL_INTEGRITY=CLONE_FAILED"; exit 92; }
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SRC" >/dev/null 2>&1
if [ "$(git -C "$D/src" rev-parse HEAD 2>/dev/null)" != "$SRC" ] || [ "$(sha256sum "$D/src/$T" 2>/dev/null | cut -c1-64)" != "$EXP_TOOL" ]; then
  echo "TOOL_INTEGRITY=FAIL"; exit 93
fi
echo "TOOL_INTEGRITY=PASS"
cd "$D" || exit 94
run() { # mode [arg] — live, filtered to KEY=VALUE; key/phrase prompts go to the terminal only
  local m="$1"; shift
  sudo python3 -I "$D/src/$T" "$m" "$@" </dev/null 2>"$D/$m.err" | tee "$D/$m.out" | grep --line-buffered -E "$OK"
  local rc="${PIPESTATUS[0]}"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_NONKV_LINES=$(grep -cvE "$OK" "$D/$m.out")"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_STDERR_LINES=$(wc -l <"$D/$m.err" | tr -d ' ')"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_EXIT=$rc"
  return "$rc"
}
run apply "$ADMIN_ID"
NF_R44C
```

Exit `0` = applied and verified; `3` = refused, nothing changed; `5` = failed and rolled back (verified); `6` = rollback incomplete, operator required.

Manual rollback (only if decided later; restores the pre-R4.4 state):

```bash
# Only if a verified rollback is needed later: fill BACKUP_DIR with BACKUP_DIR from the apply receipt.
BACKUP_DIR=
sudo -v && BACKUP_DIR="$BACKUP_DIR" bash <<'NF_R44R'
set -u
[[ "$BACKUP_DIR" =~ ^/root/newsflux-r44/r44-[0-9]{8}T[0-9]{6}Z$ ]] || { echo "BACKUP_DIR_ARGUMENT=MISSING_OR_INVALID"; exit 2; }
echo "R44R_RUN=START_ROLLBACK_REQUIRES_OWNER_PHRASE"
SRC=946b8990bf1a6ca79019fa75ed8607573a5a4e01
EXP_TOOL=320637bc924cb2e613be722a41d86eb4559706d0e7989e40e1a26477bf55afe5
T=docs/ops/r44/r44_admin_allowlist.py
OK='^[A-Z][A-Z0-9_]*=[^[:cntrl:]]{0,300}$'
echo "OMV_HOST_IDENTITY=$( { hostname; cat /etc/machine-id 2>/dev/null; } | sha256sum | cut -c1-16)"
D="$(mktemp -d /tmp/nf-r44.XXXXXX)" || { echo "STAGING=MKTEMP_FAILED"; exit 90; }
trap 'rm -rf -- "$D"; echo "STAGING_CLEANED=YES"' EXIT
export GIT_TERMINAL_PROMPT=0
git -c credential.helper= clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src" >/dev/null 2>&1 || { echo "TOOL_INTEGRITY=CLONE_FAILED"; exit 92; }
git -C "$D/src" -c advice.detachedHead=false checkout -q --detach "$SRC" >/dev/null 2>&1
if [ "$(git -C "$D/src" rev-parse HEAD 2>/dev/null)" != "$SRC" ] || [ "$(sha256sum "$D/src/$T" 2>/dev/null | cut -c1-64)" != "$EXP_TOOL" ]; then
  echo "TOOL_INTEGRITY=FAIL"; exit 93
fi
echo "TOOL_INTEGRITY=PASS"
cd "$D" || exit 94
run() { # mode [arg] — live, filtered to KEY=VALUE; key/phrase prompts go to the terminal only
  local m="$1"; shift
  sudo python3 -I "$D/src/$T" "$m" "$@" </dev/null 2>"$D/$m.err" | tee "$D/$m.out" | grep --line-buffered -E "$OK"
  local rc="${PIPESTATUS[0]}"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_NONKV_LINES=$(grep -cvE "$OK" "$D/$m.out")"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_STDERR_LINES=$(wc -l <"$D/$m.err" | tr -d ' ')"
  echo "R44_$(printf %s "$m" | tr a-z A-Z)_EXIT=$rc"
  return "$rc"
}
run rollback "$BACKUP_DIR"
NF_R44R
```

## Gate D — real preflight again (same pinned preflight, same three SHA-256 pins)

Only the presentation changed: protected services are read from the real preflight lines and printed as `PROTECTED_<NAME>_STATUS`. The WallHop digest captured in R4.3A (`e3b0c442…b855`) is passed for comparison. `RECEIPT_GATE=PASS` requires `ADMIN_ALLOWLIST=CONFIGURED_COUNT_1`, `PREFLIGHT=PASS`, `HOLD_COUNT=0`, `EXIT_CODE=0`, `PROD_REPO_HEAD_UNCHANGED=YES`, `WRITES_PERFORMED=NO`, `SECRET_PRINTED=NO`, `WALLHOP_INTEGRITY=MATCHES_PRIOR_INVENTORY` and exactly three `PROTECTED_*_STATUS=RUNNING`. Wrapper file: `docs/ops/r44/r44d-preflight-receipt.sh` (SHA-256 `c1cd6eeb756a53085fe14cbbd6ae9e419434d54d4b34e6132bc9224792ef1fc8`).

```bash
sudo -v && bash <<'NF_R44D'
set -u
SHA=4c3e07529d706ffc37115aa8de808f36cccdc244
EXP_PREFLIGHT=86670b2c9810e851d4d976a38b5a91c6060d351d0cd355edf3e44f093391f196
EXP_BASELINE=7e7ff3a4399a96efdc67652f48d9f664e759b97e340eb59db564207916dc259d
EXP_CADDY=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
PROD=/dockerdata/compose/newsflux/repo
P=ops/deploy/release-governance
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
[ "$(h ops/deploy/article-intel-pilot/Caddyfile)" = "$EXP_CADDY" ] || ok=NO
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
```

## Decision

`MERGE_READY_CHAIN=NO` until the Gate D receipt shows `RECEIPT_GATE=PASS`. Then `YES_PENDING_PM_VERIFICATION`. No merge or deploy in this campaign.
