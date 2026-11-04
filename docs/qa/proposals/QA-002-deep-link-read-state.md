# QA-002: should an article opened by a direct link be marked as read?

- **Status:** `REQUIREMENT_PENDING`. It is **not** a confirmed regression.
- **Documenting test:** `F06-3` in `e2e/reader-and-state.spec.js` asserts the proposed behavior and is recorded as a pending requirement.

## Current behavior

`markReadBy` defaults to `view`. The mark-as-read call lives in `handleEntryClick` (`src/components/Content/ContentContext.jsx`), which runs when a card is clicked or the reader moves with the keyboard. A reader opened through its URL (a shared link, a reload, relaunching the installed PWA on `/all/entry/N`) loads the entry in `fetchSingleEntry` (`src/components/Content/Content.jsx`) and does not mark it. In the e2e run, `/all/entry/14` stayed unread on the server after 3 seconds; opening a card or pressing `j` marks the entry.

## Question for the owner

When the setting is `view`, does "viewed" mean only entries opened from the list, or also any entry that is actually displayed?

## Proposal (recommended: mark when displayed)

- With `markReadBy = view`, an entry loaded by direct link is marked as read **once its content is displayed** (not while loading and not if loading fails), using the same optimistic update and error message as `handleEntryClick`.
- With `markReadBy = manually`, nothing changes.
- An entry that is already read is not touched, and an entry the user explicitly marked unread in the same session is not re-marked by a re-render.

Why: the PWA relaunches into the last article, so users read an article that stays "unread" in the list and in the counters.

Alternative: keep the current behavior and document that deep links never mark as read. Safer for shared links opened for a glance.

## Acceptance criteria if approved

1. `F06-3` stops being a pending requirement: the marker is removed and the test asserts the server marks the entry once displayed.
2. A failed fetch (404, 500) marks nothing.
3. `F06-1` (click path) and `F06-2` (toggle consistency) are unchanged and pass.
4. `markReadBy = manually` leaves the entry unread (new negative test).

## Risks

A second mark path can double-mark: the change must share the existing deduplicating helper and be covered by a test that opens an entry by click and by link in the same session.
