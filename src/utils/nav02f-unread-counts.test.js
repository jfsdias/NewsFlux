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

test("NAV-02F formatNavigationCountLabel produces plural-aware unread and item count labels across count=0, 1, 2, 999, 1000", () => {
  const enPhrases = JSON.parse(readFileSync(path.join(sourceRoot, "locales/en-US.json"), "utf8"))
  const polyglot = new Polyglot({ phrases: enPhrases, locale: "en-US" })

  // count = 0 (default omits count; showZero=true announces 0)
  assert.equal(formatNavigationCountLabel("All", 0, { countType: "unread", polyglot }), "All")
  assert.equal(
    formatNavigationCountLabel("Starred", 0, { countType: "items", polyglot }),
    "Starred",
  )
  assert.equal(
    formatNavigationCountLabel("Current Feed", 0, {
      countType: "unread",
      polyglot,
      showZero: true,
    }),
    "Current Feed, 0 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 0, {
      countType: "items",
      polyglot,
      showZero: true,
    }),
    "Starred, 0 items",
  )

  // count = 1 (singular item, never "1 items")
  assert.equal(
    formatNavigationCountLabel("All", 1, { countType: "unread", polyglot }),
    "All, 1 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 1, { countType: "items", polyglot }),
    "Starred, 1 item",
  )
  assert.equal(formatNavigationCountLabel("Starred", 1, { countType: "items" }), "Starred, 1 item")

  // count = 2
  assert.equal(
    formatNavigationCountLabel("All", 2, { countType: "unread", polyglot }),
    "All, 2 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 2, { countType: "items", polyglot }),
    "Starred, 2 items",
  )

  // count = 999
  assert.equal(
    formatNavigationCountLabel("All", 999, { countType: "unread", polyglot }),
    "All, 999 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 999, { countType: "items", polyglot }),
    "Starred, 999 items",
  )

  // count = 1000 (aria-label preserves exact count while visual badge caps at 999+)
  assert.equal(
    formatNavigationCountLabel("All", 1000, { countType: "unread", polyglot }),
    "All, 1000 unread",
  )
  assert.equal(
    formatNavigationCountLabel("Starred", 1000, { countType: "items", polyglot }),
    "Starred, 1000 items",
  )
})

test("NAV-02F all 6 locales define grammatically appropriate singular/plural forms for sidebar.unread_count_aria and sidebar.items_count_aria", () => {
  const expectedByLocale = {
    "de-DE": {
      unread1: "Alle, 1 ungelesen",
      unread2: "Alle, 2 ungelesen",
      items1: "Lesezeichen, 1 Eintrag",
      items2: "Lesezeichen, 2 Einträge",
      labelUnread: "Alle",
      labelItems: "Lesezeichen",
    },
    "en-US": {
      unread1: "All, 1 unread",
      unread2: "All, 2 unread",
      items1: "Starred, 1 item",
      items2: "Starred, 2 items",
      labelUnread: "All",
      labelItems: "Starred",
    },
    "es-ES": {
      unread1: "Todo, 1 sin leer",
      unread2: "Todo, 2 sin leer",
      items1: "Favoritos, 1 elemento",
      items2: "Favoritos, 2 elementos",
      labelUnread: "Todo",
      labelItems: "Favoritos",
    },
    "fr-FR": {
      unread1: "Tout, 1 non lu",
      unread2: "Tout, 2 non lus",
      items1: "Favoris, 1 élément",
      items2: "Favoris, 2 éléments",
      labelUnread: "Tout",
      labelItems: "Favoris",
    },
    "ja-JP": {
      unread1: "すべて、未読 1 件",
      unread2: "すべて、未読 2 件",
      items1: "スター付き、1 件",
      items2: "スター付き、2 件",
      labelUnread: "すべて",
      labelItems: "スター付き",
    },
    "zh-CN": {
      unread1: "全部，1 篇未读",
      unread2: "全部，2 篇未读",
      items1: "收藏，1 个条目",
      items2: "收藏，2 个条目",
      labelUnread: "全部",
      labelItems: "收藏",
    },
  }

  for (const [locale, expected] of Object.entries(expectedByLocale)) {
    const data = JSON.parse(
      readFileSync(path.join(sourceRoot, "locales", `${locale}.json`), "utf8"),
    )
    for (const key of ["unread_count_aria", "items_count_aria"]) {
      const value = data.sidebar?.[key]
      assert.equal(typeof value, "string", `Missing sidebar.${key} in ${locale}.json`)
      assert.ok(value.includes("%{label}"), `${locale}.json sidebar.${key} must include %{label}`)
      assert.ok(value.includes("%{count}"), `${locale}.json sidebar.${key} must include %{count}`)
    }

    const polyglot = new Polyglot({ phrases: data, locale })
    assert.equal(
      formatNavigationCountLabel(expected.labelUnread, 1, { countType: "unread", polyglot }),
      expected.unread1,
      `Mismatch for ${locale} unread count=1`,
    )
    assert.equal(
      formatNavigationCountLabel(expected.labelUnread, 2, { countType: "unread", polyglot }),
      expected.unread2,
      `Mismatch for ${locale} unread count=2`,
    )
    assert.equal(
      formatNavigationCountLabel(expected.labelItems, 1, { countType: "items", polyglot }),
      expected.items1,
      `Mismatch for ${locale} items count=1`,
    )
    assert.equal(
      formatNavigationCountLabel(expected.labelItems, 2, { countType: "items", polyglot }),
      expected.items2,
      `Mismatch for ${locale} items count=2`,
    )
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
