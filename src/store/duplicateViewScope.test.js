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

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => {},
    setItem: () => {},
  },
})

const load = (file) => import(pathToFileURL(path.join(sourceRoot, file)).href)
const {
  contentState,
  displayedEntriesState,
  duplicateProjectionState,
  invalidateArticleList,
  resetContent,
  setArticleListSource,
  setDuplicateSelectionMode,
  setEntries,
  toggleDuplicateGroup,
} = await load("store/contentState.js")
const { resetData } = await load("store/dataState.js")
const { updateSettings } = await load("store/settingsState.js")

const entries = [
  { id: 1, title: "same", status: "unread" },
  { id: 2, title: "same", status: "unread" },
  { id: 3, title: "other", status: "unread" },
]
const displayedIds = () => displayedEntriesState.get().map(({ id }) => id)

const start = (source = "all", id = null) => {
  resetContent()
  updateSettings({ removeDuplicates: "title" })
  setArticleListSource({ from: source, id })
  setEntries(entries)
}

test("expanded groups survive refresh and growth, are scoped per source and reset on session switch", () => {
  start("feed", 7)
  assert.deepEqual(displayedIds(), [1, 3])
  toggleDuplicateGroup(1)
  assert.deepEqual(displayedIds(), [1, 2, 3])

  // Refresh revisions and appended pages keep the user's expansion, and a new member joins it.
  invalidateArticleList()
  assert.deepEqual(displayedIds(), [1, 2, 3])
  setEntries([...entries, { id: 4, title: "same", status: "unread" }])
  assert.deepEqual(displayedIds(), [1, 2, 3, 4])
  setEntries(entries)

  // A different source starts collapsed. Expansion is remembered per exact scope, so coming back
  // to the same feed shows the groups the user left open; it is presentation only.
  setArticleListSource({ from: "feed", id: 8 })
  assert.deepEqual(displayedIds(), [1, 3])
  setArticleListSource({ from: "feed", id: 7 })
  assert.deepEqual(displayedIds(), [1, 2, 3])

  // Turning the setting off shows every loaded entry; none of this touches canonical statuses.
  updateSettings({ removeDuplicates: "none" })
  assert.deepEqual(displayedIds(), [1, 2, 3])
  updateSettings({ removeDuplicates: "title" })

  // An account or session switch (new session revision) never inherits an expansion.
  assert.deepEqual(displayedIds(), [1, 2, 3])
  resetData()
  assert.deepEqual(displayedIds(), [1, 3])
})

test("selection mode bypasses collapsing and restores it; starred and history are exempt", () => {
  start()
  assert.deepEqual(displayedIds(), [1, 3])
  setDuplicateSelectionMode(true)
  assert.deepEqual(displayedIds(), [1, 2, 3])
  setDuplicateSelectionMode(false)
  assert.deepEqual(displayedIds(), [1, 3])

  for (const source of ["starred", "history"]) {
    start(source)
    assert.deepEqual(displayedIds(), [1, 2, 3], `${source} never collapses`)
    assert.equal(duplicateProjectionState.get().counts.size, 0)
  }
})

test("projection never changes the canonical entries held in the store", () => {
  start()
  const before = structuredClone(entries)
  toggleDuplicateGroup(1)
  assert.deepEqual(displayedIds(), [1, 2, 3])
  assert.deepEqual(entries, before)
  assert.deepEqual(
    contentState.get().entries.map(({ id }) => id),
    [1, 2, 3],
  )
})
