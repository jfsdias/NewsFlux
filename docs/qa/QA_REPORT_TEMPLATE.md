# QA report: <change title>

Follows [`QA_CHARTER.md`](./QA_CHARTER.md). Copy this file next to the change, fill every section, and attach it to the pull request.

## Scope

- Change and commit range:
- Risk level (R0-R4):
- Requirement(s) and source:
- Pending requirements (`REQUIREMENT_PENDING`):

## Environment

| Item                          | Value |
| ----------------------------- | ----- |
| Commit under test             |       |
| Node versions                 |       |
| Browser(s) and version(s)     |       |
| Viewport / DPR / pointer type |       |
| Backend (real, mock, none)    |       |
| Evidence types used           |       |

## Results

| ID  | Scenario | Requirement | Type (unit, integration, e2e, manual) | Result state | Evidence (path, SHA-256) |
| --- | -------- | ----------- | ------------------------------------- | ------------ | ------------------------ |
|     |          |             |                                       |              |                          |

Red then green evidence (before and after the change):

Negative cases tried:

Regressions searched:

## Findings

| ID  | Severity | Classification | Steps to reproduce | Expected | Observed | Regression test |
| --- | -------- | -------------- | ------------------ | -------- | -------- | --------------- |
|     |          |                |                    |          |          |                 |

## Independent review

- Reviewer (not the author):
- What the reviewer tried in order to falsify the change:
- Result:
- If no independent review was possible, state it here. The change cannot then be `QA_PASSED`.

## Known limitations

## QA state

One of: `QA_NOT_STARTED`, `QA_IN_PROGRESS`, `QA_BLOCKED`, `QA_FAILED`, `QA_PASSED_WITH_LIMITATIONS`, `QA_PASSED`.

`QA_PASSED` does not authorize a merge or a deploy.
