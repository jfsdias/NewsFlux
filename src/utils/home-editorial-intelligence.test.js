import assert from "node:assert/strict"
import { test } from "node:test"

// Node tests require the explicit extension.
import {
  buildBriefing,
  getEditorialTitle,
  groupHomeStories,
  projectFocus,
  // eslint-disable-next-line import/extensions
} from "./home-editorial-intelligence.js"

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
    entries: [entries[1], entries[0]],
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

test("category preference changes within-category choice without changing entries or source state", () => {
  const now = Date.parse("2026-01-01T12:00:00Z")
  const entries = [
    { ...entry(1, 1, "First report"), feed: { category: { id: 1 } } },
    { ...entry(2, 2, "Second report"), feed: { category: { id: 2 } } },
    { ...entry(3, 3, "Third report"), feed: { category: { id: 2 } } },
  ]
  const before = structuredClone(entries)
  const result = buildBriefing(entries, { now, categoryPreferences: { 2: 1 } })
  assert.equal(result.entries[0].id, 2)
  assert.deepEqual(entries, before)
  assert.equal(buildBriefing(entries, { now, categoryPreferences: { 2: -1 } }).entries[0].id, 1)
})

// eslint-disable-next-line import/extensions
const { projectHomePersonalization } = await import("./home-personalization-projection.js")

test("briefing avoids exact copies and surfaces a rarer source relative to affinity V1", () => {
  const now = Date.parse("2026-01-01T12:00:00Z")
  const entries = [
    { ...entry(1, 1, "Dominant one"), hash: "same", feed: { id: 1, category: { id: 1 } } },
    { ...entry(2, 1, "Dominant two"), feed: { id: 1, category: { id: 1 } } },
    { ...entry(3, 1, "Dominant three"), feed: { id: 1, category: { id: 1 } } },
    { ...entry(4, 2, "Rare source"), feed: { id: 2, category: { id: 1 } } },
    {
      ...entry(5, 3, "Copy from another source"),
      hash: "same",
      feed: { id: 3, category: { id: 1 } },
    },
  ]
  const result = buildBriefing(entries, { now })
  assert.equal(result.entries[0].id, 4)
  assert.notEqual(result.entries.filter((item) => item.hash === "same").length, 2)
  const v1 = projectHomePersonalization({
    entries,
    baselineHighlightIds: [1, 2, 3],
    baselineRecentIds: [4, 5],
    freshnessWindow: 3_600_000,
  })
  assert.equal(v1.highlightIds[0], 1)
  assert.equal(result.entries[0].id, 4)
})

test("blank or missing titles get an accessible fallback", () => {
  assert.equal(getEditorialTitle({ title: "  " }, "Untitled article"), "Untitled article")
  assert.equal(getEditorialTitle({ title: null }, "Untitled article"), "Untitled article")
  assert.equal(getEditorialTitle({ title: "Named" }, "Untitled article"), "Named")
})
