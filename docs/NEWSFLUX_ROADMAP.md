# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after the PR #72 docs-only merge, with GitHub main and product/production baselines recorded separately.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-20.
- **Reconciled against:** GitHub `main` at `32244fa07b57c8bb3f5682f27b4d94917384ce63`; product and production at `d01e34fc2eb76da39467d1de9799b12194faec9c`. PR #72 is a docs-only merge and did not require deployment. PR #71 remains the exact product/production baseline; PR #62 is merged; PR #70 remains open/draft on stale base `cf37807a4d3b9da39d3c438861fac358d936fdaa`. Production image `newsflux-local:d01e34fc2eb7` (source SHA `d01e34fc2eb76da39467d1de9799b12194faec9c`, image ID `sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c`, HTTP 200, running, restart count 0). Product and production remain at parity; raw GitHub main/production SHA equality is not expected after the docs-only PR #72 merge.
- **Purpose:** preserve completed work, accepted findings, sequencing, architecture/product gates, upstream baseline, and the next recommended action without turning the roadmap into implementation authorization.

This document is the canonical **roadmap**, not an implementation authorization. Detailed design decisions remain in the dedicated design documents and implementation plans remain in `docs/superpowers/plans/` where present.

No roadmap item may bypass project governance: one identifiable purpose per PR; no merge without explicit user authorization; no blind upstream sync; upstream sync, redesign and functional changes stay isolated; incidental findings are reported, classified and routed to backlog; no new persistent NewsFlux state without an explicit architecture decision; and no incidental scope expansion.

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
- **PLANNED WITH PRODUCT DECISION:** HOME-VISUAL-02 composition and contextual chrome consolidation. NAV-VISUAL-01 has an approved design contract; PR0 and PR1 are complete, while later slices and their real-device gates remain pending.
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

### 3.2 Recent PR history (completed and active)

| PR  | Track                            | Status           | Notes                                                                                                                                                                                                   |
| --- | -------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20 | BULK-01                          | **COMPLETED**    | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo                                                                                                                     |
| #21 | ID-01R                           | **COMPLETED**    | Repository/document provenance and translated README reconciliation                                                                                                                                     |
| #22 | Documentation                    | **COMPLETED**    | Canonical roadmap red-team R2 reconciliation                                                                                                                                                            |
| #23 | A11Y-RT-01                       | **COMPLETED**    | Reduced-transparency dark/OLED specificity fix                                                                                                                                                          |
| #24 | LIST-VISUAL-01 / monogram subset | **COMPLETED**    | Deterministic favicon monogram fallback                                                                                                                                                                 |
| #25 | CHROME-01A / DatePicker subset   | **COMPLETED**    | NewsFlux token styling for DatePicker                                                                                                                                                                   |
| #26 | Upstream sync                    | **COMPLETED**    | Adapted upstream article code-block experience through `3045a5f8...`                                                                                                                                    |
| #27 | BULK-01F                         | **COMPLETED**    | Footer Mark All Read focus restoration                                                                                                                                                                  |
| #28 | LIST-VISUAL-01A                  | **COMPLETED**    | Read-state + metadata/source hierarchy cohesion across Column/Card/List                                                                                                                                 |
| #29 | Documentation                    | **COMPLETED**    | Roadmap/project-state reconciliation after PR #28 production promotion                                                                                                                                  |
| #30 | BULK-01B                         | **COMPLETED**    | Sidebar Feed/Category Mark All confirmation + safe shared Undo; race hardening; exact merge-SHA deployed                                                                                                |
| #32 | ID-RUNTIME-01                    | **COMPLETED**    | Approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merged/deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed                                                |
| #34 | A11Y-01                          | **COMPLETED**    | Approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`; merged/deployed as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`; tree parity, exact-SHA promotion and authenticated post-merge smoke passed     |
| #36 | HARNESS-UNDO-ID-01               | **COMPLETED**    | Feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`; merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; repaired all nine stale fixed-notice-ID assertions (29/29)                                   |
| #38 | RUNTIME-BASE-01                  | **COMPLETED**    | Feature head `07237ba7e8c773e9de88e9c533296b9700dde287`; merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`; pins Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 by digest                                     |
| #39 | FILTER-01B                       | **COMPLETED**    | Date/status filter transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`                                                                                                            |
| #40 | FEED-HEALTH-01A                  | **COMPLETED**    | Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`                                                                                                     |
| #41 | READER-VISUAL-02A1               | **COMPLETED**    | Editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`                                                                                                                   |
| #42 | NAV-02 harness maintenance       | **COMPLETED**    | Mark-All expectation aligned with current batching; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`                                                                                                |
| #43 | BULK-03A                         | **COMPLETED**    | Mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`                                                                                                                 |
| #44 | READER-MEASURE-01                | **COMPLETED**    | Bounded responsive prose measure; merge and production promotion at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`                                                                                          |
| #45 | Documentation                    | **COMPLETED**    | Prior post-Reader Measure reconciliation, merge `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation                                                             |
| #46 | READER-KEY-01                    | **COMPLETED**    | Feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`; merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`; layered Escape complete                                                                      |
| #47 | STATE-ERR-01                     | **COMPLETED**    | Feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`; merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`; unavailable-entry 404 behavior complete                                                      |
| #48 | CONTENT-01                       | **COMPLETED**    | Feature head `1032b5409298629382685a85935b85fdc2292f85`; merge `9f521edfd5f031e8e833a4854d896acc42a22fae`; deterministic untitled fallback complete                                                     |
| #49 | READER-VISUAL-02A2               | **COMPLETED**    | Feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`; merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`; quiet header aligned to prose column                                                         |
| #50 | BULK-03B                         | **COMPLETED**    | Feature head `dd9e68650f3f40080199b90107c2b35722166697`; merge `a8dbe15497f7d526298f223188955b82589a84a4`; 1/7/30-day age presets, strict cutoff, full discovery, scoped writes, acknowledged-only Undo |
| #51 | Documentation                    | **COMPLETED**    | Project-state and roadmap reconciliation after BULK-03B; merge `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`                                                                                               |
| #52 | FEED-HEALTH-01B                  | **COMPLETED**    | Feature head `1b03865311993f7e72df0632ea662bbe94e926e9`; merge `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`; provider-backed details/Retry and one final metadata reconciliation after bulk refresh       |
| #53 | Selective upstream maintenance   | **COMPLETED**    | Feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`; merge `046cd647c65583cdfdc7ab282701be79d4b34294`; pnpm hardening integrated, setup-node pin adapted                                            |
| #55 | FILTER-RULES-01                  | **COMPLETED**    | Feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`; merge `1021cd5746eba2b3b90b1a863bada9043f126be1`; provider-backed per-feed raw Miniflux block/keep rules, no NewsFlux rule persistence         |
| #57 | BULK-02                          | **COMPLETED**    | Session multi-select; merge `85b9590bbc9f4d3488fd30694b0b45553fefda5b`                                                                                                                                  |
| #58 | MARK-ALL-REFRESH-01              | **COMPLETED**    | Suppresses transient empty state during the next-unread jump; merge `df4bea4dde5cca86a4b822d2e82f01156bb96f1a`; Undo-after-jump concern later investigated with no current defect reproduced            |
| #59 | HOME-01                          | **COMPLETED**    | Refresh, focus, reconnect and editorial-session continuity; merge `114eed13c5f66cd57a4448ece935de6cb5f4a11e`                                                                                            |
| #60 | NAV01                            | **COMPLETED**    | Canonical reader previous/next and next-unread continuity; merge `31c95ff835da3e716acfd6eb115db5c3b68dd71c`                                                                                             |
| #61 | INPUT-01a                        | **COMPLETED**    | Shared reader-command ownership; head `e2cbab710f00eb84c77b3df4ddc9701839a677d9`, merge `194a1db007902411abe91459b45a19b10c76e701`                                                                      |
| #62 | Documentation                    | **COMPLETED**    | Post-PR65 reconciliation; merged as `389ed58731c38ffff8ceda0d0347222336960f3a`                                                                                                                          |
| #63 | ABOUT-RUNTIME-REVISION-01        | **COMPLETED**    | Feature head `9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8`; merge `723bdbb96e4445d267b443422a0be7a83e5b4f8a`; exact build identity, live About validation and production promotion passed                  |
| #64 | INPUT-PARITY-ESCAPE-FOCUS        | **COMPLETED**    | Feature head `ee412912ad43d4902459b12151bad81c570d58cf`; merge `23474d3f83c01c4355c892f46c77d2f66b046af0`; FooterPanel Escape/focus live canary passed at 390×844, 884×1104 and 1280×800                |
| #65 | ABOUT-ACCESSIBLE-BRAND-01        | **COMPLETED**    | Feature head `8a4d1cf358d39524e95027b13e10c0205b9aea27`; merge `405e9d7b1a3097dacef50c7908abf83d480d64dd`; six-locale accessible NewsFlux GitHub label correction; exact merge-SHA promotion passed     |
| #66 | Mark All cold-loaded All         | **COMPLETED**    | Feature head `1b6449597179ab3c832d0c658048d46f8bddda93`; merge `0553119de95ab5b9c2e131bbb4b2ef1d0ef58456`; current-list identity and filtered unread total reconciliation                               |
| #67 | INPUT-PARITY-TOUCH-TARGET-01     | **COMPLETED**    | Feature head `ec15233215043d6a054cb6fb5eb43eebe8b1442e`; merge `7b6e474fcd50bb891e429a632849da371e126590`; interaction targets corrected with inert gaps preserved                                      |
| #68 | Harness maintenance              | **COMPLETED**    | Feature head `104671b51f99d0ad7c33d3514f8d4b2ad3558aee`; merge `b6b814c77160c2e61dedc7c10958f0712f59d728`; stale provider/button assumptions corrected                                                  |
| #69 | NAV-VISUAL PR0                   | **COMPLETED**    | Feature head `b550634066ed129e4bb0e9b3ca18842469cb493e`; merge `cf37807a4d3b9da39d3c438861fac358d936fdaa`; window-class foundation                                                                      |
| #70 | READER-MEDIA-01A                 | **OPEN / DRAFT** | Head `0cda102f4e57e2beddfec8d4517fd9b8b4893fb2` on stale base `cf37807a4d3b9da39d3c438861fac358d936fdaa`; next functional candidate, refresh required                                                   |
| #71 | NAV-VISUAL PR1                   | **COMPLETED**    | Feature head `4712b3e49c94f560c0e83ce7c8519eb6bda9cba0`; merge and product/production promotion `d01e34fc2eb76da39467d1de9799b12194faec9c`; compact navigation and Reader/Drawer focus/resize hardening |
| #72 | Documentation                    | **COMPLETED**    | Post-PR71 state reconciliation; docs-only merge `32244fa07b57c8bb3f5682f27b4d94917384ce63`; no deployment required                                                                                      |

### 3.3 Functional behavior and defect tracks

| Item                                         | Status        | Priority / dependency                                        | Notes                                                                                                                                                                        |
| -------------------------------------------- | ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BULK-01 — Footer Mark All Read Undo          | **COMPLETED** | PR #20                                                       | One-shot 8 s undo; repeated-operation behavior validated                                                                                                                     |
| BULK-01F — footer focus return               | **COMPLETED** | PR #27                                                       | Focus returns deterministically without stale-list refocus                                                                                                                   |
| BULK-01B — Sidebar context Mark All          | **COMPLETED** | PR #30, R2-01                                                | Feed/Category confirmation + acknowledged-ID Undo; shared Mark-All/Undo coordinator; no Sidebar jump; physical touch gate waived by owner, physical PASS not claimed         |
| BULK-01C — scoped undo copy                  | **PLANNED**   | R2-09, product copy decision                                 | Name affected scope/count; remain separate from BULK-01B                                                                                                                     |
| BULK-03 — range/age mark-as-read             | **COMPLETED** | PRs #43 and #50                                              | Above/below actions plus 1/7/30-day presets; full scoped discovery before mutation, strict `published_at` cutoff, acknowledged-only Undo, and shared Today time snapshot     |
| FILTER-01A — search scope rules              | **COMPLETED** | PR #37; merged as `73f793f51ba3f81e04c2fbaaf3093fc6c5983078` | Search is source-scoped; changing source clears it, same-scope reader return/refresh/pagination preserve it; no global search or new persistence                             |
| FILTER-01B — date/status filter behavior     | **COMPLETED** | PR #39                                                       | Date/status transitions and scoped search behavior; merged before the Reader Measure production baseline                                                                     |
| FILTER-RULES-01                              | **COMPLETED** | PR #55; merged as `1021cd5746eba2b3b90b1a863bada9043f126be1` | Provider-backed per-feed raw Miniflux `blocklist_rules` / `keeplist_rules`; no NewsFlux rule persistence                                                                     |
| BULK-02 — Multi-select                       | **COMPLETED** | PR #57                                                       | Session-scoped multi-select and selected-read behavior completed                                                                                                             |
| MARK-ALL-REFRESH-01 — next-unread transition | **COMPLETED** | PR #58                                                       | Suppresses the transient empty state during an eligible next-unread jump                                                                                                     |
| MARK-ALL-UNDO-JUMP-01                        | **HOLD**      | Reopen only with real reproduction evidence                  | Current-base repro passed at 1280, 390 and 884; no current defect proven                                                                                                     |
| INPUT-PARITY-ESCAPE-FOCUS                    | **COMPLETED** | PR #64                                                       | Escape closes the age-based FooterPanel menu and restores focus to its trigger at compact, medium and desktop viewports                                                      |
| INPUT-PARITY-TOUCH-TARGET-01                 | **COMPLETED** | PR #67                                                       | Compact interaction targets corrected; visual icon size remains independent                                                                                                  |
| READER-KEY-01 — layered Escape               | **COMPLETED** | PR #46                                                       | Escape closes the topmost menu/popover before the reader                                                                                                                     |
| STATE-ERR-01 — unavailable entry route       | **COMPLETED** | PR #47                                                       | Unavailable entry routes present the explicit 404 behavior                                                                                                                   |
| CONTENT-01 — untitled entry fallback         | **COMPLETED** | PR #48                                                       | Deterministic accessible untitled-entry fallback; unread cue remains non-empty                                                                                               |
| HOME-01 — refresh/focus/reconnect            | **COMPLETED** | PR #59                                                       | Refresh, focus, reconnect and editorial-session continuity completed                                                                                                         |
| NAV01 — reader previous/next + next unread   | **COMPLETED** | PR #60                                                       | Canonical reader continuity and next-unread-source flow completed                                                                                                            |
| NAV-02F — navigation follow-ups              | **PLANNED**   | R2-13/R2-17/R2-18                                            | Long source names, unread grouping/mode persistence decisions, and human-readable unread labels                                                                              |
| FEED-HEALTH-01                               | **COMPLETED** | 01A / PR #40 and 01B / PR #52 complete                       | Provider-owned error details, checked time and failure count; disabled feeds remain suppressed; Retry is provider-backed; bulk refresh has one final metadata reconciliation |

### 3.4 Accessibility and interaction foundation

| Item                                            | Status          | Notes                                                                                                                                                                             |
| ----------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11Y-RT-01                                      | **COMPLETED**   | PR #23                                                                                                                                                                            |
| A11Y-01 — landmarks / heading / skip navigation | **COMPLETED**   | PR #34; `<main>`, named navigation, one h1 per view, reader hierarchy and skip link; exact merge-SHA deploy + authenticated post-merge smoke passed                               |
| Keyboard/touch parity                           | **COMPLETED**   | INPUT-01a, PR #64 Escape/focus return, and PR #67 touch-target parity are complete; icon sizing remains independent                                                               |
| SWIPE-ENTRY-01                                  | **BACKLOG**     | Miniflux-backed; real-device gate mandatory because Fold/back gestures may conflict                                                                                               |
| READER-MEDIA-01A                                | **IN PROGRESS** | PR #70 is open/draft on stale base `cf37807a4d3b9da39d3c438861fac358d936fdaa`; refresh onto current main before candidate and authenticated Reader/media gates                    |
| READER-MEASURE-01                               | **COMPLETED**   | PR #44 merged and promoted at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`; bounded 40–58ch prose measure; width 75 visually unchanged; real-device gate not executed (nonblocking) |
| READER-PROGRESS-01                              | **BACKLOG**     | Stateless progress only; persisted reading position remains architecture-gated                                                                                                    |
| READER-PRESETS-01                               | **BACKLOG**     | Group existing local typography/width/theme settings after READER-MEASURE-01                                                                                                      |

### 3.5 Visual-cohesion packages

| Package           | Status             | Scope / remainder                                                                                                                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST-VISUAL-01    | **COMPLETED**      | Monogram fallback (#24) + read-state/source/metadata cohesion (#28). Human-readable unread-count labels were rehomed to NAV-02F. No thumbnail redesign is authorized by this completion. |
| CHROME-01         | **PLANNED**        | DatePicker token subset completed in #25; verb-first confirmations, snackbar placement and remaining raw-Arco styling remain separate scoped work                                        |
| HOME-VISUAL-02    | **HOLD — PRODUCT** | Edition/category composition requires explicit editorial decision and HOME-01 dependency resolution                                                                                      |
| READER-VISUAL-02A | **COMPLETED**      | 02A1 in PR #41, Reader Measure in PR #44, and 02A2 / Quiet Column in PR #49; real header/prose alignment validated on the production element                                             |
| READER-VISUAL-02B | **PLANNED**        | Auto-hide + Next only after interaction/NAV dependencies                                                                                                                                 |
| NAV-VISUAL-01     | **IN PROGRESS**    | PR0 / #69 and PR1 / #71 complete; compact navigation is merged; Medium Rail / PR4 remains deferred; explicit future-slice gates remain required                                          |
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
- R2-05 layered Escape — **COMPLETED** as READER-KEY-01 / PR #46; PR #64 later completed the bounded FooterPanel Escape/focus-return slice without reopening reader Escape semantics.
- R2-06 dead entry route — **COMPLETED** as STATE-ERR-01 / PR #47.
- R2-07 untitled entry fallback — **COMPLETED** as CONTENT-01 / PR #48.
- R2-08 mark-all focus return — **COMPLETED** in PR #27.
- R2-09 scoped undo wording — **PLANNED** as BULK-01C.
- R2-10 runtime identity — **COMPLETED** as ID-RUNTIME-01 / PR #32; exact merge-SHA deployment and post-merge browser smoke passed.
- R2-11 touch target size — **COMPLETED** under keyboard/touch parity in PR #67; effective interaction targets are corrected.
- R2-12 Home refresh — **COMPLETED** as HOME-01 / PR #59.
- R2-13 source-name truncation — partially improved in article Column via #28; navigation-specific source-name work remains NAV-02F.
- R2-14 next-unread flow — **COMPLETED** as NAV01 / PR #60.
- R2-15 reader edge-to-edge media — **PLANNED** as READER-MEDIA-01; architecture gate follows input parity.
- R2-16 category keyboard tab-stop — re-check before fixing under keyboard/touch parity.

P3 debt remains under NAV-02F and HOME-SKEL-01 rather than being fixed incidentally. READER-VISUAL-02A, including 02A2 / Quiet Column, is complete in PR #49.

---

## 5. Product decisions required before implementation

### FILTER-RULES-01 — completed in PR #55

The shipped per-feed raw Miniflux rules editor retains Miniflux as source of truth; no NewsFlux rule database was added.

### HOME-VISUAL-02

Decide whether category/edition sections supplement Latest, replace part of Latest or remain optional. Composition remains Home-only.

### SAVE-EXT-01

Copy must distinguish external one-way save from a future first-party NewsFlux Read Later queue.

### NAV-02F

Decide optional Unread grouping, desktop sidebar width, `showUnreadFeedsOnly` persistence, and final human-readable unread-count presentation.

### NAV-VISUAL-01

`NAV_CONTRACT_DRIFT_01` is resolved as `RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION`. The approved historical contract specified a solid compact bar; PR #71 merged glass tokens and `backdrop-filter`, and that implementation is accepted as the current product baseline. Preserve the historical contract; future glass gates are not waived, and `MOBILE-SCROLL-FLICKER-01` remains open. PR0 / #69 and PR1 / #71 are complete; Medium Rail / PR4, including 884×1104 and `TABLET-HEADER-WIDTH-01`, remains deferred until PR #70 closes. Future slices still require explicit authorization and their own gates.

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

PRs #57–#72 are complete except the open draft PR #70; PR #62 is merged. The next active functional candidate is PR #70 / `READER-MEDIA-01A`, whose base is stale and must be refreshed after this post-PR72 state reconciliation and the separate DOCS-LINT-01 formatting-only PR. `MARK-ALL-UNDO-JUMP-01` remains held for real reproduction evidence. This documentation PR does not authorize implementation.

1. **POST-PR72 main/product-baseline reconciliation** — record GitHub main separately from the exact product/production baseline.
2. **DOCS-LINT-01** — separate formatting-only PR for the three existing baseline Markdown failures.
3. **PR #70 / READER-MEDIA-01A refresh** — after the two preceding documentation steps, refresh onto exact current main and rerun automated gates.
4. **PR #70 candidate and authenticated Reader/media gates** — do not deploy a candidate without separate PM authorization.
5. **Close PR #70** after required gates and review.
6. **Resume NAV-VISUAL with Medium Rail / PR4**, including 884×1104 and `TABLET-HEADER-WIDTH-01`; preserve the current compact implementation and keep future glass gates distinct.
7. **CHROME-01 remaining subsets**, NAV-02F, HOME-SKEL-01, SAVE-EXT-01, HOME-VISUAL-02, READER-VISUAL-02B, ID-DEPLOY-01, first-party saved-state work, Personalization V2, MOTION-01 and ML ranking, subject to their existing gates.

`BULK-01C` may be scheduled once copy is decided, but it remains separate from completed BULK-01B. `MARK-ALL-UNDO-JUMP-01` is not ordered while no current defect is reproduced. Read-only upstream auditing can run in parallel; no sync follows automatically.

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

The existing `markAllReadJumpToNext` behavior remains intentional. `MARK-ALL-UNDO-JUMP-01` may be reopened only with concrete current-runtime reproduction evidence.

---

## 9. Known test debt and incidental findings

- `HARNESS-UNDO-ID-01` was resolved by test-maintenance PR #36 (feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`, merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`); its focused list regression passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is no longer open: PR #38 reports `CODEBLOCK_SSR_GATE=PASS` within the full Node suite on both main and candidate.
- The React 19 `element.ref` warning remains an incidental harness warning. Classify it as non-blocking backlog; no fix is claimed in this reconciliation.
- **MOBILE-SCROLL-FLICKER-01 — OPEN:** replay is blocked by `MISSING_GENERATED_VERSION_INFO`; no physical iPhone gate was run and root cause remains unknown. Future optional NAV-VISUAL PR6 glass expansion remains blocked.
- **TABLET-HEADER-WIDTH-01 — CONFIRMED:** approximately 370 px header width with unused space was confirmed at 768×1024, 884×1104, 900×1100 and 992×1104 without overflow. Fix now: NO. Target: NAV-VISUAL-01 / PR4 MEDIUM-RAIL.
- **DOCS-LINT-01 — OPEN:** retain the three known documentation/superpowers formatting failures for a separate formatting-only PR; no DOCS-LINT-01 files are changed here.
- **ABOUT-ACCESSIBLE-BRAND-01 — COMPLETED:** PR #65 corrected the accessible NewsFlux GitHub link label in all six shipped locales; no longer an open finding.
- **RUNTIME-IDENTITY-02 — CLOSED / NON-PRODUCT:** `OLD_DOCUMENT_SESSION`; the old loaded document continued running old JavaScript while fresh asset requests returned the R5 asset. Server, asset, Service Worker and Cache Storage were not the cause.
- **HOME-HARNESS-STABILITY-01 — OPEN:** deterministic baseline failures and intermittent stability failures remain separate. Deterministic 10/10: `LIST_SEARCH_DATE_SORT_PRESERVED`, `READER_MEASURE_01_CPL`. Intermittent 6/10: `READER_VISUAL_01_WIDE_IMAGE`, `READER_MEASURE_01_DEFAULT_75_PARITY`, `READER_MEASURE_01_MEDIA_PROTECTION`. Root cause remains unknown.

Do not fix incidental findings in unrelated work.

### Completed finding — ABOUT-RUNTIME-REVISION-01

```text
STATUS=COMPLETED / RESOLVED
PR=63
FEATURE_HEAD=9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8
MERGE_SHA=723bdbb96e4445d267b443422a0be7a83e5b4f8a
RESULT=PASS
RESOLUTION=Exact SOURCE_COMMIT is the deterministic build identity embedded in frontend metadata and the OCI org.opencontainers.image.revision label.
LIVE_VALIDATION=PASS
ABOUT_COMMIT=exact promoted merge SHA, displayed in shortened form
UNKNOWN_COMMIT=RESOLVED
```

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

## 13. Current GitHub main and product/production state

The post-PR72 reconciliation on 2026-10-20 records GitHub `main` at `32244fa07b57c8bb3f5682f27b4d94917384ce63` and product/production at `d01e34fc2eb76da39467d1de9799b12194faec9c`. PR #72 was docs-only, so no deployment was required and product/production parity remains intact. PR #71 remains the promoted product baseline; PR #62 is merged; PR #70 remains open/draft and is sequenced after the separate DOCS-LINT-01 step.

```text
DOCS_DATE=2026-10-20
CURRENT_GITHUB_MAIN=32244fa07b57c8bb3f5682f27b4d94917384ce63
CURRENT_PRODUCT_BASELINE=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCT_BASELINE_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCT_PRODUCTION_PARITY=PASS
RAW_MAIN_PRODUCTION_SHA_EQUALITY=NO
RAW_MAIN_PRODUCTION_SHA_EQUALITY_REASON=DOCS_ONLY_MERGE_PR72
PR62_STATUS=COMPLETED
PR62_DRAFT=NO
PR62_BASE_SHA=405e9d7b1a3097dacef50c7908abf83d480d64dd
PR62_MERGE_SHA=389ed58731c38ffff8ceda0d0347222336960f3a

PR57_STATUS=COMPLETED
PR57_MERGE_SHA=85b9590bbc9f4d3488fd30694b0b45553fefda5b
PR58_STATUS=COMPLETED
PR58_MERGE_SHA=df4bea4dde5cca86a4b822d2e82f01156bb96f1a
PR59_STATUS=COMPLETED
PR59_MERGE_SHA=114eed13c5f66cd57a4448ece935de6cb5f4a11e
PR60_STATUS=COMPLETED
PR60_MERGE_SHA=31c95ff835da3e716acfd6eb115db5c3b68dd71c
PR61_STATUS=COMPLETED
PR61_MERGED=YES
PR61_DRAFT=NO
PR61_BASE_SHA=31c95ff835da3e716acfd6eb115db5c3b68dd71c
PR61_HEAD_SHA=e2cbab710f00eb84c77b3df4ddc9701839a677d9
PR61_MERGE_SHA=194a1db007902411abe91459b45a19b10c76e701

PR63_STATUS=COMPLETED
PR63=ABOUT-RUNTIME-REVISION-01
PR63_FEATURE_HEAD=9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8
PR63_MERGE_SHA=723bdbb96e4445d267b443422a0be7a83e5b4f8a
PR63_PERMANENT_PROMOTION=PASS
ABOUT-RUNTIME-REVISION-01_STATUS=COMPLETED / RESOLVED
PR64_STATUS=COMPLETED
PR64=INPUT-PARITY-ESCAPE-FOCUS
PR64_FEATURE_HEAD=ee412912ad43d4902459b12151bad81c570d58cf
PR64_MERGE_SHA=23474d3f83c01c4355c892f46c77d2f66b046af0
PR64_PERMANENT_PROMOTION=PASS
INPUT_PARITY_ESCAPE_FOCUS_STATUS=COMPLETED
PR65_STATUS=COMPLETED
PR65=ABOUT-ACCESSIBLE-BRAND-01
PR65_FEATURE_HEAD=8a4d1cf358d39524e95027b13e10c0205b9aea27
PR65_MERGE_SHA=405e9d7b1a3097dacef50c7908abf83d480d64dd
PR65_PERMANENT_PROMOTION=PASS
ABOUT_ACCESSIBLE_BRAND_01_STATUS=COMPLETED / RESOLVED

PR70_STATUS=OPEN_DRAFT
PR70_BRANCH=codex/reader-media-01a-lazy-player-lifecycle
PR70_HEAD_SHA=0cda102f4e57e2beddfec8d4517fd9b8b4893fb2
PR70_BASE_SHA=cf37807a4d3b9da39d3c438861fac358d936fdaa
PR70_BASE_STALE=YES
PR70_TRACK=READER-MEDIA-01A
PR70_NEXT_FUNCTIONAL_CANDIDATE=YES
PR71_STATUS=COMPLETED
PR71_FEATURE_HEAD=4712b3e49c94f560c0e83ce7c8519eb6bda9cba0
PR71_MERGE_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PR71_PERMANENT_PROMOTION=PASS
PR72_STATUS=COMPLETED
PR72_MERGE_SHA=32244fa07b57c8bb3f5682f27b4d94917384ce63
PR72_SCOPE=DOCUMENTATION_ONLY
DEPLOY_REQUIRED_FOR_PR72=NO

PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_IMAGE=newsflux-local:d01e34fc2eb7
PRODUCTION_IMAGE_ID=sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c
PRODUCTION_REVISION_LABEL=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SOURCE_LABEL=https://github.com/jfsdias/NewsFlux
PRODUCTION_STATUS=running
PRODUCTION_RESTART_COUNT=0
HTTP_GATE=200
CANONICAL_COMPOSE_IMAGE=newsflux-local:d01e34fc2eb7
CANDIDATE_OVERRIDE_ACTIVE=NO
CANDIDATE_OVERRIDE_PRESERVED=YES
PERMANENT_PROMOTION=PASS
ROLLBACK_USED=NO
PRODUCT_PRODUCTION_PARITY=PASS
CANONICAL_RUNTIME_PARITY=PASS
RUNTIME_CANONICAL_PARITY=PASS

CURRENT_PRIMARY_TRACK=POST_PR72_MAIN_PRODUCT_BASELINE_RECONCILIATION
CURRENT_PHASE=POST_PR72_RECONCILIATION
CURRENT_TRACK=DOCUMENTATION_AND_MAIN_PRODUCT_BASELINE_RECONCILIATION
KEYBOARD_TOUCH_PARITY_STATUS=COMPLETED
INPUT_01A_STATUS=COMPLETED
INPUT_PARITY_ESCAPE_FOCUS_STATUS=COMPLETED
INPUT_PARITY_TOUCH_TARGET_01_STATUS=COMPLETED
NEXT_FUNCTIONAL_CANDIDATE=READER-MEDIA-01A / PR #70
NEXT_PRIMARY_FUNCTIONAL=READER-MEDIA-01A / PR #70
TOUCH_TARGET_REQUIREMENT=>=44px interaction target
MARK_ALL_UNDO_JUMP_01_STATUS=INVESTIGATED_NO_REPRODUCTION_ON_CURRENT_BASE
MARK_ALL_UNDO_JUMP_01_DISPOSITION=HOLD_FOR_REAL_REPRO_EVIDENCE
DOCUMENTATION_BLOCKS_NEXT=NO
CURRENT_PRODUCT_PR=NONE
OPEN_RUNTIME_PR=NONE
OPEN_DOCUMENTATION_PR=DRAFT

LAST_COMPLETED_FUNCTIONAL=INPUT-PARITY-TOUCH-TARGET-01 / PR #67
LAST_COMPLETED_MAINTENANCE=HARNESS_MAINTENANCE / PR #68
LAST_PRODUCTION_PROMOTION=NAV-VISUAL PR1 / PR #71 / d01e34fc2eb76da39467d1de9799b12194faec9c

UPSTREAM_REPOSITORY=electh/ReactFlux
UPSTREAM_INTEGRATION_MODE=SELECTIVE_NON_LINEAR
LAST_FORMALLY_REVIEWED_UPSTREAM_SHA=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
LAST_INTEGRATED_UPSTREAM_SHA=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
LAST_LINEAR_INTEGRATED_UPSTREAM_BASELINE=3045a5f8f69ffd7f571f73540031efa8b4ff6e6d
NEXT_UPSTREAM_AUDIT_FROM=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036
SELECTIVELY_INTEGRATED=e46d92ab64adcbd0bb8ac2caf6048fa37f527939
SELECTIVELY_ADAPTED=0c28762de6987c980306b8553753e549e753b4e0
UPSTREAM_HOLD_VITE=4a2d4ce540cc0e3dd88bfd8d386e4c6645c47abe (8.3.1 to 8.3.4; dedicated bundler/lockfile/harness regression gate required)
UPSTREAM_HOLD_FRAMER_MOTION=ed0be6db9a8126d8bfdfc5afe41d2e058b7e5036 (14.0.0 to 14.2.0; dedicated production visual/motion regression gate required)

NAV_VISUAL_01_STATUS=IN_PROGRESS
NAV_VISUAL_01_IMPLEMENTATION=PARTIALLY_IMPLEMENTED
NAV_VISUAL_01_IMPLEMENTATION_AUTHORIZED=NO_FOR_REMAINING_SLICES
NAV_VISUAL_PR0=COMPLETED / PR #69 / cf37807a4d3b9da39d3c438861fac358d936fdaa
NAV_VISUAL_PR1=COMPLETED / PR #71 / d01e34fc2eb76da39467d1de9799b12194faec9c
NAV_VISUAL_NEXT_SLICE=MEDIUM_RAIL / PR4 / AFTER_PR70
NAV_CONTRACT_DRIFT_01=RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION
NAV_CONTRACT_DRIFT_01_DISPOSITION=RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION
HISTORICAL_APPROVED_COMPACT_NAV_V1=SOLID
CURRENT_PR71_COMPACT_BASELINE=GLASS_TOKENS_AND_BACKDROP_FILTER
HISTORICAL_CONTRACT_PRESERVED=YES
CURRENT_PR71_BASELINE_ACCEPTED=YES
FUTURE_GLASS_GATES_WAIVED=NO
NAV-PR1-HARNESS-DESKTOP-MODEL-01=OPEN_P3
NAV-PR1-ROUTE-FOCUS-01=OPEN_P3
MOBILE_SCROLL_FLICKER_01=OPEN
MOBILE_SCROLL_FLICKER_01_SCOPE=SEPARATE_FUTURE_GLASS_GATE
TABLET_HEADER_WIDTH_01=CONFIRMED / TARGET_MEDIUM_RAIL
RUNTIME_IDENTITY_02_STATUS=CLOSED_NON_PRODUCT
RUNTIME_IDENTITY_02_CLASSIFICATION=OLD_DOCUMENT_SESSION
DOCS_LINT_01_STATUS=OPEN_BASELINE_DEBT
IMPLEMENTATION_AUTHORIZED=NO
MERGE_AUTHORIZED=NO
PERMANENT_PROMOTION_AUTHORIZED=NO

NEXT_RECOMMENDED_ACTION=DOCS_LINT_01_FORMATTING_ONLY_PR
PRODUCT_IMPLEMENTATION_AUTHORIZED=NO
DOCUMENTATION_RECONCILIATION_BRANCH=docs/post-pr72-main-product-baseline-split
DOCUMENTATION_RECONCILIATION_BASE_SHA=32244fa07b57c8bb3f5682f27b4d94917384ce63
```

The production runtime remains at product baseline `d01e34fc2eb76da39467d1de9799b12194faec9c`, while GitHub `main` is ahead at `32244fa07b57c8bb3f5682f27b4d94917384ce63` solely because of docs-only PR #72. No candidate override is active, the archived candidate override remains preserved, and product/production parity remains intact. NAV-VISUAL PR0/PR1 are complete, and remaining slices retain their separate authorization gates. `NAV_CONTRACT_DRIFT_01` is resolved as an accepted current-baseline exception; future glass gates remain separate and `MOBILE-SCROLL-FLICKER-01` remains open.
