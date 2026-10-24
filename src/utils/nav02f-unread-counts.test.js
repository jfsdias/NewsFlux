import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import Polyglot from "node-polyglot"

// eslint-disable-next-line import/extensions
import { formatNavigationCountLabel } from "./source-navigation.js"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(sourceRoot, "..")

test("NAV-02F formatNavigationCountLabel produces human-readable unread and item count labels", () => {
  const enPhrases = JSON.parse(readFileSync(path.join(sourceRoot, "locales/en-US.json"), "utf8"))
  const polyglot = new Polyglot({ phrases: enPhrases, locale: "en-US" })

  assert.equal(formatNavigationCountLabel("All", 0, { countType: "unread", polyglot }), "All")
  assert.equal(
    formatNavigationCountLabel("All", 12, { countType: "unread", polyglot }),
    "All, 12 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 5, { countType: "items", polyglot }),
    "Starred, 5 items",
  )
  assert.equal(
    formatNavigationCountLabel("Current Feed", 0, {
      countType: "unread",
      polyglot,
      showZero: true,
    }),
    "Current Feed, 0 unread",
  )
})

test("NAV-02F all 6 locales define sidebar.unread_count_aria and sidebar.items_count_aria with interpolation tokens", () => {
  const locales = ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]
  for (const locale of locales) {
    const data = JSON.parse(
      readFileSync(path.join(sourceRoot, "locales", `${locale}.json`), "utf8"),
    )
    for (const key of ["unread_count_aria", "items_count_aria"]) {
      const value = data.sidebar?.[key]
      assert.equal(typeof value, "string", `Missing sidebar.${key} in ${locale}.json`)
      assert.ok(value.includes("%{label}"), `${locale}.json sidebar.${key} must include %{label}`)
      assert.ok(value.includes("%{count}"), `${locale}.json sidebar.${key} must include %{count}`)
    }
  }
})

test("NAV-02F Sidebar, CompactNavigation, and MediumNavigation wire human-readable count labels and tabular-nums", () => {
  const sidebarJsx = readFileSync(path.join(sourceRoot, "components/Sidebar/Sidebar.jsx"), "utf8")
  const compactNavJsx = readFileSync(
    path.join(sourceRoot, "components/Navigation/CompactNavigation.jsx"),
    "utf8",
  )
  const mediumNavJsx = readFileSync(
    path.join(sourceRoot, "components/Navigation/MediumNavigation.jsx"),
    "utf8",
  )
  const sidebarCss = readFileSync(path.join(sourceRoot, "components/Sidebar/Sidebar.css"), "utf8")
  const searchBarCss = readFileSync(
    path.join(sourceRoot, "components/Article/SearchAndSortBar.css"),
    "utf8",
  )

  assert.ok(sidebarJsx.includes("formatNavigationCountLabel"))
  assert.ok(compactNavJsx.includes("formatNavigationCountLabel"))
  assert.ok(mediumNavJsx.includes("formatNavigationCountLabel"))
  assert.match(
    sidebarCss,
    /\.unread-count,\s*\.item-count\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
  )
  assert.match(
    searchBarCss,
    /\.search-and-sort-bar\s+\.page-info\s+\.count-label\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
  )
})

test("NAV-02F decision package documents all 4 unresolved areas with all 10 required fields", () => {
  const docPath = path.join(repoRoot, "docs/NAV02F_DECISION_PACKAGE.md")
  const content = readFileSync(docPath, "utf8")

  for (const area of [
    "UNREAD_CATEGORY_GROUPING",
    "DESKTOP_SIDEBAR_WIDTH",
    "SHOW_UNREAD_FEEDS_ONLY",
    "UNREAD_COUNT_BADGE",
  ]) {
    assert.ok(content.includes(area), `Decision package missing area ${area}`)
  }

  for (const field of [
    "CURRENT_BEHAVIOR",
    "PROVIDER_SEMANTICS",
    "PERSISTENCE_IMPACT",
    "A11Y_IMPACT",
    "PHONE_IMPACT",
    "884X1104_IMPACT",
    "DESKTOP_IMPACT",
    "UPSTREAM_CONFLICT",
    "OPTIONS",
    "RECOMMENDATION",
  ]) {
    assert.ok(content.includes(field), `Decision package missing required field ${field}`)
  }
})
