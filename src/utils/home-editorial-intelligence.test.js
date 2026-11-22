import assert from "node:assert/strict"
import { test } from "node:test"

// Node tests require the explicit extension.
// eslint-disable-next-line import/extensions
import { buildBriefing, groupHomeStories, projectFocus } from "./home-editorial-intelligence.js"

const entry = (id, feed, title, date = "2026-01-01T00:00:00Z") => ({
  id,
  feed_id: feed,
  title,
  published_at: date,
  status: "unread",
})
test("related coverage requires overlap, different sources and valid nearby dates", () => {
  const a = entry(1, 1, "Major climate agreement reaches global summit")
  const b = entry(2, 2, "Global summit reaches major climate agreement today")
  assert.deepEqual(
    groupHomeStories([a, b]).map((g) => g.entries.map((e) => e.id)),
    [[1, 2]],
  )
  assert.equal(groupHomeStories([a, { ...b, title: a.title }]).length, 0)
  assert.equal(groupHomeStories([a, { ...b, feed_id: 1 }]).length, 0)
  assert.equal(groupHomeStories([a, { ...b, published_at: "bad" }]).length, 0)
  assert.equal(groupHomeStories([a, { ...b, published_at: "2026-01-04T00:00:00Z" }]).length, 0)
})
test("focus and briefing preserve order and do not mutate input", () => {
  const entries = [entry(1, 1, "one"), entry(2, 2, "two"), entry(3, 1, "three")]
  const snapshot = structuredClone(entries)
  assert.deepEqual(
    projectFocus(entries, "1").map((e) => e.id),
    [1, 3],
  )
  assert.deepEqual(
    projectFocus(entries, "").map((e) => e.id),
    [1, 2, 3],
  )
  assert.deepEqual(buildBriefing(entries, { now: Date.parse("2026-01-01T12:00:00Z") }), {
    entries: entries.slice(0, 2),
    recentCount: 3,
    sourceCount: 2,
    unreadCount: 3,
  })
  assert.equal(
    buildBriefing(entries, { now: Date.parse("2026-01-04T00:00:00Z") }).entries.length,
    0,
  )
  assert.deepEqual(entries, snapshot)
})
