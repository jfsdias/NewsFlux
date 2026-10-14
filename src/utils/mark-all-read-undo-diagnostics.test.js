import assert from "node:assert/strict"
import test from "node:test"

test("R2 trace persists only sanitized event metadata asynchronously", async () => {
  const priorGlobals = Object.fromEntries(
    ["window", "document", "sessionStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  )
  const storedValues = new Map()
  const listeners = new Map()
  const fakeWindow = {
    location: {
      pathname: "/feed/42",
      search: "?__newsflux_markall_probe=2",
    },
    addEventListener(name, listener) {
      listeners.set(`window:${name}`, listener)
    },
    removeEventListener(name) {
      listeners.delete(`window:${name}`)
    },
  }
  const fakeDocument = {
    addEventListener(name, listener) {
      listeners.set(`document:${name}`, listener)
    },
    body: {},
    querySelectorAll() {
      return []
    },
    removeEventListener(name) {
      listeners.delete(`document:${name}`)
    },
    visibilityState: "visible",
  }
  const fakeStorage = {
    getItem(key) {
      return storedValues.get(key) || null
    },
    removeItem(key) {
      storedValues.delete(key)
    },
    setItem(key, value) {
      storedValues.set(key, value)
    },
  }

  Object.defineProperties(globalThis, {
    document: { configurable: true, value: fakeDocument, writable: true },
    sessionStorage: { configurable: true, value: fakeStorage, writable: true },
    window: { configurable: true, value: fakeWindow, writable: true },
  })

  try {
    const diagnostics = await import(
      new URL(`mark-all-read-undo-diagnostics.js?test=${Date.now()}`, import.meta.url)
    )
    const stopProbe = diagnostics.startMarkAllReadUndoProbe()

    diagnostics.recordMarkAllReadUndoProbeEvent("MARK_ALL_COMPLETE")
    diagnostics.recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_CREATED")
    diagnostics.recordMarkAllReadUndoProbeEvent("NAVIGATE_CALL")
    diagnostics.scheduleMarkAllReadUndoProbeFlush()
    await new Promise((resolve) => queueMicrotask(resolve))

    const trace = diagnostics.readMarkAllReadUndoProbeTrace()
    assert.deepEqual(
      trace.map(({ EVENT, ROUTE_KIND, UNDO_TOKEN_PRESENT }) => [
        EVENT,
        ROUTE_KIND,
        UNDO_TOKEN_PRESENT,
      ]),
      [
        ["MARK_ALL_COMPLETE", "feed", false],
        ["UNDO_TOKEN_CREATED", "feed", true],
        ["NAVIGATE_CALL", "feed", true],
      ],
    )
    assert.deepEqual(Object.keys(trace[0]), [
      "SEQ",
      "T_PLUS_MS",
      "EVENT",
      "UNDO_TOKEN_PRESENT",
      "DOCUMENT_VISIBILITY",
      "ROUTE_KIND",
    ])
    assert.equal(JSON.stringify(trace).includes("42"), false)
    assert.equal(JSON.stringify(trace).includes("entryIds"), false)

    stopProbe()
  } finally {
    for (const [key, descriptor] of Object.entries(priorGlobals)) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor)
      } else {
        delete globalThis[key]
      }
    }
  }
})
