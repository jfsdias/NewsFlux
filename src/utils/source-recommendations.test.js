import assert from "node:assert/strict"
import test from "node:test"

import { recommendSources } from "./source-recommendations.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const now = Date.parse("2026-01-31T00:00:00Z")
const entry = (id, category, extra = {}) => ({
  id,
  published_at: "2026-01-30T00:00:00Z",
  status: "read",
  starred: false,
  feed_id: id,
  feed: { category: { title: category } },
  ...extra,
})

test("uses distinct recent entries, exact category names and current read/star snapshot", () => {
  const entries = [
    entry(1, "Tecnologia"),
    entry(1, "Tecnologia"),
    entry(2, "Technology", { status: "unread", starred: true }),
    entry(3, "science fiction"),
    entry(4, "Science", { published_at: "2025-12-01T00:00:00Z" }),
  ]
  const result = recommendSources({ entries, subscribedFeeds: [], hiddenFeedIds: new Set(), now })
  assert.equal(result[0].topic, "tech")
  assert.deepEqual(result[0].evidence, { entries: 2, read: 1, starred: 1 })
  assert.ok(result.every((item) => item.topic === "tech"))
})

test("excludes subscribed URLs, hidden feeds, future dates and entries beyond 200", () => {
  const entries = [
    entry(1, "science"),
    entry(2, "science", { feed_id: 99 }),
    entry(3, "science", { published_at: "2026-02-01T00:00:00Z" }),
    ...Array.from({ length: 198 }, (_, index) => entry(index + 10, "unknown")),
    entry(999, "science"),
  ]
  const result = recommendSources({
    entries,
    subscribedFeeds: [{ feed_url: "https://www.nature.com/nature.rss/" }],
    hiddenFeedIds: new Set([99]),
    now,
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].title, "Latest Science News -- ScienceDaily")
  assert.equal(result[0].evidence.entries, 1)
})

test("interleaves topics on equal score deterministically", () => {
  const result = recommendSources({
    entries: [entry(1, "Science"), entry(2, "Tech")],
    subscribedFeeds: [],
    hiddenFeedIds: new Set(),
    now,
  })
  assert.notEqual(result[0].topic, result[1].topic)
  assert.deepEqual(
    result,
    recommendSources({
      entries: [entry(1, "Science"), entry(2, "Tech")],
      subscribedFeeds: [],
      hiddenFeedIds: new Set(),
      now,
    }),
  )
})

test("counts only explicit HTTPS anchor links to exact feed hosts once per entry and excludes self links", () => {
  const content =
    '<!-- <a href="https://www.nature.com/x">x</a> --><script>"<a href="https://www.nature.com/x">"</script><img src="https://www.nature.com/x"><a href="https://www.nature.com/x">one</a><a href="https://www.nature.com/two">two</a><a href="https://www.nature.com.evil/x">bad</a><a href="https://user@www.nature.com/x">bad</a><a href="https://www.nature.com/x">bad</a>'
  const item = entry(1, "unknown", {
    content,
    feed: { site_url: "https://another.example/", category: { title: "unknown" } },
  })
  let result = recommendSources({
    entries: [item, item],
    subscribedFeeds: [],
    hiddenFeedIds: new Set(),
    now,
  })
  assert.equal(result.length, 1)
  assert.equal(result[0].title, "Nature")
  assert.equal(result[0].linkedEntries, 1)
  result = recommendSources({
    entries: [{ ...item, feed: { ...item.feed, site_url: "https://www.nature.com/" } }],
    subscribedFeeds: [],
    hiddenFeedIds: new Set(),
    now,
  })
  assert.equal(result.length, 0)
})

test("excludes a feed host even when its site host differs", () => {
  const item = entry(1, "unknown", {
    content: '<a href="https://www.nature.com/x">x</a>',
    feed: {
      site_url: "https://another.example",
      feed_url: "https://www.nature.com/nature.rss",
      category: { title: "unknown" },
    },
  })
  assert.deepEqual(
    recommendSources({ entries: [item], subscribedFeeds: [], hiddenFeedIds: new Set(), now }),
    [],
  )
})

test("ignores anchors in inert template and noscript content", () => {
  const item = entry(1, "unknown", {
    content:
      '<template><a href="https://www.nature.com/x">x</a></template><noscript><a href="https://www.nature.com/y">y</a></noscript>',
    feed: { site_url: "https://another.example", category: { title: "unknown" } },
  })
  assert.deepEqual(
    recommendSources({ entries: [item], subscribedFeeds: [], hiddenFeedIds: new Set(), now }),
    [],
  )
})

test("includes the exact 30-day boundary but not earlier dates", () => {
  const date = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const entries = [
    entry(1, "science", { published_at: date }),
    entry(2, "science", { published_at: new Date(Date.parse(date) - 1).toISOString() }),
  ]
  const result = recommendSources({ entries, subscribedFeeds: [], hiddenFeedIds: new Set(), now })
  assert.equal(result[0].evidence.entries, 1)
})

test("ignores article content beyond the 65536-character parsing bound", () => {
  const item = entry(1, "unknown", {
    content: `${"x".repeat(65_536)}<a href="https://www.nature.com/x">x</a>`,
    feed: { site_url: "https://another.example", category: { title: "unknown" } },
  })
  assert.deepEqual(
    recommendSources({ entries: [item], subscribedFeeds: [], hiddenFeedIds: new Set(), now }),
    [],
  )
})
