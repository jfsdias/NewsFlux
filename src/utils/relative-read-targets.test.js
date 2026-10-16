import assert from "node:assert/strict"
import test from "node:test"

const relativeReadTargetsModule = await import(
  new URL("relative-read-targets.js", import.meta.url)
).catch(() => ({}))
const { getRelativeUnreadTargetIds } = relativeReadTargetsModule

const entry = (id, status = "unread", extra = {}) => ({ id, status, ...extra })
const ids = (...values) => values
const target = (entries, anchorId, direction) => {
  assert.equal(typeof getRelativeUnreadTargetIds, "function", "relative target helper missing")
  return getRelativeUnreadTargetIds(entries, anchorId, direction)
}

const allUnread = [entry("A"), entry("B"), entry("C"), entry("D"), entry("E")]

test("RELATIVE_ABOVE_EXCLUDES_ANCHOR", () => {
  assert.deepEqual(target(allUnread, "C", "above"), ids("A", "B"))
})

test("RELATIVE_BELOW_EXCLUDES_ANCHOR", () => {
  assert.deepEqual(target(allUnread, "C", "below"), ids("D", "E"))
})

test("RELATIVE_ABOVE_FIRST_ROW_EMPTY", () => {
  assert.deepEqual(target(allUnread, "A", "above"), [])
})

test("RELATIVE_BELOW_LAST_ROW_EMPTY", () => {
  assert.deepEqual(target(allUnread, "E", "below"), [])
})

test("RELATIVE_ABOVE_MIXED_READ_STATUS", () => {
  const mixed = [entry("A"), entry("B", "read"), entry("C"), entry("D"), entry("E", "read")]
  assert.deepEqual(target(mixed, "C", "above"), ids("A"))
})

test("RELATIVE_BELOW_MIXED_READ_STATUS", () => {
  const mixed = [entry("A"), entry("B", "read"), entry("C"), entry("D"), entry("E", "read")]
  assert.deepEqual(target(mixed, "C", "below"), ids("D"))
})

test("RELATIVE_TARGET_DEDUPLICATES_IDS", () => {
  const duplicated = [entry("A"), entry("A"), entry("B"), entry("C"), entry("D"), entry("D")]
  assert.deepEqual(target(duplicated, "C", "above"), ids("A", "B"))
  assert.deepEqual(target(duplicated, "C", "below"), ids("D"))
})

test("RELATIVE_TARGET_NEVER_CONTAINS_THE_ANCHOR_ID_EVEN_WHEN_DUPLICATED", () => {
  const duplicatedAnchor = [entry("A"), entry("C"), entry("B"), entry("C"), entry("D")]
  assert.deepEqual(target(duplicatedAnchor, "C", "above"), ids("A"))
  assert.deepEqual(target(duplicatedAnchor, "C", "below"), ids("B", "D"))
})

test("RELATIVE_FILTERED_LIST_ONLY", () => {
  const filteredDisplayedList = [entry("B"), entry("D"), entry("E")]
  assert.deepEqual(target(filteredDisplayedList, "D", "above"), ids("B"))
  assert.deepEqual(target(filteredDisplayedList, "D", "below"), ids("E"))
})

test("RELATIVE_LOADED_LIST_ONLY", () => {
  assert.equal(
    getRelativeUnreadTargetIds?.length,
    3,
    "target calculation must depend only on displayed entries, anchor and direction",
  )
  assert.deepEqual(target([entry(1), entry(2), entry(3)], 3, "above"), [1, 2])
})

test("RELATIVE_DESCENDING_ORDER", () => {
  const descending = [
    entry(5, "unread", { published_at: "2026-10-05T00:00:00Z" }),
    entry(4, "unread", { published_at: "2026-10-04T00:00:00Z" }),
    entry(3, "unread", { published_at: "2026-10-03T00:00:00Z" }),
    entry(2, "unread", { published_at: "2026-10-02T00:00:00Z" }),
    entry(1, "unread", { published_at: "2026-10-01T00:00:00Z" }),
  ]
  assert.deepEqual(target(descending, 3, "above"), [5, 4])
  assert.deepEqual(target(descending, 3, "below"), [2, 1])
})

test("RELATIVE_ASCENDING_ORDER", () => {
  const ascending = [
    entry(1, "unread", { published_at: "2026-10-01T00:00:00Z" }),
    entry(2, "unread", { published_at: "2026-10-02T00:00:00Z" }),
    entry(3, "unread", { published_at: "2026-10-03T00:00:00Z" }),
    entry(4, "unread", { published_at: "2026-10-04T00:00:00Z" }),
    entry(5, "unread", { published_at: "2026-10-05T00:00:00Z" }),
  ]
  assert.deepEqual(target(ascending, 3, "above"), [1, 2])
  assert.deepEqual(target(ascending, 3, "below"), [4, 5])
})

test("RELATIVE_NO_ID_OR_TIMESTAMP_ORDER_ASSUMPTION", () => {
  const scrambled = [
    entry(900, "unread", { published_at: "2020-01-01T00:00:00Z", changed_at: "2020-01-01" }),
    entry(7, "unread", { published_at: "2030-01-01T00:00:00Z", changed_at: "2030-01-01" }),
    entry(500, "unread", { published_at: "2025-01-01T00:00:00Z", changed_at: "2025-01-01" }),
    entry(1, "unread", { published_at: "2031-01-01T00:00:00Z", changed_at: "2031-01-01" }),
  ]
  assert.deepEqual(target(scrambled, 7, "above"), [900])
  assert.deepEqual(target(scrambled, 7, "below"), [500, 1])
})

test("RELATIVE_UNKNOWN_ANCHOR_IS_EMPTY", () => {
  assert.deepEqual(target(allUnread, "missing", "above"), [])
  assert.deepEqual(target(allUnread, "missing", "below"), [])
  assert.deepEqual(target([], "A", "above"), [])
})

test("RELATIVE_INVALID_DIRECTION_IS_REJECTED", () => {
  assert.equal(typeof getRelativeUnreadTargetIds, "function")
  assert.throws(() => getRelativeUnreadTargetIds(allUnread, "C", "sideways"), TypeError)
})

test("RELATIVE_TARGET_DOES_NOT_MUTATE_INPUT", () => {
  const input = allUnread.map((value) => ({ ...value }))
  const snapshot = JSON.stringify(input)
  target(input, "C", "above")
  target(input, "C", "below")
  assert.equal(JSON.stringify(input), snapshot)
})
