import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const root = fileURLToPath(new URL("../", import.meta.url))
const readSource = (file) => readFile(path.join(root, file), "utf8")
const hmrServer = createHttpServer()
const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { entries: [], include: [], noDiscovery: true },
  root,
  cacheDir: "/private/tmp/newsflux-nnw01-c-vite-cache",
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
const { getReaderSourceIdentity } = await vite.ssrLoadModule("/src/utils/source-identity.js")

after(async () => {
  await vite.close()
  hmrServer.close()
})

test("Reader source identity shows a safe hostname only when it adds information", async () => {
  assert.deepEqual(
    getReaderSourceIdentity({ title: "The Verge", site_url: "https://theverge.com/path" }),
    { displayName: "The Verge", secondaryHostname: "theverge.com" },
  )
  assert.deepEqual(
    getReaderSourceIdentity({ title: " example.com ", site_url: "https://EXAMPLE.com/feed" }),
    { displayName: "example.com", secondaryHostname: null },
  )
  assert.deepEqual(
    getReaderSourceIdentity({
      title: "",
      site_url: "https://example.com/",
      feed_url: "https://rss.example.net/",
    }),
    { displayName: "example.com", secondaryHostname: null },
  )
})

test("Reader source identity prefers site host and suppresses unsafe or malformed hosts", async () => {
  assert.deepEqual(
    getReaderSourceIdentity({
      title: "News",
      site_url: "https://site.example/",
      feed_url: "https://feed.example/rss",
    }),
    { displayName: "News", secondaryHostname: "site.example" },
  )
  assert.deepEqual(
    getReaderSourceIdentity({
      title: "News",
      site_url: "not a URL",
      feed_url: "javascript:alert(1)",
    }),
    { displayName: "News", secondaryHostname: null },
  )
  assert.deepEqual(
    getReaderSourceIdentity({ title: "", site_url: "file:///tmp/feed", feed_url: "" }),
    { displayName: null, secondaryHostname: null },
  )
})

test("Reader has no empty source identity to expose as an interactive target", async () => {
  assert.deepEqual(getReaderSourceIdentity({ title: "  ", site_url: "invalid", feed_url: "" }), {
    displayName: null,
    secondaryHostname: null,
  })
  const article = await readSource("src/components/Article/ArticleDetail.jsx")
  assert.match(article, /readerSourceIdentity\.displayName/)
})

test("Reader uses the catalog feed first and the embedded feed only as fallback", async () => {
  const article = await readSource("src/components/Article/ArticleDetail.jsx")
  assert.match(article, /catalogFeedsByIdState/)
  assert.match(
    article,
    /catalogFeedsById\.get\(String\(activeContent\.feed\.id\)\)\s*\?\?\s*activeContent\.feed/,
  )
  assert.match(article, /getReaderSourceIdentity\(resolvedFeed\)/)
})

test("Reader source block uses the shared decorative 24px mark and the existing icon preference", async () => {
  const article = await readSource("src/components/Article/ArticleDetail.jsx")
  const settings = await readSource("src/store/settingsState.js")
  assert.match(article, /FeedSourceMark/)
  assert.match(article, /showFeedIcon\s*&&\s*\(?\s*<FeedSourceMark[^>]*size=\{24\}/s)
  assert.match(article, /className="article-source-link"/)
  assert.match(settings, /articleDetailSettingsState[\s\S]*?showFeedIcon/)
})

test("showFeedIcon description is localized across every supported locale", async () => {
  const files = ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]
  const descriptions = await Promise.all(
    files.map(async (locale) => {
      const phrases = JSON.parse(await readSource(`src/locales/${locale}.json`))
      return phrases.appearance.show_feed_icon_description
    }),
  )

  for (const description of descriptions) {
    assert.ok(description)
    assert.doesNotMatch(description, /SourceMark|adaptive plate|D1/i)
    assert.notEqual(description, "Show feed icon in feed list and article card")
  }
  assert.equal(new Set(descriptions).size, files.length)
})
