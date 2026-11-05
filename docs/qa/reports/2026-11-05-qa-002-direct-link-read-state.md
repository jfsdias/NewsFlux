# QA report: QA-002 direct-link read-state consistency

Follows [`QA_CHARTER.md`](../QA_CHARTER.md). This report records the implementation and independent review of the product-owner-approved QA-002 requirement.

## Scope

- Change and commit range: `f2ba63108e60df7bc38abe7bfa3f895d8b69180f..d56765dfac3ef6a1b0761ff45308369a803ea478` (implementation and tests; this report is a documentation-only follow-up commit).
- Risk level: **R3** — automatic read-state mutation and count synchronization.
- Requirement and source: Product-owner approval in the QA-002 implementation authorization. When `markReadBy=view`, a valid direct-linked article is marked read after it is rendered and while its route and data session are current. Explicit unread is not automatically undone during the same Reader presentation.
- Pending requirements: QA-003 (`F12-10b`) and QA-004 (`F15-4`) remain `REQUIREMENT_PENDING`. No classifications or feature flags outside QA-002 changed.

## Environment

| Item                     | Value                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Commit under test        | `d56765dfac3ef6a1b0761ff45308369a803ea478`                                                                        |
| Node versions            | 22.23.4 and 24.22.2                                                                                               |
| Browser                  | Playwright 1.63.0; Chromium 153.0.8010.12                                                                         |
| Viewport / DPR / pointer | F06 Reader context 884×1104 CSS px, DPR 2; complete suite also exercises its mouse/touch and responsive scenarios |
| Backend                  | Synthetic Miniflux; no real Miniflux writes                                                                       |
| Evidence types           | Emulated, Synthetic, Static                                                                                       |

## Results

| ID            | Scenario                                                                   | Requirement                                                                     | Type               | Result state           | Evidence (path, SHA-256)                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F06-1         | Open by list click; mark read and revert to unread                         | Existing behavior preserved                                                     | E2E                | `TEST_PASSED`          | Three-run inventory paths below                                                                                                                                              |
| F06-2         | Two quick status toggles match provider state                              | Existing behavior preserved                                                     | E2E                | `TEST_PASSED`          | Three-run inventory paths below                                                                                                                                              |
| F06-3         | Direct Reader route marks displayed entry read once                        | Approved QA-002 behavior                                                        | E2E                | `REQUIREMENT_VERIFIED` | Three-run inventories and independent base/candidate inventories below                                                                                                       |
| Stability     | Three independent runs of the frozen 46-scenario contract                  | 44 `PASSED`, 0 `KNOWN_DEFECT`, 2 `REQUIREMENT_PENDING`, 0 `FAILED`, 0 `SKIPPED` | E2E                | `TEST_PASSED`          | `test-results/stability/summary.json`, SHA-256 `3f207044bbbaebcff36c357249bcfbcbc301e754bb1ea40c1fc99dccf3e7158d`                                                            |
| Node 22       | Source + script suites                                                     | 594 source + 198 script tests pass                                              | Unit / integration | `TEST_PASSED`          | `/private/tmp/qa002-final-node22-test.log`                                                                                                                                   |
| Node 24       | Source + script suites                                                     | 594 source + 198 script tests pass                                              | Unit / integration | `TEST_PASSED`          | `/private/tmp/qa002-final-node24-test.log`                                                                                                                                   |
| General gates | ESLint, Prettier, Knip, production build on Node 22/24, `git diff --check` | No new lint errors or Knip findings                                             | Static / build     | `TEST_PASSED`          | `/private/tmp/qa002-final-lint.log`; `/private/tmp/qa002-final-format.log`; `/private/tmp/qa002-final-knip.log`; build logs under `/private/tmp/qa002-final-node*-build.log` |

### Three-run stability receipts

All runs used Chromium and the synthetic Miniflux. Each produced a unique ID and fresh, complete 46-entry inventory; all exited 0 and the stability checker returned `stable=true`.

| Run ID                                 | Inventory                                             | SHA-256                                                            |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `06aea7cc-9e42-4bb2-b65b-9cd0ae7dbfbd` | `test-results/verified-e2e/run-u4kIbx/inventory.json` | `60f8d4b6d7b9017f93bf09582a20aee3244525d942d4b0880bc6979926781ca8` |
| `ed37fa5a-d1bd-48ac-b359-e6501552ff80` | `test-results/verified-e2e/run-pfqvk1/inventory.json` | `5360580903b5782f02c417d800b2fba4955bd585c348ab64ba5241db9be93367` |
| `02ef351d-74d2-44e5-ba1f-180ec61f0d31` | `test-results/verified-e2e/run-3O6tc8/inventory.json` | `d0c9fcd3374e6c21addf75668fc4b1a38fcca5362efb9a29e07dd89e3e351c39` |

### Red then green evidence

- **RED at the approved base:** `F06-3` displayed `Notícia 14` through `/all/entry/14`, but entry 14 did not appear in the synthetic provider's read IDs. The expected direct-display read assertion failed. The captured focused inventory is `/private/tmp/qa002-red-inventory.json`, SHA-256 `230a7369d2282b52a5c2305f28f0449fdafed0aad23780dd02f121627d6f7ace`.
- **Independent base replay:** on `f2ba63108e60df7bc38abe7bfa3f895d8b69180f`, the reviewer ran the full E2E suite: 46 executed; 43 `PASSED`, 3 `REQUIREMENT_PENDING`; F06-3 reproduced the missing direct-link read behavior. Inventory: `/private/tmp/newsflux-qa002-review-evidence/base-elevated/run-oOUGU7/inventory.json`, SHA-256 `98f169858ff1c00f6e9303880c6add9a65a08fafe7295e14617607e49800149e`.
- **GREEN on the candidate:** independent full-suite replay on `d56765dfac3ef6a1b0761ff45308369a803ea478`: 46 executed; 44 `PASSED`, 2 remaining requirements pending; F06-1, F06-2 and F06-3 passed. Inventory: `/private/tmp/qa002-review-evidence/candidate/run-nvYOSw/inventory.json`, SHA-256 `337f8553087d24fb783f246ea4e1ba4216767ebec310cc479ad9f81e90758425`.

### Negative cases and mutation ledger

F06-3's exact final synthetic status-mutation ledger was:

1. entry 14 → `read` (`applied`) on direct display;
2. entry 14 → `unread` (`applied`) after explicit user action;
3. entry 14 → `read` (`applied`) on a new Reader presentation after reopen;
4. entry 148 → `read` (`applied`) after a current route transition;
5. entry 21 → `read` (`rejected`) when the provider returned HTTP 500.

No other status mutations occurred. Reloading the already-read article did not add a mutation. The following cases produced no automatic status write: `markReadBy=manually`, missing entry / 404, HTTP 500 load, malformed successful payload, obsolete route response for entry 149, and session change / 401 while entry 147 was loading. The explicit unread state was not re-marked during re-render in that same presentation. Rejected PUT left the entry unread and restored its “Mark as read” control.

### Regressions searched

- F06-1 and F06-2 remain unchanged and pass.
- The existing optimistic entry-mutation coordinator remains the only mutation path used; it continues to own counts, notification and rollback.
- No `handleEntryClick` call is used to trigger the direct-route mutation.
- No real provider write, persistent-state change, dependency change, HOLD activation, or unrelated QA-003/QA-004 implementation occurred.

## Findings

| ID  | Severity | Classification          | Steps | Expected                                                  | Observed                                                 | Regression test |
| --- | -------- | ----------------------- | ----- | --------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| —   | —        | No new blocking finding | —     | Approved direct-link behavior with correct negative cases | Candidate and independent review matched the requirement | `F06-3`         |

## Independent review

- Reviewer: `/root/qa002_independent_review` (fresh context; not the implementation author).
- What the reviewer tried to falsify: full E2E on exact base and candidate SHAs; F06-1/2/3; direct display mutation; explicit unread; already-read reload; manual mode; 404/500/malformed loads; stale route and changed-session races; rejected PUT rollback; exact mutation ledger; clean diff.
- Result: **`QA_PASSED_WITH_LIMITATIONS`** for the emulated/synthetic-browser gate. No blocker was found. The reviewer did not rerun the full Node 22/24 suites; those remain supported by the implementation-run logs above.
- Independent evidence summaries: base `/private/tmp/qa002-review-evidence/base-elevated/run-oOUGU7/summary.json`, SHA-256 `570144625f2c00c4c8fe881a0943ce7059ccde9a4e2587eaf2021d6ec811c167`; candidate `/private/tmp/qa002-review-evidence/candidate/run-nvYOSw/summary.json`, SHA-256 `1540b5ae9b48a1f50bc9ea921ce94e2f70e889ba01d9b3d287aaa9bd1dd5e911`.

## Known limitations

- Browser evidence is Chromium emulation against synthetic Miniflux. It does not establish behavior on a physical device, installed PWA, Safari/WebKit, or real Miniflux.
- QA-003 and QA-004 remain requirement-pending and were not changed.
- The local ESLint run reported three existing warnings and zero errors.

## QA state

`QA_PASSED_WITH_LIMITATIONS` for QA-002 implementation at `d56765dfac3ef6a1b0761ff45308369a803ea478`. The final PR head adds this report only; it does not change the tested product, E2E or QA contract code. This QA state does not authorize merge or deployment.
