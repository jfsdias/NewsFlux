# QA-004: safe user-facing errors for unexpected server responses

- **Status:** Product requirement approved; implementation is validated in QA-004 Draft PR #183 at `ddae32a92bd5a2fb12f9deea89d01209aa6f19f7`. Exact-head CI and independent review passed; the candidate remains outside `main` pending PM integration decision.
- **Severity:** LOW.
- **Scenario:** `F15-4` retains its identity and is expected to be `PASSED` by the candidate's version 6 scenario contract. The synthetic E2E and GitHub Actions evidence are the acceptance gate.

## Evidence boundary

The original failure was reproduced with a synthetic HTTP 200 `{}` response and an unknown route. No evidence says that production Miniflux emits malformed successful payloads. A real Miniflux 404 was not exercised in this implementation; the existing 404 behavior is covered by the unavailable-entry unit tests and synthetic mock. Do not infer a provider defect from these tests.

## Approved behavior

- Validate entry IDs as positive safe integers, match the requested ID, validate the feed/category structure used by Reader, and validate every entry in list envelopes. Reject the entire malformed response; never filter invalid members silently.
- Accept nullable or empty `title` and `content`; the UI keeps its existing fallbacks.
- A malformed HTTP 200 is an `invalid-response` error, never an unavailable article. Keep the Reader route, show localized safe guidance with Retry and Back to list, and do not issue a read/status mutation for an invalid entry.
- Preserve a genuine article 404: clear stale Reader content, return to the source list and show the existing localized warning.
- Render unknown routes with a localized not-found page and a recovery action.
- Preserve the established 401 session invalidation/login flow. A 403 shows access-denied guidance without logging out; 429, 5xx and network failures show localized recovery guidance and remain retryable where appropriate.
- Never display or log raw exception text, response bodies, credentials, private URLs or article content. Diagnostics are restricted to safe status, category and operation fields.
- Keep QA-003's already committed list snapshot during malformed refresh failures. Add no persistent state, cache or provider mutation.

## Implemented candidate coverage

The candidate adds pure response validators and safe error classification tests, API-boundary tests, and synthetic E2E coverage for invalid 200, missing/wrong IDs, malformed list members, nullable fields, 404, unknown routes, 401/403/429/5xx/network recovery, secret redaction, QA-003 snapshot preservation, stale-response fencing and mutation-ledger safety. On exact HEAD `ddae32a92bd5a2fb12f9deea89d01209aa6f19f7`, GitHub run [42217749004](https://github.com/jfsdias/NewsFlux/actions/runs/42217749004) verified three distinct Chromium runs, each with 46 `PASSED`, 0 `FAILED`, and 0 `SKIPPED`; independent review returned `PASS`.

No test in this proposal claims a physical-device, Safari/WebKit or real-Miniflux malformed-response result.
