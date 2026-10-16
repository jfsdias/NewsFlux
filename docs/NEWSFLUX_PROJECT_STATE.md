# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-15.
- **Documented product baseline:** `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`.

## Current state

`CURRENT_MAIN` is intentionally **not** stored as a self-updating commit SHA. A documentation-only merge would change `main` immediately and make the document stale. Live GitHub state must therefore be re-read before every action. The stable values recorded here are the last reconciled **product/runtime baseline** and production SHA.

```text
CURRENT_MAIN=RESOLVE_LIVE_GITHUB
DOCUMENTED_MAIN_BASE_SHA=7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0
PRODUCT_BASELINE_SHA=7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0
PRODUCTION_SHA=7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0
RUNTIME_PRODUCT_BASELINE_EQUALS_PRODUCTION=YES

CURRENT_PHASE=POST_A11Y_01_STABLE_BASELINE
CURRENT_PRODUCT_PR=NONE

LAST_COMPLETED=A11Y-01 / PR #34
UPSTREAM_INTEGRATED_THROUGH=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d

NEXT_RECOMMENDED_ACTION=READER-VISUAL-02A1
NEXT_FUNCTIONAL_PRODUCT_UNIT=READER-VISUAL-02A1
NEXT_AUTHORIZED_ACTION=READER-VISUAL-02A1

PRODUCTION_IMAGE=newsflux-local:7b0a7e04d1e1
PRODUCTION_IMAGE_ID=sha256:c5d64a7a9686aec005490882e24cabb03c664afd60cc5ea82e51e6bb730be5c4
ROLLBACK_BASELINE=newsflux-local:099bdcb0483e
ROLLBACK_IMAGE_ID=sha256:51e36a5fcb84429c45868dcdd066ec5d8cd51d8b3150405c8f13caa64a1cd846
PRESERVED_OLDER_ROLLBACKS=newsflux-local:b94c10926ae7,newsflux-local:fa98531fe153

DOCUMENT_LAST_RECONCILED_AT=2026-10-15
DOCUMENT_PRODUCT_BASELINE_SHA=7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0
A11Y_01_STATUS=COMPLETED
A11Y_01_PR=34
A11Y_01_APPROVED_HEAD=c62ce9160c928eedcdb09d25a1271253c8baf91c
A11Y_01_MERGE_SHA=7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0
A11Y_01_TREE_PARITY=PASS
A11Y_01_EXACT_MERGE_SHA_DEPLOY=PASS
A11Y_01_POST_MERGE_BROWSER_SMOKE=PASS
A11Y_01_STRUCTURAL_NORMALIZATION=PASS
A11Y_01_LIVE_SOURCE_H1_FIXTURE=NOT_EXERCISED
A11Y_01_FOCUSED_TESTS=9/9
A11Y_01_AGGREGATE_NODE_TESTS=29/29
A11Y_01_LINT=PASS_3_PREEXISTING_WARNINGS
A11Y_01_FORMAT=PASS
A11Y_01_BUILD=PASS
A11Y_01_DIFF_CHECK=PASS
A11Y_01_BROWSER_MATRIX=PASS
A11Y_01_REAL_DEVICE_GATE=NOT_REQUIRED
A11Y_01_RESOURCE_404=NON_BLOCKING_UNATTRIBUTED
A11Y_01_TODAY_COUNT_DELTA=UNATTRIBUTED
ID_RUNTIME_01_STATUS=COMPLETED
ID_RUNTIME_01_PR=32
ID_RUNTIME_01_APPROVED_HEAD=1237f77ff2566015ef50939e268c4ec19f66fe88
ID_RUNTIME_01_MERGE_SHA=099bdcb0483ef516f6c325e67eefb41b618a4713
POST_MERGE_BROWSER_SMOKE=PASS
EXACT_MERGE_SHA_DEPLOY=PASS
```

If a docs-only commit lands after this baseline, `main` may be ahead of production **without any runtime/product delta**. Do not interpret that as deployment drift until the diff is classified. Product/runtime changes still require exact-SHA deployment and explicit reconciliation.

## Recently completed

- **PR #20 / BULK-01:** Footer Mark All Read Undo with acknowledged-ID batching, one-shot memory-only Undo and generation-scoped notification IDs.
- **PR #21 / ID-01R:** repository/document provenance reconciliation.
- **PR #22:** canonical roadmap red-team R2 reconciliation.
- **PR #23 / A11Y-RT-01:** reduced-transparency dark/OLED specificity fix.
- **PR #24 / LIST-VISUAL-01 monogram subset:** deterministic fallback monograms for missing favicons.
- **PR #25 / CHROME-01A DatePicker subset:** NewsFlux token styling for DatePicker.
- **PR #26 / upstream sync:** adapted upstream article code-block experience; integrated upstream baseline through `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`.
- **PR #27 / BULK-01F:** deterministic footer Mark All Read focus restoration.
- **PR #28 / LIST-VISUAL-01A:** read-state and metadata/source hierarchy cohesion across Column/Card/List.
- **PR #29 / documentation:** roadmap and project-state reconciliation after LIST-VISUAL-01A production promotion.
- **PR #30 / BULK-01B:** Sidebar Feed/Category Mark All confirmation + safe shared Undo, including one shared Mark-All/Undo operation coordinator and source-scoped reconciliation. Merged as `b94c10926ae787382da4918e394c0821785f9c10` and deployed exactly as `newsflux-local:b94c10926ae7` with internal HTTP `200`. This was the previous production baseline before PR #32.
- **PR #32 / ID-RUNTIME-01:** runtime identity and NewsFlux-safe update/About/issues links; approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`, merged and deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`. Post-merge browser smoke and exact merge-SHA deployment passed. The initial candidate readiness attempt was `DEPLOY_HARNESS_STARTUP_RACE_CONFIRMED`; bounded retry passed, with no product regression.
- **PR #34 / A11Y-01:** main landmark, heading hierarchy, named navigation and skip navigation; approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`, merged as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`, tree parity PASS, exact merge-SHA production promotion PASS and authenticated post-merge browser smoke PASS.

## A11Y-01 closure

Status: **COMPLETED** in PR #34.

- Candidate and merge trees matched at `124a4e5c62649a3ffd9229ec03c490e94f6874c5`.
- Exact merge-SHA image `newsflux-local:7b0a7e04d1e1` was built and promoted; image ID: `sha256:c5d64a7a9686aec005490882e24cabb03c664afd60cc5ea82e51e6bb730be5c4`.
- Compose image identity, running-container identity, internal HTTP, served NewsFlux identity, runtime provenance and post-deploy stability gates passed. The container remained running with restart count `0`.
- PR gates passed: focused tests `9/9`, aggregate Node tests `29/29`, ESLint (three pre-existing warnings in unchanged files), Prettier, build and diff check. The browser matrix passed at `390`, `884×1104` and `1280` in light/dark themes, plus forced-colors Chromium emulation and Reader/Sidebar layout regression. A physical-device gate was not required.
- Authenticated post-merge browser smoke passed at Home and an already-read article. At `884×1104`, the page had one main landmark and one h1; the skip link received keyboard focus and activated the main landmark. At `1280×800`, the named desktop navigation was present. No horizontal overflow or candidate-specific console errors were found. No unread item was opened or mutated.
- Source-heading normalization passed structurally, but a live feed with a dedicated source-heading fixture was not exercised. This remains a validation limitation, not a confirmed defect.
- The PR browser matrix observed one unattributed HTTP 404 Image response among 82 responses, with zero failed image loads or visibly broken images; it was non-blocking. Three pre-existing React hydration warnings were not attributed to candidate behavior. A Today count changed by one during the browser session without an explicit read action; it was not attributed to this PR.
- An initial production-promotion attempt stopped before service replacement because its wrapper treated an expected diff result as a failed assertion; the candidate runtime was restored and rechecked, then exact merge-SHA promotion passed. No production swap occurred during the aborted attempt.

## BULK-01B closure

Status: **COMPLETED**.

Delivered:

- Sidebar Feed and Category Mark All now use the existing confirmation preference contract;
- source scope remains Feed-wide or Category-wide and does not inherit list search/date/status filters;
- hidden-feed category visibility semantics are preserved;
- acknowledged-ID batching provides exact one-shot Undo;
- Footer and Sidebar share one Mark-All/Undo concurrency coordinator;
- Sidebar Mark All does not jump to another source;
- partial failure, stale-session protection and counts/list reconciliation are covered by automated/browser gates;
- the PM-discovered Undo-during-active-Mark-All race was fixed before merge.

Validation closure:

- focused tests: `19/19` PASS;
- full applicable Node tests: `132/132` PASS;
- ESLint, Prettier, build and `git diff --check`: PASS;
- dedicated BULK-01B browser harness: PASS;
- legacy aggregate harness: baseline `20/29`, candidate `20/29`, same nine known `HARNESS-UNDO-ID-01` failures;
- authenticated critical viewport `884×1104`: layout, Feed context menu, confirmation, cancel/no-mutation, Mark All count reconciliation, route stability and scroll stability validated;
- physical-device touch gate: `WAIVED_BY_OWNER`; a physical touch PASS is **not** claimed. Residual risk is limited to physical long-press ergonomics, gesture-scroll feel and Fold-specific hardware/browser behavior on this exact head.

The temporary canary entry used during viewport validation was restored through normal product UI before closure; residual test-data risk is `NO`.

## Completed visual package status

### LIST-VISUAL-01

Status: **COMPLETED**.

Delivered:

- deterministic favicon monogram fallback;
- redundant read/unread presentation;
- source kicker hierarchy;
- metadata cohesion across Column/Card/List;
- long source truncation in article Column presentation.

Rehomed rather than silently completed:

- human-readable unread-count labels -> `NAV-02F`;
- untitled-entry semantics -> `CONTENT-01`.

Not authorized by package completion:

- new trailing-thumbnail/card redesign.

## Open high-priority work

### P1

- **FILTER-01A — P1 / PRODUCT DECISION REQUIRED:** define search scope transition semantics. A11Y-01 is complete; FILTER-01A remains an open product decision and is not the next authorized implementation unit.

### Other NEXT tracks

- **READER-KEY-01:** layered Escape behavior.
- **STATE-ERR-01:** unavailable-entry route behavior; product decision required.
- **CONTENT-01:** deterministic untitled-entry fallback; copy decision required.

## Planned functional tracks

- BULK-01C — scoped Undo copy.
- BULK-03 — provider-backed range/age mark-as-read; BULK-01B dependency is now satisfied.
- BULK-02 — multi-select; BULK-01B dependency is satisfied, but FILTER-01A remains blocking.
- FILTER-01B, then FILTER-RULES-01.
- HOME-01 — refresh/focus/reconnect semantics.
- NAV01 — previous/next + next unread source flow.
- NAV-02F — navigation follow-ups including human-readable unread-count labels.
- FEED-HEALTH-01 — visible Miniflux feed/parsing health.
- Keyboard/touch parity.
- READER-MEDIA-01.

## Visual / presentation backlog

- **CHROME-01 — PLANNED:** DatePicker subset is complete; remaining confirmation/snackbar/raw-Arco work must stay decomposed.
- **READER-VISUAL-02A — AUTHORIZED WITH SEQUENCE LOCK:** A2 / Quiet Column is the approved direction (D5 and D9 approved). 02A1 is the next authorized functional unit; its existing spec remains frozen pending reconciliation against the post-A11Y implementation base. READER-MEASURE-01 is a separate PR after 02A1; 02A2 follows both and has not started.
- **READER-VISUAL-02B — PLANNED:** auto-hide + Next card only after interaction/NAV dependencies.
- **HOME-VISUAL-02 — HOLD — PRODUCT.**
- **NAV-VISUAL-01 — HOLD — PRODUCT.**
- **READER-COVER-01 — HOLD — PRODUCT.**
- **READER-FONT-01 — HOLD — PRODUCT.**
- **HOME-SKEL-01 — BACKLOG.**
- **READER-MEASURE-01 — SEQUENCED AFTER READER-VISUAL-02A1:** separate PR; measurement decision follows 02A1 and precedes 02A2.
- **HARNESS-VIS-01 — BACKLOG (test debt).**
- **TEST-ENV-01 — BACKLOG (verification required).**
- **MOTION-01 — BACKLOG.**

## Personalization / saved-state architecture

- Phase 2D V1 is complete and Home-only.
- All/Unread remain chronological and predictable.
- Phase 2D V2 remains deterministic-only until architecture is proven.
- Story clustering, learned relevance and ML remain architecture-gated.
- Miniflux remains source of truth for feeds, categories, read/unread and starred.
- First-party Later/Bookmarks/Boards/Tags/Saved/Smart folders/per-feed synced layout require explicit storage/sync/privacy/source-of-truth decisions.
- Provider-backed external save, feed rules, range mark-as-read and feed health may advance without creating a second persistent NewsFlux database when their semantics are explicit.

## Upstream state

```text
UPSTREAM_REPOSITORY=electh/ReactFlux
UPSTREAM_MODE=SELECTIVE_INTEGRATION
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
```

The specialized upstream monitor must live-check the current upstream head before auditing. New commits are classified `INTEGRATE / ADAPT / SKIP / HOLD`; never blindly Sync fork or merge upstream/main.

## Known test debt

### HARNESS-UNDO-ID-01

- Classification: `TEST_HARNESS_DEBT`.
- Blocking: **NO** for unrelated product PRs when baseline and candidate reproduce the same failures.
- Symptom: nine aggregate list-harness checks still expect a legacy fixed Undo notification ID.
- Product behavior intentionally uses generation/action-scoped IDs to prevent sequential notification collisions.
- Fix only in a dedicated test-maintenance PR.

### HARNESS-CODEBLOCK-SSR-01

- Classification: `PREEXISTING_TEST_HARNESS_DEBT`.
- Surface: `scripts/article-code-block-controls.test.js`.
- Cause signature: Vite SSR / CommonJS named export `Select` from `@arco-design/web-react` under the current Node/container harness.
- Impact: does not invalidate ID-RUNTIME-01.
- Scope: out of ID-RUNTIME-01.
- Next: dedicated maintenance PR.

Do not fix this debt in unrelated product or documentation work.

## Open findings / residual risks

- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This remains an accepted validation limitation rather than an open blocker.
- PR #30 completed with `REAL_DEVICE_GATE=WAIVED_BY_OWNER`; physical touch PASS is not claimed for the exact PR #30 head. Full automated/browser coverage and authenticated `884×1104` evidence passed where tooling was deterministic. This is an accepted residual validation limitation, not an open product defect.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.
- Repository Prettier hooks normalized Markdown table alignment in this PR; PM accepted the formatting. This creates a residual auditability limitation when comparing prior table edits; no formatter bypass or manual reversal was used.

## Product decisions pending

- FILTER-01A search scope contract.
- STATE-ERR-01 unavailable-entry contract.
- CONTENT-01 untitled fallback wording.
- BULK-03 exact above/below/age semantics.
- FILTER-RULES-01 simple vs advanced Miniflux rule editor.
- HOME-VISUAL-02 composition.
- SAVE-EXT-01 wording/placement.
- NAV-02F grouping/mode persistence/count presentation.
- NAV-VISUAL-01 adaptive navigation.
- CHROME-01 contextual control consolidation.
- READER-MEASURE-01 prose width/phone behavior.
- ID-DEPLOY-01 local-build vs registry/deployer architecture.

## Next recommended action

**READER-VISUAL-02A1** is the next authorized functional product unit after A11Y-01 / PR #34. The approved direction is A2 / Quiet Column (D5 and D9 approved). The existing 02A1 specification is frozen pending reconciliation against the post-A11Y implementation base; no Claude handoff is recorded in this reconciliation. READER-MEASURE-01 must remain a separate PR after 02A1, followed by READER-VISUAL-02A2. 02A2 has not started.

This sequence authorizes only the listed 02A1 work; it does not authorize a merge or deployment. Before implementation:

1. live-check GitHub `main`, open PRs and production baseline;
2. classify docs-only commits separately from runtime/product drift;
3. reconcile the frozen 02A1 specification against the post-A11Y implementation base;
4. prepare one-purpose scope and regression gates;
5. keep READER-MEASURE-01 separate and do not start 02A2 before its sequence point;
6. never merge without explicit user authorization.

## Deployment governance

- Deploy only an exact approved product/runtime SHA.
- Never deploy `latest` or a moving branch implicitly.
- Current production product baseline: `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`.
- Current production image: `newsflux-local:7b0a7e04d1e1`.
- Current production image ID: `sha256:c5d64a7a9686aec005490882e24cabb03c664afd60cc5ea82e51e6bb730be5c4`.
- Current rollback baseline: `newsflux-local:099bdcb0483e` (`sha256:51e36a5fcb84429c45868dcdd066ec5d8cd51d8b3150405c8f13caa64a1cd846`). Preserved older rollback images: `newsflux-local:b94c10926ae7` and `newsflux-local:fa98531fe153`.
- The promotion backup is `/dockerdata/compose/newsflux/compose.yaml.pre-a11y01.20261016T014001Z.bak` (SHA-256 `3bc8dd1a21525471a685bd134ebb4c2265674467a9cba3342f794d72badc9129`).
- PR #30 and PR #32 exact merge-SHA deployments passed; their deployment history remains recorded above.
- PR #34 / A11Y-01 exact merge-SHA deployment and authenticated post-merge browser smoke passed. The exact merge image passed internal HTTP and provenance checks, remained stable after restart and had restart count `0`.
- Docs-only commits do not require production deployment merely to force SHA equality; classify their runtime delta as none.
- Do not delete rollback images/backups incidentally.

## Documentation closure policy

Every task must close with:

```text
DOCUMENTATION_ACTION=
DOCUMENTATION_REASON=
DOCUMENTATION_TARGETS=
DOCUMENTATION_CHANGES_REQUIRED=
DOCUMENTATION_BLOCKS_NEXT=
PROJECT_STATE_RECONCILED=
```

Allowed `DOCUMENTATION_ACTION` values:

- `NONE`
- `UPDATE_IN_SCOPE`
- `FOLLOW_UP_DOCS_PR`

Documentation must be updated in-scope or through a dedicated follow-up PR when a task changes roadmap status, sequencing, architectural/product decisions, production/runtime baseline, upstream baseline, known debt, open findings or the next recommended action.

## Governance invariants

- No merge without explicit user authorization.
- No upstream sync mixed with redesign or functional features.
- One identifiable purpose per PR.
- Incidental findings go to backlog/next phase.
- Miniflux remains the source of truth for provider-owned state.
- New persistent NewsFlux state requires explicit architecture.
- All/Unread remain chronological and predictable.
- Glass stays in chrome; content remains opaque.
- Mobile/tablet/Fold remain single-pane-first.
- Critical visual viewport remains `884×1104` where applicable.
