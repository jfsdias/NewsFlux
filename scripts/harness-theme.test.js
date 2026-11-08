import assert from "node:assert/strict"
import test from "node:test"

import applyHarnessTheme from "./tests/harness-theme.js"

const createDocument = (canvas) => {
  const attributes = new Map()
  const body = {
    style: {},
    setAttribute: (name, value) => attributes.set(name, value),
  }
  const shellProperties = new Map()
  const documentObject = {
    body,
    documentElement: {
      style: {
        setProperty: (name, value) => shellProperties.set(name, value),
      },
    },
    defaultView: {
      getComputedStyle: (element) => ({
        getPropertyValue: (name) => (element === body && name === "--nf-canvas" ? canvas : ""),
      }),
    },
  }

  return { documentObject, attributes, shellProperties }
}

test("explicit light theme sets browser color scheme and shell to the resolved canvas", () => {
  const { documentObject, attributes, shellProperties } = createDocument("#f2f3f5")

  assert.equal(applyHarnessTheme("light", documentObject), "#f2f3f5")
  assert.equal(attributes.get("arco-theme"), "light")
  assert.equal(documentObject.body.style.colorScheme, "light")
  assert.equal(shellProperties.get("--app-shell-background"), "#f2f3f5")
})

test("explicit dark theme sets browser color scheme and shell to the resolved canvas", () => {
  const { documentObject, attributes, shellProperties } = createDocument("#0b0d10")

  assert.equal(applyHarnessTheme("dark", documentObject), "#0b0d10")
  assert.equal(attributes.get("arco-theme"), "dark")
  assert.equal(documentObject.body.style.colorScheme, "dark")
  assert.equal(shellProperties.get("--app-shell-background"), "#0b0d10")
})

test("switching themes on the same document replaces the previous shell state", () => {
  const { documentObject, attributes, shellProperties } = createDocument("#f2f3f5")

  applyHarnessTheme("light", documentObject)
  documentObject.defaultView.getComputedStyle = () => ({
    getPropertyValue: (name) => (name === "--nf-canvas" ? "#0b0d10" : ""),
  })
  assert.equal(applyHarnessTheme("dark", documentObject), "#0b0d10")
  assert.equal(attributes.get("arco-theme"), "dark")
  assert.equal(documentObject.body.style.colorScheme, "dark")
  assert.equal(shellProperties.get("--app-shell-background"), "#0b0d10")
})

test("unsupported themes fail before changing the document", () => {
  const { documentObject, attributes, shellProperties } = createDocument("#f2f3f5")

  assert.throws(() => applyHarnessTheme("system", documentObject), /Unsupported harness theme/)
  assert.equal(attributes.size, 0)
  assert.equal(documentObject.body.style.colorScheme, undefined)
  assert.equal(shellProperties.size, 0)
})

test("missing theme tokens fail instead of leaving mixed theme presentation", () => {
  const { documentObject } = createDocument("")

  assert.throws(() => applyHarnessTheme("light", documentObject), /did not resolve --nf-canvas/)
})
