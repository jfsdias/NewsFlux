import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const moduleMocks = {
  "@/routes":
    'const router = { state: { location: { pathname: "/", search: "", hash: "" } }, navigate: async () => {} }; export default router',
  "@/store/authState":
    'export const authState = { get: () => ({ server: "https://example.invalid", token: "fixture", username: "", password: "" }) }',
  "@/store/dataState": "export const getDataSessionRevision = () => 0",
  "@/utils/auth": "export default () => true",
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

const [{ default: apiClient }, { updateFeed }] = await Promise.all([
  import("./ofetch"),
  import("./feeds"),
])

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
