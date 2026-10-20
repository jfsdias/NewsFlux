import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("near-viewport gating defers the existing Plyr lazy module until activation", () => {
  const lazyPlayer = readSource("src/components/ui/LazyPlyrPlayer.jsx")

  assert.match(lazyPlayer, /observeNearViewport\(\s*containerRef\.current/)
  assert.match(lazyPlayer, /isActivated \? \(/)
  assert.match(lazyPlayer, /<PlyrPlayer \{\.\.\.props\} \/>/)
  assert.match(lazyPlayer, /<Suspense fallback=\{placeholder\}>/)
})

test("browser report exposes unambiguous deferred-init and lifecycle counts", () => {
  const harness = readSource("scripts/tests/reader-media-01a.jsx")

  assert.match(harness, /farMediaDeferred/)
  assert.match(harness, /playerCountAfterNearScroll/)
  assert.match(harness, /playerCountAfterActivation/)
  assert.match(harness, /playerCleanupCount/)
})

test("inline video and enclosure media retain their existing Plyr routes", () => {
  const article = readSource("src/components/Article/ArticleDetail.jsx")
  const enclosure = readSource("src/components/Article/EnclosurePlayer.jsx")

  assert.match(article, /case "video":\s*\{\s*return handleVideo\(node\)/)
  assert.match(article, /<PlyrPlayer poster=\{thumbnailUrl\} src=\{playlistUrl\} \/>/)
  assert.match(article, /<EnclosurePlayer[\s\S]*?enclosure=\{primaryMedia\}/)
  assert.match(enclosure, /import PlyrPlayer from "@\/components\/ui\/LazyPlyrPlayer"/)
  assert.doesNotMatch(article, /case "audio":/)
})

test("HLS.js and Safari native-HLS fallback remain present and unchanged in behavior", () => {
  const player = readSource("src/components/ui/PlyrPlayer.jsx")

  assert.match(player, /importWhileMounted\(\(\) => import\("hls\.js"\), isCancelled\)/)
  assert.match(player, /if \(!Hls\.isSupported\(\)\)/)
  assert.match(player, /mediaElement\.canPlayType\("application\/vnd\.apple\.mpegurl"\)/)
  assert.match(player, /const hls = new Hls\(\)/)
  assert.match(player, /hls\.loadSource\(src\)/)
  assert.match(player, /hls\.attachMedia\(mediaElement\)/)
})

test("inline audio and iframe remain native article markup paths", () => {
  const article = readSource("src/components/Article/ArticleDetail.jsx")

  assert.match(article, /const handleIframe = \(node\) =>/)
  assert.match(article, /loading=\{iframeProps\.loading \?\? "lazy"\}/)
  assert.doesNotMatch(article, /case "audio":/)
})
