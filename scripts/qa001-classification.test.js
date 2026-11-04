import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- QA classification is shared with the E2E suite through the package import map.
import { matchesFailureSignature } from "#e2e/support/classification.js"

const qa001Signature = /Expected: "Close article"[\s\S]*Received: "Open sidebar"/

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
