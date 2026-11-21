import assert from "node:assert/strict"
import test from "node:test"

import { automaticSummaryChoice, automaticSummaryEnabled, maySendAutomaticSummary, withoutAutomaticSummaryConsent } from "./article-summary-consent.js" // eslint-disable-line import/extensions

test("default and legacy true never constitute consent", () => {
  assert.equal(automaticSummaryEnabled({}), false)
  assert.equal(automaticSummaryEnabled({ aiSummaryAutoOnOpen: true }), false)
  assert.equal(automaticSummaryEnabled({ aiSummaryAutoConsent: true }), false)
})

test("explicit switch enables and disabling revokes consent", () => {
  assert.equal(automaticSummaryEnabled(automaticSummaryChoice(true)), true)
  assert.equal(automaticSummaryEnabled(automaticSummaryChoice(false)), false)
})

test("imported choices cannot grant automatic transfer consent", () => {
  const imported = withoutAutomaticSummaryConsent({ ...automaticSummaryChoice(true), other: 1 })
  assert.equal(automaticSummaryEnabled(imported), false)
  assert.equal(imported.other, 1)
})

test("revocation while catalog is loading blocks automatic transmission, not manual requests", () => {
  const revoked = automaticSummaryChoice(false)
  assert.equal(maySendAutomaticSummary(true, revoked), false)
  assert.equal(maySendAutomaticSummary(true, automaticSummaryChoice(true)), true)
  assert.equal(maySendAutomaticSummary(false, revoked), true)
})
