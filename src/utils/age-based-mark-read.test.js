import assert from "node:assert/strict"
import test from "node:test"

const module = await import(new URL("age-based-mark-read.js", import.meta.url)).catch(() => ({}))
const {
  getAgeBasedUnreadTargetIds,
  getAgeReadConfirmationBoundaries,
  getAgeReadCutoffTimestamp,
  markAgeBasedUnreadEntriesAsRead,
} = module

const entry = (id, publishedAt, status = "unread") => ({ id, published_at: publishedAt, status })
const cutoffFor = (days, now = Date.UTC(2026, 9, 16, 12)) => {
  assert.equal(typeof getAgeReadCutoffTimestamp, "function", "age cutoff helper missing")
  return getAgeReadCutoffTimestamp(days, now)
}

test("AGE_1D_SCOPE", () => {
  const now = Date.UTC(2026, 9, 16, 12)
  assert.equal(cutoffFor(1, now), Math.floor(now / 1000) - 86_400)
})

test("AGE_7D_SCOPE", () => {
  const now = Date.UTC(2026, 9, 16, 12)
  assert.equal(cutoffFor(7, now), Math.floor(now / 1000) - 7 * 86_400)
})

test("AGE_30D_SCOPE", () => {
  const now = Date.UTC(2026, 9, 16, 12)
  assert.equal(cutoffFor(30, now), Math.floor(now / 1000) - 30 * 86_400)
})

test("AGE_PRESETS_REJECT_UNSUPPORTED_DURATIONS", () => {
  assert.equal(typeof getAgeReadCutoffTimestamp, "function", "age cutoff helper missing")
  assert.throws(() => getAgeReadCutoffTimestamp(2, Date.now()), RangeError)
})

test("STRICT_CUTOFF_BOUNDARY_AND_UNREAD_INTERSECTION", () => {
  assert.equal(typeof getAgeBasedUnreadTargetIds, "function", "age target helper missing")
  const cutoff = 1_797_000_000
  assert.deepEqual(
    getAgeBasedUnreadTargetIds(
      [
        entry("older", new Date((cutoff - 1) * 1000).toISOString()),
        entry("boundary", new Date(cutoff * 1000).toISOString()),
        entry("newer", new Date((cutoff + 1) * 1000).toISOString()),
        entry("read", new Date((cutoff - 20) * 1000).toISOString(), "read"),
        entry("unknown", "not-a-date"),
      ],
      cutoff,
    ),
    ["older"],
  )
})

test("ORDER_ASC_DESC_INVARIANT", () => {
  assert.equal(typeof getAgeBasedUnreadTargetIds, "function", "age target helper missing")
  const cutoff = 1_797_000_000
  const asc = [entry(1, (cutoff - 20) * 1000), entry(2, (cutoff + 20) * 1000)]
  const desc = asc.toReversed()
  assert.deepEqual(getAgeBasedUnreadTargetIds(asc, cutoff), [1])
  assert.deepEqual(getAgeBasedUnreadTargetIds(desc, cutoff), [1])
})

test("TARGET_IDS_DEDUPED", () => {
  assert.equal(typeof getAgeBasedUnreadTargetIds, "function", "age target helper missing")
  const cutoff = 1_797_000_000
  const old = new Date((cutoff - 20) * 1000).toISOString()
  assert.deepEqual(
    getAgeBasedUnreadTargetIds([entry(1, old), entry(1, old), entry(2, old)], cutoff),
    [1, 2],
  )
})

test("UNLOADED_TARGETS_INCLUDED_AND_ALL_PAGES_PRECEDE_MUTATION", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const cutoff = 1_797_000_000
  const old = new Date((cutoff - 20) * 1000).toISOString()
  const calls = []
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff,
    pageSize: 2,
    sessionRevision: 4,
    getSessionRevision: () => 4,
    fetchEntries: async (status, options) => {
      calls.push(["get", status, options.offset])
      const pages = {
        0: { entries: [entry(1, old), entry(2, old)], total: 5 },
        2: { entries: [entry(2, old), entry(3, old)], total: 5 },
        4: { entries: [entry(4, old)], total: 5 },
      }
      return pages[options.offset]
    },
    updateEntriesStatusInBatches: async (ids, status, { onBatchUpdated }) => {
      calls.push(["put", status, ...ids])
      onBatchUpdated(ids)
    },
  })

  assert.equal(result.status, "success")
  assert.deepEqual(result.acknowledgedIds, [1, 2, 3, 4])
  assert.deepEqual(calls.slice(0, 3), [
    ["get", "unread", 0],
    ["get", "unread", 2],
    ["get", "unread", 4],
  ])
  assert.equal(calls[3][0], "put")
})

test("AGE_QUERY_PRESERVES_SEARCH_DATE_AND_VISIBILITY_FILTERS", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const requestOptions = []
  await markAgeBasedUnreadEntriesAsRead({
    cutoff: 1_797_000_000,
    filterParams: {
      filterDate: "2026-10-10",
      globally_visible: false,
      published_after: 1_796_000_000,
      search: "kernel",
      order: "created_at",
      direction: "asc",
    },
    pageSize: 4,
    sessionRevision: 1,
    getSessionRevision: () => 1,
    fetchEntries: async (_status, options) => {
      requestOptions.push(options)
      return { entries: [], total: 0 }
    },
    updateEntriesStatusInBatches: async () => assert.fail("empty target set must not mutate"),
  })

  assert.equal(requestOptions.length, 1)
  assert.deepEqual(requestOptions[0], {
    direction: "asc",
    filterDate: "2026-10-10",
    globally_visible: false,
    limit: 4,
    offset: 0,
    order: "created_at",
    published_after: 1_796_000_000,
    published_before: 1_797_000_000,
    search: "kernel",
  })
})

test("ZERO_TARGETS_DO_NOT_MUTATE_OR_REPORT_SUCCESS", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const cutoff = 1_797_000_000
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff,
    sessionRevision: 1,
    getSessionRevision: () => 1,
    fetchEntries: async () => ({ entries: [entry(1, (cutoff + 1) * 1000)], total: 1 }),
    updateEntriesStatusInBatches: async () => assert.fail("zero targets must not mutate"),
  })
  assert.equal(result.status, "empty")
  assert.deepEqual(result.acknowledgedIds, [])
})

test("MULTI_BATCH_EXPLICIT_ID_MUTATION", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const cutoff = 1_797_000_000
  const old = new Date((cutoff - 20) * 1000).toISOString()
  const writes = []
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff,
    pageSize: 2,
    sessionRevision: 9,
    getSessionRevision: () => 9,
    fetchEntries: async (_status, { offset }) => ({
      entries: offset === 0 ? [entry(1, old), entry(2, old)] : offset === 2 ? [entry(3, old)] : [],
      total: 3,
    }),
    updateEntriesStatusInBatches: async (ids, status, { onBatchUpdated }) => {
      for (let index = 0; index < ids.length; index += 2) {
        const batch = ids.slice(index, index + 2)
        writes.push({ ids: batch, status })
        onBatchUpdated(batch)
      }
    },
  })

  assert.equal(result.status, "success")
  assert.deepEqual(writes, [
    { ids: [1, 2], status: "read" },
    { ids: [3], status: "read" },
  ])
})

test("PARTIAL_FAILURE_RETURNS_ACKNOWLEDGED_IDS_ONLY", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const cutoff = 1_797_000_000
  const old = new Date((cutoff - 20) * 1000).toISOString()
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff,
    sessionRevision: 3,
    getSessionRevision: () => 3,
    fetchEntries: async () => ({
      entries: [entry(1, old), entry(2, old), entry(3, old)],
      total: 3,
    }),
    updateEntriesStatusInBatches: async (_ids, _status, { onBatchUpdated }) => {
      onBatchUpdated([1, 2, 999])
      throw new Error("second batch failed")
    },
  })

  assert.equal(result.status, "partial")
  assert.deepEqual(result.acknowledgedIds, [1, 2])
  assert.equal(result.requestedCount, 3)
})

test("FULL_FAILURE_HAS_NO_ACKNOWLEDGED_IDS", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const cutoff = 1_797_000_000
  const old = new Date((cutoff - 20) * 1000).toISOString()
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff,
    sessionRevision: 3,
    getSessionRevision: () => 3,
    fetchEntries: async () => ({ entries: [entry(1, old)], total: 1 }),
    updateEntriesStatusInBatches: async () => {
      throw new Error("provider failed")
    },
  })

  assert.equal(result.status, "failed")
  assert.deepEqual(result.acknowledgedIds, [])
  assert.equal(result.requestedCount, 1)
})

test("STALE_SESSION_DURING_DISCOVERY_ABORTS_BEFORE_MUTATION", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  let sessionRevision = 3
  let writes = 0
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff: 1_797_000_000,
    pageSize: 1,
    sessionRevision,
    getSessionRevision: () => sessionRevision,
    fetchEntries: async () => {
      sessionRevision += 1
      return { entries: [entry(1, "2020-01-01T00:00:00Z")], total: 2 }
    },
    updateEntriesStatusInBatches: async () => {
      writes += 1
    },
  })

  assert.equal(result.status, "stale")
  assert.equal(result.error.message, "Stale age-based mark-as-read session")
  assert.equal(writes, 0)
})

test("STALE_LIST_DURING_DISCOVERY_ABORTS_BEFORE_MUTATION", async () => {
  let isCurrentList = true
  let writes = 0
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff: 1_797_000_000,
    sessionRevision: 3,
    getSessionRevision: () => 3,
    isCurrentList: () => isCurrentList,
    fetchEntries: async () => {
      isCurrentList = false
      return { entries: [entry(1, "2020-01-01T00:00:00Z")], total: 1 }
    },
    updateEntriesStatusInBatches: async () => {
      writes += 1
    },
  })

  assert.equal(result.status, "stale")
  assert.equal(result.error.message, "Stale age-based mark-as-read list")
  assert.equal(writes, 0)
})

test("ACKNOWLEDGEMENTS_MUST_COVER_EVERY_TARGET_FOR_SUCCESS", async () => {
  assert.equal(typeof markAgeBasedUnreadEntriesAsRead, "function", "age mutation helper missing")
  const result = await markAgeBasedUnreadEntriesAsRead({
    cutoff: 1_797_000_000,
    sessionRevision: 1,
    getSessionRevision: () => 1,
    fetchEntries: async () => ({ entries: [entry(1, "2020-01-01T00:00:00Z")], total: 1 }),
    updateEntriesStatusInBatches: async (_ids, _status) => {},
  })

  assert.equal(result.status, "failed")
  assert.deepEqual(result.acknowledgedIds, [])
})

test("TODAY_TIME_BOUNDARY_SINGLE_SNAPSHOT", () => {
  const beforeSecondBoundary = Date.UTC(2026, 9, 16, 12, 0, 0, 999)
  const afterSecondBoundary = beforeSecondBoundary + 1
  const splitTodayBoundary = getAgeReadCutoffTimestamp(1, beforeSecondBoundary)
  const splitAgeCutoff = getAgeReadCutoffTimestamp(1, afterSecondBoundary)

  assert.equal(splitAgeCutoff - splitTodayBoundary, 1)
  assert.equal(
    typeof getAgeReadConfirmationBoundaries,
    "function",
    "confirmation boundaries must be derived from one captured timestamp",
  )

  const sharedBoundaries = getAgeReadConfirmationBoundaries(1, "today", afterSecondBoundary)
  assert.equal(sharedBoundaries.cutoff, sharedBoundaries.publishedAfter)
})

test("TODAY_1D_EXACT_EMPTY_INTERSECTION", () => {
  assert.equal(
    typeof getAgeReadConfirmationBoundaries,
    "function",
    "confirmation boundaries must be derived from one captured timestamp",
  )
  const boundary = getAgeReadConfirmationBoundaries(
    1,
    "today",
    Date.UTC(2026, 9, 16, 12, 0, 0, 999),
  )
  const candidates = [
    entry("before", boundary.publishedAfter - 1),
    entry("boundary", boundary.publishedAfter),
    entry("after", boundary.publishedAfter + 1),
  ]
  const olderThanCutoff = new Set(getAgeBasedUnreadTargetIds(candidates, boundary.cutoff))
  const todayAndOlder = candidates
    .filter(
      (candidate) =>
        candidate.published_at >= boundary.publishedAfter && olderThanCutoff.has(candidate.id),
    )
    .map((candidate) => candidate.id)

  assert.deepEqual(todayAndOlder, [])
})
