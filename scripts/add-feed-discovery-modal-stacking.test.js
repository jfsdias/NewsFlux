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

test("discovery trigger is focused before the child modal opens", () => {
  let triggerRef
  let triggerButton
  let discoverHandler

  walk(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.name === "discoveryTriggerRef") {
      triggerRef = node
    }

    if (node.type === "VariableDeclarator" && node.id?.name === "handleDiscoverFromWebsite") {
      discoverHandler = node.init
    }

    if (node.type !== "JSXElement" || jsxName(node.openingElement.name) !== "Button") {
      return
    }

    if (getAttribute(node, "className")?.value?.value === "add-feed-discover-trigger") {
      triggerButton = node
    }
  })

  assert.ok(triggerRef, "Add Feed keeps a ref to the discovery trigger")
  assert.equal(triggerRef.init?.callee?.name, "useRef")
  assert.ok(triggerButton, "the Find feeds from website button exists")
  assert.equal(
    getAttribute(triggerButton, "ref")?.value?.expression?.name,
    "discoveryTriggerRef",
    "the trigger ref is attached to Find feeds from website",
  )
  assert.equal(
    getAttribute(triggerButton, "disabled")?.value?.expression?.name,
    "feedModalLoading",
    "discovery loading must not natively disable the focus restoration target",
  )
  assert.ok(discoverHandler, "the discovery handler exists")

  const handlerSource = source.slice(discoverHandler.start, discoverHandler.end)
  const earlyFocusIndex = handlerSource.indexOf(
    "discoveryTriggerRef.current?.focus({ preventScroll: true })",
  )
  const loadingIndex = handlerSource.indexOf("setDiscoveryLoading(true)")
  assert.ok(earlyFocusIndex !== -1, "the validated trigger receives focus before discovery starts")
  assert.ok(loadingIndex > earlyFocusIndex, "the trigger focus precedes the loading state")
  assert.match(
    handlerSource,
    /discoveryTriggerRef\.current\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)\s*return resolveDiscoveryCandidate\(candidates\)/,
    "the trigger is focused immediately before opening the child modal",
  )
  assert.doesNotMatch(
    handlerSource,
    /discoveryModalOwnsFocus|requestAnimationFrame/,
    "focus restoration uses the existing AccessibleModal mechanism without a parallel focus lifecycle",
  )

  let addFeedModal
  let discoveryModal
  walk(ast, (node) => {
    if (node.type !== "JSXElement" || jsxName(node.openingElement.name) !== "AccessibleModal") {
      return
    }

    const className = getAttribute(node, "className")?.value?.value
    if (className === "add-feed-modal") {
      addFeedModal = node
    }
    if (className === "add-feed-discovery-modal") {
      discoveryModal = node
    }
  })

  assert.ok(addFeedModal, "the Add Feed dialog uses AccessibleModal")
  assert.equal(
    getAttribute(addFeedModal, "autoFocus"),
    undefined,
    "the parent modal keeps its existing focus policy",
  )
  assert.equal(
    getAttribute(addFeedModal, "focusLock"),
    undefined,
    "the parent modal keeps its existing focus-lock policy",
  )
  assert.ok(discoveryModal, "the candidate dialog uses AccessibleModal")
  assert.equal(
    getAttribute(discoveryModal, "fallbackFocusSelector")?.value?.value,
    ".add-feed-discover-trigger",
    "the child dialog restores focus to the discovery trigger",
  )
})
