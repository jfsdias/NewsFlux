import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// eslint-disable-next-line import/extensions -- Node's native ESM test runner requires explicit extensions.
import getEntryDisplayTitle from "./entry-display-title.js"

test("uses the localized fallback for null, undefined and empty titles", () => {
  for (const title of [null, undefined, ""]) {
    assert.equal(getEntryDisplayTitle(title, "Untitled article"), "Untitled article")
  }
})

test("uses the localized fallback for titles containing only whitespace", () => {
  for (const title of [" ".repeat(3), "\n\t"]) {
    assert.equal(getEntryDisplayTitle(title, "Untitled article"), "Untitled article")
  }
})

test("preserves valid titles exactly, including surrounding whitespace", () => {
  for (const title of ["Normal title", "  Normal title  "]) {
    assert.equal(getEntryDisplayTitle(title, "Untitled article"), title)
  }
})

test("does not infer a title from other entry fields", () => {
  const entry = {
    title: " \n ",
    previewText: "Useful feed text",
    author: "Author",
    url: "https://example.com",
  }

  assert.equal(getEntryDisplayTitle(entry.title, "Untitled article"), "Untitled article")
})

test("provides an untitled-article fallback in every shipped locale", () => {
  const expectedFallbacks = {
    "de-DE": "Artikel ohne Titel",
    "en-US": "Untitled article",
    "es-ES": "Artículo sin título",
    "fr-FR": "Article sans titre",
    "ja-JP": "タイトルのない記事",
    "zh-CN": "无标题文章",
  }

  for (const [locale, expectedFallback] of Object.entries(expectedFallbacks)) {
    const phrases = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    )
    assert.equal(phrases.article_card.untitled_article, expectedFallback, locale)
  }
})
