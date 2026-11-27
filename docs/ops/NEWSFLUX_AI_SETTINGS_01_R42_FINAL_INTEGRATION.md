# NEWSFLUX-AI-SETTINGS-01 — R4.2 final integration and release readiness (addendum; R1–R4.1 kept as history)

**Date:** 2026-11-18, America/Bahia. **Nature:** validation and reconciliation; no new feature. **No merge, no
deploy, no Home Server access, no production change.** Evidence classes: `CONFIRMED` (own run or GitHub check
on the exact SHA) and `REPORTED` (another agent or the PM, not re-run here).

## 1. Selected HEADs (live readback before work; drift reconciled)

| PR                                                                        | HEAD                                                                                            | Notes                                                                        |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| main                                                                      | `d54eda2bdb8bc5c3d1bd58d40236f48da762e852`                                                      | unchanged                                                                    |
| [#267](https://github.com/jfsdias/NewsFlux/pull/267) P1 supervision tests | `e88849e6bb8fc2deaa1efd4207e77fa0aedd1078`                                                      | **selected** (PM R4.1); R4.2 added `e88849e` (see §3)                        |
| [#265](https://github.com/jfsdias/NewsFlux/pull/265) release governance   | `4c3e07529d706ffc37115aa8de808f36cccdc244`                                                      | unchanged                                                                    |
| [#262](https://github.com/jfsdias/NewsFlux/pull/262) backend              | `683d60cf791046060ce0b3405ef77fd0ef5b28f7`                                                      | unchanged                                                                    |
| [#263](https://github.com/jfsdias/NewsFlux/pull/263) UI (stacked on #262) | `8b7960d6e49b91d29f0666a0834b6c238a11d8ec`                                                      | unchanged                                                                    |
| [#264](https://github.com/jfsdias/NewsFlux/pull/264) Caddy route          | `2641010b78839150b4c227f9939d7e373462f971`                                                      | unchanged                                                                    |
| [#261](https://github.com/jfsdias/NewsFlux/pull/261) docs                 | `79ed82673981df794c02ce72eeb3e9130dac88e5` in the tree; this file follows as a docs-only commit | drift `cdb56e9`→`dbf6eca` (PM doc) reconciled; `79ed826` = Prettier-only fix |
| [#266](https://github.com/jfsdias/NewsFlux/pull/266)                      | `4143e3c…`                                                                                      | **SUPERSEDED_CANDIDATE, excluded, not closed**                               |
| [#260](https://github.com/jfsdias/NewsFlux/pull/260)                      | `c0818ff…`                                                                                      | **PRIVACY_HOLD, excluded, untouched**                                        |

## 2. Final integration tree (disposable, test-only branch `claude/intelligent-edison-5053ez`)

```ini
INTEGRATION_BASE_SHA=d54eda2bdb8bc5c3d1bd58d40236f48da762e852
INTEGRATION_HEAD_SHA=48d77c0ec32465660f1a4b438af83d40a41e9796
ORDER=#267 → #265 → #262 → #263 → #264 → #261   # each merged by exact SHA, all clean, no conflicts
```

**Scope proof (CONFIRMED):**

- **File set:** 53 files changed versus `main`, equal to the union of each PR's own diff (#263 measured against
  #262).
  - No extra files, no missing files, no file owned by two PRs.
  - Every integrated file is **byte-identical** to the PR that owns it.
- **Per PR:**
  - #267: 1 file (`services/article_intel_summary/tests/test_api_supervision.py`);
  - #265: 12 (`ops/deploy/release-governance/**`, its workflow line, `docs/ops/ARTICLE_INTELLIGENCE_PROMOTION.md`);
  - #262: 8 (`services/article_intel_summary/*` admin, store, catalog, operator scripts and tests);
  - #263: 22 (`src/**`, locales, harness, `ai-settings-tests.yaml`, `knip.json`);
  - #264: 3 (Caddyfile, route test, workflow);
  - #261: docs only.
- **#266 absent:** commit not an ancestor; its unique test name not present.
- **#260 absent:** commit not an ancestor. Of its 134 added code lines, the 15 found in the tree were already on
  `main` (generic lines).

## 3. Gate A — supervision (#267 selected)

- **Test-only (CONFIRMED):**
  - #267 changes only the test file;
  - `supervision.py`, `service.py`, `litellm_adapter.py` and `budget.py` are byte-identical to `main`;
  - test deadlines keep their values (0.05 / 0.03 / 1 s).
- **Covered behaviours:**
  - worker capacity is retained (429 while a timed-out worker still holds the slot);
  - a late inference is settled and never revalidated;
  - a deadline reached before dispatch never calls the gateway and keeps the reservation `uncertain`;
  - client cancellation does not release the worker.
- **New finding in R4.2 (CONFIRMED, fixed with TDD in #267 `e88849e`):**
  - On the previous #267 `f9926a2`, `test_timeout_keeps_capacity_until_worker_finishes` failed **1/1164** under
    8 CPU spinners on 4 cores plus a continuous `dd oflag=dsync` writer. The assertion was
    `started.is_set()` False.
  - Cause: `app.py` enforces the request deadline with its own real `time.monotonic` before the supervisor
    runs, and only `supervision.time` was controlled. The product behaviour is correct (fail-closed 504).
  - RED: a 100 ms event-loop stall before supervision reproduces it 3/3.
  - GREEN: the controlled clock also drives `app.time`, and a new regression test was added.
- **Stress after the fix (CONFIRMED, own run):** the whole supervision file (8 tests) ran **604 times, 0
  failures in 4,832 test executions** under that load. Isolated, 100/100 runs passed.
- **#266 (REPORTED by the R4.1 agent, partially re-verified here):** its version of the sibling capacity test is
  unchanged and failed 4/60 under the same load.

## 4. Gate C — CI and regression on the exact final tree

GitHub Actions on `48d77c0` (CONFIRMED; every run's head SHA = `48d77c0`, all SUCCESS):

| Workflow                            | Run                                                                         | Key results                                                                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary release isolated rehearsal  | [44374260248](https://github.com/jfsdias/NewsFlux/actions/runs/44374260248) | governance unit 107, Docker release tests 15, operator 21/21, preflight real-image gate 11/11 (incl. full preflight + code-root safety), R12F09 18/18, S5 key gate 17/17, **Stage 1 upgrade 44/44 with the real admin-route Caddyfile** (`KIND=b-changes-caddy`) |
| Article Intelligence pilot image    | [44374266347](https://github.com/jfsdias/NewsFlux/actions/runs/44374266347) | image, synthetic-reader, **exact-source Docker Compose pilot gate**                                                                                                                                                                                              |
| E2E                                 | [44374272051](https://github.com/jfsdias/NewsFlux/actions/runs/44374272051) | Playwright, Article Intelligence Reader Chromium, UX-REACH-01                                                                                                                                                                                                    |
| Article Intelligence fallback tests | [44374277154](https://github.com/jfsdias/NewsFlux/actions/runs/44374277154) | fallback, shared-volume-ownership                                                                                                                                                                                                                                |

- **Caddy and rollback gates (inside the rehearsal):**
  - `CADDY_PREFLIGHT_ACCEPTS_STAGE1`, `CADDY_PREFLIGHT_BLOCKS_DRIFT`;
  - the three fault-injection gates;
  - `CADDY_UPDATE_FROM_STAGE1`, `ADMIN_ROUTES_METHODS_AND_CATCHALL_403`;
  - `CADDY_ROLLBACK_TO_STAGE1`, `ROLLBACK_IDEMPOTENT`, `CADDY_DRIFT_DETECTED`;
  - `INFERENCE_FLAG_PRESERVED_AFTER_ROLLBACK`;
  - protected services: `MINIFLUX_NPM_LITELLM_FALLBACK_UNCHANGED` (Miniflux, miniflux-db, NPM, LiteLLM and
    PR188 content-fallback stand-ins) and `NO_WALLHOP_RESOURCES`.

  All PASS.

- **Quality:** the workflow has no manual trigger, so it was **not** run by GitHub on the integration tree.
  Instead:
  - **Local equivalent of every Quality command, run on `48d77c0` (CONFIRMED, Python 3.13 / Node 22):**
    - Python: auth 30, Summary 261, content-fallback 151, WallHop scripts 13, UX-REACH 4, release governance 107
      (16 Docker-only skipped);
    - Node: `lint` 0 errors, `format:check` clean, `test:src` 703, `test:scripts` 316, `build` OK, `knip:check`
      no new findings.
  - **GitHub Quality on the PR heads (CONFIRMED):**
    - #267 `e88849e` (main + #267): 16/16, including Python tests and Static checks;
    - #261 `79ed826`: 14/14;
    - #265 `4c3e075`: green (R4.1).
- **Fix made in R4.2:** #261 `dbf6eca` failed `Static checks (ESLint, Prettier)` on a PM-authored doc (missing
  blank line before a list). Fixed format-only in `79ed826`, content unchanged; #261 is green afterwards.

## 5. Gate D — OMV read-only preflight

`OMV_READONLY_PREFLIGHT=PENDING_ACCESS_OR_AUTHORIZATION`: no host access in this session and no explicit read
authorization; nothing was simulated.

The procedure was verified on #265 `4c3e075`:

- Docker access is limited to an enforced read-only allowlist (`ps`, `inspect`, `image inspect`, `network ls`,
  `exec stat|sha256sum|python -I`), and the release scripts contain no mutating Docker or shell call.
- Coverage: Summary/Reader, Caddyfile hash and readback, Compose layers, images, UID 10001, `/data`, AI flags
  against the canary contract and baseline, origins (host rules + backend validator), bootstrap key presence,
  protected containers, and the WallHop inventory digest.

Operator run (read-only, temporary checkout only):

```bash
D="$(mktemp -d /tmp/nf-r42-preflight.XXXXXX)"
git clone -q --no-checkout https://github.com/jfsdias/NewsFlux.git "$D/src"
git -C "$D/src" checkout -q --detach 4c3e07529d706ffc37115aa8de808f36cccdc244
sudo NEWSFLUX_PROTECTED_CONTAINERS="miniflux miniflux-db npm" bash "$D/src/ops/deploy/release-governance/ai-settings-readonly-preflight.sh"; echo "EXIT=$?"
rm -rf "$D"
```

Return only the `KEY=VALUE` lines and `EXIT=`. Keep `WALLHOP_INVENTORY_SHA256` for the post-promotion run. NPM
proxy hosts 37/111 are not read or changed by any release script. The preflight records only the NPM container's
identity; host-level NPM configuration remains out of scope.

## 6. Proposed merge order (none executed; only after Gate D and PM final verification)

`#267 → #265 → #262 → #263 → #264 → #261`

- After #262, retarget #263 to `main`, merge `main` into it and re-run its exact-source Compose gate.
- After #265, merge `main` into #264 and re-run `Summary release isolated rehearsal`.
- #266 is not merged.
- Then: the OMV read-only preflight with `PREFLIGHT=PASS`, a separate production GO, governed promotion
  (R4 §6), and the real-device gate.

## 7. Residual risks

- Live Home Server state unknown until the preflight runs.
- Real devices not tested.
- Quality on the integration tree is a local equivalent, not GitHub-run.
- Stress evidence lowers but cannot prove absence of rare races.
- `previous.json` keeps one prior key on `/data` (backups must be protected).
- PR #260 contract re-review is needed when it is merged.

## 8. Verdict

All code, CI and integration gates (A, B, C, E) are proven green on exact SHAs. Gate D (OMV read-only
preflight) is **not** proven, and the PM R4.1 decision lists it as a condition for clearing merges. Hence
`MERGE_READY_CHAIN=NO`; Gate D is the only blocker. Once the operator returns `PREFLIGHT=PASS` / `EXIT=0` for
§5, with no HEAD drift, the chain meets every gate in this campaign.

```ini
MERGE_READY_CHAIN=NO
BLOCKER=OMV_READONLY_PREFLIGHT_PENDING_ACCESS_OR_AUTHORIZATION
TECHNICAL_GATES_A_B_C_E=PASS
OMV_READONLY_PREFLIGHT=PENDING_ACCESS_OR_AUTHORIZATION
MERGE_EXECUTED=NO
DEPLOY_EXECUTED=NO
PRODUCTION_MUTATIONS=0
```
