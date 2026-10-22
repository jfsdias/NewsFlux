import assert from "node:assert/strict"
import test from "node:test"

import { runtimeBuildAssetCachePlugin } from "./pwa-runtime-asset-cache.js" // eslint-disable-line import/extensions

const makeRequest = (path) => new Request(`https://newsflux.test${path}`)

const makeResponse = (status, contentType, body = "asset") =>
  new Response(body, {
    status,
    headers: contentType ? { "content-type": contentType } : undefined,
  })

const cacheDecision = (path, status, contentType) =>
  runtimeBuildAssetCachePlugin.cacheWillUpdate({
    request: makeRequest(path),
    response: makeResponse(status, contentType),
  })

test("rejects a successful HTML fallback for JavaScript", async () => {
  assert.equal(await cacheDecision("/assets/lazy.js", 200, "text/html; charset=utf-8"), null)
})

test("rejects a successful HTML fallback for CSS", async () => {
  assert.equal(await cacheDecision("/assets/lazy.css", 200, "text/html; charset=utf-8"), null)
})

test("rejects every non-200 status, including otherwise valid JavaScript MIME", async () => {
  assert.equal(await cacheDecision("/assets/lazy.js", 503, "text/javascript; charset=utf-8"), null)
  assert.equal(await cacheDecision("/assets/lazy.js", 206, "text/javascript"), null)
})

test("accepts the JavaScript MIME values used by supported build servers", async (context) => {
  for (const contentType of ["text/javascript; charset=utf-8", "application/javascript"]) {
    await context.test(contentType, async () => {
      const response = makeResponse(200, contentType)
      assert.equal(
        await runtimeBuildAssetCachePlugin.cacheWillUpdate({
          request: makeRequest("/assets/lazy.js"),
          response,
        }),
        response,
      )
    })
  }
})

test("accepts CSS only with text/css MIME", async () => {
  const response = makeResponse(200, "text/css; charset=utf-8")
  assert.equal(
    await runtimeBuildAssetCachePlugin.cacheWillUpdate({
      request: makeRequest("/assets/lazy.css"),
      response,
    }),
    response,
  )
  assert.equal(await cacheDecision("/assets/lazy.css", 200, "text/javascript"), null)
})

test("does not admit an asset with the wrong extension or a missing response", async () => {
  assert.equal(await cacheDecision("/assets/lazy.html", 200, "text/html"), null)
  assert.equal(
    await runtimeBuildAssetCachePlugin.cacheWillUpdate({
      request: makeRequest("/assets/lazy.js"),
      response: undefined,
    }),
    null,
  )
})
