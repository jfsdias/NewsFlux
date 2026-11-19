# NEWSFLUX-AI-SETTINGS-01 — R4.5 final integration and merge readiness

Date: 2026-11-19 · Merges: none · Deploy: none · Production mutations: 0

## Baseline and exact integration

- `main` = `abd67c136f185af52066df2772ad7e039ee062fb` (#268 squash-merged).
- Exact test-only integration on branch `claude/intelligent-edison-5053ez` @ `60afcd906083680818c128a96ad936b361455565`. Tree `1f63ce6b…` is identical to a fresh build of `main` + #267 → #265 → #262 → #263 → #264 → #261.
- Every merge is clean and done by exact SHA.
- Scope proof: 60 files, exactly the union of the six PR diffs, each byte-identical to its owning PR. #260 and #266 are excluded. `catalog.py` overlaps with #260 by path only; the tree holds #262's version.

## Per PR

| PR   | Merge base / current main | HEAD      | Files | Evidence                                                                             | Risk                                                                     | Recommendation                                     |
| ---- | ------------------------- | --------- | ----- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------- |
| #267 | `d54eda2` / `abd67c1`     | `e88849e` | 1     | Own CI green; Summary tests 261/261 in the tree                                      | Test-only (controlled clocks)                                            | MERGE first                                        |
| #265 | `d54eda2` / `abd67c1`     | `4c3e075` | 12    | Release rehearsal: Stage1 44/44, preflight image 11/11, R12F09 18/18, S5 17/17       | Governance tooling only; Caddy migration runs only in a governed release | MERGE second                                       |
| #262 | `d54eda2` / `abd67c1`     | `683d60c` | 8     | Summary 261/261, auth 30/30; admin routes fail closed (see below)                    | Admin API inert until allowlist and flags; writes OFF                    | MERGE third, **with a merge commit (no squash)**   |
| #263 | `d54eda2` / `abd67c1`     | `8b7960d` | 30    | Exact-source pilot gate PASS in the integration tree; Node 703/316, build, knip, E2E | Stacked on #262; standalone pilot gate fails only because base ≠ main    | Retarget to main after #262, re-run CI, then MERGE |
| #264 | `d54eda2` / `abd67c1`     | `2641010` | 3     | Release rehearsal `UPGRADE_PREFLIGHT_ON_STAGE1` passes with #265 (44/44)             | Standalone release rehearsal fails without #265 (expected)               | MERGE after #265                                   |
| #261 | `d54eda2` / `abd67c1`     | (docs)    | docs  | Docs-only; Prettier and Quality green                                                | None                                                                     | MERGE last                                         |

All PRs are 1 commit behind `main`: only #268, whose files are disjoint from theirs.

## CI and local evidence on the exact tree (`60afcd9`)

- **Dispatched workflows, all SUCCESS:**
  - Summary release isolated rehearsal: run 44536700630.
  - Article Intelligence pilot image, including the exact-source Docker Compose gate: run 44536705130.
  - Fallback unit tests: run 44536710732.
  - R4.4 allowlist procedure: run 44536717471 (#268 not regressed).
  - E2E with `source_sha=60afcd9`: run 44536722204.
- **Local Quality equivalent:** lint, Prettier, `test:src` 703/703, `test:scripts` 316/316, build and knip all pass. Python suites: auth 30/30, Summary 261/261, WallHop 13/13, UX-REACH 4/4.
- **Fallback:** the 151 tests passed under Python 3.13, and one test fails under the local Python 3.12.3. That failure is identical on plain `main`, which is untouched by the chain, so it is environmental. The CI fallback workflow is green.

## Fail-closed with an empty allowlist and flags OFF

- Ad-hoc probe on the tree: all 8 admin routes (`status`, `models`, `policy`, `test-key`, `save-key`, `save-policy`, `approve-model`, `remove-model`) return 403 for a caller Miniflux reports as admin when the allowlist is empty, even with config writes enabled. No settings directory is created and the key is never echoed.
- Existing tests cover the same: `test_nonadmin_forbidden_and_no_backend_write`, `test_disabled_changes_fail_closed`, and on main `test_admin_requires_verified_miniflux_admin_and_configured_allowlist`.
- The real OMV receipt (R4.3A) shows the four canary flags and local processing OFF, and `ADMIN_ALLOWLIST=EMPTY`.
- Merging deploys nothing. Production activation still needs the allowlist procedure GO and a separate governed release.

## #263 retarget (after #262 is merged)

1. Merge #262 with a merge commit, so #263 keeps #262's exact commits as ancestors (`683d60c` is an ancestor of `8b7960d`).
2. Change #263's base to `main`. Its diff then shows only its own 22 files on top of #262.
3. If #262 was squash-merged instead, merge `main` into #263's branch before retargeting. The content is identical, so this is conflict-free.
4. Re-run #263's CI. The exact-source pilot gate (base = main) already passes on this tree.

## OMV read-only (re-pinned to main)

No OMV access from this session. The command from #268 pinned `SRC=019a11e` on the merged PR branch, which can be deleted. The command below pins `main` (`abd67c1`); the procedure SHA-256 `797708f1…0f6e` is unchanged. It was tested end to end in `readonly` mode on the disposable topology (`READ_ONLY_PASS`). Run it with `MODE=readonly`. `apply` needs a specific GO.

```bash
# NEWSFLUX-AI-SETTINGS-01 R4.4 — single OMV procedure. Paste as the admin user with the owner at the terminal.
# MODE=readonly first (no change). MODE=apply only after the specific production GO, with ADMIN_ID from the
# read-only receipt. MODE=rollback with RELEASE_ID if recovery is ever needed. The owner types the key and any
# phrase at the hidden/terminal prompt; nothing secret is passed on the command line or printed.
MODE=readonly
ADMIN_ID=
RELEASE_ID=
sudo -v && MODE="$MODE" ADMIN_ID="$ADMIN_ID" RELEASE_ID="$RELEASE_ID" bash <<'NF_R44'
set -u
SRC=abd67c136f185af52066df2772ad7e039ee062fb
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
```
