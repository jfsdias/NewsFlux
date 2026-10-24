# NNW-02A — Navigation Density Audit

**Audit date:** 2026-10-23  
**Repository:** `jfsdias/NewsFlux`  
**Audited source base:** `36a78492fec4a673394a7b2b03f4b0a48cde987e`  
**Scope:** read-only navigation measurement and dependency reconciliation; no product implementation.

## Executive result

The current navigation is responsive by window class, but its density is not pointer-conditional. The 390×844 compact surface provides 48 px controls and the mobile Sources drawer provides 44 px rows. At the critical 884×1104 MEDIUM viewport the implementation has no rail: a 28 px header trigger opens a 360 px drawer whose menu rows are 40 px. Desktop uses a 240 px sidebar with 40 px rows for both emulated fine and coarse pointers.

The existing layout supports a **constrained fine-pointer desktop density study**, but the NNW-02 implementation track remains blocked by unresolved NAV-VISUAL-01 PR4/PR7 dependencies and NAV-02F product decisions. Do not apply density changes to compact or medium/touch surfaces. This audit does not authorize implementation.

## Provenance and method

- GitHub `main` was read live from the `refs/heads/main` API and matched the expected base exactly. PR #103 was closed and merged at this base. The live open-PR search returned no open PRs at audit time.
- Static source and documents were inspected from the exact base above.
- UI observations used the authenticated NewsFlux browser session at `https://news.jfsdias.ddns.net/history`. The About revision was not captured; therefore the browser runtime SHA is **unverified**. UI measurements are observations from that live session, not proof that production served the exact audited source SHA.
- Viewport, color-scheme, and pointer/touch emulation were temporary browser overrides. They were reset after measurement. The route was restored to `/history`; no article, read state, feed, category, or Miniflux data was mutated.
- A category disclosure was expanded and collapsed through the UI, returning it to its original collapsed state. No new preference or storage key was added.
- No screenshots are committed. Measurements below are approximate where stated and depend on the live content snapshot.

### Viewport and capability coverage

| Viewport | Window class | Observed modes                          | Navigation surface                                        | Horizontal overflow |
| -------- | ------------ | --------------------------------------- | --------------------------------------------------------- | ------------------- |
| 390×844  | COMPACT      | dark/fine and light/coarse samples      | 56 px compact bar; Sources drawer 312 px wide             | none observed       |
| 884×1104 | MEDIUM       | dark/fine and light/coarse samples      | 28 px header trigger; Sources drawer 360 px wide; no rail | none observed       |
| 1440×900 | DESKTOP      | light and dark; fine and coarse samples | 240 px permanent sidebar                                  | none observed       |

The full 12-way cross product of viewport × theme × pointer was not run. Coarse pointer behavior was emulated, not exercised on physical touch hardware.

## Measured baseline

### Row and control geometry

| Surface                              |                     Destination row | Category row | Feed row |                                                    Smallest observed target |
| ------------------------------------ | ----------------------------------: | -----------: | -------: | --------------------------------------------------------------------------: |
| Compact bottom navigation at 390×844 | 48 px high; about 71.6 px wide each |          n/a |      n/a |                                                                    48×48 px |
| Drawer at 390×844                    |                               44 px |        44 px |    44 px |                                                                    44×44 px |
| Drawer at 884×1104                   |                               40 px |     40–41 px |    40 px | 28×28 px header/action controls; 40×40 px menu rows; close control 44×44 px |
| Desktop sidebar at 1440×900          |                               40 px |        40 px |    40 px |                                                          40×40 px menu rows |

At 1440×900, the sidebar remains 240 px wide for both fine and emulated coarse pointer. Coarse pointer emulation did not increase the menu row sizes. The 390 drawer measured 312×840 px; the 884 drawer measured 360×1104 px. Desktop sidebar height was the full 900 px viewport.

At 390×844, the open drawer initially showed about nine complete category rows and part of the next row, with 13 categories available in the list. Long category names truncate with ellipsis while counts remain at the trailing edge.

### DG-1 baseline at 390×844

```text
DG1_BASELINE_VISIBLE_NAV_HEIGHT=56px
DG1_BASELINE_VISIBLE_ROWS=4 complete article cards + 1 partial card
LIST_SCROLLPORT_HEIGHT=666px
```

**Method:** use the same 390×844 viewport, route, data/filter/content state, and closed drawer; measure the height of `.adaptive-scroll-area-native.entry-list`; count only article cards fully contained in that scrollport, recording a partially visible next card separately. Record the compact navigation height independently. The observed ratio is a frozen baseline only; this audit makes no post-change comparison. The count is snapshot-sensitive because live article content and loading can change.

### Width, indentation, and truncation

- Expanded desktop sidebar: 240 px. Collapsed desktop sidebar: 0 px (`App.jsx` selects 0 when `desktopSidebarCollapsedState` is true).
- Sources drawer width: `min(80vw, 360px)`; measured 312 px at 390 and 360 px at 884.
- Category level 1 uses 42 px left padding with a -32 px left margin in the current expanded-sidebar CSS. There is no second category nesting level in this surface, so level 2 is not applicable.
- Feed/category labels use ellipsis under constrained width. Feed tooltip is desktop-only; it is not available in compact/medium touch drawers.
- Count alignment is trailing/right aligned, but not a fixed count column. Expanded Sidebar count width follows its digits; long values therefore consume variable space. Counts use proportional, not tabular, numerals.

## Current architecture and existing state

- **Desktop:** permanent 240 px Sidebar; category groups and feeds, source filter, Unread/All source-mode radios, unread counts, feed-health indicator, profile and actions.
- **Compact:** five bottom destinations—Home, All, Today, Starred and Feeds/Sources. Feeds opens the existing Sidebar Drawer. The bar is 56 px high, its destination controls are 48 px high, and it is hidden while Reader content is active.
- **Medium:** the current code does not render a rail. At 884×1104 the header trigger opens the existing Sidebar Drawer. The single-pane content remains full width.
- **Drawer:** the existing Sidebar content is reused inside a focus-locked Drawer. Route selection closes it and hands focus to the destination; Escape closes it and restores focus to the opener.
- **Categories:** a collapsible/disclosure header contains a nested category navigation button and feed menu items. The DOM/ARIA is a hybrid of `menu`, disclosure, and nested button semantics, not a tree pattern.
- **Selection:** compact destinations expose `aria-current="page"` for represented routes. Feed rows set `aria-current` when selected. Sidebar destinations and category selection did not expose `aria-current`/`aria-selected` in the inspected DOM; selection was conveyed mainly by fill/text color. Overall non-color selection parity is partial.
- **Feed health:** the Sidebar renders the provider-backed compact error indicator and popover path with health detail and Retry; this audit did not invoke Retry.

Existing state and preference use:

| State / preference             | Current use                                                                                                                        | Persistence                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `compactSidebarGroups`         | Caps the feed group at 400 px when enabled; default is true.                                                                       | Existing settings state                  |
| `expandedCategoriesState`      | Stores expanded category keys; search may expand matching categories without writing while a query is active.                      | Persistent key `expandedCategories`      |
| `desktopSidebarCollapsedState` | Collapses desktop Sidebar width to 0; default false.                                                                               | Persistent key `desktopSidebarCollapsed` |
| `showUnreadFeedsOnly`          | Filters source navigation to unread feeds; a current source reaching zero can be retained until route change.                      | Existing settings state                  |
| `showFeedIcon`                 | Controls the 16 px FeedSourceMark in Sidebar rows; default true.                                                                   | Existing settings state                  |
| `showZeroCount`                | Per-row prop used for the selected current feed when it must remain visible with zero unread; not a separate persisted preference. | None of its own                          |
| Source filter query            | Filters source navigation and can temporarily reveal matching categories.                                                          | Component-local/transient                |

No persisted keys, settings schema, or local-storage contract changed.

## Pointer policy, touch safety, and accessibility

### Pointer-conditional density

`CURRENT_POINTER_CONDITIONAL_DENSITY=PARTIAL` for interaction styling and **NO** for row density. Window-class breakpoints control navigation rendering. A small hover rule uses `(hover: hover) and (pointer: fine)`, but no row-height density rule is gated by pointer. The 40 px desktop rows remain 40 px under coarse-pointer emulation. The 44 px Drawer sizing is tied to a max-width viewport breakpoint, not to pointer capability.

This means a touchscreen laptop in the desktop width class still receives 40 px Sidebar rows. That is a touch-target risk for such devices; do not tighten them further in a fine-pointer-only follow-up unless the CSS guard explicitly excludes coarse pointers.

### Keyboard observations

Observed on the 884×1104 Drawer with the All destination focused:

- Tab moved through the Drawer focus order; Shift+Tab moved from All to Close, and Tab returned to All.
- ArrowUp, ArrowDown, ArrowLeft, and ArrowRight did not move focus from the focused All menu item.
- Enter activated All, navigated to `/all`, and closed the Drawer.
- Space did not activate the focused All menu item.
- Escape closed the Drawer and returned focus to the header opener.
- Category disclosure interaction used Enter to toggle in the observed interaction; Space did not toggle the parent disclosure. The nested category title is separately focusable and Enter/Space navigation is implemented for that button.

The control tree is not a complete arrow-key menu/tree interaction model. Keyboard/disclosure semantics remain an NNW-02C concern and are not fixed by density tokens.

### Touch targets, zoom, contrast, and landmarks

- **Touch target:** 48 px compact destinations; 44 px mobile drawer rows; 40 px medium/desktop menu rows; 28 px medium header/action controls. The medium touch surface does not consistently meet the existing 44/48 px contracts.
- **200% zoom/text scaling:** not run. The embedded browser did not expose a reliable zoom control; attempts to use its shortcut left the reported viewport and visual scale unchanged. Normal-scale viewports had no horizontal overflow. Zoom behavior remains unverified.
- **Contrast:** selected blue text on selected fill measured approximately 4.15:1 in light theme and 3.42:1 in dark theme in the desktop Sidebar, below 4.5:1 for normal text. Unselected labels measured approximately 6.40:1 (light) and 10.23:1 (dark). These are browser-computed RGB measurements from the current theme and are observational, not a formal WCAG audit.
- **Landmarks:** at 390 with the Drawer open, the accessibility tree exposed both the compact `Navigation menu` and Drawer `NewsFlux` nav; the 884 Drawer exposed the Sidebar nav over the page. On `/history`, no compact bottom destination corresponds to the route, so none of its five compact buttons was marked current.
- **Selected state:** current indicators are not uniform. Feed links have `aria-current`; compact destinations use `aria-current` where represented, while Sidebar destinations/categories largely rely on color/fill. `SELECTION_NON_COLOR_CUE=PARTIAL`.

## Counts and category behavior

- Zero unread counts are normally hidden. A selected current feed may display zero via `showZeroCount` to remain present in the current source context. Compact badges are absent at zero and cap large totals at `999+`.
- Sidebar category and destination counts are trailing/right aligned, but their column is content-sized rather than fixed; large values have no reserved tabular column. At 1440, a five-digit count occupied about 40 px in the observed font.
- Count alignment is usable at current widths but variable digit width and count length consume layout space; counts can therefore limit additional density. No count semantics were changed.
- `expandedCategoriesState` persists expansion. Filter-driven expansion is transient while the filter is active. Only one category nesting level was present.

## Live dependency reconciliation

| Dependency / slice                     | Live state and evidence                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NAV-VISUAL PR0 / PR #69                | Merged. Establishes COMPACT/MEDIUM/DESKTOP window classes; code identifies 884×1104 as MEDIUM.                                                                                                                                                    |
| NAV-VISUAL PR1 / PR #71                | Merged. Implements compact bottom navigation and the Sources opener; its merged baseline uses glass/backdrop-filter despite the historical solid-V1 contract (`NAV_CONTRACT_DRIFT_01`).                                                           |
| Drawer route focus / PR #74            | Merged. Drawer selection closes and focuses the destination; dismissal restores the opener.                                                                                                                                                       |
| NAV-VISUAL PR2 Sources panel           | Existing Sources entry and shared Sidebar Drawer are implemented by PR #71. A separately closed/approved PR2 panel architecture was not found; formal slice status remains unconfirmed.                                                           |
| NAV-VISUAL PR4 Medium Rail             | Not implemented in current UI. The critical 884×1104 surface is a header trigger plus Drawer, not the approved 80 px rail. This is an active navigation dependency.                                                                               |
| NAV-VISUAL PR7 Sidebar model alignment | Not established. Compact uses five direct destination buttons; Sidebar uses an Arco menu with grouped sources. The models remain distinct in current code.                                                                                        |
| NAV-02F                                | Still open in `docs/DESIGN_REFERENCES.md`: grouping model, optional Unread grouping, Sidebar width, and count presentation. These decisions block NNW-02D grouping; together with PR4/PR7 they block unbounded navigation-density implementation. |

The GitHub live search found no open PRs at the time of the audit. PR #69, #71, #74 and #17 are closed/merged; PR #86 is also closed/merged. No active overlapping navigation PR was visible in that search.

## Existing risk surfaces

| Finding                     | Classification for NNW-02A / NNW-02B                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOBILE-SCROLL-FLICKER-01`  | `NON_BLOCKING` for an isolated fine-pointer desktop density-token study; remains open and blocks future glass expansion. This audit did not reproduce flicker. |
| `REACT19_ARCO_ELEMENT_REF`  | `NON_BLOCKING` existing low-priority finding; not specifically observed/reproduced during this audit.                                                          |
| `RESIZEOBSERVER`            | `NON_BLOCKING` / needs reproduction; not tested as a dedicated resize-loop gate here.                                                                          |
| `NAV_HARNESS_DESKTOP_MODEL` | `NON_BLOCKING` low-priority existing finding; this audit used the authenticated app directly and did not run the separate navigation harness.                  |

## Recommendation and gates for a future NNW-02B

**Recommendation: `NNW02_BLOCKED_BY_NAV_DEPENDENCIES`.** The 884×1104 MEDIUM implementation materially diverges from the approved rail contract, its touch controls are below the approved minimums, and PR4/PR7 plus NAV-02F remain unresolved. First decide and close those navigation contracts.

If PM later authorizes a strictly isolated fine-pointer density experiment, keep it to desktop `min-width: 993px` **and** fine-pointer/hover-capable CSS. Preserve the 240 px default sidebar geometry, do not affect compact/medium or coarse-pointer devices (including touchscreen laptops), add no behavior or persistence, preserve the 390 DG-1 method, and require DG-1 ratio ≥0.90 plus keyboard, zoom, contrast, and physical-device checks. Do not expand glass or move controls to improve the ratio.

```text
NEW_PERSISTED_KEYS=0
SETTINGS_SCHEMA_CHANGED=NO
LOCAL_STORAGE_CONTRACT_CHANGED=NO
MINIFLUX_WRITES=0
PRODUCT_CODE_CHANGED=NO
MERGE=NO
DEPLOY=NO
```
