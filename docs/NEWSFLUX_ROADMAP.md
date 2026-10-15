# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after PR #28 and production promotion.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-15.
- **Reconciled against:** `main` and production at `fa98531fe153c5689e40eaf210309b8751cb2cc4`.
- **Purpose:** preserve completed work, accepted findings, sequencing, architecture/product gates, upstream baseline, and the next recommended action without turning the roadmap into implementation authorization.

This document is the canonical **roadmap**, not an implementation authorization. Detailed design decisions remain in the dedicated design documents and implementation plans remain in `docs/superpowers/plans/` where present.

No roadmap item may bypass project governance: one identifiable purpose per PR, no merge without explicit user authorization, no implicit upstream sync, no redesign mixed with functional work, no new persistent NewsFlux state without an explicit source-of-truth decision, and no incidental scope expansion.

---

## 1. Product north star

NewsFlux is a consciously maintained ReactFlux fork for Miniflux. The product direction is:

- editorial rather than dashboard-like;
- OLED-aware, with restrained near-black surfaces;
- predictable for RSS workflows, especially All/Unread/feed/category scopes;
- single-pane-first on phone, tablet and foldable layouts;
- focused in the reader, with content opaque and glass restricted to chrome;
- selectively synchronized with ReactFlux upstream;
- deterministic before intelligent, especially for personalization and ranking;
- provider-aware, preferring Miniflux-backed capabilities over NewsFlux-owned persistence where coherent;
- cohesive before decorative.

### Non-negotiable behavior boundaries

- Do not introduce silent ranking into **All** or **Unread**.
- Do not make a permanent three-pane layout the default architecture.
- Do not use translucent/glass content cards or reader surfaces.
- Do not create a NewsFlux-owned `Later`, `Bookmarks`, `Boards`, Tags, Smart folders or other persistent saved state until storage/sync/privacy are explicitly decided.
- Do not conflate Miniflux `starred` with a new persistent state.
- Provider-backed features may advance without new NewsFlux storage only when ownership, limitations and failure semantics are explicit.
- Do not broaden a PR because an adjacent file is already open.

---

## 2. Status vocabulary

- **COMPLETED** — merged and validated.
- **IN PROGRESS** — active implementation or validation track.
- **NEXT** — accepted high-priority target; may still carry an explicit decision gate.
- **PLANNED** — accepted and ordered later.
- **HOLD — PRODUCT** — feasible but blocked on product semantics/copy/interaction choice.
- **HOLD — ARCHITECTURE** — blocked on storage/sync/privacy/source-of-truth architecture.
- **BACKLOG** — accepted but not ordered.
- **BASELINE / ONGOING** — maintenance state rather than a feature phase.

---

## 3. Current product state

### 3.1 Completed design and product phases

| Item | Status | Notes |
| --- | --- | --- |
| Phase 1 | **COMPLETED** | Single-pane foundation |
| Phase 2A | **COMPLETED** | Full-width browsing |
| Phase 2B / 2B.1 | **COMPLETED** | Editorial cards + content intelligence |
| Phase 2B.2A | **COMPLETED** | OLED visual foundation |
| Phase 2B.2B | **COMPLETED** | Liquid Glass chrome + article scroll underlay |
| Phase 2B.2C | **COMPLETED** | Rounded cards, text-only treatment, read-state polish |
| Phase 2C | **COMPLETED** | Editorial Home |
| Phase 2D V1 | **COMPLETED** | Deterministic Home personalization |
| NAV-02 | **COMPLETED** | Unread-first source navigation |
| HOME-VISUAL-01 | **COMPLETED** | Primary hierarchy refinement |
| READER-VISUAL-01 | **COMPLETED** | Reading ergonomics refinement |
| UX/UI red-team round 2 | **COMPLETED** | `GOOD_WITH_DEBT`: 0 P0, 3 P1, 13 P2, 8 P3 |

### 3.2 Recently completed PRs

| PR | Track | Status | Notes |
| --- | --- | --- | --- |
| #20 | BULK-01 | **COMPLETED** | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo |
| #21 | ID-01R | **COMPLETED** | Repository/document provenance and translated README reconciliation |
| #22 | Documentation | **COMPLETED** | Canonical roadmap red-team R2 reconciliation |
| #23 | A11Y-RT-01 | **COMPLETED** | Reduced-transparency dark/OLED specificity fix |
| #24 | LIST-VISUAL-01 / monogram subset | **COMPLETED** | Deterministic favicon monogram fallback |
| #25 | CHROME-01A / DatePicker subset | **COMPLETED** | NewsFlux token styling for DatePicker |
| #26 | Upstream sync | **COMPLETED** | Adapted upstream article code-block experience through `3045a5f8...` |
| #27 | BULK-01F | **COMPLETED** | Footer Mark All Read focus restoration |
| #28 | LIST-VISUAL-01A | **COMPLETED** | Read-state + metadata/source hierarchy cohesion across Column/Card/List |

### 3.3 Functional behavior and defect tracks

| Item | Status | Priority / dependency | Notes |
| --- | --- | --- | --- |
| BULK-01 — Footer Mark All Read Undo | **COMPLETED** | PR #20 | One-shot 8 s undo; repeated-operation behavior validated |
| BULK-01F — footer focus return | **COMPLETED** | PR #27 | Focus returns deterministically without stale-list refocus |
| BULK-01B — Sidebar context Mark All | **NEXT** | R2-01, **P1** | Unify confirmation + undo contract for feed/category context actions; dedicated functional PR |
| BULK-01C — scoped undo copy | **PLANNED** | R2-09, product copy decision | Name affected scope/count; remain separate from BULK-01B |
| BULK-03 — range/age mark-as-read | **PLANNED** | After BULK-01B, before/alongside BULK-02 | Provider-backed; explicit ID-set semantics + acknowledged-ID Undo |
| FILTER-01A — search scope rules | **NEXT** | R2-02, **P1**, product decision required | Decide reset-on-scope-change vs visible persistent/global search state |
| FILTER-01B — date/status filter behavior | **PLANNED** | After FILTER-01A | Define visible scoped state and transition matrix |
| FILTER-RULES-01 | **PLANNED** | After FILTER-01 | Miniflux `blocklist_rules` / `keeplist_rules`; no NewsFlux rule database |
| BULK-02 — Multi-select | **PLANNED** | Blocked by BULK-01B + FILTER-01A | Visible/session selection only; mark selected read; Undo always |
| READER-KEY-01 — layered Escape | **NEXT** | R2-05, P2 | Escape closes topmost menu/popover before reader |
| STATE-ERR-01 — unavailable entry route | **NEXT** | R2-06, P2, product decision | Explicit unavailable state or safe redirect with feedback |
| CONTENT-01 — untitled entry fallback | **NEXT** | R2-07, P2, copy decision | Deterministic accessible fallback; unread cue must remain non-empty |
| HOME-01 — refresh/focus/reconnect | **PLANNED** | R2-12 | Refresh must not unexpectedly reshuffle an active Phase 2D session |
| NAV01 — reader previous/next + next unread | **PLANNED** | R2-14 | Preserve canonical originating-scope order and next-unread-source flow |
| NAV-02F — navigation follow-ups | **PLANNED** | R2-13/R2-17/R2-18 | Long source names, unread grouping/mode persistence decisions, and human-readable unread labels |
| FEED-HEALTH-01 | **PLANNED** | Near NAV-02F | Surface Miniflux parsing/feed error state without mixing navigation semantics |

### 3.4 Accessibility and interaction foundation

| Item | Status | Notes |
| --- | --- | --- |
| A11Y-RT-01 | **COMPLETED** | PR #23 |
| A11Y-01 — landmarks / heading / skip navigation | **NEXT** | R2-03, **P1**; `<main>`, named navigation, one h1 per view, reader hierarchy, skip link |
| Keyboard/touch parity | **PLANNED** | R2-05/R2-11/R2-16; touch hit areas >=44 px while visual icons may remain smaller |
| SWIPE-ENTRY-01 | **BACKLOG** | Miniflux-backed; real-device gate mandatory because Fold/back gestures may conflict |
| READER-MEDIA-01 | **PLANNED** | R2-15/R2-19; edge-to-edge media requires real-device gate |
| READER-MEASURE-01 | **BACKLOG** | R2-22/R2-23/R2-24; width minimum, phone semantics, title geometry |
| READER-PROGRESS-01 | **BACKLOG** | Stateless progress only; persisted reading position remains architecture-gated |
| READER-PRESETS-01 | **BACKLOG** | Group existing local typography/width/theme settings after READER-MEASURE-01 |

### 3.5 Visual-cohesion packages

| Package | Status | Scope / remainder |
| --- | --- | --- |
| LIST-VISUAL-01 | **COMPLETED** | Monogram fallback (#24) + read-state/source/metadata cohesion (#28). Human-readable unread-count labels were rehomed to NAV-02F. No thumbnail redesign is authorized by this completion. |
| CHROME-01 | **PLANNED** | DatePicker token subset completed in #25; verb-first confirmations, snackbar placement and remaining raw-Arco styling remain separate scoped work |
| HOME-VISUAL-02 | **HOLD — PRODUCT** | Edition/category composition requires explicit editorial decision and HOME-01 dependency resolution |
| READER-VISUAL-02 | **PLANNED** | Typography/header/stateless progress subset may advance separately; auto-hide + Next depend on interaction/NAV gates |
| NAV-VISUAL-01 | **HOLD — PRODUCT** | Adaptive bottom bar/rail/drawer requires explicit decision + real Fold gate |
| MOTION-01 | **BACKLOG** | View Transition/container transform after main interaction architecture stabilizes |

#### LIST-VISUAL-01 closure notes

- Read/unread is redundant rather than color-only.
- Column/Card/List share a more coherent source/metadata hierarchy.
- Missing favicons use deterministic monograms without persistent per-feed style state.
- Human-readable unread counts belong to navigation/count presentation and are tracked under NAV-02F.
- Untitled-entry semantics remain CONTENT-01.
- A trailing-thumbnail redesign was only a candidate direction and is not considered approved work.

### 3.6 Home / presentation

| Item | Status | Notes |
| --- | --- | --- |
| HOME-SKEL-01 | **BACKLOG** | Skeleton hierarchy parity + Recent text-only/content-box measurement |
| HOME-VISUAL-02 | **HOLD — PRODUCT** | Deterministic Home-only rhythm; category/Latest semantics require decision |
| Home editorial hierarchy | **ACCEPTED** | Latest remains more chronological than Highlights until HOME-VISUAL-02 is decided |

### 3.7 Identity / distribution

| Item | Status | Notes |
| --- | --- | --- |
| ID-01R | **COMPLETED** | PR #21 |
| ID-RUNTIME-01 | **NEXT** | Product name, update check, About and issue links should target NewsFlux while preserving upstream credit |
| GitHub metadata | **NEXT** | Description/homepage/topics remain a separate metadata write |
| ID-DEPLOY-01 | **HOLD — ARCHITECTURE** | Choose local-build vs registry/deployer contract before checked-in distribution changes |
| APP-BADGE-01 | **BACKLOG** | After ID-DEPLOY; use Miniflux unread counts subject to browser/PWA capability |
| THEME-CHROME-01 | **BACKLOG** | Align browser/PWA theme surface with NewsFlux OLED/light surfaces |

### 3.8 Upstream maintenance

| Item | Status | Notes |
| --- | --- | --- |
| Selective upstream maintenance model | **ONGOING** | Never blindly merge or Sync fork |
| Last formally reviewed upstream | **BASELINE** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d` |
| Last integrated upstream | **BASELINE** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d` via PR #26 article-code-block adaptation |
| Next upstream audit | **PLANNED** | Specialized monitor must live-check upstream and review only commits after `3045a5f8...` |

Upstream audit classification remains `INTEGRATE / ADAPT / SKIP / HOLD`. No reviewed/integrated baseline advances merely because upstream has a newer head.

### 3.9 Personalization and explicit rules

| Item | Status | Notes |
| --- | --- | --- |
| Phase 2D V1 deterministic Home personalization | **COMPLETED** | Home-only; All/Unread remain predictable |
| FILTER-RULES-01 | **PLANNED** | Explicit Miniflux-backed user rules are preferred over learned relevance for filtering/muting |
| Phase 2D V2 signal expansion | **PLANNED** | Deterministic signals only until architecture is proven |
| Story clustering | **HOLD — ARCHITECTURE** | After Personalization V2; Home-only and opt-in if adopted |
| User-controlled learned relevance | **HOLD — ARCHITECTURE** | Requires separate source-of-truth/privacy decision |
| ML ranking | **HOLD — ARCHITECTURE** | Last, after deterministic behavior/privacy/explainability/storage decisions |

### 3.10 Saved states / external save

| Item | Status | Notes |
| --- | --- | --- |
| Favorites | **ADAPT** | Miniflux `starred`; no second persistent state |
| SAVE-EXT-01 | **PLANNED** | One-way external handoff through Miniflux integrations; wording must not imply a NewsFlux library |
| Internal Later / Read Later | **HOLD — ARCHITECTURE** | Requires durable queue/source-of-truth only if NewsFlux must enumerate/manage it |
| Saved umbrella/library | **HOLD — ARCHITECTURE** | No coherent first-party source of truth yet |
| Bookmarks | **HOLD — ARCHITECTURE** | Reject if semantically identical to starred; otherwise requires storage |
| Boards / collections | **HOLD — ARCHITECTURE** | Requires ownership/privacy/export decisions |
| Tags | **HOLD — ARCHITECTURE** | Separate decision; do not infer from provider feed rules |
| Smart folders / saved searches | **HOLD — ARCHITECTURE** | Depends on FILTER-01 and saved-filter storage decision |
| Per-feed layout | **HOLD — ARCHITECTURE** | Decide source/sync after NAV-02F |
| Swipe-save | **HOLD — ARCHITECTURE** | Target and Fold gesture semantics must be explicit |

---

## 4. Red-team R2 accepted findings and disposition

P1 findings:

1. **R2-01 / BULK-01B** — still open and NEXT.
2. **R2-02 / FILTER-01A** — still open and NEXT, product decision required.
3. **R2-03 / A11Y-01** — still open and NEXT.

P2 disposition:

- R2-04 reduced-transparency dark-mode specificity — **COMPLETED** in PR #23.
- R2-05 layered Escape — **OPEN** as READER-KEY-01.
- R2-06 dead entry route — **OPEN** as STATE-ERR-01.
- R2-07 untitled entry fallback — **OPEN** as CONTENT-01.
- R2-08 mark-all focus return — **COMPLETED** in PR #27.
- R2-09 scoped undo wording — **PLANNED** as BULK-01C.
- R2-10 runtime identity — **OPEN** as ID-RUNTIME-01.
- R2-11 touch target size — **PLANNED** under keyboard/touch parity.
- R2-12 Home refresh — **PLANNED** as HOME-01.
- R2-13 source-name truncation — partially improved in article Column via #28; navigation-specific source-name work remains NAV-02F.
- R2-14 next-unread flow — **PLANNED** as NAV01.
- R2-15 reader edge-to-edge media — **PLANNED** as READER-MEDIA-01.
- R2-16 category keyboard tab-stop — re-check before fixing under keyboard/touch parity.

P3 debt remains under NAV-02F, HOME-SKEL-01 and READER-MEASURE-01 rather than being fixed incidentally.

---

## 5. Product decisions required before implementation

### FILTER-01A
Choose one contract:

- **scope-local search:** clear search when scope changes; or
- **persistent/global search:** preserve query but expose it as visible removable filter state.

Do not implement BULK-02 until this is decided because the selected visible set depends on a defined filtered scope.

### STATE-ERR-01
Choose explicit unavailable state at the URL or redirect with feedback.

### CONTENT-01
Define deterministic fallback text for untitled entries. Accessible name and unread cue must never be empty.

### BULK-03
Define exact semantics for above/below/older-than under order, search/date/status filters and load-more/virtualized lists.

### FILTER-RULES-01
Choose simple common keyword UI versus advanced Miniflux rule syntax. Miniflux remains the rule source of truth.

### HOME-VISUAL-02
Decide whether category/edition sections supplement Latest, replace part of Latest or remain optional. Composition remains Home-only.

### SAVE-EXT-01
Copy must distinguish external one-way save from a future first-party NewsFlux Read Later queue.

### NAV-02F
Decide optional Unread grouping, desktop sidebar width, `showUnreadFeedsOnly` persistence, and final human-readable unread-count presentation.

### NAV-VISUAL-01
Decide drawer/sidebar-only versus adaptive bottom bar/rail. Real-device validation is mandatory.

### CHROME-01 contextual consolidation
Decide whether footer/header context zones remain separate or become one contextual action bar. Do not resolve incidentally during styling.

### READER-MEASURE-01
Decide whether Article width may have a minimum prose measure and whether the width setting affects phone layouts.

---

## 6. Architecture decisions required before first-party persistent state

Before an internal Later queue, Bookmarks, Boards, Tags, Saved umbrella, Smart folders, per-feed layout sync or learned relevance, decide:

1. source of truth;
2. single-device vs multi-device sync and conflicts;
3. privacy and stored behavioral/content metadata;
4. referential identity across feed deletion/server changes;
5. export/portability;
6. partial-failure reconciliation;
7. relationship to Miniflux read/starred/feeds/categories/history/integrations.

Provider-backed `SAVE-EXT-01`, `FILTER-RULES-01`, `BULK-03` and `FEED-HEALTH-01` are not blocked by this architecture gate because they do not create a second persistent NewsFlux source of truth.

---

## 7. Recommended execution order from the current baseline

The earlier deterministic items A11Y-RT-01, BULK-01F and LIST-VISUAL-01 have now been completed. The ordered remaining tracks are:

1. **BULK-01B** — P1 sidebar confirmation/undo contract.
2. **ID-RUNTIME-01** — runtime product identity and upstream-safe links.
3. **A11Y-01** — P1 landmarks/headings/skip navigation.
4. **FILTER-01A** — P1 after explicit product choice.
5. **READER-KEY-01**, **STATE-ERR-01**, **CONTENT-01** — separate bugfix PRs.
6. **READER-VISUAL-02A** — typography/header/stateless progress only.
7. **BULK-03** and **FEED-HEALTH-01** — separate provider-backed PRs.
8. **HOME-01**, **NAV01**, **Keyboard/touch parity** — separate functional/interaction tracks.
9. **READER-MEDIA-01** — real-device gate for edge-to-edge media.
10. **FILTER-01B**, then **FILTER-RULES-01**.
11. **CHROME-01 remaining subsets** — keep behavior, token styling and any glass/context consolidation isolated.
12. **BULK-02** — only after BULK-01B + FILTER-01A.
13. **NAV-02F**, **HOME-SKEL-01**, **READER-MEASURE-01**.
14. **SAVE-EXT-01** after wording/placement are specified.
15. **HOME-VISUAL-02** after explicit editorial decision + HOME-01.
16. **READER-VISUAL-02B** after reduced-motion/focus contract + NAV01.
17. **NAV-VISUAL-01** after explicit adaptive-navigation decision + real-device plan.
18. **ID-DEPLOY-01** after distribution architecture decision.
19. **First-party saved-state work** only after storage/sync/privacy/source-of-truth decisions.
20. **Personalization V2**.
21. **MOTION-01** after interaction architecture stabilizes.
22. **ML ranking** last.

`BULK-01C` may be scheduled once copy is decided, but it remains separate from BULK-01B.

Read-only upstream auditing can run in parallel, but no sync follows automatically.

---

## 8. BULK safety contracts

### BULK-02

Before implementation preserve:

- explicit Select entry point;
- selection cleared on route/scope/search/filter change;
- no select-all across unloaded pages;
- session-only selection state;
- acknowledged-ID mutations;
- partial-failure reconciliation;
- stale-session protection;
- counts/list invalidation;
- one-shot Undo;
- keyboard/screen-reader semantics;
- mobile/Fold interaction without permanent clutter;
- batching/performance gates.

### Mark-all-read regression gates

Any future mutation/sync touching mark-all-read must preserve:

- `MARK_ALL_READ_SUCCESS`;
- `MARK_ALL_READ_FILTER_SCOPE`;
- `MARK_ALL_READ_NO_JUMP_ON_FAILURE`;
- `MARK_ALL_READ_JUMP_TO_NEXT`;
- `STALE_SESSION_PROTECTION`;
- `PARTIAL_FAILURE_RECONCILIATION`;
- `COUNTS_REFRESH`.

The existing `markAllReadJumpToNext` behavior remains intentional.

---

## 9. Known test debt

### HARNESS-UNDO-ID-01

The aggregate list harness still contains nine assertions expecting a legacy fixed Undo notification ID. The product intentionally uses generation/action-scoped IDs to avoid repeated-operation collisions.

- Classification: **TEST_HARNESS_DEBT**.
- Product regression: **NO**.
- Current aggregate symptom: `20/29` where those same nine cases fail on both relevant baseline and candidate runs.
- Handling: fix only in a dedicated test-maintenance PR; never incidentally inside unrelated feature/design work.

---

## 10. Definition of ready

An item should not enter implementation until it has:

- one-sentence user/problem outcome;
- explicit in/out-of-scope boundaries;
- source-of-truth decision where state is involved;
- dependency/order declaration;
- acceptance gates;
- regression surfaces;
- browser/real-device gate where relevant;
- dedicated branch/PR plan.

Roadmap acceptance is not merge authorization.

---

## 11. Governance invariants

- **No merge without explicit user authorization.**
- **No implicit deployment of `latest`; deploy exact approved SHA only.**
- **No upstream sync mixed with design or feature work.**
- **No design work mixed with unrelated functional fixes.**
- **Incidental findings go to roadmap/backlog rather than being fixed opportunistically.**
- **Miniflux remains source of truth for feeds, categories, read/unread, starred and adopted provider-backed features.**
- **New persistent NewsFlux state requires explicit architecture.**
- **All/Unread remain chronological and predictable.**
- **Glass is chrome; content remains opaque.**
- **Mobile/tablet/Fold remain single-pane-first.**
- **Critical visual acceptance remains 884×1104 where the track requires it.**

### Documentation closure rule

Every completed task must classify documentation before closure:

- `DOCUMENTATION_ACTION=NONE`, `UPDATE_IN_SCOPE`, or `FOLLOW_UP_DOCS_PR`;
- `DOCUMENTATION_REASON`;
- `DOCUMENTATION_TARGETS`;
- `DOCUMENTATION_CHANGES_REQUIRED`;
- `DOCUMENTATION_BLOCKS_NEXT`;
- `PROJECT_STATE_RECONCILED`.

When a completed task changes roadmap status, sequencing, architectural/product decisions, current/production SHA, upstream baseline, known debt or the next recommended action, the project state must be reconciled in-scope or by an explicitly scheduled docs-only PR.

---

## 12. Current promotion state

- `CURRENT_MAIN=fa98531fe153c5689e40eaf210309b8751cb2cc4`
- `PRODUCTION_SHA=fa98531fe153c5689e40eaf210309b8751cb2cc4`
- `LIST_VISUAL_01A=COMPLETED`
- `UPSTREAM_INTEGRATED_THROUGH=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`
- `NEXT_RECOMMENDED_ACTION=BULK-01B`
- `NEXT_AUTHORIZED_ACTION=NONE`

The next implementation unit requires a fresh live-state check and explicit authorization. No roadmap entry authorizes a merge or production deployment by itself.
