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

const updateRegistration = async (counts, reject) => {
  counts.updates += 1
  if (reject) {
    throw new Error("offline")
  }
}

const createHarness = ({ reject = false } = {}) => {
  const documentObject = new EventTarget()
  documentObject.visibilityState = "hidden"
  const counts = { updates: 0, reloads: 0 }
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
    update: () => updateRegistration(counts, reject),
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

test("offline check failure permits later retries without reload", async () => {
  const harness = createHarness({ reject: true })
  await harness.visibility("visible")
  harness.advance()
  await harness.visibility("visible")
  assert.deepEqual(harness.counts(), [2, 0])
})
