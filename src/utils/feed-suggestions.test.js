import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions
import { getFeedSuggestions, normalizeFeedUrl } from "./feed-suggestions.js"

test("requires both explicit choices and filters deterministically", () => {
  assert.deepEqual(getFeedSuggestions("", "any", []), [])
  assert.deepEqual(getFeedSuggestions("tech", "", []), [])
  assert.deepEqual(getFeedSuggestions("tech", "pt", []), [])
  assert.deepEqual(
    getFeedSuggestions("tech", "any", []).map(({ title }) => title),
    ["CNET", "Hacker News", "Engadget - Technology News & Expert Reviews", "The Verge"],
  )
  assert.deepEqual(getFeedSuggestions("tech", "en", []), getFeedSuggestions("tech", "en", []))
})

test("excludes normalized subscriptions without conflating paths", () => {
  assert.equal(normalizeFeedUrl("HTTP://WWW.CNET.COM/rss/news/#top"), "www.cnet.com/rss/news")
  assert.deepEqual(
    getFeedSuggestions("tech", "any", [{ feed_url: "https://www.cnet.com/rss/news" }]).map(
      ({ title }) => title,
    ),
    ["Hacker News", "Engadget - Technology News & Expert Reviews", "The Verge"],
  )
})

test("expanded snapshot is balanced, unique and HTTPS-only", () => {
  const all = ["brazil", "tech", "science", "economy"].flatMap((topic) => {
    const items = getFeedSuggestions(topic, "any", [])
    assert.equal(items.length, 4)
    return items
  })
  assert.equal(new Set(all.map(({ url }) => normalizeFeedUrl(url))).size, 16)
  assert.equal(new Set(all.map(({ url }) => new URL(url).hostname)).size, 16)
  assert.ok(all.every(({ url }) => new URL(url).protocol === "https:"))
  assert.equal(getFeedSuggestions("brazil", "en", [])[0].title, "The Rio Times")
})
