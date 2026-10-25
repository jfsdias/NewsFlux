import assert from "node:assert/strict"
import { test } from "node:test"

/* eslint-disable import/extensions -- Node's native ESM runner requires explicit extensions. */
import {
  getCurrentZeroUnreadSource,
  getGroupedUnreadNavigationFeeds,
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

const categorizedFeeds = [
  { id: 101, title: "Alpha News Daily", unreadCount: 3, category: { id: 10, title: "News" } },
  { id: 102, title: "Alpha Tech Wire", unreadCount: 0, category: { id: 20, title: "Tech" } },
  { id: 103, title: "Beta Morning Digest", unreadCount: 1, category: { id: 10, title: "News" } },
  { id: 104, title: "Gamma Science Daily", unreadCount: 5, category: { id: 30, title: "Science" } },
  { id: 105, title: "Delta Journal", unreadCount: 0, category: { id: 40, title: "EmptyCategory" } },
  {
    id: 106,
    title: "Orphaned Feed Daily",
    unreadCount: 4,
    category: { id: 999, title: "UnknownCategory" },
  },
]

const testCategories = [
  { id: 10, title: "News" },
  { id: 20, title: "Tech" },
  { id: 30, title: "Science" },
  { id: 40, title: "EmptyCategory" },
]

test("getGroupedUnreadNavigationFeeds groups unread feeds by category in canonical category order", () => {
  const result = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds)
  assert.deepEqual(result, [
    {
      category: testCategories[0],
      feeds: [categorizedFeeds[0], categorizedFeeds[2]],
    },
    {
      category: testCategories[2],
      feeds: [categorizedFeeds[3]],
    },
  ])
})

test("getGroupedUnreadNavigationFeeds preserves category order matching categories input", () => {
  const reorderedCategories = [testCategories[2], testCategories[0]]
  const result = getGroupedUnreadNavigationFeeds(reorderedCategories, categorizedFeeds)
  assert.equal(result.length, 2)
  assert.equal(result[0].category.id, 30)
  assert.equal(result[1].category.id, 10)
})

test("getGroupedUnreadNavigationFeeds preserves feed order within categories", () => {
  const result = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds)
  const newsGroup = result.find((group) => group.category.id === 10)
  assert.ok(newsGroup)
  assert.deepEqual(
    newsGroup.feeds.map((f) => f.id),
    [101, 103],
  )
})

test("getGroupedUnreadNavigationFeeds excludes zero-unread feeds and empty categories", () => {
  const result = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds)
  // Tech (id 20) and EmptyCategory (id 40) only have 0-unread feeds
  assert.equal(
    result.some((g) => g.category.id === 20),
    false,
  )
  assert.equal(
    result.some((g) => g.category.id === 40),
    false,
  )
  // No feed in any group has unreadCount === 0
  for (const group of result) {
    for (const feed of group.feeds) {
      assert.ok(feed.unreadCount > 0)
    }
  }
})

test("getGroupedUnreadNavigationFeeds filters with search query across single and multiple categories", () => {
  // Query matching single category
  const singleMatch = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds, "gamma")
  assert.deepEqual(singleMatch, [
    {
      category: testCategories[2],
      feeds: [categorizedFeeds[3]],
    },
  ])

  // Real multi-category search: "daily" matches Alpha News Daily (News) and Gamma Science Daily (Science)
  const multiMatch = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds, "daily")
  assert.deepEqual(multiMatch, [
    {
      category: testCategories[0],
      feeds: [categorizedFeeds[0]],
    },
    {
      category: testCategories[2],
      feeds: [categorizedFeeds[3]],
    },
  ])
  assert.equal(multiMatch[0].category.id, 10)
  assert.equal(multiMatch[1].category.id, 30)

  // Query matching zero-unread feed returns empty because unreadCount is 0
  const zeroUnreadMatch = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds, "wire")
  assert.deepEqual(zeroUnreadMatch, [])

  // Query matching nothing
  const noMatch = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds, "nonexistent")
  assert.deepEqual(noMatch, [])
})

test("getGroupedUnreadNavigationFeeds enforces canonical category authority without synthesis", () => {
  // Empty categories array returns empty even when feeds exist
  assert.deepEqual(getGroupedUnreadNavigationFeeds([], categorizedFeeds), [])

  // Feed referencing absent category (id 999) is omitted completely
  const result = getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds)
  const allResultCategoryIds = result.map((g) => g.category.id)
  assert.equal(allResultCategoryIds.includes(999), false)
  const allResultFeedIds = result.flatMap((g) => g.feeds.map((f) => f.id))
  assert.equal(allResultFeedIds.includes(106), false)
})

test("getGroupedUnreadNavigationFeeds does not mutate input arrays or objects", () => {
  const categoriesSnapshot = structuredClone(testCategories)
  const feedsSnapshot = structuredClone(categorizedFeeds)

  getGroupedUnreadNavigationFeeds(testCategories, categorizedFeeds, "daily")

  assert.deepEqual(testCategories, categoriesSnapshot)
  assert.deepEqual(categorizedFeeds, feedsSnapshot)
})

test("getGroupedUnreadNavigationFeeds handles empty or missing inputs gracefully", () => {
  assert.deepEqual(getGroupedUnreadNavigationFeeds(), [])
  assert.deepEqual(getGroupedUnreadNavigationFeeds([], []), [])
  assert.deepEqual(getGroupedUnreadNavigationFeeds(testCategories, []), [])
  assert.deepEqual(getGroupedUnreadNavigationFeeds([], categorizedFeeds), [])
})
