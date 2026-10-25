# NewsFlux Roadmap

- **Status:** canonical roadmap reconciled after PR #129 (STORY-01B-R); current state and sequencing are in Section 23.
- **Created:** 2026-10-15.
- **Last reconciled:** 2026-10-25.
- **Reconciled against (current):** GitHub `main` at `de138bc961d665005fe3322082034963bf263b16`. The production baseline remains `dc4154d7729204c65c8a1abaa50f9bfc9f92be64` (image `newsflux-local:dc4154d77292`); main/production SHA parity is **NO**, while there is no application runtime delta since production and PR #129 requires no deployment.
- **Previously reconciled against (historical, post-PR #128):** GitHub `main` at `dc4154d7729204c65c8a1abaa50f9bfc9f92be64`; production at `dc4154d7729204c65c8a1abaa50f9bfc9f92be64`. The earlier post-PR #120, post-PR #108 and post-PR #96 snapshots and prior states are preserved below; see Sections 19–22.
- **Purpose:** preserve completed work, accepted findings, sequencing, architecture/product gates, upstream baseline, and the next recommended action without turning the roadmap into implementation authorization.
- **Related planning documents:** [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) (PWA Foundation architecture contract) and [`DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (NetNewsWire UX research track). Both are planning documents and authorize no implementation.

This document is the canonical **roadmap**, not an implementation authorization. Detailed design decisions remain in the dedicated design documents and implementation plans remain in `docs/superpowers/plans/` where present.

For present execution status, current PRs and audit outcomes, Section 23 is authoritative. Earlier status tables and snapshots, including Sections 18–22, are retained as historical records; they do not override Section 23.

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

### 3.2 Historical PR history snapshot (completed through PR #91 before later PWA work)

| PR   | Track                                      | Status                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #20  | BULK-01                                    | **COMPLETED**                      | Footer Mark All Read Undo; generation-scoped notification IDs; acknowledged-ID undo                                                                                                                                                                                                                                                                                                                                                    |
| #21  | ID-01R                                     | **COMPLETED**                      | Repository/document provenance and translated README reconciliation                                                                                                                                                                                                                                                                                                                                                                    |
| #22  | Documentation                              | **COMPLETED**                      | Canonical roadmap red-team R2 reconciliation                                                                                                                                                                                                                                                                                                                                                                                           |
| #23  | A11Y-RT-01                                 | **COMPLETED**                      | Reduced-transparency dark/OLED specificity fix                                                                                                                                                                                                                                                                                                                                                                                         |
| #24  | LIST-VISUAL-01 / monogram subset           | **COMPLETED**                      | Deterministic favicon monogram fallback                                                                                                                                                                                                                                                                                                                                                                                                |
| #25  | CHROME-01A / DatePicker subset             | **COMPLETED**                      | NewsFlux token styling for DatePicker                                                                                                                                                                                                                                                                                                                                                                                                  |
| #26  | Upstream sync                              | **COMPLETED**                      | Adapted upstream article code-block experience through `3045a5f8...`                                                                                                                                                                                                                                                                                                                                                                   |
| #27  | BULK-01F                                   | **COMPLETED**                      | Footer Mark All Read focus restoration                                                                                                                                                                                                                                                                                                                                                                                                 |
| #28  | LIST-VISUAL-01A                            | **COMPLETED**                      | Read-state + metadata/source hierarchy cohesion across Column/Card/List                                                                                                                                                                                                                                                                                                                                                                |
| #29  | Documentation                              | **COMPLETED**                      | Roadmap/project-state reconciliation after PR #28 production promotion                                                                                                                                                                                                                                                                                                                                                                 |
| #30  | BULK-01B                                   | **COMPLETED**                      | Sidebar Feed/Category Mark All confirmation + safe shared Undo; race hardening; exact merge-SHA deployed                                                                                                                                                                                                                                                                                                                               |
| #32  | ID-RUNTIME-01                              | **COMPLETED**                      | Approved head `1237f77ff2566015ef50939e268c4ec19f66fe88`; merged/deployed as `099bdcb0483ef516f6c325e67eefb41b618a4713`; post-merge browser smoke passed                                                                                                                                                                                                                                                                               |
| #34  | A11Y-01                                    | **COMPLETED**                      | Approved head `c62ce9160c928eedcdb09d25a1271253c8baf91c`; merged/deployed as `7b0a7e04d1e1052c33ccb23559467f1ed2dc9ac0`; tree parity, exact-SHA promotion and authenticated post-merge smoke passed                                                                                                                                                                                                                                    |
| #36  | HARNESS-UNDO-ID-01                         | **COMPLETED**                      | Feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`; merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`; repaired all nine stale fixed-notice-ID assertions (29/29)                                                                                                                                                                                                                                                                  |
| #38  | RUNTIME-BASE-01                            | **COMPLETED**                      | Feature head `07237ba7e8c773e9de88e9c533296b9700dde287`; merge `1af58a53c6fd85bcca95ec44a56e23c7c02b6145`; pins Node 24.22.0 Alpine 3.24 and Caddy 2.11.7 by digest                                                                                                                                                                                                                                                                    |
| #39  | FILTER-01B                                 | **COMPLETED**                      | Date/status filter transition behavior; merged as `cfef27e50fae9a153151cfc91bd0bf92c1270a37`                                                                                                                                                                                                                                                                                                                                           |
| #40  | FEED-HEALTH-01A                            | **COMPLETED**                      | Miniflux-reported feed update error indicator; merged as `2947169a68e5193f4cd9273d0bb7ed0faef00623`                                                                                                                                                                                                                                                                                                                                    |
| #41  | READER-VISUAL-02A1                         | **COMPLETED**                      | Editorial typography foundation; merged as `3f72d554177c10c9eee16649ea7297495b4f6977`                                                                                                                                                                                                                                                                                                                                                  |
| #42  | NAV-02 harness maintenance                 | **COMPLETED**                      | Mark-All expectation aligned with current batching; merged as `a21726365ce80b3f7883907228e27d9c5f693a87`                                                                                                                                                                                                                                                                                                                               |
| #43  | BULK-03A                                   | **COMPLETED**                      | Mark articles above/below as read; merged as `978d7b009755ae6750ce84b1e172792703e98e4f`                                                                                                                                                                                                                                                                                                                                                |
| #44  | READER-MEASURE-01                          | **COMPLETED**                      | Bounded responsive prose measure; merge and production promotion at `118ecb2c63f7df3583d0f2524b5cc8c62bd518c1`                                                                                                                                                                                                                                                                                                                         |
| #45  | Documentation                              | **COMPLETED**                      | Prior post-Reader Measure reconciliation, merge `c062a4ee9f7967ef254fde2cb2ed1ca2207735e9`; superseded by this post-BULK-03B reconciliation                                                                                                                                                                                                                                                                                            |
| #46  | READER-KEY-01                              | **COMPLETED**                      | Feature head `bbcbc3f51e66793e617d7286d4785a5eb5611091`; merge `3e21cbb197efbca0b577e06c705a1ef9997cb597`; layered Escape complete                                                                                                                                                                                                                                                                                                     |
| #47  | STATE-ERR-01                               | **COMPLETED**                      | Feature head `379fa241d8fa1a4d6d9e216c374b6409322a573d`; merge `e59295501cc51a6df2b64a435c0c32eb5431aed5`; unavailable-entry 404 behavior complete                                                                                                                                                                                                                                                                                     |
| #48  | CONTENT-01                                 | **COMPLETED**                      | Feature head `1032b5409298629382685a85935b85fdc2292f85`; merge `9f521edfd5f031e8e833a4854d896acc42a22fae`; deterministic untitled fallback complete                                                                                                                                                                                                                                                                                    |
| #49  | READER-VISUAL-02A2                         | **COMPLETED**                      | Feature head `cafe47e1ae19b6a203e8aef35339931015614c7c`; merge `e4752d290bdfb4961d379dd05548ef3da5da42ba`; quiet header aligned to prose column                                                                                                                                                                                                                                                                                        |
| #50  | BULK-03B                                   | **COMPLETED**                      | Feature head `dd9e68650f3f40080199b90107c2b35722166697`; merge `a8dbe15497f7d526298f223188955b82589a84a4`; 1/7/30-day age presets, strict cutoff, full discovery, scoped writes, acknowledged-only Undo                                                                                                                                                                                                                                |
| #51  | Documentation                              | **COMPLETED**                      | Project-state and roadmap reconciliation after BULK-03B; merge `0d3b1e9648d59018cdd1f9f17948c7d34b19924b`                                                                                                                                                                                                                                                                                                                              |
| #52  | FEED-HEALTH-01B                            | **COMPLETED**                      | Feature head `1b03865311993f7e72df0632ea662bbe94e926e9`; merge `051e461d1d1eb4408e15a0ebcd4e1331b546de7a`; provider-backed details/Retry and one final metadata reconciliation after bulk refresh                                                                                                                                                                                                                                      |
| #53  | Selective upstream maintenance             | **COMPLETED**                      | Feature head `f4db01106ca28fca3b7340be45cb87fa4059845d`; merge `046cd647c65583cdfdc7ab282701be79d4b34294`; pnpm hardening integrated, setup-node pin adapted                                                                                                                                                                                                                                                                           |
| #55  | FILTER-RULES-01                            | **COMPLETED**                      | Feature head `5b6abe28ae5e6b52f02461c4e3601165056900b1`; merge `1021cd5746eba2b3b90b1a863bada9043f126be1`; provider-backed per-feed raw Miniflux block/keep rules, no NewsFlux rule persistence                                                                                                                                                                                                                                        |
| #57  | BULK-02                                    | **COMPLETED**                      | Session multi-select; merge `85b9590bbc9f4d3488fd30694b0b45553fefda5b`                                                                                                                                                                                                                                                                                                                                                                 |
| #58  | MARK-ALL-REFRESH-01                        | **COMPLETED**                      | Suppresses transient empty state during the next-unread jump; merge `df4bea4dde5cca86a4b822d2e82f01156bb96f1a`; Undo-after-jump concern later investigated with no current defect reproduced                                                                                                                                                                                                                                           |
| #59  | HOME-01                                    | **COMPLETED**                      | Refresh, focus, reconnect and editorial-session continuity; merge `114eed13c5f66cd57a4448ece935de6cb5f4a11e`                                                                                                                                                                                                                                                                                                                           |
| #60  | NAV01                                      | **COMPLETED**                      | Canonical reader previous/next and next-unread continuity; merge `31c95ff835da3e716acfd6eb115db5c3b68dd71c`                                                                                                                                                                                                                                                                                                                            |
| #61  | INPUT-01a                                  | **COMPLETED**                      | Shared reader-command ownership; head `e2cbab710f00eb84c77b3df4ddc9701839a677d9`, merge `194a1db007902411abe91459b45a19b10c76e701`                                                                                                                                                                                                                                                                                                     |
| #62  | Documentation                              | **COMPLETED**                      | Post-PR65 reconciliation; merged as `389ed58731c38ffff8ceda0d0347222336960f3a`                                                                                                                                                                                                                                                                                                                                                         |
| #63  | ABOUT-RUNTIME-REVISION-01                  | **COMPLETED**                      | Feature head `9a64e9b45c6c76e6765fdaf82ee02c30f3bc57c8`; merge `723bdbb96e4445d267b443422a0be7a83e5b4f8a`; exact build identity, live About validation and production promotion passed                                                                                                                                                                                                                                                 |
| #64  | INPUT-PARITY-ESCAPE-FOCUS                  | **COMPLETED**                      | Feature head `ee412912ad43d4902459b12151bad81c570d58cf`; merge `23474d3f83c01c4355c892f46c77d2f66b046af0`; FooterPanel Escape/focus live canary passed at 390×844, 884×1104 and 1280×800                                                                                                                                                                                                                                               |
| #65  | ABOUT-ACCESSIBLE-BRAND-01                  | **COMPLETED**                      | Feature head `8a4d1cf358d39524e95027b13e10c0205b9aea27`; merge `405e9d7b1a3097dacef50c7908abf83d480d64dd`; six-locale accessible NewsFlux GitHub label correction; exact merge-SHA promotion passed                                                                                                                                                                                                                                    |
| #66  | Mark All cold-loaded All                   | **COMPLETED**                      | Feature head `1b6449597179ab3c832d0c658048d46f8bddda93`; merge `0553119de95ab5b9c2e131bbb4b2ef1d0ef58456`; current-list identity and filtered unread total reconciliation                                                                                                                                                                                                                                                              |
| #67  | INPUT-PARITY-TOUCH-TARGET-01               | **COMPLETED**                      | Feature head `ec15233215043d6a054cb6fb5eb43eebe8b1442e`; merge `7b6e474fcd50bb891e429a632849da371e126590`; interaction targets corrected with inert gaps preserved                                                                                                                                                                                                                                                                     |
| #68  | Harness maintenance                        | **COMPLETED**                      | Feature head `104671b51f99d0ad7c33d3514f8d4b2ad3558aee`; merge `b6b814c77160c2e61dedc7c10958f0712f59d728`; stale provider/button assumptions corrected                                                                                                                                                                                                                                                                                 |
| #69  | NAV-VISUAL PR0                             | **COMPLETED**                      | Feature head `b550634066ed129e4bb0e9b3ca18842469cb493e`; merge `cf37807a4d3b9da39d3c438861fac358d936fdaa`; window-class foundation                                                                                                                                                                                                                                                                                                     |
| #70  | READER-MEDIA-01A                           | **COMPLETED**                      | Merged as `2a858ede20e02c2c6532fa32bae4468cb64c30ea`; deferred media/player initialization completed                                                                                                                                                                                                                                                                                                                                   |
| #71  | NAV-VISUAL PR1                             | **COMPLETED**                      | Feature head `4712b3e49c94f560c0e83ce7c8519eb6bda9cba0`; merge and product/production promotion `d01e34fc2eb76da39467d1de9799b12194faec9c`; compact navigation and Reader/Drawer focus/resize hardening                                                                                                                                                                                                                                |
| #72  | Documentation                              | **COMPLETED**                      | Post-PR71 state reconciliation; docs-only merge `32244fa07b57c8bb3f5682f27b4d94917384ce63`; no deployment required                                                                                                                                                                                                                                                                                                                     |
| #74  | NAV-PR1-ROUTE-FOCUS-01 fix                 | **COMPLETED**                      | Merge `b6b7246642aa5ff15f3f8e7015d2efbd83a47be5` (head `0ee182ae4435a3928ffe9d3b1d06b8cb476fcbcb`); restores meaningful focus after drawer navigation. Recorded as completed historical NAV route-focus work (PM review of PR #86); absent from earlier snapshots                                                                                                                                                                      |
| #75  | DOCS-LINT-01                               | **COMPLETED**                      | Formatting-only reconciliation of three existing superpowers docs; merge `8807469296db5815b9fc6e961d4f12275234574b`                                                                                                                                                                                                                                                                                                                    |
| #76  | TABLET-HEADER-WIDTH-01 fix                 | **COMPLETED**                      | Merge `831ff514c3a572a41cd857dd51ffd4f5c87663c1` (head `cf09491e4875cdcc94bf8235db752499ddba5003`); expands the tablet list header to content width (`Content.jsx`). **Closes `TABLET-HEADER-WIDTH-01`** (PM review of PR #86); in current production ancestry (`PM_REPORTED`); absent from earlier snapshots                                                                                                                          |
| #77  | HOME id-only initial entries               | **COMPLETED**                      | Merge `e1c1285e717e626fc759b0bb52431cd9321df334` (head `82062eee246cf58def1ea5681dd90cbd530f2dde`); deduplicates initial Home entries by id. **Closes the initial canonical Home duplicate-ID root cause** (`HOME_DUP_ROOT_CAUSE_01` insofar as it referred to that case); does **not** close unrelated pagination/cursor findings (`HOME_PAGINATION_CURSOR_STALL_01` remains BACKLOG); in current production ancestry (`PM_REPORTED`) |
| #79  | Research archive                           | **COMPLETED**                      | Durable research archive and post-PR81 reconciliation; docs-only merge `313991e80c2b54a99819c2e267ef90a35a959752`                                                                                                                                                                                                                                                                                                                      |
| #80  | Discovery Benchmark V1                     | **CLOSED, NO MERGE**               | Research-only harness; no product authority. G1 remained a limited research signal, G2 had no useful signal; broad discovery remains HOLD.                                                                                                                                                                                                                                                                                             |
| #81  | ADD-FEED-DISCOVER-01                       | **COMPLETED**                      | Merged, deployed and validated as `dc72a6ed0069b539877f5b2b1f1327d66ad7d0a8`; website discovery requires explicit confirmation/selection before subscription.                                                                                                                                                                                                                                                                          |
| #82  | Documentation                              | **COMPLETED**                      | Project-state/roadmap reconciliation after PR #81; docs-only merge `68c1ef3c5d86bb1495c98da19f036215ac0c722d` (head `db272f58d4bb72749d1bf1a0ea1eaedbf6e84d8a`); no deployment required                                                                                                                                                                                                                                                |
| #83  | ADD-FEED-DISCOVERY-UX-01                   | **COMPLETED**                      | Merge `16311d0d6c3e2611fa09380ded33e63795ba0270` (head `935b1100ddb7f51358b41c7f575f0fe04a4fe25d`); duplicate-URL presentation polish resolved; included in production SHA `d7c0fc8e…` (`PM_REPORTED`)                                                                                                                                                                                                                                 |
| #84  | MINIFLUX-DELETE-CONTRACT-01                | **COMPLETED**                      | Merge `9b6f98cee745c2fed8dbe73cee2b1f2e4ad29ac7` (head `7f695d453e414057be6b6ed7e934e50f676ff0d6`); feed-deletion contract hardening (`src/apis/feeds.js`); historical 404 causation remains high-confidence but unproven                                                                                                                                                                                                              |
| #85  | Upstream sync (ADAPT `3b2b08fb`)           | **COMPLETED**                      | Merge `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc` (head `7db4bcd8bc86b4f361890f13570003a4435547de`); empty `figcaption` elements render without children; merged, deployed and runtime-accepted (`PM_REPORTED`); upstream cycle closed                                                                                                                                                                                                  |
| #86  | PWA Foundation / NetNewsWire planning      | **COMPLETED**                      | Documentation-only merge `326f9be1dbc1c41d75cc3f76e149cc6bfa7db6c1`; PWA-00 and design research recorded, no implementation authority                                                                                                                                                                                                                                                                                                  |
| #87  | HOME_CURSOR_TIE_DRAIN_V1                   | **COMPLETED**                      | Home-only timestamp-boundary recovery; merge `68b39798fa6d823b2e5b1286aa42d4309c21c2ca`                                                                                                                                                                                                                                                                                                                                                |
| #88  | PWA-00 runtime baseline                    | **COMPLETED**                      | Evidence/documentation-only merge `3a1b2db07d9df08b8dde9f3148a02e6eb703ec7c`                                                                                                                                                                                                                                                                                                                                                           |
| #89  | ARTICLE_LIST_TEMPORAL_TIE_DRAIN_V1         | **COMPLETED**                      | Non-Home `published_at`/`changed_at` tie recovery; merge `7da97c04d296ef2cdff225ec37833df362ca1139`                                                                                                                                                                                                                                                                                                                                    |
| #90  | PWA-03A1 update activation safety          | **COMPLETED**                      | User-controlled service-worker update prompt; merge `5ea21363676dd93dde97fd5ff8548e89864495ec`; included in current production rollback baseline                                                                                                                                                                                                                                                                                       |
| #91  | PWA-03A2A runtime asset cache integrity    | **MERGED; PRODUCTION ROLLED BACK** | Code merge `de8b4645df1b8ce17b4b02c2d54adb694af25109`; implementation remains valid, but rollout is blocked pending PWA-03A2C chunk recovery and a successful transition canary                                                                                                                                                                                                                                                        |
| #92  | Documentation                              | **COMPLETED**                      | Post-PR91 state reconciliation; merge `f630fe8843a16a9ff810662632a7b6f253285151`                                                                                                                                                                                                                                                                                                                                                       |
| #93  | PWA-03A2C chunk recovery                   | **COMPLETED**                      | Runtime asset cache chunk recovery; merge `950ae61b71433a6fd9c11fed9ed266a17fee3185`                                                                                                                                                                                                                                                                                                                                                   |
| #94  | PWA-03A2C1 chunk guard                     | **COMPLETED**                      | Chunk recovery error guard; merge `6a8068e9809cafdecce0c695c78dcb151d95d4a4`                                                                                                                                                                                                                                                                                                                                                           |
| #95  | PWA-03A2B canary                           | **COMPLETED**                      | Update activation canary; merge `96bd1fe563571bfa322b2fd79f6fc12f49107a76`                                                                                                                                                                                                                                                                                                                                                             |
| #96  | API-NONIDEMPOTENT-RETRY-01                 | **COMPLETED**                      | Non-idempotent retry safety; safe GET retries preserved; merge `fa27a4cec1cae1e887041ee3999622c5b8f76681`                                                                                                                                                                                                                                                                                                                              |
| #97  | Documentation                              | **COMPLETED**                      | Post-PR96 state reconciliation; merge `a02dd5e7f3aa30253e228c40180f1c8b9e2972b1`                                                                                                                                                                                                                                                                                                                                                       |
| #98  | Dependabot governance                      | **COMPLETED**                      | Upstream Dependabot configuration & governance; merge `231809c7a74b833718a87e0cb78091f89dd00570`                                                                                                                                                                                                                                                                                                                                       |
| #99  | NNW01-P source icon privacy                | **COMPLETED**                      | Remove third-party favicon fallback; no external network leakage; merge `cb0b200eb5cfd4d8b7e8af3b97a4fa57008b814f`                                                                                                                                                                                                                                                                                                                     |
| #100 | NNW01-A SourceMark primitive               | **COMPLETED**                      | SourceMark reusable primitive; deterministic monogram and fallback; merge `1430674d4322a1703e946bd5fc69c8c3f5bc2fee`                                                                                                                                                                                                                                                                                                                   |
| #101 | NNW01-B SourceMark adoption                | **COMPLETED**                      | SourceMark adoption in Sidebar and article lists; merge `c7dd7835f90f433323d2c0360c2d34528f95ab61`                                                                                                                                                                                                                                                                                                                                     |
| #102 | NNW01-C SourceMark adoption                | **COMPLETED**                      | Reader source identity and Settings source list adoption; merge `6316f0993c4e45cc84459d84d46a955f2a021dae`                                                                                                                                                                                                                                                                                                                             |
| #103 | NNW01-D SourceMark adoption                | **COMPLETED**                      | SourceMark in Feed header; closes NNW01 source identity track; merge `36a78492fec4a673394a7b2b03f4b0a48cde987e`                                                                                                                                                                                                                                                                                                                        |
| #104 | NNW-02A navigation density audit           | **COMPLETED**                      | Navigation density and tap-target baseline audit; merge `b3dcb3c29ad1bb2352381cf79065a8f07167346c`                                                                                                                                                                                                                                                                                                                                     |
| #105 | NAV-VISUAL PR4 medium rail                 | **COMPLETED**                      | 80px responsive Medium Navigation Rail for viewports 768px–991px; merge `06e76dcef0f29ed4a104bfe5a3a935719ec46575`                                                                                                                                                                                                                                                                                                                     |
| #107 | Coarse-pointer safety overrides            | **COMPLETED**                      | Min 48px navigation targets for coarse pointers; compact 40px preserved for fine pointers; merge `e50a6b9c494e9fd5c47baa24791249c3f30f5906`                                                                                                                                                                                                                                                                                            |
| #108 | NNW-02C keyboard semantics                 | **COMPLETED**                      | Native links, button disclosures, and keyboard navigation semantics in sidebar; merge `bc9f175a3447a67b06d7deee12c6e19374bb7664`                                                                                                                                                                                                                                                                                                       |
| #109 | Documentation                              | **COMPLETED**                      | Post-PR108 canonical project state and roadmap reconciliation; merge `701895fd690fd3833d0f4a5b1d5a09e22e9731a2`                                                                                                                                                                                                                                                                                                                        |
| #106 | Story candidate ranking integration        | **COMPLETED**                      | Local candidate ranking pipeline dormant integration; zero runtime cost when disabled; merge `4cb99e196f88b01602a7fa53575430dd74ec5f94`                                                                                                                                                                                                                                                                                                |
| #111 | Security response headers                  | **COMPLETED**                      | Caddy response-header baseline: X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin; merge `3c1eeb03501dd0993d201c588632fa3c59b0ff7e`                                                                                                                                                                                                                                                                 |
| #110 | NNW-05 multi-pane reference study          | **COMPLETED**                      | Multi-pane reference study; research document only; preserves single-pane-first boundary; merge `fac87b621a63393da6987cf89f6b85c12cede994`                                                                                                                                                                                                                                                                                             |
| #115 | Home Recent test stabilization             | **COMPLETED**                      | Stabilizes Home Recent empty-state recovery test harness in scripts/tests/phase2c-editorial-home.jsx (HARNESS_ONLY, PRODUCT_CODE_CHANGED=NO); merge `a62f53982dd7e0cff4fa2ee90a15574dc490a5d3`                                                                                                                                                                                                                                         |
| #116 | NAV-02F count semantics                    | **COMPLETED**                      | Plural-aware accessible count labels across locales (`Intl.PluralRules`); unresolved grouping/width on hold; merge `7c429766e24fd3fbb8a07e126f816d665d19b130`                                                                                                                                                                                                                                                                          |
| #117 | NNW-03 / CHROME-01 contextual controls     | **COMPLETED**                      | Contextual-chrome accessibility/touch-target hardening: FooterPanel radiogroup semantics, History visibility semantics, >=44x44 Home/SearchModal controls, and 12-surface control inventory; structural consolidation remains HOLD_PRODUCT_DECISION; merge `f79a4369677c45122faa8190269ff71eeec0ec76`                                                                                                                                  |
| #113 | Story Linux CPU runtime contract           | **COMPLETED**                      | CPU-only `torch==2.14.1+cpu` wheel; Policy E approved as contract; ranker runtime disabled; merge `dd2e9e6ec429d2a8c01a9736b3090b4d20f2c4eb`                                                                                                                                                                                                                                                                                           |
| #112 | AUTH_APIKEY_01 session migration           | **COMPLETED**                      | Dedicated API key provisioning; persistent fail-closed auth transaction journal; manual auth preserved; merge `3859e18d4744c7cbbdd97bdee9de3d6fe77ad99b`                                                                                                                                                                                                                                                                               |
| #114 | PWA-01A installability hardening           | **COMPLETED**                      | Cross-platform installability; D1/D2/D3 approved; real-device D3 gate PASS on Fold; non-blocking residuals recorded; deployed to production at `bf1f911f0e2d`; merge `bf1f911f0e2d405dbf84a04414a04cc0bc6530c9`                                                                                                                                                                                                                        |
| #123 | THEME_ACCENT_FAMILIES_01                   | **COMPLETED**                      | Editorial accent families (Gold, Crimson, Orange, Green, Blue, Violet); semantic tokens; resolves `A11Y_CONTRAST_COMPACT_NAV_01`; production promotion PASS at `104dd6bd0960`; merge `104dd6bd0960bd95bc2fab1500b6faf981f9d321`                                                                                                                                                                                                        |
| #124 | CHROME-01B feedback cohesion               | **COMPLETED**                      | Feedback and control cohesion across 6 locales, elevated dark confirm surfaces, mobile toast safe-area clearance, raw Arco control tokens, focus/selected semantic tokens; merge `44cca8127dfa3b0f4cb1285a69092f2c7e4a807d`                                                                                                                                                                                                            |
| #125 | READER-VISUAL-02B interaction chrome       | **COMPLETED**                      | Interaction-aware auto-hiding reader chrome; downward scroll hides ActionButtons, upward scroll/focus immediately restores; production smoke PASS; merge `99f108643f7bd4d31a991c868f2e66e66e519421`                                                                                                                                                                                                                                    |
| #126 | HARNESS-VIS-01A harness portability        | **COMPLETED**                      | Cross-platform real-browser discovery, explicit `CHROME_PATH` override support, actionable errors, and simulated multi-platform tests; merge `ba556d61bcf7dcdbfe1541cdbd40613b4ae43b9b`                                                                                                                                                                                                                                                |
| #127 | HARNESS-VIS-01B Arco selector fix          | **COMPLETED**                      | Feedback gate selector alignment with rendered Arco Design Web React roots (`.arco-message`, `.arco-notification`); merge `434f9519ad37dc499b2be8b0a3a64904389f5adf`                                                                                                                                                                                                                                                                   |
| #128 | NAV-02F-A unread source category rhythm    | **COMPLETED**                      | Category rhythm for unread feeds; non-collapsible category headers; preserves `showUnreadFeedsOnly` default (`false`), sidebar width, exact counts; production smoke PASS; merge `dc4154d7729204c65c8a1abaa50f9bfc9f92be64`                                                                                                                                                                                                            |
| #129 | STORY-01B-R NewsBlur ref & corpus contract | **COMPLETED**                      | Audited NewsBlur clustering reference (`d7c61b5b...`), Home-200 frozen corpus contract, pair universe (18,953), label queue (141), transitive chain candidates (12), offline deterministic harness; research only, zero product runtime changes; merge `de138bc961d665005fe3322082034963bf263b16`                                                                                                                                      |

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

| Package                  | Status             | Scope / remainder                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIST-VISUAL-01           | **COMPLETED**      | Monogram fallback (#24) + read-state/source/metadata cohesion (#28). Human-readable unread-count labels were rehomed to NAV-02F. No thumbnail redesign is authorized by this completion.                                                                                                                                                                                                                               |
| CHROME-01A               | **COMPLETED**      | DatePicker token subset completed in PR #25; NNW-03 contextual controls completed in PR #117.                                                                                                                                                                                                                                                                                                                          |
| CHROME-01B               | **COMPLETED**      | PR #124 merged and promoted at `44cca8127dfa3b0f4cb1285a69092f2c7e4a807d`. Feedback and control cohesion across 6 locales, elevated dark confirm surfaces, mobile toast safe-area clearance, raw Arco control tokens, focus/selected semantic tokens; primary button semantic safety strictly excludes danger/warning/success statuses from theme accents; touch target min-height >=44px; production validation PASS. |
| HOME-VISUAL-02           | **HOLD — PRODUCT** | Edition/category composition requires explicit editorial decision and HOME-01 dependency resolution                                                                                                                                                                                                                                                                                                                    |
| READER-VISUAL-02A        | **COMPLETED**      | 02A1 in PR #41, Reader Measure in PR #44, and 02A2 / Quiet Column in PR #49; real header/prose alignment validated on the production element                                                                                                                                                                                                                                                                           |
| READER-VISUAL-02B        | **IN PROGRESS**    | INTERACTION-AWARE READER CHROME: deterministic auto-hide on downward reading past threshold; immediate return on upward scroll, return to top, or focus entry; focus safety, reduced motion and liquid glass preserved; zero persistent state.                                                                                                                                                                         |
| NAV-VISUAL-01            | **IN PROGRESS**    | PR0 / #69 and PR1 / #71 complete; compact navigation is merged; Medium Rail / PR4 remains deferred; explicit future-slice gates remain required                                                                                                                                                                                                                                                                        |
| THEME_ACCENT_FAMILIES_01 | **COMPLETED**      | PR #123 merged and promoted at `104dd6bd0960bd95bc2fab1500b6faf981f9d321`. Editorial accent families (Gold, Crimson, Orange, Green, Blue, Violet); semantic tokens (`--nf-accent`, `--nf-accent-surface`, `--nf-accent-hover`, `--nf-accent-border`, `--nf-on-accent`); resolves `A11Y_CONTRAST_COMPACT_NAV_01`; perceptual R1 PASS across 390x844, 884x1104, 1280x800.                                                |
| READER-COVER-01          | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                                                                                                                                                                                                                                                      |
| READER-FONT-01           | **HOLD — PRODUCT** | Preserve the design-handoff hold; no implementation authorization                                                                                                                                                                                                                                                                                                                                                      |
| HARNESS-VIS-01           | **BACKLOG**        | Test debt; not ordered                                                                                                                                                                                                                                                                                                                                                                                                 |
| TEST-ENV-01              | **BACKLOG**        | Verification required; not ordered                                                                                                                                                                                                                                                                                                                                                                                     |
| MOTION-01                | **BACKLOG**        | View Transition/container transform after main interaction architecture stabilizes                                                                                                                                                                                                                                                                                                                                     |

#### THEME_ACCENT_FAMILIES_01 design and accessibility contract (COMPLETED)

PR #123 merged and promoted to production at `104dd6bd0960bd95bc2fab1500b6faf981f9d321`.

- **Status:** **COMPLETED**
- **PR:** #123
- **MERGE_SHA:** `104dd6bd0960bd95bc2fab1500b6faf981f9d321`
- **PRODUCTION_SHA:** `104dd6bd0960bd95bc2fab1500b6faf981f9d321`
- **PRODUCTION_PROMOTION:** PASS
- **PERCEPTUAL_R1:** PASS
- **MOBILE_390x844:** PASS
- **MEDIUM_884x1104:** PASS
- **DESKTOP_1280x800:** PASS
- **A11Y_CONTRAST_COMPACT_NAV_01:** RESOLVED
- **PR122_RUNTIME_REGRESSION_GATE:** PASS
- **Perceptual conclusions:**
  - Editorial Gold: PASS
  - Editorial Crimson: PASS
  - `CRIMSON_READS_AS_DESTRUCTIVE`: NO

Isolated design and accessibility slice implementing editorial accent families and semantic tokens while resolving `A11Y_CONTRAST_COMPACT_NAV_01`:

- **Approved direction:**
  - Yellow → Editorial Gold (dark: accent `#E5B84B`, surface `#2A2314`, on-accent `#0B0D10`)
  - Red → Editorial Crimson (dark: accent `#F05257`, surface `#271315`, on-accent `#0B0D10`)
  - Orange → Editorial Orange (dark: accent `#FF8A3D`, surface `#2B1B12`, on-accent `#0B0D10`)
  - Green → Editorial Green (dark: accent `#34D071`, surface `#102519`, on-accent `#0B0D10`)
  - Blue → Editorial Blue (dark: accent `#5B8CFF`, surface `#121C31`, on-accent `#0B0D10`)
  - Violet → Editorial Violet (dark: accent `#A876E8`, surface `#21172E`, on-accent `#0B0D10`)
- **Semantic tokens applied:** `--nf-accent`, `--nf-accent-surface`, `--nf-accent-hover`, `--nf-accent-border`, `--nf-on-accent`, `--nf-accent-focus`, `--nf-accent-pressed`.
- **Contrast contract:** All dark theme text on accent surface and on-accent on accent achieve >=4.5:1 contrast (measured >=5.0:1). Resolves historical `A11Y_CONTRAST_COMPACT_NAV_01` where white badge text failed on saturated accents (e.g. 1.53:1 on Yellow, 3.47:1 on Crimson, 3.68:1 on Blue) by applying dark on-accent `#0B0D10`.
- **Canvas and surface boundaries:** Preserves OLED canvas `#0B0D10`. Persistent selection surfaces (e.g. `Unread / All` segmented control, CompactNav selected state) use dark tinted surfaces + accent text/icon rather than saturated/neon full-fill blocks.
- **Compatibility:** Preserves Arco `--primary-1` through `--primary-10` generation and persisted setting names (`Red`, `Orange`, `Yellow`, `Green`, `Blue`, `Violet`) with zero database/localStorage settings migration.
- **Geometry contract:** Preserves PR #122 sidebar layout contract (`SESSION_COUNT_GAP=8px`, `LABEL_SHRINK=UNCHANGED`, `LABEL_ELLIPSIS=UNCHANGED`, `COUNT_VISIBILITY=UNCHANGED`, `NO_HORIZONTAL_OVERFLOW`).

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

- Historical completed subset: `CHROME-01A / DatePicker` = COMPLETED (PR #25); `NNW-03 / CHROME-01 contextual controls` = COMPLETED (PR #117).
- Prefer verb-first confirmations such as `Mark all as read` / `Cancel` over generic `OK` / `Cancel` where semantics are already known.
- Keep Undo reachable on touch devices; any snackbar relocation must remain generation-safe and one-at-a-time.
- Raw Arco date selectors, popconfirms and notifications should use NewsFlux tokens rather than a parallel component system.
- Glass is a chrome behavior only and is justified when content actually passes beneath; reduced-transparency behavior must remain correct.
- Do not consolidate header/footer controls without a separate product decision.

#### CHROME-01B | FEEDBACK & CONTROL COHESION (COMPLETED)

PR #124 merged and promoted to production at `44cca8127dfa3b0f4cb1285a69092f2c7e4a807d`.

- **Status:** **COMPLETED**
- **PR:** #124
- **MERGE_SHA:** `44cca8127dfa3b0f4cb1285a69092f2c7e4a807d`
- **PRODUCTION_SHA:** `44cca8127dfa3b0f4cb1285a69092f2c7e4a807d`
- **PRODUCTION_VALIDATION:** PASS
- **MOBILE_390x844:** PASS
- **MEDIUM_884x1104:** PASS
- **DESKTOP_1280x800:** PASS
- **CRIMSON_DESTRUCTIVE_DISAMBIGUATION:** PASS
- **TOUCH_TARGET_GATE:** PASS
- **PROVIDER_WRITES:** 0
- **APPLICATION_STATE_MUTATIONS:** 0
- **Scope executed:**
  - Confirmation presentation: verb-first copy across all 6 shipped locales (`sidebar.context_menu.mark_all_as_read`, `search.cancel`, `sidebar.reset_settings`, `sidebar.logout`, `settings.import_settings`, `sidebar.context_menu.delete_category`, `sidebar.context_menu.delete_feed`); elevated dark surfaces (`#15191e`), subtle border (`#2a3037`), accessible focus outlines, `--nf-on-accent` text on primary action buttons.
  - Primary button semantic safety: theme accents strictly decoupled and excluded from status semantics (Danger, Warning, Success); destructive modal actions retain dark Danger-6 background `rgb(247, 105, 101)` and white text `#fff`.
  - Notification action target sizing: mobile touch target `min-height: 44px` enforced for `.arco-notification-btn-wrapper .arco-btn` and `.arco-notification-btn .arco-btn`.
  - Snackbar / notification placement: mobile message wrapper offset to clear compact navigation header (`top: calc(env(safe-area-inset-top, 0px) + 60px)`), dark elevated surface, subtle border, 8s Undo toast duration and generation-scoped IDs preserved.
  - Raw Arco controls cohesion: `.arco-btn-primary`, `.arco-radio-button.arco-radio-checked`, `.arco-select-popup`, `.arco-dropdown-menu`, `.mark-all-read-popconfirm` adapted using NewsFlux tokens (`--nf-accent`, `--nf-accent-surface`, `--nf-accent-border`, `--nf-on-accent`).
- **Non-negotiable structural holds preserved:**
  - `STRUCTURAL_FOOTERPANEL_SEARCHANDSORTBAR_CONSOLIDATION` = HOLD
  - `HIDING_MARK_OLDER_ON_TODAY` = HOLD
  - `MOBILE_SOURCES_DRAWER_DESTINATION_DEDUPLICATION` = HOLD
  - `WIDE_DESKTOP_MULTI_PANE` = HOLD
  - `DESKTOP_SIDEBAR_WIDTH_CHANGES` = HOLD
  - `SHOW_UNREAD_FEEDS_ONLY_DEFAULT_CHANGE` = HOLD
  - `SIDEBAR_VISUAL_COUNT_CAPPING` = HOLD
  - `UNREAD_CATEGORY_GROUPING` = HOLD

#### READER-VISUAL-02B | INTERACTION-AWARE READER CHROME (IN PROGRESS)

- **Status:** **IN PROGRESS**
- **Track:** `READER-VISUAL-02B`
- **Scope:**
  - Sticky `ActionButtons` chrome retreats on downward scroll past `SHOW_TOP_THRESHOLD` (~64px) and `DOWN_THRESHOLD` (~16px) to maximize reading space and sightline.
  - Returns immediately upon upward scroll (>12px), returning to top zone (`scrollTop <= 64px`), or focus entering chrome.
  - Focus safety: never hidden while chrome or its dropdowns/menus/TOC have focus; CSS `:focus-within` guarantees immediate visual recovery before focus is lost.
  - Reduced motion contract: instant visibility change without sliding animation when `prefersReducedMotion` is requested.
  - Liquid glass preserved: `nf-glass-group` chrome vacates visual space when hidden (`transform: translateY(-100%); opacity: 0; pointer-events: none;`); zero layout reflow or shift.
  - Canonical `useReaderCommands` and swipe behavior preserved.
  - Zero persistent reading state: ephemeral session state only.

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

### 3.13 Historical PWA Foundation rollout snapshot (2026-10-22; superseded by Section 19)

The table and rollout order below record the state before PRs #93–#95. Preserve it as history; Section 19 records the current PWA status.

PWA work has moved from planning into implementation. The code and production state intentionally differ after PR #91's failed old-to-new runtime canary; this is an operational rollback, not an indication that PR #91 was reverted from GitHub.

| Track                                            | Current state                               | Dependency / gate                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PWA-00 runtime baseline                          | **EXECUTED (PARTIAL)**                      | Public-origin/device evidence remains limited as described in `PWA_00_BASELINE.md`                                                                                                  |
| PWA-03A1 update activation safety / PR #90       | **MERGED; PRESENT IN PRODUCTION BASELINE**  | New service workers wait for explicit user choice; no silent mid-reading reload                                                                                                     |
| PWA-03A2A runtime asset cache integrity / PR #91 | **MERGED_VALID; PRODUCTION ROLLED BACK**    | Validates runtime JS/CSS status and MIME and uses `runtime-build-assets-v2`; production promotion remains blocked by the cross-build lazy-chunk failure below                       |
| PWA-03A2C chunk recovery                         | **DEPLOY BLOCKER / NEXT CRITICAL PWA ITEM** | Recovery must work before React mounts when a stale document requests a chunk from another build; it must preserve D6 user-controlled updates and must not silently activate/reload |
| PWA-03A2B true missing-asset 404                 | **FOLLOW-UP AFTER A2C**                     | Missing `/assets/*.js` and `.css` must return 404 while SPA navigation still serves `index.html`; identify the actual fallback owner before changing NPM                            |
| PWA-01A / PWA-01B installability and theme       | **PLANNED; NOT NEXT**                       | Resume only after runtime rollout is stable and existing decision gates are satisfied                                                                                               |
| PWA-01C serving contract                         | **HOLD — ARCHITECTURE**                     | Separate serving-contract decision/window; do not fold it into A2C                                                                                                                  |
| PWA authenticated/offline data caching           | **NOT AUTHORIZED**                          | No authenticated or user data caching; no new persistent state                                                                                                                      |
| PWA-04 optional capabilities                     | **PLANNED / DEFECT-DRIVEN**                 | Separate capability PRs after runtime stability                                                                                                                                     |

**PR #91 canary failure and current recovery contract:** the old build `5ea2136` references `RouterProtect-C7UKTYiv.js`, while build `de8b4645` emits `RouterProtect-Clm3raF1.js`. During the transition, a cross-build chunk request can reach SPA fallback HTML instead of the expected JavaScript, causing a dynamic-import failure before the normal update UI is available. Production was rolled back to `5ea21363676dd93dde97fd5ff8548e89864495ec`; GitHub `main` remains at PR #91 merge `de8b4645df1b8ce17b4b02c2d54adb694af25109`. This makes PWA-03A2C the immediate deployment blocker. A2A's cache-integrity behavior remains in main and is not reverted.

Required ordering:

1. **PWA-03A2C recovery** — pass focused recovery tests and review before merge.
2. **Controlled exact-SHA deployment** — only after gates and explicit promotion authorization.
3. **Real old-to-new runtime transition canary** — verify chunk recovery, user-controlled update behavior and no app lockout.
4. **Production stable** — record the actual runtime SHA/image and successful transition evidence.
5. **PWA-03A2B serving correction** — implement true asset 404s after A2C is stable, preserving SPA navigation fallback.

Do not place another standalone deployment of A2A ahead of A2C. Do not rely solely on a control rendered inside `AppNotifications`: recovery must remain reachable if a lazy chunk failure prevents the React application from mounting. The source of the current SPA asset fallback is not yet proven; inspect the serving path before changing NPM or any proxy configuration.

### 3.14 Intelligence, statistics, Home briefing, automation and discovery gates (2026-10-22 planning snapshot; current queue in Section 19)

These accepted tracks preserve a deterministic and privacy-bounded direction. The status below is planning/research state, not a product implementation grant.

| Track                                      | Status                                                         | Accepted boundary / dependency                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STORY-00 story-identity calibration        | **AUTHORIZED — RESEARCH ONLY; NOT YET RUN**                    | Read-only measurement on the real corpus for pt-BR, en, es, fr, de, ja and zh; measure exact/near-duplicate, same-event, false-positive/negative and precision/recall-equivalent outcomes. Do not commit private/raw corpus data or freeze an overlap threshold before results.                       |
| STORY-01 deterministic story grouping      | **HOLD — PENDING STORY-00**                                    | If supported by calibration, use canonical URL, normalized title, multilingual tokenization/stopwords (including CJK), lexical overlap and bounded time/cap; pure and non-persistent, Home only. Derive thresholds from evidence. All/Unread remain chronological and unclustered.                    |
| STORY-02 explainable story groups          | **HOLD — STORY-01 + DESIGN GATE**                              | Representative +N coverage, expand, promote another representative and show grouping reason/tier; no silent disappearance. Existing `removeDuplicates` behavior (removal from list plus mark-read) is a dependency tension to resolve, not authorization to change here.                              |
| STORY-03 clustering V2                     | **HOLD — EVIDENCE REQUIRED**                                   | Optional local lexical/TF-IDF/BM25 or local embeddings only if justified; `EMBEDDING_STORAGE=NOT_AUTHORIZED`.                                                                                                                                                                                         |
| Representative selection                   | **CANDIDATE POLICY — TO VALIDATE**                             | Unread > source affinity > image > first published > ID is a candidate for measurement, not a finalized rule.                                                                                                                                                                                         |
| STATS-01 feed health/statistics            | **APPROVED IN PRINCIPLE; HELD UNTIL PWA PRODUCTION STABILITY** | Intrinsic/feed statistics without new persistence. Show the actual measurement window; never label a short window as permanent history or interpret read status as engagement/quality.                                                                                                                |
| STATS-02 cross-source redundancy           | **HOLD — STATS-01 + STORY-01**                                 | Explainable percentages only; no auto-unsubscribe, invisible penalty or hiding.                                                                                                                                                                                                                       |
| STATS-03 behavioral analytics              | **HOLD — PRIVACY / PERSISTENCE DECISION**                      | Opens, read time and ignored behavior require an explicit new-persistence decision.                                                                                                                                                                                                                   |
| HOME-DAILY-01 on-demand briefing           | **HOLD — STORY-01 + STATS-01**                                 | On-demand V1 only; no schedule, LLM, email or persistence. Explain why each item was included.                                                                                                                                                                                                        |
| HOME-DAILY-02 prose and scheduled delivery | **HOLD — FUTURE DECISION**                                     | Any future prose defaults to local processing; n8n delivery is a separate option. Remote LLM is not authorized by default and requires explicit opt-in.                                                                                                                                               |
| AUTO-01 automation architecture            | **AUTHORIZED — ARCHITECTURE DECISION ONLY**                    | No generic automation engine or implementation. NewsFlux authors/previews/simulates; Miniflux owns native block/keep execution and webhook source/action destination; n8n is for richer execution. Rule-storage source of truth among Miniflux, YAML/JSON, n8n, DB or browser-only remains undecided. |
| AUTO-02 conditions/simulation builder      | **HOLD — AUTO-01 DECISION**                                    | No implementation until the architecture decision closes and separate authorization is given.                                                                                                                                                                                                         |
| AUTO-03 n8n recipes                        | **HOLD — AUTO-01 DECISION**                                    | Documentation/recipes only after architecture is resolved.                                                                                                                                                                                                                                            |
| DISC-01 static source catalog              | **HOLD — SOURCE / LICENSE REVIEW**                             | Limited value, weak benchmark, and catalog quality/licensing/terms risk; require source/license review and explicit PM decision before adoption.                                                                                                                                                      |
| DISC-02 provider-backed discovery          | **BACKLOG / BOUNDED**                                          | RSS-Bridge, changedetection, Miniflux `/v1/discover` and Mastodon-handle verification remain bounded source-discovery options.                                                                                                                                                                        |
| DISC-03 similar-feed recommendations       | **HOLD — CORPUS / BENCHMARK GATE**                             | Depends on source catalog, corpus and useful benchmark evidence; no remote embedding default.                                                                                                                                                                                                         |

Global constraints:

```text
NEW_PERSISTENCE=NOT_AUTHORIZED
REMOTE_LLM_DEFAULT=NOT_AUTHORIZED
EMBEDDING_STORAGE=NOT_AUTHORIZED
ALL_UNREAD_HIDDEN_RANKING=PROHIBITED
STORY_CLUSTERING_SCOPE=HOME_ONLY_IF_ADOPTED
MINIFLUX_SOURCE_OF_TRUTH=PRESERVED
```

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

### PWA FOUNDATION — remaining decisions before future phases

The PM inputs below gate future PWA phases (details and owners in `PWA_ARCHITECTURE.md` §12): **D1** manifest `id`; **D2** `theme_color`/`background_color` policy for an OLED-first app; **D3** maskable icon art direction; **D4** production topology — **partially resolved (`PM_REPORTED`)**: `https://news.jfsdias.ddns.net/` behind Nginx Proxy Manager, Docker network `npm-proxyyml_default`, internal `http://newsflux:2000`, exact `newsflux-local:<shortcommit>` image contract; the Miniflux origin remains user-configurable and must not be assumed same-origin without measurement; **D5** `ID-DEPLOY-01` or a waiver for serving-contract changes; **D6** update policy — **RESOLVED by PR #90** as `USER_CONTROLLED_UPDATE_PROMPT`; **D7** third-party icon fallback; **D8** token-only authentication guidance vs retained plaintext password in `localStorage`; **D9** whether offline reading is ever wanted (it triggers the Section 6 architecture gate).

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

## 7. Historical recommended execution order (PR #91 rollback snapshot; superseded by Section 19)

This historical execution order reflected the PR #91 production rollback. It is preserved as a sequencing record, **not** authorization to implement, merge or deploy. Section 19 records the current state and queue.

### Critical production-safety lane

1. **PWA-03A2C chunk recovery** — recovery must be available before React mounts and preserve user-controlled update semantics.
2. **Review and merge only after its focused gates pass and explicit merge authorization is given.**
3. **Controlled promotion of an exact approved SHA** — only with explicit deployment authorization.
4. **Real old-to-new runtime transition canary** — verify a stale document can recover from a missing cross-build chunk and the update path remains user-controlled.
5. **Record production stable only after the canary passes.**
6. **PWA-03A2B true missing-asset 404** — follow A2C stability; distinguish static asset failure from SPA route fallback.

### Parallel, no functional change

- **STORY-00** — authorized, read-only real-corpus calibration only.
- **AUTO-01** — authorized architecture decision only; implementation remains unauthorized.

### After PWA runtime stability

- **STATS-01** — intrinsic/feed health statistics, no new persistent state.
- If **STORY-00** passes: **STORY-01** deterministic Home-only grouping, then **STORY-02** only after its design gate.
- **HOME-DAILY-01** remains held until STORY-01 and STATS-01 dependencies pass.
- **STATS-02** remains held until STORY-01 and STATS-01 pass.
- STORY-03, STATS-03, HOME-DAILY-02, AUTO-02/03 and DISC-01/03 remain behind their stated evidence, architecture, privacy, source/license or authorization gates.

Other visual, navigation, saved-state, personalization and optional PWA tracks retain their existing gates. Never mix PWA runtime recovery with visual redesign, upstream sync or unrelated functional work.

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

## 9. Historical test debt and incidental findings (2026-10-22 snapshot; current dispositions are in Section 19)

- `HARNESS-UNDO-ID-01` was resolved by test-maintenance PR #36 (feature head `ef90eb733dbc6a26c0b85bcf33a9a866569a92b7`, merge `b65f6f88b0c27f049723714a5338527ffc92fa1a`); its focused list regression passed 29/29.
- `HARNESS-CODEBLOCK-SSR-01` is no longer open: PR #38 reports `CODEBLOCK_SSR_GATE=PASS` within the full Node suite on both main and candidate.
- **ARTICLE_CODE_BLOCK_CONTROLS_HISTORICAL_FAILURE — NOT_REPRODUCED IN THE LATEST BACKEND DIAGNOSTIC** (`PM_REPORTED`): at the pre-PR #91 baseline `d7c0fc8e…`, the focused `scripts/article-code-block-controls.test.js` passed 3/3 and `node --test scripts/*.test.js` passed 48/48. PR #91 changes only PWA runtime-cache code and harness, but the suite was not rerun at `de8b4645`; therefore `d7c0fc8e` is the exact evidence baseline, not the current `main`. Historical cloud-container failure remains unexplained: Vite SSR could not resolve named export `Select` from `@arco-design/web-react` inside `CodeBlock.jsx`; environment/toolchain sensitivity remains possible.
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
- **Historical PWA findings and rollout snapshot (2026-10-22):** manifest/runtime theme-color mismatch (`PWA_THEME`), no maskable icon (`PWA_INSTALL`), navigation-route scope behavior (`PWA_SCOPE`), plaintext `password` in `localStorage` (`SECURITY`, pre-existing), hostname disclosure/multi-part public-suffix handling in third-party icon fallback (`PRIVACY` / `BUG`), and per-profile storage separation between installed iOS app and Safari (`STATE_PERSISTENCE`) were tracked as separate findings. The PR #91 cross-build recovery and PR #95 asset-serving blockers recorded here were subsequently closed by PRs #93–#95. Current PWA and production status is in Section 19 and `PWA_ARCHITECTURE.md` §16.
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

## 15. Historical: active parallel candidates and integration order (2026-10-22 morning; superseded by Section 19)

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

## 16. Historical reconciliation snapshot: post-PR #85 (2026-10-22)

This was the current reconciliation snapshot before PRs #86–#91 updated main, product and production state. Production and runtime values were `PM_REPORTED` and are not independently verifiable from the repository; the merge facts are verified from git history. Section 17 is the current snapshot.

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

These tracks do **not** authorize implementation: `PWA_FOUNDATION=PLANNED` and `NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT` record the planning/design input state at that historical snapshot. The PM review of PR #86 and the PWA-00 outcome are retained as historical evidence; later runtime completions and the current installability decision gates are summarized in Section 19.

## 17. Historical reconciliation snapshot: PR #91 code merged; production rolled back (2026-10-22)

GitHub state was checked live before this documentation PR: `main` is `de8b4645df1b8ce17b4b02c2d54adb694af25109`; PR #91 is merged, PR #88 is closed/merged, and the open-PR list was empty. Production values below are the owner-provided canary/rollback receipt and remain explicitly distinguished from Git-verified merge state.

```text
DOCS_DATE=2026-10-22
GITHUB_MAIN=de8b4645df1b8ce17b4b02c2d54adb694af25109
OPEN_PRS_BEFORE_THIS_ROADMAP_PR=NONE

PR88_STATUS=MERGED
PR88_MERGE_SHA=3a1b2db07d9df08b8dde9f3148a02e6eb703ec7c
PR89_STATUS=MERGED
PR89_MERGE_SHA=7da97c04d296ef2cdff225ec37833df362ca1139
PR90_STATUS=MERGED
PR90_MERGE_SHA=5ea21363676dd93dde97fd5ff8548e89864495ec
PR91_STATUS=MERGED_VALID
PR91_FEATURE_HEAD=7eff4e6dd0b4dbaef1ad5eae91afbd66661cafd6
PR91_MERGE_SHA=de8b4645df1b8ce17b4b02c2d54adb694af25109

PRODUCTION_STATUS=ROLLED_BACK_AFTER_FAILED_EXACT_SHA_CANARY
PRODUCTION_SHA=5ea21363676dd93dde97fd5ff8548e89864495ec
PRODUCTION_IMAGE=newsflux-local:5ea21363676d
PRODUCTION_IMAGE_ID=NOT_RECORDED_IN_THIS_ROLLBACK_RECEIPT
PRODUCTION_HTTP=NOT_RECORDED_IN_ROLLBACK_RECEIPT
CLIENT_PWA_RECOVERY_AFTER_ROLLBACK=PASS
RECOVERY_METHOD=TARGETED_SW_UNREGISTER_AND_NEWSFLUX_CACHE_RESET
PRODUCTION_BASELINE_CONFIRMED_AFTER_CLIENT_RECOVERY=5ea21363676dd93dde97fd5ff8548e89864495ec
OLD_SW_UNREGISTERED=PASS
FRESH_SW_ACTIVE=PASS
WAITING_WORKER_AFTER_RECOVERY=NO
STALE_PWA_CACHES_REMOVED=PASS
RUNTIME_BUILD_ASSETS_V2=ABSENT_EXPECTED
MAIN_PRODUCTION_PARITY=NO_INTENTIONAL_PWA_DEPLOY_BLOCKER
MAIN_AHEAD_OF_PRODUCTION_REASON=PR91_MERGED_A2A_CANARY_ROLLED_BACK_PENDING_A2C
DEPLOYMENT_MUTATION_FOR_THIS_DOCUMENTATION_PR=NO

PR91_CODE_STATUS=MERGED_VALID
PR91_PRODUCTION_STATUS=ROLLED_BACK
PWA03A2A=MERGED_CODE_NOT_CURRENTLY_IN_PRODUCTION
PWA03A2C=DEPLOY_BLOCKER
PWA03A2B=FOLLOW_UP_AFTER_A2C
A2C_RECOVERY_MUST_WORK_BEFORE_REACT_MOUNTS=YES
A2C_MUST_PRESERVE_D6_USER_CONTROLLED_UPDATE_PROMPT=YES
A2C_SILENT_SKIP_WAITING_AND_RELOAD=PROHIBITED

OLD_BUILD=5ea2136
OLD_CHUNK=RouterProtect-C7UKTYiv.js
NEW_BUILD=de8b4645
NEW_CHUNK=RouterProtect-Clm3raF1.js
FAILURE_CHAIN=CROSS_BUILD_CHUNK_REFERENCE;MISSING_HASHED_ASSET;SPA_FALLBACK_HTML;DYNAMIC_IMPORT_FAILURE;NORMAL_UPDATE_UI_UNREACHABLE

PWA_RUNTIME_ORDER=PWA03A2C;EXACT_SHA_CONTROLLED_DEPLOY;REAL_OLD_TO_NEW_TRANSITION_CANARY;PRODUCTION_STABLE;PWA03A2B_TRUE_ASSET_404
STORY00=AUTHORIZED_RESEARCH_ONLY
AUTO01=AUTHORIZED_ARCHITECTURE_ONLY
STATS01=HELD_UNTIL_PWA_PRODUCTION_STABILITY
STORY01=HOLD_PENDING_STORY00
STORY02=HOLD_PENDING_STORY01_AND_DESIGN_GATE
STORY03=HOLD_EVIDENCE_REQUIRED
STATS02=HOLD_PENDING_STORY01_AND_STATS01
STATS03=HOLD_PRIVACY_AND_PERSISTENCE_DECISION
HOME_DAILY_01=HOLD_PENDING_STORY01_AND_STATS01
HOME_DAILY_02=HOLD_FUTURE_LOCAL_MODEL_AND_SCHEDULED_DELIVERY_DECISION
AUTO01_IMPLEMENTATION=NOT_AUTHORIZED
AUTO02=HOLD_PENDING_AUTO01
AUTO03=HOLD_PENDING_AUTO01
DISC01=HOLD_SOURCE_LICENSE_AND_CATALOG_QUALITY
DISC02=BOUNDED_BACKLOG
DISC03=HOLD_CORPUS_AND_BENCHMARK_EVIDENCE

NEW_PERSISTENCE=NOT_AUTHORIZED
REMOTE_LLM_DEFAULT=NOT_AUTHORIZED
EMBEDDING_STORAGE=NOT_AUTHORIZED
ALL_UNREAD_HIDDEN_RANKING=PROHIBITED
STORY_CLUSTERING_SCOPE=HOME_ONLY_IF_ADOPTED
MINIFLUX_SOURCE_OF_TRUTH=PRESERVED
REPRESENTATIVE_POLICY_FINALIZED=NO

MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

The PR #91 canary exposed a cross-build lazy-chunk recovery gap: the earlier client can request a hashed chunk from another build, receive SPA fallback HTML for a missing asset and fail its dynamic import before the normal React update interface can mount. After rollback, the client recovery is now confirmed: the app boots, About reports `5ea21363676dd93dde97fd5ff8548e89864495ec`, the old service worker was unregistered, a fresh worker is active with no waiting worker, and stale NewsFlux CacheStorage entries were removed (`runtime-build-assets-v2` is absent as expected). This closes the current operational browser-recovery task; it does not revert PR #91 from GitHub or close the PWA-03A2C implementation blocker. A2C still needs to provide safe pre-React recovery so a future A2A promotion can be attempted safely. The actual owner of the production SPA fallback remains unverified; A2B must identify it before any proxy/config change.

### Accepted intelligence and automation sequencing

- **STORY-00** may proceed as read-only corpus calibration. Keep raw/private article data out of committed artifacts; cover pt-BR, en, es, fr, de, ja and zh; derive thresholds from measured results.
- **AUTO-01** may proceed only as an architecture decision. This does not authorize an automation UI, generic rule engine, storage choice or implementation.
- **STATS-01** follows a stable PWA runtime in production. It uses intrinsic/feed-health measurements, adds no persistence and must show the real observation window.
- After STORY-00 evidence, STORY-01 may be considered for deterministic, non-persistent Home-only grouping. STORY-02 additionally requires its design gate. HOME-DAILY-01 and STATS-02 remain dependent on STORY-01 and STATS-01.
- Story representatives, remote LLM defaults, embedding storage, behavioral persistence, broad discovery ranking and user-facing automation execution remain unapproved.

At the 2026-10-22 snapshot, this superseded Section 16 for code/production state. The recovery recorded above closed the operational browser recovery task; Section 19 supersedes this snapshot for current state.

## 18. Historical reconciliation snapshot: post-PR #95 before PR #96 disposition (2026-10-23)

This is the state recorded before PR #96 was merged. Its `main`, PR #96 open-state/head, STORY-00R2B and production-parity fields are a dated historical snapshot and are superseded by Section 19. No historical evidence has been rewritten.

```text
DOCS_DATE=2026-10-23
GITHUB_MAIN=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_ABOUT_REVISION=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_IMAGE=PM_REPORTED_newsflux-local:96bd1fe56357
PRODUCTION_APP_LOAD=PASS
PRODUCTION_DOCKER_IMAGE_INSPECTION=NOT_PERFORMED

PR88_STATUS=MERGED
PR88_MERGE_SHA=3a1b2db07d9df08b8dde9f3148a02e6eb703ec7c
PR90_STATUS=MERGED_PWA03A1
PR90_MERGE_SHA=5ea21363676dd93dde97fd5ff8548e89864495ec
PR91_STATUS=MERGED_PWA03A2A
PR91_MERGE_SHA=de8b4645df1b8ce17b4b02c2d54adb694af25109
PR92_STATUS=MERGED_DOCUMENTATION
PR92_MERGE_SHA=f630fe8843a16a9ff810662632a7b6f253285151
PR93_STATUS=MERGED_PWA03A2C
PR93_MERGE_SHA=950ae61b71433a6fd9c11fed9ed266a17fee3185
PR94_STATUS=MERGED_PWA03A2C1
PR94_MERGE_SHA=6a8068e9809cafdecce0c695c78dcb151d95d4a4
PR95_STATUS=MERGED_PWA03A2B
PR95_MERGE_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PWA03A2A=COMPLETE_MERGED
PWA03A2C=COMPLETE_MERGED
PWA03A2C1=COMPLETE_MERGED
PWA03A2B=COMPLETE_MERGED
PWA03A2=COMPLETE_PRODUCTION_AT_ABOUT_REVISION

PWA01A_AUDIT=COMPLETE
PWA01A_RESULT=NO_IMPLEMENTATION;D1_MANIFEST_ID_AND_D3_MASKABLE_ICON_DECISIONS_REMAIN_OPEN
PWA01A_PHYSICAL_INSTALL_AND_DEEP_LINK_GATES=NOT_RUN
PWA01B_AUDIT=COMPLETE
PWA01B_RESULT=NO_IMPLEMENTATION;D2_MANIFEST_THEME_AND_BACKGROUND_POLICY_REMAINS_OPEN
PWA01B_RUNTIME_THEME_META=UPDATES_DURING_THEME_CHANGE

STATS01_READINESS=HOLD_PRODUCT_DEFINITION_REQUIRED
STATS01_IMPLEMENTED=NO
STATS01_NEW_PERSISTENCE=NO
STORY00R2B_STATUS=NOT_OBSERVED_IN_THIS_SESSION
STORY00R2B_RESULTS=NOT_CLAIMED

API_NONIDEMPOTENT_RETRY_01=OPEN_DRAFT_PR96
PR96_BASE=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PR96_HEAD=88dc4d7ade30b1576f1c77cab954d7ea187bcbd8
PR96_BRANCH=codex/api-nonidempotent-retry-01
PR96_RED_GREEN=PASS
PR96_NODE_SUITE=509_PASS_2_SKIPPED_511_TOTAL
PR96_LIVE_MINIFLUX_WRITES=0

HOME_PAGINATION_CURSOR_STALL_01=NOT_REPRODUCED_AFTER_PR87
HOME_CURSOR_HARNESS=10_OF_10_PASS
HOME_TIE_RECOVERY=23_OF_23_INCLUDING_PREVIOUSLY_OMITTED_ID
HOME_IMPLEMENTATION_CHANGED_IN_THIS_QUEUE=NO
HOME_DUP_ROOT_CAUSE_01=SEPARATE_INITIAL_DUPLICATE_ID_FINDING_CLOSED_BY_PR77

STORY_IDENTITY=RESEARCH_STATUS_NOT_OBSERVED;NO_RESULT_CLAIMED
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
PRODUCTION_MUTATIONS=NO
```

### Queue disposition recorded at this historical snapshot

- **PWA-01A installability audit — complete, no implementation.** The generated manifest already follows the configured base path for `start_url` and `scope`; the referenced icons exist, but no maskable icon is present and manifest `id` is not explicitly configured. Root and non-root builds passed. Decisions D1 (stable manifest ID) and D3 (maskable icon art) are still required before implementation. Physical installed-app and deep-link gates were not run.
- **PWA-01B theme audit — complete, no implementation.** Runtime theme-color metadata follows the app theme, while the manifest has one static theme/background pair. Decision D2 is required before changing that policy.
- **STATS-01 — held.** Provider-backed fields exist, but no accepted definition for metric, observation window and presentation semantics was available. No product code or persistence was added.
- **STORY-00R2B — parallel lane status not observed here.** No result is inferred or recorded.
- **API-NONIDEMPOTENT-RETRY-01 / PR #96 — open Draft for PM review.** A transport failure can replay a mutating request under the former shared retry policy; isolated regression coverage and local gates passed. The change disables default POST/PUT retries while preserving GET retries, so consumers of shared POST/PUT calls should be reviewed.
- **HOME_PAGINATION_CURSOR_STALL_01 — not reproduced after PR #87.** The deterministic Home suite passed 10/10; the previous equal-second case loaded 23/23 entries, including the formerly omitted ID. This is a Home cursor result and does not conflate the separate `HOME_DUP_ROOT_CAUSE_01` finding closed by PR #77.

The audit-only PWA phases changed no product code. This historical snapshot records no implementation, merge or deployment authorization.

## 19. Historical canonical state: post-PR #96 (2026-10-23; superseded by Section 20)

GitHub `main` is `fa27a4cec1cae1e887041ee3999622c5b8f76681` after PR #96 merged. Production remains at `96bd1fe563571bfa322b2fd79f6fc12f49107a76`; PR #96 has not been deployed, so main and production are not at parity. PR #95 production evidence is owner-provided and retained as `PM_REPORTED`: exact image/revision, internal and public HTTP checks including the asset-404 canary passed, and rollback image plus compose backup were preserved. The receipt did not report a restart count.

```text
DOCS_DATE=2026-10-23
GITHUB_MAIN=fa27a4cec1cae1e887041ee3999622c5b8f76681
PRODUCT_MAIN_BASELINE=fa27a4cec1cae1e887041ee3999622c5b8f76681
PRODUCTION_SHA=96bd1fe563571bfa322b2fd79f6fc12f49107a76
PRODUCTION_IMAGE=newsflux-local:96bd1fe56357
PRODUCTION_RECEIPT=PM_REPORTED_OWNER_PROVIDED_PR95_EXACT_SHA
PRODUCTION_IMAGE_REVISION=PASS
PRODUCTION_INTERNAL_HTTP=PASS
PRODUCTION_PUBLIC_HTTP=200
PRODUCTION_ASSET_404_CANARY=PASS
PRODUCTION_ROLLBACK_IMAGE_AND_COMPOSE_BACKUP=PRESERVED
PRODUCTION_RESTART_COUNT=NOT_REPORTED
MAIN_PRODUCTION_PARITY=NO
PR96_DEPLOYED=NO

PR96_STATUS=MERGED
PR96_FEATURE_HEAD=98a1f93f9a9ccb411230c041726c4dece1f4e1b9
PR96_MERGE_SHA=fa27a4cec1cae1e887041ee3999622c5b8f76681
API_NONIDEMPOTENT_RETRY_01=COMPLETE
PR96_SIDE_EFFECTING_GET_UPDATE_CONTENT_TRUE=RETRY_FALSE
PR96_RAW_MUTATING_METHODS=POST_PUT_PATCH_DELETE_RETRY_FALSE_BY_DEFAULT
PR96_SAFE_GET_RETRIES=PRESERVED
PR96_EXPLICIT_RETRY_OPT_IN=PRESERVED
PR96_FOCUSED_API_TESTS=20_OF_20_PASS
PR96_FULL_NODE=513_PASS_2_SKIPPED
PR96_LINT_PRETTIER_BUILD_DIFF_CHECK=PASS
PR96_LIVE_MINIFLUX_WRITES=0

STORY00R2B_STATUS=COMPLETE_REJECT
STORY00R2B_PRIMARY_MODEL=mDeBERTa_FULL_ONNX_FP32
STORY00R2B_PRIMARY_POOLED_S1_AUC=0.647
STORY00R2B_SECOND_MODEL=NO
STORY00R2B_LEXICAL_STAGE0_AUC=0.904_DEVELOPMENT_EVIDENCE_ONLY_NOT_ADOPTED
STORY00R2B_POSITIVES_NEVER_CANDIDATES=47_OF_113
STORY00R2B_POSITIVES_VETOED=7
STORY00R2B_PERFECT_VERIFIER_RECALL_CEILING=0.522
STORY00R2B_NEXT=STORY00_R3A_CANDIDATE_GENERATION_FORENSICS

STORY01_ARCHITECTURE=DETERMINISTIC_CONSERVATIVE_V1
STORY01_P1=APPROVED_B_UNREAD_NEWEST_PUBLISHED_LOWEST_ID
STORY01_P2=APPROVED_A_FROZEN_BLIND_SAMPLE_GE72_AUTO_MERGES_0_FALSE_MERGES
STORY01_P3=APPROVED_A_FOR_ENGINE_B_FOR_RELEASE
STORY01_P4=HOLD_PENDING_HOME_COVERAGE_MEASUREMENT
STORY01_IMPLEMENTATION_AUTHORIZED=NO

AUTO01_D1=RESOLVED
AUTO01_V1=MINIFLUX_NATIVE_BLOCK_KEEP_RULES__NEW_ENTRIES_WEBHOOK_TO_N8N__SAVE_ENTRY_WEBHOOK_TO_N8N
NEWSFLUX_TO_N8N_DIRECT_PATH=NO
AUTO01_NEW_PERSISTENCE=NO
AUTO01_D5=RESOLVED_BY_PR96
AUTO01_D3_D4=ENVIRONMENT_DIAGNOSTICS

NNW01_D7=NO_THIRD_PARTY_FAVICON_LOOKUP
NNW01_ICON_PRIORITY=MINIFLUX_PROVIDER_ICON__LOCAL_DETERMINISTIC_MONOGRAM__LOCAL_DEFAULT_ICON
NNW01_READY_FOR_DESIGN=YES
NNW01_IMPLEMENTATION_AUTHORIZED=NO

AUTH_APIKEY_01=ARCHITECTURE_APPROVED_IMPLEMENTATION_HOLD
AUTH_APIKEY_01_LIFECYCLE=CONSENT_PASSWORD_LOGIN_CREATE_KEY_VERIFY_V1_ME_STORE_TOKEN_AND_KEY_ID_THEN_DROP_PASSWORD_LOGOUT_REVOKES_OWN_KEY_FIRST
SECURITY_HEADERS_01=SEPARATE_BACKLOG
SECURITY_HEADERS_01_MIX_WITH_NNW_OR_PWA=NO
STATS01_STATUS=HOLD_PRODUCT_DEFINITION_REQUIRED
HOME_PAGINATION_CURSOR_STALL_01=NOT_REPRODUCED_AFTER_PR87

LAST_COMPLETED_FUNCTIONAL=API_NONIDEMPOTENT_RETRY_01 / PR #96
CURRENT_DOCS_PR=97_DRAFT
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

`AUTH_APIKEY_01` retains the approved consent/create/verify/store/drop-password/revoke lifecycle: after consent, log in with the password, create an app key, verify it through `/v1/me`, store the token and `apiKeyId`, and only then remove the stored password; logout revokes the installation's own key first. `STORY-01` remains unimplemented. Security-header work stays in a separate backlog item and is not combined with NNW or PWA installability.

Historical snapshots may retain earlier values such as `PR96_STATUS=OPEN`, the former PR #96 head, `STORY00R2B_STATUS=NOT_OBSERVED_IN_THIS_SESSION`, and `LAST_COMPLETED_FUNCTIONAL=...PR #85`; those values are not current. PR #96 is merged at the SHA above, production remains at PR #95, and the current functional completion is PR #96.

## 20. Historical canonical state: post-PR #108 (2026-10-24; superseded by Section 21)

GitHub `main` is `bc9f175a3447a67b06d7deee12c6e19374bb7664` after PR #108 merged. Production has been deployed and verified live via read-only SSH container inspection to the same commit (`newsflux-local:bc9f175a3447`, OCI revision `bc9f175a3447a67b06d7deee12c6e19374bb7664`, container `newsflux`, 0 restarts, internal HTTP 200, public root HTTP 200, public `/all` SPA fallback HTTP 200, static 404 canary HTTP 404). Main and production are in full parity (`MAIN_PRODUCTION_PARITY=YES`).

```text
DOCS_DATE=2026-10-24
GITHUB_MAIN=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCT_MAIN_BASELINE=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_SHA=bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_IMAGE=newsflux-local:bc9f175a3447
PRODUCTION_VERIFICATION=LIVE_VERIFIED_READ_ONLY_SSH_EXACT_SHA
PRODUCTION_CONTAINER=newsflux
PRODUCTION_CONTAINER_STARTED_AT=2026-10-24T04:41:41Z
PRODUCTION_RESTART_COUNT=0
PRODUCTION_IMAGE_REVISION=PASS_bc9f175a3447a67b06d7deee12c6e19374bb7664
PRODUCTION_COMPOSE_CONFIG=/dockerdata/compose/newsflux/compose.yaml
PRODUCTION_INTERNAL_HTTP=PASS_200
PRODUCTION_PUBLIC_HTTP=200
PRODUCTION_PUBLIC_ALL_HTTP=200
PRODUCTION_ASSET_404_CANARY=PASS_404
MAIN_PRODUCTION_PARITY=YES
PR108_DEPLOYED=YES

PR97_STATUS=MERGED_DOCUMENTATION
PR97_MERGE_SHA=a02dd5e7f3aa30253e228c40180f1c8b9e2972b1
PR98_STATUS=MERGED_DEPENDABOT_GOVERNANCE
PR98_MERGE_SHA=231809c7a74b833718a87e0cb78091f89dd00570
PR99_STATUS=MERGED_NNW01P_SOURCE_ICON_PRIVACY
PR99_MERGE_SHA=cb0b200eb5cfd4d8b7e8af3b97a4fa57008b814f
PR100_STATUS=MERGED_NNW01A_SOURCEMARK_PRIMITIVE
PR100_MERGE_SHA=1430674d4322a1703e946bd5fc69c8c3f5bc2fee
PR101_STATUS=MERGED_NNW01B_SOURCEMARK_ADOPTION_SIDEBAR_LISTS
PR101_MERGE_SHA=c7dd7835f90f433323d2c0360c2d34528f95ab61
PR102_STATUS=MERGED_NNW01C_SOURCEMARK_ADOPTION_READER_SETTINGS
PR102_MERGE_SHA=6316f0993c4e45cc84459d84d46a955f2a021dae
PR103_STATUS=MERGED_NNW01D_SOURCEMARK_ADOPTION_FEED_HEADER
PR103_MERGE_SHA=36a78492fec4a673394a7b2b03f4b0a48cde987e
PR104_STATUS=MERGED_NNW02A_NAVIGATION_DENSITY_AUDIT
PR104_MERGE_SHA=b3dcb3c29ad1bb2352381cf79065a8f07167346c
PR105_STATUS=MERGED_NAV_VISUAL_MEDIUM_RAIL
PR105_MERGE_SHA=06e76dcef0f29ed4a104bfe5a3a935719ec46575
PR106_STATUS=OPEN_PARALLEL_STORY_CANDIDATE_RANKING_INCOMPLETE
PR106_HEAD=8f8e59cc1151680cfce3f8475a99aa671de4829b
PR106_DRAFT=YES
PR107_STATUS=MERGED_DESKTOP_COARSE_POINTER_SAFETY
PR107_MERGE_SHA=e50a6b9c494e9fd5c47baa24791249c3f30f5906
PR108_STATUS=MERGED_NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS
PR108_MERGE_SHA=bc9f175a3447a67b06d7deee12c6e19374bb7664

NNW01_SOURCE_IDENTITY=COMPLETED_THROUGH_SLICES_P_A_B_C_D
NNW02A_NAVIGATION_DENSITY_AUDIT=COMPLETED
NAV_VISUAL_MEDIUM_RAIL=COMPLETED
DESKTOP_COARSE_POINTER_SAFETY=COMPLETED
NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS=COMPLETED
PR106_STORY_CANDIDATE_RANKING=PARALLEL_OPEN_INCOMPLETE

NON_NEGOTIABLE_BOUNDARIES=MINIFLUX_IS_SOURCE_OF_TRUTH;NO_NEW_PERSISTENT_STATE_WITHOUT_DECISION;CHRONOLOGICAL_UNREAD_ALL_NO_SILENT_RANKING;GLASS_CHROME_ONLY_OPAQUE_CONTENT;SINGLE_PANE_FIRST_MOBILE_TABLET_FOLD;CRITICAL_MEDIUM_884X1104;NO_BLIND_UPSTREAM_SYNC;EXACT_SHA_DEPLOY_ONLY

PRESERVED_FINDINGS=REACT19_ARCO_ELEMENT_REF;RESIZEOBSERVER_LOOP;MOBILE_SCROLL_FLICKER_01;FOOTERPANEL_CLIPPING;HOME_PAGINATION_CURSOR_STALL_01_NOT_REPRODUCED

CURRENT_PHASE=POST_PR108_CANONICAL_RECONCILIATION
LAST_COMPLETED_FUNCTIONAL=NNW02C_DISCLOSURE_KEYBOARD_SEMANTICS / PR #108
RECOMMENDED_NEXT_TRACK=NNW-05_RESEARCH_STUDY
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
PRODUCTION_MUTATIONS=NO
```

### Live PR inventory (PRs #97 – #108)

- **PR #97 (`a02dd5e7f3aa30253e228c40180f1c8b9e2972b1`):** docs: reconcile post-PR96 and overnight NewsFlux state. Completed canonical documentation synchronization.
- **PR #98 (`231809c7a74b833718a87e0cb78091f89dd00570`):** chore(ci): integrate upstream Dependabot governance. Harmonized Dependabot rules and update policies with ReactFlux upstream.
- **PR #99 (`cb0b200eb5cfd4d8b7e8af3b97a4fa57008b814f`):** fix(source-identity): remove third-party favicon fallback. Completed NNW01-P privacy baseline, eliminating external favicon network requests.
- **PR #100 (`1430674d4322a1703e946bd5fc69c8c3f5bc2fee`):** feat(source-identity): add SourceMark primitive. Completed NNW01-A, implementing deterministic local monogram and fallback styling.
- **PR #101 (`c7dd7835f90f433323d2c0360c2d34528f95ab61`):** feat(source-identity): adopt SourceMark in Sidebar and article lists. Completed NNW01-B.
- **PR #102 (`6316f0993c4e45cc84459d84d46a955f2a021dae`):** feat(source-identity): complete Reader source identity adoption. Completed NNW01-C in reader view and Settings source lists.
- **PR #103 (`36a78492fec4a673394a7b2b03f4b0a48cde987e`):** feat(source-identity): add SourceMark to Feed header. Completed NNW01-D, closing the NNW01 source identity track.
- **PR #104 (`b3dcb3c29ad1bb2352381cf79065a8f07167346c`):** docs(nav): audit navigation density baseline. Completed NNW-02A audit across mobile, tablet, and desktop viewports.
- **PR #105 (`06e76dcef0f29ed4a104bfe5a3a935719ec46575`):** feat(nav): add medium navigation rail. Implemented 80px responsive Medium Navigation Rail for viewports 768px–991px.
- **PR #106 (`8f8e59cc1151680cfce3f8475a99aa671de4829b`):** feat(story): integrate local candidate ranking pipeline. Active parallel draft track; incomplete pending PM review and runtime parity gates. Must remain isolated.
- **PR #107 (`e50a6b9c494e9fd5c47baa24791249c3f30f5906`):** fix: ensure 48px navigation targets for coarse pointers. Implemented touch safety overrides for coarse pointers while preserving 40px fine-pointer compact density.
- **PR #108 (`bc9f175a3447a67b06d7deee12c6e19374bb7664`):** feat(a11y): use native sidebar navigation semantics. Completed NNW-02C, replacing composite role emulation with native links and button disclosures, native radio arrow keys, and proper drawer Escape delegation.

### Ordered next-track decision matrix

| Candidate | Track Name                    | Status   | Dependencies                         | Decision Required                                                                                                                 | Overlap with PR #106 | Recommended Next             | Rationale                                                                                                          |
| --------- | ----------------------------- | -------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A         | PR106_STORY_CANDIDATE_RANKING | PARALLEL | None (open draft PR #106)            | PM runtime-parity review & gate closure                                                                                           | YES (is PR #106)     | NO                           | Active parallel lane; must remain isolated without duplication or modification.                                    |
| B         | NAV-02F                       | HOLD     | NAV-02 R2 baseline (PR105, 107, 108) | Product decisions on: unread category grouping, desktop sidebar width, showUnreadFeedsOnly persistence, unread count badge format | NO                   | NO                           | Unresolved product decisions; guessing semantics violates core project boundaries.                                 |
| C         | NNW-02B                       | HOLD     | NNW-02A audit (PR104)                | None (PM decided NOT to pursue general density/count-group redesign now)                                                          | NO                   | NO                           | Preserves explicit PM decision to defer general density redesign.                                                  |
| D         | NNW-03 / CHROME-01            | HOLD     | None                                 | Product decisions on contextual control consolidation across top bar and reader header                                            | NO                   | NO                           | `HOLD_PRODUCT_DECISION`. Contextual chrome consolidation remains unresolved.                                       |
| E         | NNW-05                        | READY    | None                                 | PM authorization for bounded research study                                                                                       | NO                   | **YES (Recommended)**        | Bounded research-only study of multi-pane and reference architectures strictly within single-pane-first boundary.  |
| F         | PWA-01A Installability        | HOLD     | PWA-00 baseline                      | Product/design decisions on D1 (manifest ID), D2 (manifest theme colors), D3 (maskable icon art)                                  | NO                   | NO                           | Implementation blocked on open PM decisions D1, D2, D3.                                                            |
| G1        | AUTH_APIKEY_01                | HOLD     | Approved consent lifecycle           | PM authorization to begin implementation                                                                                          | NO                   | NO                           | Implementation on hold preserving consent/verification lifecycle.                                                  |
| G2        | SECURITY_HEADERS_01           | READY    | None                                 | Confirmation of Caddy security header policy (CSP, X-Content-Type-Options, etc.)                                                  | NO                   | ALTERNATIVE (Implementation) | Bounded, identifiable scope in Caddyfile/compose; alternative next implementation track once CSP policy is locked. |

### Enduring governance and implementation guidelines

- **Miniflux Source of Truth:** Miniflux remains authoritative for feeds, categories, entries, read status, and starred status. No client-only persistent database or divergence.
- **Predictable Ordering:** Feeds and entries in All and Unread scopes remain strictly reverse-chronological or chronological. No hidden ranking outside the dedicated Home lane.
- **Glass Restricted to Chrome:** Glassmorphism and translucent tokens apply solely to navigation bars, headers, and floating chrome. Reader cards, article text, and content views remain solid and fully opaque.
- **Single-Pane-First:** Phone, tablet, and foldable devices maintain single-pane-first presentation. Multi-pane layouts are restricted to wide desktop landscape screens.
- **Exact-SHA Deployments:** Production is updated strictly with verified exact OCI revision hashes, never moving branch tags or `latest`.

---

## 21. Historical canonical state: post-PR #114 (2026-10-24; superseded by Section 22)

GitHub `main` is `bf1f911f0e2d405dbf84a04414a04cc0bc6530c9` after PR #114 merged. Production has been deployed and verified live via read-only SSH container inspection to the same commit (`newsflux-local:bf1f911f0e2d`, OCI revision `bf1f911f0e2d405dbf84a04414a04cc0bc6530c9`, image ID `sha256:368310dd4e8080571eb8ab72500cce4b6ac27524f4c04e891bc7d45295b8ba2f`, canonical compose SHA `8cac8c8c2a9ceecdbd5f9cad4a3b026b3e65bb6024fc88123e41843b4549a8f4`, container `newsflux`, 0 restarts, internal HTTP 200, public root HTTP 200 at `https://news.jfsdias.ddns.net/`, public `/all` SPA fallback HTTP 200, PWA manifest HTTP 200, static 404 canary HTTP 404, story ranker port 8000 absent). Main and production are in full parity (`MAIN_PRODUCTION_PARITY=YES`). Prior to this reconciliation PR (#118, currently Draft), there were zero open pull requests on GitHub (`OPEN_PRS_BEFORE_RECONCILIATION=NONE`, `OPEN_OTHER_PRS=NONE`). PR #118 is expected to close upon merge, restoring a clean queue.

```text
DOCS_DATE=2026-10-24
GITHUB_MAIN=bf1f911f0e2d405dbf84a04414a04cc0bc6530c9
PRODUCT_MAIN_BASELINE=bf1f911f0e2d405dbf84a04414a04cc0bc6530c9
PRODUCTION_SHA=bf1f911f0e2d405dbf84a04414a04cc0bc6530c9
PRODUCTION_IMAGE=newsflux-local:bf1f911f0e2d
PRODUCTION_IMAGE_ID=sha256:368310dd4e8080571eb8ab72500cce4b6ac27524f4c04e891bc7d45295b8ba2f
PRODUCTION_VERIFICATION=LIVE_VERIFIED_READ_ONLY_SSH_EXACT_SHA
PRODUCTION_CONTAINER=newsflux
PRODUCTION_CONTAINER_STARTED_AT=2026-10-24T20:28:11Z
PRODUCTION_RESTART_COUNT=0
PRODUCTION_IMAGE_REVISION=PASS_bf1f911f0e2d405dbf84a04414a04cc0bc6530c9
PRODUCTION_COMPOSE_CONFIG=/dockerdata/compose/newsflux/compose.yaml
PRODUCTION_COMPOSE_SHA=8cac8c8c2a9ceecdbd5f9cad4a3b026b3e65bb6024fc88123e41843b4549a8f4
PRODUCTION_ROLLBACK_COMPOSE=/dockerdata/compose/newsflux/compose.yaml.pre-bf1f911f0e2d-20261024-172809
PRODUCTION_ROLLBACK_SCRIPT=/root/newsflux-rollback-bf1f911f0e2d-20261024-172809.sh
PRODUCTION_INTERNAL_HTTP=PASS_200
PRODUCTION_PUBLIC_HTTP=200
PRODUCTION_PUBLIC_ALL_HTTP=200
PRODUCTION_PWA_MANIFEST_HTTP=200
PRODUCTION_ASSET_404_CANARY=PASS_404
LIVE_PUBLIC_EDGE_HSTS=OBSERVED
MAIN_PRODUCTION_PARITY=YES
OPEN_PRS_BEFORE_RECONCILIATION=NONE
CURRENT_RECONCILIATION_PR=118_DRAFT
OPEN_OTHER_PRS=NONE

PR109_STATUS=MERGED_DOCUMENTATION
PR109_MERGE_SHA=701895fd690fd3833d0f4a5b1d5a09e22e9731a2
PR106_STATUS=MERGED_DORMANT
PR106_MERGE_SHA=4cb99e196f88b01602a7fa53575430dd74ec5f94
PR111_STATUS=MERGED_SECURITY_HEADERS_BASELINE
PR111_MERGE_SHA=3c1eeb03501dd0993d201c588632fa3c59b0ff7e
PR110_STATUS=MERGED_RESEARCH_STUDY
PR110_MERGE_SHA=fac87b621a63393da6987cf89f6b85c12cede994
PR115_STATUS=MERGED_TEST_STABILIZATION
PR115_MERGE_SHA=a62f53982dd7e0cff4fa2ee90a15574dc490a5d3
PR116_STATUS=MERGED_NAV_COUNT_SEMANTICS
PR116_MERGE_SHA=7c429766e24fd3fbb8a07e126f816d665d19b130
PR117_STATUS=MERGED_CONTEXTUAL_CHROME
PR117_MERGE_SHA=f79a4369677c45122faa8190269ff71eeec0ec76
PR113_STATUS=MERGED_CPU_RUNTIME_CONTRACT
PR113_MERGE_SHA=dd2e9e6ec429d2a8c01a9736b3090b4d20f2c4eb
PR112_STATUS=MERGED_AUTH_APIKEY
PR112_MERGE_SHA=3859e18d4744c7cbbdd97bdee9de3d6fe77ad99b
PR114_STATUS=MERGED_DEPLOYED_COMPLETE
PR114_MERGE_SHA=bf1f911f0e2d405dbf84a04414a04cc0bc6530c9

PR114_DEPLOYMENT_STATUS=PASS
PWA_D1=APPROVED
PWA_D2=APPROVED
PWA_D3=APPROVED
REAL_DEVICE_D3_GATE=PASS

AUTH_APIKEY_01=MERGED_DEPLOYED
MANUAL_TOKEN_AUTH_PRESERVED=YES
AUTH_TRANSACTION_JOURNAL=FAIL_CLOSED_PERSISTENT

STORY_CANDIDATE_RANKING_CODE=MERGED
STORY_CANDIDATE_RANKING_RUNTIME=DISABLED
STORY_CANDIDATE_RANKING_PRODUCTION_ACTIVATION=NOT_AUTHORIZED
STORY_POLICY_E=APPROVED_AS_FUTURE_ACTIVATION_CONTRACT
FULL_POLICY_E_ACTIVATION_GATE=NOT_PROVEN

NNW05_RESEARCH=COMPLETED
SECURITY_HEADERS_BASELINE=COMPLETED
NAV02F_DETERMINED_SLICE=COMPLETED
NNW03_CHROME01_DETERMINED_SLICE=COMPLETED

NON_NEGOTIABLE_BOUNDARIES=MINIFLUX_IS_SOURCE_OF_TRUTH;NO_NEW_PERSISTENT_STATE_WITHOUT_DECISION;CHRONOLOGICAL_UNREAD_ALL_NO_SILENT_RANKING;GLASS_CHROME_ONLY_OPAQUE_CONTENT;SINGLE_PANE_FIRST_MOBILE_TABLET_FOLD;CRITICAL_MEDIUM_884X1104;NO_BLIND_UPSTREAM_SYNC;EXACT_SHA_DEPLOY_ONLY

EXPLICIT_HOLDS=WIDE_DESKTOP_MULTI_PANE_ACTIVATION;AUTOMATIC_VS_OPT_IN_MULTI_PANE;MULTI_PANE_THRESHOLD;HOME_MULTI_PANE_INCLUSION;UNREAD_CATEGORY_GROUPING;DESKTOP_SIDEBAR_WIDTH_CHANGES;SHOW_UNREAD_FEEDS_ONLY_DEFAULT_CHANGE;SIDEBAR_VISUAL_COUNT_CAPPING;STRUCTURAL_FOOTERPANEL_SEARCHANDSORTBAR_CONSOLIDATION;HIDING_MARK_OLDER_ON_TODAY;MOBILE_SOURCES_DRAWER_DESTINATION_DEDUPLICATION;STORY_RANKER_ACTIVATION;NEW_NEWSFLUX_PERSISTENT_CONTENT_STATE;ML_PERSONALIZATION

PRESERVED_FINDINGS=REACT19_ARCO_ELEMENT_REF;RESIZEOBSERVER_LOOP;MOBILE_SCROLL_FLICKER_01;FOOTERPANEL_CLIPPING;HOME_PAGINATION_CURSOR_STALL_01_NOT_REPRODUCED;CHROME_ANDROID_3_BUTTON_NAV_BAR;OLED_SYSTEM_BAR_CANVAS_SEAM

UPSTREAM_LAST_REVIEWED_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c
UPSTREAM_CURRENT_MAIN_OBSERVED=f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b
UPSTREAM_COMMITS_SINCE_REVIEW=13
UPSTREAM_AUDIT_STATUS=PENDING_RECOMMENDED_NEXT

CURRENT_PHASE=POST_PR114_CANONICAL_RECONCILIATION
LAST_COMPLETED_FUNCTIONAL=PWA-01A_INSTALLABILITY / PR #114
RECOMMENDED_NEXT_TRACK=UPSTREAM_AUDIT_02
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
PRODUCTION_MUTATIONS=NO
```

### Live PR inventory (PRs #109 – #117)

- **PR #109 (`701895fd690fd3833d0f4a5b1d5a09e22e9731a2`):** docs: reconcile post-PR108 canonical project state and roadmap. Completed post-PR108 canonical documentation synchronization.
- **PR #106 (`4cb99e196f88b01602a7fa53575430dd74ec5f94`):** feat(story): integrate local candidate ranking pipeline. Integrated dormant story candidate ranking pipeline; zero runtime cost when disabled; runtime inactive.
- **PR #111 (`3c1eeb03501dd0993d201c588632fa3c59b0ff7e`):** security: add conservative response header baseline. Caddy response-header baseline: X-Content-Type-Options: nosniff and Referrer-Policy: strict-origin-when-cross-origin.
- **PR #110 (`fac87b621a63393da6987cf89f6b85c12cede994`):** docs(design): study wide-desktop multi-pane architecture. Completed NNW-05 research study; affirmed single-pane-first boundary; multi-pane on desktop remains on hold.
- **PR #115 (`a62f53982dd7e0cff4fa2ee90a15574dc490a5d3`):** test(home): stabilize Home Recent state-recovery harness. Stabilizes Home Recent empty-state recovery test harness in scripts/tests/phase2c-editorial-home.jsx (HARNESS_ONLY, PRODUCT_CODE_CHANGED=NO).
- **PR #116 (`7c429766e24fd3fbb8a07e126f816d665d19b130`):** feat(nav): harden NAV-02F count semantics. Implemented plural-aware accessible count labels across locales using `Intl.PluralRules`; unresolved grouping/width remain on hold.
- **PR #117 (`f79a4369677c45122faa8190269ff71eeec0ec76`):** feat(chrome): harden contextual controls and touch targets. Contextual-chrome accessibility/touch-target hardening: FooterPanel radiogroup semantics, History visibility semantics, >=44x44 Home/SearchModal controls, and 12-surface control inventory; structural consolidation remains HOLD_PRODUCT_DECISION.
- **PR #113 (`dd2e9e6ec429d2a8c01a9736b3090b4d20f2c4eb`):** chore(story): harden Linux CPU runtime reproducibility. Enforced CPU-only `torch==2.14.1+cpu` wheel via PyTorch CPU wheel index; Policy E approved as future contract; ranker runtime remains disabled and dormant.
- **PR #112 (`3859e18d4744c7cbbdd97bdee9de3d6fe77ad99b`):** feat(auth): migrate NewsFlux sessions to dedicated API keys. Dedicated API key provisioning; manual token authentication preserved; persistent fail-closed auth transaction journal in `localStorage` for lost-create-response orphan key recovery and stale/corrupt/foreign-scope safety.
- **PR #114 (`bf1f911f0e2d405dbf84a04414a04cc0bc6530c9`):** feat(pwa): harden cross-platform installability. PWA-01A installability hardening; D1/D2/D3 approved; real-device D3 gate PASS on Fold; non-blocking residuals recorded; deployed to production at `bf1f911f0e2d`.

### Ordered next-track decision matrix

| Candidate | Track Name                            | Status  | Dependencies                                                         | Decision Required                                                                                                                                         | Recommended Next      | Rationale                                                                                                                                     |
| --------- | ------------------------------------- | ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | UPSTREAM_AUDIT_02                     | READY   | PR #118 canonical reconciliation must close first; no other open PRs | Authorization to audit `electh/ReactFlux` from `3b2b08fb` against current upstream main (`f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b`, 13 commits observed) | **YES (Recommended)** | Governance priority: review upstream drift after closing PRs #106–#117. Last audited at PR #85. Read-only classification only, no blind sync. |
| B         | NAV-02F (Unresolved Areas)            | HOLD    | NAV-02F determined slice merged (PR #116)                            | Product decisions on: unread category grouping, desktop sidebar width, showUnreadFeedsOnly default change, badge count capping                            | NO                    | Unresolved product decisions remain on hold; guessing semantics violates core project boundaries.                                             |
| C         | NNW-03 / CHROME-01 (Unresolved Areas) | HOLD    | NNW-03 determined slice merged (PR #117)                             | Product decisions on: structural FooterPanel/SearchAndSortBar consolidation, hiding Mark older as read on /today                                          | NO                    | Unresolved product decisions remain on hold.                                                                                                  |
| D         | NNW-05 (Wide Desktop Multi-Pane)      | HOLD    | NNW-05 research study merged (PR #110)                               | PM product decisions on wide-desktop activation, threshold, automatic vs opt-in, Home inclusion                                                           | NO                    | Single-pane-first boundary remains binding; multi-pane layout activation remains on hold.                                                     |
| E         | STORY_01 (Production Activation)      | HOLD    | Runtime contract merged (PR #106, #113)                              | PM production activation authorization & execution of full Policy E evidence gate                                                                         | NO                    | Story ranker runtime remains disabled and dormant; Policy E approved as future contract; activation not authorized.                           |
| F         | PWA-02 / PWA-03A Follow-ups           | PLANNED | PWA-01A merged & deployed (PR #114)                                  | PM prioritization of update-safety / service-worker lifecycle (PWA-03A) or device defect adaptation (PWA-02)                                              | NO                    | PWA-01A installability is complete; residual findings (`CHROME_ANDROID_3_BUTTON_NAV_BAR`, `OLED_SYSTEM_BAR_CANVAS_SEAM`) are non-blocking.    |

### Enduring governance and implementation guidelines

- **Miniflux Source of Truth:** Miniflux remains authoritative for feeds, categories, entries, read status, and starred status. No client-only persistent database or divergence.
- **Predictable Ordering:** Feeds and entries in All and Unread scopes remain strictly reverse-chronological or chronological. No hidden ranking outside the dedicated Home lane.
- **Glass Restricted to Chrome:** Glassmorphism and translucent tokens apply solely to navigation bars, headers, and floating chrome. Reader cards, article text, and content views remain solid and fully opaque.
- **Single-Pane-First:** Phone, tablet, and foldable devices maintain single-pane-first presentation. Multi-pane layouts are restricted to wide desktop landscape screens.
- **Exact-SHA Deployments:** Production is updated strictly with verified exact OCI revision hashes, never moving branch tags or `latest`.

---

## 22. Current canonical state: post-UPSTREAM_AUDIT_02 and PR #120 (2026-10-24)

This section supersedes the historical post-PR #114 state in Section 21. Live GitHub checks on 2026-10-24 found `main` at `4c91f25f0ac92c9806f31ea7b766d28d22eb0d28` and no open PRs before this documentation reconciliation. Production remains at the owner-reported PR #114 runtime baseline; production was not re-inspected or modified by this documentation task.

```text
GITHUB_MAIN=4c91f25f0ac92c9806f31ea7b766d28d22eb0d28
PRODUCTION_SHA=bf1f911f0e2d405dbf84a04414a04cc0bc6530c9
PRODUCTION_IMAGE=newsflux-local:bf1f911f0e2d
PRODUCTION_IMAGE_ID=sha256:368310dd4e8080571eb8ab72500cce4b6ac27524f4c04e891bc7d45295b8ba2f
PRODUCTION_COMPOSE_SHA=8cac8c8c2a9ceecdbd5f9cad4a3b026b3e65bb6024fc88123e41843b4549a8f4
PRODUCTION_STATE_SOURCE=OWNER_REPORTED_EXACT_SHA_HANDOFF
PRODUCTION_STATE=UNCHANGED_INTENTIONALLY
MAIN_PRODUCTION_SHA_PARITY=NO
APPLICATION_RUNTIME_DELTA_SINCE_PRODUCTION=NO
DEPLOYMENT_REQUIRED_FOR_PRS_118_119_120=NO

PR118_STATUS=MERGED_DOCUMENTATION
PR118_MERGE_SHA=27ace63bf524304fe28b9fffb61e3da049c5a6a8
PR119_STATUS=MERGED_UPSTREAM_INTEGRATE
PR119_MERGE_SHA=aed1459f2546fd987718723ab11293793a7afa13
PR120_STATUS=MERGED_UPSTREAM_ADAPT
PR120_MERGE_SHA=4c91f25f0ac92c9806f31ea7b766d28d22eb0d28

UPSTREAM_AUDIT_02=COMPLETE_ACCEPTED
UPSTREAM_LAST_REVIEWED_BEFORE=3b2b08fb6036ef94f92a757ac6f3df889be8515c
UPSTREAM_LAST_REVIEWED_AFTER=f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b
UPSTREAM_CURRENT_MAIN=f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b
UNREVIEWED_UPSTREAM_COMMITS_AFTER_AUDIT=0
UPSTREAM_COMMITS_REVIEWED=13
LAST_INTEGRATED_UPSTREAM_SHA=3b2b08fb6036ef94f92a757ac6f3df889be8515c

LATEST_RUNTIME_DEPLOYED_TRACK=PWA-01A / PR #114
LATEST_MERGED_TRACK=UPSTREAM_AUDIT_02_ACTIONABLE_INTEGRATIONS / PR #120
LAST_COMPLETED_TRACK=UPSTREAM_AUDIT_02_ACTIONABLE_INTEGRATIONS / PR #120
CURRENT_PHASE=POST_UPSTREAM_AUDIT_02_CANONICAL_RECONCILIATION
RECOMMENDED_NEXT_TRACK=PWA-VAL-01_RUNTIME_DEVICE_VALIDATION (EVIDENCE_ONLY; PM PRIORITIZATION REQUIRED)
IMPLEMENTATION_AUTHORIZED=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

### UPSTREAM_AUDIT_02 outcome

The PM accepted the formal review of 13 commits from `3b2b08fb6036ef94f92a757ac6f3df889be8515c` through the live upstream `main` at `f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b`. Live upstream `main` remained at that reviewed SHA; there are zero unreviewed commits after the audit. The reviewed frontier is not the integrated code frontier: `LAST_INTEGRATED_UPSTREAM_SHA` remains `3b2b08fb...`.

| Classification | Upstream commit(s)                                                                                                                                                                                                                                                                                                                                             | Disposition                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INTEGRATE (1)  | `df1690e454ef62b6d3fe143c2f17595eb4d1842b`                                                                                                                                                                                                                                                                                                                     | Implemented by PR #119 (`aed1459f2546fd987718723ab11293793a7afa13`); font failure-report comments now use `GITHUB_REPOSITORY`.                                                                                       |
| ADAPT (1)      | `d55916e8f8e67474bc500d6a01abcbdcb7d18eb8`                                                                                                                                                                                                                                                                                                                     | Adapted by PR #120 (`4c91f25f0ac92c9806f31ea7b766d28d22eb0d28`); preserves restricted Docker GHA cache exports, fatal build/push errors and existing provenance/publishing authorization.                            |
| SKIP (3)       | `2edb62a1c1156cae9f51a119cd16625be8756470`; `bb4c2c0c318cc6d8fee68026a133ec8db2b0a4fc`; `8b38b1b0c779da34fec5278bb301a082c54ffd9a`                                                                                                                                                                                                                             | Knip is dev-tooling maintenance outside sync scope; Dependabot grouping and `--ignore-scripts` are already covered in NewsFlux.                                                                                      |
| HOLD (8)       | `28bb8d625bde098f0c6a0f163a77beffb441ca9f`; `ece96d8a2739f3fa4d5c3372caedeb7c96ad6b36`; `83fa55b7cc5a12b76a0a1dd1536eac5efa3f73b3`; `6920689085a76ccb6b904bdd431aae8a313cc75d`; `ff0357fd07f5fd79bebdd0fe697bf31b0ac9efd1`; `77973ed1f655089433edb7c1beef39d57179a150`; `5f9507b93b2cf61d9f5d0a7eef99fe6bd98a2170`; `f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b` | React 19.3.1, ReactDOM 19.3.1, PostCSS 8.5.31, Virtua 0.53.6, html-react-parser 6.1.9, Vite 8.3.5, React Router 8.5.0 and Framer Motion 14.6.0 remain separate dependency regressions; no bulk update is authorized. |

### Production and merged PR state

| PR   | Current result                                                          | Runtime effect                                       |
| ---- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| #118 | Merged documentation at `27ace63bf524304fe28b9fffb61e3da049c5a6a8`      | Documentation only; no application runtime change.   |
| #119 | Merged upstream INTEGRATE at `aed1459f2546fd987718723ab11293793a7afa13` | GitHub font workflow only; no deployment required.   |
| #120 | Merged upstream ADAPT at `4c91f25f0ac92c9806f31ea7b766d28d22eb0d28`     | GitHub deploy workflow only; no deployment required. |

Production remains `bf1f911f0e2d405dbf84a04414a04cc0bc6530c9` (`newsflux-local:bf1f911f0e2d`, image ID `sha256:368310dd4e8080571eb8ab72500cce4b6ac27524f4c04e891bc7d45295b8ba2f`, compose SHA `8cac8c8c2a9ceecdbd5f9cad4a3b026b3e65bb6024fc88123e41843b4549a8f4`). These exact production identifiers are from the owner-reported handoff, not a fresh server inspection. The main/production SHA parity is NO, but there is no application runtime delta since production because the intervening main commits were documentation and workflow-only. No catch-up deploy is required for #118–#120; production intentionally remains unchanged.

### Current product baseline and holds

- **PWA:** PWA-01A / PR #114 is complete, merged and deployed; D1/D2/D3 are approved and the real-device D3 gate passed. PWA-03A update safety/recovery is complete in the deployed baseline. PWA-VAL-01 remains a planned evidence-only device/runtime validation; PWA-02 stays defect-driven. This roadmap does not authorize implementation or promotion.
- **Authentication:** AUTH_APIKEY_01 is complete, merged and deployed; manual token authentication remains supported and the consent/create/verify/store/drop-password/revoke lifecycle is preserved.
- **Story:** ranking code is merged but runtime-disabled; production activation is not authorized. CPU acceptance is a proposed policy awaiting PM decision; recorded measurements do not constitute adoption or authorization.
- **NNW/navigation:** NNW-05 research, NAV-02F determined slice and NNW-03/CHROME-01 determined slice are complete; unresolved product decisions remain held below.
- **Source of truth:** Miniflux remains authoritative for feeds, categories, read and starred state. All/Unread remain chronological and predictable; no silent ranking. New persistent NewsFlux content state and ML personalization remain unauthorized.
- **Open product holds:** wide-desktop multi-pane activation; automatic vs. opt-in mode; threshold; Home inclusion; unread category grouping; desktop Sidebar width; changing the `showUnreadFeedsOnly` default; visual count capping; FooterPanel/SearchAndSortBar consolidation; hiding Mark older as read on `/today`; mobile Sources drawer destination deduplication; Story production activation; new persistent content state; ML personalization.
- **Open findings:** React 19 Arco `element.ref`; ResizeObserver loop; MOBILE_SCROLL_FLICKER_01; FooterPanel clipping; HOME_PAGINATION_CURSOR_STALL_01 (not reproduced after PR #87); Chrome Android three-button navigation bar; OLED system-bar canvas seam.

### Docker publishing identity — separate architecture backlog

`DOCKER_PUBLISHING_IDENTITY_01` is `BACKLOG_HOLD` (`HOLD_ARCHITECTURE_AUDIT_REQUIRED`). Publishing workflows still require the `electh/ReactFlux` repository identity and use `electh/reactflux` as the image destination, so publishing remains blocked for `jfsdias/NewsFlux`. A separate decision must establish whether NewsFlux wants GitHub/Docker Hub publishing given its self-hosted exact-SHA local-image production model. Do not enable publishing, change guards or destination, add credentials, or alter topology in this roadmap reconciliation.

### Current next-track decision matrix

The completed UPSTREAM_AUDIT_02 is removed from the ready/recommended queue. PWA-VAL-01 has precedence as an already-planned evidence-only validation stage: it can assess the deployed baseline without application changes, while PWA-03A is complete and PWA-02 is defect-driven. This recommendation is subject to PM prioritization, device availability and the existing runbook; it authorizes no implementation.

| Candidate                            | Status                            | Gate / decision                                                                                                                                                | Recommended order              |
| ------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| PWA-VAL-01 runtime/device validation | PLANNED — evidence-only           | PM prioritization and physical-device availability; no code, deploy or inferred screen-reader PASS.                                                            | **Recommended next candidate** |
| NAV-02F decisions                    | HOLD — product                    | Decide unread category grouping, Sidebar width, unread-only default and count capping.                                                                         | Later, after decisions         |
| NNW-03 / CHROME-01 decisions         | HOLD — product                    | Decide structural FooterPanel/SearchAndSortBar consolidation and `/today` Mark older behavior.                                                                 | Later, after decisions         |
| NNW-05 wide-desktop multi-pane       | HOLD — product                    | Decide activation, automatic vs. opt-in, threshold and Home inclusion.                                                                                         | Later, after decisions         |
| Story activation                     | HOLD — product/evidence           | Runtime stays disabled; CPU acceptance policy remains proposed and PM-decision-required; complete activation evidence and explicit authorization are required. | No activation authorized       |
| Eight upstream dependency updates    | HOLD — isolated regression slices | Assess each production/build/visual/lockfile impact independently.                                                                                             | No bulk update                 |
| DOCKER_PUBLISHING_IDENTITY_01        | BACKLOG — architecture            | Decide whether to establish registry publishing before changing identity, guards, credentials or release topology.                                             | Unordered                      |

The next step is a prioritization decision for PWA-VAL-01, not automatic execution. Every item remains subject to the project rules: one purpose per PR, no blind upstream sync, no new persistent state without architecture approval, and no merge without explicit user authorization.

## 23. Current canonical state: post-PR #129 / STORY-01B-R (2026-10-25)

This section supersedes the historical post-NAV-02F-A state. GitHub main was live-verified at `de138bc961d665005fe3322082034963bf263b16` following the merge of STORY-01B-R (PR #129). Deployed production application revision remains `dc4154d7729204c65c8a1abaa50f9bfc9f92be64` (image `newsflux-local:dc4154d77292`). Main/production SHA parity is NO, but MAIN_PRODUCTION_PARITY_REQUIRED is NO: PR #129 was exclusively research documentation and offline harness tooling, introducing zero product runtime changes and zero production import changes. This divergence is intentional (`INTENTIONAL_DIVERGENCE=YES`, `DEPLOYMENT_DRIFT_REQUIRING_REMEDIATION=NO`); no deployment or canary is required (`DEPLOY_REQUIRED=NO`, `CANARY_REQUIRED=NO`).

NAV-02F-A is completed (`PR128_MERGE_SHA=dc4154d7729204c65c8a1abaa50f9bfc9f92be64`). Unread source navigation regained category rhythm without collapsible hierarchy or persistent state. `showUnreadFeedsOnly` default remains false; sidebar width unchanged; exact unread counts preserved.

STORY-01B-R is completed (`PR129_MERGE_SHA=de138bc961d665005fe3322082034963bf263b16`). Mode was bounded research, reference audit, corpus contract, offline feature extraction harness, and draft PR. No product activation, no home clustering, no All/Unread change, no merge, no deploy.

### NAV-02F Product Decisions (Completed in PR #128)

- **A. Unread category grouping (ADAPT):** COMPLETED in PR #128. Unread feed navigation displays non-collapsible, non-interactive category headings with existing feed rows underneath. Only categories containing at least one matching unread feed appear.
- **B. Default mode:** `showUnreadFeedsOnly` default remains `false` in `src/utils/settings-schema.js` (`NO_DEFAULT_BEHAVIOR_CHANGE=YES`). Existing explicit Unread / All radio toggle remains canonical.
- **C. Sidebar width:** Current contract preserved (`SIDEBAR_WIDTH_CHANGED=NO`). No sidebar width changes.
- **D. Count capping:** No capping (`COUNT_CAPPING=NONE`). Exact unread counts are preserved without 99+, 999+, abbreviated, or K-format counts for RSS predictability and accessible count labels.

### STORY-01B-R Scope and Invariants (Completed in PR #129)

- **Audited NewsBlur Reference:** Comprehensive audit of `samuelclay/NewsBlur` (`d7c61b5b3ed7a991a2385b1991449085029711d6`), analyzing two-tier clustering, Redis storage, river view folding, and the transitive chaining failure mode in `docs/research/STORY01B_NEWSBLUR_REFERENCE.md`.
- **Corpus and Label Contract:** Formalization of the frozen Home-200 corpus (`c12842f11c2bb3e941f182ed946e6a98ae6c70bb69ea8e7908285506af8a2ed8` via `HISTORICAL_ARTIFACT_DECLARATION`, byte SHA256 `0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0`, 200 articles, 18,953 cross-feed pairs), pairwise feature schema (`story01b-pair-v1`), 4-class label taxonomy (`SAME_EVENT`, `RELATED_TOPIC`, `DIFFERENT_EVENT`, `UNCERTAIN`), asymmetric loss policy (`FALSE_MERGE_COST > FALSE_SPLIT_COST`), and rejection of unrestricted union-find (`UNRESTRICTED_UNION_FIND_FOR_FINAL_CLUSTERING=REJECTED`) in `docs/research/STORY01B_CORPUS_AND_LABEL_CONTRACT.md`. Storage governance: `STORY_IDENTITY_PRODUCTION_STORAGE=HOLD_ARCHITECTURE_DECISION`, `CLUSTER_WIDE_MARK_READ=HOLD_PRODUCT_DECISION`, `NEW_PRODUCTION_PERSISTENT_STATE_AUTHORIZED=NO`.
- **Reproducible Offline Research Harness:** Isolated, deterministic harness in `scripts/research/story-identity-v1/` (`harness.py`, `test_harness.py`) validating corpus integrity, Qwen/Mistral embeddings, candidate universe, mathematical semantic vector cosine parity (`PAIR_SCORE_PARITY_GATE=PASS`), transitive chain candidate detection (`TRANSITIVE_CHAIN_CANDIDATE_COUNT=12`), deterministic feature extraction, and 10-strata empirical sampling (`RANDOM_SEED=20261025`, 141 candidate pairs).
- **Invariants:** Zero product code modifications; zero network inference (`MISTRAL_API_CALLS=0`, `OLLAMA_CALLS=0`); zero Miniflux mutations (`MINIFLUX_WRITES=0`); private artifacts excluded from git (`PRIVATE_ARTIFACT_TRACKED_BY_GIT=NO`).

```text
GITHUB_MAIN=de138bc961d665005fe3322082034963bf263b16
PRODUCTION_SHA=dc4154d7729204c65c8a1abaa50f9bfc9f92be64
PRODUCTION_IMAGE=newsflux-local:dc4154d77292
MAIN_PRODUCTION_SHA_PARITY=NO
MAIN_PRODUCTION_PARITY_REQUIRED=NO
INTENTIONAL_DIVERGENCE=YES
DEPLOYMENT_DRIFT_REQUIRING_REMEDIATION=NO
APPLICATION_RUNTIME_DELTA_SINCE_PRODUCTION=NO
DEPLOY_REQUIRED=NO
CANARY_REQUIRED=NO

UPSTREAM_LAST_REVIEWED=f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b
UPSTREAM_DRIFT_FROM_REVIEWED_BASELINE=NO

NAV-02F-A=COMPLETED
PR128_MERGE_SHA=dc4154d7729204c65c8a1abaa50f9bfc9f92be64
PR128_PRODUCTION_SHA=dc4154d7729204c65c8a1abaa50f9bfc9f92be64
PR128_PRODUCTION_SMOKE=PASS
SHOW_UNREAD_DEFAULT_CHANGED=NO
SHOW_UNREAD_DEFAULT=false
SIDEBAR_WIDTH_CHANGED=NO
COUNT_CAPPING=NONE

STORY-01B-R=COMPLETED
PR129_MERGE_SHA=de138bc961d665005fe3322082034963bf263b16
PR129_SCOPE=RESEARCH_DOCUMENTATION_OFFLINE_HARNESS
PR129_PRODUCT_RUNTIME_CHANGE=NO
PR129_PRODUCTION_IMPORT_CHANGE=NO
NEWSBLUR_REFERENCE_AUDIT=COMPLETE
NEWSBLUR_REFERENCE_SHA=d7c61b5b3ed7a991a2385b1991449085029711d6
CORPUS_CONTRACT=COMPLETE
CORPUS_FINGERPRINT=c12842f11c2bb3e941f182ed946e6a98ae6c70bb69ea8e7908285506af8a2ed8
CORPUS_FILE_SHA256=0dbd48cdb37063f3a1683f7ef8fc9a2582196a2e8d42c34485b85e12242178f0
PAIR_UNIVERSE=18953
LABEL_QUEUE=141
TRANSITIVE_CHAIN_CANDIDATE_TRIPLES=12
UNRESTRICTED_UNION_FIND_FOR_FINAL_CLUSTERING=REJECTED
FALSE_MERGE_COST_GT_FALSE_SPLIT_COST=YES
RESEARCH_HARNESS_TESTS=PASS
MISTRAL_API_CALLS=0
OLLAMA_CALLS=0
MINIFLUX_WRITES=0
PRODUCTION_REQUESTS=0
PRIVATE_ARTIFACT_TRACKED_BY_GIT=NO

STORY_RANKER=DORMANT
STORY_RANKER_DEFAULT=DISABLED
STORY_CLUSTERING=NOT_ACTIVE
STORY_IDENTITY_PRODUCTION_STORAGE=HOLD_ARCHITECTURE_DECISION
CLUSTER_WIDE_MARK_READ=HOLD_PRODUCT_DECISION

STALE_DEPLOY_SCRIPT_TARGET=cf37807a4d3b9da39d3c438861fac358d936fdaa
STALE_DEPLOY_SCRIPT=YES
STALE_SCRIPT_EXECUTED=NO
STALE_SCRIPT_RETARGETED=NO
STALE_SCRIPT_REJECTED=YES

LATEST_RUNTIME_DEPLOYED_TRACK=NAV-02F-A / PR #128
LATEST_MERGED_TRACK=STORY-01B-R / PR #129
LAST_COMPLETED_TRACK=STORY-01B-R / PR #129
LAST_MERGED_PR=#129
CURRENT_PHASE=STORY_IDENTITY_GOLD_DATASET_PENDING_AUTHORIZATION
CURRENT_TRACK=NONE_ACTIVE
RECOMMENDED_NEXT_TRACK=STORY-01B-D (DATASET_CURATION_AND_LABELING)
NEXT_TRACK_AUTHORIZED=NO
IMPLEMENTATION_AUTHORIZED=NO
NEXT_AUTHORIZED_ACTION=NONE
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

### Current next-track decision matrix

With STORY-01B-R merged to main in PR #129, there is currently no active track authorized. Recommended next track is STORY-01B-D (dataset curation and labeling), but no implementation is authorized. All product runtime modifications remain on hold.

| Candidate                                   | Status                                      | Gate / decision                                                                                                                                                | Recommended order              |
| ------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| STORY-01B-D dataset curation & labeling     | PLANNED / NEXT_RECOMMENDED (NOT_AUTHORIZED) | Annotate 141 candidate pairs from STORY-01B-R queue; multi-judge adjudication of UNCERTAIN pairs. Not authorized; pending PM prioritization / authorization.   | **Recommended next candidate** |
| STORY-01B-R NewsBlur ref & corpus contract  | COMPLETED                                   | Audit NewsBlur clustering, establish Home-200 corpus contract, feature schema, label taxonomy, and offline harness; research only; merged in PR #129.          | Complete                       |
| NAV-02F-A unread source category rhythm     | COMPLETED                                   | Non-collapsible category headings + feed rows; showUnreadFeedsOnly default=false; exact unread counts; merged in PR #128.                                      | Complete                       |
| HARNESS-VIS-01B Arco selector correction    | COMPLETED                                   | Correct stale `.arco-message-notice` / `.arco-notification-notice` selectors in `chrome01b-visual-gate.js` to match current rendered roots; merged in PR #127. | Complete                       |
| HARNESS-VIS-01A browser harness portability | COMPLETED                                   | Replace hardcoded macOS Chrome paths with cross-platform discovery, `CHROME_PATH` override, and host-independent unit tests; merged in PR #126.                | Complete                       |
| READER-VISUAL-02B interaction-aware chrome  | COMPLETED                                   | Auto-hide sticky ActionButtons on downward reading; immediate return on upward scroll/focus; focus safety and reduced motion; production smoke PASS.           | Complete                       |
| PWA-VAL-01 runtime/device validation        | PARTIAL_ACCEPTED                            | Real-device PWA validation executed; PWA_02_TRIGGERED=NO; do not reopen PWA work.                                                                              | Complete                       |
| NNW-03 / CHROME-01 decisions                | HOLD — product                              | Decide structural FooterPanel/SearchAndSortBar consolidation and `/today` Mark older behavior.                                                                 | Later, after decisions         |
| NNW-05 wide-desktop multi-pane              | HOLD — product                              | Decide activation, automatic vs. opt-in, threshold and Home inclusion.                                                                                         | Later, after decisions         |
| Story activation                            | HOLD — product/evidence                     | Runtime stays disabled; CPU acceptance policy remains proposed and PM-decision-required; complete activation evidence and explicit authorization are required. | No activation authorized       |
| Eight upstream dependency updates           | HOLD — isolated regression slices           | Assess each production/build/visual/lockfile impact independently.                                                                                             | No bulk update                 |
| DOCKER_PUBLISHING_IDENTITY_01               | BACKLOG — architecture                      | Decide whether to establish registry publishing before changing identity, guards, credentials or release topology.                                             | Unordered                      |

There is currently no active track authorized. Recommended next track is STORY-01B-D (dataset curation and labeling), but no implementation is authorized. Every item remains subject to the project rules: one purpose per PR, no blind upstream sync, no new persistent state without architecture approval, and no merge without explicit user authorization.
