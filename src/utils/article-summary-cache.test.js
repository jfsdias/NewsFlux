import assert from "node:assert/strict"
import test from "node:test"

import {
  clearSummaryCache,
  readCachedSummary,
  storeCachedSummary,
  summaryCacheKey,
} from "./article-summary-cache.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const settings = { aiSummaryModel: "m1", aiSummaryLength: "standard" }
const key = (changes = {}) =>
  summaryCacheKey({ authSessionKey: "s1", sessionRevision: 1, entryId: 7, entryVersion: "v1", settings, ...changes })
const finished = (status = "partial") => ({ status, summary: { status, summary: "x" } })

test("a finished summary is reused for the same session, entry version and settings", () => {
  clearSummaryCache()
  storeCachedSummary(key(), finished())
  assert.deepEqual(readCachedSummary(key()), finished())
})

test("session, entry version and every shaping setting are part of the key", () => {
  clearSummaryCache()
  storeCachedSummary(key(), finished())
  assert.equal(readCachedSummary(key({ authSessionKey: "s2" })), null)
  assert.equal(readCachedSummary(key({ sessionRevision: 2 })), null)
  assert.equal(key({ sessionRevision: undefined }), null)
  assert.equal(readCachedSummary(key({ entryVersion: "v2" })), null)
  assert.equal(readCachedSummary(key({ entryId: 8 })), null)
  assert.equal(readCachedSummary(key({ settings: { ...settings, aiSummaryModel: "m2" } })), null)
  assert.equal(
    readCachedSummary(key({ settings: { ...settings, aiSummaryLength: "short" } })),
    null,
  )
})

test("only generated summaries are cached; invalid keys are ignored", () => {
  clearSummaryCache()
  storeCachedSummary(key(), finished("unavailable"))
  storeCachedSummary(key({ entryId: 9 }), finished("insufficient"))
  assert.equal(readCachedSummary(key()), null)
  assert.equal(readCachedSummary(key({ entryId: 9 })), null)
  assert.equal(key({ authSessionKey: null }), null)
  assert.equal(key({ entryId: 0 }), null)
  storeCachedSummary(null, finished())
  assert.equal(readCachedSummary(null), null)
})

test("the cache is bounded and evicts the least recently used entry", () => {
  clearSummaryCache()
  for (let id = 1; id <= 50; id += 1) {
    storeCachedSummary(key({ entryId: id }), finished())
  }
  assert.ok(readCachedSummary(key({ entryId: 1 }))) // touch 1 so 2 is now the oldest
  storeCachedSummary(key({ entryId: 51 }), finished())
  assert.ok(readCachedSummary(key({ entryId: 1 })))
  assert.equal(readCachedSummary(key({ entryId: 2 })), null)
  assert.ok(readCachedSummary(key({ entryId: 51 })))
})
