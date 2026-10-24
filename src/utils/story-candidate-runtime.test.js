import assert from "node:assert/strict"
import test from "node:test"

// Node's direct test runner requires the extension; Vite resolves the same module.
const { default: startHomeStoryCandidateRuntime } = await import(
  // eslint-disable-next-line import/extensions
  "./story-candidate-runtime.js",
)

const makeEntry = (id) => ({
  id,
  title: `Headline ${id}`,
  published_at: new Date(Date.UTC(2026, 9, 24, 0, id)).toISOString(),
  feed: { id: (id % 3) + 1 },
})

const makeStore = (initial) => {
  let value = initial
  const listeners = new Set()
  return {
    get: () => value,
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next) => {
      value = next
      for (const listener of listeners) {
        listener(next)
      }
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test("waits for a complete Home snapshot and runs once for its normalized request", async () => {
  const store = makeStore({
    infoFrom: "home",
    isArticleListReady: true,
    articleListError: null,
    total: 3,
    entries: [makeEntry(1), makeEntry(2)],
  })
  const calls = []
  const transitions = []
  const runtime = startHomeStoryCandidateRuntime({
    contentStore: store,
    identityKey: "https://miniflux.example|user:7",
    sessionRevision: 12,
    getCandidates: async (entries) => {
      calls.push(entries)
      return { candidates: Object.freeze([]), model: Object.freeze({ candidateK: 250 }) }
    },
    onPending: (value) => transitions.push(["pending", value]),
    onReady: (value) => transitions.push(["ready", value]),
    onFailed: (value) => transitions.push(["failed", value]),
  })

  await flush()
  assert.equal(calls.length, 0)

  store.set({
    ...store.get(),
    entries: [makeEntry(1), makeEntry(2), makeEntry(3)],
  })
  await flush()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 3)
  assert.deepEqual(transitions.map(([kind]) => kind), ["pending", "ready"])

  store.set({ ...store.get() })
  await flush()
  assert.equal(calls.length, 1)

  runtime.dispose()
})

test("caps activation at 200 loaded entries when Home has more than 200", async () => {
  const store = makeStore({
    infoFrom: "home",
    isArticleListReady: true,
    articleListError: null,
    total: 500,
    entries: Array.from({ length: 199 }, (_, index) => makeEntry(index + 1)),
  })
  let requestedCount = 0
  const runtime = startHomeStoryCandidateRuntime({
    contentStore: store,
    identityKey: "identity",
    sessionRevision: 1,
    getCandidates: async (entries) => {
      requestedCount = entries.length
      return { candidates: Object.freeze([]), model: Object.freeze({ candidateK: 250 }) }
    },
    onPending: () => {},
    onReady: () => {},
    onFailed: () => {},
  })

  await flush()
  assert.equal(requestedCount, 0)
  store.set({
    ...store.get(),
    entries: Array.from({ length: 200 }, (_, index) => makeEntry(index + 1)),
  })
  await flush()
  assert.equal(requestedCount, 200)
  runtime.dispose()
})

test("fails open and ignores late results after disposal", async () => {
  let resolveRequest
  const store = makeStore({
    infoFrom: "home",
    isArticleListReady: true,
    articleListError: null,
    total: 2,
    entries: [makeEntry(1), makeEntry(2)],
  })
  const transitions = []
  const runtime = startHomeStoryCandidateRuntime({
    contentStore: store,
    identityKey: "identity",
    sessionRevision: 1,
    getCandidates: () =>
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    onPending: () => transitions.push("pending"),
    onReady: () => transitions.push("ready"),
    onFailed: () => transitions.push("failed"),
  })

  await flush()
  assert.deepEqual(transitions, ["pending"])
  runtime.dispose()
  resolveRequest({
    candidates: Object.freeze([]),
    model: Object.freeze({ candidateK: 250 }),
  })
  await flush()
  assert.deepEqual(transitions, ["pending"])

  const failingStore = makeStore({
    infoFrom: "home",
    isArticleListReady: true,
    articleListError: null,
    total: 2,
    entries: [makeEntry(1), makeEntry(2)],
  })
  const failingTransitions = []
  const failingRuntime = startHomeStoryCandidateRuntime({
    contentStore: failingStore,
    identityKey: "identity",
    sessionRevision: 2,
    getCandidates: async () => {
      throw new Error("service unavailable")
    },
    onPending: () => failingTransitions.push("pending"),
    onReady: () => failingTransitions.push("ready"),
    onFailed: () => failingTransitions.push("failed"),
  })

  await flush()
  assert.deepEqual(failingTransitions, ["pending", "failed"])
  failingRuntime.dispose()
})
