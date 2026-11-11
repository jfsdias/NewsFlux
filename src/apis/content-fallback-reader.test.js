/* eslint-disable import/extensions -- Node's native ESM test runner needs explicit extensions. */
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const moduleMocks = {
  "@/store/authState": "export const authState = { get: () => globalThis.__readerRecoveryAuth }",
  "@/store/dataState":
    "export const getDataSessionRevision = () => globalThis.__readerRecoverySessionRevision",
  "@/utils/auth":
    'export const getAuthSessionKey = ({ server = "", token = "", username = "", password = "" } = {}) => JSON.stringify([server, token, username, password]); export const hasProvisionedApiKey = (auth = {}) => Boolean(auth.token && Number(auth.apiKeyId) > 0)',
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduleMocks[specifier]) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(moduleMocks[specifier])}`,
      }
    }
    let target = null
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
        target = `${target}.js`
      }
      if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }
    return nextResolve(specifier, context)
  },
})

globalThis.__readerRecoveryAuth = {
  server: "https://miniflux.example.test",
  token: "synthetic-reader-api-key",
  apiKeyId: 17,
  username: "",
  password: "",
}
globalThis.__readerRecoverySessionRevision = 1

const { requestReaderContentRecovery } = await import("./content-fallback-reader.js")
const originalFetch = globalThis.fetch

test("passes the request AbortSignal to the same-origin recovery fetch", async () => {
  const url = "https://publisher.example.test/story/42"
  const controller = new AbortController()
  let signalAtFetch
  let requestStarted
  const started = new Promise((resolve) => {
    requestStarted = resolve
  })
  globalThis.fetch = (_endpoint, options) => {
    signalAtFetch = options.signal
    requestStarted()
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("The operation was aborted", "AbortError")),
        { once: true },
      )
    })
  }

  try {
    const request = requestReaderContentRecovery({
      entryId: 42,
      url,
      basePath: "/api/content-fallback",
      signal: controller.signal,
    })
    await started
    assert.strictEqual(signalAtFetch, controller.signal)
    controller.abort()
    await assert.rejects(request, (error) => error.name === "AbortError")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an already aborted recovery never starts a fetch", async () => {
  const controller = new AbortController()
  controller.abort()
  let fetchCalls = 0
  globalThis.fetch = async () => {
    fetchCalls += 1
    return Response.json({})
  }

  try {
    await assert.rejects(
      requestReaderContentRecovery({
        entryId: 42,
        url: "https://publisher.example.test/story/42",
        basePath: "/api/content-fallback",
        signal: controller.signal,
      }),
      (error) => error.name === "AbortError",
    )
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})
