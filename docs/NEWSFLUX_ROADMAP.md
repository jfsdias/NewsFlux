# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after READER-MEASURE-01 / PR #44 exact merge-SHA production promotion.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-16.
- **Reconciled against:** `main` and production at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1` on 2026-10-16.
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

### Reference-product interpretation

Reference products are inputs, not a checklist.

| Reference        | Learn from                                                                                            | Do not copy blindly                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Apple News       | Editorial rhythm, edition header, focused reading, clear end states, touch-first chrome               | Oversized promotional imagery, ad-like blocks, opaque ranking               |
| NetNewsWire      | RSS clarity, source organization, redundant read-state cues, next-unread flow, keyboard-driven triage | Permanent three-pane architecture                                           |
| Fusion           | Predictable navigation state, URL-backed reader state                                                 | Provider/state semantics that conflict with Miniflux                        |
| Feedly           | Scoped mark-as-read undo, multi-select/range triage, compact action feedback                          | Toolbar proliferation, paid/AI assumptions, premature Boards                |
| Inoreader        | Explicit search/filter state, rules, tags/library concepts                                            | Dashboard-heavy IA and too many simultaneous controls                       |
| NewsBlur         | Per-feed preferences, explicit user rules/relevance controls                                          | Learned relevance in All/Unread and excessive visual density                |
| ReadKit / Reeder | External read-later handoff, list/reader continuity, progress, typography, saved-state taxonomy       | New internal state without a defined source of truth                        |
| Material 3       | Adaptive navigation patterns, verb-first confirmations, snackbar behavior, container transitions      | Adaptive navigation without a Fold/device decision and real-device evidence |

Current reference decisions:

- **ADOPT:** multi-select; mark-selected-as-read; keyboard navigation expansion; provider-backed range mark-as-read; visible feed-health signaling; stronger list/read-state redundancy; editorial typography/details that do not alter behavior.
- **ADAPT:** Favorites as Miniflux `starred`; density control using existing local settings; Miniflux block/keep rules; external-save/read-later handoff through Miniflux integrations; category rhythm on Home; Material-style confirmations/snackbars only where they preserve NewsFlux scope semantics.
- **PLANNED WITH PRODUCT DECISION:** HOME-VISUAL-02 composition; NAV-VISUAL-01 adaptive navigation; contextual chrome consolidation.
- **HOLD:** NewsFlux-owned Saved umbrella, internal Read Later queue, internal Bookmarks, Boards, Tags, Smart folders, per-feed layout sync, swipe-save to an undefined target, story clustering, ML.
- **DO NOT COPY:** Apple News ad-like blocks/oversized imagery; Feedly/Inoreader toolbar density; NewsBlur visual density; glass over content; permanent three-pane UI; algorithmic For You outside Home.

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

| Item                   | Status        | Notes                                                 |
| ---------------------- | ------------- | ----------------------------------------------------- |
| Phase 1                | **COMPLETED** | Single-pane foundation                                |
| Phase 2A               | **COMPLETED** | Full-width browsing                                   |
| Phase 2B / 2B.1        | **COMPLETED** | Editorial cards + content intelligence                |
| Phase 2B.2A            | **COMPLETED** | OLED visual foundation                                |
| Phase 2B.2B            | **COMPLETED** | Liquid Glass chrome + article scroll underlay         |
| Phase 2B.2C            | **COMPLETED** | Rounded cards, text-only treatment, read-state polish |
| Phase 2C               | **COMPLETED** | Editorial Home                                        |
| Phase 2D V1            | **COMPLETED** | Deterministic Home personalization                    |
| NAV-02                 | **COMPLETED** | Unread-first source navigation                        |
| HOME-VISUAL-01         | **COMPLETED** | Primary hierarchy refinement                          |
| READER-VISUAL-01       | **COMPLETED** | Reading ergonomics refinement                         |
| UX/UI red-team round 2 | **COMPLETED** | `GOOD_WITH_DEBT`: 0 P0, 3 P1, 13 P2, 8 P3             |

### 3.2 Recently completed PRs

| PR  | Track                            | Status        | Notes                                                                                                                                                                                               |
| --- | -------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20 | BULK-01                          | **COMPLETED** | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo                                                                                                                 |
| #21 | ID-01R                           | **COMPLETED** | Repository/document provenance and translated README reconciliation                                                                                                                                 |
| #22 | Documentation                    | **COMPLETED** | Canonical roadmap red-team R2 reconciliation                                                                                                                                                        |
| #23 | A11Y-RT-01                       | **COMPLETED** | Reduced-transparency dark/OLED specificity fix                                                                                                                                                      |
| #24 | LIST-VISUAL-01 / monogram subset | **COMPLETED** | Deterministic favicon monogram fallback                                                                                                                                                             |
| #25 | CHROME-01A / DatePicker subset   | **COMPLETED** | NewsFlux token styling for DatePicker                                                                                                                                                               |
| #26 | Upstream sync                    | **COMPLETED** | Adapted upstream article code-block experience through `3045a5f8...`                                                                                                                                |
| #27 | BULK-01F                         | **COMPLETED** | Footer Mark All Read focus restoration                                                                                                                                                              |
| #28 | LIST-VISUAL-01A                  | **COMPLETED** | Read-state + metadata/source hierarchy cohesion across Column/Card/List                                                                                                                             |
| #29 | Documentation                    | **COMPLETED** | Roadmap/project-state reconciliation after PR #28 production promotion                                                                                                                              |
| #30 | BULK-01B                         | **COMPLETED** | Sidebar Feed/Category Mark All confirmation + safe shared Undo; race hardening; exact merge-SHA deployed                                                                                            |
| #32 | ID-RUNTIME-01                    | **COMPLETED** | Approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merged/deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed                                            |
| #34 | A11Y-01                          | **COMPLETED** | Approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`; merged/deployed as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`; tree parity, exact-SHA promotion and authenticated post-merge smoke passed |
| #39 | FILTER-01B                       | **COMPLETED** | Date/status filter transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`                                                                                                        |
| #40 | FEED-HEALTH-01A                  | **COMPLETED** | Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`                                                                                                 |
| #41 | READER-VISUAL-02A1               | **COMPLETED** | Editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`                                                                                                               |
| #42 | NAV-02 harness maintenance       | **COMPLETED** | Mark-All expectation aligned with current batching; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`                                                                                            |
| #43 | BULK-03A                         | **COMPLETED** | Mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`                                                                                                             |
| #44 | READER-MEASURE-01                | **COMPLETED** | Bounded responsive prose measure; exact-SHA merge and production promotion at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`                                                                            |

### 3.3 Functional behavior and defect tracks

| Item                                       | Status          | Priority / dependency                                                               | Notes                                                                                                                                                                |
| ------------------------------------------ | --------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BULK-01 — Footer Mark All Read Undo        | **COMPLETED**   | PR #20                                                                              | One-shot 8 s undo; repeated-operation behavior validated                                                                                                             |
| BULK-01F — footer focus return             | **COMPLETED**   | PR #27                                                                              | Focus returns deterministically without stale-list refocus                                                                                                           |
| BULK-01B — Sidebar context Mark All        | **COMPLETED**   | PR #30, R2-01                                                                       | Feed/Category confirmation + acknowledged-ID Undo; shared Mark-All/Undo coordinator; no Sidebar jump; physical touch gate waived by owner, physical PASS not claimed |
| BULK-01C — scoped undo copy                | **PLANNED**     | R2-09, product copy decision                                                        | Name affected scope/count; remain separate from BULK-01B                                                                                                             |
| BULK-03 — range/age mark-as-read           | **IN PROGRESS** | BULK-01B dependency satisfied; before/alongside BULK-02                             | BULK-03A above/below actions completed in PR #43; remaining range/age scope stays provider-backed with explicit ID-set semantics + acknowledged-ID Undo              |
| FILTER-01A — search scope rules            | **COMPLETED**   | PR #37; merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078`                        | Search is source-scoped; changing source clears it, same-scope reader return/refresh/pagination preserve it; no global search or new persistence                     |
| FILTER-01B — date/status filter behavior   | **COMPLETED**   | PR #39                                                                              | Date/status transitions and scoped search behavior; merged before the Reader Measure production baseline                                                             |
| FILTER-RULES-01                            | **PLANNED**     | After FILTER-01                                                                     | Miniflux `blocklist_rules` / `keeplist_rules`; no NewsFlux rule database                                                                                             |
| BULK-02 — Multi-select                     | **PLANNED**     | BULK-01B and FILTER-01A complete; remaining sequencing/product gates require review | Visible/session selection only; mark selected read; Undo always                                                                                                      |
| READER-KEY-01 — layered Escape             | **NEXT**        | R2-05, P2                                                                           | Escape closes topmost menu/popover before reader                                                                                                                     |
| STATE-ERR-01 — unavailable entry route     | **NEXT**        | R2-06, P2, product decision                                                         | Explicit unavailable state or safe redirect with feedback                                                                                                            |
| CONTENT-01 — untitled entry fallback       | **NEXT**        | R2-07, P2, copy decision                                                            | Deterministic accessible fallback; unread cue must remain non-empty                                                                                                  |
| HOME-01 — refresh/focus/reconnect          | **PLANNED**     | R2-12                                                                               | Refresh must not unexpectedly reshuffle an active Phase 2D session                                                                                                   |
| NAV01 — reader previous/next + next unread | **PLANNED**     | R2-14                                                                               | Preserve canonical originating-scope order and next-unread-source flow                                                                                               |
| NAV-02F — navigation follow-ups            | **PLANNED**     | R2-13/R2-17/R2-18                                                                   | Long source names, unread grouping/mode persistence decisions, and human-readable unread labels                                                                      |
| FEED-HEALTH-01                             | **IN PROGRESS** | 01A completed in PR #40; 01B remains                                                | Sidebar reports Miniflux update errors; detailed message, checked time and Retry remain a separate follow-up                                                         |

### 3.4 Accessibility and interaction foundation

| Item                                            | Status        | Notes                                                                                                                                                                             |
| ----------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11Y-RT-01                                      | **COMPLETED** | PR #23                                                                                                                                                                            |
| A11Y-01 — landmarks / heading / skip navigation | **COMPLETED** | PR #34; `<main>`, named navigation, one h1 per view, reader hierarchy and skip link; exact merge-SHA deploy + authenticated post-merge smoke passed                               |
| Keyboard/touch parity                           | **PLANNED**   | R2-05/R2-11/R2-16; touch hit areas >=44 px while visual icons may remain smaller                                                                                                  |
| SWIPE-ENTRY-01                                  | **BACKLOG**   | Miniflux-backed; real-device gate mandatory because Fold/back gestures may conflict                                                                                               |
| READER-MEDIA-01                                 | **PLANNED**   | R2-15/R2-19; edge-to-edge media requires real-device gate                                                                                                                         |
| READER-MEASURE-01                               | **COMPLETED** | PR #44 merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`; bounded 40–58ch prose measure; width 75 visually unchanged; real-device gate not executed (nonblocking) |
| READER-PROGRESS-01                              | **BACKLOG**   | Stateless progress only; persisted reading position remains architecture-gated                                                                                                    |
| READER-PRESETS-01                               | **BACKLOG**   | Group existing local typography/width/theme settings after READER-MEASURE-01                                                                                                      |

### 3.5 Visual-cohesion packages

| Package           | Status             | Scope / remainder                                                                                                                                                                               |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST-VISUAL-01    | **COMPLETED**      | Monogram fallback (#24) + read-state/source/metadata cohesion (#28). Human-readable unread-count labels were rehomed to NAV-02F. No thumbnail redesign is authorized by this completion.        |
| CHROME-01         | **PLANNED**        | DatePicker token subset completed in #25; verb-first confirmations, snackbar placement and remaining raw-Arco styling remain separate scoped work                                               |
| HOME-VISUAL-02    | **HOLD — PRODUCT** | Edition/category composition requires explicit editorial decision and HOME-01 dependency resolution                                                                                             |
| READER-VISUAL-02A | **IN PROGRESS**    | A2 / Quiet Column approved (D5/D9); 02A1 typography foundation completed in #41; READER-MEASURE-01 completed in #44; 02A2 remains not started; header alignment awaits `.article-header-column` |
| READER-VISUAL-02B | **PLANNED**        | Auto-hide + Next only after interaction/NAV dependencies                                                                                                                                        |
| NAV-VISUAL-01     | **HOLD — PRODUCT** | Adaptive bottom bar/rail/drawer requires explicit decision + real Fold gate                                                                                                                     |
| READER-COVER-01   | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                               |
| READER-FONT-01    | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                               |
| HARNESS-VIS-01    | **BACKLOG**        | Test debt; not ordered                                                                                                                                                                          |
| TEST-ENV-01       | **BACKLOG**        | Verification required; not ordered                                                                                                                                                              |
| MOTION-01         | **BACKLOG**        | View Transition/container transform after main interaction architecture stabilizes                                                                                                              |

#### LIST-VISUAL-01 closure notes

- Read/unread is redundant rather than color-only.
- Column/Card/List share a more coherent source/metadata hierarchy.
- Missing favicons use deterministic monograms without persistent per-feed style state.
- Human-readable unread counts belong to navigation/count presentation and are tracked under NAV-02F.
- Untitled-entry semantics remain CONTENT-01.
- A trailing-thumbnail redesign was only a candidate direction and is not considered approved work.

#### Visual-cohesion decision reference

Safe/low-decision directions retained from the accepted design supplement:

- standardize source kicker placement and metadata rhythm;
- make read/unread redundant and accessible rather than color-only;
- align list-row visual language with Home secondary stories without turning lists into cards;
- improve blockquote, caption and link typography in Reader;
- allow stateless Reader progress only when it does not persist position;
- restyle raw Arco controls with NewsFlux tokens rather than adding another UI library;
- prefer verb-first confirmation labels;
- use deterministic favicon fallback monograms without persistent per-feed style state.

Product/real-device-gated directions remain:

- HOME-VISUAL-02 category/edition composition;
- contextual consolidation of floating/header/footer controls;
- scroll-aware opaque/glass chrome switching;
- auto-hiding Reader chrome;
- adaptive bottom-bar/rail/sidebar navigation;
- swipe gestures;
- View Transition/container transform;
- serif headline font unless self-hosted and validated for privacy/performance/readability.

Dependency rules remain:

- `Updated N minutes ago` depends on trustworthy HOME-01 refresh semantics;
- Reader `Next` depends on NAV01 canonical ordering;
- Reader auto-hide must respect reduced motion and keyboard focus;
- pull-to-refresh belongs with HOME-01 rather than a visual-only PR.

#### CHROME-01 contract retained

- Prefer verb-first confirmations such as `Mark 18 as read` / `Cancel` over generic `OK` / `Cancel` where semantics are already known.
- Keep Undo reachable on touch devices; any snackbar relocation must remain generation-safe and one-at-a-time.
- Raw Arco date selectors, popconfirms and notifications should use NewsFlux tokens rather than a parallel component system.
- Glass is a chrome behavior only and is justified when content actually passes beneath; reduced-transparency behavior must remain correct.
- Do not consolidate header/footer controls without a separate product decision.

#### HOME-VISUAL-02 contract retained

- Candidate edition header: date + deterministic new/unread facts + trustworthy refresh recency + refresh affordance.
- Candidate rhythm: lead/secondary section, category sections and compact text-only Summary rather than one uniform grid.
- Candidate source kicker should be standardized across Home card types.
- Candidate caught-up end state is allowed only after the product composition decision.
- Home composition must not reorder All/Unread.

#### READER-VISUAL-02 contract retained

- Header hierarchy: source kicker -> title -> author/date/reading-time metadata -> hero/content frame.
- Blockquotes, captions and links should receive restrained editorial typography.
- Stateless reading progress is allowed; persisted reading position remains architecture-gated.
- Auto-hide is a later subtrack and must return on upward scroll/focus, respect reduced motion and never hide critical keyboard controls.
- `Next` is a later subtrack dependent on NAV01.

### 3.6 Home / presentation

| Item                     | Status             | Notes                                                                             |
| ------------------------ | ------------------ | --------------------------------------------------------------------------------- |
| HOME-SKEL-01             | **BACKLOG**        | Skeleton hierarchy parity + Recent text-only/content-box measurement              |
| HOME-VISUAL-02           | **HOLD — PRODUCT** | Deterministic Home-only rhythm; category/Latest semantics require decision        |
| Home editorial hierarchy | **ACCEPTED**       | Latest remains more chronological than Highlights until HOME-VISUAL-02 is decided |

### 3.7 Identity / distribution

| Item            | Status                  | Notes                                                                                                                                                                 |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID-01R          | **COMPLETED**           | PR #21                                                                                                                                                                |
| ID-RUNTIME-01   | **COMPLETED**           | PR #32; approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merge/deployed baseline `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed |
| GitHub metadata | **NEXT**                | Description/homepage/topics remain a separate metadata write                                                                                                          |
| ID-DEPLOY-01    | **HOLD — ARCHITECTURE** | Choose local-build vs registry/deployer contract before checked-in distribution changes                                                                               |
| APP-BADGE-01    | **BACKLOG**             | After ID-DEPLOY; use Miniflux unread counts subject to browser/PWA capability                                                                                         |
| THEME-CHROME-01 | **BACKLOG**             | Align browser/PWA theme surface with NewsFlux OLED/light surfaces                                                                                                     |

### 3.8 Upstream maintenance

| Item                                 | Status       | Notes                                                                                    |
| ------------------------------------ | ------------ | ---------------------------------------------------------------------------------------- |
| Selective upstream maintenance model | **ONGOING**  | Never blindly merge or Sync fork                                                         |
| Last formally reviewed upstream      | **BASELINE** | `f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d`                                               |
| Last integrated upstream             | **BASELINE** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d` via PR #26 article-code-block adaptation      |
| Next upstream audit                  | **PLANNED**  | Specialized monitor must live-check upstream and review only commits after `f1d6e436...` |

Upstream audit classification remains `INTEGRATE / ADAPT / SKIP / HOLD`. The formal review frontier does not advance the integration baseline; commits classified `HOLD` are not claimed as integrated. No reviewed/integrated baseline advances merely because upstream has a newer head.

### 3.9 Personalization and explicit rules

| Item                                           | Status                  | Notes                                                                                         |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| Phase 2D V1 deterministic Home personalization | **COMPLETED**           | Home-only; All/Unread remain predictable                                                      |
| FILTER-RULES-01                                | **PLANNED**             | Explicit Miniflux-backed user rules are preferred over learned relevance for filtering/muting |
| Phase 2D V2 signal expansion                   | **PLANNED**             | Deterministic signals only until architecture is proven                                       |
| Story clustering                               | **HOLD — ARCHITECTURE** | After Personalization V2; Home-only and opt-in if adopted                                     |
| User-controlled learned relevance              | **HOLD — ARCHITECTURE** | Requires separate source-of-truth/privacy decision                                            |
| ML ranking                                     | **HOLD — ARCHITECTURE** | Last, after deterministic behavior/privacy/explainability/storage decisions                   |

### 3.10 Saved states / external save

| Item                           | Status                  | Notes                                                                                             |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------- |
| Favorites                      | **ADAPT**               | Miniflux `starred`; no second persistent state                                                    |
| SAVE-EXT-01                    | **PLANNED**             | One-way external handoff through Miniflux integrations; wording must not imply a NewsFlux library |
| Internal Later / Read Later    | **HOLD — ARCHITECTURE** | Requires durable queue/source-of-truth only if NewsFlux must enumerate/manage it                  |
| Saved umbrella/library         | **HOLD — ARCHITECTURE** | No coherent first-party source of truth yet                                                       |
| Bookmarks                      | **HOLD — ARCHITECTURE** | Reject if semantically identical to starred; otherwise requires storage                           |
| Boards / collections           | **HOLD — ARCHITECTURE** | Requires ownership/privacy/export decisions                                                       |
| Tags                           | **HOLD — ARCHITECTURE** | Separate decision; do not infer from provider feed rules                                          |
| Smart folders / saved searches | **HOLD — ARCHITECTURE** | Depends on FILTER-01 and saved-filter storage decision                                            |
| Per-feed layout                | **HOLD — ARCHITECTURE** | Decide source/sync after NAV-02F                                                                  |
| Swipe-save                     | **HOLD — ARCHITECTURE** | Target and Fold gesture semantics must be explicit                                                |

### 3.11 Provider-backed capability inventory

The following opportunities do not require new persistent NewsFlux state:

| Item                           | Source of truth                                    | Current capability / gap                                                                               | Roadmap handling                                                                                                |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| BULK-03 range/age mark-as-read | Miniflux read state                                | Existing batch-ID mutation + Undo primitives; range semantics are new                                  | **IN PROGRESS**; BULK-03A above/below completed in #43; remaining range/age work stays before/alongside BULK-02 |
| FEED-HEALTH-01                 | Miniflux feed metadata                             | 01A surfaces parsing-error information in the Sidebar; detailed 01B message/checked/Retry flow remains | **IN PROGRESS**; 01A completed in #40, follow-up near NAV-02F                                                   |
| FILTER-RULES-01                | Miniflux feed `blocklist_rules` / `keeplist_rules` | Provider supports the fields; NewsFlux does not expose the editing contract                            | **PLANNED** after FILTER-01                                                                                     |
| HOME-VISUAL-02                 | Miniflux categories + existing Home data           | Deterministic editorial grouping; no new ranking state                                                 | **HOLD — PRODUCT** pending editorial decision                                                                   |
| SAVE-EXT-01                    | Miniflux third-party integrations                  | Existing one-way provider action; NewsFlux cannot enumerate destination items back                     | **PLANNED** as external handoff, not internal Read Later                                                        |

---

## 4. Red-team R2 accepted findings and disposition

P1 findings:

1. **R2-01 / BULK-01B** — **COMPLETED** in PR #30.
2. **R2-02 / FILTER-01A** — **COMPLETED** in PR #37; source-scoped search/reset behavior is frozen.
3. **R2-03 / A11Y-01** — **COMPLETED** in PR #34; exact merge-SHA production promotion and authenticated post-merge smoke passed.

P2 disposition:

- R2-04 reduced-transparency dark-mode specificity — **COMPLETED** in PR #23.
- R2-05 layered Escape — **OPEN** as READER-KEY-01.
- R2-06 dead entry route — **OPEN** as STATE-ERR-01.
- R2-07 untitled entry fallback — **OPEN** as CONTENT-01.
- R2-08 mark-all focus return — **COMPLETED** in PR #27.
- R2-09 scoped undo wording — **PLANNED** as BULK-01C.
- R2-10 runtime identity — **COMPLETED** as ID-RUNTIME-01 / PR #32; exact merge-SHA deployment and post-merge browser smoke passed.
- R2-11 touch target size — **PLANNED** under keyboard/touch parity.
- R2-12 Home refresh — **PLANNED** as HOME-01.
- R2-13 source-name truncation — partially improved in article Column via #28; navigation-specific source-name work remains NAV-02F.
- R2-14 next-unread flow — **PLANNED** as NAV01.
- R2-15 reader edge-to-edge media — **PLANNED** as READER-MEDIA-01.
- R2-16 category keyboard tab-stop — re-check before fixing under keyboard/touch parity.

P3 debt remains under NAV-02F and HOME-SKEL-01 rather than being fixed incidentally. READER-MEASURE-01 is complete in PR #44; READER-VISUAL-02A2 remains not started.

---

## 5. Product decisions required before implementation

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

**Status: COMPLETED** in PR #44; merged and promoted at exact SHA `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`.

The existing Article width control remains the only control. Prose uses `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)` and stays within its frame; width 75 retains the prior visual measure. Automated Reader Measure, RV01 and 02A1 regression gates, protected-surface parity, production provenance, base-image parity and exact-SHA promotion passed. Real-device validation was not executed and remains nonblocking. Header/body alignment remains probe-based until 02A2 supplies `.article-header-column`.

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

Offline reading, feed notifications, third-party AI summaries and other new persistence/server services remain outside this provider-backed exception and require explicit architecture/privacy decisions.

---

## 7. Recommended execution order from the current baseline

READER-VISUAL-02A1 is complete in PR #41, and READER-MEASURE-01 is complete in PR #44. The next engineering track is the dedicated runtime-only RUNTIME-BASE-01 / PR #38 reconciliation after this documentation PR closes. PR #38 remains open on an older base and must be reconciled against live `main` in its own scope; this documentation task does not modify, merge or deploy it. Remaining product work must be rechecked against live state when that track closes:

1. **RUNTIME-BASE-01 / PR #38 reconciliation** — next engineering track after this docs PR; candidate branch `codex/runtime-base-01` is based on `73f793f51ba3f81e04c2fbaaf3093fc6c5983078` and must be reconciled with current `main`.
2. **READER-VISUAL-02A2** — not started; follows the existing 02A1 typography foundation and READER-MEASURE-01. It must provide the real `.article-header-column` before header/body alignment can be validated against production markup.
3. **READER-KEY-01**, **STATE-ERR-01**, **CONTENT-01** — separate bugfix PRs.
4. **BULK-03 remaining scope** and **FEED-HEALTH-01B** — separate provider-backed PRs; BULK-03A and FEED-HEALTH-01A are already complete.
5. **HOME-01**, **NAV01**, **Keyboard/touch parity** — separate functional/interaction tracks.
6. **READER-MEDIA-01** — real-device gate for edge-to-edge media.
7. **FILTER-RULES-01** — after FILTER-01B, which is complete.
8. **CHROME-01 remaining subsets** — keep behavior, token styling and any glass/context consolidation isolated.
9. **BULK-02** — FILTER-01A and BULK-01B prerequisites are complete; remaining sequencing/product gates must be reviewed before authorization.
10. **NAV-02F** and **HOME-SKEL-01**.
11. **SAVE-EXT-01** after wording/placement are specified.
12. **HOME-VISUAL-02** after explicit editorial decision + HOME-01.
13. **READER-VISUAL-02B** after reduced-motion/focus contract + NAV01.
14. **NAV-VISUAL-01** after explicit adaptive-navigation decision + real-device plan.
15. **ID-DEPLOY-01** after distribution architecture decision.
16. **First-party saved-state work** only after storage/sync/privacy/source-of-truth decisions.
17. **Personalization V2**.
18. **MOTION-01** after interaction architecture stabilizes.
19. **ML ranking** last.

`BULK-01C` may be scheduled once copy is decided, but it remains separate from the completed BULK-01B implementation.

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

### HARNESS-CODEBLOCK-SSR-01

- Classification: **PREEXISTING_TEST_HARNESS_DEBT**.
- Surface: `scripts/article-code-block-controls.test.js`.
- Cause signature: Vite SSR / CommonJS named export `Select` from `@arco-design/web-react` under the current Node/container harness.
- Impact: does not invalidate ID-RUNTIME-01.
- Scope: out of ID-RUNTIME-01.
- Next: dedicated maintenance PR.

Do not fix this debt in this docs-only reconciliation.

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

## 11. Overnight-safe execution policy

An unattended/overnight development session may advance only items that satisfy all of the following:

- no unresolved product, storage, privacy or architecture decision;
- no upstream sync;
- no merge or production deployment;
- no dependence on a real-device PASS for correctness;
- each independently meaningful change receives its own branch/PR;
- tests/build/static gates can run autonomously;
- browser/harness evidence may be collected when available, but absence of a physical-device gate must leave the PR unmerged unless the owner later makes an explicit attended waiver decision;
- incidental discoveries are reported and routed back to the roadmap rather than fixed opportunistically.

Current overnight-safe candidates must be re-evaluated against the current baseline before work begins. Completed tracks such as A11Y-RT-01, BULK-01F, LIST-VISUAL-01 and BULK-01B must not be reopened merely because they were historically listed as safe candidates. Candidate work that remains low-decision includes bounded subsets such as READER-VISUAL-02A or CHROME token/copy work, but only after a fresh live-state and scope check.

The unattended agent must stop rather than guess if a candidate unexpectedly requires product semantics, touches upstream-sensitive behavior, overlaps another active PR or cannot be proven with available automated gates.

---

## 12. Governance invariants

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

## 13. Current promotion state

- `CURRENT_MAIN=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `DOCUMENTED_MAIN_BASE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `PRODUCT_BASELINE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `PRODUCTION_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `RUNTIME_PRODUCT_BASELINE_EQUALS_PRODUCTION=YES`
- `MAIN_PRODUCTION_PARITY=YES`
- `A11Y_01=COMPLETED`
- `A11Y_01_PR=34`
- `A11Y_01_APPROVED_HEAD=c62ce9160c928eedcdb09d25a1271253c8baf91c`
- `A11Y_01_MERGE_TREE=124a4e5c62649a3ffd9229ec03c490e94f6874c5`
- `A11Y_01_CANDIDATE_TREE=124a4e5c62649a3ffd9229ec03c490e94f6874c5`
- `A11Y_01_TREE_PARITY=PASS`
- `A11Y_01_EXACT_MERGE_SHA_DEPLOY=PASS`
- `A11Y_01_POST_MERGE_BROWSER_SMOKE=PASS`
- `ID_RUNTIME_01=COMPLETED`
- `ID_RUNTIME_01_PR=32`
- `ID_RUNTIME_01_APPROVED_HEAD=1237f77ff2566015ef50939e268c4ec19f66fe88`
- `ID_RUNTIME_01_MERGE_SHA=099bdcb0483ef516f6c325e67eefb41b618a4713`
- `POST_MERGE_BROWSER_SMOKE=PASS`
- `EXACT_MERGE_SHA_DEPLOY=PASS`
- `PRODUCTION_IMAGE=newsflux-local:118ecb2c63f7`
- `PRODUCTION_IMAGE_ID=sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`
- `ROLLBACK_BASELINE=newsflux-local:cfef27e50fae`
- `BULK_01B=COMPLETED`
- `PR30_REAL_DEVICE_GATE=WAIVED_BY_OWNER`
- `PR30_PHYSICAL_TOUCH_PASS=NOT_CLAIMED`
- `UPSTREAM_INTEGRATED_THROUGH=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d`
- `LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d`
- `NEXT_UPSTREAM_AUDIT_FROM=f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d`
- `LAST_COMPLETED=READER-MEASURE-01 / PR #44`
- `READER_VISUAL_02A1=COMPLETED_PR41`
- `READER_MEASURE_01=COMPLETED_MERGED_PROMOTED`
- `READER_MEASURE_01_FEATURE_HEAD=1d280c0132a3f1d0d6fae49aeb10ed20ea613bd0`
- `READER_MEASURE_01_MERGE_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `READER_MEASURE_01_FORMULA=clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)`
- `READER_MEASURE_01_AUTOMATED_GATE=PASS`
- `READER_MEASURE_01_RV01_REGRESSION=PASS`
- `READER_MEASURE_01_02A1_REGRESSION=PASS`
- `READER_MEASURE_01_PROTECTED_SURFACE_PARITY=PASS`
- `READER_MEASURE_01_DEFAULT_WIDTH_75_PARITY=PASS`
- `READER_MEASURE_01_PRODUCTION_PROVENANCE=PASS`
- `READER_MEASURE_01_NODE_CADDY_BASE_PARITY=PASS`
- `READER_MEASURE_01_REAL_DEVICE_GATE=NOT_EXECUTED_NONBLOCKING`
- `READER_VISUAL_02A2=NOT_STARTED`
- `OPEN_RUNTIME_PR=38 (RUNTIME-BASE-01; RECONCILIATION_REQUIRED)`
- `NEXT_RECOMMENDED_ACTION=RUNTIME-BASE-01 / PR #38 RECONCILIATION AFTER DOCS PR CLOSES`
- `NEXT_ENGINEERING_TRACK=RUNTIME-BASE-01 / PR #38 RECONCILIATION`
- `NEXT_AUTHORIZED_ACTION=RUNTIME-BASE-01 / PR #38 RECONCILIATION AFTER DOCS PR CLOSES`

At this reconciliation, `main` and production both resolve to `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`. This documentation PR will advance `main` without changing the product/runtime baseline or requiring deployment. Re-read live `main`, production and PR #38 before starting the next engineering track. PR #38 remains a separate runtime-only scope; this documentation update authorizes neither its merge nor production deployment.
