import assert from "node:assert/strict"
import test from "node:test"

const batchModule = await import(new URL("entry-id-batches.js", import.meta.url)).catch(() => ({}))
const relativeModule = await import(new URL("mark-relative-read.js", import.meta.url)).catch(
  () => ({}),
)
const undoModule = await import(new URL("mark-all-read-undo.js", import.meta.url))

const { updateEntryIdsInBatches } = batchModule
const { markRelativeEntriesAsRead } = relativeModule
const { performMarkAllReadUndo } = undoModule

const range = (count, start = 1) => Array.from({ length: count }, (_, index) => start + index)

const createProvider = ({ batchSize = 2, failOnCall = null, sessionRevision = () => 1 } = {}) => {
  const calls = []
  const send = async (batch) => {
    calls.push([...batch])
    if (failOnCall === calls.length) {
      throw new Error(`batch ${calls.length} failed`)
    }
  }
  const updateEntriesStatusInBatches = (entryIds, status, options = {}) => {
    assert.equal(typeof updateEntryIdsInBatches, "function", "batch helper missing")
    return updateEntryIdsInBatches({
      entryIds: [...new Set(entryIds)],
      batchSize,
      send: (batch) => send(batch, status),
      sessionRevision: options.sessionRevision ?? 1,
      getSessionRevision: sessionRevision,
      onBatchUpdated: options.onBatchUpdated,
    })
  }
  return { calls, updateEntriesStatusInBatches }
}

const run = (provider, entryIds, extra = {}) => {
  assert.equal(typeof markRelativeEntriesAsRead, "function", "relative mutation helper missing")
  return markRelativeEntriesAsRead({
    entryIds,
    sessionRevision: 1,
    updateEntriesStatusInBatches: provider.updateEntriesStatusInBatches,
    ...extra,
  })
}

test("BATCH_CALLBACK_AFTER_SUCCESS_ONLY", async () => {
  const provider = createProvider({ failOnCall: 2 })
  const acknowledged = []
  assert.equal(typeof updateEntryIdsInBatches, "function", "batch helper missing")
  await assert.rejects(
    updateEntryIdsInBatches({
      entryIds: range(6),
      batchSize: 2,
      send: async (batch) => {
        provider.calls.push([...batch])
        if (provider.calls.length === 2) {
          throw new Error("boom")
        }
      },
      sessionRevision: 1,
      getSessionRevision: () => 1,
      onBatchUpdated: (batch) => acknowledged.push([...batch]),
    }),
    /boom/,
  )
  assert.deepEqual(acknowledged, [[1, 2]])
})

test("FIRST_BATCH_FAILURE_ACK_SET_EMPTY", async () => {
  const provider = createProvider({ failOnCall: 1 })
  const result = await run(provider, range(5))
  assert.equal(result.status, "failed")
  assert.deepEqual(result.acknowledgedIds, [])
  assert.equal(result.requestedCount, 5)
})

test("SECOND_BATCH_FAILURE_ACK_SET_FIRST_BATCH_ONLY", async () => {
  const provider = createProvider({ failOnCall: 2 })
  const result = await run(provider, range(5))
  assert.equal(result.status, "partial")
  assert.deepEqual(result.acknowledgedIds, [1, 2])
  assert.equal(result.error.message, "batch 2 failed")
})

test("LATER_BATCHES_NOT_ACKNOWLEDGED_AFTER_FAILURE", async () => {
  const provider = createProvider({ batchSize: 2, failOnCall: 3 })
  const result = await run(provider, range(9))
  assert.deepEqual(result.acknowledgedIds, [1, 2, 3, 4])
  assert.deepEqual(provider.calls, [
    [1, 2],
    [3, 4],
    [5, 6],
  ])
})

test("ACKNOWLEDGED_IDS_DEDUPED", async () => {
  const provider = createProvider({ batchSize: 2 })
  const result = await run(provider, [1, 1, 2, 3, 3, 3])
  assert.equal(result.status, "success")
  assert.deepEqual(result.acknowledgedIds, [1, 2, 3])
  assert.deepEqual(provider.calls, [[1, 2], [3]])
})

test("SUCCESS_REPORTS_EVERY_ID_AND_INVOKES_PER_BATCH_HOOK", async () => {
  const provider = createProvider({ batchSize: 2 })
  const batches = []
  const result = await run(provider, range(5), { onBatchAcknowledged: (ids) => batches.push(ids) })
  assert.equal(result.status, "success")
  assert.deepEqual(result.acknowledgedIds, range(5))
  assert.deepEqual(batches, [[1, 2], [3, 4], [5]])
})

test("EMPTY_ID_SET_IS_A_NOOP_WITHOUT_PROVIDER_CALLS", async () => {
  const provider = createProvider()
  const result = await run(provider, [])
  assert.equal(result.status, "empty")
  assert.deepEqual(result.acknowledgedIds, [])
  assert.deepEqual(provider.calls, [])
})

test("STALE_SESSION_BEFORE_START_SENDS_NOTHING", async () => {
  let current = 1
  const provider = createProvider({ sessionRevision: () => current })
  current = 2
  const result = await run(provider, range(3))
  assert.equal(result.status, "failed")
  assert.deepEqual(provider.calls, [])
  assert.deepEqual(result.acknowledgedIds, [])
})

test("STALE_SESSION_MID_RUN_STOPS_AFTER_ACKNOWLEDGED_BATCH", async () => {
  let current = 1
  const calls = []
  const result = await run(
    {
      updateEntriesStatusInBatches: (entryIds, status, options) =>
        updateEntryIdsInBatches({
          entryIds,
          batchSize: 2,
          send: async (batch) => {
            calls.push([...batch])
            current = 2
          },
          sessionRevision: options.sessionRevision,
          getSessionRevision: () => current,
          onBatchUpdated: options.onBatchUpdated,
        }),
    },
    range(6),
  )
  assert.deepEqual(calls, [[1, 2]])
  assert.equal(result.status, "partial")
  assert.deepEqual(result.acknowledgedIds, [1, 2])
  assert.equal(result.error.message, "Stale entry update session")
})

test("PROVIDER_STATUS_IS_ALWAYS_READ_WITH_EXPLICIT_IDS", async () => {
  const statuses = []
  await run(
    {
      updateEntriesStatusInBatches: async (entryIds, status, options) => {
        statuses.push({ entryIds: [...entryIds], status })
        options.onBatchUpdated(entryIds)
      },
    },
    [4, 2, 9],
  )
  assert.deepEqual(statuses, [{ entryIds: [4, 2, 9], status: "read" }])
})

test("UNDO_USES_ACKNOWLEDGED_IDS_ONLY", async () => {
  const provider = createProvider({ batchSize: 2, failOnCall: 3 })
  const result = await run(provider, range(7))
  assert.equal(result.status, "partial")

  const undoCalls = []
  const undoResult = await performMarkAllReadUndo({
    entryIds: result.acknowledgedIds,
    sessionRevision: 1,
    getCurrentSessionRevision: () => 1,
    updateEntriesStatusInBatches: async (entryIds, status) => {
      undoCalls.push({ entryIds: [...entryIds], status })
    },
    refreshCounts: async () => {},
    invalidateArticleList: () => {},
  })
  assert.equal(undoResult.status, "success")
  assert.deepEqual(undoCalls, [{ entryIds: [1, 2, 3, 4], status: "unread" }])
})

test("UNDO_IS_NOT_OFFERED_WHEN_NOTHING_WAS_ACKNOWLEDGED", async () => {
  const provider = createProvider({ failOnCall: 1 })
  const result = await run(provider, range(3))
  assert.equal(result.acknowledgedIds.length, 0)
})
