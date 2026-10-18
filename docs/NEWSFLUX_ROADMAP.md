# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after FILTER-RULES-01 / PR #55.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-17.
- **Reconciled against:** live `main` at `1021cd5746eba2b3b90b1a863bada9043f126be1`; no open PRs before this docs PR; OMV container `newsflux` running `newsflux-local:118ecb2c63f7` (source SHA `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`, image ID `sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`, restart count 0). Main and production are not at parity.
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

| PR  | Track                            | Status        | Notes                                                                                                                                                                                                        |
| --- | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #20 | BULK-01                          | **COMPLETED** | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo                                                                                                                          |
| #21 | ID-01R                           | **COMPLETED** | Repository/document provenance and translated README reconciliation                                                                                                                                          |
| #22 | Documentation                    | **COMPLETED** | Canonical roadmap red-team R2 reconciliation                                                                                                                                                                 |
| #23 | A11Y-RT-01                       | **COMPLETED** | Reduced-transparency dark/OLED specificity fix                                                                                                                                                               |
| #24 | LIST-VISUAL-01 / monogram subset | **COMPLETED** | Deterministic favicon monogram fallback                                                                                                                                                                      |
| #25 | CHROME-01A / DatePicker subset   | **COMPLETED** | NewsFlux token styling for DatePicker                                                                                                                                                                        |
| #26 | Upstream sync                    | **COMPLETED** | Adapted upstream article code-block experience through `3045a5f8...`                                                                                                                                         |
| #27 | BULK-01F                         | **COMPLETED** | Footer Mark All Read focus restoration                                                                                                                                                                       |
| #28 | LIST-VISUAL-01A                  | **COMPLETED** | Read-state + metadata/source hierarchy cohesion across Column/Card/List                                                                                                                                      |
| #29 | Documentation                    | **COMPLETED** | Roadmap/project-state reconciliation after PR #28 production promotion                                                                                                                                       |
| #30 | BULK-01B                         | **COMPLETED** | Sidebar Feed/Category Mark All confirmation + safe shared Undo; race hardening; exact merge-SHA deployed                                                                                                     |
| #32 | ID-RUNTIME-01                    | **COMPLETED** | Approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merged/deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed                                                     |
| #34 | A11Y-01                          | **COMPLETED** | Approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`; merged/deployed as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`; tree parity, exact-SHA promotion and authenticated post-merge smoke passed          |
| #36 | HARNESS-UNDO-ID-01               | **COMPLETED** | Feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`; merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; repaired all nine stale fixed-notice-ID assertions (29/29)                                        |
| #38 | RUNTIME-BASE-01                  | **COMPLETED** | Feature head `07237ba7e8c773e9de88e9c533296b9700dde287`; merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`; pins Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 by digest                                          |
| #39 | FILTER-01B                       | **COMPLETED** | Date/status filter transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`                                                                                                                 |
| #40 | FEED-HEALTH-01A                  | **COMPLETED** | Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`                                                                                                          |
| #41 | READER-VISUAL-02A1               | **COMPLETED** | Editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`                                                                                                                        |
| #42 | NAV-02 harness maintenance       | **COMPLETED** | Mark-All expectation aligned with current batching; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`                                                                                                     |
| #43 | BULK-03A                         | **COMPLETED** | Mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`                                                                                                                      |
| #44 | READER-MEASURE-01                | **COMPLETED** | Bounded responsive prose measure; merge and production promotion at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`                                                                                               |
| #45 | Documentation                    | **COMPLETED** | Prior post-Reader Measure reconciliation, merge `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation                                                                  |
| #46 | READER-KEY-01                    | **COMPLETED** | Feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`; merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`; layered Escape complete                                                                           |
| #47 | STATE-ERR-01                     | **COMPLETED** | Feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`; merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`; unavailable-entry 404 behavior complete                                                           |
| #48 | CONTENT-01                       | **COMPLETED** | Feature head `1032b5409298629382685a85935b85fdc2292f85`; merge `9f521edfd5f031e8e833a4854d896acc42a22fae`; deterministic untitled fallback complete                                                          |
| #49 | READER-VISUAL-02A2               | **COMPLETED** | Feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`; merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`; quiet header aligned to prose column                                                              |
| #50 | BULK-03B                         | **COMPLETED** | Feature head `dd9e68650f3f40080199b90107c2b35722166697`; merge `a8dbe15497f7d526298f223188955b82589a84a4`; 1/7/30-day age presets, strict cutoff, full discovery, scoped writes, acknowledged-only Undo      |
| #51 | Documentation                    | **COMPLETED** | Project-state and roadmap reconciliation after BULK-03B; merge `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`                                                                                                    |
| #52 | FEED-HEALTH-01B                  | **COMPLETED** | Feature head `1b03865311993f7e72df0632ea662bbe94e926e9`; merge `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`; provider-backed details/Retry and one final metadata reconciliation after bulk refresh            |
| #53 | Selective upstream maintenance   | **COMPLETED** | Feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`; merge `046cd647c65583cdfdc7ab282701be79d4b34294`; pnpm hardening integrated, setup-node pin adapted                                                 |
| #55 | FILTER-RULES-01                  | **COMPLETED** | Feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`; merge/current main `1021cd5746eba2b3b90b1a863bada9043f126be1`; provider-backed per-feed raw Miniflux block/keep rules, no NewsFlux rule persistence |

### 3.3 Functional behavior and defect tracks

| Item                                       | Status                      | Priority / dependency                                                        | Notes                                                                                                                                                                        |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BULK-01 — Footer Mark All Read Undo        | **COMPLETED**               | PR #20                                                                       | One-shot 8 s undo; repeated-operation behavior validated                                                                                                                     |
| BULK-01F — footer focus return             | **COMPLETED**               | PR #27                                                                       | Focus returns deterministically without stale-list refocus                                                                                                                   |
| BULK-01B — Sidebar context Mark All        | **COMPLETED**               | PR #30, R2-01                                                                | Feed/Category confirmation + acknowledged-ID Undo; shared Mark-All/Undo coordinator; no Sidebar jump; physical touch gate waived by owner, physical PASS not claimed         |
| BULK-01C — scoped undo copy                | **PLANNED**                 | R2-09, product copy decision                                                 | Name affected scope/count; remain separate from BULK-01B                                                                                                                     |
| BULK-03 — range/age mark-as-read           | **COMPLETED**               | PRs #43 and #50                                                              | Above/below actions plus 1/7/30-day presets; full scoped discovery before mutation, strict `published_at` cutoff, acknowledged-only Undo, and shared Today time snapshot     |
| FILTER-01A — search scope rules            | **COMPLETED**               | PR #37; merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078`                 | Search is source-scoped; changing source clears it, same-scope reader return/refresh/pagination preserve it; no global search or new persistence                             |
| FILTER-01B — date/status filter behavior   | **COMPLETED**               | PR #39                                                                       | Date/status transitions and scoped search behavior; merged before the Reader Measure production baseline                                                                     |
| FILTER-RULES-01                            | **COMPLETED**               | PR #55; merged as `1021cd5746eba2b3b90b1a863bada9043f126be1`                 | Provider-backed per-feed raw Miniflux `blocklist_rules` / `keeplist_rules`; no NewsFlux rule persistence                                                                     |
| BULK-02 — Multi-select                     | **NEXT — DISCOVERY/DESIGN** | Next engineering track; discovery/design only, implementation not authorized | Visible/session selection only; mark selected read; Undo always                                                                                                              |
| READER-KEY-01 — layered Escape             | **COMPLETED**               | PR #46                                                                       | Escape closes the topmost menu/popover before the reader                                                                                                                     |
| STATE-ERR-01 — unavailable entry route     | **COMPLETED**               | PR #47                                                                       | Unavailable entry routes present the explicit 404 behavior                                                                                                                   |
| CONTENT-01 — untitled entry fallback       | **COMPLETED**               | PR #48                                                                       | Deterministic accessible untitled-entry fallback; unread cue remains non-empty                                                                                               |
| HOME-01 — refresh/focus/reconnect          | **PLANNED**                 | R2-12                                                                        | Refresh must not unexpectedly reshuffle an active Phase 2D session                                                                                                           |
| NAV01 — reader previous/next + next unread | **PLANNED**                 | R2-14                                                                        | Preserve canonical originating-scope order and next-unread-source flow                                                                                                       |
| NAV-02F — navigation follow-ups            | **PLANNED**                 | R2-13/R2-17/R2-18                                                            | Long source names, unread grouping/mode persistence decisions, and human-readable unread labels                                                                              |
| FEED-HEALTH-01                             | **COMPLETED**               | 01A / PR #40 and 01B / PR #52 complete                                       | Provider-owned error details, checked time and failure count; disabled feeds remain suppressed; Retry is provider-backed; bulk refresh has one final metadata reconciliation |

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

| Package           | Status             | Scope / remainder                                                                                                                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST-VISUAL-01    | **COMPLETED**      | Monogram fallback (#24) + read-state/source/metadata cohesion (#28). Human-readable unread-count labels were rehomed to NAV-02F. No thumbnail redesign is authorized by this completion. |
| CHROME-01         | **PLANNED**        | DatePicker token subset completed in #25; verb-first confirmations, snackbar placement and remaining raw-Arco styling remain separate scoped work                                        |
| HOME-VISUAL-02    | **HOLD — PRODUCT** | Edition/category composition requires explicit editorial decision and HOME-01 dependency resolution                                                                                      |
| READER-VISUAL-02A | **COMPLETED**      | 02A1 in PR #41, Reader Measure in PR #44, and 02A2 / Quiet Column in PR #49; real header/prose alignment validated on the production element                                             |
| READER-VISUAL-02B | **PLANNED**        | Auto-hide + Next only after interaction/NAV dependencies                                                                                                                                 |
| NAV-VISUAL-01     | **HOLD — PRODUCT** | Adaptive bottom bar/rail/drawer requires explicit decision + real Fold gate                                                                                                              |
| READER-COVER-01   | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                        |
| READER-FONT-01    | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                        |
| HARNESS-VIS-01    | **BACKLOG**        | Test debt; not ordered                                                                                                                                                                   |
| TEST-ENV-01       | **BACKLOG**        | Verification required; not ordered                                                                                                                                                       |
| MOTION-01         | **BACKLOG**        | View Transition/container transform after main interaction architecture stabilizes                                                                                                       |

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
| Last formally reviewed upstream      | **BASELINE** | `ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036`                                               |
| Last linear integrated upstream      | **BASELINE** | `3045a5f8f69ffd7f571f73540031efa8b4ff6e6d` via PR #26 article-code-block adaptation      |
| Next upstream audit                  | **PLANNED**  | Specialized monitor must live-check upstream and review only commits after `ed0be6db...` |

Upstream audit classification remains `INTEGRATE / ADAPT / SKIP / HOLD`. PR #53 used selective, non-linear maintenance: `e46d92ab64adcbd0bb8ac2caf6048fa37f527939` was integrated as `allowBuilds.plyr=false` in `pnpm-workspace.yaml`; `0c28762de6987c980306b8553753e549e753b4e0` was adapted by changing only `actions/setup-node` from 7.0.0 to 7.1.0 in five equivalent workflows while preserving NewsFlux customizations. The formal review frontier does not advance the last linear integration baseline, and HOLD commits are not claimed as integrated.

Explicit HOLDs from the reviewed range:

- `4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe` — Vite 8.3.1 to 8.3.4; bundler/tooling and lockfile/Rolldown churn, harness sensitivity; requires a dedicated regression gate.
- `ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036` — Framer Motion 14.0.0 to 14.2.0; production motion dependency; requires dedicated visual/motion regression coverage.

These HOLDs are not immediate planned upgrades or implementation authorization.

#### Dependency updates from the reviewed range

These dependency updates are classified separately from the selectively integrated and adapted changes above. Classification does not authorize an upgrade PR.

| Classification                | Commit                                     | Package transition                          | Disposition                                                                                          |
| ----------------------------- | ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **MAINTENANCE_CANDIDATE**     | `09c24d35c788ab636b2871879bfa1a8ffb14780d` | `@types/node` 26.6.4 to 26.6.5              | No urgency; consider with a future low-risk grouped dependency-maintenance window.                   |
| **MAINTENANCE_CANDIDATE**     | `c3a023c1`                                 | `lefthook` 2.2.0 to 2.2.2                   | No urgency; consider with a future low-risk grouped dependency-maintenance window.                   |
| **MAINTENANCE_CANDIDATE**     | `6fa26be8`                                 | `prettier` 3.9.9 to 3.9.10                  | No urgency; consider with a future low-risk grouped dependency-maintenance window.                   |
| **MAINTENANCE_CANDIDATE**     | `f1d6e4362aeaf7c5126cdb9dc0b041dd0dc8cb7d` | `postcss` 8.5.29 to 8.5.30                  | No urgency; consider with a future low-risk grouped dependency-maintenance window.                   |
| **HOLD_TOOLCHAIN**            | `a0b232f4`                                 | `@vitejs/plugin-react` 6.1.1 to 6.1.2       | Same toolchain/build surface as Vite; use a dedicated gate and do not separate the plugin from Vite. |
| **HOLD_TOOLCHAIN**            | `4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe` | `vite` 8.3.1 to 8.3.4                       | Same toolchain/build surface as plugin-react; use a dedicated gate and do not split the pair.        |
| **HOLD_PRESENTATION**         | `19bb464c`                                 | `@arco-design/web-react` 2.66.16 to 2.66.18 | Drawer, Modal and Popover are affected; require visual and interaction regression coverage.          |
| **HOLD_PRESENTATION**         | `ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036` | `framer-motion` 14.0.0 to 14.2.0            | Runtime presentation/motion dependency; require visual and interaction regression coverage.          |
| **HOLD_UNTIL_RELEVANT_TRACK** | `fc09d0d5`                                 | `plyr` 3.8.4 to 3.8.5                       | Reassess with READER-MEDIA-01; do not treat as a next PR.                                            |
| **HOLD_UNTIL_RELEVANT_TRACK** | `30e034a3`                                 | `react-syntax-highlighter` 16.1.1 to 16.1.2 | Reassess with article/code-block maintenance; do not treat as a next PR.                             |

The four maintenance candidates have no urgency and may be evaluated together later. The toolchain pair and presentation dependencies remain held; no upgrade is authorized here.

### 3.9 Personalization and explicit rules

| Item                                           | Status                  | Notes                                                                       |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Phase 2D V1 deterministic Home personalization | **COMPLETED**           | Home-only; All/Unread remain predictable                                    |
| FILTER-RULES-01                                | **COMPLETED**           | PR #55; explicit per-feed Miniflux-backed rules, no NewsFlux persistence    |
| Phase 2D V2 signal expansion                   | **PLANNED**             | Deterministic signals only until architecture is proven                     |
| Story clustering                               | **HOLD — ARCHITECTURE** | After Personalization V2; Home-only and opt-in if adopted                   |
| User-controlled learned relevance              | **HOLD — ARCHITECTURE** | Requires separate source-of-truth/privacy decision                          |
| ML ranking                                     | **HOLD — ARCHITECTURE** | Last, after deterministic behavior/privacy/explainability/storage decisions |

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

| Item                           | Source of truth                                    | Current capability / gap                                                                                                                                                                                                                                                                   | Roadmap handling                                         |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| BULK-03 range/age mark-as-read | Miniflux read state                                | Above/below and 1/7/30-day range/age actions; strict `published_at` cutoff, scoped discovery/writes, and acknowledged-only Undo                                                                                                                                                            | **COMPLETED** in PRs #43 and #50                         |
| FEED-HEALTH-01                 | Miniflux feed metadata                             | 01A compact error indicator and 01B provider-backed details/checked time/Retry are complete in #40/#52; bulk refresh performs one final metadata reconciliation                                                                                                                            | **COMPLETED**                                            |
| FILTER-RULES-01                | Miniflux feed `blocklist_rules` / `keeplist_rules` | Provider-backed per-feed raw editor; Miniflux source of truth, exact raw round-trip, explicit empty clears, absent fields preserve values, provider response authoritative; no NewsFlux rule database. Filter-rule saves disclose provider error reset; success does not imply feed health | **COMPLETED** in PR #55                                  |
| HOME-VISUAL-02                 | Miniflux categories + existing Home data           | Deterministic editorial grouping; no new ranking state                                                                                                                                                                                                                                     | **HOLD — PRODUCT** pending editorial decision            |
| SAVE-EXT-01                    | Miniflux third-party integrations                  | Existing one-way provider action; NewsFlux cannot enumerate destination items back                                                                                                                                                                                                         | **PLANNED** as external handoff, not internal Read Later |

---

## 4. Red-team R2 accepted findings and disposition

P1 findings:

1. **R2-01 / BULK-01B** — **COMPLETED** in PR #30.
2. **R2-02 / FILTER-01A** — **COMPLETED** in PR #37; source-scoped search/reset behavior is frozen.
3. **R2-03 / A11Y-01** — **COMPLETED** in PR #34; exact merge-SHA production promotion and authenticated post-merge smoke passed.

P2 disposition:

- R2-04 reduced-transparency dark-mode specificity — **COMPLETED** in PR #23.
- R2-05 layered Escape — **COMPLETED** as READER-KEY-01 / PR #46.
- R2-06 dead entry route — **COMPLETED** as STATE-ERR-01 / PR #47.
- R2-07 untitled entry fallback — **COMPLETED** as CONTENT-01 / PR #48.
- R2-08 mark-all focus return — **COMPLETED** in PR #27.
- R2-09 scoped undo wording — **PLANNED** as BULK-01C.
- R2-10 runtime identity — **COMPLETED** as ID-RUNTIME-01 / PR #32; exact merge-SHA deployment and post-merge browser smoke passed.
- R2-11 touch target size — **PLANNED** under keyboard/touch parity.
- R2-12 Home refresh — **PLANNED** as HOME-01.
- R2-13 source-name truncation — partially improved in article Column via #28; navigation-specific source-name work remains NAV-02F.
- R2-14 next-unread flow — **PLANNED** as NAV01.
- R2-15 reader edge-to-edge media — **PLANNED** as READER-MEDIA-01.
- R2-16 category keyboard tab-stop — re-check before fixing under keyboard/touch parity.

P3 debt remains under NAV-02F and HOME-SKEL-01 rather than being fixed incidentally. READER-VISUAL-02A, including 02A2 / Quiet Column, is complete in PR #49.

---

## 5. Product decisions required before implementation

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

The existing Article width control remains the only control. Prose uses `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)` and stays within its frame; width 75 retains the prior visual measure. Automated Reader Measure, RV01 and 02A1 regression gates, protected-surface parity, production provenance, base-image parity and exact-SHA promotion passed. Real-device validation was not executed and remains nonblocking. PR #49 later completed the separate 02A2 real-element header/body alignment gate.

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

FEED-HEALTH-01 is complete in PRs #40 and #52, and FILTER-RULES-01 was completed in PR #55. The next engineering track is BULK-02 discovery and bounded design only. The known contract is visible/session multi-select, mark selected articles as read, and keep Undo always available; detailed design and gates must be agreed before implementation. PRs #38, #46–#50, #52, #53 and #55 are complete and removed from the remaining order.

1. **BULK-02 discovery/design** — preserve visible/session multi-select, mark selected read, and always-available Undo; stop before implementation authorization.
2. **HOME-01** — refresh/focus/reconnect semantics.
3. **NAV01** — reader previous/next and next unread source flow.
4. **Keyboard/touch parity** — preserve accessible focus and touch targets.
5. **READER-MEDIA-01** — edge-to-edge media; real-device gate remains required.
6. **CHROME-01 remaining subsets** — keep behavior, token styling, and glass/context consolidation isolated.
7. **NAV-02F** and **HOME-SKEL-01**.
8. **SAVE-EXT-01** after wording and placement are specified.
9. **HOME-VISUAL-02** after explicit editorial decision and HOME-01.
10. **READER-VISUAL-02B** after reduced-motion/focus contract and NAV01.
11. **NAV-VISUAL-01** after explicit adaptive-navigation decision and real-device plan.
12. **ID-DEPLOY-01** after distribution architecture decision.
13. **First-party saved-state work** only after storage/sync/privacy/source-of-truth decisions.
14. **Personalization V2**.
15. **MOTION-01** after interaction architecture stabilizes.
16. **ML ranking** last.

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

## 9. Known test debt and incidental findings

- `HARNESS-UNDO-ID-01` was resolved by test-maintenance PR #36 (feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`, merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`); its focused list regression passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is no longer open: PR #38 reports `CODEBLOCK_SSR_GATE=PASS` within the full Node suite on both main and candidate.
- The React 19 `element.ref` warning remains an incidental harness warning. Classify it as non-blocking backlog; no fix is claimed in this reconciliation.

Do not fix incidental findings in unrelated work.

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

## 13. Current main and production state

Live snapshot checked on 2026-10-17, immediately after PR #55 merged and before this docs-only PR:

- `CURRENT_MAIN=1021cd5746eba2b3b90b1a863bada9043f126be1`
- `DOCUMENTED_MAIN_BASE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1`
- `PRODUCT_BASELINE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1`
- `PRODUCTION_CONTAINER=newsflux`
- `PRODUCTION_CONTAINER_ID=5c1882d2792a48a894c0806231bbb371f97b60d49b6922f5b9218a1c905bf8ef`
- `PRODUCTION_CONTAINER_STATUS=running` (read-only SSH inspection)
- `PRODUCTION_RESTART_COUNT=0`
- `PRODUCTION_IMAGE=newsflux-local:118ecb2c63f7`
- `PRODUCTION_SHA=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1` (image tag prefix resolved to this exact GitHub commit)
- `PRODUCTION_IMAGE_ID=sha256:a8c7e764d0cf5ef333da113fc9e46a15dde043297a9b65122498aebba4d65499`
- `PRODUCTION_REVISION_LABEL=118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `PRODUCTION_SOURCE_LABEL=https://github.com/jfsdias/NewsFlux`
- `MAIN_PRODUCTION_PARITY=NO`
- `RUNTIME_PRODUCT_BASELINE_EQUALS_PRODUCTION=NO`
- `PR38=MERGED (1af58a53c6fd85bcca95ec44a56e23c7c02b6145); not a current open PR`
- `PR45=MERGED (c062a4ee9f7967ef254fde2cb2ed1ca2207735e9); prior documentation reconciliation, superseded by later updates`
- `PR46=MERGED (3e21cbb197efbca0b577e06c705a1ef9997cb597)`
- `PR47=MERGED (e59295501cc51a6df2b64a435c0c32eb5431aed5)`
- `PR48=MERGED (9f521edfd5f031e8e833a4854d896acc42a22fae)`
- `PR49=MERGED (e4752d290bdfb4961d379dd05548ef3da5da42ba)`
- `PR50=MERGED (a8dbe15497f7d526298f223188955b82589a84a4)`
- `PR51=MERGED (0d3b1e9648d59018cdd1f9f17948c7d34b19924b)`
- `PR52=MERGED (051e461d1d1eb4408e15a0ebcd4e1331b546de7a)`
- `PR53=MERGED (046cd647c65583cdfdc7ab282701be79d4b34294)`
- `PR55=MERGED (1021cd5746eba2b3b90b1a863bada9043f126be1)`
- `OPEN_PRS_BEFORE_THIS_DOCS_PR=0`
- `LAST_COMPLETED_FEATURE=FILTER-RULES-01 / PR #55`
- `LAST_COMPLETED_MAINTENANCE=SELECTIVE_UPSTREAM_SYNC / PR #53`
- `LAST_KNOWN_PRODUCTION_PROMOTION=READER-MEASURE-01 / PR #44 / 118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`
- `PRODUCTION_CHANGED_BY_PR52=NO`
- `PRODUCTION_CHANGED_BY_PR53=NO`
- `PRODUCTION_CHANGED_BY_PR55=NO`
- `UPSTREAM_INTEGRATION_MODE=SELECTIVE_NON_LINEAR`
- `UPSTREAM_CURRENT_HEAD=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036`
- `UPSTREAM_UNREVIEWED_CHANGES=NO`
- `LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036`
- `LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d` (last linear baseline)
- `SELECTIVELY_INTEGRATED=e46d92ab64adcbd0bb8ac2caf6048fa37f527939`
- `SELECTIVELY_ADAPTED=0c28762de6987c980306b8553753e549e753b4e0`
- `NEXT_UPSTREAM_AUDIT_FROM=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036`
- `HOLD=4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe (Vite 8.3.1 to 8.3.4; dedicated bundler/lockfile/harness regression gate required)`
- `HOLD=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036 (Framer Motion 14.0.0 to 14.2.0; dedicated production visual/motion regression gate required)`
- `READER_VISUAL_02A=COMPLETED (02A1 + Measure + 02A2 / Quiet Column)`
- `BULK_03=COMPLETED (03A + 03B)`
- `FEED_HEALTH_01_STATUS=COMPLETED`
- `CURRENT_PHASE=POST_FILTER_RULES_01`
- `CURRENT_TRACK=BULK_02_DISCOVERY_DESIGN`
- `CURRENT_PRODUCT_PR=NONE`
- `OPEN_RUNTIME_PR=NONE`
- `NEXT_ENGINEERING_TRACK=BULK-02`
- `BULK_02_STATUS=NEXT — DISCOVERY/DESIGN`
- `NEXT_RECOMMENDED_ACTION=BULK_02_READ_ONLY_DISCOVERY_AND_BOUNDED_DESIGN`
- `NEXT_AUTHORIZED_ACTION=DISCOVERY_AND_DESIGN_ONLY`
- `BULK_02_IMPLEMENTATION_AUTHORIZED=NO`
- `IMPLEMENTATION_AUTHORIZED=NO`
- `FILTER_RULES_01_STATUS=COMPLETED`
- `FILTER_RULES_01_PR=55`
- `FILTER_RULES_01_FEATURE_HEAD=5b6abe28ae5e6b52f02461c4e3601165056900b1`
- `FILTER_RULES_01_MERGE_SHA=1021cd5746eba2b3b90b1a863bada9043f126be1`
- `FEED_ERROR_RESET_DECISION=ACCEPT_PROVIDER_BEHAVIOR_WITH_EXPLICIT_DISCLOSURE`
- `PRODUCTION_CHANGED_BY_PR55=NO`
- `DEPLOY_PERFORMED=NO`
- `MERGE_AUTHORIZED=NO`

Production was inspected live over read-only SSH on 2026-10-17; container identity, running status, image tag and provenance labels were confirmed. Application HTTP health was not rechecked in this reconciliation. PR #52, #53 and #55 were merged without production promotion; current main is ahead of production. No production files, containers, images or routes were changed. Recheck production identity and application health before any future deployment decision.
