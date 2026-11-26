import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node native ESM requires explicit extensions.
import resolveCurrentArticleListRequest from "./article-list-request-result.js"

test("a late stale response settles without replacing the latest result", async () => {
  let releaseStale
  const staleResponse = new Promise((resolve) => {
    releaseStale = resolve
  })
  let currentRequest = 1
  let visibleEntries = []
  const apply = async (request, requestId) => {
    const response = await request
    const result = resolveCurrentArticleListRequest(response, () => requestId === currentRequest)
    if (result.current) {
      visibleEntries = response.entries
    }
    return result.current
  }

  const stale = apply(staleResponse, 1)
  currentRequest = 2
  assert.equal(await apply(Promise.resolve({ entries: [2] }), 2), true)
  assert.deepEqual(visibleEntries, [2])

  releaseStale({ entries: [] })
  assert.equal(await stale, false)
  assert.deepEqual(visibleEntries, [2])
})

test("freshness check is synchronous", async () => {
  let currentRequest = 1
  queueMicrotask(() => {
    currentRequest = 2
  })
  const response = { entries: [1] }
  const result = resolveCurrentArticleListRequest(response, () => currentRequest === 1)
  assert.deepEqual(result, { current: true, response })
  assert.equal(currentRequest, 1)
  await Promise.resolve()
  assert.equal(currentRequest, 2)
})

test("a session invalidated before the response is checked is rejected", () => {
  const result = resolveCurrentArticleListRequest({ entries: [1] }, () => false)
  assert.equal(result.current, false)
})
