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
    const result = await resolveCurrentArticleListRequest(
      request,
      () => requestId === currentRequest,
    )
    if (result.current) {
      visibleEntries = result.response.entries
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

test("the current request propagates failures to the list error handler", async () => {
  const failure = new Error("network")
  await assert.rejects(resolveCurrentArticleListRequest(Promise.reject(failure), () => true), failure)
})
