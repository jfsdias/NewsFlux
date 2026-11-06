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

const { clearArticleListSnapshot, commitArticleListSnapshot, contentState, resetContent } =
  await import(pathToFileURL(path.join(sourceRoot, "store/contentState.js")).href)

test("article snapshot entries and pagination metadata commit in one observable store update", () => {
  resetContent()
  const updates = []
  const unsubscribe = contentState.listen((state) => updates.push(state))
  const temporalPaginationState = {
    canonicalEntryIds: [1],
    requestKey: "all",
    sessionRevision: 4,
    snapshotRevision: 1,
  }

  try {
    commitArticleListSnapshot({
      entries: [{ id: 1, hash: "entry-1", title: "Article one", status: "unread" }],
      loadMoreVisible: true,
      snapshotIdentity: "session-4:all",
      temporalPaginationState,
      total: 12,
    })

    assert.equal(updates.length, 1)
    assert.deepEqual(
      updates[0].entries.map(({ id }) => id),
      [1],
    )
    assert.equal(updates[0].total, 12)
    assert.equal(updates[0].loadMoreVisible, true)
    assert.equal(updates[0].temporalPaginationState, temporalPaginationState)
    assert.equal(updates[0].articleListSnapshotIdentity, "session-4:all")
    assert.equal(updates[0].articleListSnapshotRevision, 1)
  } finally {
    unsubscribe()
    resetContent()
  }
})

test("clearing an invalid or cross-scope snapshot resets its entries and cursor together", () => {
  resetContent()
  contentState.set({
    ...contentState.get(),
    articleListSnapshotIdentity: "old-query",
    entries: [{ id: 5 }],
    loadMoreVisible: true,
    temporalPaginationState: { requestKey: "old-query" },
    total: 9,
  })

  const updates = []
  const unsubscribe = contentState.listen((state) => updates.push(state))
  try {
    clearArticleListSnapshot()
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0].entries, [])
    assert.equal(updates[0].total, 0)
    assert.equal(updates[0].loadMoreVisible, false)
    assert.equal(updates[0].temporalPaginationState, null)
    assert.equal(updates[0].articleListSnapshotIdentity, null)
  } finally {
    unsubscribe()
    resetContent()
  }
})
