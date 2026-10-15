import assert from "node:assert/strict"
import test from "node:test"

const { markSidebarSourceEntriesAsRead, requestSidebarMarkAllRead } = await import(
  new URL("sidebar-mark-all-read.js", import.meta.url)
)
const { isSidebarSourceListAffected } = await import(
  new URL("sidebar-mark-all-read.js", import.meta.url)
)

test("Sidebar reconciliation targets only the selected feed, category, or category child feed", () => {
  assert.equal(
    isSidebarSourceListAffected({
      scope: "feed",
      sourceId: 11,
      infoFrom: "feed",
      infoId: 11,
    }),
    true,
  )
  assert.equal(
    isSidebarSourceListAffected({
      scope: "category",
      sourceId: 5,
      infoFrom: "category",
      infoId: 5,
    }),
    true,
  )
  assert.equal(
    isSidebarSourceListAffected({
      scope: "category",
      sourceId: 5,
      infoFrom: "feed",
      infoId: 11,
      feedsByCategory: { 5: [{ id: 11 }] },
    }),
    true,
  )
  assert.equal(
    isSidebarSourceListAffected({
      scope: "feed",
      sourceId: 21,
      infoFrom: "feed",
      infoId: 11,
    }),
    false,
  )
})

for (const scope of ["feed", "category"]) {
  test(`${scope} Mark All waits for confirmation when skip is disabled`, () => {
    const steps = []
    let confirmAction
    requestSidebarMarkAllRead({
      scope,
      skipConfirmation: false,
      onConfirm: () => steps.push("mutation"),
      confirm: (action) => {
        steps.push("confirmation")
        confirmAction = action
      },
    })

    assert.deepEqual(steps, ["confirmation"])
    confirmAction()
    assert.deepEqual(steps, ["confirmation", "mutation"])
  })
}

test("skipMarkAllReadConfirmation bypasses Sidebar confirmation", () => {
  const steps = []
  requestSidebarMarkAllRead({
    scope: "feed",
    skipConfirmation: true,
    onConfirm: () => steps.push("mutation"),
    confirm: () => steps.push("confirmation"),
  })

  assert.deepEqual(steps, ["mutation"])
})

test("Feed Mark All batches unread entries from the selected feed only", async () => {
  const calls = []
  const acknowledged = []
  await markSidebarSourceEntriesAsRead({
    scope: "feed",
    sourceId: 17,
    isEntryScopeFullyVisible: (scope, id) => scope === "feed" && id === 17,
    getFeedEntries: async (...args) => {
      calls.push(args)
      return { entries: [] }
    },
    getCategoryEntries: async () => assert.fail("Feed action must not fetch a category"),
    markEntriesAsReadInBatches: async (fetchEntries, options) => {
      await fetchEntries("unread", { limit: 500, offset: 0 })
      options.onBatchMarkedRead([101, 103])
      return 2
    },
    onBatchMarkedRead: (entryIds) => acknowledged.push(...entryIds),
  })

  assert.deepEqual(calls, [[17, "unread", false, { limit: 500, offset: 0 }]])
  assert.deepEqual(acknowledged, [101, 103])
})

test("Category batching explicitly preserves hidden-feed visibility semantics", async () => {
  for (const fullyVisible of [true, false]) {
    let captured
    let fetchArgs
    const acknowledged = []
    await markSidebarSourceEntriesAsRead({
      scope: "category",
      sourceId: 29,
      isEntryScopeFullyVisible: () => fullyVisible,
      getFeedEntries: async () => assert.fail("Category action must not fetch a feed"),
      getCategoryEntries: async (...args) => {
        fetchArgs = args
        return { entries: [] }
      },
      markEntriesAsReadInBatches: async (fetchEntries, options) => {
        captured = options.filterParams
        await fetchEntries("unread", { limit: 500, offset: 0 })
        options.onBatchMarkedRead([201, 202])
      },
      onBatchMarkedRead: (ids) => acknowledged.push(...ids),
    })

    assert.deepEqual(captured, { globally_visible: !fullyVisible })
    assert.deepEqual(fetchArgs, [29, "unread", false, { limit: 500, offset: 0 }])
    assert.deepEqual(acknowledged, [201, 202])
  }
})

test("source batching ignores active list search, date, and status filters", async () => {
  let options
  await markSidebarSourceEntriesAsRead({
    scope: "feed",
    sourceId: 5,
    isEntryScopeFullyVisible: () => true,
    getFeedEntries: async () => ({ entries: [] }),
    getCategoryEntries: async () => ({ entries: [] }),
    markEntriesAsReadInBatches: async (_fetchEntries, batchOptions) => {
      options = batchOptions
    },
    activeListFilters: { search: "should-not-leak", filterDate: "2026-10-15", showStatus: "all" },
  })

  assert.deepEqual(options.filterParams, { globally_visible: false })
})

test("only successfully acknowledged batch IDs are reported to Undo", async () => {
  const acknowledged = new Set()
  const failure = new Error("second batch failed")
  await assert.rejects(
    markSidebarSourceEntriesAsRead({
      scope: "category",
      sourceId: 9,
      isEntryScopeFullyVisible: () => false,
      getFeedEntries: async () => ({ entries: [] }),
      getCategoryEntries: async () => ({ entries: [] }),
      markEntriesAsReadInBatches: async (_fetchEntries, { onBatchMarkedRead }) => {
        onBatchMarkedRead([201, 202])
        throw failure
      },
      onBatchMarkedRead: (ids) => {
        for (const id of ids) {
          acknowledged.add(id)
        }
      },
    }),
    failure,
  )
  assert.deepEqual([...acknowledged], [201, 202])
})
