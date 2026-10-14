import assert from "node:assert/strict"
import { test } from "node:test"

/* eslint-disable import/extensions -- Node's native ESM runner requires explicit extensions. */
import {
  getCurrentZeroUnreadSource,
  getMatchingCategories,
  getSearchExpandedCategoryKeys,
  getUnreadNavigationFeeds,
  getVisibleFeedSearchMatches,
} from "./source-navigation.js"
/* eslint-enable import/extensions */

const feeds = [
  { id: 12, title: "Northwind Daily Briefing", unreadCount: 2 },
  { id: 5, title: "Northwind Local News", unreadCount: 0 },
  { id: 31, title: "Science & Space", unreadCount: 6 },
  { id: 7, title: "Hidden source excluded upstream", unreadCount: 9 },
]

const categories = [
  { id: 2, title: "News" },
  { id: 3, title: "Science" },
  { id: 4, title: "Empty" },
]
const feedsGroupedById = {
  2: [feeds[0], feeds[1]],
  3: [feeds[2]],
  4: [],
}

test("Unread mode returns only positive-count feeds in visible catalog order", () => {
  assert.deepEqual(getUnreadNavigationFeeds(feeds), [feeds[0], feeds[2], feeds[3]])
})

test("Unread mode filters titles case-insensitively without ranking or changing counts", () => {
  const snapshot = structuredClone(feeds)
  assert.deepEqual(getUnreadNavigationFeeds(feeds, "NORTHWIND"), [feeds[0]])
  assert.deepEqual(feeds, snapshot)
})

test("source search filters visible feeds by title and preserves input order", () => {
  assert.deepEqual(getVisibleFeedSearchMatches(feeds, "northwind"), [feeds[0], feeds[1]])
  assert.deepEqual(getVisibleFeedSearchMatches(feeds, " ".repeat(3)), feeds)
})

test("All mode keeps the canonical category list when the query is empty", () => {
  assert.equal(getMatchingCategories(categories, feedsGroupedById, ""), categories)
})

test("All mode keeps only categories with matching visible feeds", () => {
  assert.deepEqual(getMatchingCategories(categories, feedsGroupedById, "space"), [categories[1]])
})

test("search-time category expansion reveals matches without changing saved expansion", () => {
  const savedExpansion = ["/category/2"]
  const expandedForSearch = getSearchExpandedCategoryKeys(savedExpansion, ["/category/3"], "space")

  assert.deepEqual(expandedForSearch, ["/category/2", "/category/3"])
  assert.deepEqual(savedExpansion, ["/category/2"])
  assert.equal(getSearchExpandedCategoryKeys(savedExpansion, ["/category/3"], ""), savedExpansion)
})

test("Current source only retains an active feed that transitioned to zero in Unread mode", () => {
  assert.equal(getCurrentZeroUnreadSource(feeds, 5, true, null), null)
  assert.equal(getCurrentZeroUnreadSource(feeds, 5, true, 5), feeds[1])
  assert.equal(getCurrentZeroUnreadSource(feeds, 5, false, 5), null)
  assert.equal(getCurrentZeroUnreadSource(feeds, 12, true, 5), null)
  assert.equal(getCurrentZeroUnreadSource(feeds, 999, true, 999), null)
})

test("Current source lookup respects the supplied visible-feed collection", () => {
  assert.equal(getCurrentZeroUnreadSource(feeds.slice(0, 2), 7, true), null)
})
