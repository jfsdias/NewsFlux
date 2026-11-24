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
    ["CNET", "Hacker News"],
  )
  assert.deepEqual(getFeedSuggestions("tech", "en", []), getFeedSuggestions("tech", "en", []))
})

test("excludes normalized subscriptions without conflating paths", () => {
  assert.equal(normalizeFeedUrl("HTTP://WWW.CNET.COM/rss/news/#top"), "www.cnet.com/rss/news")
  assert.deepEqual(
    getFeedSuggestions("tech", "any", [{ feed_url: "https://www.cnet.com/rss/news" }]).map(
      ({ title }) => title,
    ),
    ["Hacker News"],
  )
})
