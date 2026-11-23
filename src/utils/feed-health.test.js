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

test("dashboard summarizes provider facts without inferring publication cadence", async () => {
  const { summarizeFeedHealth } = await import(new URL("feed-health.js", import.meta.url))
  const now = Date.parse("2026-01-02T00:00:00Z")
  const summary = summarizeFeedHealth([
    { parsing_error_count: 2, disabled: true, checked_at: "2026-01-01T23:00:00Z" },
    { parsing_error_count: 1, checked_at: "2025-12-30T00:00:00Z" },
    { checked_at: "invalid" },
    { checked_at: "2026-01-03T00:00:00Z" },
    {},
  ], now)
  assert.deepEqual(summary, { total: 5, errors: 2, errorUnknown: 3, disabled: 1, recent: 1, old: 1, unknown: 3 })
})

test("dashboard treats a check at the 24-hour boundary as recent", async () => {
  const { summarizeFeedHealth } = await import(new URL("feed-health.js", import.meta.url))
  const now = Date.parse("2026-01-02T00:00:00Z")
  assert.equal(summarizeFeedHealth([{ checked_at: "2026-01-01T00:00:00Z" }], now).recent, 1)
})

test("unknown error and check metadata remain unknown", async () => {
  const { summarizeFeedHealth } = await import(new URL("feed-health.js", import.meta.url))
  const feeds = [
    { parsing_error_count: null, checked_at: null },
    { parsing_error_count: -1, checked_at: "0001-01-01T00:00:00Z" },
    { parsing_error_count: 1.5, checked_at: "not a date" },
    { parsing_error_count: "bad", checked_at: "2100-01-01T00:00:00Z" },
    { parsing_error_count: 0, checked_at: "2026-01-01T00:00:00Z" },
  ]
  const result = summarizeFeedHealth(feeds, Date.parse("2026-01-02T00:00:00Z"))
  assert.equal(result.errorUnknown, 4)
  assert.equal(result.errors, 0)
  assert.equal(result.unknown, 4)
})
