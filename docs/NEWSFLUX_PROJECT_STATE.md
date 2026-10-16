# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-16.
- **Documented product baseline:** `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`.

## Current state

The values below are a snapshot verified during this reconciliation: live `main` and production both resolve to `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. A docs-only merge will advance `main` without changing the product/runtime baseline. Re-read live GitHub and production before every follow-on action.

```text
CURRENT_MAIN=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
DOCUMENTED_MAIN_BASE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
PRODUCT_BASELINE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
PRODUCTION_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
MAIN_PRODUCTION_PARITY=YES
RUNTIME_PRODUCT_BASELINE_EQUALS_PRODUCTION=YES

CURRENT_PHASE=POST_READER_MEASURE_01
CURRENT_TRACK=RUNTIME-BASE-01_RECONCILIATION_PENDING_DOCS_PR_CLOSE
CURRENT_PRODUCT_PR=NONE
CURRENT_READER_PR=NONE
OPEN_RUNTIME_PR=38 (RUNTIME-BASE-01; RECONCILIATION_REQUIRED)

LAST_COMPLETED=READER-MEASURE-01 / PR #44
PRE_READER_MEASURE_FUNCTIONAL_BASELINE=FILTER-01B #39; FEED-HEALTH-01A #40; BULK-03A #43
FILTER_01A_STATUS=COMPLETED
FILTER_01A_PR=37
FILTER_01A_MERGE_SHA=73f793f51ba3f81e04c2fbaaf3093fc6c5983078
FILTER_01A_PRODUCT_DECISION=SEARCH_SCOPED_AND_RESET_ON_SCOPE_CHANGE

UPSTREAM_INTEGRATED_THROUGH=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d

NEXT_RECOMMENDED_ACTION=RUNTIME-BASE-01 / PR #38 RECONCILIATION AFTER DOCS PR CLOSES
NEXT_ENGINEERING_TRACK=RUNTIME-BASE-01 / PR #38 RECONCILIATION
NEXT_AUTHORIZED_ACTION=RUNTIME-BASE-01 / PR #38 RECONCILIATION AFTER DOCS PR CLOSES

PRODUCTION_IMAGE=newsflux-local:118ecb2c63f7
PRODUCTION_IMAGE_ID=sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499
ROLLBACK_BASELINE=newsflux-local:cfef27e50fae

DOCUMENT_LAST_RECONCILED_AT=2026-10-16
DOCUMENT_PRODUCT_BASELINE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
READER_MEASURE_01_STATUS=COMPLETED_MERGED_PROMOTED
READER_MEASURE_01_PR=44
READER_MEASURE_01_FEATURE_HEAD=1d280c0132a3f1d0d6fae49aeb10ed20ea613bd0
READER_MEASURE_01_MERGE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
READER_MEASURE_01_REAL_DEVICE_GATE=NOT_EXECUTED_NONBLOCKING
READER_MEASURE_01_NODE_CADDY_BASE_PARITY=PASS
READER_VISUAL_02A1_STATUS=COMPLETED_PR41
READER_VISUAL_02A2_STATUS=NOT_STARTED
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
- **PR #37 / FILTER-01A:** active-source-scoped search; source changes clear search, while same-scope reader return/refresh/pagination preserve it; no global search or new persistence. Merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078`.
- **PR #39 / FILTER-01B:** source/date/search transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`.
- **PR #40 / FEED-HEALTH-01A:** Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`.
- **PR #41 / READER-VISUAL-02A1:** editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`.
- **PR #42:** NAV-02 Mark All harness maintenance; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`.
- **PR #43 / BULK-03A:** mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`.
- **PR #44 / READER-MEASURE-01:** bounded responsive prose measure; merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. Automated Reader Measure, RV01, 02A1 and protected-surface gates passed; exact-SHA promotion, provenance, Node/Caddy base parity and default-width-75 visual parity passed. The CPL sandbox reached exactly 74 characters.

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

- FILTER-01A is complete in PR #37; its former P1 search-scope product decision is closed.

### Other NEXT tracks

- **READER-KEY-01:** layered Escape behavior.
- **STATE-ERR-01:** unavailable-entry route behavior; product decision required.
- **CONTENT-01:** deterministic untitled-entry fallback; copy decision required.

## Planned functional tracks

- BULK-01C — scoped Undo copy.
- BULK-03 — provider-backed range/age mark-as-read; BULK-03A above/below actions completed in PR #43, with remaining scope still separate.
- BULK-02 — multi-select; BULK-01B and FILTER-01A are complete prerequisites. Remaining sequencing/product gates must be reviewed before authorization.
- FILTER-RULES-01; FILTER-01B was completed in PR #39.
- HOME-01 — refresh/focus/reconnect semantics.
- NAV01 — previous/next + next unread source flow.
- NAV-02F — navigation follow-ups including human-readable unread-count labels.
- FEED-HEALTH-01B — detailed message, last checked and Retry flow; the compact error indicator in 01A completed in PR #40.
- Keyboard/touch parity.
- READER-MEDIA-01.

## Visual / presentation backlog

- **CHROME-01 — PLANNED:** DatePicker subset is complete; remaining confirmation/snackbar/raw-Arco work must stay decomposed.
- **READER-VISUAL-02A — IN PROGRESS:** A2 / Quiet Column is the approved direction (D5 and D9 approved); 02A1 completed in PR #41 and READER-MEASURE-01 completed in PR #44. 02A2 remains not started; its header/body alignment gate needs the production `.article-header-column` element.
- **READER-VISUAL-02B — PLANNED:** auto-hide + Next card only after interaction/NAV dependencies.
- **HOME-VISUAL-02 — HOLD — PRODUCT.**
- **NAV-VISUAL-01 — HOLD — PRODUCT.**
- **READER-COVER-01 — HOLD — PRODUCT.**
- **READER-FONT-01 — HOLD — PRODUCT.**
- **HOME-SKEL-01 — BACKLOG.**
- **READER-MEASURE-01 — COMPLETED:** PR #44 merged and promoted at the current product/production SHA.
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
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d
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

- **READER-MEASURE-01 real-device gate:** not executed; nonblocking. A physical `884×1104` Fold/tablet and a phone remain recommended for long-form comfort and OLED review.
- **Reader header/body alignment:** the production CSS includes `.article-header-column` in preparation for READER-VISUAL-02A2, but the production element does not exist yet. Current alignment validation is probe-based; 02A2 must use the real element.
- **Search focus observation:** during production smoke, Search initially focused “Search syntax help” rather than the input. Search functionality worked; this was not investigated and is not a confirmed regression. Keep as an open finding for a dedicated reproduction.
- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This remains an accepted validation limitation rather than an open blocker.
- PR #30 completed with `REAL_DEVICE_GATE=WAIVED_BY_OWNER`; physical touch PASS is not claimed for the exact PR #30 head. Full automated/browser coverage and authenticated `884×1104` evidence passed where tooling was deterministic. This is an accepted residual validation limitation, not an open product defect.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.
- Repository Prettier hooks normalized Markdown table alignment in this PR; PM accepted the formatting. This creates a residual auditability limitation when comparing prior table edits; no formatter bypass or manual reversal was used.

## Product decisions pending

- STATE-ERR-01 unavailable-entry contract.
- CONTENT-01 untitled fallback wording.
- BULK-03 exact above/below/age semantics.
- FILTER-RULES-01 simple vs advanced Miniflux rule editor.
- HOME-VISUAL-02 composition.
- SAVE-EXT-01 wording/placement.
- NAV-02F grouping/mode persistence/count presentation.
- NAV-VISUAL-01 adaptive navigation.
- CHROME-01 contextual control consolidation.
- ID-DEPLOY-01 local-build vs registry/deployer architecture.

## Next recommended action

**RUNTIME-BASE-01 / PR #38 reconciliation** is the next engineering track after this documentation PR closes. PR #38 remains open on branch `codex/runtime-base-01` with base `73f793f51ba3f81e04c2fbaaf3093fc6c5983078` and head `0add12108d5cf5fc0a8e7aa7162d0307bb7888e2`; reconcile it against live `main` in its dedicated runtime-only scope. This documentation task does not modify PR #38 and does not authorize merge or deployment.

After that track closes, re-read live project state before resuming Reader work. READER-VISUAL-02A2 remains not started and must validate header/body alignment against the real production element.

## Deployment governance

- Deploy only an exact approved product/runtime SHA.
- Never deploy `latest` or a moving branch implicitly.
- Current production product baseline: `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`.
- Current production image: `newsflux-local:118ecb2c63f7` (image ID `sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`).
- Current rollback baseline: `newsflux-local:cfef27e50fae`.
- The READER-MEASURE-01 promotion backup is `/dockerdata/compose/newsflux/compose.yaml.pre-reader-measure-01-20261016T201834Z.bak` (SHA-256 `94ffebe7ff81f95e02fe3bf93cf56844e8a95eacac45d43b10e5b4942a603351`).
- PR #30 and PR #32 exact merge-SHA deployments passed; their deployment history remains recorded above.
- PR #34 / A11Y-01 exact merge-SHA deployment and authenticated post-merge browser smoke passed. The exact merge image passed internal HTTP and provenance checks, remained stable after restart and had restart count `0`.
- PR #44 / READER-MEASURE-01 exact merge-SHA promotion passed with target source/revision provenance, served asset hash parity and Node/Caddy base-image digest parity. The default width 75 retained visual parity. No real-device gate was run; this remains nonblocking. The NewsFlux container has no configured healthcheck.
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
