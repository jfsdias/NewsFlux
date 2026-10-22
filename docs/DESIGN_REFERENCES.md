# NewsFlux Design References — NetNewsWire UX Research Track

- **Status:** accepted as **design input**, not as an implementation request or a visual clone.
- **Created:** 2026-10-22, against GitHub `main` at `d7c0fc8e4ab7b5f0d959bea96cc04b086deb36fc`.
- **Track:** `NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT`.
- **Amended:** 2026-10-22, after the PM review of PR #86 (PASS WITH DOCUMENTATION AMENDMENTS): the `SOURCE_IDENTITY` definition is confirmed. No product code changed.
- **Companion documents:** [`PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md), [`NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md) (visual foundation and earlier reference review), [`NEWSFLUX_NAV_VISUAL_01.md`](./NEWSFLUX_NAV_VISUAL_01.md) (navigation contract), [`NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md), [`NEWSFLUX_ROADMAP.md`](./NEWSFLUX_ROADMAP.md).

```text
NETNEWSWIRE_UX_REFERENCE=ACCEPTED_AS_DESIGN_INPUT
NNW_IMPLEMENTATION_AUTHORIZED=NO
SOURCE_IDENTITY_DEFINITION=CONFIRMED_PUBLISHER_FEED_SOURCE_LEVEL_VISUAL_IDENTITY
STORY_IDENTITY_IN_NNW01=NO
VISUAL_CLONE_REQUESTED=NO
PERMANENT_THREE_PANE_DEFAULT=NO (unchanged)
SINGLE_PANE_FIRST_MOBILE_TABLET_FOLD=YES (unchanged)
CRITICAL_VIEWPORT=884x1104 (unchanged)
LIQUID_GLASS_SCOPE=CHROME_ONLY (unchanged)
CONTENT_SURFACES=OPAQUE (unchanged)
NEW_PERSISTENT_NEWSFLUX_STATE_AUTHORIZED=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

## 1. How to read this document

Every track separates two things that are easy to conflate:

- **`REFERENCE_PATTERN`** — what NetNewsWire (NNW) does, as observed. It is evidence, not a requirement.
- **`NEWSFLUX_PRODUCT_DECISION`** — what NewsFlux would do. Each decision carries a status:
  - `BINDING` — already fixed by an existing NewsFlux contract; not reopened here.
  - `PROPOSED` — a recommendation that still needs PM approval; **not** a decision.
  - `OPEN` — genuinely undecided; lists what evidence is needed.

Decisions already made are **not reopened without new evidence**: no permanent three-pane default, no glass over content, single-pane-first mobile/tablet/Fold, critical viewport `884×1104`, OLED-aware editorial direction, Material-style interactions, deterministic All/Unread. NewsFlux uses Arco Design components and its own `--nf-*` tokens; NNW patterns are **mapped**, not copied. No NNW asset, icon, color or code is reproduced.

### Evidence labels

Same labels as the PWA contract: `CODE_VERIFIED` (read in the repository at the SHA above), `REFERENCE_OBSERVED` (seen in the supplied NNW screenshots), `INFERENCE`, `PLATFORM_KNOWLEDGE`, `PM_REPORTED`.

## 2. Source material

Three NetNewsWire screenshots were supplied with the planning request: a macOS three-pane window with the sidebar highlighted, an iPad landscape (dark) with annotated arrows, and an iPhone Feeds screen. They are third-party UI and are **not stored in this repository**; this section is the durable textual record.

| Ref | Surface               | Observations (`REFERENCE_OBSERVED`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | macOS — sidebar       | Labeled sections (Smart Feeds; an account group per source) separate clearly. Smart Feeds are first (Today, All Unread, Starred). Folders have disclosure triangles and can be expanded to show their feeds; feeds carry a small favicon. Counts are small, right-aligned and discreet; rows with nothing unread show none. The selected row is unmistakable but quiet when the pane is not focused. High density without visual noise comes from quiet type and spacing, not from shrinking everything. |
| S2  | macOS — article list  | Each row leads with a larger source mark as a visual anchor, then a two-line bold title, a two-line grey summary, and a bottom line with the source name and time. An unread dot and a star cue appear on some rows. The selected row is a solid accent fill with inverted text. Density is high and readable.                                                                                                                                                                                           |
| S3  | macOS — reader header | The source name and author sit top-left above the title; the **source mark sits at the opposite top corner**, small, monochrome-friendly and not competing with the title. The title is large; an uppercase small date line follows; a hero image comes next.                                                                                                                                                                                                                                            |
| S4  | macOS — toolbar       | Compact commands at the top: sidebar/refresh/add on the left; mark read, star, reader view, share and open-in-browser grouped on the right; a search field at the far right.                                                                                                                                                                                                                                                                                                                             |
| S5  | iPad landscape (dark) | Annotated: sidebar header with filter and sidebar-toggle buttons; Smart Feeds in a rounded group; the favicon column in the article list; a filter button in the list header; previous/next chevrons and a "Search Articles" field in the reader toolbar; the source favicon at the reader's top-right.                                                                                                                                                                                                  |
| S6  | iPhone — Feeds        | Large "Feeds" title with an "Updated … ago" subtitle; a floating circular filter button at the top-right; collapsible section headers with a chevron; inset rounded groups (Smart Feeds, then account groups) with right-aligned counts and favicon leaders; floating circular Settings (bottom-left) and Add (bottom-right) buttons that read as glass-like chrome.                                                                                                                                     |

Caveat: screenshots show one moment of NNW's own platform conventions (AppKit/UIKit, Apple HIG). They do not show NNW behavior (keyboard, focus, state), only its static composition.

## 3. NewsFlux current state per surface (`CODE_VERIFIED`)

| Surface              | Current NewsFlux state                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar rows         | Smart-style destinations (Home, All/unread total, Today, Starred, History) with counts; categories as expandable groups (`expandedCategoriesState`, persisted); feeds with `FeedIcon` (`showFeedIcon`), unread counts (`showZeroCount` logic) and a feed-health indicator. A Unread/All source-mode radiogroup and a source filter input exist. `compactSidebarGroups` (default `true`) and `desktopSidebarCollapsed` are persisted. |
| Compact navigation   | Five destinations: Home, All, Today, Starred, Feeds; badges in the accessible name; ≥ 48×48 px targets (NAV-VISUAL-01 contract).                                                                                                                                                                                                                                                                                                     |
| Window classes       | `COMPACT` < 600 px wide and ≥ 480 high; `MEDIUM` 600–992 (or narrow and short); `DESKTOP` ≥ 993. `884×1104` is `MEDIUM`. A separate legacy 768 px content-density axis is retained. Expanded desktop Sider is 240 px.                                                                                                                                                                                                                |
| Article list rows    | Three layouts (column card, grid card, list item) via `ArticleCard`, `ArticleGridCard`, `ArticleListItem`; each renders `FeedIcon` with an optional deterministic monogram fallback (`LIST-VISUAL-01`).                                                                                                                                                                                                                              |
| Reader header        | Feed title as a link to `/feed/:id`, author, category tag, date and reading time, under an `h1` title; **no source mark**. Header alignment is guarded by the `.article-header-column` gate (READER-VISUAL-02A2).                                                                                                                                                                                                                    |
| Reader actions       | `ActionButtons`: close, previous, next, mark read/unread, star/unstar, fetch original content, open externally, share, save to third-party services, view comments, table of contents, more actions (font family and size, article width, title alignment, edge-to-edge images).                                                                                                                                                     |
| List header          | `SearchAndSortBar`: search input with syntax help and active-query state, sort direction, date filter (select, today, clear, confirm).                                                                                                                                                                                                                                                                                               |
| List footer          | `FooterPanel`: status filter (All/Unread/Starred), refresh, mark all as read (confirm and Undo), mark older than N days as read (presets, partial-failure feedback).                                                                                                                                                                                                                                                                 |
| Source identity data | Miniflux `GET /v1/icons/{id}` into an in-memory store, or an `external_icon_id` URL; fallbacks: a third-party icon service by registrable domain, then a bundled default icon, or a monogram when requested.                                                                                                                                                                                                                         |

## 4. Tracks

### NNW-01 — SOURCE_IDENTITY

**Goal:** one consistent visual identity for a source across the sidebar, the article list and the reader.

**`REFERENCE_PATTERN`** (S1, S2, S3, S5, S6): the same source mark appears small in sidebar rows, larger as a leading anchor in list rows, and at a reader-header corner; the identity is recognizable across all three.

**`NEWSFLUX_PRODUCT_DECISION`**

| #   | Decision                                                                                                                                                         | Status                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | A **single identity primitive** renders the mark plus a deterministic fallback and is reused on every surface (sidebar, list layouts, reader, home-page picker). | `PROPOSED`                            |
| 2   | **No new persistence.** Identity derives from Miniflux data held in memory; only the HTTP cache may retain image bytes.                                          | `BINDING` (roadmap §6/§12)            |
| 3   | A missing or failed icon never produces a broken image; the existing deterministic monogram is the terminal fallback.                                            | `PROPOSED` (extends `LIST-VISUAL-01`) |
| 4   | The third-party icon fallback (domain-based service) is kept, made opt-in, proxied through Miniflux, or removed.                                                 | `OPEN` — decision D7                  |
| 5   | The mark sits on an **opaque** neutral backing that keeps contrast for light and dark logos on OLED and light surfaces.                                          | `PROPOSED`                            |
| 6   | Icons are decorative (`alt=""`) when an adjacent text names the source; the monogram is `aria-hidden`.                                                           | `PROPOSED` (matches current usage)    |

**Relation to the existing backlog — `SOURCE_IDENTITY` CONFIRMED by the PM (review of PR #86).** The roadmap lists `SOURCE_IDENTITY / STORY_IDENTITY — ARCHITECTURE / RESEARCH GATES`. The PM confirmed that **`SOURCE_IDENTITY` means publisher/feed/source-level visual identity, reused across the sidebar, the article list and the reader.** **`STORY_IDENTITY` remains story-level identity and clustering semantics and is not part of NNW-01.** The no-new-persistence constraint is kept; anything needing storage remains architecture-gated.

**Investigation scope**

- Origin: `/v1/icons/{id}` data URL, `external_icon_id` URL, domain-service fallback, bundled default; failure and non-square handling (`FeedIcon` falls back when width ≠ height).
- Performance: one icon request per distinct feed id; in-memory only; no list-scroll regression; reserve space to avoid layout shift.
- Cache: HTTP cache for URL-based icons; none for API data URLs; no persistence added.
- Contrast and dark/OLED: opaque backing, monogram text contrast, white-on-white and black-on-black logos.
- Behavior without a favicon: deterministic monogram, same footprint as an image.
- Accessibility: naming, `aria-hidden`, no reliance on color alone.

**Findings (reported, not fixed).** Third-party fallback discloses followed-site hostnames (F8). `getSecondHostname` returns the last two labels, so `www.bbc.co.uk` resolves to `co.uk`, producing the wrong icon request for multi-part public suffixes (`CODE_VERIFIED`).

**Gates**

`NNW01_IDENTITY_CONSISTENCY` (same feed → same mark and fallback on every surface), `NNW01_FALLBACK_DETERMINISTIC`, `NNW01_NO_LAYOUT_SHIFT`, `NNW01_CONTRAST`, `NNW01_NO_NEW_PERSISTENCE` (storage inventory unchanged), `NNW01_THIRD_PARTY_POLICY` (matches D7), `NNW01_PERF` (no list-scroll or time-to-content regression), plus the list regression and Mark-All gates and `A11Y_*`.

**Dependencies:** none upstream of it in this track; D7 before 01B. **Risks:** icon quality varies by publisher; the monogram footprint must match images or the list jitters.

**PR split:** `NNW-01A` identity primitive and sidebar/list wiring (no reader); `NNW-01B` fallback and privacy policy (after D7); `NNW-01C` icon persistence — **HOLD — ARCHITECTURE**, not scheduled.

### NNW-02 — NAVIGATION_DENSITY

**Goal:** a more information-efficient sidebar that does not compromise touch targets, legibility, Fold/tablet, single-pane mobile or OLED.

**`REFERENCE_PATTERN`** (S1, S5, S6): labeled, clearly separated groups; Smart Feeds first; folder disclosure; discreet right-aligned counts with none for empty rows; unmistakable selection; small favicons; on iOS an inset rounded group with collapsible section headers.

**`NEWSFLUX_PRODUCT_DECISION`**

| #   | Decision                                                                                                                                                                                          | Status                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Density is **pointer-conditional**: only desktop with a fine pointer may tighten rows. Touch keeps ≥ 44 px form and ≥ 48 px navigation targets. NNW's macOS row height is not a target for touch. | `PROPOSED`                              |
| 2   | No new persisted state. Reuse `compactSidebarGroups`, `expandedCategories`, `desktopSidebarCollapsed`, `showUnreadFeedsOnly`, `showFeedIcon`.                                                     | `BINDING`                               |
| 3   | Selection keeps a **non-color** indicator (`aria-current`) in addition to fill.                                                                                                                   | `BINDING` (NAV-VISUAL-01 a11y contract) |
| 4   | The sidebar surface is opaque; glass remains chrome only.                                                                                                                                         | `BINDING`                               |
| 5   | Compact and Medium navigation keep the NAV-VISUAL-01 model (bottom bar / rail + Sources entry). This track does **not** redesign them.                                                            | `BINDING`                               |
| 6   | Grouping, optional Unread grouping, sidebar width and count presentation are part of `NAV-02F`.                                                                                                   | `OPEN` — product decision               |

**Dependencies:** `NAV-02F` decisions; `NAV-VISUAL-01` PR2 (Sources panel), PR4 (Medium rail) and PR7 (sidebar model alignment); several of its nine open decisions (Sources drawer vs bottom sheet, profile placement, legacy 768 px axis). Implementation does **not** precede those decisions. The tablet header-width fix (PR #76) is merged and closes `TABLET-HEADER-WIDTH-01` (PM review of PR #86), so that finding no longer gates this track.

**Investigation scope:** groupings and indentation (SubMenu depth vs rows), disclosure and persisted expanded state, count presentation (tabular, subtle, zero handling), selection styling, keyboard navigation (the current structure is an Arco Menu; arrow-key and tree semantics are **not audited** — to be measured), collapsed/expanded behavior at each window class, touch-target and text-zoom resilience.

**Gates:** `DG-1` (post-change visible list height ÷ baseline ≥ 0.90 at `390×844`), `A11Y_TOUCH_TARGET`, `A11Y_KEYBOARD`, `A11Y_ZOOM_TEXT_SIZE`, `A11Y_CONTRAST`, `884×1104`, Fold narrow state, OLED review, `NAV01` harness, `A11Y-01` landmarks, `MAIN_REMOUNT_ON_WINDOW_CLASS_CHANGE=PROHIBITED`, no new persisted key.

**Risks:** density creep onto touch; interaction with `MOBILE-SCROLL-FLICKER-01`; overlap with open NAV-VISUAL slices.

**PR split:** `NNW-02A` density audit (measurement, docs); `NNW-02B` density tokens for fine pointers (no behavior change); `NNW-02C` keyboard and disclosure semantics; `NNW-02D` grouping (after `NAV-02F`).

### NNW-03 — CONTEXTUAL_TOOLBAR

**Goal:** less clutter while keeping every action discoverable and accessible.

**`REFERENCE_PATTERN`** (S4, S5, S6): a compact toolbar whose contents depend on context; previous/next and search at the reader; article commands grouped; on iPhone, floating circular chrome buttons (filter, settings, add) instead of a persistent bar; a filter button in the list header.

**`NEWSFLUX_PRODUCT_DECISION`**

| #   | Decision                                                                                                                                                                                     | Status                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Progressive disclosure, **never silent removal**. Every action in the inventory below stays reachable by a visible control, an overflow menu, a shortcut or a context menu on every surface. | `BINDING` (stated requirement) |
| 2   | Decide **per surface** — desktop, tablet/Fold, mobile, reader, article list — not one universal toolbar.                                                                                     | `PROPOSED`                     |
| 3   | Whether footer and header context zones remain separate or merge is the `CHROME-01` decision and is a prerequisite.                                                                          | `OPEN` — product decision      |
| 4   | Glass only on chrome with a solid fallback and reduced-transparency support; `MOBILE-SCROLL-FLICKER-01` still blocks glass expansion.                                                        | `BINDING`                      |
| 5   | Existing contracts hold: Escape returns focus (`READER-KEY-01`), ≥ 48 px targets, keyboard parity for touch-only actions, Mark-All and Undo semantics.                                       | `BINDING`                      |

**Action inventory (must stay reachable).** Reader: close, previous, next, mark read/unread, star/unstar, fetch original content, open externally, share, save to third-party services, view comments, table of contents, appearance (font family, font size, article width, title alignment, edge-to-edge images). List header: search (with syntax help and active-query state), sort direction, date filter. List footer: status filter, refresh, mark all as read (confirm, Undo), mark older than N days (presets). New or moved actions must be added to this inventory in the same PR.

**Dependencies:** `CHROME-01` decision; `READER-VISUAL-02B` (auto-hide, which must return on upward scroll/focus and never hide critical keyboard controls); `READER-MEDIA-01`; the open `FOOTERPANEL_CLIPPING` finding (needs reproduction).

**Gates:** `NNW03_ACTION_PARITY` (an automated inventory check that every action is reachable on each surface and viewport), the full Mark-All-Read set including `markAllReadJumpToNext`, `BULK` safety contracts, `READER-KEY-01`, `NAV01`, `A11Y_*`, `884×1104`, no footer clipping.

**Risks:** silent feature loss; regressing Undo/Mark-All; touch-target erosion.

**PR split:** `NNW-03A` inventory and decision (documentation; resolves `CHROME-01`); `NNW-03B` desktop; `NNW-03C` tablet/Fold; `NNW-03D` mobile and reader. Each surface is its own PR.

### NNW-04 — READER_SOURCE_HEADER

**Goal:** give the source more identity in the reader without competing with the title, editorial metadata or content.

**`REFERENCE_PATTERN`** (S3, S5): source name and author above a large title; a small source mark at the header's trailing corner; an unobtrusive date line.

**`NEWSFLUX_PRODUCT_DECISION`**

| #   | Decision                                                                                                              | Status                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | Hierarchy is fixed: **1. title, 2. editorial metadata, 3. source mark**. The mark never outranks the title.           | `BINDING` (stated requirement) |
| 2   | Reuse the NNW-01A identity primitive; no reader-specific icon logic.                                                  | `PROPOSED`                     |
| 3   | Preserve the existing feed link, the `h1` title, the `.article-header-column` edge alignment and the reader measure.  | `BINDING`                      |
| 4   | The mark's slot is reserved so loading never shifts the title; it honors `titleAlignment`, RTL and long source names. | `PROPOSED`                     |
| 5   | No glass; opaque backing; OLED-safe.                                                                                  | `BINDING`                      |

**Dependencies:** NNW-01A. **Gates:** reader measure/alignment/wide-image gates, `A11Y-01` landmarks and heading level, `NNW04_HIERARCHY` (computed title prominence above source and metadata), `NNW04_NO_LAYOUT_SHIFT`, `NNW04_ALIGNMENT`, `390×844` and `884×1104` in both themes, both `titleAlignment` values, RTL, long source names. **Risks:** header crowding on narrow screens; mark contrast on both themes. **PR split:** one PR.

### NNW-05 — MULTI_PANE_REFERENCE (research only, via the REA)

**Goal:** understand where multi-pane layouts help and hurt, to inform direction — **not** to change the single-pane contract.

**`REFERENCE_PATTERN`** (S2–S5): sidebar, list and reader visible together on desktop; the same three columns on a landscape iPad.

**`NEWSFLUX_PRODUCT_DECISION`**

| #   | Decision                                                                                                                                                                        | Status                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | Mobile/tablet/Fold stay **single-pane preferred**; `884×1104` is `MEDIUM`.                                                                                                      | `BINDING`                |
| 2   | A permanent three-pane layout and resizable panels as the primary UX were **rejected** in `NEWSFLUX_DESIGN_DIRECTION_V1.md`. Reopening requires **new evidence** gathered here. | `BINDING` until evidence |
| 3   | The only admissible outcome is an evidence-backed recommendation: `NO_CHANGE` or an **optional, desktop-only** progressive enhancement behind explicit PM approval.             | `OPEN`                   |

**Facts from the code (`CODE_VERIFIED`):** `DESKTOP` is ≥ 993 px; the expanded Sider is 240 px; `MEDIUM` is 600–992 px; reader prose is capped by the measure `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)`.

**Preliminary arithmetic (`INFERENCE`, to be validated by the REA).** A 240 px sidebar, a list column of roughly 320–360 px and a reader frame with a 40–58 ch measure plus gutters need on the order of 1,100–1,200 px. Under that sum a three-pane arrangement is not viable at `884×1104` and would squeeze the reader measure between 993 and ~1,200 px. Candidate breakpoints for _progressive disclosure_ of an optional split are therefore ≥ 1,280 px and ≥ 1,440 px, **not** the 993 px desktop threshold.

**Where multi-pane likely improves desktop:** keyboard-driven triage throughput, co-visible context, lower navigation cost on large displays. **Where it likely worsens Fold/tablet:** width contention at 884 px, erosion of the reader measure, touch-target and focus-restoration complexity, conflict with the Medium rail and Sources drawer, smaller media.

**REA research brief**

- Questions: Q1 at which widths does the reader measure fall below the accepted floor with a persistent list; Q2 how NNW and comparable apps degrade across widths; Q3 which interactions (next-unread, mark-read, search) benefit from co-visibility; Q4 what breaks for focus return, `READER-KEY-01` Escape, deep links and back navigation; Q5 impact on Fold/tablet if the same code paths serve both; Q6 cost in state/persistence (must be none); Q7 what falsifies the idea; Q8 what real-device evidence would be required.
- Inputs: the existing `docs/research/` archive, `NEWSFLUX_DESIGN_DIRECTION_V1.md`, `NEWSFLUX_NAV_VISUAL_01.md`, layout code, NNW's public source and help.
- Deliverable: a labeled research document under `docs/research/` with a falsification attempt and a recommendation; **no product change, no screenshots committed**.
- Constraint: findings do not authorize implementation; the PM decides.

**Gates (for any future follow-up, not for the research):** `884×1104` must remain single-pane; no persistent layout state without architecture approval; all prior reader and navigation gates.

## 5. Cross-cutting constraints

- OLED-aware near-black canvas, opaque content, glass only on chrome with a solid fallback and reduced-transparency support.
- Material-style interaction feedback (short state layers, reduced-motion aware).
- Touch targets ≥ 44 px (form) and ≥ 48 px (navigation); density relaxations apply to fine pointers only.
- Accessibility gates apply to every track: keyboard, focus, reduced motion, touch target, contrast, screen-reader naming, 200 % text/zoom.
- Every user-visible string ships in all six locales (`de-DE`, `en-US`, `es-ES`, `fr-FR`, `ja-JP`, `zh-CN`).
- One purpose per PR. Never mix PWA architecture, visual redesign, upstream sync and functional feed behavior.
- Incidental findings are reported and routed to the roadmap, not fixed opportunistically.

## 6. Dependency map

```text
NNW-01A  source identity primitive ─┬─> NNW-04  reader source header
                                    └─> (sidebar/list consumption in 01A)
NNW-01B  fallback/privacy policy     <── decision D7
NNW-02   navigation density          <── NAV-02F decisions, NAV-VISUAL-01 PR2/PR4/PR7
NNW-03   contextual toolbar          <── CHROME-01 decision, READER-VISUAL-02B, READER-MEDIA-01
NNW-05   multi-pane research         ──> evidence only (no PR)
All NNW  after the PWA-00 baseline and PWA-01 so device measurements are not contaminated.
```

## 7. Evidence and validation plan

- Reuse existing harnesses where the surface is shared (list regression, `NAV01`, `READER-KEY-01`, reader measure/alignment, `A11Y-01`).
- Add a track-specific harness per PR (for example identity consistency, action parity, header hierarchy), following the `scripts/tests/*.{html,jsx}` pattern.
- Viewports: `390×844`, `884×1104`, `1280×800`; light and dark/OLED; 200 % text; RTL where the header or sidebar changes.
- Real-device gates for touch and glass work remain as defined in `NEWSFLUX_NAV_VISUAL_01.md`; absence of a physical run is reported as "not run", never as PASS.
