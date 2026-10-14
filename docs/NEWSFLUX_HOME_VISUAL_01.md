# HOME-VISUAL-01 — Primary editorial dominance

- **Status:** design candidate, not merged. Branch `claude/home-visual-01-primary-hierarchy`, based on the pre-R2 Phase 2D candidate `2f75fe3`. Not eligible for a PR as-is; reapply onto `main` after Phase 2D merges and rerun every gate.
- **Approved:** 2026-10-14 (design gate approved by product owner, including the scoped 4:3 Secondary thumbnail exception).
- **Critical viewport:** 884 × 1104.

## Problem

Deployed runtime showed the Home Primary losing to its Secondaries. At 884 × 1104 a text-only Primary measured about 860 × 161 while each image Secondary measured about 422 × 448; at 390 × 844 the Primary measured about 366 × 146 against a 366 × 407 Secondary. All three Highlights used the same Grid card, so the only thing marking the lead was its width.

## What changed

Presentation only, in `src/components/Home/HomeEditorial.css`, scoped to `.home-highlights`:

| Element                   | Treatment                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Width tiers               | A CSS container query on `.home-highlights` (`home-highlights`). Tiers follow the section width, not the viewport, because the desktop sidebar changes the available width. |
| Primary headline          | 24 px (< 600 px container), 28 px (600–959 px), 32 px (≥ 960 px); weight 700; four-line clamp instead of three; measure capped at 32em.                                     |
| Primary deck              | Body size (16 / 17 px), measure capped at 68ch. The existing two-line deck fitter still decides which deck appears.                                                         |
| Primary inset             | Block padding 20/12 → 24/16 → 28/20 px; inline margin 16 → 24 → 32 px by tier.                                                                                              |
| Primary with image        | < 600 px: existing stacked 16:9 cover. ≥ 600 px: image beside copy (52 / 48), image kept at 16:9.                                                                           |
| Secondaries with image    | Compact supporting row: copy first, 4:3 thumbnail at the inline end, `clamp(88px, 28%, 176px)` wide; 17 px headline with a four-line clamp; 14 px deck.                     |
| Secondaries without image | Existing card; headline 17 px.                                                                                                                                              |
| Highlights copy inset     | 16 px inline margin on every Highlights card, so text no longer touches the edge of image cards.                                                                            |

The inline inset is a margin, not padding, on purpose. The existing deck fitter in `ArticleGridCard` sizes its measurement probe from the copy element's `clientWidth`, which includes padding but not margin. With padding, the fitter measured a wider column than it rendered, and decks were cut with an ellipsis. With margin, it measures what it renders. Text-only Recent cards still use padding and keep that pre-existing mismatch (see Pending).

Recent, the shared Grid card component, list layouts, selection, ranking, personalization, session, explainer, reader, navigation and APIs are unchanged.

### Scoped exception to the design direction

`NEWSFLUX_DESIGN_DIRECTION_V1` keeps a 16:9 editorial frame. HOME-VISUAL-01 keeps it for the Primary. Secondary Highlight thumbnails use 4:3 as an explicitly approved, scoped exception. Recent cards and the general card image contract stay 16:9, and the existing cover/contain rule for extreme ratios is unchanged.

## Reference products and how they apply

| Reference                                            | Used in this package                                                                                   | Left for later                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Apple News (Today, Saved Stories)                    | Lead-story hierarchy: one dominant headline, supporting stories as compact rows with small thumbnails. | Saved Stories as an explicit destination for saved content.                                                           |
| NetNewsWire (Today, All Unread, Starred smart feeds) | Clear information density in supporting rows; no three-pane layout.                                    | Smart-feed clarity in navigation (NAV-02); renderer themes.                                                           |
| Fusion                                               | —                                                                                                      | Bookmarks, shortcuts, URL-backed article state without losing list context.                                           |
| Feedly (Read Later vs Boards)                        | —                                                                                                      | Separate personal queue (Later) from permanent collections; save by swipe; Today/All/Later shortcuts.                 |
| Inoreader (Saved library, per-scope layouts)         | —                                                                                                      | Saved as a library of tags and kept content; per-feed/folder/tag layouts.                                             |
| NewsBlur                                             | —                                                                                                      | Per-feed layout and density, story clustering, Saved Stories + tags, user-controlled relevance filters (later stage). |
| Reeder                                               | —                                                                                                      | Unified timeline with synchronized Links, Favorites, Bookmarks and Later.                                             |
| ReadKit                                              | —                                                                                                      | RSS + read-later, tags, folders and smart folders.                                                                    |
| Requested capability                                 | —                                                                                                      | Select several stories and mark them read.                                                                            |

## Measured result (light; dark geometry is identical)

Primary vs Secondary 1, before (`2f75fe3`) and after. Case A: text-only Primary, image Secondaries. Case B: all images. Case E: short text-only Primary, high-contrast Secondary images.

| Viewport | Case | Primary before                 | Secondary before             | Primary after                 | Secondary after              |
| -------- | ---- | ------------------------------ | ---------------------------- | ----------------------------- | ---------------------------- |
| 390×844  | A    | 366×176 (18px)                 | 366×383 (18px + 364×205 img) | 366×215 (24px)                | 366×175 (17px + 90×67 img)   |
| 390×844  | E    | 366×153 (18px)                 | 366×407 (18px + 364×205 img) | 366×185 (24px)                | 366×219 (17px + 90×67 img)   |
| 768×1024 | B    | 744×550 (18px + 742×417 img)   | 364×382 (18px + 362×204 img) | 744×239 (28px + 386×217 img)  | 364×175 (17px + 89×67 img)   |
| 884×1104 | A    | 860×138 (20px)                 | 422×398 (19px + 420×236 img) | 860×179 (28px)                | 422×176 (17px + 106×79 img)  |
| 884×1104 | B    | 860×622 (19px + 858×483 img)   | 422×398 (19px + 420×236 img) | 860×253 (28px + 446×251 img)  | 422×176 (17px + 106×79 img)  |
| 1024×768 | A    | 760×138 (20px)                 | 372×395 (19px + 370×208 img) | 760×179 (28px)                | 372×176 (17px + 92×69 img)   |
| 1440×900 | A    | 1176×138 (20px)                | 578×486 (19px + 576×324 img) | 1176×191 (32px)               | 578×154 (17px + 149×112 img) |
| 1440×900 | B    | 1176×800 (19px + 1174×660 img) | 578×486 (19px + 576×324 img) | 1176×345 (32px + 610×343 img) | 578×154 (17px + 149×112 img) |

Geometry is supporting evidence. The requirement is perceptual: the Primary must read as the lead from headline size, weight, position and composition. In case E at 390 the Secondaries remain slightly taller than the Primary (219 vs 185 px, because of four-line titles), but the 24 px Primary headline, its position and the small thumbnails keep it as the lead.

## Validation

Recorded in the candidate handoff and in `scripts/tests/phase2c-editorial-home.jsx` (suite `home-visual-01-primary-hierarchy`, cases A–E):

- **A:** text-only Primary, two image Secondaries.
- **B:** image Primary, two image Secondaries.
- **C:** all text-only.
- **D:** long text-only Primary title.
- **E:** short text-only Primary title, high-contrast Secondary images.

Each case checks the frozen selection (entry IDs and order), Primary spanning Highlights, no horizontal overflow, card content staying inside its card, no truncated deck, no truncated headline (except the deliberately long case D Primary, which keeps its four-line clamp), a Primary headline at least 4 px larger than each Secondary headline, 4:3 Secondary thumbnails no wider than half their card, and the 16:9 Primary frame. The full Phase 2C/2D harness runs at all six viewports in light and dark.

Run it with the dev server: open `/scripts/tests/phase2c-editorial-home.html`, choose a theme and select "Run HOME-VISUAL-01 Primary hierarchy cases" or "Run all scenarios at this viewport and theme".

`REAL_DEVICE_GATE` remains pending: the perceptual gates in the harness (`EDITORIAL_HIERARCHY_CLEAR`, `PRIMARY_NOT_OVERSIZED`, `SECONDARIES_BALANCED`, `TEXT_ONLY_PRIMARY_FEELS_INTENTIONAL`, `OLED_SURFACE_SEPARATION`) need review on real devices, including an open foldable at 884 × 1104 and an OLED panel.

## Pending

Out of scope for HOME-VISUAL-01 and still open (see the UX red-team audit, UXRT-xxx):

- Home loading skeleton still uses the previous Primary/Secondary shapes (small layout shift on first render).
- Text-only cards outside Highlights (Recent) keep the pre-existing deck-probe width mismatch: the deck fitter measures with padding included, so a deck can occasionally be cut with an ellipsis. Fixing it belongs in `ArticleGridCard` (measure the content box), not in Home CSS.
- Long Primary titles (case D) still clamp at four lines on phones, as they clamped at three before.
- Pre-existing harness flake: `HOME_ROUTE_ROOT_AND_READER_RETURN` sometimes fails on the first run after page load ("Root did not render Home"), because it asserts synchronously after a lazy route mount. Interleaved A/B on fresh pages showed the same rate on `2f75fe3` (6 of 27 first runs) and on this branch (5 of 27). It needs a wait in the harness, not a product change.
- Text-only Recent cards stretch to the height of image neighbours (UXRT-019).
- Explainer touch target is 28 px (UXRT-022).
- Home refresh and refresh on resume (UXRT-006); Home navigation item (UXRT-008); read-card lifetime on return (UXRT-011).
- NAV-02 reframe (UXRT-003/004/005/027), drawer width at 769–992 px.
- Search/filter state (UXRT-002), mark-all-read consistency (UXRT-001/012).
- Reader measure and mobile previous/next (UXRT-014/015).
- Accessibility baseline (UXRT-007/016/017); branding and issue routing (UXRT-023).
- Future product states from the references above: Later, Saved/Bookmarks, tags, multi-select mark-read. Each needs a storage and sync decision before implementation, per `NEWSFLUX_DESIGN_DIRECTION_V1`.
- Integration: after Phase 2D merges, reapply the HOME-VISUAL-01 commits onto `main` and rerun all gates.
