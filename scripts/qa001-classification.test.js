import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- QA classification is shared with the E2E suite through the package import map.
import { matchesFailureSignature } from "#e2e/support/classification.js"

const qa001Signature = /Expected: "Close article"[\s\S]*Received: "Open sidebar"/
const qa001TouchFailureSignature =
  /QA-001 actual touch with hitTarget=Open sidebar ended at \/all\/entry\/\d+; readerStillVisible=true/
const readerAndStateSource = readFileSync(
  new URL("../e2e/reader-and-state.spec.js", import.meta.url),
  "utf8",
)

test("QA-001 matches only the recorded sidebar hit-test interception", () => {
  const interception = new Error(
    'Expected: "Close article"\nReceived: "Open sidebar"\nQA-001: Close article must receive the pointer',
  )

  assert.equal(matchesFailureSignature(interception, qa001Signature), true)
})

test("an unrelated reader-close route failure cannot match the QA-001 signature", () => {
  const unrelatedCloseFailure = new Error(
    "Expected URL /all but the route remained /all/entry/42 after the close action",
  )

  assert.equal(matchesFailureSignature(unrelatedCloseFailure, qa001Signature), false)
})

test("F04-3 classifies only the observed sidebar interception that leaves the reader open", () => {
  const f04 =
    readerAndStateSource.split('test("F04-3:', 2)[1]?.split('test.describe("F05', 2)[0] ?? ""
  const expectedFailure = new Error(
    "QA-001 actual touch with hitTarget=Open sidebar ended at /all/entry/42; readerStillVisible=true",
  )
  const unrelatedFailure = new Error(
    "QA-001 actual touch with hitTarget=Close article ended at /all/entry/42; readerStillVisible=true",
  )

  assert.ok(f04.includes(qa001TouchFailureSignature.toString()))
  assert.equal(matchesFailureSignature(expectedFailure, qa001TouchFailureSignature), true)
  assert.equal(matchesFailureSignature(unrelatedFailure, qa001TouchFailureSignature), false)
})

test("F04-3 performs and observes the center touch before classifying QA-001", () => {
  const f04 =
    readerAndStateSource.split('test("F04-3:', 2)[1]?.split('test.describe("F05', 2)[0] ?? ""
  const hitTargetMeasurement = f04.indexOf("const hitTarget = await elementAtCenter")
  const hitTargetBranch = f04.indexOf('if (hitTarget === "Open sidebar")')
  const action = f04.indexOf("const tapCenterAndVerifyClose = async")
  const touch = f04.indexOf("page.touchscreen.tap(x, y)")
  const routeObservation = f04.indexOf("routeAfterTouch")
  const readerObservation = f04.indexOf("readerStillVisible")
  const knownDefect = f04.indexOf("await knownDefect(", hitTargetBranch)

  assert.ok(hitTargetMeasurement !== -1, "F04-3 must record the intercepting hit target")
  assert.ok(
    action > hitTargetMeasurement,
    "the measured hit target must precede the actual touch action",
  )
  assert.ok(touch > action, "F04-3 must execute a real touchscreen tap")
  assert.ok(routeObservation > touch, "the actual route after touch must be observed")
  assert.ok(readerObservation > touch, "the reader state after touch must be observed")
  assert.ok(
    knownDefect > hitTargetBranch,
    "the hit-target result must be classified after the action is defined",
  )
  assert.match(f04.slice(knownDefect), /tapCenterAndVerifyClose/)
  assert.doesNotMatch(f04.slice(hitTargetBranch, knownDefect), /\breturn\b/)
})
