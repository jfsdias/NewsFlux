/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  createArticleSelectionScopeKey,
  getEligibleArticleSelectionIds,
  isArticleSelectionAvailable,
  reconcileArticleSelection,
  toggleArticleSelection,
} from "./article-selection.js"

const scope = {
  from: "feed",
  id: 11,
  showStatus: "unread",
  filterString: "climate",
  filterDate: new Date("2026-10-16T00:00:00.000Z"),
  showHiddenFeeds: false,
  removeDuplicates: "title",
  sessionRevision: 4,
}

const entries = [
  { id: 1, status: "unread" },
  { id: 2, status: "unread" },
  { id: 3, status: "read" },
]

test("HOME_SCOPE and HISTORY_SCOPE are unavailable", () => {
  assert.equal(isArticleSelectionAvailable({ from: "home" }), false)
  assert.equal(isArticleSelectionAvailable({ from: "history" }), false)
  assert.equal(isArticleSelectionAvailable({ from: "all" }), true)
})

test("selection scope identity changes with every membership boundary", () => {
  const base = createArticleSelectionScopeKey(scope)
  const changes = [
    { from: "category", id: 5 },
    { from: "feed", id: 12 },
    { showStatus: "all" },
    { filterString: "weather" },
    { filterDate: new Date("2026-10-17T00:00:00.000Z") },
    { showHiddenFeeds: true },
    { removeDuplicates: "none" },
    { sessionRevision: 5 },
  ]

  for (const change of changes) {
    assert.notEqual(createArticleSelectionScopeKey({ ...scope, ...change }), base)
  }
})

test("sort and pagination changes do not change selection scope identity", () => {
  const base = createArticleSelectionScopeKey(scope)
  assert.equal(createArticleSelectionScopeKey({ ...scope, orderBy: "title" }), base)
  assert.equal(createArticleSelectionScopeKey({ ...scope, page: 2 }), base)
  assert.equal(createArticleSelectionScopeKey({ ...scope, offset: 100 }), base)
})

test("only loaded unread article IDs are eligible", () => {
  assert.deepEqual(getEligibleArticleSelectionIds(entries), new Set([1, 2]))
  assert.equal(getEligibleArticleSelectionIds([{ id: 4, status: "read" }]).has(4), false)
})

test("selection can select one, multiple, and unselect one without touching other IDs", () => {
  const eligible = getEligibleArticleSelectionIds(entries)
  let selected = new Set()
  selected = toggleArticleSelection(selected, 1, eligible)
  assert.deepEqual(selected, new Set([1]))
  selected = toggleArticleSelection(selected, 2, eligible)
  assert.deepEqual(selected, new Set([1, 2]))
  selected = toggleArticleSelection(selected, 1, eligible)
  assert.deepEqual(selected, new Set([2]))
})

test("read entries and unknown IDs cannot be added to selection", () => {
  const eligible = getEligibleArticleSelectionIds(entries)
  assert.deepEqual(toggleArticleSelection(new Set(), 3, eligible), new Set())
  assert.deepEqual(toggleArticleSelection(new Set(), 999, eligible), new Set())
})

test("selection survives a virtualizer row unmount while its entry remains loaded", () => {
  const selected = new Set([2])
  const viewportRows = [{ id: 1, status: "unread" }]
  const loadedFilteredEntries = entries

  assert.deepEqual(reconcileArticleSelection(selected, loadedFilteredEntries), new Set([2]))
  assert.equal(
    viewportRows.some(({ id }) => selected.has(id)),
    false,
  )
})

test("load more preserves existing selection and leaves new IDs unselected", () => {
  const selected = new Set([1])
  const appendedEntries = [...entries, { id: 4, status: "unread" }]

  assert.deepEqual(reconcileArticleSelection(selected, appendedEntries), new Set([1]))
  assert.equal(reconcileArticleSelection(selected, appendedEntries).has(4), false)
})

test("refresh removes entries that disappeared or became read", () => {
  const selected = new Set([1, 2])
  const refreshedEntries = [
    { id: 1, status: "unread" },
    { id: 2, status: "read" },
    { id: 4, status: "unread" },
  ]

  assert.deepEqual(reconcileArticleSelection(selected, refreshedEntries), new Set([1]))
})
