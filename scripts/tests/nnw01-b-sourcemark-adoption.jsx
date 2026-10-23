/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider, useLocation } from "react-router"

import apiClient from "@/apis/ofetch"
import ArticleCard from "@/components/Article/ArticleCard"
import ArticleEntry from "@/components/Article/ArticleEntry"
import ArticleGridCard from "@/components/Article/ArticleGridCard"
import ArticleListItem from "@/components/Article/ArticleListItem"
import SidebarTrigger, { SidebarDrawerHost } from "@/components/Article/SidebarTrigger"
import HomeHighlightCard from "@/components/Home/HomeHighlightCard"
import HomeRecent from "@/components/Home/HomeRecent"
import CompactNavigation from "@/components/Navigation/CompactNavigation"
import Sidebar from "@/components/Sidebar/Sidebar"
import FeedSourceMark from "@/components/ui/FeedSourceMark"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { commitCatalogData, commitIdentityData, resetData, setUnreadInfo } from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { setExpandedCategories } from "@/store/sidebarState"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/App.css"
import "@/theme.css"
import "@/components/Article/SidebarTrigger.css"
import "@/components/Navigation/CompactNavigation.css"
import "./nnw01-b-sourcemark-adoption.css"

const category = { id: 71, title: "SourceMark fixtures", hide_globally: false }
const makeFeed = (id, title, iconId, options = {}) => ({
  id,
  title,
  category,
  icon: { icon_id: iconId },
  site_url: `https://catalog-${id}.example.test/`,
  feed_url: `https://catalog-${id}.example.test/rss`,
  hide_globally: false,
  disabled: false,
  parsing_error_count: 0,
  ...options,
})

const feeds = [
  makeFeed(71, "Catalog square source", 421, { parsing_error_count: 1 }),
  makeFeed(72, "Catalog cross-origin source", 422),
  makeFeed(73, "Catalog tiny source", 423),
  makeFeed(74, "Música local", 0),
  makeFeed(75, "📰", 0, {
    site_url: "https://192.0.2.8/",
    feed_url: "https://192.0.2.8/rss",
  }),
  makeFeed(76, "Catalog white source", 424),
]
const noIconMetadataFeed = {
  ...makeFeed(777, "No Provider Icon", 0),
  icon: {},
}

const makeEntry = (id, feed, options = {}) => ({
  id,
  title: `Article ${id}`,
  content: `Preview text for article ${id}`,
  feed: {
    ...feed,
    title: `Stale entry ${feed.title}`,
    icon: { icon_id: 9999 },
  },
  status: "read",
  starred: false,
  reading_time: 2,
  published_at: "2026-10-23T12:00:00Z",
  url: `https://article.example.test/${id}`,
  ...options,
})

const entries = feeds.map((feed, index) => makeEntry(900 + index, feed))
const noop = () => {}
const noopCleanup = () => {}
const observeRead = () => noopCleanup
const imageData = (color) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`

const apiRequests = []
for (const method of ["get", "post", "put", "raw", "delete"]) {
  apiClient[method] = async (...args) => {
    apiRequests.push({ method, args })
    throw new Error(`Unexpected API request during SourceMark harness: ${method}`)
  }
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "http://127.0.0.1:4174", token: "fixture", username: "fixture" })
settingsState.set({ ...getDefaultSettings(), showFeedIcon: true, showUnreadFeedsOnly: false })
resetData()
contentState.set({ ...contentState.get(), activeContent: null, entries, infoFrom: "all" })
setExpandedCategories(["/category/71"])
commitIdentityData({ id: 1, username: "fixture" })
commitCatalogData({ feedsData: feeds, categoriesData: [category] })
setUnreadInfo({ 71: 5, 72: 0, 73: 0, 74: 0, 75: 0, 76: 0 })
feedIconsState.set({
  0: { url: null, width: null, height: null },
  421: { url: imageData("#111111"), width: 64, height: 64 },
  422: { url: "http://127.0.0.1:4174/provider-wide.svg", width: 64, height: 24 },
  423: { url: "http://127.0.0.1:4174/provider-tiny.svg", width: 1, height: 1 },
  424: { url: imageData("#ffffff"), width: 64, height: 64 },
})

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

const activation = {
  getPrimaryLinkProps: (entry) => ({
    href: `/feed/${entry.feed.id}/entry/${entry.id}`,
    "aria-describedby": "fixture-article-hint",
  }),
  openInReactFlux: () => {},
  opensSourceOnCardClick: false,
}

const wait = (duration = 120) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await wait()
  }
  throw new Error(message)
}
const sidebarRoot = () =>
  [
    ...document.querySelectorAll(
      ".sidebar-drawer .sidebar-container, .nnw01-b-sidebar .sidebar-container",
    ),
  ].find(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
  )
const feedRow = (id) =>
  sidebarRoot()?.querySelector(`[data-feed-edit-id='${CSS.escape(String(id))}']`)
const ensureSidebarOpen = async () => {
  if (innerWidth > 992) {
    await waitFor(() => sidebarRoot(), "Desktop Sidebar did not render")
    return
  }
  const trigger =
    document.querySelector("[data-testid='compact-nav-sources']") ??
    document.querySelector(".trigger")
  if (trigger?.getAttribute("aria-expanded") !== "true") {
    trigger?.click()
  }
  await waitFor(
    () => document.querySelector(".sidebar-drawer .sidebar-container"),
    "Sidebar drawer did not open",
  )
  await waitFor(() => feedRow(71), "Source feed rows did not render")
}

const gate = (results, name, check) => {
  try {
    check()
    results.push({ name, status: "PASS" })
  } catch (error) {
    results.push({ name, status: "FAIL", detail: error.message })
  }
}

const runScenarios = async () => {
  const results = []
  await ensureSidebarOpen()

  settingsState.set({ ...settingsState.get(), showFeedIcon: true })
  await wait()
  const selectedRow = feedRow(71)
  gate(results, "SIDEBAR_SOURCE_MARK_ON_16PX", () => {
    const mark = selectedRow?.querySelector(".source-mark")
    if (!mark) {
      throw new Error("Sidebar SourceMark missing when showFeedIcon is on")
    }
    if (Math.round(mark.getBoundingClientRect().width) !== 16) {
      throw new Error(`Sidebar mark width is ${mark.getBoundingClientRect().width}px`)
    }
  })
  gate(results, "SIDEBAR_EXISTING_ROW_STATE_PRESERVED", () => {
    if (selectedRow?.getAttribute("aria-current") !== "page") {
      throw new Error("Selected feed state changed")
    }
    if (!selectedRow?.querySelector(".item-count")) {
      throw new Error("Unread count is missing")
    }
    if (!selectedRow?.querySelector(".feed-health-indicator")) {
      throw new Error("Provider health indicator is missing")
    }
  })
  gate(results, "SIDEBAR_COUNT_AND_HEALTH_INDICATOR_NO_COLLISION", () => {
    const row = feedRow(71)
    const content = row?.querySelector(".custom-menu-item")
    const title = content?.firstElementChild
    const count = content?.querySelector(".item-count")
    const mark = row?.querySelector(".source-mark")
    const health = row?.querySelector(".feed-health-indicator")
    const titleRect = title?.getBoundingClientRect()
    const countRect = count?.getBoundingClientRect()
    const markRect = mark?.getBoundingClientRect()
    const healthRect = health?.getBoundingClientRect()

    if (titleRect && countRect && titleRect.right > countRect.left + 1) {
      throw new Error("Feed title and unread count overlap")
    }
    if (markRect && healthRect && markRect.right > healthRect.left + 1) {
      throw new Error("SourceMark and health indicator overlap")
    }
  })
  gate(results, "NO_ICON_METADATA_LOCAL_FALLBACK", () => {
    const mark = document.querySelector("[data-testid='no-icon-metadata-mark'] .source-mark")
    const incorrectIconRequests = apiRequests.filter(
      ({ method, args }) => method === "get" && args[0] === "/v1/icons/777",
    )
    if (incorrectIconRequests.length > 0) {
      throw new Error(
        `Feed ID 777 was requested as an icon ID ${incorrectIconRequests.length} time(s)`,
      )
    }
    if (mark?.dataset.sourceMarkFallback !== "monogram") {
      throw new Error(`Expected local monogram fallback, got ${mark?.dataset.sourceMarkFallback}`)
    }
    if (!mark?.textContent.includes("N")) {
      throw new Error("The no-icon feed's local monogram is not visible")
    }
  })

  settingsState.set({ ...settingsState.get(), showFeedIcon: false })
  await wait()
  gate(results, "SIDEBAR_SOURCE_MARK_OFF", () => {
    if (feedRow(71)?.querySelector(".source-mark")) {
      throw new Error("Sidebar SourceMark remains when showFeedIcon is off")
    }
    if (!feedRow(71)?.textContent.includes("Catalog square source")) {
      throw new Error("Feed title disappeared when its icon was hidden")
    }
  })
  settingsState.set({ ...settingsState.get(), showFeedIcon: true })
  await wait()

  if (innerWidth <= 992) {
    const drawerTrigger =
      document.querySelector("[data-testid='compact-nav-sources']") ??
      document.querySelector(".trigger")
    drawerTrigger?.click()
  }
  await wait()

  const listMark = document.querySelector(".list-entry-feed-icon.source-mark")
  const columnMark = document.querySelector(".feed-icon-mini.source-mark")
  const gridMark = document.querySelector(".grid-card-feed-icon.source-mark")
  gate(results, "ARTICLE_LIST_SOURCE_MARK_20PX", () => {
    if (!listMark || Math.round(listMark.getBoundingClientRect().width) !== 20) {
      throw new Error("Article list mark is missing or not 20px")
    }
  })
  gate(results, "ARTICLE_COLUMN_SOURCE_MARK_20PX", () => {
    if (!columnMark || Math.round(columnMark.getBoundingClientRect().width) !== 20) {
      throw new Error("Article column mark is missing or not 20px")
    }
  })
  gate(results, "ARTICLE_GRID_SOURCE_MARK_20PX", () => {
    if (!gridMark || Math.round(gridMark.getBoundingClientRect().width) !== 20) {
      throw new Error("Article grid mark is missing or not 20px")
    }
  })
  gate(results, "STORE_FEED_METADATA_WINS", () => {
    const sourceTitle = document.querySelector(".list-entry-source-title")
    if (sourceTitle?.textContent !== "Catalog square source") {
      throw new Error(`Unexpected source title: ${sourceTitle?.textContent}`)
    }
    if (!listMark?.querySelector('img[src^="data:image/svg+xml"]')) {
      throw new Error("Current catalog icon metadata was not used")
    }
  })
  gate(results, "A11Y_SOURCE_DESCRIPTION_AND_NAME", () => {
    const article = document.querySelector(".list-entry-wrapper.article-entry")
    const source = article?.querySelector(".list-entry-source-title")
    const describedBy = article?.getAttribute("aria-describedby")?.split(/\s+/) ?? []
    if (!source?.id || !describedBy.includes(source.id)) {
      throw new Error("Article link does not describe its visible source")
    }
    if (!article?.getAttribute("aria-label")?.includes("Article 900")) {
      throw new Error("Article accessible name changed")
    }
  })
  gate(results, "HOME_HIGHLIGHT_SHARED_PRESENTER", () => {
    const highlight = document.querySelector(".home-highlight-card")
    if (!highlight?.querySelector(".grid-card-feed-icon.source-mark")) {
      throw new Error("Home highlight did not inherit ArticleGridCard SourceMark")
    }
  })
  gate(results, "HOME_RECENT_SHARED_PRESENTER", () => {
    const recent = document.querySelector(".home-recent")
    if (!recent?.querySelector(".grid-card-feed-icon.source-mark")) {
      throw new Error("Home recent did not inherit ArticleGridCard SourceMark")
    }
  })

  const marks = [...document.querySelectorAll(".source-mark")]
  gate(results, "DECORATIVE_MARKS_AND_FALLBACKS", () => {
    if (marks.some((mark) => mark.getAttribute("aria-hidden") !== "true")) {
      throw new Error("SourceMark must remain decorative")
    }
    if (!document.querySelector('[data-source-mark-fallback="monogram"]')) {
      throw new Error("Monogram fallback is missing")
    }
    if (!document.querySelector('[data-source-mark-fallback="rss"]')) {
      throw new Error("RSS terminal fallback is missing")
    }
    if (!document.querySelector('[data-source-mark-fallback="provider"]')) {
      throw new Error("Provider icon presentation is missing")
    }
  })
  gate(results, "TINY_PROVIDER_USES_MONOGRAM", () => {
    if (
      document.querySelector(
        '[data-feed-edit-id="73"] .source-mark[data-source-mark-fallback="provider"]',
      )
    ) {
      throw new Error("Sub-8px provider icon was not rejected")
    }
  })
  await waitFor(
    () => document.querySelector('.source-mark__image[src*="provider-wide.svg"]')?.complete,
    "Cross-origin provider image did not load",
  ).catch((error) =>
    results.push({ name: "CROSS_ORIGIN_PROVIDER_LOADED", status: "FAIL", detail: error.message }),
  )
  await wait(150)
  gate(results, "ANALYZABLE_DARK_PROVIDER_USES_LIGHT_PLATE", () => {
    const mark = document.querySelector(".nnw01-b-main .list-entry-feed-icon.source-mark")
    if (mark?.dataset.sourceMarkPlate !== "light") {
      throw new Error(`Expected light plate for dark icon, got ${mark?.dataset.sourceMarkPlate}`)
    }
  })
  gate(results, "ANALYZABLE_LIGHT_PROVIDER_USES_DARK_PLATE", () => {
    const mark = document
      .querySelector('.nnw01-b-main .grid-card-feed-icon.source-mark img[src*="ffffff"]')
      ?.closest(".source-mark")
    if (mark?.dataset.sourceMarkPlate !== "dark") {
      throw new Error(`Expected dark plate for light icon, got ${mark?.dataset.sourceMarkPlate}`)
    }
  })
  gate(results, "CROSS_ORIGIN_PROVIDER_REMAINS_VISIBLE_WITH_NEUTRAL_PLATE", () => {
    const providerImage = document.querySelector(
      '.nnw01-b-main .source-mark__image[src*="provider-wide.svg"]',
    )
    const mark = providerImage?.closest(".source-mark")
    if (!providerImage || !providerImage.naturalWidth) {
      throw new Error("Provider icon was not rendered")
    }
    if (mark?.dataset.sourceMarkPlate !== "neutral") {
      throw new Error(`Expected neutral plate, got ${mark?.dataset.sourceMarkPlate}`)
    }
    if (Math.round(mark.getBoundingClientRect().width) !== 20) {
      throw new Error("Non-square provider icon changed its square SourceMark frame")
    }
  })
  gate(results, "NO_D1_ANALYSIS_EXTRA_REQUEST", () => {
    const providerRequests = performance
      .getEntriesByType("resource")
      .filter(({ name }) => name.includes("provider-wide.svg"))
    const analysisRequests = providerRequests.filter(({ initiatorType }) => initiatorType !== "img")
    if (analysisRequests.length > 0) {
      throw new Error(`Unexpected non-image request for provider icon: ${analysisRequests.length}`)
    }
  })
  gate(results, "ARTICLE_SOURCE_TEXT_REMAINS_WITH_ICON_OFF", () => {
    settingsState.set({ ...settingsState.get(), showFeedIcon: false })
    const title = document.querySelector(".list-entry-source-title")
    if (!title?.textContent.includes("Catalog square source")) {
      throw new Error("Source title disappeared when icon display was disabled")
    }
    if (
      !document.querySelector(".list-entry-wrapper.article-entry")?.hasAttribute("aria-describedby")
    ) {
      throw new Error("Source description disappeared when icons were disabled")
    }
    settingsState.set({ ...settingsState.get(), showFeedIcon: true })
  })
  settingsState.set({ ...settingsState.get(), showFeedIcon: false })
  await wait()
  gate(results, "ARTICLE_AND_HOME_ICON_OFF_MATRIX", () => {
    for (const selector of [
      ".list-entry-feed-icon.source-mark",
      ".feed-icon-mini.source-mark",
      ".grid-card-feed-icon.source-mark",
    ]) {
      if (document.querySelector(selector)) {
        throw new Error(`Icon remains visible: ${selector}`)
      }
    }
    for (const selector of [
      ".list-entry-source-title",
      ".card-source-title",
      ".grid-card-source-title",
    ]) {
      if (!document.querySelector(selector)?.textContent.trim()) {
        throw new Error(`Source text is missing while icons are off: ${selector}`)
      }
    }
    const checkbox = document.querySelector(".article-selection-checkbox")
    if (checkbox?.hasAttribute("aria-describedby")) {
      throw new Error("Selection checkbox received source description")
    }
  })
  settingsState.set({ ...settingsState.get(), showFeedIcon: true })
  await wait()
  gate(results, "NO_EXTERNAL_FAVICON_OR_MINIFLUX_WRITES", () => {
    if (apiRequests.length > 0) {
      throw new Error(`Unexpected API calls: ${apiRequests.length}`)
    }
    const resources = performance.getEntriesByType("resource").map(({ name }) => name)
    const forbidden = resources.filter((url) => /duckduckgo|google\.com\/s2\/favicons/i.test(url))
    if (forbidden.length > 0) {
      throw new Error(`Third-party favicon requests: ${forbidden.join(", ")}`)
    }
  })
  gate(results, "NO_HORIZONTAL_OVERFLOW", () => {
    if (document.documentElement.scrollWidth > innerWidth + 1) {
      throw new Error(`Page scroll width ${document.documentElement.scrollWidth} > ${innerWidth}`)
    }
  })
  gate(results, "NO_SOURCE_OR_TITLE_OVERLAP", () => {
    for (const source of document.querySelectorAll(
      ".list-entry-source, .card-source, .grid-card-source",
    )) {
      const mark = source.querySelector(".source-mark")
      const title = source.querySelector(
        ".list-entry-source-title, .card-source-title, .grid-card-source-title",
      )
      if (
        mark &&
        title &&
        mark.getBoundingClientRect().right > title.getBoundingClientRect().left + 1
      ) {
        throw new Error("Source mark overlaps its visible source name")
      }
    }
  })
  gate(results, "NO_SOURCE_METADATA_WRAP_REGRESSION", () => {
    for (const title of document.querySelectorAll(
      ".list-entry-source-title, .card-source-title, .grid-card-source-title",
    )) {
      if (getComputedStyle(title).whiteSpace !== "nowrap") {
        throw new Error("Source metadata no longer uses its existing single-line presentation")
      }
      if (
        title.getBoundingClientRect().height >
        Number.parseFloat(getComputedStyle(title).lineHeight) + 1
      ) {
        throw new Error("Source metadata wrapped to multiple lines")
      }
    }
  })

  const summary = `${results.filter(({ status }) => status === "PASS").length}/${results.length} gates PASS`
  const report = {
    viewport: { width: innerWidth, height: innerHeight },
    theme: document.body.getAttribute("arco-theme") ?? "light",
    summary,
    results,
    providerImageRequestEntries: performance
      .getEntriesByType("resource")
      .filter(({ name }) => name.includes("provider-wide.svg")).length,
    feedIconRequests: apiRequests
      .filter(({ method, args }) => method === "get" && /^\/v1\/icons\//.test(args[0]))
      .map(({ args }) => args[0]),
    apiRequests: apiRequests.length,
  }
  document.querySelector("[data-testid='nnw01-b-summary']").textContent = summary
  document.querySelector("[data-testid='nnw01-b-results']").textContent = JSON.stringify(
    report,
    null,
    2,
  )
  globalThis.__nnw01BResults = report
  return report
}

globalThis.__runNnw01B = runScenarios

const LocationProbe = () => {
  const { pathname } = useLocation()
  return <output data-testid="current-route">{pathname}</output>
}

function FixtureFrame() {
  const [running, setRunning] = useState(false)
  const recentRootRef = React.useRef(null)
  const articleActivation = activation

  return (
    <div className="nnw01-b-app">
      <aside className="sidebar sidebar-expanded nnw01-b-sidebar">
        <div className="desktop-sidebar-content" id="desktop-sidebar-navigation">
          <Sidebar />
        </div>
      </aside>
      <main className="nnw01-b-main">
        <div className="nnw01-b-controls">
          <SidebarTrigger />
          <CompactNavigation />
          <Button
            data-testid="nnw01-b-icons-on"
            onClick={() => settingsState.set({ ...settingsState.get(), showFeedIcon: true })}
          >
            Icons on
          </Button>
          <Button
            data-testid="nnw01-b-icons-off"
            onClick={() => settingsState.set({ ...settingsState.get(), showFeedIcon: false })}
          >
            Icons off
          </Button>
          <Button
            data-testid="nnw01-b-light"
            onClick={() => document.body.setAttribute("arco-theme", "light")}
          >
            Light
          </Button>
          <Button
            data-testid="nnw01-b-dark"
            onClick={() => document.body.setAttribute("arco-theme", "dark")}
          >
            Dark
          </Button>
          <Button
            data-testid="nnw01-b-run"
            loading={running}
            onClick={async () => {
              setRunning(true)
              try {
                await runScenarios()
              } finally {
                setRunning(false)
              }
            }}
          >
            Run NNW01-B gates
          </Button>
          <div className="nnw01-b-no-icon-metadata" data-testid="no-icon-metadata-mark">
            <FeedSourceMark feed={noIconMetadataFeed} size={20} />
          </div>
          <span data-testid="nnw01-b-summary">Ready</span>
        </div>
        <div className="nnw01-b-content">
          <section className="nnw01-b-section">
            <h2>Article list</h2>
            <ArticleEntry
              articleActivation={articleActivation}
              entry={entries[0]}
              layout="list"
              observeRead={observeRead}
              presenter={ArticleListItem}
            />
            <ArticleEntry
              articleActivation={articleActivation}
              entry={entries[1]}
              layout="list"
              observeRead={observeRead}
              presenter={ArticleListItem}
            />
          </section>
          <section className="nnw01-b-section nnw01-b-article-column">
            <h2>Article column/card</h2>
            <ArticleEntry
              articleActivation={articleActivation}
              entry={entries[0]}
              layout="column"
              observeRead={observeRead}
              presenter={ArticleCard}
            />
            <ArticleEntry
              articleActivation={articleActivation}
              entry={entries[2]}
              layout="column"
              observeRead={observeRead}
              presenter={ArticleCard}
            />
          </section>
          <section className="nnw01-b-section">
            <h2>Article grid cards</h2>
            <div className="nnw01-b-grid">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <ArticleEntry
                  key={entries[index].id}
                  articleActivation={articleActivation}
                  entry={entries[index]}
                  layout="card"
                  observeRead={observeRead}
                  presenter={ArticleGridCard}
                  selectionMode={index === 0}
                  onSelectionCheckboxFocus={() => {}}
                  onToggleSelection={() => {}}
                />
              ))}
            </div>
          </section>
          <section className="nnw01-b-section">
            <h2>Home highlight</h2>
            <div className="nnw01-b-home-grid">
              <HomeHighlightCard
                articleActivation={articleActivation}
                entry={entries[0]}
                observeRead={observeRead}
                slot="lead"
              />
            </div>
          </section>
          <section className="nnw01-b-section nnw01-b-home-recent">
            <h2>Home recent</h2>
            <div ref={recentRootRef} className="entry-list entry-list-layout-card">
              <HomeRecent
                articleActivation={articleActivation}
                entries={entries}
                highlightIds={[entries[0].id]}
                observeRead={observeRead}
                recentIds={entries.slice(1, 4).map((entry) => entry.id)}
                scrollRootRef={recentRootRef}
              />
            </div>
          </section>
          <pre className="nnw01-b-report" data-testid="nnw01-b-results" />
          <LocationProbe />
        </div>
      </main>
      <SidebarDrawerHost />
    </div>
  )
}

const router = createMemoryRouter([{ path: "*", element: <FixtureFrame /> }], {
  initialEntries: ["/feed/71"],
})

createRoot(document.querySelector("#root")).render(
  <AppDataContext.Provider value={appData}>
    <DesktopSidebarContext.Provider value={desktopSidebar}>
      <ConfigProvider locale={enUS}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>,
)
