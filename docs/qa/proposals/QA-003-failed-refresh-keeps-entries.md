# QA-003: should a failed Refresh keep the entries that are already loaded?

- **Status:** `REQUIREMENT_PENDING` (and a `KNOWN_LIMITATION` today).
- **Documenting test:** `F12-10b` in `e2e/resilience.spec.js` asserts the proposed behavior and is recorded as a pending requirement. `F12-10` (error is signaled and Retry recovers) passes today.

## Current behavior

When Refresh fails (connection loss or an HTTP 500) the list that was on screen is replaced by an error panel with "Failed to load articles" and a Retry button (`src/components/Article/ArticleList.jsx`). Retry recovers. In the e2e run the card count went from 4 visible cards to 0.

## Question for the owner

On a transient failure, is a blocking error that hides the list acceptable, or should the reader keep what was already loaded?

## Proposal (recommended: keep entries, show a nonblocking message)

- If entries are already loaded and a refresh fails, keep them rendered and show a nonblocking status message ("Could not refresh. Showing the articles already loaded.") with a Retry action. Use `role="status"` so it is announced without taking focus.
- If nothing is loaded yet (the first load), keep today's blocking error panel with Retry.
- The message disappears after a successful refresh.
- No new persistent storage: only the in-memory list that the page already holds is kept, consistent with the PWA principle that the app does not cache account data.

Alternative: keep today's behavior. It is simpler and always consistent with the server, at the cost of losing reading context on a flaky connection.

## Acceptance criteria if approved

1. `F12-10b` stops being a pending requirement: the marker is removed and the loaded cards remain after a failed refresh, with the status message visible.
2. `F12-1` to `F12-4` and `F12-11` (first-load failures) still show the blocking error and Retry.
3. After a successful Retry the message is gone and the list is current.
4. Accessibility check: the message is exposed with `role="status"` and the Retry control is reachable by keyboard.

## Risks

A stale list can lead to acting on outdated entries (for example marking an entry that no longer exists). The mutation paths already handle server rejections; the change must keep that behavior.
