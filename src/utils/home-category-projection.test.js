import assert from "node:assert/strict"
import test from "node:test"

const { createHomeCategoryLanes, projectHomeCategoryEntries } = await import(
  new URL("home-category-projection.js", import.meta.url)
)

const entry = (id, publishedAt, categoryId, categoryTitle, status = "unread") => ({
  id,
  status,
  published_at: publishedAt,
  feed: {
    category: categoryId == null ? null : { id: categoryId, title: categoryTitle },
  },
})

test("HOME_CATEGORY_LANES_REQUIRE_TWO_AND_CAP_CATEGORY_AND_ARTICLE_COUNTS", () => {
  const entries = [
    entry(1, "2026-11-06T10:00:00Z", 10, "World"),
    entry(2, "2026-11-06T09:00:00Z", 10, "World"),
    entry(3, "2026-11-06T08:00:00Z", 10, "World"),
    entry(4, "2026-11-06T07:00:00Z", 10, "World"),
    entry(5, "2026-11-06T06:00:00Z", 20, "Technology"),
    entry(6, "2026-11-06T05:00:00Z", 20, "Technology"),
    entry(7, "2026-11-06T04:00:00Z", 30, "Science"),
    entry(8, "2026-11-06T03:00:00Z", 30, "Science"),
    entry(9, "2026-11-06T02:00:00Z", 40, "Culture"),
    entry(10, "2026-11-06T01:00:00Z", 40, "Culture"),
    entry(11, "2026-11-06T00:00:00Z", 50, "One article"),
  ]

  assert.deepEqual(
    createHomeCategoryLanes({
      entries,
      highlightIds: [1],
      recentIds: entries.slice(1).map(({ id }) => id),
    }),
    [
      { categoryId: 10, categoryTitle: "World", entryIds: [2, 3, 4] },
      { categoryId: 20, categoryTitle: "Technology", entryIds: [5, 6] },
      { categoryId: 30, categoryTitle: "Science", entryIds: [7, 8] },
    ],
  )
})

test("HOME_CATEGORY_LANES_OMIT_EMPTY_AND_SINGLETON_CATEGORIES", () => {
  const entries = [
    entry(1, "2026-11-06T10:00:00Z", 10, "One unread article"),
    entry(2, "2026-11-06T09:00:00Z", 20, "Read only", "read"),
  ]

  assert.deepEqual(createHomeCategoryLanes({ entries, highlightIds: [], recentIds: [1, 2] }), [])
})

test("HOME_CATEGORY_LANES_KEEP_PROJECTION_ORDER_AND_EXCLUDE_HIGHLIGHTS_AND_READ_ITEMS", () => {
  const entries = [
    entry(1, "2026-11-06T10:00:00Z", 10, "World"),
    entry(2, "2026-11-06T09:00:00Z", 10, "World"),
    entry(3, "2026-11-06T08:00:00Z", 20, "Technology"),
    entry(4, "2026-11-06T07:00:00Z", 20, "Technology", "read"),
    entry(5, "2026-11-06T06:00:00Z", 10, "World"),
  ]

  assert.deepEqual(
    createHomeCategoryLanes({ entries, highlightIds: [1], recentIds: [3, 5, 2, 4] }),
    [{ categoryId: 10, categoryTitle: "World", entryIds: [5, 2] }],
  )
})

test("HOME_CATEGORY_LANES_USE_STABLE_TIMESTAMP_TIE_BREAK_AND_KEEP_INVALID_METADATA_IN_LATEST", () => {
  const entries = [
    entry(1, "2026-11-06T10:00:00Z", 20, "Technology"),
    entry(2, "2026-11-06T09:00:00Z", 20, "Technology"),
    entry(3, "2026-11-06T10:00:00Z", 10, "World"),
    entry(4, "2026-11-06T09:00:00Z", 10, "World"),
    entry(5, "2026-11-06T08:00:00Z", 0, "Invalid"),
    entry(6, "2026-11-06T07:00:00Z", 30, " ".repeat(3)),
    entry(7, "2026-11-06T06:00:00Z", null, null),
  ]

  const lanes = createHomeCategoryLanes({
    entries,
    highlightIds: [],
    recentIds: entries.map(({ id }) => id),
  })
  assert.deepEqual(
    lanes.map(({ categoryId }) => categoryId),
    [10, 20],
  )
  assert.deepEqual(
    projectHomeCategoryEntries({ recentIds: [1, 2, 3, 4, 5, 6, 7], categoryLanes: lanes }),
    {
      categoryLanes: lanes,
      latestIds: [5, 6, 7],
      readerRecentIds: [3, 4, 1, 2, 5, 6, 7],
    },
  )
})

test("HOME_CATEGORY_PROJECTION_COVERS_EACH_RECENT_ID_EXACTLY_ONCE", () => {
  const entries = [
    entry(1, "2026-11-06T10:00:00Z", 10, "World"),
    entry(2, "2026-11-06T09:00:00Z", 10, "World"),
    entry(3, "2026-11-06T08:00:00Z", 10, "World"),
    entry(4, "2026-11-06T07:00:00Z", null, null),
  ]
  const lanes = createHomeCategoryLanes({
    entries,
    highlightIds: [],
    recentIds: [1, 1, 2, 3, 4],
  })
  const projection = projectHomeCategoryEntries({
    recentIds: [1, 1, 2, 3, 4],
    categoryLanes: lanes,
  })
  const renderedIds = [...lanes.flatMap(({ entryIds }) => entryIds), ...projection.latestIds]

  assert.deepEqual([...renderedIds].toSorted(), [1, 2, 3, 4])
  assert.equal(new Set(renderedIds).size, renderedIds.length)
})
