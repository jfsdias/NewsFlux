# QA proposals awaiting a product decision

These documents propose behavior for findings that have **no approved requirement**, or a defect whose correction needs its own scope approval. **Nothing here is implemented.** Each proposal names the regression or documenting test that will change when the decision is made, so the decision cannot be pre-empted silently (see [`QA_CHARTER.md`](../QA_CHARTER.md)).

| Finding | Type                            | Decision needed                                         | Proposal                                           |
| ------- | ------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| QA-001  | Defect, reproduced in emulation | Approve a narrow correction after physical confirmation | [QA-001](./QA-001-close-article-overlap.md)        |
| QA-002  | Requirement pending             | Should a directly opened article be marked read?        | [QA-002](./QA-002-deep-link-read-state.md)         |
| QA-003  | Requirement pending             | Should a failed Refresh keep the loaded entries?        | [QA-003](./QA-003-failed-refresh-keeps-entries.md) |
| QA-004  | Requirement pending             | What should users see for unexpected server responses?  | [QA-004](./QA-004-safe-error-messages.md)          |

Evidence in all proposals is emulated and synthetic (Chromium against a mock Miniflux) or static. None has been verified on a physical device.
