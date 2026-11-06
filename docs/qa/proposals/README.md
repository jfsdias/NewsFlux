# QA proposals and recorded decisions

These documents preserve the proposed behavior and current decision for each finding. Requirements awaiting a decision remain explicitly pending; approved requirements record their implementation and regression test (see [`QA_CHARTER.md`](../QA_CHARTER.md)).

| Finding | Status                               | Current requirement or decision                                                   | Record                                             |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------- |
| QA-002  | Approved and implemented             | Mark a directly opened article read after it is displayed when `markReadBy=view`. | [QA-002](./QA-002-deep-link-read-state.md)         |
| QA-003  | Approved and implemented             | Keep loaded entries during and after a failed same-scope Refresh, with Retry.     | [QA-003](./QA-003-failed-refresh-keeps-entries.md) |
| QA-004  | Approved; implementation in Draft PR | Localized, redacted recovery for invalid payloads and request failures.           | [QA-004](./QA-004-safe-error-messages.md)          |

Evidence in all proposals is emulated and synthetic (Chromium against a mock Miniflux) or static. None has been verified on a physical device.

QA-001 has a separately scoped correction candidate with passing Chromium/synthetic evidence; its earlier reproduction and current emulated resolution are recorded in [the QA-001 evidence note](./QA-001-close-article-overlap.md). Physical-device and Safari/WebKit validation remain unverified.
