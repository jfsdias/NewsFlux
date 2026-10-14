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

// eslint-disable-next-line import/extensions
const dataStateModule = await import("./dataState.js")

test("exports the existing feed-hidden set without changing its derivation", () => {
  const { dataState, globallyHiddenFeedIdsState } = dataStateModule
  assert.ok(globallyHiddenFeedIdsState, "hidden feed IDs should be exposed read-only")

  const previousState = dataState.get()
  dataState.set({
    ...previousState,
    categoriesData: [
      { id: 1, title: "Visible", hide_globally: false },
      { id: 2, title: "Hidden category", hide_globally: true },
    ],
    feedsData: [
      { id: 10, title: "Hidden feed", hide_globally: true, category: { id: 1 } },
      { id: 11, title: "Hidden by category", hide_globally: false, category: { id: 2 } },
      { id: 12, title: "Visible feed", hide_globally: false, category: { id: 1 } },
    ],
  })

  try {
    assert.deepEqual(
      [...globallyHiddenFeedIdsState.get()].toSorted((a, b) => a - b),
      [10, 11],
    )
  } finally {
    dataState.set(previousState)
  }
})
