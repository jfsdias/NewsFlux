/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import shouldExitArticleSelectionOnEscape from "./article-selection-escape.js"

const createDocument = (overlays = []) => ({
  querySelectorAll: () => overlays,
})

const createOverlay = ({ visible = true, ariaHidden = null } = {}) => ({
  getAttribute: () => ariaHidden,
  getClientRects: () => (visible ? [{}] : []),
})

test("Escape exits selection only when no higher-priority handler consumed it", () => {
  assert.equal(shouldExitArticleSelectionOnEscape({ key: "Escape" }), true)
  assert.equal(shouldExitArticleSelectionOnEscape({ key: "Enter" }), false)
  assert.equal(shouldExitArticleSelectionOnEscape({ key: "Escape", defaultPrevented: true }), false)
  assert.equal(
    shouldExitArticleSelectionOnEscape({ key: "Escape" }, { activeContent: { id: 1 } }),
    false,
  )
})

test("Escape remains available to visible dialogs, menus, context menus, and date pickers", () => {
  assert.equal(
    shouldExitArticleSelectionOnEscape(
      { key: "Escape" },
      { documentRef: createDocument([createOverlay()]) },
    ),
    false,
  )
  assert.equal(
    shouldExitArticleSelectionOnEscape(
      { key: "Escape" },
      { documentRef: createDocument([createOverlay({ visible: false })]) },
    ),
    true,
  )
  assert.equal(
    shouldExitArticleSelectionOnEscape(
      { key: "Escape" },
      { documentRef: createDocument([createOverlay({ ariaHidden: "true" })]) },
    ),
    true,
  )
})

test("Escape from inside an overlay does not exit selection mode", () => {
  const target = { closest: () => ({}) }
  assert.equal(shouldExitArticleSelectionOnEscape({ key: "Escape", target }), false)
})
