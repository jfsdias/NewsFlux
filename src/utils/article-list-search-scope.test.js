import assert from "node:assert/strict"
import { test } from "node:test"

const scopeModule = await import(new URL("article-list-search-scope.js", import.meta.url)).catch(
  () => ({}),
)
const {
  createArticleListSearchScopeKey,
  reconcileArticleListSearchScope,
  resolveArticleListSearchInputValue,
} = scopeModule
const requestKeyModule = await import(new URL("article-list-request-key.js", import.meta.url))
const { default: createArticleListRequestKey } = requestKeyModule

const scope = (from, id = null, showStatus = "all") => ({ from, id, showStatus })
const reconcile = (previousScope, nextScope, filterString = "linux") => {
  assert.equal(
    typeof reconcileArticleListSearchScope,
    "function",
    "the active article-list scope must reconcile its query before fetching",
  )
  return reconcileArticleListSearchScope({ previousScope, nextScope, filterString })
}
const resolveSearchInput = (input) => {
  assert.equal(
    typeof resolveArticleListSearchInputValue,
    "function",
    "the visible search input must follow the active scope after navigation",
  )
  return resolveArticleListSearchInputValue(input)
}

test("Feed-to-Feed scope change clears the active query", () => {
  assert.deepEqual(reconcile(scope("feed", 11), scope("feed", 12)), {
    scopeChanged: true,
    filterString: "",
  })
})

test("Feed-to-Category scope change clears the active query", () => {
  assert.deepEqual(reconcile(scope("feed", 11), scope("category", 5)), {
    scopeChanged: true,
    filterString: "",
  })
})

test("Category-to-Feed scope change clears the active query", () => {
  assert.deepEqual(reconcile(scope("category", 5), scope("feed", 11)), {
    scopeChanged: true,
    filterString: "",
  })
})

test("All-to-Unread status scope change clears the active query", () => {
  assert.deepEqual(reconcile(scope("all", null, "all"), scope("all", null, "unread")), {
    scopeChanged: true,
    filterString: "",
  })
})

test("Unread-to-All status scope change clears the active query", () => {
  assert.deepEqual(reconcile(scope("all", null, "unread"), scope("all", null, "all")), {
    scopeChanged: true,
    filterString: "",
  })
})

test("All-to-Feed and Feed-to-All source changes clear the active query", () => {
  assert.deepEqual(reconcile(scope("all"), scope("feed", 11)), {
    scopeChanged: true,
    filterString: "",
  })
  assert.deepEqual(reconcile(scope("feed", 11), scope("all")), {
    scopeChanged: true,
    filterString: "",
  })
})

test("Category-to-Category source changes clear the active query", () => {
  assert.deepEqual(reconcile(scope("category", 5), scope("category", 8)), {
    scopeChanged: true,
    filterString: "",
  })
})

test("Starred and Today scope changes clear the active query", () => {
  assert.deepEqual(reconcile(scope("starred"), scope("feed", 11)), {
    scopeChanged: true,
    filterString: "",
  })
  assert.deepEqual(reconcile(scope("today"), scope("feed", 11)), {
    scopeChanged: true,
    filterString: "",
  })
})

test("same-scope reader return, refresh, and pagination preserve the query", () => {
  const currentScope = scope("feed", 11, "unread")
  for (const transition of ["reader-return", "refresh", "pagination"]) {
    assert.deepEqual(
      reconcile(currentScope, currentScope),
      {
        scopeChanged: false,
        filterString: "linux",
      },
      transition,
    )
  }
})

test("scope reset produces the same empty query the search UI must display", () => {
  const result = reconcile(scope("feed", 11), scope("feed", 12))
  assert.equal(result.filterString, "")
})

test("clearing search in the current scope does not change that scope", () => {
  assert.deepEqual(reconcile(scope("category", 5), scope("category", 5), ""), {
    scopeChanged: false,
    filterString: "",
  })
})

test("Home's existing explicit search handoff to All keeps its submitted query", () => {
  assert.deepEqual(reconcile(scope("home"), scope("all")), {
    scopeChanged: true,
    filterString: "linux",
  })
})

test("entering Home from a list scope clears the list query", () => {
  assert.deepEqual(reconcile(scope("all"), scope("home")), {
    scopeChanged: true,
    filterString: "",
  })
})

test("scope identity uses source kind, source ID, and status rather than labels", () => {
  assert.equal(
    createArticleListSearchScopeKey(scope("feed", 11)),
    createArticleListSearchScopeKey(scope("feed", "11")),
  )
  assert.notEqual(
    createArticleListSearchScopeKey(scope("feed", 11)),
    createArticleListSearchScopeKey(scope("feed", 12)),
  )
  assert.notEqual(
    createArticleListSearchScopeKey(scope("feed", 11)),
    createArticleListSearchScopeKey(scope("category", 11)),
  )
  assert.notEqual(
    createArticleListSearchScopeKey(scope("all", null, "all")),
    createArticleListSearchScopeKey(scope("all", null, "unread")),
  )
})

test("scope identity ignores date filters outside FILTER-01A", () => {
  assert.equal(
    createArticleListSearchScopeKey({ ...scope("feed", 11), filterDate: "2026-10-15" }),
    createArticleListSearchScopeKey({ ...scope("feed", 11), filterDate: "2026-10-14" }),
  )
})

test("a stale modal draft cannot remain visible after the scope changes", () => {
  assert.equal(
    resolveSearchInput({
      activeQuery: "",
      activeScopeKey: "feed:12:all",
      draftQuery: "linux",
      draftScopeKey: "feed:11:all",
      draftValue: "linux",
    }),
    "",
  )
})

test("a modal draft remains editable before it is confirmed in the same scope", () => {
  assert.equal(
    resolveSearchInput({
      activeQuery: "linux",
      activeScopeKey: "feed:11:all",
      draftQuery: "linux",
      draftScopeKey: "feed:11:all",
      draftValue: "linux kernel",
    }),
    "linux kernel",
  )
})

test("changing scope and clearing search invalidates the prior scoped request key", () => {
  const content = {
    articleListRevision: 0,
    filterDate: null,
    filterString: "linux",
    infoFrom: "feed",
    infoId: 11,
  }
  const settings = {
    orderBy: "created_at",
    orderDirection: "desc",
    pageSize: 20,
    showStatus: "all",
  }
  const oldKey = createArticleListRequestKey({
    content,
    settings,
    info: { from: "feed", id: 11 },
    sessionRevision: 1,
  })
  const newKey = createArticleListRequestKey({
    content: { ...content, filterString: "" },
    settings,
    info: { from: "category", id: 5 },
    sessionRevision: 1,
  })
  assert.notEqual(oldKey, newKey)
})
