# NEWSFLUX-AI-SETTINGS-01 — R4.1 handoff (2026-11-18, America/Bahia)

Response to [PM/Red Team R4.1](https://github.com/jfsdias/NewsFlux/pull/265#issuecomment-6979871193) and the
[#261 Quality finding](https://github.com/jfsdias/NewsFlux/pull/261). R4 work was not repeated. Synthetic evidence only.
No merge, deploy, real inference, credential change, OMV/Home Server access or change. #260 untouched (HOLD).

## 1. Exact SHAs

| Item                                                                                                   | SHA                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `main` (unchanged)                                                                                     | `d54eda2bdb8bc5c3d1bd58d40236f48da762e852`                                                                  |
| #265 release governance HEAD                                                                           | `4c3e07529d706ffc37115aa8de808f36cccdc244`                                                                  |
| #266 (new, scoped P1 test fix) HEAD                                                                    | `4143e3c4cc276a40ebef96c034ddae9c73a99c98`                                                                  |
| #261 docs HEAD before this file                                                                        | `7dbd079d61c432b2129b489b45dd66430362ebec`                                                                  |
| #262 / #263 / #264 (unchanged)                                                                         | `683d60cf…` / `8b7960d6…` (stacked on #262) / `2641010b…`                                                   |
| #260 (HOLD, untouched)                                                                                 | `c0818ff52c63857062ccc55e444cbe7659e56412`                                                                  |
| Disposable integration tree (test-only branch `integration/newsflux-ai-settings-01-r41`, never merged) | `011c01cf8c8c84b07a0cda056539e062bc645670` = main + #263(⊃#262) + #264 + #265@4c3e075 + #266 + #261@7dbd079 |

## 2. P0 — #265 backend origin check under `python -I` (exact Summary image)

**Reproduced (CONFIRMED, exact image):** Summary built exactly like the pilot-image workflow
(`docker build -f services/article_intel_summary/Dockerfile --build-arg SOURCE_COMMIT=805e6d1… .`, user `10001:10001`,
WORKDIR `/app`). `docker exec <summary> python -I -c BACKEND_ORIGIN_CHECK` → `ModuleNotFoundError: No module named 'services'`;
under `-I`, `sys.path` = stdlib + site-packages only (no `/app`, no cwd). Without `-I` the same string prints `VALID`.
The real preflight therefore always printed `ALLOWED_ORIGINS_BACKEND=UNVERIFIED` → `PREFLIGHT=HOLD` on a correct host.
The R4 fake masked it (dropped `-I`, injected `PYTHONPATH`).

**Commits on #265 (two authors worked R4.1 concurrently; nothing was overwritten, no force push):**

- `f2a39f7` RED + `896d1dc` fix (concurrent agent): explicit `/app` root under `-I`, module-origin check, `IMPORT_FAILED → UNVERIFIED`, faithful fake keeps `-I`, real-image gate `test-preflight-backend-check-image.sh`.
- `51ca2e9` RED + `4c3e075` GREEN (this handoff): **code-root safety**. On `896d1dc` a group/other-writable, symlinked or
  non-root-owned `/app`, `/app/services`, transitively imported module (`article_intel_auth/__init__` imports
  `services.content_fallback`) or writable cached `.pyc` still gave `VALID`; with `/app/services` writable the check even wrote
  `__pycache__` into the container. Now: `/app` and the whole `/app/services` tree must be non-symlink, uid 0 (Dockerfile COPY),
  no group/other write, else `UNSAFE_IMPORT_PATH` (HOLD); every loaded `services.*` module must come from that tree;
  `sys.dont_write_bytecode=True`. `-I` is kept; no `PYTHONPATH` is honoured.

| Evidence                                                                                         | RED                                            | GREEN                                              |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------- |
| Fake suite `test_readonly_preflight.py` (faithful `-I`, image layout copy, root-owner emulation) | 21 fail on `896d1dc` (28 on `805e6d1`)         | 46/46                                              |
| Exact-image end-to-end `test_preflight_origin_image.py` (real preflight vs disposable Summary)   | 4 fail on `896d1dc`; `UNVERIFIED` on `805e6d1` | 3/3                                                |
| Real-image gate `test-preflight-backend-check-image.sh`                                          | `R4_CHECK_FAILS_UNDER_ISOLATED_MODE_RED=PASS`  | 11/11 (CI)                                         |
| Deployed Stage 1 image built from `57f1c6a` (local)                                              | —                                              | hardened check `VALID`, uid 10001, 0 `__pycache__` |

Invalid origins (`http://`, path, wildcard, mixed list) are `INVALID` (no crash). A Stage 1 Summary with an invalid origin list
refuses to start, so a running OMV container can only reach `INVALID` via drift between env and validator.
Note: the box token has no `workflow` scope, so the end-to-end test is invoked from the already-wired gate script, not a new workflow step.

**CI #265 `4c3e075` — all SUCCESS:** Summary release rehearsal [44350156006](https://github.com/jfsdias/NewsFlux/actions/runs/44350156006),
Quality [44350156064](https://github.com/jfsdias/NewsFlux/actions/runs/44350156064), pilot image [44350155988](https://github.com/jfsdias/NewsFlux/actions/runs/44350155988),
E2E [44350156502](https://github.com/jfsdias/NewsFlux/actions/runs/44350156502), Linter [44350156632](https://github.com/jfsdias/NewsFlux/actions/runs/44350156632).

## 3. P1 — #261 Quality RCA (`test_late_inference_is_settled_and_never_revalidated`)

**Cause: test contract, triggered by storage latency (environment). Not scheduling/CPU, not a product defect, not the docs diff.**
The test sets a 50 ms inference window; inside it, before the gateway call, the adapter does the durable SQLite budget
reservation and then a pre-send `deadline.remaining()`. Instrumented (Py 3.12.16): reservation ends 36–61 ms after
`begin_inference`; every failure had it end at 52–61 ms and `OperationDeadline` raised in the worker before `_post`
(gateway never called → `started` never set). That is correct product behaviour (no send after deadline, 504, no revalidation).

| Condition on `main` (unchanged test)              | N       | PASS    | FAIL   |
| ------------------------------------------------- | ------- | ------- | ------ |
| isolated, disk                                    | 100     | 82      | 18     |
| tmpfs control                                     | 100     | 93      | 7      |
| CPU load (8 spinners, pinned 1 CPU), disk / tmpfs | 50 / 50 | 50 / 50 | 0 / 0  |
| I/O load (fsync writer), disk / tmpfs             | 50 / 50 | 18 / 47 | 32 / 3 |

**Fix: separate scoped draft [#266](https://github.com/jfsdias/NewsFlux/pull/266)** (one test file; no product code, no timeout raised, no test disabled):
RED `de8b136` injects 60 ms pre-send latency → 10/10 exact CI failure. GREEN `4143e3c` drives `supervision.Deadline` with a
controlled clock so the window expires only after the gateway call started (60 ms injection kept); new negative test
`test_deadline_reached_before_gateway_call_never_sends` (504, no gateway request, no revalidation, reservation not left live).
GREEN: 100/100 isolated, 100/100 under I/O load, 50/50 CPU-load pinned. Sibling supervision tests (synthetic adapter): 40/40 under I/O load.
CI #266 `4143e3c` all SUCCESS: Quality [44351237672](https://github.com/jfsdias/NewsFlux/actions/runs/44351237672) (summary 213 tests),
E2E [44351238131](https://github.com/jfsdias/NewsFlux/actions/runs/44351238131), pilot [44351237767](https://github.com/jfsdias/NewsFlux/actions/runs/44351237767),
fallback [44351237804](https://github.com/jfsdias/NewsFlux/actions/runs/44351237804), Linter [44351237823](https://github.com/jfsdias/NewsFlux/actions/runs/44351237823).

**#261 Quality:** re-run of the failed job on the exact HEAD `7dbd079` ([44308842491 attempt 2](https://github.com/jfsdias/NewsFlux/actions/runs/44308842491)) = SUCCESS,
consistent with the RCA (latency flake, independent of the docs diff). **Structural dependency:** #261's merge ref contains
`main`'s test, so the flake can recur on #261 (and any PR) until #266 is on `main`. Merge #266 before #261.

## 4. Integrated gate (`011c01c`)

Workflow_dispatch on the test-only branch: pilot image [44351758184](https://github.com/jfsdias/NewsFlux/actions/runs/44351758184) SUCCESS,
E2E [44351877599](https://github.com/jfsdias/NewsFlux/actions/runs/44351877599) SUCCESS, fallback [44351773281](https://github.com/jfsdias/NewsFlux/actions/runs/44351773281) SUCCESS,
Summary release rehearsal [44351749588](https://github.com/jfsdias/NewsFlux/actions/runs/44351749588) SUCCESS (R4.1 gate 11/11, Stage 1 upgrade, R12F-09, S5, operator).
Quality has no dispatch trigger; run locally on `011c01c`: Python auth 30, summary 258, content_fallback 151, wallhop 13, ux-reach 4,
release-governance 107 (16 Docker-only skipped) — all OK; Node `lint`, `format:check`, `test:src`, `test:scripts`, `build`, `knip:check` — all OK.
Isolation: #265 R4.1 delta touches only `ops/deploy/release-governance/**` (+ inherited workflow line from `896d1dc`); #266 touches only
`services/article_intel_summary/tests/test_api_supervision.py`; #261 docs only; no file overlap #265/#266; #260 excluded.

## 5. OMV read-only preflight (prepared, NOT executed; owner-run, writes only a temp dir)

```bash
D="$(mktemp -d /tmp/nf-r41-preflight.XXXXXX)"
git clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src"
git -C "$D/src" checkout -q --detach 4c3e07529d706ffc37115aa8de808f36cccdc244
test "$(git -C "$D/src" rev-parse HEAD)" = 4c3e07529d706ffc37115aa8de808f36cccdc244 && echo SHA_PIN=PASS
sudo bash "$D/src/ops/deploy/release-governance/ai-settings-readonly-preflight.sh"; echo "EXIT=$?"
```

Return only the `KEY=VALUE` lines (they are sanitized by design) and `EXIT=`. Expected on a healthy Stage 1 host:
`ALLOWED_ORIGINS_BACKEND=VALID`, `CADDY_STATE=STAGE1_ACCEPTED_PRIOR`, canary flags `OFF`, `PREFLIGHT=PASS`, `EXIT=0`; keep
`WALLHOP_INVENTORY_SHA256` for the post-promotion no-touch run. Any HOLD (`EXIT=3`) stops the release. Docker use is read-only
(`ps`, `inspect`, `image inspect`, `network ls`, `exec stat/sha256sum/python -I`); no promotion. Remove `$D` afterwards.

## 6. Residual risks

- OMV live state unverified (Caddy hash, flags, `/data`, deployed image layout) until the preflight above runs.
- `UNSAFE_IMPORT_PATH` relies on the deployed image being built by the repository Dockerfile (root-owned, `go-w`); a hand-built image would HOLD (fail-closed).
- The latency flake stays on `main` until #266 merges; any PR's Quality can be red for that reason.
- Two agents worked R4.1 on #265 concurrently; both commit pairs are kept and reviewed together above.
- No independent reviewer; author cannot self-certify.

## 7. Recommendation to PM

```ini
R41=ELIGIBLE_FOR_PM_REVIEW
P0_EXACT_IMAGE_IMPORT=FIXED_RED_GREEN_CI_PASS_4c3e075
P0_CODE_ROOT_SAFETY=HARDENED_RED_GREEN
P1_QUALITY_RCA=TEST_CONTRACT_STORAGE_LATENCY
P1_FIX=PR266_DRAFT_CI_PASS_4143e3c
PR261_QUALITY=PASS_RERUN_EXACT_HEAD_DEPENDS_ON_PR266_FOR_STABILITY
INTEGRATED_TREE=011c01c
OMV_READONLY_PREFLIGHT=PREPARED_NOT_EXECUTED
PR260=HOLD_UNTOUCHED
MERGE_EXECUTED=NO
DEPLOY_EXECUTED=NO
PRODUCTION_ACCESS=0
PRODUCTION_MUTATIONS=0
```

Suggested order if the owner authorizes: #266 → #265 → #262 → #263 (retarget) → #264 → #261, each with a post-merge CI re-run; the
OMV read-only preflight (section 5) can run before merge authorization to surface live drift.
