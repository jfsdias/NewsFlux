import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let fetchImplementation
const nativeFetch = globalThis.fetch
globalThis.__adminTestAuth = {
  server: "https://miniflux.example",
  token: "synthetic-miniflux-user-key",
  apiKeyId: 9,
  username: "synthetic-user",
  password: "",
}
globalThis.__adminTestRevision = 1
globalThis.fetch = (...args) =>
  fetchImplementation ? fetchImplementation(...args) : nativeFetch(...args)

const mocks = {
  "@/store/authState": "export const authState = { get: () => globalThis.__adminTestAuth }",
  "@/store/dataState": "export const getDataSessionRevision = () => globalThis.__adminTestRevision",
  "@/utils/auth": `
    export const getAuthSessionKey = (auth = {}) => JSON.stringify([auth.server, auth.token, auth.username, auth.password]);
    export const hasProvisionedApiKey = (auth = {}) => Boolean(auth.token && auth.apiKeyId > 0);
  `,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`,
      }
    }
    if (specifier.startsWith("@/")) {
      const target = path.resolve(root, specifier.slice(2))
      for (const ext of [".js", ".jsx"]) {
        if (existsSync(target + ext)) {
          return nextResolve(pathToFileURL(target + ext).href)
        }
      }
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), `${specifier}.js`)
      if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href)
      }
    }
    return nextResolve(specifier)
  },
})

const {
  AdminLiteLLMError,
  readLiteLLMStatus,
  readLiteLLMModels,
  testLiteLLMKey,
  replaceLiteLLMKey,
  approveLiteLLMModel,
} = await import("./article-intelligence-admin")

test("admin status uses only the existing Miniflux session and same-origin GET", async () => {
  fetchImplementation = async (url, options) => {
    assert.equal(url, "/api/ai/v1/admin/litellm/status")
    assert.equal(options.method, "GET")
    assert.equal(options.credentials, "omit")
    assert.equal(options.cache, "no-store")
    assert.equal(options.redirect, "error")
    assert.equal(options.headers["X-Miniflux-API-Key"], "synthetic-miniflux-user-key")
    assert.equal(options.body, undefined)
    return Response.json({ configured: true, managed: false, revision: "bootstrap" })
  }
  const status = await readLiteLLMStatus()
  assert.equal(status.configured, true)
})

test("key replacement sends the credential in one transient JSON body, never URL or browser storage", async () => {
  const key = "sk-synthetic-secret-only-for-test"
  fetchImplementation = async (url, options) => {
    assert.equal(url, "/api/ai/v1/admin/litellm/save-key")
    assert.equal(options.method, "POST")
    assert.equal(options.credentials, "omit")
    assert.equal(options.referrerPolicy, "no-referrer")
    const request = JSON.parse(options.body)
    assert.deepEqual(request, { key, expected_revision: "bootstrap" })
    assert.equal(url.includes(key), false)
    return Response.json({
      configured: true,
      managed: true,
      revision: "12345678901234567890123456789012",
    })
  }
  const response = await replaceLiteLLMKey(key, "bootstrap")
  assert.equal(response.managed, true)
  assert.equal(JSON.stringify(response).includes(key), false)
})

test("key validation is read-only and only calls admin test route", async () => {
  fetchImplementation = async (url, options) => {
    assert.equal(url, "/api/ai/v1/admin/litellm/test-key")
    assert.equal(options.method, "POST")
    return Response.json({ validated: true })
  }
  const response = await testLiteLLMKey("sk-synthetic")
  assert.equal(response?.validated, true)
})

test("model approval includes explicit consent booleans", async () => {
  fetchImplementation = async (url, options) => {
    assert.equal(url, "/api/ai/v1/admin/litellm/approve-model")
    assert.deepEqual(JSON.parse(options.body), {
      alias: "ollama-local",
      expected_revision: "xyz",
      allow_paid: false,
      allow_external: false,
    })
    return Response.json({ policy_models: 1 })
  }
  const result = await approveLiteLLMModel("ollama-local", "xyz", false, false)
  assert.equal(result.policy_models, 1)
})

test("non-admin denial has safe error code and does not expose response payload", async () => {
  fetchImplementation = async () =>
    Response.json(
      { error: { code: "NOT_AUTHORIZED", internals: "private-token" } },
      { status: 403 },
    )
  await assert.rejects(
    readLiteLLMModels(),
    (error) =>
      error instanceof AdminLiteLLMError &&
      error.code === "NOT_AUTHORIZED" &&
      !String(error).includes("private-token"),
  )
})

test("stale Miniflux session prevents using a successful prior response", async () => {
  const old = globalThis.__adminTestRevision
  fetchImplementation = async () => {
    globalThis.__adminTestRevision = old + 1
    return Response.json({ configured: true })
  }
  assert.equal(await readLiteLLMStatus(), null)
  globalThis.__adminTestRevision = old
})

test("oversized gateway metadata response fails closed", async () => {
  fetchImplementation = async () => Response.json({ models: ["synthetic".repeat(20_000)] })
  await assert.rejects(readLiteLLMModels(), AdminLiteLLMError)
})
