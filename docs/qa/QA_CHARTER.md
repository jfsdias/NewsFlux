# NewsFlux QA charter

- **Status:** in force from STABILIZATION-01. Established against audited HEAD `1e7e39ce27ca15c0242e98d83e0c5d0ad865a1ba`.
- **Scope:** every change to the NewsFlux frontend, its tests, its CI and its documentation.
- **Principle:** NewsFlux succeeds when regressions are detected before a change reaches the user. A green test suite is required but is not sufficient.

This charter is a repository document. Its rules are enforced by the repository itself (see [Where this is enforced](#where-this-is-enforced)) and does not depend on any external memory or on the availability of a particular assistant.

## Roles

| Role            | Responsibility                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Engineering** | Designs and implements the change, writes the regression test first, keeps the change small and reversible, and documents the evidence it produced.                                                |
| **QA**          | Establishes the requirement, verifies the change against it, tries to **falsify** the claim, records evidence and issues the QA state. QA does not accept the implementer's reasoning as evidence. |
| **Red team**    | Looks for the cases the tests omit: failure paths, unexpected states, hostile or malformed input, other viewports, other input modes.                                                              |

One person or agent may hold several roles over time, but not for the same change: see [Independence](#independence).

## Independence

1. The author of a change **must not self-certify** `QA_PASSED`. A different reviewer (a person, or an agent with a fresh context that did not write the change) must try to falsify the claim and record the result.
2. When no independent reviewer was available, the review is reported as **incomplete**, and the change cannot be `QA_PASSED`; the best it can be is `QA_PASSED_WITH_LIMITATIONS` with that limitation written down.
3. The reviewer re-runs the evidence rather than reading the author's summary: the failing test before the change, the passing test after it, and at least one meaningful negative case.
4. Code review does not replace functional testing, and a passing test does not prove a requirement that the test does not express.
5. **Independence is a rule of this charter, not something the repository can check.** No workflow or test can tell who wrote a change or who reviewed it. It is enforced by the reviewer recording their identity in the QA report and by the owner declining to approve a change whose report has no independent reviewer.

## Evidence

Every QA statement names the **kind of evidence** behind it. These labels must not be mixed.

| Label         | Meaning                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Physical**  | Observed on a real device and browser. Record the model, OS, browser and version.        |
| **Emulated**  | Observed in an automated browser with emulated viewport/input (for example Chromium).    |
| **Synthetic** | Observed against test fixtures or a mock backend, not the real Miniflux.                 |
| **Static**    | Read from code, configuration, documentation or the repository history; nothing was run. |

Rules:

- **Emulation is not a physical or Safari/WebKit verification.** A Chromium result never certifies a Fold, an iPhone, or an installed PWA, and never certifies WebKit behavior.
- Evidence records the date, the commit, the Node version, the browser and its version, the viewport and device pixel ratio where relevant, and the commands used. Large artifacts are referenced by path and SHA-256.
- Device verification is never fabricated. When no device was used, the statement is "not verified on a device".
- There is **no invented coverage threshold**. Coverage numbers describe only the modules a test run loads; they never stand in for requirement coverage.
- Existing tests are **never deleted or weakened** to obtain a green result. A test may change only when its requirement changes, and the change says which requirement.
- Known product defects stay traceable: each has an ID in the [findings register](./FINDINGS_REGISTER.md) and a regression test that describes the correct behavior.

## Test result states

| State                   | Meaning                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `REQUIREMENT_VERIFIED`  | The requirement was checked against its acceptance criteria with evidence proportional to the risk.                |
| `TEST_PASSED`           | An executed test passed. This alone does not mean the requirement is verified.                                     |
| `TEST_FAILED`           | An executed test failed.                                                                                           |
| `NOT_TESTED`            | No test was run for this behavior.                                                                                 |
| `INSUFFICIENT_EVIDENCE` | The available evidence does not cover the criterion (for example, emulation only where a device is required).      |
| `REGRESSION_DETECTED`   | A behavior that previously worked no longer works, and the earlier behavior is demonstrated.                       |
| `KNOWN_LIMITATION`      | A documented behavior that is accepted for now, with an owner decision recorded.                                   |
| `ACCEPTANCE_BLOCKED`    | The change cannot be accepted because a demonstrated defect or a missing prerequisite blocks it.                   |
| `REQUIREMENT_PENDING`   | There is no approved requirement to decide the behavior. It is not a regression until the requirement is approved. |

## Requirements that are not approved

A behavior that nobody has specified is **not** a confirmed regression. When QA finds one:

1. Record it in the findings register as `REQUIREMENT_PENDING`.
2. Write the proposed requirement and the options in `docs/qa/proposals/`.
3. Add a test that asserts the _proposed_ behavior inside the `requirementPending` wrapper (`e2e/support/classification.js`). The wrapper requires the assertion to fail for the recorded reason and reports the scenario as `REQUIREMENT_PENDING`, never as a pass. If the behavior starts to satisfy the proposal, or fails for another reason, the test fails, so the decision is neither silently pre-empted nor silently lost.
4. Do not implement the proposed behavior until the owner approves it.

## Risk levels

| Level  | When                                                            | Examples                                  |
| ------ | --------------------------------------------------------------- | ----------------------------------------- |
| **R0** | Documentation, tests or comments only.                          | Roadmap reconciliation.                   |
| **R1** | Internal logic with no UI effect.                               | Pure utilities.                           |
| **R2** | UI, layout, CSS, breakpoints, input handling.                   | Reader header, navigation, touch targets. |
| **R3** | State, data, API, authentication, reading or writing Miniflux.  | Mark as read, API keys, pagination.       |
| **R4** | Platform: PWA/service worker, headers, build, CI, dependencies. | `vite.config.js`, `Caddyfile`, workflows. |

The minimum evidence per level is the table below. The pull request template asks for the level and the evidence; review enforces the table, and no workflow checks it.

| Level  | Minimum evidence                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0** | The documents, tests or comments still agree with the repository (`pnpm test`, Prettier). No behavior claim without a command that was run.                                                                         |
| **R1** | A failing test before the change, the same test passing after it, the full source and script suites on Node 22 and 24, and one negative case.                                                                       |
| **R2** | All of R1, plus an automated browser check at the affected viewports and input modes (mouse and touch), labeled **Emulated**. A device is not implied.                                                              |
| **R3** | All of R2, plus a failure-path case against the mock Miniflux (HTTP error, malformed body, empty body), and a check that no data is written wrongly.                                                                |
| **R4** | All of R3, plus a production build on Node 22 and 24 and, for PWA or service-worker changes, an offline and update scenario. Physical-device or installed-PWA behavior stays "not verified" until a device is used. |

## Acceptance states

| State                        | Meaning                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `QA_NOT_STARTED`             | No test plan and no QA report yet.                                                                                   |
| `QA_IN_PROGRESS`             | Tests and independent verification are running.                                                                      |
| `QA_BLOCKED`                 | QA cannot decide: a requirement is pending, an environment or device is unavailable, or a prerequisite is missing.   |
| `QA_FAILED`                  | A required test failed or a regression is confirmed.                                                                 |
| `QA_PASSED_WITH_LIMITATIONS` | The gate for the risk level passed, with written limitations (for example no physical device) accepted by the owner. |
| `QA_PASSED`                  | Every criterion for the risk level is met with compatible evidence and an independent review.                        |

The expected sequence is: requirements, plan, implementation, tests, independent QA, regression fixes, revalidation, approval. QA tries to refute the change before recommending approval.

## What QA approval does not authorize

`QA_PASSED` does not authorize a merge or a deploy. Both need their own explicit authorization from the owner. QA approval also does not mark any GitHub check as required: branch protection is a repository setting changed by the owner.

## Features in HOLD

QA never reactivates a feature that is in HOLD (Story ranking and Story identity, the dual-pane reader, offline data, publisher HTTP fetch, reranker work). It verifies that held features stay off by default and unchanged, and reports any change to them as a finding.

## Where this is enforced

| Mechanism                                                                    | What it enforces                                                                                   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`.github/workflows/quality.yaml`](../../.github/workflows/quality.yaml)     | ESLint, Prettier, source and script tests on Node 22 and 24, production build, knip baseline.      |
| [`scripts/quality-workflow.test.js`](../../scripts/quality-workflow.test.js) | The workflow keeps those gates and stays read-only.                                                |
| [`scripts/qa-policy.test.js`](../../scripts/qa-policy.test.js)               | This charter, the pull request template and the findings register keep their required content.     |
| [`.github/pull_request_template.md`](../../.github/pull_request_template.md) | Every pull request states risk level, requirements, red/green tests, a negative case and evidence. |
| [`docs/qa/QA_REPORT_TEMPLATE.md`](./QA_REPORT_TEMPLATE.md)                   | The format of a QA report attached to a change.                                                    |
| [`docs/qa/FINDINGS_REGISTER.md`](./FINDINGS_REGISTER.md)                     | Traceability of known defects and pending requirements.                                            |

This charter does not depend on any external agent memory: if a memory service is unavailable, the rules above still apply because they live in the repository and in CI.
