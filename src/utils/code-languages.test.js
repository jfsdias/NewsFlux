import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const codeLanguagesModule = await import(new URL("code-languages.js", import.meta.url)).catch(
  () => null,
)

test("code language aliases and source hints resolve without changing unsupported hints", () => {
  assert.ok(codeLanguagesModule, "code-languages utility should exist")

  const { getCodeLanguage, normalizeCodeLanguage } = codeLanguagesModule
  assert.equal(normalizeCodeLanguage(" JS "), "javascript")
  assert.equal(normalizeCodeLanguage("tsx"), "typescript")
  assert.equal(normalizeCodeLanguage("nohighlight"), "plaintext")
  assert.equal(normalizeCodeLanguage("language-madeup"), null)

  assert.equal(
    getCodeLanguage({
      children: [{ name: "code", attribs: { class: "token language-js" } }],
    }),
    "javascript",
  )
  assert.equal(
    getCodeLanguage({
      attribs: { "data-language": "json" },
      children: [{ name: "code", attribs: { class: "language-python" } }],
    }),
    "python",
  )
  assert.equal(getCodeLanguage({ attribs: { class: "nohighlight" }, children: [] }), "plaintext")
  assert.equal(
    getCodeLanguage({ attribs: { "data-language": "unknown-lang" }, children: [] }),
    null,
  )
})

test("all locales have the complete accessible code-control vocabulary", () => {
  assert.ok(codeLanguagesModule, "code-languages utility should exist")

  const requiredActions = [
    "code_language",
    "code_language_auto",
    "code_language_unknown",
    "enable_syntax_highlighting",
    "disable_syntax_highlighting",
    "code_line_numbers",
    "code_word_wrap",
    "copy_to_clipboard_tooltip",
  ]
  const localeDirectory = new URL("../locales/", import.meta.url)
  const localeFiles = readdirSync(localeDirectory).filter((file) => file.endsWith(".json"))

  for (const localeFile of localeFiles) {
    const locale = JSON.parse(readFileSync(new URL(localeFile, localeDirectory), "utf8"))
    for (const key of requiredActions) {
      assert.equal(
        typeof locale.actions?.[key],
        "string",
        `${localeFile} is missing actions.${key}`,
      )
      assert.notEqual(locale.actions[key].trim(), "", `${localeFile} has an empty actions.${key}`)
    }
  }
})
