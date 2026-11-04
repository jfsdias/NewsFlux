import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const read = (relativePath) => {
  const url = new URL(`../${relativePath}`, import.meta.url)
  assert.ok(existsSync(url), `${relativePath} must exist`)
  return readFileSync(url, "utf8")
}

const TEST_STATES = [
  "REQUIREMENT_VERIFIED",
  "TEST_PASSED",
  "TEST_FAILED",
  "NOT_TESTED",
  "INSUFFICIENT_EVIDENCE",
  "REGRESSION_DETECTED",
  "KNOWN_LIMITATION",
  "ACCEPTANCE_BLOCKED",
  "REQUIREMENT_PENDING",
]
const ACCEPTANCE_STATES = [
  "QA_NOT_STARTED",
  "QA_IN_PROGRESS",
  "QA_BLOCKED",
  "QA_FAILED",
  "QA_PASSED_WITH_LIMITATIONS",
  "QA_PASSED",
]
const RISK_LEVELS = ["R0", "R1", "R2", "R3", "R4"]

test("the QA charter defines roles, states, evidence and independence", () => {
  const charter = read("docs/qa/QA_CHARTER.md")

  for (const state of [...TEST_STATES, ...ACCEPTANCE_STATES]) {
    assert.match(charter, new RegExp(`\`${state}\``), `charter must define ${state}`)
  }
  for (const level of RISK_LEVELS) {
    assert.match(
      charter,
      new RegExp(String.raw`\b${level}\b`),
      `charter must define risk level ${level}`,
    )
  }
  for (const heading of [
    "## Roles",
    "## Independence",
    "## Evidence",
    "## Requirements that are not approved",
    "## Acceptance states",
    "## What QA approval does not authorize",
    "## Where this is enforced",
  ]) {
    assert.ok(charter.includes(heading), `charter must contain "${heading}"`)
  }
})

test("the QA charter states the non-negotiable rules", () => {
  const charter = read("docs/qa/QA_CHARTER.md")

  for (const rule of [
    /must not self-certify/i,
    /does not authorize (a )?merge or (a )?deploy/i,
    /never deleted or weakened/i,
    /no invented coverage threshold/i,
    /emulation is not (a )?physical/i,
    /never reactivat\w+ (a )?(feature|functionality) (that is )?in HOLD/i,
    /does not depend on any (external )?(agent )?memory/i,
  ]) {
    assert.match(charter, rule, `charter must state: ${rule}`)
  }
})

test("the pull request template carries the QA section", () => {
  const template = read(".github/pull_request_template.md")

  for (const heading of [
    "## Summary",
    "## QA",
    "### Risk level",
    "### Requirements",
    "### Tests (red then green)",
    "### Negative case",
    "### Environment and evidence type",
    "### Evidence",
    "### Regressions searched",
    "### Known limitations",
    "### QA state",
  ]) {
    assert.ok(template.includes(heading), `PR template must contain "${heading}"`)
  }
  for (const state of ACCEPTANCE_STATES) {
    assert.ok(template.includes(state), `PR template must offer ${state}`)
  }
  for (const level of RISK_LEVELS) {
    assert.ok(template.includes(level), `PR template must offer risk level ${level}`)
  }
  assert.match(template, /docs\/qa\/QA_CHARTER\.md/)
})

test("the QA report template and findings register exist and reference the charter", () => {
  const report = read("docs/qa/QA_REPORT_TEMPLATE.md")
  const register = read("docs/qa/FINDINGS_REGISTER.md")

  assert.match(report, /QA_CHARTER\.md/)
  for (const heading of ["## Scope", "## Environment", "## Results", "## Independent review"]) {
    assert.ok(report.includes(heading), `report template must contain "${heading}"`)
  }
  for (const id of ["QA-001", "QA-002", "QA-003", "QA-004"]) {
    assert.match(register, new RegExp(id), `register must track ${id}`)
  }
})
