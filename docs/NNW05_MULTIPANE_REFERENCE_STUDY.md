# NNW-05: Wide-Desktop Multi-Pane Reference Study & Architecture Analysis

- **Track:** `NNW-05_MULTI_PANE_REFERENCE_STUDY`
- **Role:** UX / Architecture Researcher, Current-State Auditor, Reference Analyst, Design-Gate Author
- **Status:** Complete Research & Architectural Gate Document — **Docs/Research Only (No Code Implementation)**
- **Research Baseline (`RESEARCH_BASE`):** `4cb99e196f88b01602a7fa53575430dd74ec5f94`
- **Current Main Reviewed (`CURRENT_MAIN_REVIEWED`):** `3c1eeb03501dd0993d201c588632fa3c59b0ff7e`
- **Companion Documents:**
  - [`docs/DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md) (NetNewsWire reference track & visual identity)
  - [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md) (Visual foundation and design philosophy)
  - [`docs/NEWSFLUX_NAV_VISUAL_01.md`](./NEWSFLUX_NAV_VISUAL_01.md) (Navigation contract & window classes)
  - [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md) (Reader layout, frame & prose measure contract)
  - [`docs/PWA_ARCHITECTURE.md`](./PWA_ARCHITECTURE.md) (Progressive web app architecture & runtime contracts)

### Historical Snapshot & PM Review Note

At the time the initial `NNW-05` research pass executed, GitHub `main` was at `4cb99e196f88b01602a7fa53575430dd74ec5f94` (`MAIN_AT_START` and `MAIN_AT_FINISH`), and no security-headers pull request had been opened yet (`SECURITY_HEADERS_PR_OBSERVED=NO`). Those recorded values remain accurate historical observations of the repository state when the study was originally authored.

Subsequently, PR #111 (`SECURITY_HEADERS_01`) was created, merged, and deployed, advancing `main` to `3c1eeb03501dd0993d201c588632fa3c59b0ff7e`. Because this pull request is strictly documentation-only and has zero file or scope overlap with `SECURITY_HEADERS_01`, no rebase or history rewrite is required (`mergeable_state=clean`).

```text
RESEARCH_BASE=4cb99e196f88b01602a7fa53575430dd74ec5f94
CURRENT_MAIN_REVIEWED=3c1eeb03501dd0993d201c588632fa3c59b0ff7e
INTERVENING_CHANGE=SECURITY_HEADERS_01
NNW05_SCOPE_OVERLAP_WITH_INTERVENING_CHANGE=NONE_IDENTIFIED
```

---

## 1. Executive Summary & Core Conclusion

### Core Question

Should NewsFlux eventually adopt a multi-pane layout (co-visible Article List and Reader) on sufficiently wide desktop displays, and if so, what are the safest architectural boundaries, viewport thresholds, interaction contracts, and product gates?

### Architectural Finding

NewsFlux is engineered around a **single-pane-first, distraction-free editorial philosophy**:

- On mobile (`COMPACT`, `<600px`), navigation, article list, and reader are strictly serialized.
- On tablet / Fold (`MEDIUM`, `600px–992px`, notably the critical `884×1104` Fold/tablet viewport), NewsFlux presents an `80px` responsive Medium Navigation Rail alongside a single content pane (Article List OR Reader in full view).
- On standard desktop (`DESKTOP`, `≥993px`), NewsFlux provides a `240px` static collapsible Sidebar and a single content pane. Opening an article transitions the central area from the virtualized article list to the full-width reader (`ArticleDetail`), keeping the list mounted but `inert` in the background.

Under the frozen reader contract in [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md) (`READER-MEASURE-01`), NewsFlux explicitly separates the **reader frame** from the **prose measure**:

- **Reader Frame (`articleWidth`, range `50–100`, default `75`):** Governs the outer container width (`max-width: ${articleWidth}ch` above `768px`, `90%` at or below `768px`) used by media, figures and captions, iframes, video, code blocks, and tables. At the default `articleWidth=75`, the unconstrained reader frame is measured at **`794px`** (`MEASURED_CURRENT_GEOMETRY`).
- **Prose Measure (`--reader-prose-measure`):** Governs paragraphs, lists, blockquotes, headings, and the aligned `.article-header-column` via:
  ```css
  clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)
  ```
  capped by `max-width: min(100%, var(--reader-prose-measure))` so prose is never wider than the frame. This yields a **`40ch` prose floor** at `articleWidth=50`, **`56.25ch` (measured at `≈595px`, `≈73` characters per line)** at the default `articleWidth=75`, and a **`58ch` prose cap** at `articleWidth=100`.

A permanent three-pane layout (`Sidebar | Article List | Reader`) was previously **rejected** in [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md) because forcing three co-visible panes across intermediate desktop widths (`993px–1366px`) introduces a high-density three-pane trade-off: it compresses the `75ch` (`794px`) reader frame for media, tables, and code blocks, narrows or eliminates editorial margins around the `56.25ch` (`595px`) prose column (and below `~1195px` begins compressing prose toward or below the `40ch` floor), and crowds the article list column.

### Recommendation: `HOLD_PRODUCT_DECISION` (Maintain Option A Default; Option D as Preferred Future Candidate If Authorized)

1. **Current Default Contract (Unchanged):** Preserve **Option A (Single-Content-Pane Desktop)** as the default NewsFlux architecture. Across standard desktop widths (`993px–1440px` and wider by default), NewsFlux remains a single-content pane (`Sidebar + Article List` OR `Sidebar + Reader`).
2. **Critical Viewport Protection:** The critical `884×1104` Fold/tablet viewport (`SINGLE_PANE_REQUIRED`), compact phone viewports (`390×844`), small tablet/Fold viewports (`600×960`), and standard tablet/laptop viewports (`1024×768`, `1280×720`, `SINGLE_PANE_PREFERRED`) remain protected single-pane layouts.
3. **Future Follow-Up Candidate (Later Dedicated Phase, If Authorized):** This research study does not authorize product changes. If multi-pane is subsequently authorized by product management in a later dedicated phase, **Option D (User-Opt-In Multi-Pane)** is the preferred future candidate (with **Option C** as a secondary adaptive candidate), gated behind explicit user opt-in and an engineering-estimate width threshold of **`≥1600px`** (Conservative Engineering-Estimate Candidate) or **`≥1440px`** (Aggressive Engineering-Estimate Candidate):
   - **Sidebar:** `240px` (`MEASURED_CURRENT_GEOMETRY`)
   - **Article List:** `380px–420px` (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`)
   - **Reader Pane:** `820px–940px` (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`, accommodating the measured `794px` default `articleWidth=75` reader frame and the `56.25ch ≈ 595px` frozen prose measure plus inline reader gutters)
   - **Home Guardrail (`RECOMMENDED_GUARDRAIL`):** Exclude Home (`/`) from multi-pane so its multi-column editorial projection remains single-pane pending explicit product authorization.
4. **Product Authority & Runtime Risk Boundary:** Multi-pane remains **`HOLD_PRODUCT_DECISION`**.
   - `CURRENT_PR_RUNTIME_RISK=NONE / docs-only`
   - `FUTURE_MULTIPANE_RUNTIME_RISK=NOT EVALUATED` (requires dedicated implementation gates in Section 9)

---

## 2. Current NewsFlux Layout Architecture (`CODE_VERIFIED`)

### 2.1 Window Classes & Grid Layout

NewsFlux categorizes screen geometry via [`src/utils/window-class.js`](../src/utils/window-class.js) and [`src/hooks/useWindowClass.js`](../src/hooks/useWindowClass.js):

- **`COMPACT`**: `width < 600px` AND `height >= 480px`.
- **`MEDIUM`**: `(600px <= width < 993px)` OR `(width < 600px AND height < 480px)`. The critical `884×1104` Fold/tablet viewport is explicitly classified as `MEDIUM`.
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
- On `MEDIUM` (`600px–992px`), `--desktop-sidebar-width` is `0px`. When browsing lists (`!activeContent`), `--medium-navigation-width` is `80px`. When the reader is active (`activeContent` is present), `--medium-navigation-width` is `0px`, yielding 100% of the viewport width to the reader.
- On `COMPACT` (`<600px`), both sidebar and medium rail widths are `0px`. A bottom `CompactNavigation` bar (`≥48px` targets) is rendered.

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

**Key Architectural Characteristics (`CODE_VERIFIED`):**

1. **Persistent List Mounting:** The article list (`.entry-col`) is **not unmounted** when an article opens. Instead, it is marked `inert` and `aria-hidden="true"`. This guarantees that its internal virtualizer scroll position ([`src/components/Article/ArticleList.jsx`](../src/components/Article/ArticleList.jsx)) is preserved in memory and DOM without requiring scroll-state serialization.
2. **Absolute Overlay Framing:** `.article-container-full-size` ([`src/components/Content/Content.css`](../src/components/Content/Content.css)) sets `position: absolute; inset: 0; width: 100%; height: 100%; z-index: 3; margin: 0`. It covers the full area of `.main`, replacing the article list visually.
3. **Focus Routing & Restoration:**
   - Opening an article routes focus via `scheduleAfterNextPaint` to `articleContent.focus()` and resets reader scroll to `0`.
   - Closing an article (`closeActiveContent` in `ContentContext.jsx` or Escape in [`src/hooks/useContentHotkeys.js`](../src/hooks/useContentHotkeys.js)) sets `activeContent = null`, removes `inert` from `.entry-col`, and invokes `restoreEntryListFocus(activeEntryId)`, which locates the `[data-entry-id]` element and focuses it with `{ preventScroll: true }`.
4. **URL & Route Synchronization:**
   - Article list: `/{path}` (e.g. `/all`, `/today`, `/feed/:id`).
   - Reader: `/{path}/entry/:entryId`.
   - Browser Back triggers `Content.jsx`'s `useEffect`, detecting `!entryId && currentActiveContent`. It dismisses the reader and restores focus to the active entry row.

### 2.3 Frozen Reader Frame vs. Prose Measure Contract (`CODE_VERIFIED` & `MEASURED_CURRENT_GEOMETRY`)

Canonical contract: [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md), implemented in [`src/components/Article/ArticleDetail.jsx`](../src/components/Article/ArticleDetail.jsx), [`src/components/Article/ArticleDetail.css`](../src/components/Article/ArticleDetail.css), and [`src/components/Article/ReaderTypography.css`](../src/components/Article/ReaderTypography.css).

1. **Reader Frame (`articleWidth`, range `50–100`, default `75` in [`src/utils/settings-options.js`](../src/utils/settings-options.js)):**
   - Set as `--article-width` on `<article class="article-content">` and applied as inline `maxWidth: isBelowMedium ? "90%" : "${articleWidth}ch"` on `.article-header` and `.article-body`.
   - Media, figures and captions, iframes, video, code blocks, tables, and paragraphs containing media (`p:has(img:not(.icon-image), iframe, video, .plyr)`) occupy the **reader frame**.
2. **Prose Measure (`--reader-prose-measure`):**
   - Registered as a `<length>` custom property and defined on `.article-content .article-body` and `.article-content .article-header .article-header-column` as:
     ```css
     --reader-prose-measure: clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch);
     ```
   - Applied to prose blocks (`p`, `ul`, `ol`, `dl`, `blockquote`, `h1–h6`, `hr`) and `.article-header-column` via `max-width: min(100%, var(--reader-prose-measure))` with `margin-inline: auto`, so prose is never wider than the enclosing reader frame.
3. **Resolution Across `articleWidth` Settings (`CODE_VERIFIED` / `MEASURED_CURRENT_GEOMETRY`):**
   - **`articleWidth = 50`:** Reader frame = `50ch`; prose formula `50 * 0.75ch = 37.5ch` clamps up to the **prose floor of `40ch`** (bounded by the frame).
   - **`articleWidth = 75` (Default):** Reader frame = `75ch` (measured at **`794px`** at `884×1104`, `1280×800`, and `1440×900`, and container-constrained to **`764px`** at `1024×768` with the `240px` sidebar). Prose measure = **`56.25ch`**, measured at **`≈595px`** (**`≈73` characters per line**).
   - **`articleWidth = 100`:** Reader frame = `100ch`; prose formula `100 * 0.75ch = 75ch` clamps down to the **prose cap of `58ch`**.

---

## 3. Reference Application Archaeology & Analysis (`REFERENCE_OBSERVATION`)

Evidence below combines source inspection recorded in [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md), screenshot observations recorded in [`docs/DESIGN_REFERENCES.md`](./DESIGN_REFERENCES.md), and qualitative platform observations (`REFERENCE_OBSERVATION`).

| Application                                  | Platform / Technology                       | Pane Hierarchy (`REFERENCE_OBSERVATION`)                                                                                                            | Selected-Row Semantics                                                       | Reader Transition                                                                           | Back / Close Semantics                                                                                | Resize Across Breakpoints (`REFERENCE_OBSERVATION`)                                                      |
| :------------------------------------------- | :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| **NetNewsWire** (Brent Simmons / Ranchero)   | macOS (AppKit) & iOS/iPadOS (UIKit / Swift) | **macOS:** 3 split panes (`NSSplitViewController`).<br>**iPad:** `UISplitViewController` (collapses to navigation stack in compact/portrait views). | Persistent selection. Selecting an entry swaps detail view content in place. | In-place load in column 3. Spacebar scrolls article and advances to next unread.            | On compact iPad stack, back button pops to timeline. On macOS 3-pane, reader pane remains persistent. | Panes fold sequentially as width narrows: detail collapses into stack, sidebar folds into toggle/drawer. |
| **Apple News**                               | macOS & iOS/iPadOS                          | 2-pane on desktop (Sidebar + Feed). Articles open in a dedicated full content sheet or view.                                                        | Transient card activation.                                                   | Full-content-pane transition preserving editorial typography, lead media, and layout.       | Dedicated Back control returns to feed and restores feed scroll position.                             | Narrowing the window does not force 3 simultaneous columns; prioritizes reading surface over co-list.    |
| **Nextflux** (Fork of ReactFlux)             | Web / Next.js                               | Permanent 3-pane desktop layout (`ReadingLayout.jsx`, inspected in [`NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md)).         | Persistent selection with co-visible sidebar, list, and reader columns.      | Always-mounted reader column; displays empty state when no article is selected.             | No reader close transition on wide desktop because the third pane is permanent.                       | At intermediate desktop widths (`1024px–1280px`), co-visible columns compress the reader pane width.     |
| **Reeder 5 / Reeder Classic** (Silvio Rizzi) | macOS & iOS                                 | Configurable 1-, 2-, or 3-pane layout depending on user preference and viewport width.                                                              | Persistent selection with keyboard arrow traversal.                          | In-place load in 3-pane mode; view transition in 1- or 2-pane mode.                         | Toggle control hides/shows sidebar or list; Escape or swipe-back returns to list in single-pane mode. | Adaptively folds from 3 panes to 2 panes and 1 pane as window width decreases.                           |
| **Feedbin**                                  | Web (Rails / Turbo / JS)                    | User-selectable 2-pane (Feeds + List) or 3-pane (Feeds + List + Reader) layout.                                                                     | Selection updates route/state and loads reader.                              | In 2-pane mode, reader overlays or replaces list; in 3-pane mode, loads in right-hand pane. | Close control / Escape returns to list in 2-pane mode or clears selection in 3-pane mode.             | Enforces column minimum widths and drops from 3 panes to fewer panes on narrower viewports.              |

### Architectural Takeaways for NewsFlux

1. **High-Density Three-Pane Trade-Off (`REFERENCE_OBSERVATION`):** Permanent three-pane desktop layouts (such as Nextflux's `ReadingLayout.jsx`, previously rejected in [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md)) create a reader-width compression trade-off at intermediate desktop widths (`993px–1366px`). Allocating `240px` to the sidebar and `300px–360px` to the article list leaves `424px–680px` for the reader pane—compressing the `75ch` (`794px`) reader frame for wide code blocks, tables, and media, and crowding or compressing the `56.25ch` (`595px`) prose measure.
2. **Editorial Reading Priority:** Like Apple News, NewsFlux prioritizes reading ergonomics, bounded prose measure (`READER-MEASURE-01`), aligned quiet headers (`READER-VISUAL-02A2`), and opaque OLED-aware content surfaces over permanent three-column density.
3. **Power-Triage vs. Long-Form Ergonomics:** NetNewsWire's macOS three-pane split optimizes rapid headline scanning across three permanent panes. NewsFlux already supports in-reader keyboard triage (`j`/`k`, `n`/`p`, `Space`) without sacrificing full-pane reading comfort, meaning a multi-pane split is an optional wide-screen convenience rather than a baseline requirement.
4. **Adaptive Folding Requirement:** Any future optional multi-pane layout would need to fold back to single-pane whenever effective viewport width drops below the threshold (including under browser zoom).

---

## 4. Viewport Classification & Threshold Study

This section explicitly separates **measured current NewsFlux geometry** (`MEASURED_CURRENT_GEOMETRY`) from **engineering estimates for a hypothetical future multi-pane layout** (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`). Thresholds derived below are engineering estimates grounded in measured reader geometry, not absolute layout invariants.

### 4.1 Measured Current Geometry (`MEASURED_CURRENT_GEOMETRY` & `CODE_VERIFIED`)

From [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md) and current layout stylesheets:

1. **Navigation Widths (`CODE_VERIFIED`):**
   - Desktop Sidebar (`W_side` at `DESKTOP >= 993px`): **`240px`** expanded, `0px` collapsed ([`src/App.jsx`](../src/App.jsx#L33)).
   - Medium Navigation Rail (`MEDIUM`, `600px–992px`): **`80px`** while viewing lists, `0px` while the reader overlay is open ([`src/components/Navigation/MediumNavigation.css`](../src/components/Navigation/MediumNavigation.css)).
   - Compact Navigation (`COMPACT`, `<600px`): `0px` side rail; bottom navigation bar with `≥48px` targets.
2. **Article List Geometry Constants (`CODE_VERIFIED`):**
   - `.article-list-container` inline padding: `10px` left + `10px` right = **`20px`** ([`src/components/Article/ArticleList.css`](../src/components/Article/ArticleList.css#L5)).
   - Card grid minimum cell width: `CARD_GRID_MIN_WIDTH = 300px` ([`src/hooks/useArticleListLayout.js`](../src/hooks/useArticleListLayout.js#L5)).
3. **Reader Padding, Frame, and Prose Geometry (`CODE_VERIFIED` & `MEASURED_CURRENT_GEOMETRY`):**
   - `.article-content` inline padding: `8px 10px` (**`20px`** total inline padding above `480px`; `padding-inline: 0` at `<=480px` in [`src/components/Article/ArticleDetail.css`](../src/components/Article/ArticleDetail.css#L366)).
   - Non-overlay `.article-container` outer margin: `10px 10px 10px 0` ([`src/components/Content/Content.css`](../src/components/Content/Content.css#L9)).
   - Default typography settings ([`src/utils/settings-options.js`](../src/utils/settings-options.js)): `fontSize = 1.05rem` (`16.8px` at `16px` root), `articleWidth = 75` (range `50–100`).
   - **Measured single-pane reader widths at default settings (`articleWidth=75`, recorded in [`docs/NEWSFLUX_READER_VISUAL_01.md`](./NEWSFLUX_READER_VISUAL_01.md)):**
     - `390×844`: Prose = **`351px`** (`~43 cpl`); Reader Frame = **`351px`** (`90%` phone frame).
     - `768×1024`: Prose = **`595px`** (`~73 cpl`); Reader Frame = **`673px`**.
     - `884×1104` (Critical Fold/tablet viewport): Prose = **`595px`** (`~73 cpl`); Reader Frame = **`794px`**.
     - `1024×768` (with `240px` sidebar, leaving `784px` for `.main` and `764px` inside `.article-content` after `20px` inline padding): Prose = **`595px`** (`~73 cpl`); Reader Frame = **`764px`** (container-constrained `30px` below the unconstrained `794px` of `75ch`).
     - `1280×800` and `1440×900` (with `240px` sidebar): Prose = **`595px`** (`~73 cpl`); Reader Frame = **`794px`** (unconstrained `75ch` frame).

### 4.2 Engineering Estimates for Future Multi-Pane (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`)

To evaluate candidate wide-desktop thresholds without conflating the **reader frame** and the **prose measure**, we combine `MEASURED_CURRENT_GEOMETRY` with explicit engineering estimates:

1. **Desktop Sidebar (`W_side` — `MEASURED_CURRENT_GEOMETRY`):** **`240px`** (assuming standard expanded sidebar).
2. **Proposed Article List Pane (`W_list` — `ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`):**
   - **`360px` (Constrained Floor Estimate):** `300px` (`CARD_GRID_MIN_WIDTH`) + `20px` list container padding + `40px` card internal padding/border allowance. Narrower list widths increase multi-line wrapping of titles, summaries, and source/date metadata (`ENGINEERING_ESTIMATE`; exact truncation/wrapping across locales `NEEDS_MEASUREMENT`).
   - **`380px` (Aggressive Candidate Estimate):** Provides a `360px` card box inside `20px` container padding for single-column list triage.
   - **`420px` (Conservative Candidate Estimate):** Provides a `400px` card box inside `20px` container padding for comfortable headline, summary, and source-mark presentation.
3. **Proposed Reader Pane (`W_reader` — `ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`):**
   - Inline reader gutters (`G_reader`): **`20px`** minimum (`.article-content` inline padding) to **`~26px–60px`** (accounting for pane separator border, `10px` right container margin, and scrollbar/breathing room).
   - **Expected Multi-Pane Behavior Across `articleWidth` Settings (`50` / `75` / `100`):**
     - **`articleWidth = 50`:**
       - **Reader Frame:** `50ch` (`≈529px` at the measured `794px / 75ch ≈ 10.59px/ch` scale).
       - **Prose Measure:** `40ch` floor (`≈424px`).
       - **Behavior:** Fits without frame or prose compression in any reader pane `≥560px` (`529px` frame + `31px` gutters).
     - **`articleWidth = 75` (Default):**
       - **Reader Frame:** `75ch` (**`794px`** `MEASURED_CURRENT_GEOMETRY`).
       - **Prose Measure:** `56.25ch` (**`595px`** `MEASURED_CURRENT_GEOMETRY`, `≈73 cpl`).
       - **Behavior:**
         - In a `640px–800px` reader pane, the **`595px` prose measure** still fits without shrinking (`max-width: min(100%, var(--reader-prose-measure))`), just as `1024×768` single-pane constrains the outer frame to `764px` while keeping prose at `595px`. However, the **`794px` reader frame** for wide media, tables, and code blocks is compressed to `620px–780px`, and horizontal margins around prose narrow to `22px–102px` total.
         - At **`W_reader = 820px`** (`794px` measured `75ch` frame + `20px` `.article-content` padding + `6px` border/gutter allowance), **both** the full `794px` (`75ch`) reader frame and the `595px` (`56.25ch`) prose measure fit unconstrained, with `~112px` of symmetric whitespace on each side of the prose column.
         - At **`W_reader = 940px`**, the `794px` (`75ch`) reader frame sits inside `~146px` of total horizontal breathing room (`~73px` per side outside the frame, `~172px` per side around the `595px` prose column).
     - **`articleWidth = 100`:**
       - **Reader Frame:** `100ch` (`≈1059px` unconstrained maximum for wide media, tables, and code blocks).
       - **Prose Measure:** Capped at **`58ch`** (`≈614px`) by `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)`.
       - **Behavior:** Existing NewsFlux layout rules constrain `.article-header` and `.article-body` to the available reader container width (`width: 100%` on `.article-container`), so a multi-pane reader does **not** need to allocate the entire unconstrained `100ch` (`≈1059px`) frame before activating. At `W_reader = 820px` (`1440px` viewport) or `W_reader = 940px` (`1600px` viewport), `articleWidth = 100` renders its full **`58ch` (`≈614px`) prose cap** with comfortable margins, while its media/table/code frame expands to the available reader content width (`~800px` or `~910px–920px`) and reaches the full unconstrained `100ch` (`≈1059px`) frame on wider displays (`≥1680px–1920px`).

### 4.3 Candidate Multi-Pane Width Arithmetic (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`)

$$\text{Estimated Viewport Width } (W_{\text{est}}) = W_{\text{side}} + W_{\text{list}} + W_{\text{reader}}$$

- **Prose-Only Survival Estimate (`1240px–1280px` — Not Recommended as Candidate Threshold):**
  $$W_{\text{est}} = 240\text{px (Sidebar)} + 360\text{px (List)} + (640\text{px–680px Reader}) = \mathbf{1240\text{px–1280px}}$$
  _(Preserves the `595px` default prose column with minimal `22px–42px` side gutters, but constrains the `794px` default `75ch` media/code frame by `134px–174px`.)_
- **Aggressive Engineering-Estimate Candidate (`1440px`):**
  $$W_{\text{est}} = 240\text{px (Sidebar)} + 380\text{px (List)} + 820\text{px (Reader)} = \mathbf{1440\text{px}}$$
  _(Accommodates `240px` sidebar + `380px` list + `820px` reader pane, preserving the full measured `794px` default `articleWidth=75` reader frame plus `26px` inline padding/gutters and centering the frozen `56.25ch` / `595px` prose column.)_
- **Conservative Engineering-Estimate Candidate (`1600px`):**
  $$W_{\text{est}} = 240\text{px (Sidebar)} + 420\text{px (List)} + 940\text{px (Reader)} = \mathbf{1600\text{px}}$$
  _(Accommodates `240px` sidebar + `420px` list + `940px` reader pane, preserving the `794px` `75ch` frame and `595px` `56.25ch` prose measure with `~146px` of outer frame margin, while also supporting the `58ch` / `≈614px` prose cap and wider media frames for `articleWidth = 85–100`.)_

---

### 4.4 Viewport Evaluation Matrix

| Viewport (W × H) | Viewport Category                          | Current Window Class | Available Width for List + Reader (`MEASURED_CURRENT_GEOMETRY`)                      | Reader Frame & Prose Result Under Hypothetical Multi-Pane (`ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`)                                                                                            | Multi-Pane Classification                 | Contract / Recommendation Status                                                                           |
| :--------------- | :----------------------------------------- | :------------------- | :----------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| **390 × 844**    | Compact phone viewport                     | `COMPACT`            | `390px` total (bottom navigation active)                                             | Not applicable; single-pane phone frame (`351px` measured prose & frame).                                                                                                                          | **`SINGLE_PANE_REQUIRED`**                | **Binding Contract** (Unchanged)                                                                           |
| **600 × 960**    | Small tablet / narrow Fold viewport        | `MEDIUM`             | $600 - 80\text{ (rail)} = 520\text{px}$                                              | With a `360px` list, only `160px` remains for reader (below `40ch` / `≈424px` prose floor).                                                                                                        | **`SINGLE_PANE_REQUIRED`**                | **Binding Contract** (Unchanged)                                                                           |
| **884 × 1104**   | Critical `884×1104` Fold/tablet viewport   | `MEDIUM`             | $884 - 80\text{ (rail)} = 804\text{px}$ (or $884 - 240 = 644\text{px}$ with sidebar) | With a `360px` list and `80px` rail, reader pane gets `444px` (`~424px` after padding, compressing default `595px` prose to the `40ch` floor and shrinking the `794px` frame by `370px`).          | **`SINGLE_PANE_REQUIRED`**                | **MANDATORY CONTRACT LOCK** (Protected single-pane; must not be reclassified without explicit PM sign-off) |
| **1024 × 768**   | Standard tablet landscape / compact laptop | `DESKTOP` (`≥993px`) | $1024 - 240 = 784\text{px}$                                                          | With a `360px` list, reader pane gets `424px` (`404px` after `20px` padding, falling below the `40ch` / `≈424px` prose floor and compressing the `764px` single-pane frame).                       | **`SINGLE_PANE_PREFERRED`**               | **Single-Pane Preferred** (Existing contract preserved)                                                    |
| **1280 × 720**   | Compact desktop / 720p laptop viewport     | `DESKTOP`            | $1280 - 240 = 1040\text{px}$                                                         | With a `360px` list, reader pane gets `680px` (`660px` after padding): preserves `595px` (`56.25ch`) default prose with tight `32px` side margins, but compresses the `794px` (`75ch`) frame.      | **`SINGLE_PANE_PREFERRED`**               | **Single-Pane Preferred** (Avoids reader-frame compression)                                                |
| **1440 × 900**   | Standard laptop / desktop viewport         | `DESKTOP`            | $1440 - 240 = 1200\text{px}$                                                         | With a `380px` list, reader pane gets `820px`: accommodates the full measured `794px` (`75ch`) reader frame + `26px` padding/gutters and centers the `595px` (`56.25ch`) prose measure.            | **`MULTIPANE_OPTIONAL_CANDIDATE`**        | **Aggressive Engineering-Estimate Candidate** (Opt-in only if authorized; `HOLD_PRODUCT_DECISION`)         |
| **1600 × 900**   | Wide 16:9 desktop viewport                 | `DESKTOP`            | $1600 - 240 = 1360\text{px}$                                                         | With a `420px` list, reader pane gets `940px`: preserves `794px` (`75ch`) frame + `~146px` outer margin, `595px` (`56.25ch`) default prose, and `58ch` (`≈614px`) prose cap at `articleWidth=100`. | **`MULTIPANE_STRONG_OPTIONAL_CANDIDATE`** | **Conservative Engineering-Estimate Candidate** (Opt-in only if authorized; `HOLD_PRODUCT_DECISION`)       |
| **1920 × 1080**  | Full HD 1080p wide desktop viewport        | `DESKTOP`            | $1920 - 240 = 1680\text{px}$                                                         | With a `440px` list, reader pane gets `1240px`: accommodates the full unconstrained `100ch` (`≈1059px`) frame at `articleWidth=100` and `58ch` (`≈614px`) prose cap with generous margins.         | **`MULTIPANE_STRONG_OPTIONAL_CANDIDATE`** | **Spacious Optional Candidate** (Opt-in only if authorized; `HOLD_PRODUCT_DECISION`)                       |

---

## 5. Architectural Constraints & System Dependencies

1. **Critical `884×1104` Fold/Tablet Protection Contract:**
   The `884×1104` viewport is NewsFlux's canonical medium boundary. Multi-pane layout must never activate at or below `884×1104`.
2. **`MAIN_REMOUNT_ON_WINDOW_CLASS_CHANGE=PROHIBITED`:**
   Resizing the window across breakpoints or window classes must not unmount or remount `<Main />` or reset application data stores (`dataState`, `contentState`).
3. **No Persistent Layout State Without PM Authorization:**
   Adding new keys to `localStorage` or `settingsState` (e.g. `desktopLayoutMode`) is prohibited during research and requires explicit PM architecture authorization.
4. **OLED & Dark Palette Contract:**
   Content surfaces (article cards, reader background) must remain **opaque** (`--nf-surface-content`, `--color-bg-1`). Glassmorphism is strictly confined to chrome (navigation rail, top header, floating action pill).
5. **Deterministic All/Unread Contract:**
   Unread sorting and pagination must remain strictly chronological and deterministic (`order: "published_at", direction: "desc"`).
6. **Touch Targets & Coarse Pointers:**
   All interactive targets must maintain `≥44px` (forms) and `≥48px` (navigation) when interacted with via coarse pointers. Compact density is restricted to fine pointers.

---

## 6. Comprehensive Interaction-State Analysis (A through T)

### A. Selected Entry as Transient UI State vs. URL State

- **Current Model (`CODE_VERIFIED`):** URL is the canonical source of truth (`/{path}/entry/:entryId`). Selecting an entry navigates to this URL; refreshing or deep-linking restores `activeContent`.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - Updating the URL on selection preserves deep linking and sharing.
  - However, rapid keyboard arrowing through many entries in a co-visible list could push numerous entries onto the browser history stack if every step uses `history.pushState`.
  - _Proposed Design Rule (`FUTURE_ACCEPTANCE_TARGET`):_ If multi-pane is ever implemented, rapid keyboard traversal in the list should use `history.replaceState` (or debounced URL commits), reserving `history.pushState` for explicit click activation or transitions from a list-only route.

### B. Browser Back Behavior

- **Current Model (`CODE_VERIFIED`):** In single-pane, pressing Back from `/{path}/entry/:entryId` returns to `/{path}`, closing the reader overlay and restoring focus to the list row.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - When list and reader are co-visible, users may expect Browser Back either to close/undock the reader pane or to return to the previously visited feed/category scope.
  - _Proposed Design Rule (`FUTURE_ACCEPTANCE_TARGET`):_ In Option A (single-pane default), Back semantics remain unambiguous. Under an optional preview/opt-in multi-pane mode (Option C/D), Back from an active entry route should return to the parent list route (`/{path}`), dismissing the reader pane rather than leaving an ambiguous blank column.

### C. Reader Close Semantics

- **Current Model (`CODE_VERIFIED`):** `ActionButtons` renders `<IconClose />`. Activating it calls `closeActiveContent()`, navigating to the base path and restoring focus to `[data-entry-id]`.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - In a co-visible layout, activating Close must have a deterministic outcome rather than leaving a permanently empty third pane.
  - _Proposed Design Rule (`FUTURE_ACCEPTANCE_TARGET`):_ Under Option C/D, Close dismisses the reader pane, returning the content area to the full-width list view and restoring focus to the active list item.

### D. Preserving Article-List Scroll Position

- **Current Model (`CODE_VERIFIED`):** Guaranteed by keeping `.entry-col` mounted with `inert` while the reader overlay is active.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - When both panes are visible simultaneously, the list scroll container remains live. Advancing articles via reader hotkeys (`j`/`k`, `n`/`p`) requires keeping the selected card visible via `scrollSelectedCardIntoView()` without conflicting with `virtua` list virtualization.

### E. Preserving Reader Scroll Position

- **Current Model (`CODE_VERIFIED`):** Switching articles resets reader scroll to `0`.
- **Multi-Pane Implication (`FUTURE_ACCEPTANCE_TARGET`):**
  - Resizing across a future multi-pane threshold (e.g. between `1650px` and `1300px`) must preserve the active article and avoid resetting the reader's scroll offset.

### F. Mark-Read Timing

- **Current Model (`CODE_VERIFIED`):** Controlled by `markReadBy` (`"view"`, `"scroll"`, `"manual"`). Under `"view"`, opening an entry marks it read immediately.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - In keyboard-driven list traversal, immediate mark-on-view would mark every traversed row read as the user arrows past it.
  - _Proposed Design Rule (`FUTURE_ACCEPTANCE_TARGET`):_ Any future co-visible keyboard traversal mode should consider a configurable dwell delay or explicit activation before committing `"view"` read mutations to Miniflux.

### G. Unread Mutation While Reader Visible

- **Current Model (`CODE_VERIFIED`):** Marking an entry read updates `unreadTotalState` and entry status in `contentState`.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - When viewing an Unread-filtered list alongside the reader, marking the currently open entry as read must not immediately remove the active row from under the user's focus/cursor. Instead, the row should update its visual read-state styling in place until the next list refresh or scope change (matching NewsFlux's existing in-session list stability).

### H. Home Editorial Projections & Story Candidate State

- **Current Model (`CODE_VERIFIED`):**
  - [`src/pages/Home.jsx`](../src/pages/Home.jsx) and [`src/components/Home/HomeEditorial.jsx`](../src/components/Home/HomeEditorial.jsx) render multi-column editorial sections (`HomeHighlights` and `HomeRecent`), with optional deterministic starred-profile personalization (`projectHomePersonalization`, Phase 2D V1).
  - Following PR #106, the local Story Candidate Ranking pipeline exists in `main` and production strictly as a **`DORMANT_OPTIONAL_CAPABILITY`** (`FUTURE_HOME_ONLY_BOUNDARY`): `VITE_STORY_CANDIDATE_RANKING` is disabled by default in [`src/components/Home/HomeRecent.jsx`](../src/components/Home/HomeRecent.jsx), and no `story-ranker` sidecar exists in production. `HomeRecent` continues to build its visible Recent section exclusively from `projectRecentEntries(entries, highlightIds)` and `recentIds`; candidate ranking does **not** currently reorder or replace the rendered Home projection.
- **Multi-Pane Implication (`ENGINEERING_ESTIMATE`):**
  - Home's multi-column editorial layout (`HomeHighlights` lead/secondary cards and `HomeRecent` multi-column card grid) is designed for a full content pane and would be compressed into a single narrow column inside a `380px–420px` list pane.
  - _Recommended Guardrail (`RECOMMENDED_GUARDRAIL` / `HOLD_PRODUCT_DECISION`):_ If multi-pane is ever authorized in the future, Home (`/`) should remain single-pane across all viewport widths, restricting any optional multi-pane layout to standard stream routes (`/all`, `/today`, `/starred`, `/history`, `/feed/:id`, `/category/:id`).

### I. All/Unread Chronology

- Co-visible lists must maintain strict chronological ordering (`published_at desc`). Advancing to the next unread article across feeds must keep the list synchronized with the active stream.

### J. Category & Feed Navigation

- Selecting a different feed or category in the `240px` sidebar while an article is open in a multi-pane reader requires deterministic route transitions: navigating to `/feed/:id` or `/category/:id` transitions the route to that scope's list (`activeContent` cleared until an entry in the new scope is selected).

### K. Medium Navigation Rail Interactions

- The `80px` Medium Navigation Rail (`WINDOW_CLASSES.MEDIUM`, `600px–992px`) serves tablet and Fold viewports (including `884×1104`) and remains strictly single-pane.

### L. Keyboard Tab / Arrow / Escape Behavior

- **Tab Traversal (`FUTURE_ACCEPTANCE_TARGET`):** Must follow a predictable DOM order (`Skip Link -> Sidebar -> List Header -> Active List Item -> Reader Actions -> Reader Content -> List Footer`).
- **Escape Semantics (`READER-KEY-01` Parity):**
  - Layered Escape must continue to close the topmost open popover/menu/lightbox first before dismissing the reader and restoring focus to `[data-entry-id]`.

### M. Screen-Reader Landmark Structure

- Co-visible panes require distinct accessible landmarks (`FUTURE_ACCEPTANCE_TARGET`):
  - `<nav>` (Sidebar navigation)
  - `<section aria-label="...">` (Article list region)
  - `<article>` (Reader content region)
- The selected entry card in the list should expose `aria-current="true"`.

### N. Resize Across Multi-Pane Threshold

- Resizing across a future multi-pane breakpoint (e.g. `1650px` to `1300px`) must transition cleanly between co-visible layout and single-pane overlay without unmounting `<Main />`, losing reader scroll position, or triggering `ResizeObserver` loop errors (`FUTURE_ACCEPTANCE_TARGET`).

### O. Coarse Pointer & Touch Desktops

- Touch-capable desktop and hybrid tablet/laptop viewports must preserve `≥44px` form and `≥48px` navigation hit targets (`CODE_VERIFIED` baseline from PR #107). Horizontal scrolling inside wide tables or code blocks must not trigger accidental article-swipe navigation.

### P. Fold / Tablet Accidental Activation

- Critical `884×1104` Fold/tablet and standard tablet viewports (`768×1024`, `1024×768`) are protected from multi-pane activation by both the single-pane default and the high minimum-width candidates (`≥1440px` / `≥1600px`).

### Q. Performance Cost of Simultaneously Mounted Panes

- **Unmeasured Overhead (`HYPOTHESIS` / `NEEDS_MEASUREMENT`):** In the current single-pane architecture, `.entry-col` remains mounted in the background with `inert` and `aria-hidden="true"`, allowing the browser to skip hit-testing and interaction work on the occluded list. Displaying the virtualized list and a rich reader DOM (`html-react-parser`, `littlefoot` footnotes, `plyr` media players, enclosures) as simultaneously visible, interactive scroll containers is hypothesized to increase layout, paint, and memory overhead (`HYPOTHESIS`; exact memory and frame-time delta `NEEDS_MEASUREMENT`).
- Any future implementation must be benchmarked against the proposed future implementation gates in Section 9.2.

### R. Data Fetching Duplication

- `fetchSingleEntry` must reuse entries already present in `contentState.get().entries` before issuing network requests (`FUTURE_ACCEPTANCE_TARGET`).

### S. Stale-Session Protection

- Background feed refresh (`refreshFeedData`) must reconcile unread counts without unmounting or resetting the active article in the reader pane.

### T. Interaction with Personalization & Future Story Boundaries

- Existing deterministic Home personalization (Phase 2D V1) is strictly confined to Home (`/`).
- The Story Candidate Ranking pipeline merged in PR #106 is a **`DORMANT_OPTIONAL_CAPABILITY`** (`VITE_STORY_CANDIDATE_RANKING` disabled by default; no `story-ranker` sidecar in production; `HomeRecent` continues to render `projectRecentEntries(...)` + `recentIds` without reordering) and establishes a **`FUTURE_HOME_ONLY_BOUNDARY`**.
- Standard feed, category, All, and Unread streams remain strictly chronological and unaffected by Home personalization or dormant Story candidate code.

---

## 7. Analysis of Candidate Options

### Option A: Keep Current Single-Content Pane (Sidebar + List OR Sidebar + Reader)

- **Description:** NewsFlux retains its current single-content-pane architecture across all desktop displays. Users view either the full article list or the full reader overlay.
- **Width Behavior:** On displays `≥993px`, `240px` Sidebar + full-width content pane. Within the reader, the user's `articleWidth` setting (`50ch–100ch`, default `75ch` measured at `794px`) defines the **reader frame** for media, tables, and code blocks, while prose uses the frozen `READER-MEASURE-01` formula `clamp(40ch, calc(var(--article-width) * 0.75ch), 58ch)` (`56.25ch ≈ 595px` at default `articleWidth=75`) centered with balanced negative space.
- **Navigation Model:** Discrete, predictable route transitions (`/{path}` and `/{path}/entry/:entryId`). Browser Back or Escape closes the reader and restores focus to `[data-entry-id]`.
- **Reader Model:** Distraction-free reading surface preserving the full reader frame, bounded prose measure, aligned `.article-header-column`, image lightbox, and footnotes.
- **Pros:**
  - Full alignment with NewsFlux's editorial direction and `READER-MEASURE-01` / `READER-VISUAL-02A2` contracts.
  - Zero reader-frame or prose-measure compression at any desktop width.
  - Complete protection for the critical `884×1104` Fold/tablet viewport and standard tablets/laptops.
  - Simple, verified accessibility model (single active content region, deterministic focus restoration, layered Escape).
  - Lowest rendering overhead (background list is `inert`) and zero upstream conflict with ReactFlux routing.
- **Cons:** Scanning headlines while an article remains open requires closing the reader or using in-reader next/previous shortcuts (`j`/`k`, `n`/`p`).
- **Accessibility Risk:** Low (`CODE_VERIFIED`).
- **Implementation Complexity:** None (current architecture).
- **Upstream Conflict Risk:** None.
- **Recommendation:** **CURRENT DEFAULT CONTRACT (RECOMMENDED TO MAINTAIN).**

---

### Option B: Permanent Three-Pane Desktop (Sidebar + Article List + Reader Always Active)

- **Description:** Automatically splits desktop (`≥993px` or `≥1280px`) into three permanent columns (`Sidebar 240px | Article List | Reader`).
- **Width Behavior:** Automatic switch across desktop widths.
- **Navigation Model:** Selecting a list row updates the right-hand reader pane in place; the reader pane is never closed.
- **Reader Model:** Permanently docked third column with an empty placeholder state when no entry is selected.
- **Pros:** Immediate co-visibility for rapid mouse-based headline scanning.
- **Cons:**
  - Reader-width compression trade-off at `993px–1366px`: compresses the `75ch` (`794px`) reader frame and narrows or compresses the `56.25ch` (`595px`) prose column.
  - Complicates Browser Back and Reader Close expectations.
  - Incompatible with Home's multi-column editorial layout.
  - Diverges from ReactFlux's route and overlay layout model.
- **Accessibility Risk:** High (simultaneous landmarks, complex focus cycling).
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** High.
- **Recommendation:** **NOT RECOMMENDED (Previously rejected in [`docs/NEWSFLUX_DESIGN_DIRECTION_V1.md`](./NEWSFLUX_DESIGN_DIRECTION_V1.md)).**

---

### Option C: Adaptive Preview Pane (Single-Pane Default, Docked Reader Above High Threshold)

- **Description:** NewsFlux remains single-pane when browsing lists. Above an aggressive (`≥1440px`) or conservative (`≥1600px`) threshold, opening an article docks the reader beside the list rather than covering it with a full-width overlay.
- **Width Behavior:** Single-pane below threshold; co-visible list + reader when `activeContent` is present above threshold.
- **Navigation Model:** Close button or Escape dismisses the docked reader pane and returns the list to full width.
- **Reader Model:** Allocates `≥820px` (at `1440px`) or `≥940px` (at `1600px`) to preserve the `794px` (`articleWidth=75`) reader frame and `595px` (`56.25ch`) prose measure.
- **Pros:** Preserves single-pane behavior on mobile, Fold/tablet (`884×1104`), and standard laptops (`1024px–1280px`) while utilizing wide desktop horizontal space when an article is open.
- **Cons:** Introduces responsive layout mode switching across the breakpoint, dual focus/scroll management, and layout reflow when opening/closing articles.
- **Accessibility Risk:** Medium.
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** Moderate to High.
- **Recommendation:** **Secondary future candidate (`HOLD_PRODUCT_DECISION`).**

---

### Option D: User-Opt-In Multi-Pane (Preference-Controlled, High-Width Gated)

- **Description:** Multi-pane is **never enabled by default**. If authorized in a future phase, it is exposed only as an explicit user opt-in setting and takes effect only when viewport width meets the conservative (`≥1600px`) or aggressive (`≥1440px`) threshold on non-Home stream routes.
- **Width Behavior:** Explicit user opt-in AND viewport width `≥1600px` (or `≥1440px`); automatically folds back to single-pane below the threshold or under high browser zoom.
- **Navigation Model:** 100% of users keep Option A (single-content pane) unless they explicitly opt in.
- **Reader Model:** Co-visible reader pane (`≥820px–940px`) preserving the `READER-MEASURE-01` frame and prose rules.
- **Pros:**
  - Preserves the single-pane editorial default across all viewports.
  - Prevents unexpected layout shifts for users who prefer centered single-pane reading on wide monitors.
  - Provides an opt-in workflow for wide-screen triage users if product management later authorizes it.
- **Cons:** Requires maintaining two desktop layout modes and authorizing a new preference setting.
- **Accessibility Risk:** Medium (when opted in).
- **Implementation Complexity:** High.
- **Upstream Conflict Risk:** Moderate to High.
- **Recommendation:** **Preferred future candidate if multi-pane is subsequently authorized (`HOLD_PRODUCT_DECISION`).**

---

## 8. Proposed Viewport Contract Summary

| Viewport Axis                              | Classification                        | Layout Behavior & Policy Status                                                                                     |
| :----------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------ |
| **Compact Phone (`390×844`)**              | `SINGLE_PANE_REQUIRED`                | **Binding Contract:** Bottom compact navigation + single content pane                                               |
| **Small Tablet / Narrow Fold (`600×960`)** | `SINGLE_PANE_REQUIRED`                | **Binding Contract:** Medium navigation rail + single content pane                                                  |
| **Critical Fold/Tablet (`884×1104`)**      | `SINGLE_PANE_REQUIRED`                | **MANDATORY CONTRACT LOCK:** Medium navigation rail + single content pane                                           |
| **Standard Tablet / Laptop (`1024×768`)**  | `SINGLE_PANE_PREFERRED`               | **Existing Contract:** `240px` sidebar + single content pane                                                        |
| **Compact Desktop (`1280×720`)**           | `SINGLE_PANE_PREFERRED`               | **Existing Contract:** `240px` sidebar + single content pane                                                        |
| **Standard Laptop / Desktop (`1440×900`)** | `MULTIPANE_OPTIONAL_CANDIDATE`        | **Aggressive Engineering-Estimate Candidate:** Single-pane default; opt-in candidate only (`HOLD_PRODUCT_DECISION`) |
| **Wide Desktop (`1600×900`)**              | `MULTIPANE_STRONG_OPTIONAL_CANDIDATE` | **Conservative Engineering-Estimate Candidate:** Single-pane default; opt-in candidate (`HOLD_PRODUCT_DECISION`)    |
| **Full HD Wide Desktop (`1920×1080`)**     | `MULTIPANE_STRONG_OPTIONAL_CANDIDATE` | **Spacious Optional Candidate:** Single-pane default; opt-in candidate (`HOLD_PRODUCT_DECISION`)                    |

---

## 9. Future Implementation & Performance Gates

> [!IMPORTANT]
> **PROPOSED FUTURE IMPLEMENTATION GATES (`FUTURE_ACCEPTANCE_TARGET`):**
> All pass/fail criteria in Sections 9.1 and 9.2 are **proposed future acceptance targets** for any later pull request if product management ever authorizes a multi-pane implementation. They are **not** measured benchmark results from the current docs-only study.

### 9.1 Proposed Accessibility Gates (`A11Y_GATE_DESIGN` — `FUTURE_ACCEPTANCE_TARGET`)

- [ ] **`GATE_A11Y_KEYBOARD_FLOW` (`FUTURE_ACCEPTANCE_TARGET`):** Keyboard Tab order must logically traverse `Sidebar -> List Controls -> Active Article Card -> Reader Actions -> Reader Body -> List Footer` without focus traps.
- [ ] **`GATE_A11Y_FOCUS_RESTORE` (`FUTURE_ACCEPTANCE_TARGET`):** Closing the reader or pressing Escape to dismiss the reader must restore focus deterministically to the corresponding `[data-entry-id]` element in the article list.
- [ ] **`GATE_A11Y_ESCAPE_SEMANTICS` (`FUTURE_ACCEPTANCE_TARGET`):** Preserve `READER-KEY-01` layered Escape semantics (closing open popovers/menus/lightbox first, then dismissing the reader or returning focus to the active list card without losing focus to `<body>`).
- [ ] **`GATE_A11Y_LANDMARKS` (`FUTURE_ACCEPTANCE_TARGET`):** Sidebar, Article List, and Reader must be exposed as distinct, labeled ARIA landmarks (`<nav>`, `<section>`, `<article>`).
- [ ] **`GATE_A11Y_SELECTION_ANNOUNCE` (`FUTURE_ACCEPTANCE_TARGET`):** The active article card in the co-visible list must expose `aria-current="true"` to assistive technologies.
- [ ] **`GATE_A11Y_ZOOM_REVERT` (`FUTURE_ACCEPTANCE_TARGET`):** At `200%` browser zoom, when effective CSS pixel width drops below the multi-pane threshold, the layout must fold back to single-pane without horizontal clipping or overlapping text.
- [ ] **`GATE_A11Y_COARSE_TARGETS` (`FUTURE_ACCEPTANCE_TARGET`):** On touch-capable desktop displays (`pointer: coarse`), interactive controls must maintain `≥44px` (forms) and `≥48px` (navigation) hit targets.

### 9.2 Proposed Performance & Rendering Gates (`PERFORMANCE_GATE_DESIGN` — `FUTURE_ACCEPTANCE_TARGET`)

- [ ] **`GATE_PERF_DOM_LIMIT` (`FUTURE_ACCEPTANCE_TARGET`):** Simultaneously mounted list and reader must keep list rows virtualized via `virtua` (targeting `<150` rendered list-item DOM nodes in the active scroll viewport).
- [ ] **`GATE_PERF_SCROLL_FPS` (`FUTURE_ACCEPTANCE_TARGET`):** Both list and reader scroll containers must sustain smooth `60fps` scrolling on baseline test hardware without main-thread contention.
- [ ] **`GATE_PERF_IMAGE_DECODING` (`FUTURE_ACCEPTANCE_TARGET`):** Reader images must preserve `loading="lazy"` and `decoding="async"` so article media loading does not block list scrolling or thumbnail rendering.
- [ ] **`GATE_PERF_RESIZE_STABILITY` (`FUTURE_ACCEPTANCE_TARGET`):** Resizing across the multi-pane threshold must not emit `ResizeObserver loop` errors or unmount/remount `<Main />` (`MAIN_REMOUNT_ON_WINDOW_CLASS_CHANGE=PROHIBITED`).
- [ ] **`GATE_PERF_NO_FETCH_DUPLICATION` (`FUTURE_ACCEPTANCE_TARGET`):** Selecting an article in multi-pane must reuse cached entry data in `contentState.entries` without issuing duplicate network fetches.
- [ ] **`GATE_PERF_MEMORY_LEAK_FREE` (`FUTURE_ACCEPTANCE_TARGET`):** Cycling through `100` article selections in multi-pane mode must pass Chrome DevTools Heap Snapshot inspection with zero detached reader DOM tree leaks.

---

## 10. Open Product Decisions (`HOLD_PRODUCT_DECISION`)

Because `NNW-05` is a research-only track, all product and architectural choices below remain held for explicit PM decision:

| Decision ID       | Summary                                                                           | Evidence & Architectural Findings                                                                                                                                                                                                                                                | Status                                                                                     |
| :---------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------- |
| **`OPD-NNW05-1`** | **Should NewsFlux remain single-pane by default on wide desktop?**                | Single-content-pane desktop (Option A) preserves the `READER-MEASURE-01` frame/prose contract, avoids upstream divergence, and supports keyboard triage via hotkeys.                                                                                                             | **`HOLD_PRODUCT_DECISION`** (Recommended: Maintain Option A single-pane default)           |
| **`OPD-NNW05-2`** | **If multi-pane is ever authorized, should activation be automatic or opt-in?**   | Automatic activation alters the reading environment for users who prefer centered single-pane reading on wide displays. User opt-in (Option D) is the preferred future candidate if multi-pane is subsequently authorized.                                                       | **`HOLD_PRODUCT_DECISION`** (Recommended: User opt-in preferred if authorized)             |
| **`OPD-NNW05-3`** | **Candidate width threshold: Aggressive (`1440px`) vs. Conservative (`1600px`)?** | `ENGINEERING_ESTIMATE_FOR_FUTURE_MULTIPANE`: `1440px` (`240px` sidebar + `380px` list + `820px` reader) fits the measured `794px` (`75ch`) frame and `595px` (`56.25ch`) prose; `1600px` (`420px` list + `940px` reader) adds margin and supports `articleWidth` up to `85–100`. | **`HOLD_PRODUCT_DECISION`** (Recommended: `1600px` conservative floor if authorized)       |
| **`OPD-NNW05-4`** | **Should Home (`/`) be excluded from any future multi-pane mode?**                | Home's multi-column editorial projection (`HomeHighlights` and `HomeRecent`) is designed for a full-width content pane rather than a `380px–420px` list column.                                                                                                                  | **`HOLD_PRODUCT_DECISION` / `RECOMMENDED_GUARDRAIL`** (Recommended: Keep Home single-pane) |

---

## 11. Upstream ReactFlux Conflict Surfaces & Runtime Risk Summary

### 11.1 Upstream ReactFlux Conflict Assessment (`CODE_VERIFIED`)

- **Upstream Remote:** `https://github.com/electh/ReactFlux.git` (local `upstream/main` ref at `f4dfd1c9999d1d72a1164d7fbbe08da972e4ab1b`; last integrated NewsFlux upstream baseline `3b2b08fb6036ef94f92a757ac6f3df889be8515c` via PR #85).
- **Conflict Surfaces:**
  1. **Route & Content Layering:** Upstream ReactFlux uses a single-content-pane route hierarchy with `.article-container-full-size` overlaying `.entry-col` in [`src/components/Content/Content.jsx`](../src/components/Content/Content.jsx). Replacing this with a permanent three-pane split would touch `src/App.jsx`, `src/routes.jsx`, `src/components/Content/Content.jsx`, and `src/components/Content/Content.css`, increasing merge friction during future selective upstream syncs.
  2. **Compatibility Advantage of Option A:** Maintaining NewsFlux's single-pane-first architecture (Option A) preserves structural parity with ReactFlux's core routing and content lifecycle.

### 11.2 Runtime Risk Clarification

- **Current Pull Request (`PR #110`):** Documentation-only (`docs/NNW05_MULTIPANE_REFERENCE_STUDY.md` and `docs/DESIGN_REFERENCES.md`). Modifies zero application, build, styling, or deployment files.
- **Future Multi-Pane Implementation (If Ever Authorized):** Carries non-trivial layout, focus, scroll-virtualization, and resize-stability risks that have **not** been runtime-evaluated in this study and would require passing all gates in Section 9 before merge.

```text
CURRENT_PR_RUNTIME_RISK=NONE / docs-only
FUTURE_MULTIPANE_RUNTIME_RISK=NOT EVALUATED (requires dedicated implementation gates)
```
