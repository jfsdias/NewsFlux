/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import { createMarkAllReadOperationCoordinator } from "./mark-all-read-undo.js"
import runSelectedReadBatches from "./selected-read-operation.js"

const createHarness = () => {
  let sessionRevision = 1
  const acknowledgedEvents = []
  const resultEvents = []
  const coordinator = createMarkAllReadOperationCoordinator()

  return {
    acknowledgedEvents,
    coordinator,
    getSessionRevision: () => sessionRevision,
    resultEvents,
    setSessionRevision: (next) => {
      sessionRevision = next
    },
    run: (updateEntriesStatusInBatches) =>
      runSelectedReadBatches({
        entryIds: [10, 11, 12],
        sessionRevision: 1,
        getCurrentSessionRevision: () => sessionRevision,
        updateEntriesStatusInBatches,
        operationCoordinator: coordinator,
        onBatchAcknowledged: (ids) => acknowledgedEvents.push(ids),
        onResult: (result) => resultEvents.push(result.status),
      }),
  }
}

const acknowledgeInBatches = async (entryIds, _status, { onBatchUpdated }) => {
  for (let start = 0; start < entryIds.length; start += 2) {
    onBatchUpdated(entryIds.slice(start, start + 2))
  }
}

const failAfterFirstBatch = async (entryIds, _status, { onBatchUpdated }) => {
  onBatchUpdated(entryIds.slice(0, 2))
  throw new Error("second batch rejected")
}

test("selected read acknowledges only successful HTTP batches and reports full success", async () => {
  const harness = createHarness()
  const result = await harness.run(acknowledgeInBatches)

  assert.equal(result.status, "success")
  assert.deepEqual(result.acknowledgedIds, [10, 11, 12])
  assert.deepEqual(harness.acknowledgedEvents, [[10, 11], [12]])
  assert.deepEqual(harness.resultEvents, ["success"])
})

test("partial acknowledgement reports only successful batches", async () => {
  const harness = createHarness()
  const result = await harness.run(failAfterFirstBatch)

  assert.equal(result.status, "partial")
  assert.deepEqual(result.acknowledgedIds, [10, 11])
  assert.deepEqual(harness.acknowledgedEvents, [[10, 11]])
})

test("total failure does not create acknowledged IDs", async () => {
  const harness = createHarness()
  const result = await harness.run(async () => {
    throw new Error("first batch rejected")
  })

  assert.equal(result.status, "failure")
  assert.deepEqual(result.acknowledgedIds, [])
  assert.deepEqual(harness.acknowledgedEvents, [])
})

test("a stale session before the first batch sends no request or result callback", async () => {
  const harness = createHarness()
  harness.setSessionRevision(2)
  let requestCount = 0
  const result = await harness.run(async () => {
    requestCount += 1
  })

  assert.equal(result.status, "stale")
  assert.equal(requestCount, 0)
  assert.deepEqual(harness.resultEvents, [])
})

test("a session switch during a request suppresses stale acknowledgement and result callbacks", async () => {
  const harness = createHarness()
  const switchDuringRequest = async (entryIds, _status, { onBatchUpdated }) => {
    harness.setSessionRevision(2)
    onBatchUpdated(entryIds)
  }
  const result = await harness.run(switchDuringRequest)

  assert.equal(result.status, "stale")
  assert.deepEqual(result.acknowledgedIds, [])
  assert.deepEqual(harness.acknowledgedEvents, [])
  assert.deepEqual(harness.resultEvents, [])
})

test("shared coordinator rejects a concurrent selected read", async () => {
  const harness = createHarness()
  const lease = harness.coordinator.acquire(1)
  assert.notEqual(lease, null)
  const result = await harness.run(acknowledgeInBatches)

  assert.equal(result.status, "busy")
  assert.deepEqual(harness.acknowledgedEvents, [])
  harness.coordinator.release(lease)
})

test("coordinator remains owned through result reconciliation", async () => {
  const harness = createHarness()
  let operationWasLockedDuringResult = false
  const result = await runSelectedReadBatches({
    entryIds: [10],
    sessionRevision: 1,
    getCurrentSessionRevision: harness.getSessionRevision,
    operationCoordinator: harness.coordinator,
    updateEntriesStatusInBatches: async (ids, _status, { onBatchUpdated }) => onBatchUpdated(ids),
    onResult: () => {
      operationWasLockedDuringResult = harness.coordinator.acquire(1) === null
    },
  })

  assert.equal(result.status, "success")
  assert.equal(operationWasLockedDuringResult, true)
})
