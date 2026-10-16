import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { parseSync } from "@babel/core"
import postcss from "postcss"

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const parseJsx = (path) =>
  parseSync(readSource(path), {
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
    if (!["loc", "leadingComments", "innerComments", "trailingComments"].includes(key)) {
      walk(value, visitor)
    }
  }
}

const collect = (node, predicate) => {
  const matches = []
  walk(node, (candidate) => {
    if (predicate(candidate)) {
      matches.push(candidate)
    }
  })
  return matches
}

const jsxName = (node) => {
  if (node?.type === "JSXIdentifier") {
    return node.name
  }
  if (node?.type === "JSXMemberExpression") {
    return `${jsxName(node.object)}.${jsxName(node.property)}`
  }
  return ""
}

const jsxElements = (node, name) =>
  collect(
    node,
    (candidate) =>
      candidate.type === "JSXElement" && jsxName(candidate.openingElement.name) === name,
  )

const jsxAttribute = (element, name) =>
  element.openingElement.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && jsxName(attribute.name) === name,
  )

const stringAttribute = (element, name) => {
  const value = jsxAttribute(element, name)?.value
  return value?.type === "StringLiteral" ? value.value : undefined
}

const expressionAttribute = (element, name) => jsxAttribute(element, name)?.value?.expression

const hasCall = (node, objectName, methodName, firstArgument) =>
  collect(
    node,
    (candidate) =>
      candidate.type === "CallExpression" &&
      candidate.callee.type === "MemberExpression" &&
      candidate.callee.object.type === "Identifier" &&
      candidate.callee.object.name === objectName &&
      candidate.callee.property.type === "Identifier" &&
      candidate.callee.property.name === methodName &&
      candidate.arguments[0]?.type === "StringLiteral" &&
      candidate.arguments[0].value === firstArgument,
  ).length > 0

const identifierCalls = (node, name) =>
  collect(
    node,
    (candidate) =>
      candidate.type === "CallExpression" &&
      candidate.callee.type === "Identifier" &&
      candidate.callee.name === name,
  )

test("A11Y_MAIN_LANDMARK: Main exposes one focusable main landmark", () => {
  const mains = jsxElements(parseJsx("src/components/Main/Main.jsx"), "main")
  assert.equal(mains.length, 1, "Main renders exactly one <main>")
  assert.equal(stringAttribute(mains[0], "id"), "main-content")
  assert.equal(stringAttribute(mains[0], "className"), "main")
  const tabIndex = expressionAttribute(mains[0], "tabIndex")
  assert.ok(
    (tabIndex?.type === "NumericLiteral" && tabIndex.value === -1) ||
      (tabIndex?.type === "UnaryExpression" &&
        tabIndex.operator === "-" &&
        tabIndex.argument?.value === 1),
  )
})

test("A11Y_SKIP_LINK: App exposes one localized skip link to main content", () => {
  const app = parseJsx("src/App.jsx")
  const skipLinks = jsxElements(app, "a").filter(
    (element) => stringAttribute(element, "href") === "#main-content",
  )
  assert.equal(skipLinks.length, 1, "App renders one link to #main-content")
  assert.ok(
    hasCall(skipLinks[0], "polyglot", "t", "actions.skip_to_main_content"),
    "the skip-link label comes from actions.skip_to_main_content",
  )
  assert.ok(stringAttribute(skipLinks[0], "className")?.includes("skip-link"))
})

test("A11Y_SKIP_LINK_STYLE: the focused skip link is visible and forced-colors readable", () => {
  const appCss = postcss.parse(readSource("src/App.css"))
  const rules = []
  const forcedColors = []
  appCss.walkRules((rule) => rules.push(rule))
  appCss.walkAtRules("media", (rule) => {
    if (rule.params.includes("forced-colors: active")) {
      forcedColors.push(rule)
    }
  })

  assert.ok(rules.some((rule) => rule.selector === ".skip-link"))
  const skipLinkFocusSelectors = new Set(
    rules.flatMap((rule) => rule.selector.split(",").map((selector) => selector.trim())),
  )
  assert.ok(skipLinkFocusSelectors.has(".skip-link:focus"))
  assert.ok(skipLinkFocusSelectors.has(".skip-link:focus-visible"))
  assert.ok(
    forcedColors.some((media) => {
      let found = false
      media.walkRules((rule) => {
        if (rule.selector.includes(".skip-link:focus")) {
          found = true
        }
      })
      return found
    }),
    "focused skip-link styling is explicitly available in forced-colors mode",
  )
  assert.ok(rules.some((rule) => rule.selector === ".a11y-visually-hidden"))
})

test("A11Y_NAMED_NAV: the Sidebar root is a named navigation landmark", () => {
  const sidebar = parseJsx("src/components/Sidebar/Sidebar.jsx")
  const navigation = jsxElements(sidebar, "nav").find(
    (element) => stringAttribute(element, "className") === "sidebar-container",
  )
  assert.ok(navigation, "Sidebar root uses <nav>")
  const accessibleName = expressionAttribute(navigation, "aria-label")
  assert.equal(accessibleName?.type, "Identifier")
  assert.equal(accessibleName?.name, "PRODUCT_NAME")
})

test("A11Y_READER_H1: the article title uses heading level one", () => {
  const article = parseJsx("src/components/Article/ArticleDetail.jsx")
  const title = jsxElements(article, "Typography.Title").find(
    (element) => stringAttribute(element, "className") === "article-title",
  )
  assert.ok(title, "the article title remains the article-title Typography.Title")
  assert.equal(expressionAttribute(title, "heading")?.value, 1)
})

test("A11Y_SOURCE_H1_NORMALIZATION: source h1 nodes are rendered as h2", () => {
  const article = parseJsx("src/components/Article/ArticleDetail.jsx")
  const h1Case = collect(
    article,
    (candidate) =>
      candidate.type === "SwitchCase" &&
      candidate.test?.type === "StringLiteral" &&
      candidate.test.value === "h1",
  )[0]
  assert.ok(h1Case, "the article parser explicitly handles source-content h1")

  const replacement = jsxElements(h1Case, "h2")[0]
  assert.ok(replacement, "source h1 markup is replaced with h2 markup")

  const attributeCall = identifierCalls(replacement, "attributesToProps")[0]
  assert.ok(attributeCall, "source attributes are converted through attributesToProps")
  assert.equal(attributeCall.arguments[0]?.property?.name, "attribs")
  assert.equal(attributeCall.arguments[1]?.value, "h2")

  const childrenCall = identifierCalls(replacement, "domToReact")[0]
  assert.ok(childrenCall, "source children are recursively parsed")
  assert.equal(childrenCall.arguments[0]?.property?.name, "children")
})

test("A11Y_CONTENT_VIEW_H1: Content renders its page h1 only outside article detail", () => {
  const content = parseJsx("src/components/Content/Content.jsx")
  const pageHeadings = jsxElements(content, "h1").filter(
    (element) => stringAttribute(element, "className") === "a11y-visually-hidden",
  )
  assert.equal(pageHeadings.length, 1)
  assert.ok(
    collect(content, (candidate) => {
      if (candidate.type !== "LogicalExpression" || candidate.operator !== "&&") {
        return false
      }
      const condition = candidate.left
      return (
        condition.type === "UnaryExpression" &&
        condition.operator === "!" &&
        condition.argument.type === "Identifier" &&
        condition.argument.name === "activeContent" &&
        jsxElements(candidate.right, "h1").length === 1
      )
    }).length > 0,
    "the hidden page h1 is conditional on there being no active article",
  )
  assert.ok(
    collect(
      pageHeadings[0],
      (candidate) => candidate.type === "Identifier" && candidate.name === "pageTitle",
    ).length > 0,
  )
})

test("A11Y_HOME_TITLE: Home has an explicit localized semantic title source", () => {
  const titleHook = parseJsx("src/hooks/useDocumentTitle.js")
  const homeMapping = collect(
    titleHook,
    (candidate) =>
      candidate.type === "ObjectProperty" &&
      candidate.key.type === "Identifier" &&
      candidate.key.name === "home" &&
      candidate.value.type === "StringLiteral" &&
      candidate.value.value === "settings.post_login_page_option_home",
  )
  assert.equal(homeMapping.length, 1)
})

test("A11Y_LOCALE_PARITY: all six locales provide a non-empty skip-link label", () => {
  const values = {
    "en-US": "Skip to main content",
    "de-DE": "Zum Hauptinhalt springen",
    "es-ES": "Saltar al contenido principal",
    "fr-FR": "Aller au contenu principal",
    "ja-JP": "メインコンテンツへ移動",
    "zh-CN": "跳转到主要内容",
  }

  for (const [locale, expected] of Object.entries(values)) {
    const phrases = JSON.parse(readSource(`src/locales/${locale}.json`))
    assert.equal(
      phrases.actions?.skip_to_main_content,
      expected,
      `${locale} has the approved translation`,
    )
  }
})
