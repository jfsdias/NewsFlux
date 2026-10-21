import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { parseSync } from "@babel/core"

const source = readFileSync(new URL("../src/components/Main/Main.jsx", import.meta.url), "utf8")
const mainCss = readFileSync(new URL("../src/components/Main/Main.css", import.meta.url), "utf8")

const ast = parseSync(source, {
  babelrc: false,
  configFile: false,
  parserOpts: { sourceType: "module", plugins: ["jsx"] },
}).program

const walk = (node, visitor) => {
  if (!node || typeof node !== "object") {
    return
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      walk(child, visitor)
    }
    return
  }

  if (typeof node.type === "string") {
    visitor(node)
  }

  for (const [key, value] of Object.entries(node)) {
    if (!new Set(["loc", "leadingComments", "innerComments", "trailingComments"]).has(key)) {
      walk(value, visitor)
    }
  }
}

const jsxName = (node) => (node?.type === "JSXIdentifier" ? node.name : "")

const getAttribute = (element, attributeName) =>
  element.openingElement.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && jsxName(attribute.name) === attributeName,
  )

const getZIndex = (element, attributeName) => {
  const object = getAttribute(element, attributeName)?.value?.expression
  const property = object?.properties?.find((candidate) => candidate.key?.name === "zIndex")
  return property?.value?.value
}

test("discovery modal stacks both mask and wrapper above Add Feed", () => {
  let discoveryModal
  walk(ast, (node) => {
    if (node.type !== "JSXElement" || jsxName(node.openingElement.name) !== "AccessibleModal") {
      return
    }

    const className = getAttribute(node, "className")?.value?.value
    if (className === "add-feed-discovery-modal") {
      discoveryModal = node
    }
  })

  assert.ok(discoveryModal, "the feed discovery prompt uses AccessibleModal")
  const maskZIndex = getZIndex(discoveryModal, "maskStyle")
  const wrapperZIndex = getZIndex(discoveryModal, "wrapStyle")

  assert.ok(maskZIndex > 1000, "the discovery mask must cover the parent Add Feed mask")
  assert.ok(wrapperZIndex > maskZIndex, "the discovery wrapper must render above its mask")
  assert.match(
    mainCss,
    /@media screen and \(max-width: 768px\)[\s\S]*?\.add-feed-discovery-modal\s*\{[^}]*width: calc\(100% - 16px\);[^}]*max-width: 400px;/,
    "the discovery modal must fit the narrow viewport without clipping its actions",
  )
})
