import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import postcss from "postcss"

const sidebarSource = readFileSync(
  new URL("../src/components/Sidebar/Sidebar.jsx", import.meta.url),
  "utf8",
)
const sidebarCss = postcss.parse(
  readFileSync(new URL("../src/components/Sidebar/Sidebar.css", import.meta.url), "utf8"),
)
const sidebarTriggerCss = postcss.parse(
  readFileSync(new URL("../src/components/Article/SidebarTrigger.css", import.meta.url), "utf8"),
)
const arcoCss = postcss.parse(
  readFileSync(
    new URL("../node_modules/@arco-design/web-react/dist/css/arco.css", import.meta.url),
    "utf8",
  ),
)

const rulesForSelector = (root, selector) => {
  const matchingRules = []
  root.walkRules((rule) => {
    if (rule.selectors?.includes(selector)) {
      matchingRules.push(rule)
    }
  })
  return matchingRules
}

const declarationValue = (rules, property) =>
  rules
    .flatMap((rule) => rule.nodes ?? [])
    .find((node) => node.type === "decl" && node.prop === property)?.value

const coarsePointerRules = (root) => {
  const media = []
  root.walkAtRules("media", (rule) => {
    if (/any-pointer\s*:\s*coarse/.test(rule.params)) {
      media.push(rule)
    }
  })
  return media.flatMap((rule) => {
    const rules = []
    rule.walkRules((node) => rules.push(node))
    return rules
  })
}

const coarseRules = [...coarsePointerRules(sidebarCss), ...coarsePointerRules(sidebarTriggerCss)]
const matchesSelector = (rule, selector) =>
  rule.selectors?.some((candidate) => candidate === selector || candidate.endsWith(` ${selector}`))

const coarseDeclarationsFor = (selector) =>
  coarseRules.filter((rule) => matchesSelector(rule, selector)).flatMap((rule) => rule.nodes ?? [])

const assertCoarseMinimum = (selector, property, expected) => {
  const declaration = coarseDeclarationsFor(selector).find(
    (node) => node.type === "decl" && node.prop === property,
  )

  assert.ok(declaration, `${selector} needs a coarse-pointer ${property} override`)
  assert.equal(Number.parseFloat(declaration.value), expected, `${selector} ${property}`)
}

test("fine-pointer navigation keeps its existing compact baseline", () => {
  assert.equal(
    declarationValue(
      rulesForSelector(arcoCss, ".arco-menu-vertical .arco-menu-item"),
      "line-height",
    ),
    "40px",
  )
  assert.equal(
    declarationValue(
      rulesForSelector(arcoCss, ".arco-btn-size-small.arco-btn-shape-circle"),
      "height",
    ),
    "28px",
  )
  assert.equal(
    declarationValue(rulesForSelector(sidebarCss, ".feed-health-trigger.arco-btn"), "min-height"),
    "40px",
  )
  assert.equal(
    declarationValue(rulesForSelector(sidebarCss, ".home-brand"), "padding"),
    "4px 8px 4px 4px",
  )
  assert.match(sidebarSource, /className="home-brand-logo"[\s\S]*?height="32"/)
})

test("coarse-pointer navigation targets have a 48px minimum", () => {
  for (const selector of [
    ".sidebar-container .arco-menu-vertical .arco-menu-item",
    ".sidebar-container .arco-menu-vertical .arco-menu-inline-header",
    ".category-title",
    ".arco-collapse-item-header",
    ".home-brand",
    ".sidebar .desktop-sidebar-toggle.arco-btn",
    ".sidebar-section-action",
    ".sidebar-profile-trigger",
    ".feed-health-trigger.arco-btn",
    ".feed-health-retry.arco-btn",
    ".source-mode-option",
    ".source-filter-input",
    ".source-filter-clear.arco-btn",
  ]) {
    assertCoarseMinimum(selector, "min-height", 48)
  }

  for (const selector of [
    ".mobile-sidebar-close.arco-btn",
    ".reader-sidebar-trigger.arco-btn",
    ".trigger.arco-btn",
    ".desktop-sidebar-reopen.arco-btn",
  ]) {
    assertCoarseMinimum(selector, "min-height", 48)
    assertCoarseMinimum(selector, "min-width", 48)
  }

  assertCoarseMinimum(".sidebar-container .arco-menu-vertical .arco-menu-item", "line-height", 48)
  assertCoarseMinimum(
    ".sidebar-container .arco-menu-vertical .arco-menu-inline-header",
    "line-height",
    48,
  )
})
