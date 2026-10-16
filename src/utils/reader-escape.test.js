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

test("reader Escape is not deferred for a dropdown outside the reader", () => {
  const documentRef = {
    querySelector: () => null,
  }

  assert.equal(shouldDeferReaderEscape({ defaultPrevented: false }, documentRef), false)
})

test("reader Escape is deferred when an earlier handler consumed the event", () => {
  assert.equal(shouldDeferReaderEscape({ defaultPrevented: true }, createDocument()), true)
})
