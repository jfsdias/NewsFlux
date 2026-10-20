import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions
const { default: shouldDeferReaderEscape } = await import("./reader-escape.js")

const createDocument = (visibleReaderDropdown = false) => ({
  querySelector: (selector) =>
    selector === ".article-content .arco-dropdown-popup-visible" && visibleReaderDropdown
      ? {}
      : null,
})

test("reader Escape is not deferred when no reader transient is open", () => {
  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, createDocument()), false)
})

test("reader Escape is deferred while a reader dropdown is open", () => {
  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, createDocument(true)), true)
})

test("EXPLICIT_DRAWER_TRUE_DEFERS", () => {
  assert.equal(
    shouldDeferReaderEscape({ defaultPrevented: false }, { isDrawerVisible: true }),
    true,
  )
})

test("reader Escape is not deferred for a dropdown outside the reader", () => {
  const documentRef = {
    querySelector: () => null,
  }

  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, documentRef), false)
})

test("reader Escape is deferred when an earlier handler consumed the event", () => {
  assert.equal(shouldDeferReaderEscape({ defaultPrevented: true }, createDocument()), true)
})

test("DOM_FALLBACK_DETECTS_DRAWER_WHEN_STATE_IS_NOT_PROVIDED", () => {
  const drawerDocument = {
    querySelector: (selector) =>
      selector.includes(".sidebar-drawer") || selector.includes("#mobile-sidebar-drawer")
        ? {}
        : null,
  }

  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, drawerDocument), true)
})

test("CLOSED_MOUNTED_DRAWER_WITH_EXPLICIT_FALSE_DOES_NOT_DEFER", () => {
  const closingDrawerDocument = {
    querySelector: (selector) =>
      selector.includes(".sidebar-drawer") || selector.includes("#mobile-sidebar-drawer")
        ? {}
        : null,
  }

  assert.equal(
    shouldDeferReaderEscape(
      { defaultPrevented: false },
      {
        isDrawerVisible: false,
        documentRef: closingDrawerDocument,
      },
    ),
    false,
  )
})

test("explicitly closed drawer still defers for an active reader overlay", () => {
  const documentRef = {
    querySelector: (selector) =>
      selector === ".article-content .arco-dropdown-popup-visible" ? {} : null,
  }

  assert.equal(
    shouldDeferReaderEscape(
      { defaultPrevented: false },
      {
        isDrawerVisible: false,
        documentRef,
      },
    ),
    true,
  )
})

test("defaultPrevented remains authoritative when the drawer state is explicitly false", () => {
  assert.equal(
    shouldDeferReaderEscape({ defaultPrevented: true }, { isDrawerVisible: false }),
    true,
  )
})

test("READER_DRAWER_ESCAPE_DOES_NOT_CLOSE_ARTICLE: reader Escape is deferred when mobile drawer is visible", () => {
  // Option flag
  assert.equal(
    shouldDeferReaderEscape({ defaultPrevented: false }, { isDrawerVisible: true }),
    true,
  )

  // DOM selector
  const drawerDocument = {
    querySelector: (sel) =>
      sel.includes(".sidebar-drawer") || sel.includes("#mobile-sidebar-drawer") ? {} : null,
  }
  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, drawerDocument), true)

  // When drawer is closed, reader escape proceeds normally
  const closedDocument = {
    querySelector: () => null,
  }
  assert.equal(
    shouldDeferReaderEscape(
      { defaultPrevented: false },
      { isDrawerVisible: false, documentRef: closedDocument },
    ),
    false,
  )
})
