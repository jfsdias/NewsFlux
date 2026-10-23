import assert from "node:assert/strict"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

const root = fileURLToPath(new URL("../", import.meta.url))
const hmrServer = createHttpServer()
const vite = await createServer({
  appType: "custom",
  configFile: false,
  plugins: [react()],
  optimizeDeps: { entries: [], include: [], noDiscovery: true },
  resolve: { alias: [{ find: "@", replacement: path.resolve(root, "src") }] },
  root,
  cacheDir: "/private/tmp/newsflux-nnw01-a-vite-cache",
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
const { default: SourceMark } = await vite.ssrLoadModule("/src/components/ui/SourceMark.jsx")

after(async () => {
  await vite.close()
  hmrServer.close()
})

const render = (props) => renderToStaticMarkup(React.createElement(SourceMark, props))
const feed = (overrides = {}) => ({
  title: "Example News",
  site_url: "https://news.example.test/rss",
  ...overrides,
})

test("SourceMark renders a provider icon as a decorative contained square at supported scales", () => {
  for (const size of [16, 20, 24]) {
    const markup = render({ feed: feed(), providerIconUrl: "data:image/png;base64,AA==", size })
    assert.match(markup, /aria-hidden="true"/)
    assert.match(markup, /alt=""/)
    assert.match(markup, /data-source-mark-fallback="provider"/)
    assert.match(markup, new RegExp(`--source-mark-size:${size}px`))
    assert.match(markup, /src="data:image\/png;base64,AA=="/)
    assert.match(markup, /source-mark--neutral/)
  }
})

test("SourceMark uses a deterministic local monogram before its local RSS terminal", () => {
  assert.match(
    render({ feed: feed({ title: "📰 Notícias" }) }),
    /data-source-mark-fallback="monogram"/,
  )
  assert.match(render({ feed: feed({ title: "📰 Notícias" }) }), />N</)

  const rss = render({
    feed: feed({ title: "📰", site_url: "http://192.168.1.1/rss", feed_url: "" }),
  })
  assert.match(rss, /data-source-mark-fallback="rss"/)
  assert.match(rss, /source-mark__rss/)
})

test("SourceMark rejects only invalid or sub-eight-pixel known provider dimensions", () => {
  const invalid = render({
    feed: feed(),
    providerIconUrl: "data:image/png;base64,AA==",
    providerIconWidth: 7,
    providerIconHeight: 24,
  })
  assert.match(invalid, /data-source-mark-fallback="monogram"/)
  assert.doesNotMatch(invalid, /<img/)

  const wide = render({
    feed: feed(),
    providerIconUrl: "data:image/png;base64,AA==",
    providerIconWidth: 64,
    providerIconHeight: 24,
  })
  assert.match(wide, /data-source-mark-fallback="provider"/)
  assert.match(wide, /source-mark__image/)

  const minimum = render({
    feed: feed(),
    providerIconUrl: "data:image/png;base64,AA==",
    providerIconWidth: 8,
    providerIconHeight: 8,
  })
  assert.match(minimum, /data-source-mark-fallback="provider"/)
})

test("SourceMark contains no third-party favicon lookup or fetch path", async () => {
  const { readFile } = await import("node:fs/promises")
  const source = await readFile(path.resolve(root, "src/components/ui/SourceMark.jsx"), "utf8")
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|duckduckgo|google\.com\/s2\/favicons/i)
})
