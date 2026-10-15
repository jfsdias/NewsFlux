import assert from "node:assert/strict"
import test from "node:test"

const { default: getFeedMonogram } = await import(new URL("feed-icon.js", import.meta.url))

test("feed monogram uses a deterministic title initial and empty-title mark", () => {
  assert.equal(typeof getFeedMonogram, "function", "feed monogram generator is not implemented")
  assert.equal(getFeedMonogram("  Ciência Hoje"), "C")
  assert.equal(getFeedMonogram("Época"), "É")
  assert.equal(getFeedMonogram("東京"), "東")
  assert.equal(getFeedMonogram("  "), "•")
})

test("feed monogram preserves an emoji presentation grapheme", () => {
  assert.equal(getFeedMonogram("🛰️ Notícias"), "🛰️")
})

test("feed monogram limits uppercase expansions to one grapheme", () => {
  assert.equal(getFeedMonogram("ß Feed"), "S")
})
