# QA-004: safe user-facing errors for unexpected server responses

- **Status:** `REQUIREMENT_PENDING`. Severity LOW.
- **Documenting test:** `F15-4` in `e2e/pwa-and-routing.spec.js` asserts the proposed behavior and is recorded as a pending requirement. `F15-2` (missing entry and unknown route never leave a blank screen) passes today.

## Current behavior

- A real Miniflux answers 404 for a missing entry and the app returns to the list with a warning (`handleUnavailableEntry`). That path is fine.
- A **200 response with an unexpected body** (the synthetic server returns `{}`) is not recognized as unavailable. `fetchSingleEntry` logs the failure and a later render throws; the route error boundary (`src/pages/ErrorPage.jsx`) then shows `error.statusText || error.message` verbatim, for example "Cannot read properties of undefined (reading 'id')", on a page that always uses the "404" result status and an untranslated "Back to Home" button.
- An unknown route shows React Router's default "Unexpected Application Error!" screen.

Evidence is synthetic: whether a real Miniflux can return such a body (a proxy, an old version, a custom server) is unknown.

## Proposal

1. **Validate before use.** `getEntry` (and the entries list parser) check the minimal shape the UI needs (a numeric `id`, a `feed`, string title and content or explicit empty values). An invalid body is treated like "entry unavailable": clear the reader, return to the list and show the existing localized warning.
2. **Safe error page.** `ErrorPage` never displays `error.message` or `statusText` to the user. It shows a short localized message ("Something went wrong") and the "Back to Home" action, and keeps the technical text in the console only. The result status reflects the situation (404 only for a real not found).
3. **Localize** the "Back to Home" label with the existing translation system.
4. **Unknown routes** use the same page with a "page not found" message.

Alternative: change only `ErrorPage` (point 2). Smaller, but a malformed entry would still take the whole route down instead of returning to the list.

## Acceptance criteria if approved

1. `F15-4` stops being a pending requirement: with an unexpected entry body the page shows no raw technical text and offers a way back.
2. `F15-2` and the unavailable-entry tests (`scripts` and `src` suites) still pass.
3. A unit test covers the validator with: missing `id`, null content, wrong types, and a valid entry.
4. Confirm against a real Miniflux 404 and a real malformed response if one can be produced in a test instance.
