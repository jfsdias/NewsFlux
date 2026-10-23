import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const readSource = (file) => readFile(path.join(root, file), "utf8")

test("Settings source selector uses the shared FeedSourceMark instead of legacy FeedIcon", async () => {
  const picker = await readSource("src/components/Settings/HomePagePicker.jsx")

  assert.match(picker, /import FeedSourceMark from "@\/components\/ui\/FeedSourceMark"/)
  assert.doesNotMatch(picker, /import FeedIcon from "@\/components\/ui\/FeedIcon"/)
  assert.match(picker, /<FeedSourceMark\b/)
  assert.doesNotMatch(picker, /<FeedIcon\b/)
})

test("Settings selector uses the approved 16px SourceMark size", async () => {
  const picker = await readSource("src/components/Settings/HomePagePicker.jsx")

  assert.match(picker, /<FeedSourceMark\b(?=[^>]*\bsize=\{16\})[^>]*>/s)
  const sourceMark = await readSource("src/components/ui/SourceMark.jsx")
  assert.match(sourceMark, /new Set\(\[16, 20, 24\]\)/)
})

test("showFeedIcon off keeps the existing decorative local RSS target icon", async () => {
  const picker = await readSource("src/components/Settings/HomePagePicker.jsx")
  const feedTargetIcon = picker.match(
    /const FeedTargetIcon = \([\s\S]*?\n\}\n\nconst TargetButton/,
  )?.[0]

  assert.ok(feedTargetIcon, "FeedTargetIcon should define the selector's icon behavior")
  assert.match(feedTargetIcon, /if \(!showFeedIcon\)\s*\{\s*return fallbackIcon\s*\}/)
  assert.match(feedTargetIcon, /<RssIcon className="home-page-target-icon" \/>/)
  assert.match(feedTargetIcon, /return \([\s\S]*?<FeedSourceMark\b/)
})

test("Settings selector preserves its 18px icon slot and does not override SourceMark fitting", async () => {
  const pickerCss = await readSource("src/components/Settings/HomePagePicker.css")
  const sourceMarkCss = await readSource("src/components/ui/SourceMark.css")

  assert.match(pickerCss, /\.home-page-target-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px/s)
  assert.doesNotMatch(pickerCss, /\.home-page-target-feed-icon\s*\{[^}]*object-fit:\s*cover/s)
  assert.match(sourceMarkCss, /\.source-mark__image\s*\{[^}]*object-fit:\s*contain/s)
})

test("Settings picker mobile modal overrides Arco's inline width without clipping", async () => {
  const pickerCss = await readSource("src/components/Settings/HomePagePicker.css")
  const mobileRules = pickerCss.match(/@media screen and \(max-width: 768px\)\s*\{([\s\S]*)$/)?.[1]

  assert.ok(mobileRules, "mobile picker rules should be present")
  assert.match(mobileRules, /\.home-page-picker-modal\s*\{[^}]*top:\s*0\s*!important/s)
  assert.match(mobileRules, /\.home-page-picker-modal\s*\{[^}]*width:\s*100%\s*!important/s)
})

test("Settings selector SourceMark stays decorative without a second accessible name", async () => {
  const sourceMark = await readSource("src/components/ui/SourceMark.jsx")
  const picker = await readSource("src/components/Settings/HomePagePicker.jsx")

  assert.match(sourceMark, /<span\s+aria-hidden="true"/)
  assert.doesNotMatch(picker, /<FeedSourceMark[^>]*aria-label=/s)
})

test("mounted Settings selector browser fixture covers the real component and responsive/theme states", async () => {
  const fixture = await readSource("scripts/tests/nnw01-c-settings-picker.jsx")

  assert.match(fixture, /import HomePagePicker from "@\/components\/Settings\/HomePagePicker"/)
  assert.match(fixture, /createRoot\(document\.querySelector\("#root"\)\)\.render/)
  for (const gate of [
    "PROVIDER_ICON",
    "NON_SQUARE_PROVIDER",
    "MONOGRAM",
    "RSS_FALLBACK",
    "SHOW_FEED_ICON_OFF_GENERIC_RSS",
    "SHOW_FEED_ICON_OFF_NO_PROVIDER_REQUEST",
    "CATEGORY_INDENTATION",
    "TARGET_CHECK_NO_COLLISION",
    "HIDDEN_BADGE_VISIBLE",
    "KEYBOARD_FOCUS_VISIBLE",
    "MODAL_ENTERED",
    "MODAL_FITS_VIEWPORT",
  ]) {
    assert.ok(fixture.includes(`"${gate}"`), `${gate} browser gate must be present`)
  }
  assert.match(fixture, /get\("autorun"\) !== "1"/)
  assert.match(fixture, /getCurrentHomeTarget\(\)/)
  assert.match(fixture, /data-testid="source-selection-result"/)
})
