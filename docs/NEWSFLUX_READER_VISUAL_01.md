# READER-VISUAL-01 — Long-form reading ergonomics

- **Status:** design candidate, not merged. Branch `claude/reader-visual-01-reading-ergonomics`, based on the pre-R2 Phase 2D candidate `2f75fe3`, independent of HOME-VISUAL-01. Not eligible for a PR as-is; reapply onto `main` after Phase 2D merges and rerun every gate.
- **Approved:** 2026-10-14 by the product owner, including the Article-width-as-frame model.
- **Critical viewport:** 884 × 1104.

## Problem

The reader filled its whole width with prose. At the default settings the text column measured 794 px at 884 px and wider (about 98 characters per line), 673 px at 768 px (about 83) and 764 px at 1024 px with the sidebar. Images always shared the prose width, portrait images rendered taller than the viewport, and the title (28 px, weight 500) sat in a header narrower than the text below it.

## Reader model

The existing **Article width** setting (`articleWidth`, 50–100, default 75; stored value, label, range and persistence unchanged) is now the **reader frame**:

| Surface                                                                                         | Width                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Prose: `p`, lists, `dl`, blockquotes, headings, `hr`                                            | 75% of Article width in `ch` at the reader font size, never wider than the frame. Default 56ch ≈ 595 px ≈ 73 characters per line. |
| Media and technical surfaces: images, figures and captions, iframes, video, code blocks, tables | The frame (the existing inline `max-width`: `articleWidth` ch above 768 px, 90% at or below).                                     |
| Paragraphs that contain media                                                                   | The frame, so an image inside a `<p>` is not narrowed.                                                                            |
| Nested blocks (inside list items, table cells, blockquotes, figures)                            | Unchanged; they follow their parent.                                                                                              |

The prose measure is a registered custom property (`@property --reader-prose-measure`, `<length>`), computed once on `.article-body`, so headings inside the article share the paragraph column even though their font is larger. If the computation ever fails, the fallback is "no narrowing" (the frame width), never a collapsed column. Browsers without `:has()` keep image paragraphs at prose width.

## Typography and rhythm

| Element          | Treatment                                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title            | 24 px / 1.25 (reader < 600 px), 32 px / 1.2 (600–959 px), 36 px / 1.15 (≥ 960 px); weight 600; `text-wrap: balance`. Tiers come from a container query on `.article-content`, so the sidebar at 1024 px is accounted for. Font family and alignment settings unchanged. |
| Body             | Font family and size settings unchanged; line height 1.8 → 1.7.                                                                                                                                                                                                         |
| In-article h2–h4 | 1.6em above, 0.5em below, line height 1.3.                                                                                                                                                                                                                              |
| Tall images      | `max-height: 80vh` with `object-fit: contain`; the layout box keeps its size (no reflow, no distortion). Table-cell images are exempt.                                                                                                                                  |
| Phone gutters    | At ≤ 480 px the reader's 10 px inline padding is removed: text 333 → 351 px at 390 px.                                                                                                                                                                                  |

## Measured result (default settings, real app with local fixtures; dark identical)

| Viewport             | Prose before     | Prose after      | Frame (media) | Title before → after |
| -------------------- | ---------------- | ---------------- | ------------- | -------------------- |
| 390 × 844            | 333 px (~41 cpl) | 351 px (~43 cpl) | 351 px        | 28 → 24 px           |
| 768 × 1024           | 673 px (~83 cpl) | 595 px (~73 cpl) | 673 px        | 28 → 32 px           |
| 884 × 1104           | 794 px (~98 cpl) | 595 px (~73 cpl) | 794 px        | 28 → 32 px           |
| 1024 × 768 (sidebar) | 764 px (~94 cpl) | 595 px (~73 cpl) | 764 px        | 28 → 32 px           |
| 1280 × 800           | 794 px (~98 cpl) | 595 px (~73 cpl) | 794 px        | 28 → 36 px           |
| 1440 × 900           | 794 px (~98 cpl) | 595 px (~73 cpl) | 794 px        | 28 → 36 px           |

Portrait 600 × 1000 image, visible height: unchanged at 390 (585 px, under the cap); capped to 80vh elsewhere (819 px at 768 × 1024, 614 px at 1024 × 768).

Article width control at 884 px and wider: 50 → 397 px prose (about 48 cpl, frame 530 px), 75 → 595 px, 100 → 794 px (frame 1059 px). At 768 px: 397 / 595 / 673 px (capped by the 90% frame). At 390 px the setting has no effect, as before, because the phone frame is a fixed 90%. The control stays monotonic.

## Validation

`scripts/tests/phase2c-editorial-home.jsx`, suite `reader-visual-01-reading-ergonomics`, fixtures `readerFixtures`: short, long-form with code, table, iframe, list and quote, long headline, wide image with figure and caption, portrait image, no image; plus Article width 50 / 75 / 100 and scrolling under the glass chrome. Every case checks: no user-visible horizontal overflow, opaque single-pane reader (list inert), every prose block at the expected measure and centred, title axis aligned with the prose axis, media and technical surfaces inside the frame (code, table and iframe at the full frame width), wide image and figure caption at the frame, portrait image within 80vh, the title tier for the reader width, and the reader chrome staying pinned with content passing under its glass.

Run it with the dev server: open `/scripts/tests/phase2c-editorial-home.html` and select "Run READER-VISUAL-01 reading ergonomics cases", or "Run all scenarios at this viewport and theme".

`REAL_DEVICE_GATE` remains pending: long-form comfort, OLED contrast and the 884 × 1104 Fold composition need review on real hardware.

## Pending and incidental findings (not fixed here)

- **Edge-to-edge phone images (pre-existing):** at ≤ 768 px the image scale is computed from the `--article-width` number (for example 133%) while the phone frame is a fixed 90%. With "Edge-to-edge images" on, images can be cropped. The transparent zoom overlay (`.image-overlay-button`) also gets that oversized width even with the setting off; the reader clips it (`overflow-x: hidden`), so nothing visible scrolls, but the scroll container reports hidden overflow (37 px on `2f75fe3`, 39 px now at 390 px).
- **Iframes (pre-existing):** `width: 100%` plus the browser's default 2 px border makes embeds 4 px wider than the frame.
- **Article width 50:** prose follows the approved 75% rule and becomes about 48 characters per line. If that proves too narrow in use, a floor (prose never narrower than the frame or 56ch, whichever is smaller) is a CSS-only follow-up.
- **Phone:** the Article width setting still has no effect at ≤ 768 px (fixed 90% frame, existing JS).
- **Feeds that wrap text in `div`/`section` without block elements** keep the frame width for that text.
- **Title alignment setting "left":** the title box (header, about 662 px at default) is wider than the prose column (595 px), so a left-aligned title starts about 33 px outside the prose edge (previously 66 px). The default centred alignment shares one axis.
- **Harness flake (pre-existing):** `HOME_ROUTE_ROOT_AND_READER_RETURN` can fail on the first run after page load ("Root did not render Home"); it asserts synchronously after a lazy route mount. It failed once in the 12-pair regression run here and at the same rate on `2f75fe3` in an earlier interleaved A/B.
- **Merge:** this branch and HOME-VISUAL-01 both extend the same harness (suite list, matrix gates, fixtures). The conflict is mechanical; integration must keep both sets of cases.
