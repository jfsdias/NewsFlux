import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

const root = fileURLToPath(new URL("../", import.meta.url))
const readSource = (relativePath) => readFileSync(path.resolve(root, relativePath), "utf8")

// FeedIcon only needs the API client through useFeedIcons, whose effects never run during a
// static render. The real client pulls in the browser router (which needs `document`), so the
// tests swap it for a stub that fails loudly if anything ever tries to use the network.
const API_CLIENT_STUB_ID = "virtual:nnw01-p-api-client-stub"
const apiClientStub = {
  name: "nnw01-p-api-client-stub",
  resolveId: (source) => (source === API_CLIENT_STUB_ID ? `\0${API_CLIENT_STUB_ID}` : null),
  load: (id) =>
    id === `\0${API_CLIENT_STUB_ID}`
      ? 'export const getFeedIcon = () => { throw new Error("network access is disabled in this test") }'
      : null,
}

const hmrServer = createHttpServer()
const vite = await createServer({
  appType: "custom",
  configFile: false,
  plugins: [apiClientStub, react()],
  optimizeDeps: { entries: [], include: [], noDiscovery: true },
  resolve: {
    alias: [
      { find: /^@\/apis$/, replacement: API_CLIENT_STUB_ID },
      { find: "@", replacement: path.resolve(root, "src") },
    ],
  },
  root,
  server: { middlewareMode: true, ws: { server: hmrServer } },
})
const { default: FeedIcon } = await vite.ssrLoadModule("/src/components/ui/FeedIcon.jsx")
const { feedIconsState, resetFeedIcons } = await vite.ssrLoadModule("/src/store/feedIconsState.js")

after(async () => {
  await vite.close()
  hmrServer.close()
})

const PROVIDER_ICON_URL = "data:image/png;base64,iVBORw0KGgo="

const createFeed = ({ iconId = 0, siteUrl = "", feedUrl = "" } = {}) => ({
  id: 7,
  title: "Example Feed",
  site_url: siteUrl,
  feed_url: feedUrl,
  icon: { feed_id: 7, icon_id: iconId },
})

const render = (feed, props = {}) =>
  renderToStaticMarkup(React.createElement(FeedIcon, { feed, ...props }))

const imageSources = (markup) => [...markup.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])

const isRemoteURL = (value) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value)

test.beforeEach(() => {
  resetFeedIcons()
})

test("NNW01-P a feed without a provider icon renders only the bundled local fallback", () => {
  const markup = render(
    createFeed({ siteUrl: "https://news.example.test/", feedUrl: "https://news.example.test/rss" }),
  )

  assert.deepEqual(imageSources(markup), ["/default-feed-icon.png"])
})

test("NNW01-P a feed without a provider icon renders the local monogram when requested", () => {
  const markup = render(createFeed({ siteUrl: "https://news.example.test/" }), {
    monogramFallback: true,
  })

  assert.deepEqual(imageSources(markup), [])
  assert.match(markup, /feed-icon-monogram/)
  assert.match(markup, />E</)
})

test("NNW01-P a feed without a provider icon renders the supplied local fallback node", () => {
  const markup = render(createFeed({ siteUrl: "https://news.example.test/" }), {
    fallbackIcon: React.createElement("svg", { "data-local-fallback": "rss" }),
  })

  assert.match(markup, /data-local-fallback="rss"/)
  assert.deepEqual(imageSources(markup), [])
})

test("NNW01-P a loaded Miniflux provider icon is rendered as-is", () => {
  feedIconsState.setKey(7, { url: PROVIDER_ICON_URL, width: null, height: null })

  const markup = render(createFeed({ iconId: 7, siteUrl: "https://news.example.test/" }), {
    monogramFallback: true,
  })

  assert.deepEqual(imageSources(markup), [PROVIDER_ICON_URL])
})

test("NNW01-P a provider icon that is still loading shows the local placeholder, not a remote icon", () => {
  const markup = render(createFeed({ iconId: 7, siteUrl: "https://news.example.test/" }))

  assert.deepEqual(imageSources(markup), ["/default-feed-icon.png"])
})

for (const [name, siteUrl, feedUrl] of [
  ["userinfo and port", "https://reader:secret@news.example.test:8443/", ""],
  ["multipart suffix co.uk", "https://www.bbc.co.uk/news", ""],
  ["multipart suffix com.br", "https://noticias.uol.com.br/", ""],
  ["multipart suffix gov.br", "https://www.gov.br/", ""],
  ["multipart suffix jus.br", "https://www.stj.jus.br/", ""],
  ["localhost", "http://localhost:8080/", "http://localhost:8080/rss"],
  ["IP literal", "http://192.168.1.10/", "http://192.168.1.10/rss"],
  ["site URL missing, feed URL only", "", "https://feeds.example.test/rss"],
  ["malformed URLs", "not a url", "also not a url"],
]) {
  test(`NNW01-P no remote icon request can be built for ${name}`, () => {
    for (const monogramFallback of [false, true]) {
      const markup = render(createFeed({ siteUrl, feedUrl }), { monogramFallback })

      assert.deepEqual(
        imageSources(markup).filter((source) => isRemoteURL(source)),
        [],
      )
      assert.doesNotMatch(markup, /\.ico/)
      assert.doesNotMatch(markup, /null/)
    }
  })
}

test("NNW01-P the feed icon implementation does not reject a provider icon for its aspect ratio", () => {
  const source = readSource("src/components/ui/FeedIcon.jsx")

  assert.doesNotMatch(source, /naturalWidth\s*!==\s*naturalHeight/)
  assert.doesNotMatch(source, /naturalWidth\s*===\s*0/)
})

test("NNW01-P the feed icon implementation no longer derives a host for any lookup", () => {
  const source = readSource("src/components/ui/FeedIcon.jsx")

  assert.doesNotMatch(source, /getSecondHostname/)
  assert.doesNotMatch(source, /hostname/i)
})

const THIRD_PARTY_FAVICON_PROVIDERS = [
  /duckduckgo/i,
  /google\.com\/s2\/favicons/i,
  /gstatic\.com\/faviconV2/i,
  /clearbit\.com/i,
  /icon\.horse/i,
  /faviconkit/i,
  /favicon\.im/i,
  /favicon\.yandex/i,
  /besticon/i,
  /\/ip3\//,
]

const RUNTIME_TEXT_FILE = /\.(?:jsx?|mjs|css|html|json|webmanifest)$/
const NON_RUNTIME_FILE = /\.test\.js$/

const collectRuntimeFiles = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry)
    if (statSync(entryPath).isDirectory()) {
      return collectRuntimeFiles(entryPath)
    }
    return RUNTIME_TEXT_FILE.test(entry) && !NON_RUNTIME_FILE.test(entry) ? [entryPath] : []
  })

test("NNW01-P no runtime source references a third-party favicon provider", () => {
  const runtimeFiles = [
    ...collectRuntimeFiles(path.resolve(root, "src")),
    path.resolve(root, "index.html"),
    path.resolve(root, "vite.config.js"),
    ...collectRuntimeFiles(path.resolve(root, "public")),
  ]
  const offenders = runtimeFiles.flatMap((file) => {
    const content = readFileSync(file, "utf8")
    return THIRD_PARTY_FAVICON_PROVIDERS.filter((pattern) => pattern.test(content)).map(
      (pattern) => `${path.relative(root, file)} matches ${pattern}`,
    )
  })

  assert.deepEqual(offenders, [])
})
