import assert from "node:assert/strict"
import { test } from "node:test"

const filterScopeModule = await import(
  new URL("article-list-filter-scope.js", import.meta.url)
).catch(() => ({}))
const { reconcileArticleListFilterScope } = filterScopeModule
const {
  createArticleListSourceIdentityKey,
  isArticleListDateFilterActive,
  isArticleListDateFilterVisible,
} = filterScopeModule
const { default: createArticleListRequestKey } = await import(
  new URL("article-list-request-key.js", import.meta.url)
)

const scope = (from, id = null, showStatus = "all") => ({ from, id, showStatus })
const reconcile = (previousScope, nextScope, filterDate = "2026-10-10", filterString = "linux") => {
  assert.equal(
    typeof reconcileArticleListFilterScope,
    "function",
    "source transitions must reconcile transient date/search filters before list requests",
  )
  return reconcileArticleListFilterScope({ previousScope, nextScope, filterDate, filterString })
}

test("DATE_FEED_TO_FEED_RESET", () => {
  assert.deepEqual(reconcile(scope("feed", 1), scope("feed", 2)), {
    sourceChanged: true,
    scopeChanged: true,
    filterDate: null,
    filterString: "",
  })
})

test("DATE_FEED_TO_CATEGORY_RESET", () => {
  assert.equal(reconcile(scope("feed", 1), scope("category", 2)).filterDate, null)
})

test("DATE_CATEGORY_TO_FEED_RESET", () => {
  assert.equal(reconcile(scope("category", 1), scope("feed", 2)).filterDate, null)
})

test("DATE_ALL_TO_FEED_RESET", () => {
  assert.equal(reconcile(scope("all"), scope("feed", 2)).filterDate, null)
})

test("DATE_FEED_TO_ALL_RESET", () => {
  assert.equal(reconcile(scope("feed", 2), scope("all")).filterDate, null)
})

test("DATE_ENTER_TODAY_RESET", () => {
  assert.equal(reconcile(scope("feed", 2), scope("today")).filterDate, null)
})

test("DATE_TODAY_HIDDEN_STATE_INVARIANT", () => {
  assert.equal(reconcile(scope("today"), scope("today")).filterDate, null)
})

test("DATE_LEAVE_TODAY_NO_RESURRECTION", () => {
  const enteredToday = reconcile(scope("feed", 2), scope("today"))
  assert.equal(
    reconcile(scope("today"), scope("feed", 2), enteredToday.filterDate).filterDate,
    null,
  )
})

test("DATE_ENTER_HOME_RESET", () => {
  assert.equal(reconcile(scope("feed", 2), scope("home")).filterDate, null)
})

test("DATE_HOME_NO_HIDDEN_STATE", () => {
  assert.equal(reconcile(scope("home"), scope("home")).filterDate, null)
})

test("DATE_HOME_TO_ALL_CLEARS_DATE_BUT_PRESERVES_EXPLICIT_SEARCH_HANDOFF", () => {
  assert.deepEqual(reconcile(scope("home"), scope("all")), {
    sourceChanged: true,
    scopeChanged: true,
    filterDate: null,
    filterString: "linux",
  })
})

test("DATE_STATUS_CHANGE_PRESERVE", () => {
  const result = reconcile(scope("feed", 2, "unread"), scope("feed", 2, "all"), "2026-10-10")
  assert.equal(result.filterDate, "2026-10-10")
  assert.equal(result.filterString, "")
  assert.equal(result.sourceChanged, false)
})

test("DATE_SEARCH_CHANGE_PRESERVE", () => {
  assert.equal(
    reconcile(scope("feed", 2), scope("feed", 2), "2026-10-10", "kernel").filterDate,
    "2026-10-10",
  )
})

test("DATE_SEARCH_CLEAR_PRESERVE", () => {
  const result = reconcile(scope("feed", 2), scope("feed", 2), "2026-10-10", "")
  assert.equal(result.filterDate, "2026-10-10")
  assert.equal(result.filterString, "")
})

test("DATE_READER_RETURN_REFRESH_PAGINATION_AND_SORT_CHANGE_PRESERVE", () => {
  for (const action of ["reader-return", "refresh", "pagination", "sort-change"]) {
    const result = reconcile(scope("feed", 2), scope("feed", 2), "2026-10-10")
    assert.equal(result.filterDate, "2026-10-10", action)
    assert.equal(result.filterString, "linux", action)
  }
})

test("DATE_CLEAR_CURRENT_SCOPE", () => {
  const result = reconcile(scope("category", 2), scope("category", 2), null)
  assert.equal(result.filterDate, null)
  assert.equal(result.filterString, "linux")
})

test("DATE_VISIBLE_STATE_PARITY", () => {
  assert.equal(isArticleListDateFilterVisible({ from: "feed" }), true)
  assert.equal(isArticleListDateFilterActive({ from: "feed", filterDate: "2026-10-10" }), true)
  for (const from of ["today", "home"]) {
    assert.equal(isArticleListDateFilterVisible({ from }), false)
    assert.equal(isArticleListDateFilterActive({ from, filterDate: "2026-10-10" }), false)
  }
})

test("DATE_SOURCE_CHANGE_REQUEST_NO_LEAK", () => {
  const currentContent = {
    articleListRevision: 0,
    filterDate: "2026-10-10",
    filterString: "linux",
    infoFrom: "feed",
    infoId: 1,
  }
  const settings = {
    orderBy: "published_at",
    orderDirection: "desc",
    pageSize: 20,
    showHiddenFeeds: false,
    showStatus: "all",
  }
  const transition = reconcile(scope("feed", 1), scope("feed", 2))
  const nextContent = { ...currentContent, ...transition, infoFrom: "feed", infoId: 2 }
  const nextKey = createArticleListRequestKey({
    content: nextContent,
    settings,
    info: { from: "feed", id: 2 },
    sessionRevision: 1,
  })
  const oldDateKey = createArticleListRequestKey({
    content: { ...nextContent, filterDate: "2026-10-10" },
    settings,
    info: { from: "feed", id: 2 },
    sessionRevision: 1,
  })

  assert.equal(JSON.parse(nextKey).filterDate, null)
  assert.notEqual(nextKey, oldDateKey)
})

test("source identity excludes status but includes the source ID", () => {
  assert.equal(
    createArticleListSourceIdentityKey(scope("feed", 2, "unread")),
    createArticleListSourceIdentityKey(scope("feed", "2", "all")),
  )
  assert.notEqual(
    createArticleListSourceIdentityKey(scope("feed", 2)),
    createArticleListSourceIdentityKey(scope("feed", 3)),
  )
})
