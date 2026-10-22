# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after PR #85 (the dedicated `3b2b08fb` upstream item; upstream cycle closed), with the `PWA FOUNDATION` and NetNewsWire UX planning tracks added; GitHub `main` and product/production baselines remain recorded separately.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-22.
- **Reconciled against (current):** GitHub `main` at `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc` (PR #85 merge). Production is at the same SHA with `PRODUCT_PRODUCTION_PARITY=PASS` and `PR85_RUNTIME_ACCEPTANCE=PASS` (`PM_REPORTED`; not independently verifiable from the repository). The current snapshot is Section 16.
- **Previously reconciled against (historical, 2026-10-22 morning):** GitHub `main` at `313991e80c2b54a99819c2e267ef90a35a959752`; product and production at `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`. PR #79 is docs-only and explains the main/runtime SHA difference at that time; no deployment was required for that documentation merge. Production image `newsflux-local:dc72a6ed0069`, image ID `sha256:3ada4fb3ef18c3fd1398a67aa6ce5118c8cb88c6533775e534779cb820bde83b`, runtime running, internal HTTP PASS, public HTTP 200 and exact image/revision PASS. Restart count was not included in the supplied receipt. PR #80 is closed without merge; PR #81 is merged, deployed and validated. No PRs were open at the original 2026-10-21 pre-reconciliation snapshot.
- **Purpose:** preserve completed work, accepted findings, sequencing, architecture/product gates, upstream baseline, and the next recommended action without turning the roadmap into implementation authorization.
- **Related planning documents:** [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) (PWA Foundation architecture contract) and [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (NetNewsWire UX research track). Both are planning documents and authorize no implementation.

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
- **NetNewsWire UX research track — ACCEPTED AS DESIGN INPUT** (`NETNEWSWIRE_UX_REFERENCE`): source identity, navigation density, contextual toolbar, reader source header and a research-only multi-pane study, each separating `REFERENCE_PATTERN` from `NEWSFLUX_PRODUCT_DECISION`. See `DESIGN_REFERENCES.md`. This is not a visual-clone request and does not reopen the single-pane, opaque-content, glass-as-chrome or `884×1104` decisions.

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

| PR  | Track                            | Status               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20 | BULK-01                          | **COMPLETED**        | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo                                                                                                                                                                                                                                                                                                                                                    |
| #21 | ID-01R                           | **COMPLETED**        | Repository/document provenance and translated README reconciliation                                                                                                                                                                                                                                                                                                                                                                    |
| #22 | Documentation                    | **COMPLETED**        | Canonical roadmap red-team R2 reconciliation                                                                                                                                                                                                                                                                                                                                                                                           |
| #23 | A11Y-RT-01                       | **COMPLETED**        | Reduced-transparency dark/OLED specificity fix                                                                                                                                                                                                                                                                                                                                                                                         |
| #24 | LIST-VISUAL-01 / monogram subset | **COMPLETED**        | Deterministic favicon monogram fallback                                                                                                                                                                                                                                                                                                                                                                                                |
| #25 | CHROME-01A / DatePicker subset   | **COMPLETED**        | NewsFlux token styling for DatePicker                                                                                                                                                                                                                                                                                                                                                                                                  |
| #26 | Upstream sync                    | **COMPLETED**        | Adapted upstream article code-block experience through `3045a5f8...`                                                                                                                                                                                                                                                                                                                                                                   |
| #27 | BULK-01F                         | **COMPLETED**        | Footer Mark All Read focus restoration                                                                                                                                                                                                                                                                                                                                                                                                 |
| #28 | LIST-VISUAL-01A                  | **COMPLETED**        | Read-state + metadata/source hierarchy cohesion across Column/Card/List                                                                                                                                                                                                                                                                                                                                                                |
| #29 | Documentation                    | **COMPLETED**        | Roadmap/project-state reconciliation after PR #28 production promotion                                                                                                                                                                                                                                                                                                                                                                 |
| #30 | BULK-01B                         | **COMPLETED**        | Sidebar Feed/Category Mark All confirmation + safe shared Undo; race hardening; exact merge-SHA deployed                                                                                                                                                                                                                                                                                                                               |
| #32 | ID-RUNTIME-01                    | **COMPLETED**        | Approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merged/deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed                                                                                                                                                                                                                                                                               |
| #34 | A11Y-01                          | **COMPLETED**        | Approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`; merged/deployed as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`; tree parity, exact-SHA promotion and authenticated post-merge smoke passed                                                                                                                                                                                                                                    |
| #36 | HARNESS-UNDO-ID-01               | **COMPLETED**        | Feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`; merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; repaired all nine stale fixed-notice-ID assertions (29/29)                                                                                                                                                                                                                                                                  |
| #38 | RUNTIME-BASE-01                  | **COMPLETED**        | Feature head `07237ba7e8c773e9de88e9c533296b9700dde287`; merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`; pins Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 by digest                                                                                                                                                                                                                                                                    |
| #39 | FILTER-01B                       | **COMPLETED**        | Date/status filter transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`                                                                                                                                                                                                                                                                                                                                           |
| #40 | FEED-HEALTH-01A                  | **COMPLETED**        | Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`                                                                                                                                                                                                                                                                                                                                    |
| #41 | READER-VISUAL-02A1               | **COMPLETED**        | Editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`                                                                                                                                                                                                                                                                                                                                                  |
| #42 | NAV-02 harness maintenance       | **COMPLETED**        | Mark-All expectation aligned with current batching; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`                                                                                                                                                                                                                                                                                                                               |
| #43 | BULK-03A                         | **COMPLETED**        | Mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`                                                                                                                                                                                                                                                                                                                                                |
| #44 | READER-MEASURE-01                | **COMPLETED**        | Bounded responsive prose measure; merge and production promotion at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`                                                                                                                                                                                                                                                                                                                         |
| #45 | Documentation                    | **COMPLETED**        | Prior post-Reader Measure reconciliation, merge `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation                                                                                                                                                                                                                                                                                            |
| #46 | READER-KEY-01                    | **COMPLETED**        | Feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`; merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`; layered Escape complete                                                                                                                                                                                                                                                                                                     |
| #47 | STATE-ERR-01                     | **COMPLETED**        | Feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`; merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`; unavailable-entry 404 behavior complete                                                                                                                                                                                                                                                                                     |
| #48 | CONTENT-01                       | **COMPLETED**        | Feature head `1032b5409298629382685a85935b85fdc2292f85`; merge `9f521edfd5f031e8e833a4854d896acc42a22fae`; deterministic untitled fallback complete                                                                                                                                                                                                                                                                                    |
| #49 | READER-VISUAL-02A2               | **COMPLETED**        | Feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`; merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`; quiet header aligned to prose column                                                                                                                                                                                                                                                                                        |
| #50 | BULK-03B                         | **COMPLETED**        | Feature head `dd9e68650f3f40080199b90107c2b35722166697`; merge `a8dbe15497f7d526298f223188955b82589a84a4`; 1/7/30-day age presets, strict cutoff, full discovery, scoped writes, acknowledged-only Undo                                                                                                                                                                                                                                |
| #51 | Documentation                    | **COMPLETED**        | Project-state and roadmap reconciliation after BULK-03B; merge `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`                                                                                                                                                                                                                                                                                                                              |
| #52 | FEED-HEALTH-01B                  | **COMPLETED**        | Feature head `1b03865311993f7e72df0632ea662bbe94e926e9`; merge `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`; provider-backed details/Retry and one final metadata reconciliation after bulk refresh                                                                                                                                                                                                                                      |
| #53 | Selective upstream maintenance   | **COMPLETED**        | Feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`; merge `046cd647c65583cdfdc7ab282701be79d4b34294`; pnpm hardening integrated, setup-node pin adapted                                                                                                                                                                                                                                                                           |
| #55 | FILTER-RULES-01                  | **COMPLETED**        | Feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`; merge `1021cd5746eba2b3b90b1a863bada9043f126be1`; provider-backed per-feed raw Miniflux block/keep rules, no NewsFlux rule persistence                                                                                                                                                                                                                                        |
| #57 | BULK-02                          | **COMPLETED**        | Session multi-select; merge `85b9590bbc9f4d3488fd30694b0b45553fefda5b`                                                                                                                                                                                                                                                                                                                                                                 |
| #58 | MARK-ALL-REFRESH-01              | **COMPLETED**        | Suppresses transient empty state during the next-unread jump; merge `df4bea4dde5cca86a4b822d2e82f01156bb96f1a`; Undo-after-jump concern later investigated with no current defect reproduced                                                                                                                                                                                                                                           |
| #59 | HOME-01                          | **COMPLETED**        | Refresh, focus, reconnect and editorial-session continuity; merge `114eed13c5f66cd57a4448ece935de6cb5f4a11e`                                                                                                                                                                                                                                                                                                                           |
| #60 | NAV01                            | **COMPLETED**        | Canonical reader previous/next and next-unread continuity; merge `31c95ff835da3e716acfd6eb115db5c3b68dd71c`                                                                                                                                                                                                                                                                                                                            |
| #61 | INPUT-01a                        | **COMPLETED**        | Shared reader-command ownership; head `e2cbab710f00eb84c77b3df4ddc9701839a677d9`, merge `194a1db007902411abe91459b45a19b10c76e701`                                                                                                                                                                                                                                                                                                     |
| #62 | Documentation                    | **COMPLETED**        | Post-PR65 reconciliation; merged as `389ed58731c38ffff8ceda0d0347222336960f3a`                                                                                                                                                                                                                                                                                                                                                         |
| #63 | ABOUT-RUNTIME-REVISION-01        | **COMPLETED**        | Feature head `9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8`; merge `723bdbb96e4445d267b443422a0be7a83e5b4f8a`; exact build identity, live About validation and production promotion passed                                                                                                                                                                                                                                                 |
| #64 | INPUT-PARITY-ESCAPE-FOCUS        | **COMPLETED**        | Feature head `ee412912ad43d4902459b12151bad81c570d58cf`; merge `23474d3f83c01c4355c892f46c77d2f66b046af0`; FooterPanel Escape/focus live canary passed at 390×844, 884×1104 and 1280×800                                                                                                                                                                                                                                               |
| #65 | ABOUT-ACCESSIBLE-BRAND-01        | **COMPLETED**        | Feature head `8a4d1cf358d39524e95027b13e10c0205b9aea27`; merge `405e9d7b1a3097dacef50c7908abf83d480d64dd`; six-locale accessible NewsFlux GitHub label correction; exact merge-SHA promotion passed                                                                                                                                                                                                                                    |
| #66 | Mark All cold-loaded All         | **COMPLETED**        | Feature head `1b6449597179ab3c832d0c658048d46f8bddda93`; merge `0553119de95ab5b9c2e131bbb4b2ef1d0ef58456`; current-list identity and filtered unread total reconciliation                                                                                                                                                                                                                                                              |
| #67 | INPUT-PARITY-TOUCH-TARGET-01     | **COMPLETED**        | Feature head `ec15233215043d6a054cb6fb5eb43eebe8b1442e`; merge `7b6e474fcd50bb891e429a632849da371e126590`; interaction targets corrected with inert gaps preserved                                                                                                                                                                                                                                                                     |
| #68 | Harness maintenance              | **COMPLETED**        | Feature head `104671b51f99d0ad7c33d3514f8d4b2ad3558aee`; merge `b6b814c77160c2e61dedc7c10958f0712f59d728`; stale provider/button assumptions corrected                                                                                                                                                                                                                                                                                 |
| #69 | NAV-VISUAL PR0                   | **COMPLETED**        | Feature head `b550634066ed129e4bb0e9b3ca18842469cb493e`; merge `cf37807a4d3b9da39d3c438861fac358d936fdaa`; window-class foundation                                                                                                                                                                                                                                                                                                     |
| #70 | READER-MEDIA-01A                 | **COMPLETED**        | Merged as `2a858ede20e02c2c6532fa32bae4468cb64c30ea`; deferred media/player initialization completed                                                                                                                                                                                                                                                                                                                                   |
| #71 | NAV-VISUAL PR1                   | **COMPLETED**        | Feature head `4712b3e49c94f560c0e83ce7c8519eb6bda9cba0`; merge and product/production promotion `d01e34fc2eb76da39467d1de9799b12194faec9c`; compact navigation and Reader/Drawer focus/resize hardening                                                                                                                                                                                                                                |
| #72 | Documentation                    | **COMPLETED**        | Post-PR71 state reconciliation; docs-only merge `32244fa07b57c8bb3f5682f27b4d94917384ce63`; no deployment required                                                                                                                                                                                                                                                                                                                     |
| #74 | NAV-PR1-ROUTE-FOCUS-01 fix       | **COMPLETED**        | Merge `b6b7246642aa5ff15f3f8e7015d2efbd83a47be5` (head `0ee182ae4435a3928ffe9d3b1d06b8cb476fcbcb`); restores meaningful focus after drawer navigation. Recorded as completed historical NAV route-focus work (PM review of PR #86); absent from earlier snapshots                                                                                                                                                                      |
| #75 | DOCS-LINT-01                     | **COMPLETED**        | Formatting-only reconciliation of three existing superpowers docs; merge `8807469296db5815b9fc6e961d4f12275234574b`                                                                                                                                                                                                                                                                                                                    |
| #76 | TABLET-HEADER-WIDTH-01 fix       | **COMPLETED**        | Merge `831ff514c3a572a41cd857dd51ffd4f5c87663c1` (head `cf09491e4875cdcc94bf8235db752499ddba5003`); expands the tablet list header to content width (`Content.jsx`). **Closes `TABLET-HEADER-WIDTH-01`** (PM review of PR #86); in current production ancestry (`PM_REPORTED`); absent from earlier snapshots                                                                                                                          |
| #77 | HOME id-only initial entries     | **COMPLETED**        | Merge `e1c1285e717e626fc759b0bb52431cd9321df334` (head `82062eee246cf58def1ea5681dd90cbd530f2dde`); deduplicates initial Home entries by id. **Closes the initial canonical Home duplicate-ID root cause** (`HOME_DUP_ROOT_CAUSE_01` insofar as it referred to that case); does **not** close unrelated pagination/cursor findings (`HOME_PAGINATION_CURSOR_STALL_01` remains BACKLOG); in current production ancestry (`PM_REPORTED`) |
| #79 | Research archive                 | **COMPLETED**        | Durable research archive and post-PR81 reconciliation; docs-only merge `313991e80c2b54a99819c2e267ef90a35a959752`                                                                                                                                                                                                                                                                                                                      |
| #80 | Discovery Benchmark V1           | **CLOSED, NO MERGE** | Research-only harness; no product authority. G1 remained a limited research signal, G2 had no useful signal; broad discovery remains HOLD.                                                                                                                                                                                                                                                                                             |
| #81 | ADD-FEED-DISCOVER-01             | **COMPLETED**        | Merged, deployed and validated as `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`; website discovery requires explicit confirmation/selection before subscription.                                                                                                                                                                                                                                                                          |
| #82 | Documentation                    | **COMPLETED**        | Project-state/roadmap reconciliation after PR #81; docs-only merge `68c1ef3c5d86bb1495c98da19f036215ac0c722d` (head `db272f58d4bb72749d1bf1a0ea1eaedbf6e84d8a`); no deployment required                                                                                                                                                                                                                                                |
| #83 | ADD-FEED-DISCOVERY-UX-01         | **COMPLETED**        | Merge `16311d0d6c3e2611fa09380ded33e63795ba0270` (head `935b1100ddb7f51358b41c7f575f0fe04a4fe25d`); duplicate-URL presentation polish resolved; included in production SHA `d7c0fc8e…` (`PM_REPORTED`)                                                                                                                                                                                                                                 |
| #84 | MINIFLUX-DELETE-CONTRACT-01      | **COMPLETED**        | Merge `9b6f98cee745c2fed8dbe73cee2b1f2e4ad29ac7` (head `7f695d453e414057be6b6ed7e934e50f676ff0d6`); feed-deletion contract hardening (`src/apis/feeds.js`); historical 404 causation remains high-confidence but unproven                                                                                                                                                                                                              |
| #85 | Upstream sync (ADAPT `3b2b08fb`) | **COMPLETED**        | Merge `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc` (head `7db4bcd8bc86b4f361890f13570003a4435547de`); empty `figcaption` elements render without children; merged, deployed and runtime-accepted (`PM_REPORTED`); upstream cycle closed                                                                                                                                                                                                  |

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

| Item                                            | Status        | Notes                                                                                                                                                                             |
| ----------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11Y-RT-01                                      | **COMPLETED** | PR #23                                                                                                                                                                            |
| A11Y-01 — landmarks / heading / skip navigation | **COMPLETED** | PR #34; `<main>`, named navigation, one h1 per view, reader hierarchy and skip link; exact merge-SHA deploy + authenticated post-merge smoke passed                               |
| Keyboard/touch parity                           | **COMPLETED** | INPUT-01a, PR #64 Escape/focus return, and PR #67 touch-target parity are complete; icon sizing remains independent                                                               |
| SWIPE-ENTRY-01                                  | **BACKLOG**   | Miniflux-backed; real-device gate mandatory because Fold/back gestures may conflict                                                                                               |
| READER-MEDIA-01A                                | **COMPLETED** | PR #70 merged as `2a858ede20e02c2c6532fa32bae4468cb64c30ea`; lazy media/player initialization is complete                                                                         |
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
| APP-BADGE-01    | **BACKLOG**             | Becomes **PWA-04A** (Badging API, capability-detected); still after ID-DEPLOY and PWA validation; uses Miniflux unread counts                                         |
| THEME-CHROME-01 | **ABSORBED**            | Becomes **PWA-01B** (theme and display-mode integration); see `PWA_ARCHITECTURE.md`                                                                                   |

### 3.8 Upstream maintenance

| Item                                 | Status        | Notes                                                                                                                                                                                      |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selective upstream maintenance model | **ONGOING**   | Never blindly merge or Sync fork                                                                                                                                                           |
| Last formally reviewed upstream      | **BASELINE**  | `3b2b08fb6036ef94f92a757ac6f3df889be8515c`                                                                                                                                                 |
| Last integrated upstream frontier    | **BASELINE**  | `3b2b08fb6036ef94f92a757ac6f3df889be8515c`, integrated by PR #85 (merge `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc`); previous frontier `0887f714c36cc6c999f8b4559fa14c7948598629` (PR #11) |
| Latest upstream sync                 | **COMPLETED** | PR #85 (ADAPT `3b2b08fb`); PR #11 was the previous sync set                                                                                                                                |
| Next upstream item                   | **NONE**      | Upstream cycle **CLOSED**; the next cycle starts from a live check of the upstream head and the `INTEGRATE / ADAPT / SKIP / HOLD` audit from `3b2b08fb`                                    |

Upstream audit classification remains `INTEGRATE / ADAPT / SKIP / HOLD`. PR #11 was the upstream sync set before PR #85, merged as `cef9d8faf543d297e3393b1de314c57b01d99af9`, and synchronized/adapted through `0887f714c36cc6c999f8b4559fa14c7948598629`. Its set included `aa68cb53` filtered/empty counts, `6963069b` Mark-All filter/session hardening, and `b587a964` mutation-total refresh. `0887f714` remains in upstream ancestry; its redundant tree-level autofocus change was skipped because NewsFlux already provided equivalent focus behavior. PR #26 and PR #53 remain valid historical upstream-maintenance records, but they are not the latest integrated frontier. The latest reviewed upstream commit is `3b2b08fb6036ef94f92a757ac6f3df889be8515c` (`fix(article): render empty caption elements without children (#794)`), classified `ADAPT` with low risk on `src/components/Article/ArticleDetail.jsx`. It was adapted by PR #85 (merge `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc`) and is now integrated, which closes the upstream cycle (`UPSTREAM_CYCLE=CLOSED`; the text above describing it as queued is historical). PR #53 used selective, non-linear maintenance:

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

### 3.12 Discovery research, feed discovery and fetch security

- **PR #81 / ADD-FEED-DISCOVER-01 — COMPLETED, MERGED, DEPLOYED, VALIDATED** at `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`. A normal website URL is sent to Miniflux `POST /v1/discover`; zero candidates produce explicit no-results feedback, one candidate requires confirmation, and multiple candidates require explicit selection and confirmation. `POST /v1/feeds` occurs only after that confirmation. Direct valid feed URL behavior, selected category and Fetch original content/crawler are preserved. Automated, Safari/browser, focus-lock, focus-return, controlled canary and cleanup reconciliation gates passed.
- **PR #80 / Discovery Benchmark V1 — CLOSED WITHOUT MERGE; RESEARCH ONLY.** Corpus sufficiency passed for continued research. G1 candidate generation is a limited signal (Recall@5 0.075, Recall@10 0.125, MRR 0.057); G2 produced no useful signal. No product ranking was adopted; broad source discovery remains HOLD. No raw/private benchmark artifacts were committed.
- **ADD_FEED_DISCOVERY_DUPLICATE_URL_01 — RESOLVED by PR #83** (merge `16311d0d6c3e2611fa09380ded33e63795ba0270`): the candidate URL is now rendered exactly once; distinct title → title plus URL, missing title or title equal to the URL → URL once. Presentation only; provider behavior unchanged.
- **MINIFLUX_DELETE_STATUS_01 — PR #84 MERGED** (merge `9b6f98cee745c2fed8dbe73cee2b1f2e4ad29ac7`): the DELETE retry hazard was hardened in `src/apis/feeds.js`; the historical 404 causation remains high-confidence but unproven, so no root-cause closure is claimed.
- **Miniflux fetch security migration — PASS:** global private-network fetch allowance is disabled; RSS-Bridge private access is restricted through the dedicated proxy to the intended `rss-bridge:80` target.

### 3.13 PWA Foundation and NetNewsWire UX tracks (planning only)

Two planning tracks were added after the upstream cycle closed. They are documented in [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) and [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md); neither authorizes implementation, merge or deployment.

**Key finding:** a partial PWA already exists in `main` (generated manifest, Workbox service worker with `skipWaiting` + `clientsClaim` + auto-update, iOS head metadata, a standalone viewport workaround). PWA-01 is therefore an audit-and-harden problem, not a greenfield one, and the plan starts with a measurement phase. `PWA installability != offline data architecture`, and `CORRECT_FRESH_RUNTIME > AGGRESSIVE_OFFLINE_CACHING`.

| Item                                                                                            | Status                       | Dependency / gate                                                                                                                        | Notes                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| PWA-00 baseline audit                                                                           | **EXECUTED (PARTIAL)**       | PM review of PR #86: the next authorized planning/validation candidate after the documentation PR; D4 partially resolved (`PM_REPORTED`) | Evidence-only measurement of the existing PWA on real devices, including whether the Miniflux origin is same- or cross-origin; no product code |
| PWA-01A manifest and icons                                                                      | **PLANNED (NOT AUTHORIZED)** | Separate PM authorization; PWA-00 evidence; D1 (`id`), D3 (maskable art); waits behind PWA-03A if PWA-00 confirms a mid-reading reload   | `PWA_01A_AUTHORIZED=NO`; not the authorized first implementation PR                                                                            |
| PWA-01B theme and display-mode                                                                  | **PLANNED**                  | PWA-01A; D2; absorbs `THEME-CHROME-01`                                                                                                   | Must not combine with visual redesign                                                                                                          |
| PWA-01C serving contract                                                                        | **HOLD — ARCHITECTURE**      | `ID-DEPLOY-01` or an explicit PM waiver (D5)                                                                                             | `Caddyfile` headers and real 404 for missing assets; own PR and deployment window                                                              |
| PWA-VAL-01 runtime/device validation                                                            | **PLANNED**                  | After 01A/01B                                                                                                                            | Evidence-only; installed and browser modes are never merged                                                                                    |
| PWA-02A Android / PWA-02B Apple                                                                 | **PLANNED**                  | Defect-driven from PWA-VAL-01                                                                                                            | No-op if validation finds nothing                                                                                                              |
| PWA-03A update safety                                                                           | **PLANNED**                  | D6; **outranks PWA-01A/01B** if PWA-00 confirms a mid-reading reload or update disruption                                                | Highest-blast-radius change in the track; correctness before cosmetic installability hardening                                                 |
| PWA-03B offline/error states, 03C kill switch                                                   | **PLANNED**                  | After 03A                                                                                                                                | No offline data cache                                                                                                                          |
| PWA-03D controlled cache policy                                                                 | **HOLD — ARCHITECTURE**      | Explicit architecture decision (`ROADMAP` §6)                                                                                            | Caching authenticated or user data is blocked                                                                                                  |
| PWA-04A badge (`APP-BADGE-01`), 04B share target → Add Feed, 04C shortcuts, 04D web-share audit | **PLANNED**                  | After PWA-VAL-01; each capability-detected and optional                                                                                  | One PR per capability                                                                                                                          |
| PWA-04E push / background sync                                                                  | **HOLD — ARCHITECTURE**      | Needs a server component and/or an offline mutation queue                                                                                | Not scheduled                                                                                                                                  |
| NNW-01A source identity foundation                                                              | **PLANNED**                  | No new persistence                                                                                                                       | One identity primitive for sidebar, list and (via NNW-04) reader                                                                               |
| NNW-01B icon fallback and privacy                                                               | **HOLD — PRODUCT**           | D7 (third-party icon fallback)                                                                                                           | Also covers the multi-part public-suffix hostname bug                                                                                          |
| NNW-01C icon persistence                                                                        | **HOLD — ARCHITECTURE**      | `SOURCE_IDENTITY` architecture gate                                                                                                      | Not scheduled                                                                                                                                  |
| NNW-02 navigation density                                                                       | **HOLD — PRODUCT**           | `NAV-02F`; `NAV-VISUAL-01` PR2/PR4/PR7 and its nine open decisions                                                                       | Density is pointer-conditional; no touch-target erosion                                                                                        |
| NNW-03 contextual toolbar                                                                       | **HOLD — PRODUCT**           | `CHROME-01` decision; `READER-VISUAL-02B`                                                                                                | Progressive disclosure, never silent removal; one PR per surface                                                                               |
| NNW-04 reader source header                                                                     | **PLANNED**                  | NNW-01A                                                                                                                                  | Hierarchy: title > editorial metadata > source mark                                                                                            |
| NNW-05 multi-pane reference                                                                     | **PLANNED**                  | REA research only                                                                                                                        | Single-pane contract unchanged; evidence only                                                                                                  |

Refined order versus the original request (reasons in `PWA_ARCHITECTURE.md` §8): PWA-00 is added first; PWA-01 is split and absorbs `THEME-CHROME-01`; PWA-03A outranks PWA-01A/01B if PWA-00 confirms a mid-reading reload or update disruption (PM rule); NNW-04 precedes NNW-02/03; PWA-01C and NNW-05 run off the main line. **`PWA-00` is the next authorized planning/validation candidate; `PWA-01A` is not yet authorized.**

**PWA-00 result (2026-10-22, [`PWA_00_BASELINE.md`](./PWA_00_BASELINE.md)):** executed against `main` `68b39798fa6d823b2e5b1286aa42d4309c21c2ca` (the PWA-00 row above keeps its original gate and scope wording; its status is now `EXECUTED (PARTIAL)`). A service worker update reloads the reading page automatically and loses scroll, in-memory state and typed dialog text (`LOCAL_EXPERIMENT`, on metadata-verified builds and on builds without a commit date; production frequency `NOT_MEASURED`). `MID_READING_UPDATE_DISRUPTION=CONFIRMED`, so under the PM rule `PWA-03A` is the recommended next candidate and outranks icon/manifest polish. This is a **recommendation**: `PWA-01A` stays not authorized and no implementation PR is authorized. The public origin, Nginx Proxy Manager headers and the real Miniflux origin remain `NOT_MEASURED`; iOS and Android gates are `NOT_RUN`. `UPDATE_CHECK_BUILD_METADATA_01` and `REACT_HYDRATION_WARNING` are held for diagnosis and are not PWA work.

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

`NAV_CONTRACT_DRIFT_01` is resolved as `RESOLVED_ACCEPTED_CURRENT_BASELINE_EXCEPTION`. The approved historical contract specified a solid compact bar; PR #71 merged glass tokens and `backdrop-filter`, and that implementation is accepted as the current product baseline. Preserve the historical contract; future glass gates are not waived, and `MOBILE-SCROLL-FLICKER-01` remains open. PR0 / #69, PR1 / #71 and Reader Media / PR #70 are complete; Medium Rail / PR4, including 884×1104 and `TABLET-HEADER-WIDTH-01`, remains deferred. Future slices still require explicit authorization and their own gates.

### CHROME-01 contextual consolidation

Decide whether footer/header context zones remain separate or become one contextual action bar. Do not resolve incidentally during styling.

### READER-MEASURE-01

**Status: COMPLETED** in PR #44; merged and promoted at exact SHA `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`.

The existing Article width control remains the only control. Prose uses `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)` and stays within its frame; width 75 retains the prior visual measure. Automated Reader Measure, RV01 and 02A1 regression gates, protected-surface parity, production provenance, base-image parity and exact-SHA promotion passed. Real-device validation was not executed and remains nonblocking. PR #49 later completed the separate 02A2 real-element header/body alignment gate.

### PWA FOUNDATION — decisions required before implementation

The PM inputs below gate the PWA phases (details and owners in `PWA_ARCHITECTURE.md` §12): **D1** manifest `id`; **D2** `theme_color`/`background_color` policy for an OLED-first app; **D3** maskable icon art direction; **D4** production topology — **partially resolved (`PM_REPORTED`)**: `https://news.jfsdias.ddns.net/` behind Nginx Proxy Manager, Docker network `npm-proxyyml_default`, internal `http://newsflux:2000`, exact `newsflux-local:<shortcommit>` image contract; the Miniflux origin stays user-configurable and is **not** assumed to be same-origin until PWA-00 measures it; **D5** `ID-DEPLOY-01` or a waiver for serving-contract changes; **D6** update policy (deferred auto-reload vs user prompt); **D7** third-party icon fallback; **D8** token-only authentication guidance vs retained plaintext password in `localStorage`; **D9** whether offline reading is ever wanted (it triggers the Section 6 architecture gate).

### NetNewsWire UX tracks — product decisions

`NNW-02` depends on `NAV-02F`, `NAV-VISUAL-01` PR2/PR4/PR7 and its nine open decisions; `NNW-03` depends on the `CHROME-01` contextual-consolidation decision; `NNW-01B` depends on D7; `NNW-05` is research-only and may only produce an evidence-backed recommendation. **`SOURCE_IDENTITY` is confirmed** by the PM (review of PR #86) as publisher/feed/source-level visual identity reused across the sidebar, list and reader; `STORY_IDENTITY` (story-level identity and clustering semantics) is **not** part of `NNW-01`; the no-new-persistence constraint stays.

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

The 2026-10-21 and 2026-10-22 (morning) snapshots remain historical. After the post-PR #85 reconciliation, PRs #82, #83, #84 and #85 are merged, no PRs were open before the planning documentation PR, and the upstream cycle is closed. `MARK-ALL-UNDO-JUMP-01` remains held for real reproduction evidence. No broad discovery ranking or personalization expansion is authorized. The sequence below is a sequencing record, **not** authorization to implement, merge or deploy anything.

1. **Planning documentation PR** — this reconciliation plus `PWA_ARCHITECTURE.md` and `DESIGN_REFERENCES.md`; docs-only, no deployment required.
2. **PWA-00 baseline audit** — evidence-only measurement of the PWA that already exists; the next authorized planning/validation candidate (PM review of PR #86). **Executed 2026-10-22** (`PWA_00_BASELINE.md`): local baseline recorded, public origin not measured.
3. **PWA-01A manifest and icons** (**not yet authorized**), then **PWA-01B theme and display-mode** (absorbs `THEME-CHROME-01`).
4. **PWA-VAL-01 runtime/device validation** on the installed/browser matrix.
5. **PWA-03A update safety** — **outranks PWA-01A/01B** if PWA-00 confirms a mid-reading reload or update disruption (correctness before cosmetic installability hardening); otherwise it follows PWA-VAL-01. The shipped service worker is update-aggressive. PWA-00 confirmed the mid-reading reload locally, so `PWA-03A` is the recommended next candidate (not authorized).
6. **PWA-02A / PWA-02B platform adaptation** — defect-driven from the validation results.
7. **NNW-01A source identity foundation**, then **NNW-04 reader source header**; **NNW-02** and **NNW-03** only after `NAV-02F` / `NAV-VISUAL-01` and `CHROME-01` decisions.
8. **PWA-03B/03C**, then **PWA-04** capabilities one at a time.
9. **Other planned/backlog tracks** — CHROME-01 remaining subsets, NAV-02F, NAV-VISUAL-01 remaining slices, HOME-SKEL-01, SAVE-EXT-01, HOME-VISUAL-02, READER-VISUAL-02B, ID-DEPLOY-01, first-party saved-state work, Personalization V2, MOTION-01 and ML ranking remain subject to their existing gates.

Off the main line: **PWA-01C serving contract** (gated by `ID-DEPLOY-01` or a waiver) and **NNW-05 multi-pane research** (REA only, no PR). Never mix PWA architecture, visual redesign, upstream sync and functional feed behavior in one PR.

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
- **ARTICLE_CODE_BLOCK_CONTROLS_HISTORICAL_FAILURE — NOT_REPRODUCED_CURRENTLY** (`PM_REPORTED`): on the exact current baseline `d7c0fc8e…` the focused `scripts/article-code-block-controls.test.js` passes 3/3 and `node --test scripts/*.test.js` passes 48/48 in the latest backend diagnostic. It is **not** recorded as a known failing test. Historical note preserved: in a cloud-container session (Node v22.22.0, pnpm 11.21.0) the same test failed on pristine `16311d0d…` and still failed on the `d7c0fc8e…` code, with a Vite SSR error resolving the named export `Select` from `@arco-design/web-react` inside `CodeBlock.jsx`; the 46-vs-48 test counts differ only because a file that fails to load counts as one failure instead of its three tests (45 + 3 = 48). Environment/toolchain sensitivity therefore remains possible (cause not established).
- The React 19 `element.ref` warning remains an incidental harness warning. Classify it as non-blocking backlog; no fix is claimed in this reconciliation.
- **MOBILE-SCROLL-FLICKER-01 — OPEN:** replay is blocked by `MISSING_GENERATED_VERSION_INFO`; no physical iPhone gate was run and root cause remains unknown. Future optional NAV-VISUAL PR6 glass expansion remains blocked.
- **TABLET-HEADER-WIDTH-01 — CLOSED by PR #76** (PM review of PR #86; PR #76 is in current production ancestry, `PM_REPORTED`). Historical record preserved: an approximately 370 px header width with unused space was confirmed at 768×1024, 884×1104, 900×1100 and 992×1104 without overflow, and the earlier plan targeted NAV-VISUAL-01 / PR4 MEDIUM-RAIL; the PR #76 change to `Content.jsx` supersedes that plan.
- **DOCS-LINT-01 — COMPLETED:** PR #75 formatted the three existing superpowers documents; this is no longer the current primary track. Any newly observed formatter findings require fresh verification.
- **ABOUT-ACCESSIBLE-BRAND-01 — COMPLETED:** PR #65 corrected the accessible NewsFlux GitHub link label in all six shipped locales; no longer an open finding.
- **RUNTIME-IDENTITY-02 — CLOSED / NON-PRODUCT:** `OLD_DOCUMENT_SESSION`; the old loaded document continued running old JavaScript while fresh asset requests returned the R5 asset. Server, asset, Service Worker and Cache Storage were not the cause.
- **HOME-HARNESS-STABILITY-01 — OPEN:** deterministic baseline failures and intermittent stability failures remain separate. Deterministic 10/10: `LIST_SEARCH_DATE_SORT_PRESERVED`, `READER_MEASURE_01_CPL`. Intermittent 6/10: `READER_VISUAL_01_WIDE_IMAGE`, `READER_MEASURE_01_DEFAULT_75_PARITY`, `READER_MEASURE_01_MEDIA_PROTECTION`. Root cause remains unknown.
- **ADD_FEED_DISCOVERY_DUPLICATE_URL_01 — RESOLVED by PR #83.**
- **MINIFLUX_DELETE_STATUS_01 — PR #84 MERGED:** retry hazard hardened; historical HTTP 404 causation remains high-confidence but unproven.
- **HOME_PAGINATION_CURSOR_STALL_01 — BACKLOG.**
- **HOME_DUP_ROOT_CAUSE_01 — CLOSED for the initial canonical Home duplicate-ID root cause by PR #77** (PM review of PR #86). This does **not** close unrelated pagination/cursor findings: `HOME_PAGINATION_CURSOR_STALL_01` remains BACKLOG.
- **FOOTERPANEL_CLIPPING — NEEDS REPRODUCTION.**
- **NAV_HARNESS_DESKTOP_MODEL — LOW PRIORITY.**
- **REACT19_ARCO_ELEMENT_REF — LOW PRIORITY.**
- **RESIZEOBSERVER — NEEDS REPRODUCTION.**
- **SOURCE_IDENTITY / STORY_IDENTITY — ARCHITECTURE / RESEARCH GATES; `SOURCE_IDENTITY` CONFIRMED.** `SOURCE_IDENTITY` is publisher/feed/source-level visual identity reused across the sidebar, list and reader and is planned as `NNW-01` inside the no-persistence constraint; `STORY_IDENTITY` (story-level identity and clustering semantics) stays out of `NNW-01`; anything needing storage stays gated.
- **PWA findings F2–F9 (classified, not fixed):** manifest/runtime theme-color mismatch (`PWA_THEME`); no maskable icon (`PWA_INSTALL`); update-aggressive service worker with an in-page reload path, unmeasured (`PWA_UPDATE`); SPA fallback masks missing assets as HTML and no explicit `Cache-Control` for `sw.js`/manifest (`PWA_SERVING`); navigation route without a denylist (`PWA_SCOPE`); plaintext `password` in `localStorage` (`SECURITY`, pre-existing); third-party icon fallback discloses hostnames and `getSecondHostname` mishandles multi-part suffixes (`PRIVACY` / `BUG`); per-profile `localStorage` means an installed iOS app does not share Safari's state (`STATE_PERSISTENCE`). See `PWA_ARCHITECTURE.md` §4.
- **DOCS_DRIFT — RESOLVED (PM review of PR #86):** PRs #74, #76 and #77 are listed as completed in Section 3.2; `TABLET-HEADER-WIDTH-01` is closed by PR #76, the initial Home duplicate-ID case of `HOME_DUP_ROOT_CAUSE_01` by PR #77, and the NAV route-focus slice is recorded as completed historical work (PR #74). `NEWSFLUX_NAV_VISUAL_01.md` retains its 2026-10-20 statements as history. `docs/UPSTREAM_TRACKING.md` does not exist.
- **PREFERENCE_STORAGE — ARCHITECTURE / SOURCE-OF-TRUTH / PRIVACY DECISION REQUIRED.**
- Broad source discovery remains **HOLD**; do not broaden personalized ranking without explicit architecture/product authorization.

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

## 13. Historical reconciliation snapshot: GitHub main and product/production state (2026-10-20)

Historical snapshot only: at the PR #73 reconciliation on 2026-10-20, GitHub `main` was `32244fa07b57c8bb3f5682f27b4d94917384ce63`, and the product/production baseline was `d01e34fc2eb76da39467d1de9799b12194faec9c`. These values and sequencing are superseded by the current 2026-10-21 snapshot below.

```text
DOCS_DATE=2026-10-20
DOCUMENTATION_SNAPSHOT_BASE_SHA=32244fa07b57c8bb3f5682f27b4d94917384ce63
GITHUB_MAIN_AT_RECONCILIATION=32244fa07b57c8bb3f5682f27b4d94917384ce63
CURRENT_PRODUCT_BASELINE=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCT_PRODUCTION_PARITY=PASS
MAIN_MAY_ADVANCE_WITH_DOCS_ONLY_COMMITS=YES
DEPLOY_REQUIRED_FOR_DOCS_ONLY_COMMITS=NO
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
PR70_SEQUENCE=AFTER_DOCS_LINT_01
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
PR73_SCOPE=DOCUMENTATION_ONLY
POST_PR72_MAIN_PRODUCT_BASELINE_RECONCILIATION=COMPLETED_BY_PR73

PRODUCTION_SHA=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_IMAGE=newsflux-local:d01e34fc2eb7
PRODUCTION_IMAGE_ID=sha256:d52df4be8afa1f39b79cd53f2e84466482fec3d3962fd8102d71e77e54427c
PRODUCTION_REVISION_LABEL=d01e34fc2eb76da39467d1de9799b12194faec9c
PRODUCTION_SOURCE_LABEL=https://github.com/jfsdias/NewsFlux
PRODUCTION_STATUS=running
HTTP_GATE=200
CANONICAL_COMPOSE_IMAGE=newsflux-local:d01e34fc2eb7
CANDIDATE_OVERRIDE_ACTIVE=NO
CANDIDATE_OVERRIDE_PRESERVED=YES
PERMANENT_PROMOTION=PASS
ROLLBACK_USED=NO
PRODUCT_PRODUCTION_PARITY=PASS
CANONICAL_RUNTIME_PARITY=PASS
RUNTIME_CANONICAL_PARITY=PASS

CURRENT_PRIMARY_TRACK=DOCS_LINT_01
CURRENT_PHASE=DOCUMENTATION_MAINTENANCE
CURRENT_TRACK=DOCS_LINT_01_FORMATTING_ONLY
KEYBOARD_TOUCH_PARITY_STATUS=COMPLETED
INPUT_01A_STATUS=COMPLETED
INPUT_PARITY_ESCAPE_FOCUS_STATUS=COMPLETED
INPUT_PARITY_TOUCH_TARGET_01_STATUS=COMPLETED
NEXT_FUNCTIONAL_CANDIDATE=READER-MEDIA-01A / PR #70 (AFTER_DOCS_LINT_01)
TOUCH_TARGET_REQUIREMENT=>=44px interaction target
MARK_ALL_UNDO_JUMP_01_STATUS=INVESTIGATED_NO_REPRODUCTION_ON_CURRENT_BASE
MARK_ALL_UNDO_JUMP_01_DISPOSITION=HOLD_FOR_REAL_REPRO_EVIDENCE
CURRENT_PRODUCT_PR=NONE
OPEN_RUNTIME_PR=NONE

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
```

At the reconciliation snapshot, GitHub `main` was `32244fa07b57c8bb3f5682f27b4d94917384ce63`, while the product and production baseline was `d01e34fc2eb76da39467d1de9799b12194faec9c`. Documentation-only merges may advance `main` without changing the product/runtime baseline or requiring deployment. No candidate override is active, the archived candidate override remains preserved, and product/production parity remains intact. NAV-VISUAL PR0/PR1 are complete, and remaining slices retain their separate authorization gates. `NAV_CONTRACT_DRIFT_01` is resolved as an accepted current-baseline exception; future glass gates remain separate and `MOBILE-SCROLL-FLICKER-01` remains open.

## 14. Original pre-reconciliation snapshot: GitHub main and product/production state (2026-10-21)

```text
GITHUB_MAIN=313991e80c2b54a99819c2e267ef90a35a959752
CURRENT_PRODUCT_BASELINE=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PRODUCTION_SHA=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PRODUCTION_IMAGE=newsflux-local:dc72a6ed0069
PRODUCTION_IMAGE_ID=sha256:3ada4fb3ef18c3fd1398a67aa6ce5118c8cb88c6533775e534779cb820bde83b
PRODUCTION_STATUS=running
INTERNAL_HTTP=PASS
PUBLIC_HTTP=200
PRODUCTION_REVISION_LABEL=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
EXACT_IMAGE_REVISION=PASS
PRODUCT_PRODUCTION_PARITY=PASS
MAIN_AHEAD_OF_RUNTIME_REASON=DOCUMENTATION_ONLY_PR79
DEPLOY_REQUIRED_FOR_PR79=NO
OPEN_PRS_AT_SNAPSHOT=NONE

PR70_STATUS=MERGED
PR70_MERGE_SHA=2a858ede20e02c2c6532fa32bae4468cb64c30ea
PR75_STATUS=MERGED / DOCS_LINT_01_COMPLETED
PR75_MERGE_SHA=8807469296db5815b9fc6e961d4f12275234574b
PR79_STATUS=MERGED / DOCUMENTATION_ONLY
PR79_HEAD_SHA=4e25d25ba945666adbe741b98483ef54cd64682f
PR79_MERGE_SHA=313991e80c2b54a99819c2e267ef90a35a959752
PR80_STATUS=CLOSED_WITHOUT_MERGE / RESEARCH_ONLY
PR80_HEAD_SHA=5dda6c6abb47bf829dafc646e33fa6c6713ad9c1
PR80_PRODUCT_AUTHORITY=NO
PR80_G1_RECALL_AT_5=0.075
PR80_G1_RECALL_AT_10=0.125
PR80_G1_MRR=0.057
PR80_G2=NO_USEFUL_SIGNAL
BROAD_SOURCE_DISCOVERY=HOLD
PR81_STATUS=MERGED_DEPLOYED_VALIDATED
PR81_MERGE_SHA=dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8
PR81_FEATURE=ADD-FEED-DISCOVER-01

CURRENT_PHASE=PROJECT_STATE_RECONCILIATION
CURRENT_PRIMARY_TRACK=DOCUMENTATION_MAINTENANCE
CURRENT_PR=NONE_BEFORE_THIS_RECONCILIATION
LAST_COMPLETED_FUNCTIONAL=ADD-FEED-DISCOVER-01 / PR #81
LAST_COMPLETED_DOCUMENTATION=RESEARCH_ARCHIVE / PR #79
NEXT_FUNCTIONAL_TRACK=DEDICATED_UPSTREAM_SYNC
NEXT_UPSTREAM_ITEM=ADAPT_3b2b08fb_EMPTY_CAPTION_ELEMENT_RENDERING
NEXT_UPSTREAM_ITEM_INTEGRATED=NO
3b2b08fb_NOT_INTEGRATED=YES

UPSTREAM_MAIN=3b2b08fb6036ef94f92a757ac6f3df889be8515c
UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_INTEGRATED_UPSTREAM_SHA=0887f714c36cc6c999f8b4559fa14c7948598629
LAST_UPSTREAM_SYNC_PR=11
LAST_UPSTREAM_SYNC_MERGE_SHA=cef9d8faf543d297e3393b1de314c57b01d99af9
PR11_AA68CB53=INTEGRATED_FILTERED_EMPTY_COUNTS
PR11_6963069B=INTEGRATED_MARK_ALL_FILTER_SESSION_HARDENING
PR11_B587A964=INTEGRATED_MUTATION_TOTAL_REFRESH
PR11_0887F714=RETAINED_IN_UPSTREAM_ANCESTRY
PR11_SEARCH_AUTOFOCUS_TREE_CHANGE=SKIPPED_EQUIVALENT_BEHAVIOR_ALREADY_EXISTED
NEXT_UPSTREAM_AUDIT_FROM=3b2b08fb6036ef94f92a757ac6f3df889be8515c
NEXT_UPSTREAM_CLASSIFICATION=ADAPT_LOW_RISK_NOT_YET_INTEGRATED

DOCS_LINT_01_STATUS=COMPLETED_BY_PR75
BROAD_SOURCE_DISCOVERY=HOLD
PERSONALIZED_RANKING=NO_BROADENING_WITHOUT_EXPLICIT_AUTHORIZATION
```

This original 2026-10-21 pre-reconciliation snapshot preserves `OPEN_PRS_AT_SNAPSHOT=NONE` as observed before that reconciliation began; it is not the live candidate state. PR #79 advanced GitHub `main` without changing the product/runtime baseline, and no deployment was required for docs-only advancement. The live PR #82/#83/#84 state and current integration order are recorded separately in Section 15. The dedicated upstream-sync item remains queued, not integrated. This documentation-only reconciliation does not authorize a merge or deploy.

## 15. Historical: active parallel candidates and integration order (2026-10-22 morning; superseded by Section 16)

The 2026-10-21 snapshot above is retained as the original pre-reconciliation record. Live GitHub state checked on 2026-10-22 shows PR #82 open as a Draft documentation reconciliation, with two isolated, PM-reviewed Draft candidates behind it. PR #84 handles backend delete-contract hardening; PR #83 handles duplicate-URL presentation polish after the backend refresh. Neither is merged or deployed.

```text
LIVE_GITHUB_MAIN=313991e80c2b54a99819c2e267ef90a35a959752
PR82_STATUS=OPEN_DRAFT
PR83_STATUS=OPEN_DRAFT
PR83_TRACK=ADD-FEED-DISCOVERY-UX-01
PR83_HEAD=07883336becf7f16855af5736da4dafb33a34146
PR83_PM_REVIEW=PASS
PR83_MERGED=NO
PR83_DEPLOYED=NO
ADD_FEED_DISCOVERY_DUPLICATE_URL_01=ACTIVE_CANDIDATE_PR83_NOT_YET_RESOLVED_IN_MAIN
PR84_STATUS=OPEN_DRAFT
PR84_TRACK=MINIFLUX-DELETE-CONTRACT-01
PR84_HEAD=1328e5f469b322c6059e7e998a1dff9aa8eb4f00
PR84_PM_REVIEW=PASS
PR84_MERGED=NO
PR84_DEPLOYED=NO
MINIFLUX_DELETE_STATUS_01=ACTIVE_CANDIDATE_PR84_NOT_YET_RESOLVED_IN_MAIN
MINIFLUX_DELETE_RETRY_HAZARD_CONFIRMED=YES
HISTORICAL_404_CAUSATION=HIGH_CONFIDENCE_NOT_PROVEN
ACTIVE_PARALLEL_CANDIDATES=PR83_ADD_FEED_DISCOVERY_UX_01;PR84_MINIFLUX_DELETE_CONTRACT_01
CURRENT_INTEGRATION_ORDER=PR82_DOCUMENTATION;PR84_BACKEND;PR83_DESIGN_AFTER_REFRESH;DEDICATED_UPSTREAM_SYNC_3b2b08fb
NEXT_ORDERED_MAINTENANCE_AFTER_ACTIVE_CANDIDATES=DEDICATED_UPSTREAM_SYNC_3b2b08fb
UPSTREAM_3b2b08fb_STATUS=QUEUED_NOT_INTEGRATED
```

The dedicated upstream sync for `3b2b08fb` remains queued after the active candidates; it is not cancelled or permanently deprioritized. The order is a sequencing record, not authorization to merge or deploy any candidate.

This section is superseded: PR #82, PR #83, PR #84 and the dedicated upstream item (PR #85) are all merged. See Section 16.

## 16. Current reconciliation snapshot (2026-10-22, post-PR #85)

Production and runtime values are `PM_REPORTED` and are not independently verifiable from the repository; the merge facts are verified from git history.

```text
DOCS_DATE=2026-10-22
CURRENT_MAIN=d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc
PRODUCTION_SHA=d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc
PRODUCT_PRODUCTION_PARITY=PASS
PR85_STATUS=MERGED_DEPLOYED_VALIDATED
PR85_RUNTIME_ACCEPTANCE=PASS
UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_INTEGRATED_UPSTREAM_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
LAST_UPSTREAM_SYNC_PR=85
LAST_UPSTREAM_SYNC_MERGE_SHA=d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc
UPSTREAM_CYCLE=CLOSED

PR82_STATUS=MERGED
PR83_STATUS=MERGED
PR84_STATUS=MERGED
PR74_STATUS=COMPLETED_HISTORICAL_NAV_ROUTE_FOCUS_SLICE
PR76_STATUS=COMPLETED_CLOSES_TABLET_HEADER_WIDTH_01
PR77_STATUS=COMPLETED_CLOSES_INITIAL_CANONICAL_HOME_DUPLICATE_IDS
TABLET_HEADER_WIDTH_01=CLOSED_BY_PR76
HOME_DUP_ROOT_CAUSE_01=CLOSED_INITIAL_CANONICAL_HOME_DUPLICATE_IDS_BY_PR77
HOME_PAGINATION_CURSOR_STALL_01=BACKLOG_NOT_CLOSED_BY_PR77
ARTICLE_CODE_BLOCK_CONTROLS_HISTORICAL_FAILURE=NOT_REPRODUCED_CURRENTLY
OPEN_PRS_BEFORE_PLANNING_DOCS_PR=NONE

PWA_FOUNDATION=PLANNED
NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT
PWA_PARTIALLY_EXISTS_IN_MAIN=YES
PWA_IMPLEMENTATION_AUTHORIZED=NO
NNW_IMPLEMENTATION_AUTHORIZED=NO
PM_REVIEW_PR86=PASS_WITH_DOCUMENTATION_AMENDMENTS
PWA_00_AUTHORIZED_PLANNING_VALIDATION_CANDIDATE=YES
PWA_01A_AUTHORIZED=NO
PWA_03A_OUTRANKS_PWA_01A_IF_PWA_00_CONFIRMS_MIDREAD_RELOAD=YES
RECOMMENDED_FIRST_IMPLEMENTATION_PR=NONE_AUTHORIZED
PWA_00_STARTED=YES
PWA_00_RESULT=LOCAL_AND_REPO_BASELINE_RECORDED__PUBLIC_ORIGIN_NOT_MEASURED
PWA_00_MEASURED_AGAINST_MAIN=68b39798fa6d823b2e5b1286aa42d4309c21c2ca
MID_READING_UPDATE_DISRUPTION=CONFIRMED_LOCAL_EXPERIMENT
PWA_03A_PRIORITY_RECOMMENDATION=YES
SOURCE_IDENTITY_DEFINITION=CONFIRMED_PUBLISHER_FEED_SOURCE_LEVEL_VISUAL_IDENTITY
STORY_IDENTITY_IN_NNW01=NO

PRODUCTION_TOPOLOGY=PARTIALLY_RESOLVED_PM_REPORTED
PUBLIC_ORIGIN=https://news.jfsdias.ddns.net/
TLS_REVERSE_PROXY=NGINX_PROXY_MANAGER
DOCKER_NETWORK=npm-proxyyml_default
INTERNAL_SERVICE=http://newsflux:2000
PRODUCTION_IMAGE_CONTRACT=EXACT_newsflux-local_SHORTCOMMIT_NEVER_LATEST_OR_BRANCH
MINIFLUX_SAME_ORIGIN_AS_NEWSFLUX_ASSUMED=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO

DOCUMENTATION_ACTION=UPDATE_IN_SCOPE
DOCUMENTATION_REASON=UPSTREAM_CYCLE_CLOSED_AND_NEW_ARCHITECTURE_TRACKS_INTRODUCED
DOCUMENTATION_TARGETS=NEWSFLUX_PROJECT_STATE.md;NEWSFLUX_ROADMAP.md;PWA_ARCHITECTURE.md;DESIGN_REFERENCES.md
DOCUMENTATION_BLOCKS_NEXT=NO
PROJECT_STATE_RECONCILED=YES
```

These tracks do **not** authorize implementation: `PWA_FOUNDATION=PLANNED` and `NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT` record that the work is accepted for planning and design input only. The PM review of PR #86 (PASS WITH DOCUMENTATION AMENDMENTS) names `PWA-00` as the next authorized planning/validation candidate; `PWA-01A` is not yet authorized, and a confirmed mid-reading reload in `PWA-00` would put `PWA-03A` ahead of manifest/icon polish.
