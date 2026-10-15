import assert from "node:assert/strict"
import test from "node:test"

const {
  createTimedOneShotActionStore,
  createMarkAllReadOperationCoordinator,
  getMarkAllReadUndoNotificationId,
  markAllReadOperationCoordinator,
  markAllReadUndoActions,
  MARK_ALL_READ_UNDO_DURATION_MS,
  performMarkAllReadUndo,
  performCoordinatedMarkAllReadUndo,
} = await import(new URL("mark-all-read-undo.js", import.meta.url))

const createFakeClock = () => {
  let currentTime = 100
  let nextTimerId = 0
  const timers = new Map()

  return {
    advance(milliseconds) {
      currentTime += milliseconds
      for (const [timerId, timer] of timers) {
        if (timer.expiresAt <= currentTime) {
          timers.delete(timerId)
          timer.callback()
        }
      }
    },
    clearTimer(timerId) {
      timers.delete(timerId)
    },
    now: () => currentTime,
    setTimer(callback, milliseconds) {
      const timerId = ++nextTimerId
      timers.set(timerId, { callback, expiresAt: currentTime + milliseconds })
      return timerId
    },
  }
}

test("Undo action lasts eight seconds, expires, and can only be consumed once", () => {
  const clock = createFakeClock()
  const actions = createTimedOneShotActionStore(clock)
  let expired = 0
  const token = actions.replace("captured IDs", {
    durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
    onExpire: () => {
      expired += 1
    },
  })

  assert.equal(actions.getCurrentToken(), token)
  clock.advance(MARK_ALL_READ_UNDO_DURATION_MS - 1)
  assert.equal(expired, 0)
  assert.equal(actions.consume(token), "captured IDs")
  assert.equal(actions.getCurrentToken(), null)
  assert.equal(actions.consume(token), null)

  const expiringToken = actions.replace("next IDs", {
    onExpire: () => {
      expired += 1
    },
  })
  clock.advance(MARK_ALL_READ_UNDO_DURATION_MS)
  assert.equal(expired, 1)
  assert.equal(actions.consume(expiringToken), null)
})

test("replacing an Undo action invalidates the previous action", () => {
  const clock = createFakeClock()
  const actions = createTimedOneShotActionStore(clock)
  let previousExpired = false
  const previousToken = actions.replace("old IDs", {
    onExpire: () => {
      previousExpired = true
    },
  })
  const currentToken = actions.replace("new IDs")

  assert.equal(actions.getCurrentToken(), currentToken)
  assert.equal(actions.consume(previousToken), null)
  assert.equal(actions.consume(currentToken), "new IDs")
  assert.equal(actions.getCurrentToken(), null)
  clock.advance(MARK_ALL_READ_UNDO_DURATION_MS)
  assert.equal(previousExpired, false)
})

test("Undo notification IDs are unique per action generation", () => {
  const clock = createFakeClock()
  const actions = createTimedOneShotActionStore(clock)
  const first = actions.replace("first")
  const second = actions.replace("second")

  assert.notEqual(getMarkAllReadUndoNotificationId(first), getMarkAllReadUndoNotificationId(second))
})

test("Footer and Sidebar use one shared one-shot Undo slot", () => {
  const token = markAllReadUndoActions.replace({ entryIds: [41], source: "footer" })
  assert.equal(markAllReadUndoActions.getCurrentToken(), token)

  const replacement = markAllReadUndoActions.replace({ entryIds: [52], source: "sidebar" })
  assert.notEqual(replacement, token)
  assert.equal(markAllReadUndoActions.consume(token), null)
  assert.deepEqual(markAllReadUndoActions.consume(replacement), {
    entryIds: [52],
    source: "sidebar",
  })
})

test("shared Mark All guard rejects overlap and only releases its own lease", () => {
  const first = markAllReadOperationCoordinator.acquire(7)
  assert.ok(first)
  assert.equal(markAllReadOperationCoordinator.acquire(7), null)

  const nextSession = markAllReadOperationCoordinator.acquire(8)
  assert.ok(nextSession)
  assert.notEqual(nextSession, first)
  assert.equal(markAllReadOperationCoordinator.release(first), false)
  assert.equal(markAllReadOperationCoordinator.acquire(8), null)
  assert.equal(markAllReadOperationCoordinator.release(nextSession), true)
  const finalLease = markAllReadOperationCoordinator.acquire(8)
  assert.ok(finalLease)
  assert.equal(markAllReadOperationCoordinator.release(finalLease), true)
})

const createUndoRunner =
  ({ actions, coordinator, writes, consumedTokens }) =>
  (token) =>
    performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: () => 7,
      undoActions: actions,
      operationCoordinator: coordinator,
      updateEntriesStatusInBatches: async (entryIds) => writes.push(entryIds),
      refreshCounts: async () => {},
      invalidateArticleList: () => {},
      onConsume: consumedTokens ? (consumedToken) => consumedTokens.push(consumedToken) : undefined,
    })

test("UNDO_DURING_ACTIVE_MARK_ALL_NO_CONFLICT: busy Undo preserves its token and performs no mutation", async () => {
  const actions = createTimedOneShotActionStore()
  const coordinator = createMarkAllReadOperationCoordinator()
  const writes = []
  const consumedTokens = []
  const undo = createUndoRunner({ actions, coordinator, writes, consumedTokens })
  const tokenA = actions.replace({ entryIds: [41], sessionRevision: 7 })
  const markAllBLease = coordinator.acquire(7)

  assert.deepEqual(await undo(tokenA), { status: "busy" })
  assert.equal(actions.getCurrentToken(), tokenA)
  assert.deepEqual(consumedTokens, [])
  assert.deepEqual(writes, [])

  coordinator.release(markAllBLease)
  actions.clear(tokenA)
})

test("successful Mark All B replaces Undo A after a busy Undo attempt", async () => {
  const actions = createTimedOneShotActionStore()
  const coordinator = createMarkAllReadOperationCoordinator()
  const writes = []
  const undo = createUndoRunner({ actions, coordinator, writes })
  const tokenA = actions.replace({ entryIds: [41], sessionRevision: 7 })
  const markAllBLease = coordinator.acquire(7)

  assert.deepEqual(await undo(tokenA), { status: "busy" })
  assert.equal(actions.getCurrentToken(), tokenA)
  coordinator.release(markAllBLease)

  const tokenB = actions.replace({ entryIds: [52], sessionRevision: 7 })
  assert.deepEqual(await undo(tokenA), { status: "missing" })
  assert.equal(actions.getCurrentToken(), tokenB)
  assert.deepEqual(writes, [])
  actions.clear(tokenB)
})

test("failed Mark All B releases the guard and preserves Undo A for normal invocation", async () => {
  const actions = createTimedOneShotActionStore()
  const coordinator = createMarkAllReadOperationCoordinator()
  const writes = []
  const undo = createUndoRunner({ actions, coordinator, writes })
  const tokenA = actions.replace({ entryIds: [41], sessionRevision: 7 })
  const markAllBLease = coordinator.acquire(7)

  assert.deepEqual(await undo(tokenA), { status: "busy" })
  assert.equal(actions.getCurrentToken(), tokenA)
  coordinator.release(markAllBLease)

  assert.deepEqual(await undo(tokenA), { status: "success" })
  assert.equal(actions.getCurrentToken(), null)
  assert.deepEqual(writes, [[41]])
})

test("stale sessions are rejected before any Undo mutation or reconciliation", async () => {
  const steps = []
  const result = await performMarkAllReadUndo({
    entryIds: [11, 12],
    sessionRevision: 4,
    getCurrentSessionRevision: () => 5,
    updateEntriesStatusInBatches: async (...args) => steps.push(["update", ...args]),
    refreshCounts: async (...args) => steps.push(["counts", ...args]),
    invalidateArticleList: () => steps.push(["invalidate"]),
  })

  assert.deepEqual(result, { status: "stale" })
  assert.deepEqual(steps, [])
})

test("Undo reverses only captured IDs, then refreshes counts and invalidates the current list", async () => {
  const steps = []
  const result = await performMarkAllReadUndo({
    entryIds: [31, 24],
    sessionRevision: 8,
    getCurrentSessionRevision: () => 8,
    updateEntriesStatusInBatches: async (...args) => steps.push(["update", ...args]),
    refreshCounts: async (...args) => steps.push(["counts", ...args]),
    invalidateArticleList: () => steps.push(["invalidate"]),
  })

  assert.deepEqual(result, { status: "success" })
  assert.deepEqual(steps, [
    ["update", [31, 24], "unread", { sessionRevision: 8 }],
    ["counts", { force: true }],
    ["invalidate"],
  ])
})

test("Undo failures are one-shot and still refresh counts and invalidate the current list", async () => {
  const steps = []
  const failure = new Error("The server outcome for this batch is unknown")
  const result = await performMarkAllReadUndo({
    entryIds: [31, 24],
    sessionRevision: 8,
    getCurrentSessionRevision: () => 8,
    updateEntriesStatusInBatches: async (...args) => {
      steps.push(["update", ...args])
      throw failure
    },
    refreshCounts: async (...args) => steps.push(["counts", ...args]),
    invalidateArticleList: () => steps.push(["invalidate"]),
    onError: (error) => steps.push(["error", error]),
  })

  assert.deepEqual(result, { error: failure, status: "failed" })
  assert.deepEqual(steps, [
    ["update", [31, 24], "unread", { sessionRevision: 8 }],
    ["counts", { force: true }],
    ["invalidate"],
    ["error", failure],
  ])
})
