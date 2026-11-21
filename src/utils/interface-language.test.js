import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

// The interface ships in English only. Saved settings and browser languages from the removed
// locales (de-DE, es-ES, fr-FR, ja-JP, zh-CN) must resolve to en-US, never to a missing file.
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromAlias = specifier.startsWith("@/")
    const relative =
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    if (fromAlias || relative) {
      const target = fromAlias
        ? path.resolve(sourceRoot, specifier.slice(2))
        : path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      for (const candidate of [`${target}.js`, `${target}.jsx`]) {
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href)
        }
      }
    }
    return nextResolve(specifier)
  },
})

const { createDefaultSettings, decodeSettings, sanitizeSettings } =
  await import("@/utils/settings-schema")

test("English is the only shipped interface locale", () => {
  const files = readdirSync(path.join(sourceRoot, "locales")).filter((name) =>
    name.endsWith(".json"),
  )
  assert.deepEqual(files, ["en-US.json"])
})

test("a saved or browser language from a removed locale resolves to en-US", () => {
  for (const language of [
    "de-DE",
    "es-ES",
    "fr-FR",
    "ja-JP",
    "zh-CN",
    "zh-Hans-CN",
    "ja",
    "pt-BR",
  ]) {
    assert.equal(createDefaultSettings(language).language, "en-US", language)
    assert.equal(sanitizeSettings({ language }).language, "en-US", language)
    assert.equal(decodeSettings(JSON.stringify({ language })).language, "en-US", language)
  }
  // Other saved settings are kept when the language is replaced.
  assert.equal(
    sanitizeSettings({ language: "ja-JP", aiSummaryLength: "brief" }).aiSummaryLength,
    "brief",
  )
  assert.equal(sanitizeSettings({ language: 42 }).language, "en-US")
  assert.equal(sanitizeSettings({}).language, "en-US")
})
