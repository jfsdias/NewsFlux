# QA-003: preserve loaded articles after a failed Refresh

- **Status:** approved by the product owner and implemented in QA-003.
- **Scenario:** `F12-10b` is an ordinary `PASSED` scenario in E2E scenario contract version 5. The frozen inventory retains all 46 scenario identities; the only remaining pending requirement is QA-004 (`F15-4`).

## Approved behavior

When a non-Home article list has a successfully committed snapshot for the current account session and query:

- Keep the entries, their visible order, total, and pagination metadata while Refresh is pending.
- On a failed refresh, retain that snapshot and show a localized, nonblocking status with a keyboard-operable Retry action.
- Do not move focus when the refresh response arrives.
- A successful Retry replaces the snapshot and removes the stale-status message.
- A first-load failure remains blocking and offers Retry without displaying an older snapshot.
- A snapshot never crosses a session, source, feed, category, search, date filter, read status, ordering, or page-size boundary.
- Home continues to use its existing independent committed-session behavior.
- Snapshot preservation is in-memory only. It does not make provider writes and does not change existing optimistic mutation and rollback behavior.

## Validation

`F12-10b` holds a synthetic refresh response while checking the existing cards and their order, returns HTTP 500, checks the `role="status"` warning and absence of a blocking alert, verifies keyboard Retry, then supplies a newer entry and verifies successful replacement. Synthetic request and mutation ledgers verify that preservation itself issues no writes.

The emulated/synthetic evidence does not claim physical-device, Safari/WebKit, installed-PWA, or real-Miniflux validation.
