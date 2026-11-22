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

test("briefing honors source preference, source diversity and related-coverage cap", () => {
  const now = Date.parse("2026-01-01T12:00:00Z")
  const entries = [
    entry(1, 1, "Major climate agreement reaches global summit"),
    entry(2, 2, "Global summit reaches major climate agreement today"),
    entry(3, 3, "Independent technology report"),
    entry(4, 3, "Another technology report"),
  ]
  const result = buildBriefing(entries, { now, preferences: { 2: 1 } })
  assert.deepEqual(
    result.entries.map((item) => item.id),
    [2, 3],
  )
  assert.deepEqual(
    buildBriefing(entries, { now }).entries.map((item) => item.id),
    [1, 3],
  )
})

test("groups require direct support from every member and never chain a bridge", () => {
  const entries = [
    entry(1, 1, "alpha bravo charlie delta"),
    entry(2, 2, "alpha bravo charlie echo"),
    entry(3, 3, "alpha bravo charlie foxtrot"),
    entry(4, 4, "bravo charlie echo foxtrot"),
  ]
  const groups = groupHomeStories(entries)
  assert.deepEqual(
    groups.map((group) => group.entries.map((item) => item.id)),
    [[1, 2, 3]],
  )
  assert.deepEqual(
    groupHomeStories([entries[0], entry(5, 5, "alpha unrelated remote different")]),
    [],
  )
})
