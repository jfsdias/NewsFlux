import assert from "node:assert/strict"
import { test } from "node:test"

const { default: hasProviderReportedFeedError } = await import(
  new URL("feed-health.js", import.meta.url)
)

test("SUCCESS_RESET_ZERO_HIDES_INDICATOR", () => {
  assert.equal(hasProviderReportedFeedError({ parsing_error_count: 0 }), false)
})

test("ONE_FAILURE_SHOWS_INDICATOR", () => {
  assert.equal(hasProviderReportedFeedError({ disabled: false, parsing_error_count: 1 }), true)
})

test("DISABLED_WITH_ERROR_COUNT_SUPPRESSES_ERROR_INDICATOR", () => {
  assert.equal(hasProviderReportedFeedError({ disabled: true, parsing_error_count: 2 }), false)
})

test("MISSING_ERROR_COUNT_SHOWS_NOTHING", () => {
  assert.equal(hasProviderReportedFeedError({}), false)
})
