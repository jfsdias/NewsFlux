# QA-001: "Close article" is covered by "Open sidebar" in the reader header with a coarse pointer

- **Status:** `KNOWN_DEFECT` reproduced in emulation; physical Fold8/iPhone Duo confirmation **pending**. The correction needs separate scope approval.
- **Regression tests (already in the repository, currently recorded as known defects):** `F02-2`, `F04-1`, `F04-3`, `QA-001-884`, `QA-001-939` in `e2e/`. Guard cases at 466, 597, 704, 1024 and 1440 px pass today and must keep passing.

## What happens

With a coarse pointer (touch) and a viewport width between 769 and 992 px, the reader header shows two buttons at the same position: the "Open sidebar" trigger and "Close article". `elementFromPoint` at the center of "Close article" returns "Open sidebar" (0 of 5 test points reach "Close article"), and a tap opens the sidebar instead of closing the article. With a mouse the overlap is small and "Close article" works. Reproduced at 884x1107 and 939x1271; not reproduced at 466, 597, 704, 1024 and 1440 px. The viewports are estimates derived from the official physical resolutions and assumed pixel ratios, except 884x1104, which the project documents as its critical viewport.

## Likely cause (supported by code, not yet proven on a device)

Two independent breakpoint decisions disagree in the 769-992 px band:

- `ReaderSidebarTrigger` (`src/components/Article/SidebarTrigger.jsx`) renders when `useWindowClass()` says Compact or Medium, which is below 993 px, and `.reader-sidebar-trigger-wrapper` is absolutely positioned at the top-left (`SidebarTrigger.css`). Under `@media (any-pointer: coarse)` the button grows to at least 48x48.
- `ActionButtons` (`src/components/Article/ActionButtons.jsx`) switches to its compact "mobile" layout with `useScreenWidth().isBelowMedium`, which is 768 px or less. From 769 px it uses the wider layout whose left group also starts at the top-left, with no space reserved for the trigger.

## Narrow correction options (no change to global breakpoints)

| Option              | Change                                                                                                                                                                           | Layout position                                   | Stacking                                                                                       | Touch hit-testing                   | Risk                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| **A (recommended)** | In the 769-992 px band render the sidebar trigger as the first control of the action bar's left group instead of an absolutely positioned wrapper.                               | Removes the overlap by construction.              | No competing layers.                                                                           | Each button keeps its own hit area. | Low to medium: touches two components, but only in that band. |
| B                   | Keep the absolute trigger and reserve its width in the action bar (`padding-inline-start` of the left group) only when the trigger is shown and the bar is not in mobile layout. | Shifts the action bar right by the trigger width. | Unchanged.                                                                                     | Unchanged.                          | Low, but the reserved width must track the 48 px touch size.  |
| C                   | Raise the z-index of "Close article".                                                                                                                                            | Unchanged.                                        | Fixes this report but only swaps which button is covered ("Open sidebar" becomes unreachable). | Worse.                              | Not recommended.                                              |

Changing the global breakpoints (unifying `useWindowClass` and `useScreenWidth`) is a separate, larger decision and is **not** proposed here.

## Acceptance criteria

1. In every viewport of `e2e/qa-001-reader-header.spec.js`, with touch, "Close article" receives the pointer at its own center and "Open sidebar" remains reachable.
2. `F02-2`, `F04-1`, `F04-3`, `QA-001-884` and `QA-001-939` stop being known defects: their markers are removed in the same change, and `docs/qa/FINDINGS_REGISTER.md` is updated.
3. No change at 466, 597, 704, 1024 and 1440 px, and the existing real-browser gates still pass.
4. **Physical confirmation** on a Fold8 and an iPhone Duo (open and closed) before and after the fix, with `innerWidth`, `devicePixelRatio`, browser and version recorded.

## Out of scope

Dual-pane reader (in HOLD), the global breakpoint model, and any visual redesign.
