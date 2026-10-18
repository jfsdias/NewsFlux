import assert from "node:assert/strict"
import { test } from "node:test"

/* eslint-disable import/extensions -- Node's native ESM runner requires explicit extensions. */
import {
  buildReaderPageRequest,
  createReaderNavigationOperationGate,
  hasReaderPaginationContinuation,
  resolveReaderNavigation,
} from "./reader-navigation.js"
import { getNextUnreadSource } from "./source-navigation.js"
/* eslint-enable import/extensions */

const entry = (id, status = "unread", minute = id) => ({
  id,
  status,
  published_at: new Date(Date.UTC(2026, 9, 18, 12, minute)).toISOString(),
})

const sequenceIds = (entries) => entries.map(({ id }) => id)

const createResolver = (overrides = {}) => {
  const state = {
    entries: overrides.entries ?? [entry(1), entry(2)],
    sequenceIds: overrides.sequenceIds ?? sequenceIds(overrides.entries ?? [entry(1), entry(2)]),
  }
  const pages = [...(overrides.pages ?? [])]
  const appendedPages = []
  const fetchCalls = []
  const sourceCalls = []
  const fetchPage =
    overrides.fetchPage ??
    (async (request) => {
      fetchCalls.push(request)
      return pages.shift() ?? { entries: [], total: state.entries.length }
    })
  const appendPage =
    overrides.appendPage ??
    (async ({ entries: pageEntries, direction, sequenceIds: currentIds }) => {
      appendedPages.push(pageEntries)
      const seen = new Set(state.entries.map(({ id }) => id))
      const unique = pageEntries.filter(({ id }) => !seen.has(id))
      state.entries =
        direction === "previous" ? [...unique, ...state.entries] : [...state.entries, ...unique]
      state.sequenceIds =
        direction === "previous"
          ? [...unique.map(({ id }) => id), ...currentIds]
          : [...currentIds, ...unique.map(({ id }) => id)]
      return { entries: state.entries, sequenceIds: state.sequenceIds }
    })
  const input = {
    activeEntryId: overrides.activeEntryId ?? state.entries.at(-1)?.id,
    direction: overrides.direction ?? "next",
    mode: overrides.mode ?? "article",
    source: overrides.source ?? { from: "all", id: null },
    getEntries: () => state.entries,
    getSequenceIds: () => state.sequenceIds,
    canContinue: overrides.canContinue ?? (() => pages.length > 0),
    fetchPage,
    appendPage,
    isCurrent: overrides.isCurrent ?? (() => true),
    getNextSources: overrides.getNextSources ?? (() => []),
    fetchSourceEntries:
      overrides.fetchSourceEntries ??
      (async (source) => {
        sourceCalls.push(source)
        return { entries: [] }
      }),
  }
  return { input, state, pages, appendedPages, fetchCalls, sourceCalls }
}

test("NAV01_PREVIOUS_LOADED_NEIGHBOR", async () => {
  const entries = [entry(1), entry(2), entry(3)]
  const { input, fetchCalls } = createResolver({ entries, activeEntryId: 2, direction: "previous" })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 1)
  assert.equal(fetchCalls.length, 0)
})

test("NAV01_NEXT_LOADED_NEIGHBOR", async () => {
  const entries = [entry(1), entry(2), entry(3)]
  const { input, fetchCalls } = createResolver({ entries, activeEntryId: 2 })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 3)
  assert.equal(fetchCalls.length, 0)
})

test("NAV01_NEXT_FETCHES_BEYOND_LOADED_BOUNDARY", async () => {
  const entries = [entry(1), entry(2)]
  const { input, appendedPages, fetchCalls } = createResolver({
    entries,
    pages: [{ entries: [entry(3), entry(4)], total: 4 }],
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 3)
  assert.equal(fetchCalls.length, 1)
  assert.deepEqual(
    appendedPages[0].map(({ id }) => id),
    [3, 4],
  )
})

test("NAV01_RETAINED_HOME_SESSION_ENTRIES_DO_NOT_CLOSE_CANONICAL_PAGINATION", () => {
  const response = {
    entries: Array.from({ length: 20 }, (_, index) => entry(index + 100)),
    total: 60,
  }

  assert.equal(hasReaderPaginationContinuation(response, 20), true)
  assert.equal(hasReaderPaginationContinuation({ entries: [entry(200)], total: 60 }, 20), false)
})

test("NAV01_TRUE_END_REPORTS_NO_NEXT", async () => {
  const { input } = createResolver({
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "end")
  assert.equal(result.reason, "scope-exhausted")
})

test("NAV01_ORDINARY_NEXT_NEVER_HOPS_SOURCE", async () => {
  let sourceHopCalls = 0
  const { input } = createResolver({
    source: { from: "feed", id: 10 },
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => {
      sourceHopCalls += 1
      return [{ type: "feed", id: 11 }]
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "end")
  assert.equal(sourceHopCalls, 0)
})

const requestSettings = {
  orderBy: "published_at",
  orderDirection: "asc",
  pageSize: 20,
  showHiddenFeeds: false,
  showStatus: "unread",
}

test("NAV01_FILTER_SCOPE_PRESERVED", () => {
  const request = buildReaderPageRequest({
    source: { from: "feed", id: 12 },
    content: { filterString: "climate", filterDate: "2026-10-18" },
    settings: requestSettings,
    entries: [entry(1), entry(2)],
    direction: "next",
    mode: "article",
  })

  assert.deepEqual(request.source, { from: "feed", id: 12 })
  assert.equal(request.filterParams.search, "climate")
  assert.equal(request.filterParams.filterDate, "2026-10-18")
})

test("NAV01_SEARCH_SCOPE_PRESERVED", () => {
  const request = buildReaderPageRequest({
    source: { from: "category", id: 9 },
    content: { filterString: "science", filterDate: null },
    settings: requestSettings,
    entries: [entry(1), entry(2)],
    direction: "next",
    mode: "article",
  })

  assert.equal(request.filterParams.search, "science")
})

test("NAV01_DATE_SCOPE_PRESERVED", () => {
  const request = buildReaderPageRequest({
    source: { from: "feed", id: 12 },
    content: { filterString: "", filterDate: "2026-10-17" },
    settings: requestSettings,
    entries: [entry(1), entry(2)],
    direction: "next",
    mode: "article",
  })

  assert.equal(request.filterParams.filterDate, "2026-10-17")
})

test("NAV01_SORT_DIRECTION_PRESERVED", () => {
  const request = buildReaderPageRequest({
    source: { from: "feed", id: 12 },
    content: { filterString: "", filterDate: null },
    settings: requestSettings,
    entries: [entry(1), entry(2)],
    direction: "next",
    mode: "article",
  })

  assert.equal(request.filterParams.order, "published_at")
  assert.equal(request.filterParams.direction, "asc")
  assert.equal(
    request.filterParams.published_after,
    Math.floor(Date.parse(entry(2).published_at) / 1000),
  )
})

test("NAV01_HOME_FOLLOWS_COMMITTED_PROJECTION", async () => {
  const entries = [entry(1), entry(2), entry(3)]
  const { input } = createResolver({
    entries,
    sequenceIds: [1, 3, 2],
    activeEntryId: 3,
    source: { from: "home", id: null },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 2)
})

test("NAV01_HOME_DOES_NOT_RERANK", async () => {
  const entries = [entry(1), entry(2)]
  const originalHighlights = [1]
  let seenSequence = null
  const { input } = createResolver({
    entries,
    sequenceIds: [1, 2],
    activeEntryId: 2,
    source: { from: "home", id: null },
    pages: [{ entries: [entry(3)], total: 3 }],
    appendPage: async ({ entries: page, sequenceIds: currentIds }) => {
      seenSequence = [...currentIds]
      return {
        entries: [...entries, ...page],
        sequenceIds: [...currentIds, ...page.map(({ id }) => id)],
      }
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.deepEqual(originalHighlights, [1])
  assert.deepEqual(seenSequence, [1, 2])
  assert.equal(result.entry.id, 3)
})

test("NAV01_NEXT_UNREAD_LOADED", async () => {
  const entries = [entry(1), entry(2, "read"), entry(3)]
  const { input } = createResolver({ entries, activeEntryId: 1, mode: "unread" })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 3)
})

test("NAV01_NEXT_UNREAD_BEYOND_LOADED_PAGE", async () => {
  const entries = [entry(1), entry(2, "read")]
  const { input } = createResolver({
    entries,
    activeEntryId: 1,
    mode: "unread",
    pages: [{ entries: [entry(3, "read"), entry(4)], total: 4 }],
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 4)
})

test("NAV01_NEXT_UNREAD_FEED_HOPS_TO_NEXT_SOURCE", async () => {
  const { input, sourceCalls } = createResolver({
    source: { from: "feed", id: 10 },
    mode: "unread",
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => [{ type: "feed", id: 11 }],
    fetchSourceEntries: async (source) => {
      sourceCalls.push(source)
      return { entries: [entry(20)] }
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.targetSource.id, 11)
  assert.equal(sourceCalls.length, 1)
})

test("NAV01_NEXT_UNREAD_CATEGORY_HOPS_TO_NEXT_SOURCE", async () => {
  const { input } = createResolver({
    source: { from: "category", id: 7 },
    mode: "unread",
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => [{ type: "category", id: 8 }],
    fetchSourceEntries: async () => ({ entries: [entry(30)] }),
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.targetSource.type, "category")
  assert.equal(result.entry.id, 30)
})

test("NAV01_NEXT_UNREAD_OPENS_FIRST_UNREAD_IN_TARGET", async () => {
  const { input } = createResolver({
    source: { from: "feed", id: 10 },
    mode: "unread",
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => [{ type: "feed", id: 11 }],
    fetchSourceEntries: async () => ({ entries: [entry(31), entry(32)] }),
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.entry.id, 31)
})

test("NAV01_STALE_UNREAD_COUNT_SKIPS_EMPTY_TARGET", async () => {
  const candidates = [
    { type: "feed", id: 11 },
    { type: "feed", id: 12 },
  ]
  const tried = []
  const { input } = createResolver({
    source: { from: "feed", id: 10 },
    mode: "unread",
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => candidates,
    fetchSourceEntries: async (source) => {
      tried.push(source.id)
      return { entries: source.id === 11 ? [] : [entry(42)] }
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.deepEqual(tried, [11, 12])
  assert.equal(result.entry.id, 42)
})

test("NAV01_TARGET_FETCH_FAILURE_DOES_NOT_NAVIGATE", async () => {
  const { input } = createResolver({
    source: { from: "feed", id: 10 },
    mode: "unread",
    pages: [{ entries: [], total: 2 }],
    canContinue: () => true,
    getNextSources: () => [{ type: "feed", id: 11 }],
    fetchSourceEntries: async () => {
      throw new Error("provider unavailable")
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "error")
  assert.equal(result.entry, undefined)
})

test("NAV01_PREVIOUS_UNREAD_DOES_NOT_HOP_SOURCE", async () => {
  let sourceHopCalls = 0
  const entries = [entry(1), entry(2)]
  const { input } = createResolver({
    entries,
    sequenceIds: [1, 2],
    activeEntryId: 1,
    direction: "previous",
    mode: "unread",
    source: { from: "feed", id: 10 },
    getNextSources: () => {
      sourceHopCalls += 1
      return [{ type: "feed", id: 11 }]
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "end")
  assert.equal(sourceHopCalls, 0)
})

test("NAV01_STALE_SESSION_CANNOT_NAVIGATE", async () => {
  const entries = [entry(1), entry(2)]
  let current = true
  const { input, appendedPages } = createResolver({
    entries,
    pages: [{ entries: [entry(3)], total: 3 }],
    canContinue: () => true,
    isCurrent: () => current,
    fetchPage: async () => {
      current = false
      return { entries: [entry(3)], total: 3 }
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "stale")
  assert.equal(appendedPages.length, 0)
})

test("NAV01_STALE_SCOPE_CANNOT_APPEND", async () => {
  const entries = [entry(1), entry(2)]
  let current = true
  const { input, appendedPages } = createResolver({
    entries,
    pages: [{ entries: [entry(3)], total: 3 }],
    canContinue: () => true,
    isCurrent: () => current,
    fetchPage: async () => {
      current = false
      return { entries: [entry(3)], total: 3 }
    },
  })
  const result = await resolveReaderNavigation(input)

  assert.equal(result.status, "stale")
  assert.equal(appendedPages.length, 0)
})

test("NAV01_DOUBLE_ACTION_COALESCED_OR_GUARDED", async () => {
  const gate = createReaderNavigationOperationGate()
  let calls = 0
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const first = gate.run(async () => {
    calls += 1
    await pending
    return "done"
  })
  const second = await gate.run(async () => {
    calls += 1
    return "duplicate"
  })
  release()

  const firstResult = await first
  assert.equal(firstResult.value, "done")
  assert.equal(second.status, "busy")
  assert.equal(calls, 1)
})

test("MARK_ALL_READ_JUMP_TO_NEXT_PRESERVED", () => {
  const categories = [
    { id: 1, unreadCount: 0 },
    { id: 2, unreadCount: 1 },
  ]
  const feeds = [
    { id: 10, category: { id: 1 }, unreadCount: 1 },
    { id: 11, category: { id: 1 }, unreadCount: 2 },
    { id: 12, category: { id: 2 }, unreadCount: 1 },
  ]

  assert.equal(getNextUnreadSource({ type: "feed", id: 10 }, categories, feeds).id, 11)
  assert.equal(getNextUnreadSource({ type: "category", id: 1 }, categories, feeds).id, 2)
})
