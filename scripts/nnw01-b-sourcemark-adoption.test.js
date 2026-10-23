import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createServer as createHttpServer } from "node:http"
import path from "node:path"
import test, { after } from "node:test"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import Polyglot from "node-polyglot"
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
  resolve: {
    alias: [
      { find: /^@\/apis$/, replacement: path.resolve(root, "scripts/tests/nnw01-b-api-mock.js") },
      { find: "@", replacement: path.resolve(root, "src") },
    ],
  },
  root,
  ssr: { noExternal: ["@arco-design/web-react"] },
  cacheDir: "/private/tmp/newsflux-nnw01-b-vite-cache",
  server: { middlewareMode: true, ws: { server: hmrServer } },
})

const [
  { default: ArticleEntry },
  { default: ArticleListItem },
  { default: ArticleCard },
  { default: ArticleGridCard },
  settings,
  data,
  content,
  icons,
  language,
  appContext,
] = await Promise.all([
  vite.ssrLoadModule("/src/components/Article/ArticleEntry.jsx"),
  vite.ssrLoadModule("/src/components/Article/ArticleListItem.jsx"),
  vite.ssrLoadModule("/src/components/Article/ArticleCard.jsx"),
  vite.ssrLoadModule("/src/components/Article/ArticleGridCard.jsx"),
  vite.ssrLoadModule("/src/store/settingsState.js"),
  vite.ssrLoadModule("/src/store/dataState.js"),
  vite.ssrLoadModule("/src/store/contentState.js"),
  vite.ssrLoadModule("/src/store/feedIconsState.js"),
  vite.ssrLoadModule("/src/hooks/useLanguage.js"),
  vite.ssrLoadModule("/src/contexts/app-data-context.js"),
])
const stores = {
  ...settings,
  ...data,
  ...content,
  ...icons,
  ...language,
  AppDataContext: appContext.default,
}
const { default: locales } = await vite.ssrLoadModule("/src/locales/en-US.json")

after(async () => {
  await vite.close()
  hmrServer.close()
})

const {
  getDefaultSettings,
  settingsState,
  dataState,
  contentState,
  feedIconsState,
  polyglotState,
  AppDataContext,
} = stores

const currentFeed = {
  id: 42,
  title: "Current catalog source",
  category: { id: 1, title: "Fixture" },
  icon: { icon_id: 421 },
  site_url: "https://current.example.test",
  feed_url: "https://current.example.test/rss",
}
const embeddedFeed = {
  id: 42,
  title: "Stale embedded source",
  category: { id: 1, title: "Fixture" },
  icon: { icon_id: 422 },
  site_url: "https://stale.example.test",
  feed_url: "https://stale.example.test/rss",
}
const entry = {
  id: 901,
  title: "Fixture article",
  content: "Fixture content",
  feed: embeddedFeed,
  status: "read",
  starred: false,
  reading_time: 1,
  published_at: "2026-10-23T12:00:00Z",
  url: "https://article.example.test/901",
}

const setup = (showFeedIcon = true) => {
  settingsState.set({
    ...getDefaultSettings(),
    showFeedIcon,
    markReadOnScroll: false,
    enableContextMenu: false,
    coverDisplayMode: "none",
    showCardSummary: false,
    showListSummary: false,
  })
  polyglotState.setKey("polyglot", new Polyglot({ phrases: locales, locale: "en-US" }))
  dataState.set({ ...dataState.get(), feedsData: [currentFeed] })
  contentState.set({
    ...contentState.get(),
    activeContent: null,
    entries: [entry],
    infoFrom: "all",
  })
  feedIconsState.set({
    0: { url: null, width: null, height: null },
    421: { url: "data:image/png;base64,current", width: 24, height: 24 },
    422: { url: "data:image/png;base64,stale", width: 24, height: 24 },
  })
}

const activation = {
  getPrimaryLinkProps: () => ({ href: "/feed/42/entry/901", "aria-describedby": "existing-hint" }),
  openInReactFlux: () => {},
  opensSourceOnCardClick: false,
}
const noop = () => {}
const noopCleanup = () => {}
const observeRead = () => noopCleanup

const renderEntry = (
  presenter,
  { showFeedIcon = true, selectionMode = false, entryOverride = entry } = {},
) => {
  setup(showFeedIcon)
  return renderToStaticMarkup(
    React.createElement(
      AppDataContext.Provider,
      { value: { refreshCounts: async () => ({}) } },
      React.createElement(ArticleEntry, {
        articleActivation: activation,
        entry: entryOverride,
        layout:
          presenter === ArticleListItem ? "list" : presenter === ArticleCard ? "column" : "card",
        observeRead,
        onSelectionCheckboxFocus: noop,
        onToggleSelection: noop,
        presenter,
        selectionMode,
      }),
    ),
  )
}

const getSourceDescription = (markup, className) => {
  const link = markup.match(/<a\b[^>]*class="[^"]*article-entry[^"]*"[^>]*>/)?.[0]
  const describedBy = link?.match(/aria-describedby="([^"]+)"/)?.[1]
  const sourceId = markup.match(new RegExp(`class="${className}" id="([^"]+)"`))?.[1]
  return { describedBy, link, sourceId }
}

test("Sidebar source rows replace FeedIcon with SourceMark under the existing preference", async () => {
  const source = await readFile(path.resolve(root, "src/components/Sidebar/Sidebar.jsx"), "utf8")
  assert.match(source, /import FeedSourceMark from "@\/components\/ui\/FeedSourceMark"/)
  assert.match(source, /showFeedIcon\s*&&\s*\(\s*<FeedSourceMark[^>]*size=\{16\}/s)
  assert.doesNotMatch(source, /import FeedIcon from "@\/components\/ui\/FeedIcon"/)
})

test("all three article presenters render the current catalog SourceMark at 20px", () => {
  for (const presenter of [ArticleListItem, ArticleCard, ArticleGridCard]) {
    const markup = renderEntry(presenter)
    assert.match(markup, /data-source-mark-fallback="provider"/)
    assert.match(markup, /--source-mark-size:20px/)
    assert.match(markup, /data:image\/png;base64,current/)
    assert.match(markup, />Current catalog source</)
    assert.doesNotMatch(markup, /Stale embedded source|data:image\/png;base64,stale/)
  }
})

test("article link preserves its name and describes the visible source", () => {
  const markup = renderEntry(ArticleListItem)
  const { describedBy, link, sourceId } = getSourceDescription(markup, "list-entry-source-title")
  assert.match(link ?? "", /aria-label="Fixture article"/)
  assert.ok(sourceId, "visible source title must have an instance id")
  assert.ok(describedBy?.split(" ").includes("existing-hint"))
  assert.ok(describedBy?.split(" ").includes(sourceId))
  assert.match(markup, new RegExp(`id="${sourceId}"[^>]*>Current catalog source</`))
})

test("source description remains when icons are disabled and selection mode stays independent", () => {
  const markup = renderEntry(ArticleGridCard, { showFeedIcon: false, selectionMode: true })
  const { describedBy, link, sourceId } = getSourceDescription(markup, "grid-card-source-title")
  assert.doesNotMatch(markup, /class="source-mark(?:\s|")/)
  assert.match(markup, />Current catalog source</)
  assert.ok(sourceId && describedBy?.split(" ").includes(sourceId))
  assert.match(link ?? "", /aria-label="Fixture article"/)
  assert.match(markup, /aria-label="Select Fixture article"[^>]*type="checkbox"/)
  assert.doesNotMatch(
    markup.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0] ?? "",
    /aria-describedby/,
  )
})

test("each simultaneously rendered article has a collision-safe source-description id", () => {
  setup()
  const markup = renderToStaticMarkup(
    React.createElement(
      AppDataContext.Provider,
      { value: { refreshCounts: async () => ({}) } },
      React.createElement(
        React.Fragment,
        null,
        [entry, { ...entry, id: 902 }].map((item) =>
          React.createElement(ArticleEntry, {
            key: item.id,
            articleActivation: activation,
            entry: item,
            layout: "list",
            observeRead,
            presenter: ArticleListItem,
          }),
        ),
      ),
    ),
  )
  const ids = [...markup.matchAll(/class="list-entry-source-title" id="([^"]+)"/g)].map(
    ([, id]) => id,
  )
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
})

test("the embedded entry feed remains a usable fallback when the catalog has no match", () => {
  const fallbackEntry = { ...entry, feed: { ...embeddedFeed, id: 777 } }
  const markup = renderEntry(ArticleListItem, { entryOverride: fallbackEntry })
  assert.match(markup, />Stale embedded source</)
})
