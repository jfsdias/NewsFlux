import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const LOCALES = ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]
const read = (locale) =>
  JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"))

test("BULK-03A relative mark-read copy exists with interpolation in every shipped locale", () => {
  for (const locale of LOCALES) {
    const phrases = read(locale)
    for (const key of [
      "mark_articles_above_as_read_tooltip",
      "mark_articles_below_as_read_tooltip",
    ]) {
      assert.ok(phrases.article_card[key]?.length > 0, `${locale} article_card.${key}`)
    }
    for (const key of [
      "mark_relative_as_read_success",
      "mark_relative_as_read_error",
      "mark_relative_as_read_partial",
    ]) {
      assert.ok(phrases.article_list[key]?.length > 0, `${locale} article_list.${key}`)
    }
    assert.match(phrases.article_list.mark_relative_as_read_success, /%\{smart_count\}/, locale)
    assert.match(phrases.article_list.mark_relative_as_read_partial, /%\{marked\}/, locale)
    assert.match(phrases.article_list.mark_relative_as_read_partial, /%\{total\}/, locale)
  }
})

test("BULK-03A English source copy matches the frozen contract", () => {
  const { article_card: card, article_list: list } = read("en-US")
  assert.equal(card.mark_articles_above_as_read_tooltip, "Mark articles above as read")
  assert.equal(card.mark_articles_below_as_read_tooltip, "Mark articles below as read")
  assert.equal(
    list.mark_relative_as_read_success,
    "%{smart_count} article marked as read |||| %{smart_count} articles marked as read",
  )
})
