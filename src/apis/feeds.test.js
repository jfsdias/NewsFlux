import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let fetchImplementation = null
const nativeFetch = globalThis.fetch
globalThis.fetch = (...args) =>
  fetchImplementation ? fetchImplementation(...args) : nativeFetch(...args)
const moduleMocks = {
  "@/routes":
    'const router = { state: { location: { pathname: "/", search: "", hash: "" } }, navigate: async () => {} }; export default router',
  "@/store/authState":
    'export const authState = { get: () => ({ server: "https://example.invalid", token: "fixture", username: "", password: "" }) }',
  "@/store/contentState": "export const contentState = { get: () => ({ filterDate: null }) }",
  "@/store/dataState":
    "export const getDataSessionRevision = () => 0; export const isEntryScopeFullyVisible = () => false",
  "@/store/settingsState":
    'export const getSettings = (key) => key === "updateContentOnFetch" ? globalThis.__updateContentOnFetch : false',
  "@/utils/constants":
    "export const ENTRY_UPDATE_BATCH_SIZE = 1; export const MAX_ENTRIES_PER_PAGE = 20; export const MAX_ENTRY_IDS_PER_PAGE = 100",
  "@/utils/date":
    "export const get24HoursAgoTimestamp = () => 0; export const getDayEndTimestamp = () => 0; export const getTimestamp = () => 0",
  "@/utils/entry-id-batches": "export const updateEntryIdsInBatches = async () => ({})",
  "@/utils/home-entry-request": "export const buildHomeEntryRequest = () => ({})",
  "@/utils/auth":
    'export default () => true; export const getAuthHeaders = () => ({}); export const getSafeAuthErrorDetails = (error) => ({ message: error?.message ?? String(error ?? "Unknown error"), status: error?.status ?? error?.response?.status })',
  "@/utils/session": "export const clearSession = () => {}",
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null
    if (moduleMocks[specifier]) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(moduleMocks[specifier])}`,
      }
    }
    if (specifier.startsWith("@/")) {
      target = path.resolve(sourceRoot, specifier.slice(2))
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }

    if (target) {
      if (!path.extname(target)) {
        const jsTarget = `${target}.js`
        const jsxTarget = `${target}.jsx`
        target = existsSync(jsTarget) ? jsTarget : jsxTarget
      }
      if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {},
  },
})

const [{ default: apiClient }, { deleteFeed, discoverFeeds, updateFeed }, { getOriginalContent }] =
  await Promise.all([import("./ofetch"), import("./feeds"), import("./entries")])

test("mutating requests are not replayed after a transport failure", async () => {
  let attempts = 0
  let simulatedProviderApplications = 0
  fetchImplementation = async () => {
    attempts += 1
    simulatedProviderApplications += 1
    if (attempts === 1) {
      throw new TypeError("connection reset after provider applied the request")
    }
    return new Response(null, { status: 204 })
  }

  let requestError = null
  try {
    await apiClient.post("/v1/feeds", { feed_url: "https://example.test/feed.xml" })
  } catch (error) {
    requestError = error
  } finally {
    fetchImplementation = null
  }

  assert.equal(attempts, 1)
  assert.equal(simulatedProviderApplications, 1)
  assert.ok(requestError instanceof Error)
})

const runAfterOneTransportFailure = async (request) => {
  let attempts = 0
  fetchImplementation = async () => {
    attempts += 1
    if (attempts === 1) {
      throw new TypeError("connection reset after provider applied the request")
    }
    return new Response(null, { status: 204 })
  }

  let requestError = null
  try {
    await request()
  } catch (error) {
    requestError = error
  } finally {
    fetchImplementation = null
  }

  return { attempts, requestError }
}

test("PUT mutations are not replayed after a transport failure", async () => {
  const { attempts, requestError } = await runAfterOneTransportFailure(() =>
    apiClient.put("/v1/entries", { entry_ids: [3], status: "read" }),
  )

  assert.equal(attempts, 1)
  assert.ok(requestError instanceof Error)
})

test("raw DELETE mutations do not inherit a replaying retry policy", async () => {
  const { attempts, requestError } = await runAfterOneTransportFailure(() =>
    apiClient.raw("/v1/categories/4", { method: "DELETE" }),
  )

  assert.equal(attempts, 1)
  assert.ok(requestError instanceof Error)
})

test("raw mutation retry policy is explicit and allows deliberate opt-in", async () => {
  const { applyRawMutationRetryPolicy } = await import("./ofetch")

  assert.equal(typeof applyRawMutationRetryPolicy, "function")
  assert.deepEqual(applyRawMutationRetryPolicy({ method: "DELETE" }), {
    method: "DELETE",
    retry: false,
  })
  assert.deepEqual(applyRawMutationRetryPolicy({ method: "POST", retry: 2 }), {
    method: "POST",
    retry: 2,
  })
  assert.deepEqual(applyRawMutationRetryPolicy({ method: "GET" }), { method: "GET" })
})

test("raw mutation retry opt-in remains available when deliberate", async () => {
  const { attempts, requestError } = await runAfterOneTransportFailure(() =>
    apiClient.raw("/v1/categories/4", { method: "DELETE", retry: 1 }),
  )

  assert.equal(attempts, 2)
  assert.equal(requestError, null)
})

test("provider-updating original-content GET is not replayed after a lost response", async () => {
  globalThis.__updateContentOnFetch = true
  let attempts = 0
  let simulatedProviderUpdates = 0
  let requestedUrl = ""
  fetchImplementation = async (request, options) => {
    attempts += 1
    requestedUrl = String(request)
    assert.equal(options.method, "GET")
    simulatedProviderUpdates += 1
    throw new TypeError("connection reset after provider updated content")
  }

  let requestError = null
  try {
    await getOriginalContent(42)
  } catch (error) {
    requestError = error
  } finally {
    fetchImplementation = null
    globalThis.__updateContentOnFetch = false
  }

  assert.equal(
    requestedUrl,
    "https://example.invalid/v1/entries/42/fetch-content?update_content=true",
  )
  assert.equal(attempts, 1)
  assert.equal(simulatedProviderUpdates, 1)
  assert.ok(requestError instanceof Error)
})

test("non-updating original-content GET keeps safe transient retries", async () => {
  globalThis.__updateContentOnFetch = false
  let attempts = 0
  let requestedUrl = ""
  fetchImplementation = async (request) => {
    attempts += 1
    requestedUrl = String(request)
    if (attempts === 1) {
      throw new TypeError("temporary network failure")
    }
    return Response.json({ content: "original" })
  }

  try {
    const response = await getOriginalContent(42)
    assert.deepEqual(response, { content: "original" })
  } finally {
    fetchImplementation = null
  }

  assert.equal(requestedUrl, "https://example.invalid/v1/entries/42/fetch-content")
  assert.equal(attempts, 2)
})

test("safe GET requests keep the transient transport retry", async () => {
  const { attempts, requestError } = await runAfterOneTransportFailure(() =>
    apiClient.get("/v1/feeds"),
  )

  assert.equal(attempts, 2)
  assert.equal(requestError, null)
})

test("discoverFeeds calls the Miniflux discovery endpoint with the website URL", async () => {
  let request
  const originalPost = apiClient.post
  apiClient.post = async (url, body) => {
    request = { url, body }
    return [{ url: "https://example.test/feed.xml", title: "Example", type: "rss" }]
  }

  try {
    const response = await discoverFeeds("https://example.test")
    assert.equal(request.url, "/v1/discover")
    assert.deepEqual(request.body, { url: "https://example.test" })
    assert.equal(response[0].url, "https://example.test/feed.xml")
  } finally {
    apiClient.post = originalPost
  }
})

test("discoverFeeds treats Miniflux 404 as no discovered feeds", async () => {
  const originalPost = apiClient.post
  apiClient.post = async () => {
    const error = new Error("Not Found")
    error.status = 404
    throw error
  }

  try {
    assert.deepEqual(await discoverFeeds("https://example.test"), [])
  } finally {
    apiClient.post = originalPost
  }
})

test("discoverFeeds rethrows errors other than Miniflux 404", async () => {
  const originalPost = apiClient.post
  const expectedError = Object.assign(new Error("Service unavailable"), { status: 503 })
  apiClient.post = async () => {
    throw expectedError
  }

  try {
    await assert.rejects(discoverFeeds("https://example.test"), (error) => error === expectedError)
  } finally {
    apiClient.post = originalPost
  }
})

test("deleteFeed uses one non-retried DELETE and preserves the provider response", async () => {
  let request
  const expectedResponse = { status: 204 }
  const originalRaw = apiClient.raw
  apiClient.raw = async (url, options) => {
    request = { url, options }
    return expectedResponse
  }

  try {
    assert.equal(await deleteFeed(140), expectedResponse)
    assert.deepEqual(request, {
      url: "/v1/feeds/140",
      options: { method: "DELETE", retry: false },
    })
  } finally {
    apiClient.raw = originalRaw
  }
})

test("deleteFeed treats Miniflux 404 as an already-absent success", async () => {
  const originalRaw = apiClient.raw
  apiClient.raw = async () => {
    throw Object.assign(new Error("Not Found"), { status: 404 })
  }

  try {
    const response = await deleteFeed(140)
    assert.ok(response instanceof Response)
    assert.equal(response.status, 204)
  } finally {
    apiClient.raw = originalRaw
  }
})

test("deleteFeed rethrows non-404 provider errors", async () => {
  const originalRaw = apiClient.raw
  const expectedError = Object.assign(new Error("Service unavailable"), { status: 503 })
  apiClient.raw = async () => {
    throw expectedError
  }

  try {
    await assert.rejects(deleteFeed(140), (error) => error === expectedError)
  } finally {
    apiClient.raw = originalRaw
  }
})

test("deleteFeed does not retry or swallow network failures", async () => {
  let request
  const originalRaw = apiClient.raw
  const networkError = new TypeError("Failed to fetch")
  apiClient.raw = async (url, options) => {
    request = { url, options }
    throw networkError
  }

  try {
    await assert.rejects(deleteFeed(140), (error) => error === networkError)
    assert.deepEqual(request, {
      url: "/v1/feeds/140",
      options: { method: "DELETE", retry: false },
    })
  } finally {
    apiClient.raw = originalRaw
  }
})

const captureUpdatePayload = async (newDetails) => {
  let request
  const originalPut = apiClient.put
  apiClient.put = async (url, body) => {
    request = { url, body }
    return { id: 71 }
  }

  try {
    await updateFeed(71, newDetails)
    return request
  } finally {
    apiClient.put = originalPut
  }
}

test("legacy partial feed edit never sends provider filtering-rule fields", async () => {
  const { body } = await captureUpdatePayload({ title: "Renamed feed" })

  assert.equal(Object.hasOwn(body, "blocklist_rules"), false)
  assert.equal(Object.hasOwn(body, "keeplist_rules"), false)
})

test("explicit blocklist value is sent byte-for-byte without a keeplist default", async () => {
  const rawBlocklist = String.raw`  ^https://example\.test/[a-z]+$\nsecond line  `
  const { body } = await captureUpdatePayload({ blocklistRules: rawBlocklist })

  assert.equal(body.blocklist_rules, rawBlocklist)
  assert.equal(Object.hasOwn(body, "keeplist_rules"), false)
})

test("explicit keeplist value is sent byte-for-byte without a blocklist default", async () => {
  const rawKeeplist = String.raw`  (local|world)\s+news  `
  const { body } = await captureUpdatePayload({ keeplistRules: rawKeeplist })

  assert.equal(body.keeplist_rules, rawKeeplist)
  assert.equal(Object.hasOwn(body, "blocklist_rules"), false)
})

test("explicit empty strings intentionally clear their corresponding provider rules", async () => {
  const blocklist = await captureUpdatePayload({ blocklistRules: "" })
  const keeplist = await captureUpdatePayload({ keeplistRules: "" })

  assert.equal(blocklist.body.blocklist_rules, "")
  assert.equal(Object.hasOwn(blocklist.body, "keeplist_rules"), false)
  assert.equal(keeplist.body.keeplist_rules, "")
  assert.equal(Object.hasOwn(keeplist.body, "blocklist_rules"), false)
})

test("advanced entry filtering fields are never serialized by updateFeed", async () => {
  const { body } = await captureUpdatePayload({
    blocklistRules: "^ad$",
    blockFilterEntryRules: "advanced block rule",
    keepFilterEntryRules: "advanced keep rule",
  })

  assert.equal(Object.hasOwn(body, "block_filter_entry_rules"), false)
  assert.equal(Object.hasOwn(body, "keep_filter_entry_rules"), false)
})
