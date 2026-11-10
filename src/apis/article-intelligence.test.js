import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let fetchImplementation = null
const nativeFetch = globalThis.fetch
globalThis.__articleSummaryAuth = {
  server: "https://miniflux.example",
  token: "synthetic-miniflux-key",
  apiKeyId: 9,
  username: "synthetic-user",
  password: "",
}
globalThis.__articleSummaryRevision = 4
globalThis.fetch = (...args) =>
  fetchImplementation ? fetchImplementation(...args) : nativeFetch(...args)

const moduleMocks = {
  "@/store/authState": "export const authState = { get: () => globalThis.__articleSummaryAuth }",
  "@/store/dataState":
    "export const getDataSessionRevision = () => globalThis.__articleSummaryRevision",
  "@/utils/auth": `
    export const getAuthSessionKey = (auth = {}) => JSON.stringify([auth.server, auth.token, auth.username, auth.password]);
    export const hasProvisionedApiKey = (auth = {}) => Boolean(auth.token && Number.isSafeInteger(Number(auth.apiKeyId)) && Number(auth.apiKeyId) > 0);
  `,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduleMocks[specifier]) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(moduleMocks[specifier])}`,
      }
    }
    if (specifier.startsWith("@/")) {
      const target = path.resolve(sourceRoot, specifier.slice(2))
      for (const candidate of [`${target}.js`, `${target}.jsx`]) {
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href)
        }
      }
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      const candidate = `${target}.js`
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href)
      }
    }
    return nextResolve(specifier)
  },
})

const { default: requestArticleSummary } = await import("./article-intelligence")

const responsePayload = (changes = {}) => ({
  schema_version: "1",
  request_id: "123e4567-e89b-42d3-a456-426614174000",
  entry_id: 42,
  status: "partial",
  content_scope: "unknown",
  summary: "A grounded summary.",
  summary_paragraph_ids: ["p1"],
  key_points: [{ text: "A grounded point.", paragraph_ids: ["p1"] }],
  action_points: [],
  limitations: ["The source may contain only partial article text."],
  provenance: {
    content_origin: "miniflux",
    content_fingerprint: "a".repeat(64),
    provider_id: "litellm",
    deployment_id: "s5-free",
    effective_model_id: "newsflux-s5-free",
    prompt_version: "summary-v1",
  },
  ...changes,
})

test("summary API posts only fixed identifiers and server-controlled auth to same-origin", async () => {
  try {
    let request
    fetchImplementation = async (url, options) => {
      request = { url: String(url), ...options }
      const body = JSON.parse(options.body)
      return Response.json(responsePayload({ request_id: body.request_id }))
    }
    const result = await requestArticleSummary({ entryId: 42 })
    assert.equal(result.kind, "summary")
    assert.equal(result.summary.entry_id, 42)
    assert.equal(request.url, "/api/ai/v1/entries/42/summary")
    assert.equal(request.method, "POST")
    assert.equal(request.mode, "same-origin")
    assert.equal(request.credentials, "omit")
    assert.equal(request.redirect, "error")
    assert.equal(request.cache, "no-store")
    assert.equal(request.referrerPolicy, "no-referrer")
    assert.equal(request.headers["X-Miniflux-API-Key"], "synthetic-miniflux-key")
    assert.equal(request.headers["X-NewsFlux-Miniflux-Server"], "https://miniflux.example")
    assert.equal(request.headers["Content-Type"], "application/json")
    assert.deepEqual(Object.keys(JSON.parse(request.body)).toSorted(), [
      "profile_id",
      "request_id",
      "schema_version",
    ])
    assert.equal(request.body.includes("article text"), false)
  } finally {
    fetchImplementation = null
  }
})

test("summary API rejects unprovisioned sessions and invalid IDs before network access", async () => {
  try {
    let calls = 0
    fetchImplementation = async () => {
      calls += 1
      return Response.json(responsePayload())
    }
    await assert.rejects(requestArticleSummary({ entryId: 0 }), /unavailable/i)
    globalThis.__articleSummaryAuth = { ...globalThis.__articleSummaryAuth, apiKeyId: null }
    await assert.rejects(requestArticleSummary({ entryId: 42 }), /unavailable/i)
    assert.equal(calls, 0)
  } finally {
    globalThis.__articleSummaryAuth = {
      server: "https://miniflux.example",
      token: "synthetic-miniflux-key",
      apiKeyId: 9,
      username: "synthetic-user",
      password: "",
    }
    fetchImplementation = null
  }
})

test("summary API forwards cancellation and discards responses from a replaced session", async () => {
  try {
    const controller = new AbortController()
    let signal
    fetchImplementation = async (_url, options) => {
      signal = options.signal
      globalThis.__articleSummaryRevision += 1
      const body = JSON.parse(options.body)
      return Response.json(responsePayload({ request_id: body.request_id }))
    }
    const result = await requestArticleSummary({ entryId: 42, signal: controller.signal })
    assert.equal(signal, controller.signal)
    assert.equal(result, null)
  } finally {
    globalThis.__articleSummaryRevision = 4
    fetchImplementation = null
  }
})

test("summary API returns only bounded safe error codes and rejects malformed output", async () => {
  try {
    fetchImplementation = async (_url, options) =>
      Response.json(
        {
          schema_version: "1",
          request_id: JSON.parse(options.body).request_id,
          error: { code: "SUMMARY_BUSY", retryable: true },
        },
        { status: 429 },
      )
    const busy = await requestArticleSummary({ entryId: 42 })
    assert.deepEqual(busy, { kind: "error", error: { code: "SUMMARY_BUSY", retryable: true } })

    fetchImplementation = async () => Response.json({ detail: "provider secret" }, { status: 502 })
    assert.deepEqual(await requestArticleSummary({ entryId: 42 }), { kind: "invalid" })
  } finally {
    fetchImplementation = null
  }
})
