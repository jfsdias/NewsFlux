/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider, useLocation } from "react-router"

import apiClient from "@/apis/ofetch"
import ArticleDetail from "@/components/Article/ArticleDetail"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { commitCatalogData, commitIdentityData, resetData } from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/App.css"
import "@/theme.css"
import "@/components/Content/Content.css"
import "./nnw01-c-reader-settings.css"

const category = { id: 31, title: "Source Identity fixtures", hide_globally: false }
const dataImage = (width, height, color) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`)}`

const squareDarkIcon = dataImage(64, 64, "#111111")
const squareLightIcon = dataImage(64, 64, "#ffffff")
const nonSquareIcon = dataImage(64, 24, "#5478b8")
const tinyIcon = dataImage(1, 1, "#111111")
const crossOriginIcon = "http://127.0.0.1:4174/provider-wide.svg"

const feeds = {
  catalog: {
    id: 41,
    title: "The Verge",
    category,
    icon: { icon_id: 410 },
    site_url: "https://theverge.com/",
    feed_url: "https://theverge.com/rss/index.xml",
  },
  duplicateHost: {
    id: 42,
    title: " example.com ",
    category,
    icon: { icon_id: 410 },
    site_url: "https://EXAMPLE.com/feed",
    feed_url: "https://rss.example.net/feed",
  },
  malformedHost: {
    id: 43,
    title: "Malformed Host Source",
    category,
    icon: { icon_id: 410 },
    site_url: "not a valid URL",
    feed_url: "ftp://example.test/feed",
  },
  longIdentity: {
    id: 50,
    title:
      "A deliberately long source name that should wrap without colliding with the article title",
    category,
    icon: { icon_id: 410 },
    site_url: "https://a-very-long-source-hostname-for-responsive-reader-layout.example.test/feed",
    feed_url: "https://a-very-long-source-hostname-for-responsive-reader-layout.example.test/rss",
  },
  square: {
    id: 44,
    title: "Square Provider",
    category,
    icon: { icon_id: 410 },
    site_url: "https://square.example.test/",
    feed_url: "https://square.example.test/rss",
  },
  nonSquare: {
    id: 45,
    title: "Wide Provider",
    category,
    icon: { icon_id: 411 },
    site_url: "https://wide.example.test/",
    feed_url: "https://wide.example.test/rss",
  },
  tiny: {
    id: 46,
    title: "Tiny Provider",
    category,
    icon: { icon_id: 412 },
    site_url: "https://tiny.example.test/",
    feed_url: "https://tiny.example.test/rss",
  },
  noMetadata: {
    id: 777,
    title: "No Provider Icon",
    category,
    icon: {},
    site_url: "https://no-icon.example.test/",
    feed_url: "https://no-icon.example.test/rss",
  },
  rss: {
    id: 47,
    title: "📰",
    category,
    icon: { icon_id: 0 },
    site_url: "https://192.0.2.47/",
    feed_url: "https://192.0.2.47/rss",
  },
  crossOrigin: {
    id: 48,
    title: "Cross-Origin Provider",
    category,
    icon: { icon_id: 422 },
    site_url: "https://cross.example.test/",
    feed_url: "https://cross.example.test/rss",
  },
  emptyIdentity: {
    id: 49,
    title: " ".repeat(3),
    category,
    icon: { icon_id: 0 },
    site_url: "invalid",
    feed_url: "file:///feed",
  },
}

const apiRequests = []
for (const method of ["get", "post", "put", "raw", "delete"]) {
  apiClient[method] = async (...args) => {
    apiRequests.push({ method, args })
    throw new Error(`Unexpected API request during NNW01-C harness: ${method}`)
  }
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "http://127.0.0.1:4174", token: "fixture", username: "fixture" })
settingsState.set({ ...getDefaultSettings(), showFeedIcon: true, markReadOnScroll: false })
resetData()
contentState.set({ ...contentState.get(), activeContent: null, entries: [], infoFrom: "feed" })
commitIdentityData({ id: 1, username: "fixture" })
commitCatalogData({ feedsData: Object.values(feeds), categoriesData: [category] })
feedIconsState.set({
  0: { url: null, width: null, height: null },
  410: { url: squareDarkIcon, width: 64, height: 64 },
  411: { url: nonSquareIcon, width: 64, height: 24 },
  412: { url: tinyIcon, width: 1, height: 1 },
  422: { url: crossOriginIcon, width: 64, height: 24 },
})

const makeEntry = (feed, { embeddedCurrent = false } = {}) => ({
  id: 901,
  title: "Source Identity reader fixture",
  content: "<p>Reader body remains mounted and scrollable.</p>",
  feed: embeddedCurrent
    ? feed
    : {
        ...feed,
        title: `Stale embedded ${feed.title}`,
        icon: { icon_id: 9999 },
        site_url: "https://stale-embedded.example.test/",
      },
  status: "read",
  starred: false,
  author: "Fixture author",
  published_at: "2026-10-23T12:00:00Z",
  reading_time: 1,
  url: "",
  comments_url: "",
  attachments: [],
  coverSource: null,
})

const selectCase = (name, { catalogAvailable = true, embeddedCurrent = false } = {}) => {
  const feed = feeds[name]
  const entry = makeEntry(feed, { embeddedCurrent })
  const currentFeeds = catalogAvailable
    ? [feed, ...Object.values(feeds).filter(({ id }) => id !== feed.id)]
    : Object.values(feeds).filter(({ id }) => id !== feed.id)
  commitCatalogData({ feedsData: currentFeeds, categoriesData: [category] })
  contentState.set({
    ...contentState.get(),
    activeContent: entry,
    entries: [entry],
    infoFrom: "feed",
    infoId: feed.id,
    isArticleListReady: true,
    isArticleLoading: false,
  })
}

const setShowFeedIcon = (value) =>
  settingsState.set({ ...settingsState.get(), showFeedIcon: Boolean(value) })

const setTheme = (theme) => {
  document.body.setAttribute("arco-theme", theme)
  document.documentElement.dataset.theme = theme
}

const waitFor = async (predicate, timeoutMs = 5000) => {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return predicate()
}

const getSourceLink = () => document.querySelector(".article-source-link[href]")
const getSourceMark = () => document.querySelector(".article-source-link .source-mark")

const runGates = async () => {
  const results = []
  const gate = (name, pass, detail = "") =>
    results.push({ name, result: pass ? "PASS" : "FAIL", detail })

  selectCase("catalog")
  setShowFeedIcon(true)
  const catalogMounted = await waitFor(() => getSourceLink()?.textContent.includes("The Verge"))
  const catalogLink = getSourceLink()
  gate(
    "READER_STORE_FIRST_FEED_RESOLUTION",
    catalogMounted &&
      catalogLink?.textContent.includes("The Verge") &&
      !catalogLink?.textContent.includes("Stale embedded") &&
      getSourceMark()?.querySelector("img")?.getAttribute("src") === squareDarkIcon,
  )
  gate("READER_SOURCE_TARGET", catalogLink?.getAttribute("href") === "/feed/41")
  gate(
    "READER_ADDITIVE_HOST",
    catalogLink?.querySelector(".article-source-host")?.textContent === "theverge.com",
  )
  const sourceRect = catalogLink?.getBoundingClientRect()
  gate("READER_TOUCH_TARGET_44PX", Boolean(sourceRect && sourceRect.height >= 44))
  const titleRect = document.querySelector(".article-title")?.getBoundingClientRect()
  const actionRect = document.querySelector(".action-buttons")?.getBoundingClientRect()
  const article = document.querySelector(".article-content")
  gate(
    "VISUAL_READER_SOURCE_LAYOUT",
    Boolean(
      sourceRect &&
      titleRect &&
      actionRect &&
      sourceRect.bottom <= titleRect.top &&
      actionRect.bottom <= sourceRect.top &&
      document.querySelectorAll(".article-content").length === 1 &&
      article?.scrollWidth <= article?.clientWidth &&
      document.documentElement.scrollWidth <= window.innerWidth,
    ),
  )
  gate(
    "READER_ACCESSIBLE_DECORATIVE_SOURCE",
    catalogLink?.tagName === "A" &&
      catalogLink?.textContent.includes("The Verge") &&
      getSourceMark()?.getAttribute("aria-hidden") === "true" &&
      !catalogLink?.querySelector("a,button,[tabindex]") &&
      !catalogLink?.hasAttribute("aria-label"),
  )

  setShowFeedIcon(false)
  await waitFor(() => !getSourceMark())
  const iconOffLink = getSourceLink()
  const iconOffRect = iconOffLink?.getBoundingClientRect()
  gate(
    "SHOW_FEED_ICON_READER_OFF",
    !getSourceMark() &&
      iconOffLink?.textContent.includes("The Verge") &&
      iconOffLink?.getAttribute("href") === "/feed/41" &&
      Boolean(iconOffRect && iconOffRect.height >= 44),
  )
  setShowFeedIcon(true)
  await waitFor(() => Boolean(getSourceMark()))
  gate("SHOW_FEED_ICON_READER_ON", Boolean(getSourceMark()))

  selectCase("duplicateHost")
  await waitFor(() => getSourceLink()?.textContent.includes("example.com"))
  gate(
    "DUPLICATE_HOST_SUPPRESSED",
    getSourceLink()?.querySelectorAll(".article-source-host").length === 0 &&
      getSourceLink()?.textContent.trim() === "example.com",
  )

  selectCase("longIdentity")
  await waitFor(() => getSourceLink()?.textContent.includes("A deliberately long source name"))
  const longLink = getSourceLink()
  const longName = longLink?.querySelector(".article-source-name")?.getBoundingClientRect()
  const longHost = longLink?.querySelector(".article-source-host")?.getBoundingClientRect()
  const longHeader = document.querySelector(".article-header")?.getBoundingClientRect()
  const longTitle = document.querySelector(".article-title")?.getBoundingClientRect()
  const longSource = longLink?.getBoundingClientRect()
  gate(
    "LONG_SOURCE_IDENTITY_WRAP_SAFE",
    Boolean(
      longLink &&
      longName &&
      longHost &&
      longHeader &&
      longTitle &&
      longSource &&
      longLink.textContent.includes("a-very-long-source-hostname") &&
      longSource.right <= longHeader.right + 1 &&
      longSource.bottom <= longTitle.top &&
      longName.bottom <= longHost.top + 1 &&
      document.documentElement.scrollWidth <= window.innerWidth,
    ),
  )

  selectCase("malformedHost")
  await waitFor(() => getSourceLink()?.textContent.includes("Malformed Host Source"))
  gate(
    "MALFORMED_HOST_SUPPRESSED",
    getSourceLink()?.querySelectorAll(".article-source-host").length === 0,
  )

  selectCase("catalog", { catalogAvailable: false, embeddedCurrent: true })
  await waitFor(() => getSourceLink()?.textContent.includes("The Verge"))
  gate(
    "READER_ENTRY_FEED_FALLBACK",
    getSourceLink()?.textContent.includes("The Verge") &&
      !getSourceLink()?.textContent.includes("Stale embedded"),
  )

  selectCase("square")
  await waitFor(() => getSourceMark()?.querySelector("img")?.naturalWidth === 64)
  gate(
    "PROVIDER_SQUARE_GATE",
    getSourceMark()?.dataset.sourceMarkFallback === "provider" &&
      getSourceMark()?.querySelector("img")?.naturalWidth === 64 &&
      getSourceMark()?.style.getPropertyValue("--source-mark-size") === "24px",
  )

  selectCase("nonSquare")
  await waitFor(
    () =>
      getSourceMark()?.querySelector("img")?.naturalWidth === 64 &&
      getSourceMark()?.querySelector("img")?.naturalHeight === 24,
  )
  gate(
    "PROVIDER_NON_SQUARE_GATE",
    getSourceMark()?.dataset.sourceMarkFallback === "provider" &&
      getSourceMark()?.querySelector("img")?.naturalWidth === 64 &&
      getSourceMark()?.querySelector("img")?.naturalHeight === 24,
  )

  selectCase("tiny")
  await waitFor(() => getSourceMark()?.dataset.sourceMarkFallback === "monogram")
  gate("TINY_PROVIDER_MONOGRAM_GATE", getSourceMark()?.dataset.sourceMarkFallback === "monogram")

  selectCase("noMetadata")
  await waitFor(() => getSourceMark()?.dataset.sourceMarkFallback === "monogram")
  gate(
    "NO_ICON_METADATA_MONOGRAM_GATE",
    getSourceMark()?.dataset.sourceMarkFallback === "monogram" &&
      !apiRequests.some(({ method, args }) => method === "get" && args[0] === "/v1/icons/777"),
  )

  selectCase("rss")
  await waitFor(() => getSourceMark()?.dataset.sourceMarkFallback === "rss")
  gate("RSS_TERMINAL_GATE", getSourceMark()?.dataset.sourceMarkFallback === "rss")

  selectCase("crossOrigin")
  const crossOriginLoaded = await waitFor(
    () => getSourceMark()?.querySelector("img")?.naturalWidth === 64,
    8000,
  )
  gate(
    "CROSS_ORIGIN_NEUTRAL_GATE",
    crossOriginLoaded &&
      getSourceMark()?.dataset.sourceMarkFallback === "provider" &&
      getSourceMark()?.dataset.sourceMarkPlate === "neutral",
  )

  selectCase("catalog")
  const blackReady = await waitFor(() => getSourceMark()?.dataset.sourceMarkPlate === "light")
  gate("DARK_PROVIDER_ICON_LIGHT_PLATE", blackReady)
  feedIconsState.setKey(410, { url: squareLightIcon, width: 64, height: 64 })
  const lightReady = await waitFor(() => getSourceMark()?.dataset.sourceMarkPlate === "dark")
  gate("LIGHT_PROVIDER_ICON_DARK_PLATE", lightReady)

  const empty = feeds.emptyIdentity
  selectCase("emptyIdentity")
  await waitFor(() => contentState.get().activeContent?.feed?.id === empty.id)
  gate(
    "EMPTY_IDENTITY_HAS_NO_EMPTY_INTERACTIVE_TARGET",
    !document.querySelector(".article-source-link") && !document.querySelector(".article-source a"),
  )

  feedIconsState.setKey(410, { url: squareDarkIcon, width: 64, height: 64 })
  selectCase("catalog")
  await waitFor(
    () =>
      getSourceLink()?.textContent.includes("The Verge") &&
      getSourceMark()?.dataset.sourceMarkPlate === "light",
  )

  const bodyScrollWidth = document.documentElement.scrollWidth
  gate("NO_HARNESS_HORIZONTAL_OVERFLOW", bodyScrollWidth <= window.innerWidth)

  const report = {
    theme: document.body.getAttribute("arco-theme"),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    gates: results,
    apiRequests: apiRequests.length,
    wrongFeedIdIconRequests: apiRequests.filter(
      ({ method, args }) => method === "get" && args[0] === "/v1/icons/777",
    ).length,
    providerImageRequests: performance
      .getEntriesByType("resource")
      .filter(({ name }) => name.includes("provider-wide.svg")).length,
    thirdPartyFaviconRequests: performance
      .getEntriesByType("resource")
      .filter(({ name }) => /duckduckgo|google\.com\/s2\/favicons/i.test(name)).length,
  }
  document.querySelector("[data-testid='nnw01-c-results']").textContent = JSON.stringify(
    report,
    null,
    2,
  )
  globalThis.__nnw01cReport = report
  return report
}

const appData = {
  refreshCounts: async () => ({ error: null }),
  refreshFeedData: async () => {},
}
const desktopSidebar = {
  isDesktopSidebarCollapsed: false,
  collapseButtonRef: { current: null },
  detailCloseButtonRef: { current: null },
  reopenButtonRef: { current: null },
  collapseDesktopSidebar: () => {},
  expandDesktopSidebar: () => {},
}
const readerCommands = {
  canNavigateNext: false,
  canNavigatePrevious: false,
  exitDetailView: () => {},
  isResolving: false,
  navigateToNextArticle: () => {},
  navigateToPreviousArticle: () => {},
}

const LocationProbe = () => {
  const location = useLocation()
  return <output data-testid="nnw01-c-route">{location.pathname}</output>
}

function FixtureFrame() {
  const [iconVisible, setIconVisible] = useState(true)
  const [feedCase, setFeedCase] = useState("catalog")

  const handleFeedCaseChange = (event) => {
    const name = event.target.value
    setFeedCase(name)
    selectCase(name, name === "fallback" ? { catalogAvailable: false, embeddedCurrent: true } : {})
  }

  const handleIconChange = (event) => {
    const value = event.target.checked
    setIconVisible(value)
    setShowFeedIcon(value)
  }

  return (
    <main className="nnw01-c-layout">
      <div className="nnw01-c-controls">
        <label>
          Feed case{" "}
          <select
            data-testid="nnw01-c-feed-select"
            value={feedCase}
            onChange={handleFeedCaseChange}
          >
            {Object.keys(feeds).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="fallback">embedded feed fallback</option>
          </select>
        </label>
        <label>
          <input
            checked={iconVisible}
            data-testid="nnw01-c-icon-toggle"
            type="checkbox"
            onChange={handleIconChange}
          />
          Show feed icon
        </label>
        <Button data-testid="nnw01-c-run" size="mini" onClick={() => void runGates()}>
          Run Reader gates
        </Button>
        <pre className="nnw01-c-report" data-testid="nnw01-c-results">
          Starting
        </pre>
        <LocationProbe />
      </div>
      <section aria-label="Reader fixture" className="nnw01-c-reader">
        <ArticleDetail />
      </section>
    </main>
  )
}

selectCase("catalog")
const router = createMemoryRouter([{ path: "*", element: <FixtureFrame /> }], {
  initialEntries: ["/feed/41/entry/901"],
})

globalThis.__nnw01c = { runGates, selectCase, setShowFeedIcon, setTheme }
setTheme(new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light")

createRoot(document.querySelector("#root")).render(
  <AppDataContext.Provider value={appData}>
    <DesktopSidebarContext.Provider value={desktopSidebar}>
      <ReaderCommandsContext.Provider value={readerCommands}>
        <ConfigProvider locale={enUS}>
          <RouterProvider router={router} />
        </ConfigProvider>
      </ReaderCommandsContext.Provider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>,
)
