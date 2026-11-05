# QA-001: Reader close and sidebar control overlap

## Status

`RESOLVED_IN_EMULATION` in the QA-001 implementation candidate. The previous base reproduction and candidate regression evidence are recorded below. Physical Fold/iPhone, Safari/WebKit, and real-Miniflux behavior remain **unverified**; no physical-device approval is inferred.

## Base reproduction

The issue was reproduced on the exact base `5c890ce08fca69e7f0df376b50d2e31e7ab4d1b5` with a production build, Chromium touch emulation, and synthetic Miniflux. With the QA-001 assertions changed from expected-failure wrappers to ordinary assertions, all five affected scenarios failed:

- `QA-001-884` and `QA-001-939`: the close-button center hit returned `Open sidebar`.
- `F04-1` and `F02-2`: Playwright reported that `Open sidebar` intercepted the close-button click.
- `F04-3`: an actual center touchscreen tap left the route on `/all/entry/3` and the Reader visible.

At 884×1107, the close button measured 32×32 px at (24,20), while the sidebar trigger measured 48×48 px at (8,8). `elementFromPoint(40,36)` returned the sidebar trigger. The 48 px trigger’s higher stacking layer overlapped the close control because the sidebar trigger was absolutely positioned by the Content wrapper while the desktop-style action bar independently began its left group at the same corner.

## Correction in the candidate

In the 769–992 px range, `ReaderSidebarTrigger` is rendered as the first control in the Reader action bar’s left group. That group owns the trigger and close control in normal flex flow, preserving their separate button targets and spacing. At 768 px and below the trigger keeps its existing separate top-left placement. At 993 px and above it remains absent from the Reader. No global breakpoint, z-index, Reader scroll, navigation, or sidebar state behavior was changed.

## Candidate evidence

Focused Chromium run against the production build and synthetic Miniflux:

- 10/10 targeted scenarios passed: the seven existing coarse-pointer viewport scenarios, `F02-2`, `F04-1`, and `F04-3`.
- The 884×1107 scenario also exercises 768/769/992/993 while the Reader is open, verifies disjoint control hit regions, checks that the sidebar trigger remains reachable, tests Tab/Enter on Close article, and taps Close article after resizing back.
- Actual touchscreen taps closed the Reader at 769, 884, 939, and 992 px; mouse closure remains covered by the existing F04-2 regression.
- The scenario identities remain frozen at 46; QA-001’s five outcomes are changed to `PASSED` in scenario contract version 3. Three other scenarios remain `REQUIREMENT_PENDING`.

This focused result is emulated/synthetic evidence only. Full repository gates, GitHub CI, and independent QA review must pass before the candidate is considered ready for PM review. No real device was used.

## Historical options

The earlier investigation considered three approaches: integrating the trigger into the action bar, reserving space for the absolute trigger, or raising the close button’s z-index. Integration into the action bar was selected because it removes the competing layout ownership and preserves both controls’ hit regions; a z-index swap would only make the sidebar unreachable.
