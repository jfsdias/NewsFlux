# NewsFlux Project State

- **Purpose:** concise operational state for PM handoffs and future sessions. The roadmap remains the source for sequencing and product/architecture detail.
- **Last reconciled:** 2026-10-15.
- **Document baseline:** product `main` and production at `fa98531fe153c5689e40eaf210309b8751cb2cc4`.

## Current state

```text
CURRENT_MAIN=fa98531fe153c5689e40eaf210309b8751cb2cc4
PRODUCTION_SHA=fa98531fe153c5689e40eaf210309b8751cb2cc4
MAIN_EQUALS_PRODUCTION=YES

CURRENT_PHASE=POST_LIST_VISUAL_01A_STABLE_BASELINE
CURRENT_PR=NONE

LAST_COMPLETED=LIST-VISUAL-01A / PR #28
UPSTREAM_INTEGRATED_THROUGH=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d

NEXT_RECOMMENDED_ACTION=BULK-01B
NEXT_AUTHORIZED_ACTION=NONE

ROLLBACK_BASELINE=newsflux-local:b3d75867b901

DOCUMENT_LAST_RECONCILED_AT=2026-10-15
DOCUMENT_LAST_RECONCILED_SHA=fa98531fe153c5689e40eaf210309b8751cb2cc4
```

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

- **BULK-01B — NEXT:** Sidebar feed/category Mark All confirmation + Undo contract.
- **FILTER-01A — NEXT / PRODUCT DECISION:** define search scope transition semantics.
- **A11Y-01 — NEXT:** main landmark, heading hierarchy, named navigation and skip navigation.

### Other NEXT tracks

- **ID-RUNTIME-01:** visible runtime identity, update/About/issues routing to NewsFlux while preserving upstream credit.
- **READER-KEY-01:** layered Escape behavior.
- **STATE-ERR-01:** unavailable-entry route behavior; product decision required.
- **CONTENT-01:** deterministic untitled-entry fallback; copy decision required.

## Planned functional tracks

- BULK-01C — scoped Undo copy.
- BULK-03 — provider-backed range/age mark-as-read.
- BULK-02 — multi-select; blocked by BULK-01B + FILTER-01A.
- FILTER-01B, then FILTER-RULES-01.
- HOME-01 — refresh/focus/reconnect semantics.
- NAV01 — previous/next + next unread source flow.
- NAV-02F — navigation follow-ups including human-readable unread-count labels.
- FEED-HEALTH-01 — visible Miniflux feed/parsing health.
- Keyboard/touch parity.
- READER-MEDIA-01.

## Visual / presentation backlog

- **CHROME-01 — PLANNED:** DatePicker subset is complete; remaining confirmation/snackbar/raw-Arco work must stay decomposed.
- **READER-VISUAL-02A — PLANNED:** typography/header/stateless progress only.
- **READER-VISUAL-02B — PLANNED:** auto-hide + Next card only after interaction/NAV dependencies.
- **HOME-VISUAL-02 — HOLD — PRODUCT.**
- **NAV-VISUAL-01 — HOLD — PRODUCT.**
- **HOME-SKEL-01 — BACKLOG.**
- **READER-MEASURE-01 — BACKLOG.**
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

## Open findings / residual risks

- PR #28 physical validation accepted the normal-source/Card/Grid comparison, but no real long-source entry was available to exercise the exact ellipsis case on physical hardware. Automated visual coverage included the long-source geometry and critical `884×1104` viewport. This is an accepted, documented residual validation limitation rather than an open blocker.
- Global formatting historically reported four out-of-scope documentation files; do not conflate pre-existing formatting debt with product regressions. Re-check when documentation tooling is next touched.

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
- ID-DEPLOY-01 local build vs registry/deployer architecture.

## Next recommended action

**BULK-01B** is the next recommended implementation unit because it is an unresolved P1 behavior issue with a bounded functional purpose: bring Sidebar feed/category Mark All into the existing confirmation + Undo safety contract.

This is a recommendation only. Before implementation:

1. live-check GitHub `main`, open PRs and production baseline;
2. prepare one-purpose scope and regression gates;
3. keep it separate from visual redesign and upstream sync;
4. obtain authorization for the implementation track;
5. never merge without explicit user authorization.

## Deployment governance

- Deploy only an exact approved SHA.
- Never deploy `latest` or a moving branch implicitly.
- Current production image: `newsflux-local:fa98531fe153`.
- Preserved rollback image: `newsflux-local:b3d75867b901`.
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

Documentation must be updated in-scope or through a dedicated follow-up PR when a task changes roadmap status, sequencing, architectural/product decisions, current/production SHA, upstream baseline, known debt, open findings or the next recommended action.

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
