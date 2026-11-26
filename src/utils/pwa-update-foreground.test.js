import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node native ESM requires explicit extensions.
import createPwaUpdateController from "./pwa-update.js"

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const resolveImmediately = () => Promise.resolve()
const registerServiceWorker = () => resolveImmediately

const updateRegistration = async (counts, reject, completion) => {
  counts.updates += 1
  await completion
  if (reject) {
    throw new Error("offline")
  }
}

const createHarness = ({ reject = false, holdUpdate = false } = {}) => {
  const documentObject = new EventTarget()
  documentObject.visibilityState = "hidden"
  const counts = { updates: 0, reloads: 0 }
  let resolveUpdate
  const updateCompletion = new Promise((resolve) => {
    resolveUpdate = resolve
  })
  if (!holdUpdate) {
    resolveUpdate()
  }
  let value
  let time = 0
  const state = {
    get: () => value,
    set: (next) => {
      value = next
    },
  }
  const serviceWorker = new EventTarget()
  const registration = {
    update: () => updateRegistration(counts, reject, updateCompletion),
  }
  serviceWorker.getRegistration = async () => registration
  createPwaUpdateController({
    registerSW: registerServiceWorker,
    serviceWorker,
    state,
    reload: () => {
      counts.reloads += 1
    },
    documentObject,
    now: () => time,
  })
  return {
    counts: () => [counts.updates, counts.reloads],
    settleUpdate: () => resolveUpdate(),
    advance: () => {
      time += 60_001
    },
    visibility: async (visibilityState) => {
      documentObject.visibilityState = visibilityState
      documentObject.dispatchEvent(new Event("visibilitychange"))
      await flush()
    },
  }
}

test("returning to a visible session checks for updates without reload", async () => {
  const harness = createHarness()
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [1, 0])
})

test("hidden and repeated foreground events do not spam checks", async () => {
  const harness = createHarness()
  await harness.visibility("hidden")
  assert.deepEqual(harness.counts(), [0, 0])
  await harness.visibility("visible")
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [1, 0])
  harness.advance()
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [2, 0])
})

test("in-flight foreground events do not start overlapping checks", async () => {
  const harness = createHarness({ holdUpdate: true })
  await harness.visibility("visible")
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [1, 0])

  harness.settleUpdate()
  await flush()
  harness.advance()
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [2, 0])
})

test("offline check failure permits later retries without reload", async () => {
  const harness = createHarness({ reject: true })
  await harness.visibility("visible")
  harness.advance()
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [2, 0])
})
