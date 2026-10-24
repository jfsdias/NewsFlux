# NAV-02F Decision Package & Determined Slice Record

## 0. Executive Summary

- **Track ID:** `NAV_02F`
- **Base Commit:** `fac87b621a63393da6987cf89f6b85c12cede994`
- **Branch:** `argon/nav-02f`
- **Status by Sub-Item:**
  1. `UNREAD_CATEGORY_GROUPING`: **`HOLD_PRODUCT_DECISION`** — Changing Unread mode from a flat feed projection to category-grouped disclosures alters primary source-tree scan hierarchy and disclosure state rules across phone drawer and desktop sidebar.
  2. `DESKTOP_SIDEBAR_WIDTH`: **`HOLD_PRODUCT_DECISION`** — Changing the frozen `240px` desktop sidebar width directly alters narrow-desktop (`993px–1200px`) article list/reader horizontal budgets and multi-pane (`NNW-05`) breakpoint math.
  3. `SHOW_UNREAD_FEEDS_ONLY`: **`ALREADY_DETERMINED` (Existing Persistence Contract) / `HOLD_PRODUCT_DECISION` (Default Flip)** — Already persisted in `settingsState` (`localStorage["settings"].showUnreadFeedsOnly`, default `false`). Creating a duplicate key in `sidebarState` is prohibited; flipping the default from `false` (`All`) to `true` (`Unread`) is held for PM decision.
  4. `UNREAD_COUNT_BADGE`: **`IMPLEMENTED` (Tabular Numerals + Accessible Screen-Reader Labels) / `HOLD_PRODUCT_DECISION` (Visual `999+` Cap in Sidebar)** — Shipped `font-variant-numeric: tabular-nums` across sidebar and header count badges plus localized human-readable `aria-label` announcements (`sidebar.unread_count_aria`, `sidebar.items_count_aria`) rehomed from `LIST-VISUAL-01` to `NAV-02F` (`docs/NEWSFLUX_ROADMAP.md` §3.5), while holding visual `999+` truncation in `Sidebar` for PM sign-off.

---

## 1. `UNREAD_CATEGORY_GROUPING`

- **CURRENT_BEHAVIOR:**
  - When `showUnreadFeedsOnly === false` (`All` mode), `Sidebar.jsx` renders `<CategoryGroup />`, which iterates `getMatchingCategories(categories, feedsGroupedById, sourceQuery)` and renders collapsible category headers (`<CategoryTitle />` + disclosure button) containing virtualized `<FeedMenuGroup />` lists.
  - When `showUnreadFeedsOnly === true` (`Unread` mode), `Sidebar.jsx` renders `<UnreadFeedsGroup />`, which calls `getUnreadNavigationFeeds(feeds, sourceQuery, currentZeroUnreadSource)` (`src/utils/source-navigation.js`) and renders a single flat `<Virtualizer>` list of feeds with `unreadCount > 0` (plus the active zero-unread feed pinned at its original sorted index so the user does not lose context immediately after reading the last item).
- **PROVIDER_SEMANTICS:**
  - Miniflux remains the sole source of truth for `categories`, `feeds`, and per-feed `unreadCount` (`counters.unreads`). Grouping unread feeds by category is a pure client-side projection over `visibleCategoriesState` and `feedsGroupedByIdState` and requires zero Miniflux API changes.
- **PERSISTENCE_IMPACT:**
  - **Option A (Flat Unread List — Current):** Zero new persistence.
  - **Option B (Category-Grouped Unread Tree):** Uses existing `expandedCategoriesState` (`localStorage["sidebar_expanded_categories"]`) or requires deciding whether `Unread` mode shares expansion state with `All` mode or auto-expands all categories with `unreadCount > 0`.
  - **Option C (User Toggle / Sub-mode):** Would require a new `settingsState` schema key (prohibited without explicit architecture approval).
- **A11Y_IMPACT:**
  - Flat `Unread` mode has $O(F_{\text{unread}})$ Tab stops (1 link per unread feed, plus optional health trigger).
  - Category-grouped `Unread` mode adds 2 Tab stops per non-empty category (disclosure `<button>` + `<CategoryTitle>` link) before reaching child feeds, increasing keyboard traversal steps when scanning a handful of unread feeds across many categories, though it allows collapsing noisy categories.
- **PHONE_IMPACT:**
  - In `COMPACT` (`<=600px`), sources live inside `#mobile-sidebar-drawer`. A flat unread list maximizes vertical feed density on small screens (`360px–430px` width) without consuming `40px` rows on category headers that may only contain 1 unread feed.
- **884X1104_IMPACT:**
  - In `MEDIUM` (`601px–992px`, including `884×1104`), sources also open in `#mobile-sidebar-drawer` (`240px` drawer) invoked from the `MediumNavigation` rail (`SOURCES`). Flat vs grouped affects vertical scrolling inside the overlay drawer.
- **DESKTOP_IMPACT:**
  - In `DESKTOP` (`>=993px`), the persistent `240px` sidebar displays the source list continuously. Users with large OPML trees (50+ feeds across 10+ categories) benefit from category-level "Mark all as read" and category filtering in `Unread` mode, whereas users with few unread feeds prefer flat one-click access.
- **UPSTREAM_CONFLICT:**
  - Upstream ReactFlux only had a flat feed list under categories in a single mode (`showUnreadFeedsOnly` filtered feeds inside categories in older upstream revisions, whereas NewsFlux `NNW-02B` intentionally introduced the explicit `Unread | All` segmented radio control with `<UnreadFeedsGroup />` for fast unread scanning). Touching `Sidebar.jsx` around `UnreadFeedsGroup` has moderate divergence from upstream `Sidebar.jsx`.
- **OPTIONS:**
  1. **Option 1A — Keep Flat Unread Feed List (`UnreadFeedsGroup`) as Canonical Unread Mode:** `Unread` mode remains a flat, zero-hierarchy queue of feeds with unread items (preserving active zero-unread source pinning), while `All` mode provides the full category hierarchy.
  2. **Option 1B — Category-Grouped Unread Mode (Hide 0-Unread Categories & 0-Unread Child Feeds):** Filter `CategoryGroup` in `Unread` mode so only categories with `unreadCount > 0` (or containing the active zero-unread source) render, and only child feeds with `unreadCount > 0` (or active zero-unread source) appear under each expanded category.
  3. **Option 1C — Category-Grouped Unread Mode with Auto-Expand:** Same as Option 1B, but automatically expand all categories with `unreadCount > 0` while in `Unread` mode without mutating `expandedCategoriesState` in `localStorage`.
- **RECOMMENDATION:**
  - **Recommend Option 1C (or retaining Option 1A if `Unread` is meant as a fast flat queue).** Between grouped designs, **Option 1C** is strictly superior to 1B because it preserves category context and category-level context menus ("Mark category as read") without forcing users to manually expand categories to find why a category badge is non-zero, and without polluting `localStorage["sidebar_expanded_categories"]`. Held as `HOLD_PRODUCT_DECISION` pending PM selection between flat queue (1A) vs auto-expanded category tree (1C).

---

## 2. `DESKTOP_SIDEBAR_WIDTH`

- **CURRENT_BEHAVIOR:**
  - Frozen at `240px` in `src/components/Sidebar/Sidebar.css` (`.sidebar-container { width: 240px; min-width: 240px; }`) and `src/App.css` (`grid-template-columns: 240px 1fr` on desktop `>=993px`).
  - Feed and category titles use `width: unreadCount ? "80%" : "100%"` with single-line ellipsis (`Typography.Ellipsis`) and desktop hover tooltips (`showTooltip={!isBelowMedium}`).
- **PROVIDER_SEMANTICS:**
  - Pure client layout geometry; no Miniflux provider impact.
- **PERSISTENCE_IMPACT:**
  - Fixed width (`240px` or `260px`) requires zero persistence.
  - User-resizable sidebar width would require a new persistent layout key in `localStorage`, which is prohibited without explicit architecture approval.
- **A11Y_IMPACT:**
  - Wider fixed width (`260px` or `272px`) reduces visual title truncation at `100%`–`125%` browser zoom, reducing reliance on hover tooltips (which are not accessible to touch or keyboard-only users, though full titles are exposed in link text / `aria-label`).
- **PHONE_IMPACT:**
  - None on persistent layout (`COMPACT` uses `#mobile-sidebar-drawer`, which is `240px` wide).
- **884X1104_IMPACT:**
  - None on primary layout (`884×1104` is in `MEDIUM` `601px–992px`, which uses the `64px` `MediumNavigation` rail + overlay drawer).
- **DESKTOP_IMPACT:**
  - Directly impacts `DESKTOP` (`>=993px`):
    - At `993px` viewport width, a `240px` sidebar leaves `753px` for `.main-container`. Increasing sidebar width to `264px` or `280px` shrinks `.main-container` to `729px` or `713px`.
    - In `docs/NNW05_MULTIPANE_REFERENCE_STUDY.md` (merged in PR #110), all 3-pane desktop breakpoint calculations (`1440px` aggressive candidate and `1600px` conservative candidate) explicitly use `240px` as the desktop sidebar constant (`240px Sidebar + 360px List + 840px Reader Frame = 1440px`). Widening the sidebar by `+20px`–`+40px` directly shifts every 3-pane minimum viewport threshold upward by the same delta.
- **UPSTREAM_CONFLICT:**
  - Low (`App.css` and `Sidebar.css` are already customized for NewsFlux shell tokens).
- **OPTIONS:**
  1. **Option 2A — Retain `240px` Fixed Desktop Sidebar Width:** Preserves exact alignment with `NEWSFLUX_NAV_VISUAL_01.md` and `NNW05_MULTIPANE_REFERENCE_STUDY.md` (`1440px`/`1600px` 3-pane math).
  2. **Option 2B — Responsive Clamp `clamp(240px, 18vw, 272px)` Above `1280px` Only:** Keeps `240px` at `993px–1279px` (protecting narrow desktop), widens up to `272px` on wide single-pane desktop, and locks back to `240px` when 3-pane mode is active.
  3. **Option 2C — Fixed `260px` Desktop Sidebar Width:** Adds `20px` for feed/category titles across all desktop viewports (`>=993px`), shifting 3-pane thresholds by `+20px`.
- **RECOMMENDATION:**
  - **Recommend Option 2A (Retain `240px` Fixed Width).** `240px` is a foundational constant in both `NEWSFLUX_NAV_VISUAL_01.md` and the newly merged `NNW05_MULTIPANE_REFERENCE_STUDY.md`. Held as `HOLD_PRODUCT_DECISION` if PM wishes to evaluate Option 2B/2C.

---

## 3. `SHOW_UNREAD_FEEDS_ONLY`

- **CURRENT_BEHAVIOR:**
  - **Already persisted in `settingsState` (`localStorage["settings"]`):**
    - Defined in `src/utils/settings-schema.js`: `showUnreadFeedsOnly: booleanSetting(false)`.
    - Consumed in `src/components/Sidebar/Sidebar.jsx`: `const { showUnreadFeedsOnly } = useStore(settingsState, { keys: ["showUnreadFeedsOnly"] })`.
    - Updated by the sidebar `Unread | All` segmented radio control via `updateSettings({ showUnreadFeedsOnly: true / false })` and by the Settings modal toggle.
- **PROVIDER_SEMANTICS:**
  - Client-side UI preference only; Miniflux feed/category payloads are unaffected.
- **PERSISTENCE_IMPACT:**
  - **Zero new persistence required.** The setting is already persisted in `localStorage["settings"].showUnreadFeedsOnly` and validated through `sanitizeSettings()` in `src/utils/settings-schema.js`. Moving it to `sidebarState` would break existing user settings in `localStorage["settings"]` and violate Governance Rule #11.
- **A11Y_IMPACT:**
  - Controlled by the native `<fieldset role="radiogroup">` (`data-testid="mode-unread"` / `data-testid="mode-all"`) in `SourceNavigationControls` with roving `tabIndex`.
- **PHONE_IMPACT:**
  - Persists across sessions in `#mobile-sidebar-drawer` so phone users do not have to re-toggle `Unread` mode on every launch.
- **884X1104_IMPACT:**
  - Same persistence inside `#mobile-sidebar-drawer` on `884×1104`.
- **DESKTOP_IMPACT:**
  - Persists the sidebar `Unread | All` mode across reloads.
- **UPSTREAM_CONFLICT:**
  - Upstream ReactFlux already uses `settingsState.showUnreadFeedsOnly` (`default: false`).
- **OPTIONS:**
  1. **Option 3A — Keep Existing `settingsState.showUnreadFeedsOnly` (`default: false`):** Zero migration, 100% backward-compatible with upstream and existing NewsFlux profiles.
  2. **Option 3B — Flip Default to `true` (`Unread` mode by default for fresh profiles):** Fresh installs start in `Unread` mode; existing profiles with `localStorage["settings"]` keep their stored boolean.
- **RECOMMENDATION:**
  - **Recommend Option 3A (Keep Existing `settingsState` Persistence & `false` Default).** Persistence is already complete and verified; flipping the default for new profiles (`false` -> `true`) is a pure product choice (`HOLD_PRODUCT_DECISION`).

---

## 4. `UNREAD_COUNT_BADGE`

- **CURRENT_BEHAVIOR (Before `argon/nav-02f`):**
  - **Visual formatting:**
    - `CompactNavigation.jsx` and `MediumNavigation.jsx` cap badges at `999+` via `formatNavBadge(count)` and apply `font-variant-numeric: tabular-nums`.
    - `Sidebar.jsx` displays uncapped integers (`{unreadCount}` / `{feed.unreadCount}`) in `.unread-count` and `.item-count` **without** `font-variant-numeric: tabular-nums`, and `SearchAndSortBar.css` `.count-label` / `.article-selection-count` also lacked `tabular-nums`.
  - **Screen-reader accessibility (`LIST-VISUAL-01` -> `NAV-02F` rehomed item in `docs/NEWSFLUX_ROADMAP.md` §3.5):**
    - In `Sidebar.jsx`, `<Link>` elements for All, Today, Starred, History, Categories, and Feeds contained both the text title and `<Typography.Ellipsis className="item-count">{count}</Typography.Ellipsis>` as raw child text. Screen readers concatenated them without units or separator (e.g. announcing `"All 42"` or `"Ars Technica 12"` as a raw number instead of `"All, 42 unread"`).
    - In `CompactNavigation.jsx` and `MediumNavigation.jsx`, `accessibleName` used `${label} (${badge})`, announcing `"All (999+)"` without distinguishing unread count (`All`, `Today`) from total starred items (`Starred`) or announcing the exact count.
- **PROVIDER_SEMANTICS:**
  - Uses existing `unreadTotalState`, `unreadTodayCount`, `starredCount`, `historyCount`, category `unreadCount`, and `feed.unreadCount` derived from Miniflux counters.
- **PERSISTENCE_IMPACT:**
  - Zero persistent state changes.
- **A11Y_IMPACT:**
  - **Implemented in `argon/nav-02f`:**
    - Added `formatNavigationCountLabel(label, count, { countType, polyglot, showZero })` in `src/utils/source-navigation.js`.
    - Added localized keys `sidebar.unread_count_aria` (`"%{label}, %{smart_count} unread"`) and `sidebar.items_count_aria` (`"%{label}, %{smart_count} item |||| %{label}, %{smart_count} items"`) across all 6 locales (`en-US`, `es-ES`, `fr-FR`, `de-DE`, `ja-JP`, `zh-CN`).
    - Applied `aria-label={formatNavigationCountLabel(...)}` to `Sidebar` (`CustomMenuItem`, `CategoryTitle`, `FeedMenuItem`), `CompactNavigation`, and `MediumNavigation`, and marked visual count badges `aria-hidden="true"` so screen readers announce human-readable count semantics once without duplicate raw-number readouts.
- **PHONE_IMPACT:**
  - `CompactNavigation` keeps `999+` visual cap so 4-digit counts never overflow `48×48px` bottom navigation targets, while VoiceOver/TalkBack announces the exact localized unread/starred count.
- **884X1104_IMPACT:**
  - `MediumNavigation` (`64px` rail on `884×1104`) keeps `999+` visual cap on rail badges while announcing the exact localized count via `aria-label`.
- **DESKTOP_IMPACT:**
  - `.unread-count` and `.item-count` in `Sidebar.css` and `.count-label` / `.article-selection-count` in `SearchAndSortBar.css` now enforce `font-variant-numeric: tabular-nums`, preventing horizontal jitter as unread counts decrement during reading or mark-as-read operations.
- **UPSTREAM_CONFLICT:**
  - Low and localized to `Sidebar.jsx`, `Sidebar.css`, `CompactNavigation.jsx`, `MediumNavigation.jsx`, `source-navigation.js`, and locale JSON files.
- **OPTIONS (For Visual Capping in `Sidebar`):**
  1. **Option 4A — Exact Uncapped Integer in Sidebar + `999+` Cap on Compact/Medium Rail Badges (Implemented Baseline):** Sidebar rows have enough horizontal room for 4-digit tabular numerals (`1240`), whereas icon-overlay badges on `CompactNavigation` and `MediumNavigation` cap at `999+`.
  2. **Option 4B — Cap Sidebar Feed/Category/Stream Counts at `999+`:** Uniform `999+` visual cap across all navigation surfaces.
  3. **Option 4C — Cap Sidebar Counts at `9,999+` with Locale Grouping:** Formats `1240` as `1,240` and caps at `9,999+`.
- **RECOMMENDATION:**
  - **Recommend Option 4A (Implemented Baseline).** Desktop/drawer sidebar rows easily accommodate exact 4-digit counts with `tabular-nums`, and power users rely on exact unread totals in the sidebar during bulk triage, while compact icon badges require `999+` to fit inside `16px` pill overlays. Visual capping in `Sidebar` beyond Option 4A remains held if PM prefers Option 4B/4C.
