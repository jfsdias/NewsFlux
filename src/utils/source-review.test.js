import assert from "node:assert/strict"
import test from "node:test"
import { buildSourceReview } from "./source-review.js"

test("counts only unique sampled entries and related group members per source", () => {
  const a = { id: 1, feed_id: 10, feed: { title: "A" } }
  const b = { id: 2, feed_id: 20, feed: { title: "B" } }
  const c = { id: 3, feed_id: 10 }
  const entries = [a, b, c, a, { id: 4 }]
  const before = structuredClone(entries)
  assert.deepEqual(buildSourceReview(entries, [{ entries: [a, b] }, { entries: [a, b] }]), [
    { id: "10", name: "A", entryCount: 2, relatedCount: 1 },
    { id: "20", name: "B", entryCount: 1, relatedCount: 1 },
  ])
  assert.deepEqual(entries, before)
})
test("returns an empty review when no identifiable sources are loaded", () => {
  assert.deepEqual(buildSourceReview([], []), [])
})
