# QA-002: direct-link read-state consistency

- **Status:** `APPROVED_AND_IMPLEMENTED` by the product owner in the QA-002 implementation authorization.
- **Classification:** Resolved in emulated Chromium against the synthetic Miniflux; physical-device, WebKit and real-Miniflux behavior are not claimed.
- **Scenario:** `F06-3` is an ordinary `PASSED` scenario in E2E scenario contract version 4. The contract retains all 46 scenario identities.

## Behavior at the approved base

`markReadBy` defaults to `view`. The mark-as-read mutation ran from `handleEntryClick` when a card was opened or the reader moved with the keyboard. A direct route (including a reload or PWA reopen on `/all/entry/N`) fetched and displayed the article without marking it read. This was the QA-002 behavior approved for correction.

## Approved requirement

When `markReadBy = view`, mark a valid unread entry as read after the matching Reader route has rendered a visible article and the route and data session are still current. Reuse the existing optimistic status-mutation coordinator, count updates, error notification and rollback.

- `markReadBy = manually` does not auto-mark.
- Already-read entries do not produce a status mutation.
- A failed, missing, malformed or obsolete entry load does not produce a status mutation.
- A route transition or data-session change before display prevents the stale entry from being marked.
- The automatic action occurs once per Reader presentation. Re-renders and duplicate effects do not repeat it.
- If the user explicitly marks the article unread during that presentation, re-renders do not automatically mark it read again. Closing the Reader ends that presentation; a later direct reopen is a new presentation.
- Existing card-click and keyboard behavior remains unchanged and does not gain a duplicate status write.

## Verification

`F06-3` uses the synthetic Miniflux mutation ledger to check exact entry IDs, statuses and outcomes for direct display, explicit unread, reopen/reload, manual mode and rejected writes. It also checks no status writes for missing (404), HTTP 500, malformed payload, stale route or 401-driven session change. `F06-1` and `F06-2` remain unchanged.

Full Node, lint, Prettier, Knip and production-build evidence is recorded in the QA report attached to the implementation PR. E2E stability requires three independently executed, uniquely inventoried Chromium runs. This evidence is synthetic/emulated only and does not establish physical-device, installed-PWA, Safari/WebKit or real-Miniflux verification.
