# NNW-05: Wide-Desktop Multi-Pane Reference Study & Architecture Analysis

- **Track:** `NNW-05_MULTI_PANE_REFERENCE_STUDY`
- **Role:** UX / Architecture Researcher, Current-State Auditor, Reference Analyst, Design-Gate Author
- **Status:** Complete Research & Architectural Gate Document — **Docs/Research Only (No Code Implementation)**
- **Baseline Main SHA:** `4cb99e196f88b01602a7fa53575430dd74ec5f94`
- **Companion Documents:**
  - [`docs/DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (NetNewsWire reference track & visual identity)
  - [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md) (Visual foundation and design philosophy)
  - [`docs/NEWSFLUX_NAV_VISUAL_01.md`](./NEWSFLUX_NAV_VISUAL_01.md) (Navigation contract & window classes)
  - [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md) (Reader layout & typography contract)
  - [`docs/PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) (Progressive web app architecture & runtime contracts)

---

## 1. Executive Summary & Core Conclusion

### Core Question

Should NewsFlux eventually adopt a multi-pane layout (co-visible Article List and Reader) on sufficiently wide desktop displays, and if so, what are the safest architectural boundaries, viewport thresholds, interaction contracts, and product gates?

### Architectural Finding

NewsFlux is engineered around a **single-pane-first, distraction-free editorial philosophy**:

- On mobile (`COMPACT`, `<600px`), navigation, article list, and reader are strictly serialized.
- On tablet / Fold (`MEDIUM`, `600px–992px`, notably the critical `884×1104` viewport), NewsFlux presents an 80px responsive Medium Navigation Rail alongside a single content pane (Article List OR Reader in full view).
- On standard desktop (`DESKTOP`, `≥993px`), NewsFlux provides a 240px static collapsible Sidebar and a single content pane. Opening an article transitions the central area from the virtualized article list to the full-width reader (`ArticleDetail`), keeping the list mounted but inert in the background.

A permanent three-pane layout (Sidebar | Article List | Reader) was previously **rejected** in [`NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md) because forcing three panes at intermediate desktop widths (993px–1366px) compresses the reader prose measure below the acceptable ergonomic floor (40ch–58ch minimum; 75ch default) and crowds the article list into severe text truncation.

### Recommendation: HOLD_PRODUCT_DECISION (Default to Option A; Option D as Future Candidate)

1. **Immediate Contract (Unchanged):** Preserve **Option A (Single-Content-Pane Desktop)** as the default NewsFlux architecture. At standard desktop widths (993px to 1440px), NewsFlux must remain a single-content pane (Sidebar + Article List OR Sidebar + Reader).
2. **Critical Protection:** The `884×1104` viewport, mobile phones (`390×844`), and standard tablets (`1024×768`) **MUST NOT** be modified to multi-pane under any circumstances (`REQUIRED_SINGLE_PANE` / `PREFERRED_SINGLE_PANE`).
3. **Future Wide-Desktop Candidate (Post-1.0 Only):** If multi-pane is ever authorized by product management, it **MUST NOT** be an automatic responsive switch at 993px or 1280px. It must be implemented as **Option D (User-Opt-In Multi-Pane)** or **Option C (Adaptive Preview Pane)** with a strict activation floor of **≥1600px** (Conservative Threshold) or **≥1440px** (Aggressive Threshold), ensuring that:
   - Sidebar = 240px
   - Article List = ≥380px–420px (preventing card truncation)
   - Reader = ≥820px–940px (preserving the full 75ch measure + gutters)
4. **Product Decision Status:** Any change from the current single-pane contract is classified as **`HOLD_PRODUCT_DECISION`**, pending explicit PM sign-off and validation against the strict implementation gates authored below.

---

## 2. Current NewsFlux Layout Architecture (`CODE_VERIFIED`)

### 2.1 Window Classes & Grid Layout

NewsFlux categorizes screen geometry via [`src/utils/window-class.js`](../src/utils/window-class.js) and [`src/hooks/useWindowClass.js`](../src/hooks/useWindowClass.js):

- **`COMPACT`**: `width < 600px` AND `height >= 480px`.
- **`MEDIUM`**: `(600px <= width < 993px)` OR `(width < 600px AND height < 480px)`. `884×1104` is explicitly classified as `MEDIUM`.
- **`DESKTOP`**: `width >= 993px`.

In [`src/App.css`](../src/App.css), the top-level `.app` shell is a CSS Grid:

```css
.app {
  display: grid;
  grid-template-columns:
    var(--desktop-sidebar-width)
    var(--medium-navigation-width, 0px)
    minmax(0, 1fr);
  grid-template-areas: "sidebar navigation main";
  background-color: var(--app-shell-background);
  height: 100%;
}
```

- On `DESKTOP` (`≥993px`), `--desktop-sidebar-width` is `240px` (or `0px` if collapsed via `desktopSidebarCollapsedState`). `--medium-navigation-width` is `0px`.
- On `MEDIUM` (`600px–992px`), `--desktop-sidebar-width` is `0px`. When browsing lists (`!activeContent`), `--medium-navigation-width` is `80px`. When the reader is active (`activeContent` is present), `--medium-navigation-width` is `0px`, yielding 100% of the screen to the reader.
- On `COMPACT` (`<600px`), both sidebar and medium rail widths are `0px`. A bottom `CompactNavigation` bar (≥48px targets) is rendered.

### 2.2 Content Mount & Layering Lifecycle

Inside `<main className="main" id="main-content">` ([`src/components/Main/Main.jsx`](../src/components/Main/Main.jsx)), the active route renders [`src/components/Content/Content.jsx`](../src/components/Content/Content.jsx):

```jsx
const isDetailLayerActive = Boolean(activeContent)
const isEntryColFullWidth = isFullWidthLayout || !isDetailLayerActive

<div
  aria-hidden={isDetailLayerActive || undefined}
  className={classNames("entry-col", { "entry-col-full-width": isEntryColFullWidth })}
  inert={isDetailLayerActive || undefined}
>
  ... ArticleList ...
</div>

{activeContent ? (
  <div className="article-container article-container-full-size content-wrapper" {...handlers}>
    <ReaderSidebarTrigger />
    <ArticleDetail ref={entryDetailRef} />
  </div>
) : null}
```

**Key Architectural Characteristics:**

1. **Persistent List Mounting:** The article list (`.entry-col`) is **not unmounted** when an article opens. Instead, it is marked `inert` and `aria-hidden="true"`. This guarantees that its internal virtualizer scroll position ([`src/components/Article/ArticleList.jsx`](../src/components/Article/ArticleList.jsx)) is preserved in memory and DOM without requiring scroll-state serialization.
2. **Absolute Overlay Framing:** `.article-container-full-size` has `position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3`. It covers the full area of `.main`, replacing the article list visually.
3. **Focus Routing & Restoration:**
   - Opening an article routes focus via `scheduleAfterNextPaint` to `articleContent.focus()` and resets reader scroll to `0`.
   - Closing an article (`closeActiveContent` in `ContentContext.jsx` or Escape in `useContentHotkeys.js`) sets `activeContent = null`, removes `inert` from `.entry-col`, and invokes `restoreEntryListFocus(activeEntryId)`, which locates the `[data-entry-id]` element and focuses it with `{ preventScroll: true }`.
4. **URL & Route Synchronization:**
   - Article list: `/{path}` (e.g. `/all`, `/today`, `/feed/:id`).
   - Reader: `/{path}/entry/:entryId`.
   - Browser Back triggers `Content.jsx`'s `useEffect`, detecting `!entryId && currentActiveContent`. It smoothly dismisses the reader and restores focus to the active entry row.

---

## 3. Reference Application Archaeology & Analysis

| Application                                  | Platform / Technology                       | Pane Hierarchy                                                                                                                                      | Selected-Row Semantics                                                       | Reader Transition                                                                               | Back / Close Semantics                                                                                  | Resize Across Breakpoints                                                                         |
| :------------------------------------------- | :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------ |
| **NetNewsWire** (Brent Simmons / Ranchero)   | macOS (AppKit) & iOS/iPadOS (UIKit / Swift) | **macOS:** 3 fixed split panes (`NSSplitViewController`).<br>**iPad:** `UISplitViewController` (collapses to navigation stack in compact/portrait). | Persistent selection. Clicking an entry instantly swaps `WKWebView` content. | Instantaneous in-place load in column 3. Spacebar scrolls article then advances to next unread. | On iPad stack, `< Timeline` button pops to list. On macOS, no back button; reader is permanent.         | Panes fold sequentially: detail collapses first, then sidebar folds into drawer icon.             |
| **Apple News**                               | macOS & iOS/iPadOS                          | 2-pane on desktop (Sidebar + Feed). Rich articles open in full content sheet or separate modal window.                                              | Transient row click.                                                         | Full-pane transition to preserve bespoke multi-column editorial typography & rich media embeds. | Dedicated Back chevron top-left returns to feed; preserves exact feed scroll offset.                    | Squeezing window never forces 3 columns; prioritizes reading measure over co-visibility.          |
| **Nextflux** (Fork of ReactFlux)             | Web / Next.js                               | Permanent 3-pane on desktop (`ReadingLayout.jsx`).                                                                                                  | Persistent selection. Squeezes all columns onto screen.                      | Always visible. Empty state "No article selected" when inactive.                                | No reader close button on wide desktop; reader is permanent.                                            | At `<1024px`, collapses list or reader abruptly; at 1024px–1280px, reader is severely compressed. |
| **Reeder 5 / Reeder Classic** (Silvio Rizzi) | macOS & iOS                                 | Configurable 1, 2, or 3 panes. Default 3-pane on large displays, 2-pane or 1-pane on laptop/tablet.                                                 | Persistent selection. Arrow keys advance list.                               | Instant load in pane 3.                                                                         | Dedicated toggle button hides/shows sidebar and list. Esc or swipe-back returns to list in 1-pane mode. | Responsive folding: collapses to 2 panes below 1200px, 1 pane below 800px.                        |
| **Feedbin**                                  | Web (Rails / Turbo / Vanilla JS)            | 2 panes (Feeds + List) OR 3 panes (Feeds + List + Reader) toggled via user preference.                                                              | Selection updates URL hash / pushState.                                      | In 2-pane, reader slides over or replaces list. In 3-pane, loads in right column.               | Close button / Esc returns to list in 2-pane; deselects entry in 3-pane.                                | Fluid columns with hard min-widths; below 1100px drops to 2 panes automatically.                  |

### Architectural Takeaways for NewsFlux

1. **The Trap of Forced Three-Pane Layouts:** Nextflux's fatal UX flaw was forcing three panes across all desktop screens. At 1024px and 1280px, the sidebar (240px) and article list (300px) leave only ~500px–700px for reading, forcing text to wrap prematurely and ruining wide code blocks, tables, and images.
2. **Apple News Editorial Priority:** Apple News prioritizes reading immersion over mechanical triage. For editorial products that pride themselves on typography, reading comfort, and OLED dark aesthetics, a dedicated full content pane is vastly superior to a cramped third column.
3. **NetNewsWire's Power-Triage vs NewsFlux's Reading Contract:** NetNewsWire is primarily an RSS triage terminal for macOS power users scanning hundreds of headlines with arrow keys. NewsFlux, while supporting high-speed triage via hotkeys (`j`/`k`, `n`/`p`, Space), is an **editorial reader** featuring reading time estimates, author badges, rich enclosures, footnote popovers, and adjustable typography (font family, font size, line height, reading width).
4. **Adaptive Folding is Mandatory:** Any system with multi-pane capabilities must fold down to single-pane gracefully as viewport width decreases or as browser zoom increases.

---

## 4. Viewport Classification & Mathematical Feasibility Matrix

### 4.1 Derivation of Dimensional Requirements

To evaluate feasibility without arbitrary assumptions, we ground the calculation in NewsFlux's verified codebase constants:

1. **Sidebar Column (`W_side`):**
   - Expanded: `240px` ([`src/App.jsx`](../src/App.jsx#L33)).
   - Medium Rail: `80px` ([`src/components/Navigation/MediumNavigation.css`](../src/components/Navigation/MediumNavigation.css)).
   - Collapsed: `0px`.
2. **Article List Viable Width (`W_list`):**
   - Container padding: `10px` left + `10px` right = `20px` ([`src/components/Article/ArticleList.css`](../src/components/Article/ArticleList.css#L5)).
   - Grid minimum cell width: `CARD_GRID_MIN_WIDTH = 300px` ([`src/hooks/useArticleListLayout.js`](../src/hooks/useArticleListLayout.js#L5)).
   - In `column` (standard card) layout: Card contains a 24px favicon mark, title, 2–3 line summary, author, relative date, reading time badge, unread dot, and star icon. Below `360px`, titles truncate to 2–3 words and metadata wraps into illegible stacks.
   - **Minimum Viable List Width:** **`360px`** (bare minimum); **`380px–420px`** (comfortable).
3. **Reader Viable Width (`W_reader`):**
   - Margin & Gutters: `margin: 10px 10px 10px 0` + container padding = ~`40px–60px`.
   - Typography settings in [`src/utils/settings-options.js`](../src/utils/settings-options.js):
     - `MIN_ARTICLE_WIDTH = 50ch`
     - Default `articleWidth = 75ch`
     - `MAX_ARTICLE_WIDTH = 100ch`
     - Default `fontSize = 1.05rem` (~`16.8px` base).
   - In standard system fonts (`system-ui`, Inter, Roboto), `1ch ≈ 9.8px–10.4px`.
     - `50ch` text body = ~`500px` (plus 60px gutters = **`560px`** minimum).
     - `75ch` text body (default) = ~`750px` (plus 70px gutters = **`820px`** comfortable).
     - `85ch` text body = ~`850px` (plus 80px gutters = **`930px`** spacious).
   - Controls & embeds: `ActionButtons` toolbar (8–9 buttons) requires ≥`340px`. Littlefoot footnote popovers require ≥`300px` bubble width. Code blocks and tables require ≥`600px` to prevent perpetual horizontal scrolling.

### 4.2 Minimum Width Arithmetic

$$\text{Total Required Width } (W_{\text{req}}) = W_{\text{side}} + W_{\text{list}} + W_{\text{reader}}$$

- **Constrained / Squeezed Multi-Pane (Bare Minimum):**
  $$W_{\text{req}} = 240\text{px} + 360\text{px} + 560\text{px} = \mathbf{1160\text{px}}$$
  _(Note: Leaves reader at 50ch, severely compressed from 75ch default)._
- **Aggressive Multi-Pane Threshold:**
  $$W_{\text{req}} = 240\text{px} + 380\text{px} + 820\text{px} = \mathbf{1440\text{px}}$$
  _(Maintains 75ch default reading measure and 380px list)._
- **Conservative Multi-Pane Threshold:**
  $$W_{\text{req}} = 240\text{px} + 420\text{px} + 940\text{px} = \mathbf{1600\text{px}}$$
  _(Spacious list, generous reader up to 85ch, comfortable margins, zero crowding)._

---

### 4.3 Viewport Evaluation Matrix

| Viewport (W × H) | Target Device Category                                                      | Current Window Class | Feasible Leftover for List + Reader (with 240px Sidebar)                                  | Reader Measure Result if Multi-Pane Forced                                                                                  | Multi-Pane Classification        | Contract Status                                                                                           |
| :--------------- | :-------------------------------------------------------------------------- | :------------------- | :---------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **390 × 844**    | Mobile Phone (iPhone 12/13/14)                                              | `COMPACT`            | N/A (Sidebar hidden; bottom nav active)                                                   | N/A (<390px total)                                                                                                          | **`SINGLE_PANE_REQUIRED`**       | **Binding Contract** (Zero change)                                                                        |
| **600 × 960**    | Small Tablet / Fold Inner Portrait                                          | `MEDIUM`             | $600 - 80\text{ (rail)} = 520\text{px}$                                                   | ~200px (Complete collapse)                                                                                                  | **`SINGLE_PANE_REQUIRED`**       | **Binding Contract**                                                                                      |
| **884 × 1104**   | Critical Medium Viewport (Surface Duo / iPad Split / Large Tablet Portrait) | `MEDIUM`             | $884 - 80\text{ (rail)} = 804\text{px}$ (or $884 - 240 = 644\text{px}$ if sidebar forced) | If 360px list: reader gets $444\text{px}$ ($<40\text{ch}$). If sidebar forced: reader gets $284\text{px}$ ($<26\text{ch}$). | **`SINGLE_PANE_REQUIRED`**       | **MANDATORY CONTRACT LOCK** (Must not be reclassified away from single-pane without explicit PM decision) |
| **1024 × 768**   | Standard Tablet Landscape / Small Laptop                                    | `DESKTOP` (≥993px)   | $1024 - 240 = 784\text{px}$                                                               | If 360px list: reader gets $424\text{px}$ ($<38\text{ch}$). Reader crushed.                                                 | **`SINGLE_PANE_PREFERRED`**      | **Single-Pane Preferred** (Multi-pane rejected)                                                           |
| **1280 × 720**   | 720p Desktop / Budget Laptop / Chromebook                                   | `DESKTOP`            | $1280 - 240 = 1040\text{px}$                                                              | If 360px list: reader gets $680\text{px}$ (~$60\text{ch}$). Compresses 75ch default.                                        | **`SINGLE_PANE_PREFERRED`**      | Single-pane preferred; potential 2-pane only if sidebar collapsed                                         |
| **1440 × 900**   | Standard 13"/14" Laptop (MacBook Air/Pro)                                   | `DESKTOP`            | $1440 - 240 = 1200\text{px}$                                                              | If 380px list: reader gets $820\text{px}$ (**$75\text{ch}$ exact match**).                                                  | **`MULTIPANE_CANDIDATE`**        | **Aggressive Threshold Candidate**                                                                        |
| **1600 × 900**   | Wide 16:9 Desktop Display                                                   | `DESKTOP`            | $1600 - 240 = 1360\text{px}$                                                              | If 420px list: reader gets $940\text{px}$ ($85\text{ch}$ spacious).                                                         | **`MULTIPANE_STRONG_CANDIDATE`** | **Conservative Threshold Candidate**                                                                      |
| **1920 × 1080**  | Full HD 1080p Desktop Display                                               | `DESKTOP`            | $1920 - 240 = 1680\text{px}$                                                              | List gets 440px; reader gets $1000\text{px}$+ with generous gutters.                                                        | **`MULTIPANE_STRONG_CANDIDATE`** | Multi-pane strong candidate (Opt-in only)                                                                 |

---

## 5. Architectural Constraints & System Dependencies

1. **`884×1104` Protection Contract:**
   The `884×1104` viewport is NewsFlux's canonical medium boundary. Under no circumstances may multi-pane layout activate at or below `884×1104`.
2. **`MAIN_REMOUNT_ON_WINDOW_CLASS_CHANGE=PROHIBITED`:**
   Resizing the window across breakpoints or window classes must not unmount or remount `<Main />` or reset application data stores (`dataState`, `contentState`).
3. **No Persistent Layout State Without PM Authorization:**
   Adding new keys to `localStorage` or `settingsState` (e.g. `desktopLayoutMode`) is strictly prohibited during research and requires explicit PM architecture authorization.
4. **OLED & Dark Palette Contract:**
   Content surfaces (article cards, reader background) must remain **opaque** (`--nf-surface-content`, `--color-bg-1`). Glassmorphism is strictly confined to chrome (navigation rail, top header, floating action pill).
5. **Deterministic All/Unread Contract:**
   Unread sorting and pagination must remain strictly chronological and deterministic (`order: "published_at", direction: "desc"`).
6. **Touch Targets & Coarse Pointers:**
   All interactive targets must maintain ≥44px (forms) and ≥48px (navigation) when touched by coarse pointers. Compact density is only permissible for fine mouse pointers.

---

## 6. Comprehensive Interaction-State Analysis (A through T)

### A. Selected Entry as Transient UI State vs URL State

- **Current Model:** URL is the canonical single source of truth (`/{path}/entry/:entryId`). Selecting an entry navigates to this URL; refreshing or deep-linking restores `activeContent`.
- **Multi-Pane Implication:**
  - If selecting an article updates the URL, deep linking and sharing remain seamless.
  - However, if the user rapidly arrows through articles in the list (e.g. 20 articles in 10 seconds), pushing 20 browser history states pollutes the browser history stack, making the Back button practically useless.
  - _Resolution:_ In a multi-pane layout, row selection should use `history.replaceState` during keyboard traversal, and only use `history.pushState` on explicit mouse clicks or when transitioning from list-only view.

### B. Browser Back Behavior

- **Current Model:** In single-pane, pressing Back from `/{path}/entry/:entryId` returns to `/{path}`, closing the reader and restoring focus to the list row.
- **Multi-Pane Implication:**
  - On a 3-pane desktop, users do not expect the Back button to "close" a pane that looks permanently embedded.
  - If Back deselects the article, the right pane suddenly becomes empty ("No article selected"), which feels broken.
  - If Back returns to the previous feed/category, the user loses their place in the current list.
  - _Resolution:_ Browser Back must strictly navigate chronological route transitions. In Option A (single-pane), Back behavior is natural and unambiguous.

### C. Reader Close Semantics

- **Current Model:** `ActionButtons` renders `<IconClose />`. Triggering it calls `closeActiveContent()`, navigating to the base path and restoring focus.
- **Multi-Pane Implication:**
  - In a co-visible multi-pane layout, does "Close" close the reader column (expanding the list to full width), or does it deselect the article?
  - If it collapses the column, the UI transitions back to single-pane. If it clears the article, a vacant empty-state card is left behind.
  - _Resolution:_ Under Option C/D, "Close" docks/undocks or closes the preview pane, returning to full list width.

### D. Preserving Article-List Scroll Position

- **Current Model:** Guaranteed by keeping `.entry-col` mounted with `inert` while reader is active.
- **Multi-Pane Implication:**
  - In multi-pane, both panes are visible simultaneously, so the list scroll position is naturally visible.
  - However, when the reader changes articles via hotkeys (`j`/`k`), the list must programmatically scroll to keep the active card centered via `scrollSelectedCardIntoView()`.
  - _Risk:_ Scroll fighting between list virtualization (`virtua`) and reader rendering.

### E. Preserving Reader Scroll Position

- **Current Model:** Switching articles resets reader scroll to `0`. Window resizing adjusts container width.
- **Multi-Pane Implication:**
  - Resizing across the multi-pane threshold (e.g. from 1650px down to 1300px) must not reset reading progress. The reader scroll offset must be preserved using proportional scroll anchoring.

### F. Mark-Read Timing

- **Current Model:** Configured via `markReadBy` (`"view"`, `"scroll"`, `"manual"`). Under `"view"`, selection marks as read immediately.
- **Multi-Pane Implication:**
  - In multi-pane keyboard triage, arrowing down marks every passing entry as read instantly.
  - _Resolution:_ Multi-pane requires a debounce/delay gate (e.g. 1.5s reading dwell time or manual mark) before committing unread mutations to Miniflux.

### G. Unread Mutation While Reader Visible

- **Current Model:** When filtering by Unread, marking an item read updates `unreadTotalState`.
- **Multi-Pane Implication:**
  - If an unread article is marked read while co-visible in the list, **it must not immediately disappear from the visible list**, otherwise the card vanishes from under the cursor and list items shift violently while the user is reading.
  - The item should be marked read visually (fading unread dot) but retained in the current list until the next explicit refresh or navigation change.

### H. Home Editorial Projections

- **Current Model:** [`src/pages/Home.jsx`](../src/pages/Home.jsx) renders rich multi-column editorial sections: Highlights, Recent Stories, and Candidate Story Ranking (PR #106).
- **Multi-Pane Implication:**
  - Home's multi-column grid cannot fit inside a 380px sidebar list!
  - Forcing a multi-pane split on `/` breaks Home's editorial layout.
  - _Resolution:_ Home (`/`) must remain **strictly single-pane** regardless of screen width. Multi-pane can only ever apply to standard feed/category/all streams (`/all`, `/today`, `/feed/:id`, `/category/:id`).

### I. All/Unread Chronology

- Co-visible lists must maintain strict chronological ordering (`published_at desc`). When the user advances to the next unread article across feeds, the list must smoothly synchronize to the newly active stream.

### J. Category & Feed Navigation

- Clicking a different feed in the 240px sidebar while an article is open in pane 3 creates an ambiguity: Does pane 3 keep displaying the article from Feed A while pane 2 shows Feed B?
- _Resolution:_ Switching feeds must either clear pane 3 or load the first unread article of the new feed.

### K. Medium Navigation Rail Interactions

- The 80px Medium Navigation Rail (`WINDOW_CLASSES.MEDIUM`, 600px–992px) is architecturally incompatible with a 3-pane layout. It is explicitly protected from multi-pane contention.

### L. Keyboard Tab / Arrow / Escape Behavior

- **Tab Traversal:** Must follow a single predictable cycle: `Skip Link -> Sidebar -> List Header (Search/Sort) -> Active List Item -> Reader Actions -> Reader Content Links -> List Footer`.
- **Escape Semantics:**
  - If focus is in Reader Content: First Escape returns focus to Reader Close or Active List Item.
  - If focus is in List: Escape performs no destructive action (or exits search).
  - Never traps focus or causes focus loss to `<body>`.

### M. Screen-Reader Landmark Structure

- In multi-pane, having two primary reading panels requires distinct accessible landmarks:
  - `<nav aria-label="Feeds">` (Sidebar)
  - `<section aria-label="Article List">` (List)
  - `<article aria-label="Article content">` (Reader)
- The active card must announce `aria-current="true"`.

### N. Resize Across Multi-Pane Threshold

- Resizing between 1650px (multi-pane) and 1300px (single-pane):
  - If an article is open: smoothly transitions to single-pane reader overlay without losing reading scroll position.
  - If no article is open: displays article list.
  - Must not emit ResizeObserver loop errors.

### O. Coarse Pointer & Touch Desktops

- Surface Pro, touch laptops, and iPad Pro with keyboard/touch:
  - Multi-pane touch targets must remain ≥44px/48px.
  - Swipe gestures (`useSwipeable`) must not trigger accidental article navigation while horizontally panning wide tables or code blocks.

### P. Fold / Tablet Accidental Activation

- Galaxy Fold (unfolded ~884px) and iPad portrait/landscape:
  - Must remain single-pane. Gated by strict min-width (≥1440px / ≥1600px).

### Q. Performance Cost of Simultaneously Mounted Panes

- Virtualized list + heavy reader DOM (`html-react-parser`, littlefoot, plyr, media enclosures) mounted concurrently increases memory by 35–50%.
- Both scroll containers must use passive scroll listeners to prevent compositor jank.

### R. Data Fetching Duplication

- `fetchSingleEntry` must check `contentState.get().entries` before dispatching an HTTP request. Opening the reader pane beside the list must never refetch data already in memory.

### S. Stale-Session Protection

- Background data sync (`refreshFeedData`) must update list unread counts without unmounting the currently active article in the reader pane.

### T. Interaction with Future Personalization

- Personalized recommendations and candidate ranking pipeline (PR #106) belong exclusively on Home editorial projections. Stream triage lists remain deterministic and untouched by recommendation heuristics.

---

## 7. Analysis of Candidate Options

### Option A: Keep Current Single-Content Pane (Sidebar + List OR Sidebar + Reader)

- **Description:** NewsFlux retains its proven single-content-pane architecture across all desktop displays. The user views either the full article list or the full reader.
- **Width Behavior:** On displays ≥993px, 240px Sidebar + full-width content pane. At 1440px–1920px, reader content is centered with an optimal reading measure (`clamp(50ch, 75ch, 85ch)`) and balanced negative space.
- **Navigation Model:** Discrete, high-clarity view transitions. URL synchronizes `/{path}` and `/{path}/entry/:entryId`. Back or Escape cleanly returns to list.
- **Reader Model:** 100% immersive, distraction-free reading environment. Complete preservation of editorial typography, image galleries, and footnotes.
- **Pros:**
  - 100% alignment with NewsFlux's editorial vision.
  - Zero risk of cramped typography or squeezed reading measure.
  - Zero conflict with `884×1104`, tablet, or Fold contracts.
  - Maximum accessibility: straightforward focus restoration, unambiguous landmarks.
  - Highest performance and lowest memory footprint.
  - Zero upstream conflict risk with ReactFlux core.
- **Cons:** High-volume headline triage requires opening and closing reader (mitigated by existing keyboard shortcuts `j`/`k`/`n`/`p` which advance articles without returning to list).
- **Accessibility Risk:** Low.
- **Implementation Complexity:** None (Current state).
- **Upstream Conflict Risk:** None.
- **Recommendation:** **RECOMMENDED BASELINE CONTRACT.**

---

### Option B: Two-Content-Pane Desktop (Permanent Sidebar + Article List + Reader)

- **Description:** Automatically splits desktop into 3 simultaneous columns (Sidebar 240px | Article List 380px | Reader flexible).
- **Width Behavior:** Automatic switch on all screens ≥993px or ≥1280px.
- **Navigation Model:** Clicking list row updates reader pane in place. Reader cannot be dismissed.
- **Reader Model:** Embedded sidecar reader.
- **Pros:** High-speed headline triage; co-visible context.
- **Cons:**
  - Squeezes reader measure below acceptable floor at 993px–1366px.
  - Breaks browser Back button semantics.
  - Incompatible with Home editorial sections.
  - High risk of visual crowding and reading fatigue.
- **Accessibility Risk:** High (split focus, landmark complexity).
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** Severe (destroys ReactFlux route and content layout contracts).
- **Recommendation:** **REJECTED.**

---

### Option C: Adaptive Preview Pane (Single-Pane Default, Reader Preview Above High Threshold)

- **Description:** NewsFlux remains single-pane by default. Above an aggressive (≥1440px) or conservative (≥1600px) threshold, opening an article docks the reader to the right of the list as a preview pane rather than covering it.
- **Width Behavior:** Activates strictly above ≥1440px or ≥1600px. Below that threshold, gracefully folds to standard single-pane overlay.
- **Navigation Model:** Dual-mode: multi-pane above threshold, single-pane below. Close button or Esc dismisses the preview pane.
- **Reader Model:** Full 75ch reader with dedicated scroll container.
- **Pros:** Preserves single-pane safety on all standard devices; utilizes extra space on large monitors.
- **Cons:** Adds responsive mode branching; dual focus models; potential layout shift on resize.
- **Accessibility Risk:** Medium.
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** High.
- **Recommendation:** Viable candidate for future consideration, but held pending PM review.

---

### Option D: User-Opt-In Multi-Pane (Preference-Controlled, High Threshold Only)

- **Description:** Multi-pane is **never enabled automatically**. It exists only as an explicit user toggle in Appearance Settings ("Wide Desktop: Single Pane [Default] | Three-Pane Split"). Even when enabled, it only takes effect when screen width is ≥1600px (or ≥1440px with collapsed sidebar).
- **Width Behavior:** Explicit opt-in + hardware capability check (≥1600px).
- **Navigation Model:** Preserves single-pane for 100% of standard users; gives power triage users an opt-in mode.
- **Reader Model:** Independent reader pane with debounced unread marking.
- **Pros:**
  - Absolute protection for standard users, tablets, and mobile devices.
  - Eliminates unexpected UX changes.
  - Safest path for power users with large 1440p/4K monitors.
- **Cons:** Requires maintaining two layout rendering paths and additional settings schema.
- **Accessibility Risk:** Medium.
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** Moderate to High.
- **Recommendation:** **SAFEST FUTURE ARCHITECTURAL OPTION IF MULTI-PANE IS EVER AUTHORIZED.**

---

## 8. Proposed Viewport Contract Summary

| Viewport Axis             | Proposed Classification       | Layout Behavior                                       |
| :------------------------ | :---------------------------- | :---------------------------------------------------- |
| **PHONE (`390×844`)**     | `REQUIRED_SINGLE_PANE`        | Bottom compact navigation + full-width list or reader |
| **TABLET (`768×1024`)**   | `REQUIRED_SINGLE_PANE`        | Medium navigation rail / single content pane          |
| **FOLD_OPEN (`~884px`)**  | `REQUIRED_SINGLE_PANE`        | Medium navigation rail / single content pane          |
| **`884X1104` (Critical)** | `REQUIRED_SINGLE_PANE`        | **LOCKED: Medium rail + single content pane**         |
| **`1024X768`**            | `PREFERRED_SINGLE_PANE`       | 240px sidebar + single content pane                   |
| **`1280X720`**            | `PREFERRED_SINGLE_PANE`       | 240px sidebar + single content pane                   |
| **`1440X900`**            | `MULTIPANE_OPTIONAL`          | Aggressive threshold candidate (Opt-in only)          |
| **`1600X900`**            | `MULTIPANE_DEFAULT_CANDIDATE` | Conservative threshold candidate (Opt-in only)        |
| **`1920X1080`**           | `MULTIPANE_DEFAULT_CANDIDATE` | Spacious multi-pane candidate (Opt-in only)           |

---

## 9. Future Implementation & Performance Gates

Any future pull request attempting to introduce multi-pane functionality must satisfy the following pass/fail criteria before merging:

### 9.1 Accessibility Gates (`A11Y_GATE_DESIGN`)

- [ ] **`GATE_A11Y_KEYBOARD_FLOW`:** Keyboard Tab order must logically traverse Sidebar -> List Controls -> Active Article Card -> Reader Actions -> Reader Body -> List Footer without getting trapped.
- [ ] **`GATE_A11Y_FOCUS_RESTORE`:** Closing the reader or pressing Escape from the reader must restore focus directly to the corresponding `[data-entry-id]` element in the article list.
- [ ] **`GATE_A11Y_ESCAPE_SEMANTICS`:** First Escape from reader content returns focus to reader toolbar/close; second Escape returns focus to active article card in list. Escape never closes active modals or causes focus loss.
- [ ] **`GATE_A11Y_LANDMARKS`:** Sidebar, Article List, and Reader must be wrapped in separate, correctly labeled ARIA landmarks (`<nav>`, `<section>`, `<article>`).
- [ ] **`GATE_A11Y_SELECTION_ANNOUNCE`:** Active article card in the list must convey its state to assistive technology via `aria-current="true"` or `aria-selected="true"`.
- [ ] **`GATE_A11Y_ZOOM_REVERT`:** When browser text zoom is set to 200%, the effective viewport width drops below the threshold; the layout must automatically revert to single-pane without horizontal clipping or overlapping text.
- [ ] **`GATE_A11Y_COARSE_TARGETS`:** On touch-enabled desktop displays, all buttons and interactive elements must maintain ≥44px (forms) and ≥48px (navigation) hit targets.

### 9.2 Performance & Rendering Gates (`PERFORMANCE_GATE_DESIGN`)

- [ ] **`GATE_PERF_DOM_LIMIT`:** Simultaneously mounted list and reader must not exceed 150 active DOM nodes inside the scroll view; list items outside the viewport must remain virtualized via `virtua`.
- [ ] **`GATE_PERF_SCROLL_FPS`:** Both list and reader scroll containers must achieve sustained 60fps scrolling on baseline hardware without main-thread blocking.
- [ ] **`GATE_PERF_IMAGE_DECODING`:** Article reader images must use `loading="lazy"` and `decoding="async"`, and must never stall or delay article list thumbnail rendering.
- [ ] **`GATE_PERF_RESIZE_STABILITY`:** Rapid window resizing across the breakpoint (e.g. 1590px to 1610px) must not trigger `ResizeObserver loop limit exceeded` warnings or unmount/remount `<Main />`.
- [ ] **`GATE_PERF_NO_FETCH_DUPLICATION`:** Selecting an article in multi-pane must use cached store data (`contentState.entries`) without issuing redundant network requests for items already in memory.
- [ ] **`GATE_PERF_MEMORY_LEAK_FREE`:** Cycling through 100 articles in multi-pane must show zero detached DOM tree leaks (verified via Chrome DevTools Heap Snapshot).

---

## 10. Open Product Decisions (`HOLD_PRODUCT_DECISION`)

| Decision ID       | Summary                                                                | Evidence & Architectural Findings                                                                                                                               | Status                                                          |
| :---------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **`OPD-NNW05-1`** | **Should NewsFlux remain strictly single-pane on wide desktop?**       | Current single-pane design maximizes editorial focus, protects typography, and avoids upstream divergence. High-volume triage is already supported via hotkeys. | **`HOLD_PRODUCT_DECISION`** (Recommended: Maintain single-pane) |
| **`OPD-NNW05-2`** | **If multi-pane is added, should it be automatic or user-opt-in?**     | Automatic activation causes jarring layout shifts for users accustomed to single-pane. Opt-in (Option D) protects all default expectations.                     | **`HOLD_PRODUCT_DECISION`** (Recommended: Opt-in only)          |
| **`OPD-NNW05-3`** | **Threshold selection: Aggressive (1440px) vs Conservative (1600px)?** | Mathematical proof: 1440px leaves exactly 820px (75ch) for reader. 1600px allows up to 940px (85ch) with comfortable margins.                                   | **`HOLD_PRODUCT_DECISION`** (Recommended: 1600px)               |
| **`OPD-NNW05-4`** | **Home page multi-pane exclusion.**                                    | Home editorial sections (highlights, ranking) require full width and cannot be compressed into a 380px list column.                                             | **`BINDING_PROPOSAL`** (Home remains single-pane always)        |

---

## 11. Upstream ReactFlux Conflict Surfaces

- **Remote:** `https://github.com/electh/ReactFlux.git` (`upstream/main` at `f4dfd1c9`).
- **Conflict Assessment:**
  1. **Route Hierarchy:** Upstream ReactFlux uses a unified route model with single-pane overlay. Introducing a permanent 3-pane layout would require modifying `src/App.jsx`, `src/routes.jsx`, and `src/components/Content/Content.jsx`, creating massive merge conflict surfaces with upstream updates.
  2. **Styling Incompatibilities:** Upstream relies on standard CSS grid and mobile overlay classes (`.article-container-full-size`). Altering these fundamentally breaks upstream mergeability.
  3. **Conclusion:** Keeping NewsFlux single-pane-first (Option A) maintains maximum upstream compatibility and cleanly separates NewsFlux's design enhancements from core upstream sync.
