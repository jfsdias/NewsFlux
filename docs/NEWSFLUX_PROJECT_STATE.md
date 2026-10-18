# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-17.
- **Documented main/product baseline:** `1021cd5746eba2b3b90b1a863bada9043f126be1`.

## Current state

Live GitHub and OMV inspection on 2026-10-17 found `main` at `1021cd5746eba2b3b90b1a863bada9043f126be1`, zero open PRs before this docs PR, and production container `newsflux` running image `newsflux-local:118ecb2c63f7` (source SHA `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`), image ID `sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`, and restart count 0. Main and production are not at parity; PRs #52, #53, and #55 were merged without production promotion.

```text
CURRENT_MAIN=1021cd5746eba2b3b90b1a863bada9043f126be1
DOCUMENTED_MAIN_BASE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1
PRODUCT_BASELINE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1
PRODUCTION_CONTAINER=newsflux
PRODUCTION_CONTAINER_ID=5c1882d2792a48a894c0806231bbb371f97b60d49b6922f5b9218a1c905bf8ef
PRODUCTION_CONTAINER_STATUS=running (observed 2026-10-17)
PRODUCTION_RESTART_COUNT=0
PRODUCTION_IMAGE=newsflux-local:118ecb2c63f7
PRODUCTION_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
PRODUCTION_IMAGE_ID=sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499
PRODUCTION_REVISION_LABEL=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
PRODUCTION_SOURCE_LABEL=https://github.com/jfsdias/NewsFlux
MAIN_PRODUCTION_PARITY=NO
RUNTIME_PRODUCT_BASELINE_EQUALS_PRODUCTION=NO
OPEN_PRS_BEFORE_THIS_DOCS_PR=0

CURRENT_PHASE=POST_FILTER_RULES_01
CURRENT_TRACK=BULK_02_DISCOVERY_DESIGN
CURRENT_PRODUCT_PR=NONE
OPEN_RUNTIME_PR=NONE

LAST_COMPLETED_FUNCTIONAL=FILTER-RULES-01 / PR #55
LAST_COMPLETED_MAINTENANCE=SELECTIVE_UPSTREAM_SYNC / PR #53
FILTER_RULES_01_STATUS=COMPLETED
FILTER_RULES_01_PR=55
FILTER_RULES_01_FEATURE_HEAD=5b6abe28ae5e6b52f02461c4e3601165056900b1
FILTER_RULES_01_MERGE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1
FEED_ERROR_RESET_DECISION=ACCEPT_PROVIDER_BEHAVIOR_WITH_EXPLICIT_DISCLOSURE
FILTER_RULES_API_TESTS=5/5 PASS
FILTER_RULES_BROWSER_HARNESS=21/21 PASS
FULL_NODE=276/276 PASS
FEED_HEALTH_UNIT_REGRESSION=4/4 PASS
FEED_HEALTH_01A_BASE_HEAD_PARITY=PASS
FEED_HEALTH_01B_BASE_HEAD_PARITY=PASS
PR55_REGRESSION_EVIDENCE=NO
LIVE_MINIFLUX_WRITES=0
LIVE_NONEMPTY_RULE_ROUND_TRIP_CANARY=NOT_EXECUTED
LAST_PRODUCTION_PROMOTION=READER-MEASURE-01 / PR #44 / 118ecb2c63f7df3583d0f2524b5cc8c62bd518c1
READER_VISUAL_02A_STATUS=COMPLETED (02A1 + Measure + 02A2 / Quiet Column)
BULK_03_STATUS=COMPLETED (03A + 03B)

UPSTREAM_INTEGRATION_MODE=SELECTIVE_NON_LINEAR
LAST_LINEAR_INTEGRATED_UPSTREAM_BASELINE=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
SELECTIVELY_INTEGRATED=e46d92ab64adcbd0bb8ac2caf6048fa37f527939
SELECTIVELY_ADAPTED=0c28762de6987c980306b8553753e549e753b4e0
UPSTREAM_HOLD_VITE=4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe (8.3.1 to 8.3.4; dedicated bundler/lockfile/harness regression gate required)
UPSTREAM_HOLD_FRAMER_MOTION=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036 (14.0.0 to 14.2.0; dedicated production visual/motion regression gate required)
FEED_HEALTH_01A=COMPLETED
FEED_HEALTH_01B=COMPLETED
FEED_HEALTH_01_STATUS=COMPLETED
UPSTREAM_CURRENT_HEAD=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
UPSTREAM_UNREVIEWED_CHANGES=NO

NEXT_RECOMMENDED_ACTION=BULK_02_READ_ONLY_DISCOVERY_AND_BOUNDED_DESIGN
NEXT_ENGINEERING_TRACK=BULK-02
NEXT_AUTHORIZED_ACTION=DISCOVERY_AND_DESIGN_ONLY
BULK_02_STATUS=NEXT — DISCOVERY/DESIGN
BULK_02_IMPLEMENTATION_AUTHORIZED=NO
IMPLEMENTATION_AUTHORIZED=NO

ROLLBACK_BASELINE=NOT_REVALIDATED
DOCUMENTATION_RECONCILIATION_BRANCH=codex/docs-post-filter-rules-01
DOCUMENTATION_RECONCILIATION_BASE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1
DOCUMENTATION_SCOPE=DOCUMENTATION_ONLY
DEPLOY_PERFORMED=NO
MERGE_AUTHORIZED=NO
```

A docs-only branch does not alter production. Any later deployment decision must use an exact approved SHA and a fresh live production check.

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
- **PR #36 / HARNESS-UNDO-ID-01:** test-only repair; head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`, merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; all 29 focused list regression gates passed.
- **PR #37 / FILTER-01A:** active-source-scoped search; source changes clear search, while same-scope reader return/refresh/pagination preserve it; no global search or new persistence. Merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078`.
- **PR #38 / RUNTIME-BASE-01:** Dockerfile-only Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 digest pins; head `07237ba7e8c773e9de88e9c533296b9700dde287`, merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`. Isolated build/runtime gates passed; production was not switched.
- **PR #39 / FILTER-01B:** source/date/search transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`.
- **PR #40 / FEED-HEALTH-01A:** Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`.
- **PR #41 / READER-VISUAL-02A1:** editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`.
- **PR #42:** NAV-02 Mark All harness maintenance; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`.
- **PR #43 / BULK-03A:** mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`.
- **PR #44 / READER-MEASURE-01:** bounded responsive prose measure; merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. Automated Reader Measure, RV01, 02A1 and protected-surface gates passed; exact-SHA promotion, provenance, Node/Caddy base parity and default-width-75 visual parity passed. The CPL sandbox reached exactly 74 characters.
- **PR #45 / documentation:** prior post-Reader Measure reconciliation, merged as `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation.
- **PR #46 / READER-KEY-01:** layered Escape complete; feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`, merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`.
- **PR #47 / STATE-ERR-01:** unavailable-entry 404 behavior complete; feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`, merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`.
- **PR #48 / CONTENT-01:** deterministic untitled fallback complete; feature head `1032b5409298629382685a85935b85fdc2292f85`, merge `9f521edfd5f031e8e833a4854d896acc42a22fae`.
- **PR #49 / READER-VISUAL-02A2:** quiet editorial header aligned to the production prose column; feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`, merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`.
- **PR #50 / BULK-03B:** 1/7/30-day age presets, full discovery before writes, strict `published_at` cutoff, scope preservation, acknowledged-only Undo, shared Today time snapshot and focus restoration; feature head `dd9e68650f3f40080199b90107c2b35722166697`, merge `a8dbe15497f7d526298f223188955b82589a84a4`. No production promotion.
- **PR #51 / documentation:** reconciled project state and roadmap after BULK-03B; merged as `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`.
- **PR #52 / FEED-HEALTH-01B:** provider-reported error detail, provider-owned `checked_at`/`parsing_error_count`, accessible details and Retry, stale-session fencing, and one final metadata reconciliation after bulk refresh; feature head `1b03865311993f7e72df0632ea662bbe94e926e9`, merged as `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`. No production promotion.
- **PR #53 / selective upstream maintenance:** integrated pnpm build-script hardening and adapted setup-node pins; feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`, merged as `046cd647c65583cdfdc7ab282701be79d4b34294`. No production promotion.
- **PR #55 / FILTER-RULES-01:** provider-backed per-feed raw Miniflux `blocklist_rules` / `keeplist_rules` editor; feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`, merge `1021cd5746eba2b3b90b1a863bada9043f126be1`; no NewsFlux rule persistence.

## FILTER-RULES-01 closure

- Miniflux remains the source of truth. The per-feed editor round-trips raw `blocklist_rules` and `keeplist_rules`; explicit empty strings clear a rule, while absent fields preserve provider values. Advanced entry-filter fields remain untouched, and provider responses are authoritative; stale-session fencing and bounded ambiguous-failure reconciliation protect edits.
- Miniflux 2.3.3 clears its recorded feed error when a feed is updated. NewsFlux accepts that provider behavior and discloses it when filter rules are dirty; a successful rule save does not mean the feed is healthy. `FEED_ERROR_RESET_DECISION=ACCEPT_PROVIDER_BEHAVIOR_WITH_EXPLICIT_DISCLOSURE`.
- Validation: API tests 5/5; FILTER-RULES-01 browser harness 21/21; full Node 276/276; Feed Health unit regression 4/4. FEED-HEALTH-01A base/head parity: 16/16 each at 1280×720, 390×844 and 884×1104. FEED-HEALTH-01B base/head results matched: desktop 42/42; mobile/tablet 41/41 plus a native-input-only focus gate. `PR55_REGRESSION_EVIDENCE=NO`.
- Live Miniflux writes were 0; a live non-empty rule round-trip canary was not executed. `FILTER_RULES_NATIVE_MOBILE_FOCUS_RETURN=NOT_PHYSICALLY_VALIDATED`; no physical gate is claimed. `MUTATION_OBSERVER_INITIAL_FAILURE=NOT_REPRODUCED`. `REACT_19_ELEMENT_REF_WARNING=PREEXISTING_NON_BLOCKING`.
- **Open, non-blocking finding — `FEED_EDIT_ERROR_RESET_DISCLOSURE`:** ordinary feed edits can also clear provider-recorded errors; FILTER-RULES-01 discloses this only on its own surface. Track a separate maintenance/UX decision. This is not a confirmed FILTER-RULES-01 defect and does not reopen FEED-HEALTH-01.

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

- None currently recorded.

### Next track

- **BULK-02 discovery/design:** visible/session multi-select, mark selected articles as read, and always-available Undo. Discovery and bounded design only; implementation is not authorized.

## Planned functional tracks

- BULK-01C — scoped Undo copy.
- BULK-03 — **COMPLETED** in PRs #43 and #50; above/below and 1/7/30-day age-based read actions are merged.
- BULK-02 — **NEXT: DISCOVERY/DESIGN**; visible/session multi-select, mark selected read, and Undo always available. Implementation remains unauthorized.
- FILTER-01B was completed in PR #39; FILTER-RULES-01 was completed in PR #55.
- HOME-01 — refresh/focus/reconnect semantics.
- NAV01 — previous/next + next unread source flow.
- NAV-02F — navigation follow-ups including human-readable unread-count labels.
- Keyboard/touch parity.
- READER-MEDIA-01.

## Visual / presentation backlog

- **CHROME-01 — PLANNED:** DatePicker subset is complete; remaining confirmation/snackbar/raw-Arco work must stay decomposed.
- **READER-VISUAL-02A — COMPLETED:** 02A1 in PR #41, Measure in PR #44, and 02A2 / Quiet Column in PR #49; real header/prose geometry passed on the production element across responsive widths and both themes.
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
UPSTREAM_INTEGRATION_MODE=SELECTIVE_NON_LINEAR
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
LAST_LINEAR_INTEGRATED_UPSTREAM_BASELINE=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
SELECTIVELY_INTEGRATED=e46d92ab64adcbd0bb8ac2caf6048fa37f527939
SELECTIVELY_ADAPTED=0c28762de6987c980306b8553753e549e753b4e0
HOLD_VITE=4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe (8.3.1 to 8.3.4; lockfile/Rolldown churn, harness sensitivity, dedicated regression gate)
HOLD_FRAMER_MOTION=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036 (14.0.0 to 14.2.0; production motion dependency, dedicated visual/motion regression gate)
```

PR #53 completed selective maintenance: `e46d92ab64adcbd0bb8ac2caf6048fa37f527939` was integrated as `allowBuilds.plyr=false` in `pnpm-workspace.yaml`; `0c28762de6987c980306b8553753e549e753b4e0` was adapted by updating only `actions/setup-node` from 7.0.0 to 7.1.0 in five equivalent workflows, preserving NewsFlux customizations. The reviewed frontier is not a linear integration claim. Holds remain unapproved for implementation.

The specialized upstream monitor must live-check the current upstream head before auditing. New commits are classified `INTEGRATE / ADAPT / SKIP / HOLD`; never blindly Sync fork or merge upstream/main.

## Known test debt and incidental findings

- **Workflow repository guard finding:** existing `github.repository == 'electh/ReactFlux'` guards remain an open, non-blocking finding. Track a separate maintenance decision; do not change them as part of upstream reconciliation.

- `HARNESS-UNDO-ID-01` was resolved by PR #36; the nine stale fixed-ID assertions were repaired and the focused list gate passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is not open on the current runtime baseline; PR #38 reports `CODEBLOCK_SSR_GATE=PASS` in the full Node suite on both main and candidate.
- The React 19 `element.ref` warning remains an incidental harness warning and non-blocking backlog. No fix is claimed here.

## Open findings / residual risks

- **READER-MEASURE-01 real-device gate:** not executed; nonblocking. A physical `884×1104` Fold/tablet and a phone remain recommended for long-form comfort and OLED review.
- **Reader header/body alignment:** completed by READER-VISUAL-02A2 / PR #49 using the real `.article-header-column` production element; edge alignment passed within 0.02 px across 390×844, 768×1024, 884×1104, 1024×768, 1280×800 and 1440×900 in both themes.
- **Search focus observation:** during production smoke, Search initially focused “Search syntax help” rather than the input. Search functionality worked; this was not investigated and is not a confirmed regression. Keep as an open finding for a dedicated reproduction.
- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This remains an accepted validation limitation rather than an open blocker.
- PR #30 completed with `REAL_DEVICE_GATE=WAIVED_BY_OWNER`; physical touch PASS is not claimed for the exact PR #30 head. Full automated/browser coverage and authenticated `884×1104` evidence passed where tooling was deterministic. This is an accepted residual validation limitation, not an open product defect.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.
- Repository Prettier hooks normalized Markdown table alignment in this PR; PM accepted the formatting. This creates a residual auditability limitation when comparing prior table edits; no formatter bypass or manual reversal was used.

## Product decisions pending

- HOME-VISUAL-02 composition.
- SAVE-EXT-01 wording/placement.
- NAV-02F grouping/mode persistence/count presentation.
- NAV-VISUAL-01 adaptive navigation.
- CHROME-01 contextual control consolidation.
- ID-DEPLOY-01 local-build vs registry/deployer architecture.

## Next recommended action

**BULK-02 read-only discovery and bounded design.** Preserve visible/session-only multi-select, mark-selected-as-read, and always-available Undo as the known contract. Determine detailed behavior and gates before implementation; this reconciliation authorizes discovery/design only.

## Deployment governance

- Deploy only an exact approved product/runtime SHA.
- Never deploy `latest` or a moving branch implicitly.
- Live production container: `newsflux`, ID `5c1882d2792a48a894c0806231bbb371f97b60d49b6922f5b9218a1c905bf8ef`, status `running`, restart count `0` at the 2026-10-17 read-only SSH inspection.
- Live production image tag: `newsflux-local:118ecb2c63f7`; its prefix resolves to full source SHA `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. Image ID observed: `sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`.
- `MAIN_PRODUCTION_PARITY=NO`; current main is `1021cd5746eba2b3b90b1a863bada9043f126be1`.
- The READER-MEASURE-01 promotion backup is `/dockerdata/compose/newsflux/compose.yaml.pre-reader-measure-01-20261016T201834Z.bak` (SHA-256 `94ffebe7ff81f95e02fe3bf93cf56844e8a95eacac45d43b10e5b4942a603351`).
- PR #30 and PR #32 exact merge-SHA deployments passed; their deployment history remains recorded above.
- PR #34 / A11Y-01 exact merge-SHA deployment and authenticated post-merge browser smoke passed. The exact merge image passed internal HTTP and provenance checks, remained stable after restart and had restart count `0`.
- PR #44 / READER-MEASURE-01 is the last confirmed production promotion. PRs #46–#50, #52, #53 and #55 were merged without production promotion; production remains at the #44 baseline. `PRODUCTION_CHANGED_BY_PR52=NO`, `PRODUCTION_CHANGED_BY_PR53=NO` and `PRODUCTION_CHANGED_BY_PR55=NO`. PR #49's real-element geometry gate passed; `REAL_DEVICE_GATE=NOT_REQUIRED` for that geometry-only change.
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
