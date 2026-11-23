import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node ESM requires explicit extensions.
import { groupHomeStories } from "./home-editorial-intelligence.js"
// eslint-disable-next-line import/extensions -- Node ESM requires explicit extensions.
import buildSourceReview from "./source-review.js"

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

test("counts actual related groups and excludes unrelated coverage", () => {
  const entries = [
    {
      id: 1,
      feed_id: 1,
      title: "Major climate agreement reaches global summit",
      published_at: "2026-01-01T00:00:00Z",
    },
    {
      id: 2,
      feed_id: 2,
      title: "Global summit reaches major climate agreement today",
      published_at: "2026-01-01T01:00:00Z",
    },
    {
      id: 3,
      feed_id: 1,
      title: "Independent article",
      published_at: "2026-01-01T01:00:00Z",
    },
  ]
  assert.deepEqual(
    buildSourceReview(entries, groupHomeStories(entries)).map((source) => source.relatedCount),
    [1, 1],
  )
})
