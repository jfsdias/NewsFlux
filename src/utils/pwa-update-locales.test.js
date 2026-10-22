import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const LOCALES = ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]
const read = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"))

test("PWA-03A1 update notice copy exists in every shipped locale", () => {
  for (const locale of LOCALES) {
    const phrases = read(locale)
    for (const [group, key] of [
      ["app", "update_ready_title"],
      ["app", "update_ready_description"],
      ["actions", "update_now"],
    ]) {
      assert.ok(phrases[group]?.[key]?.trim().length > 0, `${locale} ${group}.${key}`)
    }
  }
})

test("PWA-03A1 the update notice never claims it will reload by itself", () => {
  // The notice offers a choice; it must not read like a countdown or a notification of a reload.
  const english = read("en-US")

  assert.equal(english.app.update_ready_title, "Update ready")
  assert.equal(
    english.app.update_ready_description,
    "Reload to switch to the new version. Nothing changes until you choose.",
  )
  assert.equal(english.actions.update_now, "Update now")
})

test("PWA-03A1 update copy stays distinct from the GitHub version-check notice", () => {
  for (const locale of LOCALES) {
    const { app } = read(locale)
    assert.ok(app.update_ready_title && app.update_ready_description, `${locale} copy exists`)
    assert.notEqual(app.update_ready_title, app.new_version_available, locale)
    assert.notEqual(app.update_ready_description, app.new_version_available_description, locale)
  }
})
