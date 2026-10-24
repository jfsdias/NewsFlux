import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const readSource = (file) => readFile(path.join(root, file), "utf8")

test("Feed header uses the shared 20px FeedSourceMark for the current feed when enabled", async () => {
  const searchBar = await readSource("src/components/Article/SearchAndSortBar.jsx")

  assert.match(searchBar, /import FeedSourceMark from "@\/components\/ui\/FeedSourceMark"/)
  assert.match(searchBar, /infoFrom\s*===\s*"feed"\s*&&\s*showFeedIcon\s*&&\s*feed\s*&&\s*\(/s)
  assert.match(searchBar, /<FeedSourceMark\b(?=[^>]*\bsize=\{20\})[^>]*>/s)
  assert.match(searchBar, /<FeedSourceMark\b(?=[^>]*\bfeed=\{feed\})[^>]*>/s)
})

test("Feed header follows the existing showFeedIcon preference and reserves no icon slot when off", async () => {
  const searchBar = await readSource("src/components/Article/SearchAndSortBar.jsx")
  const css = await readSource("src/components/Article/SearchAndSortBar.css")

  assert.match(searchBar, /keys:\s*\[[^\]]*"showFeedIcon"[^\]]*\]/s)
  assert.match(searchBar, /infoFrom\s*===\s*"feed"\s*&&\s*showFeedIcon\s*&&\s*feed\s*&&\s*\(/s)
  assert.match(css, /\.page-info-feed\s+\.title-container\s*\{[^}]*min-width:\s*0/s)
})

test("Feed header preserves the existing feed title and dynamic count rendering", async () => {
  const searchBar = await readSource("src/components/Article/SearchAndSortBar.jsx")

  assert.match(
    searchBar,
    /return\s*\{\s*feed,\s*title:\s*feed\?\.title,\s*count:\s*dynamicCount\s*\}/s,
  )
  assert.match(searchBar, /<Typography\.Ellipsis[\s\S]*?>\s*\{title\}\s*<\/Typography\.Ellipsis>/)
  assert.match(
    searchBar,
    /<Typography\.Text className="count-label">\(\{count\}\)<\/Typography\.Text>/,
  )
})

test("Feed header SourceMark remains decorative and comes from the existing shared pipeline", async () => {
  const searchBar = await readSource("src/components/Article/SearchAndSortBar.jsx")
  const sourceMark = await readSource("src/components/ui/SourceMark.jsx")

  assert.match(sourceMark, /<span\s+aria-hidden="true"/)
  assert.doesNotMatch(searchBar, /getFeedIcon|fetch\s*\(/)
})

test("Feed header SourceMark uses the existing catalog feed object only for Feed routes", async () => {
  const searchBar = await readSource("src/components/Article/SearchAndSortBar.jsx")

  assert.match(
    searchBar,
    /if\s*\(infoFrom\s*===\s*"feed"\)\s*\{\s*const\s+feed\s*=\s*feeds\.find\(/s,
  )
  assert.match(searchBar, /feed\?\.title/)
})

test("mounted Feed header browser fixture exposes the required visual and preference gates", async () => {
  const fixture = await readSource("scripts/tests/nnw01-d-feed-header.jsx")

  assert.match(fixture, /import SearchAndSortBar from "@\/components\/Article\/SearchAndSortBar"/)
  assert.match(fixture, /createMemoryRouter/)
  for (const gate of [
    "FEED_HEADER_SOURCEMARK_ON",
    "FEED_HEADER_SOURCEMARK_OFF",
    "SOURCEMARK_ON_CORRECT",
    "SOURCEMARK_OFF_CORRECT",
    "FEED_HEADER_SOURCEMARK_SIZE_20",
    "FEED_HEADER_SOURCEMARK_CENTERED",
    "FEED_HEADER_HEIGHT_NOT_INFLATED",
    "FEED_HEADER_NAME_UNCHANGED",
    "FEED_HEADER_COUNT_UNCHANGED",
    "FEED_HEADER_NO_EMPTY_SLOT_WHEN_OFF",
    "FEED_HEADER_DECORATIVE_A11Y",
    "FEED_HEADER_NO_EXTRA_NETWORK",
    "WRONG_FEED_ID_ICON_REQUESTS",
    "NO_CLIPPING",
    "NO_HORIZONTAL_OVERFLOW",
    "NO_HEADER_CONTROL_COLLISION",
    "TITLE_BEHAVIOR_NOT_WORSE",
    "COUNT_READABLE",
  ]) {
    assert.ok(fixture.includes(`"${gate}"`), `${gate} browser gate must be present`)
  }
  assert.match(fixture, /query\.get\("theme"\)/)
  assert.match(fixture, /query\.get\("showFeedIcon"\)/)
  assert.match(fixture, /innerWidth/)
  assert.match(fixture, /innerHeight/)
})
