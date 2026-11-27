import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

registerHooks({
  resolve(specifier, context, nextResolve) {
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
        target += ".js"
      }
      if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const writes = []
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => {},
    setItem: (key, value) => writes.push([key, value]),
  },
})

const load = (file) => import(pathToFileURL(path.join(sourceRoot, file)).href)
const { settingsState, updateSettings, withoutActiveSmartView } =
  await load("store/settingsState.js")
const { activeSmartViewState } = await load("store/smartViewsState.js")
const { buildSettingsBackup } = await load("utils/settings-transfer.js")

test("an active Smart View never reaches storage or the settings backup", () => {
  updateSettings({ showStatus: "all", orderBy: "published_at", orderDirection: "desc" })
  activeSmartViewState.set({
    key: "k",
    view: { id: "v" },
    sessionRevision: 0,
    baseline: { showStatus: "all", orderBy: "published_at", orderDirection: "desc" },
  })
  writes.length = 0
  updateSettings({ showStatus: "unread", orderDirection: "asc" })

  assert.equal(settingsState.get().showStatus, "unread")
  assert.deepEqual(
    [
      withoutActiveSmartView(settingsState.get()).showStatus,
      withoutActiveSmartView(settingsState.get()).orderDirection,
    ],
    ["all", "desc"],
  )
  const stored = writes.filter(([key]) => key === "settings").map(([, value]) => JSON.parse(value))
  assert.ok(
    stored.every((value) => value.showStatus !== "unread" && value.orderDirection !== "asc"),
  )

  const { settings } = JSON.parse(buildSettingsBackup()).data
  assert.equal(settings.showStatus, "all")
  assert.equal(settings.orderDirection, "desc")

  activeSmartViewState.set(null)
})
