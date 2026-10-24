import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"

const repoRoot = path.resolve(import.meta.dirname, "../..")

test("NNW-03 CHROME-01: FooterPanel preserves Content ownership and provides accessible radiogroup semantics", () => {
  const contentSource = fs.readFileSync(
    path.join(repoRoot, "src/components/Content/Content.jsx"),
    "utf8",
  )
  const footerSource = fs.readFileSync(
    path.join(repoRoot, "src/components/Content/FooterPanel.jsx"),
    "utf8",
  )

  // FOOTERPANEL_OWNERSHIP=Content and FOOTERPANEL_PORTAL=PROHIBITED
  assert.ok(contentSource.includes("<FooterPanel"))
  assert.ok(!footerSource.includes("createPortal"))

  // Status filter Radio.Group must expose an explicit aria-label and hide from AT on history
  assert.ok(
    footerSource.includes('aria-label={polyglot.t("article_list.filter_status_group_label")}'),
    "FooterPanel Radio.Group must provide localized aria-label",
  )
  assert.ok(
    footerSource.includes('aria-hidden={source === "history" || undefined}'),
    "FooterPanel Radio.Group must set aria-hidden when hidden on history surface",
  )
})

test("NNW-03 CHROME-01: all 6 locales define article_list.filter_status_group_label", () => {
  const localesDir = path.join(repoRoot, "src/locales")
  const localeFiles = [
    "de-DE.json",
    "en-US.json",
    "es-ES.json",
    "fr-FR.json",
    "ja-JP.json",
    "zh-CN.json",
  ]

  for (const file of localeFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf8"))
    assert.equal(
      typeof data?.article_list?.filter_status_group_label,
      "string",
      `${file} must define article_list.filter_status_group_label`,
    )
    assert.ok(data.article_list.filter_status_group_label.length > 0)
  }
})

test("NNW-03 CHROME-01: Home personalization info button and Search syntax help enforce >=44x44px coarse pointer targets", () => {
  const homeCss = fs.readFileSync(
    path.join(repoRoot, "src/components/Home/HomeEditorial.css"),
    "utf8",
  )
  const searchBarCss = fs.readFileSync(
    path.join(repoRoot, "src/components/Article/SearchAndSortBar.css"),
    "utf8",
  )

  assert.match(
    homeCss,
    /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.home-personalization-info-button[\s\S]*?min-width:\s*44px[\s\S]*?min-height:\s*44px/,
  )
  assert.match(
    searchBarCss,
    /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.search-syntax-help\.arco-btn::after[\s\S]*?inset:\s*-10px/,
  )
})

test("NNW-03 CHROME-01: complete 12-surface control inventory document exists with all required fields and classifications", () => {
  const docPath = path.join(repoRoot, "docs/NNW03_CHROME01_CONTROL_INVENTORY.md")
  assert.ok(fs.existsSync(docPath), "docs/NNW03_CHROME01_CONTROL_INVENTORY.md must exist")
  const doc = fs.readFileSync(docPath, "utf8")

  const requiredFields = [
    "CONTROL",
    "SURFACE",
    "WHEN_VISIBLE",
    "ACTION",
    "DUPLICATED_ELSEWHERE",
    "KEYBOARD_ACCESS",
    "TOUCH_ACCESS",
    "SCREEN_READER_LABEL",
    "CONTEXTUAL_OR_GLOBAL",
  ]
  for (const field of requiredFields) {
    assert.ok(doc.includes(field), `Inventory must include field ${field}`)
  }

  const requiredClassifications = [
    "GLOBAL_PERSISTENT",
    "CONTEXTUAL_PERSISTENT",
    "CONTEXTUAL_TRANSIENT",
    "DUPLICATE",
    "MUST_REMAIN_VISIBLE",
    "MENU_ELIGIBLE",
    "DO_NOT_MOVE",
  ]
  for (const cls of requiredClassifications) {
    assert.ok(doc.includes(cls), `Inventory must include classification ${cls}`)
  }

  assert.ok(doc.includes("FOOTERPANEL_OWNERSHIP=Content"))
  assert.ok(doc.includes("FOOTERPANEL_PORTAL=PROHIBITED"))
  assert.ok(doc.includes("HOLD_PRODUCT_DECISION"))
})
