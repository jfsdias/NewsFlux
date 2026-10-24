/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider } from "react-router"

import apiClient from "@/apis/ofetch"
import SearchAndSortBar from "@/components/Article/SearchAndSortBar"
import { ContentContext } from "@/components/Content/ContentContext"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { commitCatalogData, resetData } from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "@/components/Article/SidebarTrigger.css"
import "./nnw01-d-feed-header.css"

const query = new URLSearchParams(location.search)
const feed = {
  id: 41,
  title: "9to5Mac — Apple News, Reviews, Technology Analysis, and Daily Coverage",
  category: { id: 71, title: "Technology", hide_globally: false },
  icon: { icon_id: 2041 },
  site_url: "https://9to5mac.example.test/",
  feed_url: "https://9to5mac.example.test/rss",
}
const providerIcon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="24"><rect width="64" height="24" fill="#111111"/></svg>')}`
const apiRequests = []
const providerWrites = []

const initialShowFeedIcon = query.get("showFeedIcon") !== "off"
const theme = query.get("theme") === "dark" ? "dark" : "light"
document.body.setAttribute("arco-theme", theme)
document.body.style.colorScheme = theme
document.documentElement.dataset.theme = theme
document.documentElement.style.setProperty(
  "--app-shell-background",
  theme === "dark" ? "#0b0d10" : "#f2f3f5",
)

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "http://127.0.0.1:4174", token: "fixture", username: "fixture" })
settingsState.set({
  ...getDefaultSettings(),
  orderDirection: "desc",
  showFeedIcon: initialShowFeedIcon,
  showStatus: "all",
})
resetData()
commitCatalogData({ feedsData: [feed], categoriesData: [feed.category] })
contentState.set({
  ...contentState.get(),
  articleListError: false,
  filterDate: null,
  filterString: "",
  infoFrom: "feed",
  infoId: feed.id,
  isArticleListReady: true,
  total: 404,
})
feedIconsState.set({
  0: { url: null, width: null, height: null },
  [feed.icon.icon_id]: { url: providerIcon, width: 64, height: 24 },
})

apiClient.get = async (...args) => {
  apiRequests.push({ method: "GET", args })
  throw new Error("Unexpected provider icon request in NNW01-D harness")
}
for (const method of ["post", "put", "raw", "delete"]) {
  apiClient[method] = async (...args) => {
    providerWrites.push({ method: method.toUpperCase(), args })
    throw new Error(`Unexpected ${method.toUpperCase()} in NNW01-D harness`)
  }
}

const wait = (duration = 40) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await wait()
  }
  return predicate()
}

const makeGate = (name, pass, detail = "") => ({
  name,
  result: pass ? "PASS" : "FAIL",
  detail,
})

const getRect = (element) => {
  const value = element?.getBoundingClientRect()
  return value
    ? {
        left: value.left,
        right: value.right,
        top: value.top,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      }
    : null
}

const setFeedIcon = async (value) => {
  settingsState.set({ ...settingsState.get(), showFeedIcon: value })
  await wait()
}

const inspectHeader = () => {
  const header = document.querySelector(".search-and-sort-bar")
  const pageInfo = header?.querySelector(".page-info")
  const mark = pageInfo?.querySelector(".feed-header-source-mark")
  const title = pageInfo?.querySelector(".title-container")
  const titleText = title?.querySelector(
    ".arco-ellipsis-content:not(.arco-ellipsis-content-mirror) .arco-ellipsis-text",
  )
  const titleLine = title?.querySelector(
    ".arco-ellipsis-content:not(.arco-ellipsis-content-mirror)",
  )
  const count = pageInfo?.querySelector(".count-label")
  const buttonGroup = header?.querySelector(".button-group")

  return {
    header: getRect(header),
    pageInfo: getRect(pageInfo),
    mark: getRect(mark),
    title: getRect(title),
    titleText: titleText?.textContent?.trim() ?? "",
    titleEllipsis: titleLine ? getComputedStyle(titleLine).textOverflow : "none",
    titleWhiteSpace: titleLine ? getComputedStyle(titleLine).whiteSpace : "normal",
    count: getRect(count),
    countText: count?.textContent?.trim() ?? "",
    buttonGroup: getRect(buttonGroup),
    firstPageInfoChild: pageInfo?.firstElementChild?.className ?? "",
    headerScrollWidth: header?.scrollWidth ?? 0,
    headerClientWidth: header?.clientWidth ?? 0,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }
}

const runGates = async () => {
  const gates = []
  const gate = (name, pass, detail = "") => gates.push(makeGate(name, pass, detail))
  const headerReady = await waitFor(() => document.querySelector(".page-info .title-container"))
  if (!headerReady) {
    throw new Error("Feed header did not mount")
  }

  await setFeedIcon(true)
  await waitFor(() => document.querySelector(".page-info .feed-header-source-mark img")?.complete)
  const on = inspectHeader()
  const markElement = document.querySelector(".feed-header-source-mark")
  const markImage = markElement?.querySelector("img")
  const markSize = markElement?.getBoundingClientRect().width ?? 0
  gate(
    "FEED_HEADER_SOURCEMARK_ON",
    Boolean(markElement && markSize > 0 && markElement.dataset.sourceMarkFallback === "provider"),
  )
  gate(
    "SOURCEMARK_ON_CORRECT",
    Boolean(markElement && markImage?.complete && markImage.naturalWidth > 0),
    `fallback=${markElement?.dataset.sourceMarkFallback ?? "none"}`,
  )
  gate("FEED_HEADER_SOURCEMARK_SIZE_20", Math.abs(markSize - 20) <= 0.5, `${markSize.toFixed(2)}px`)
  gate(
    "FEED_HEADER_SOURCEMARK_CENTERED",
    Boolean(
      on.mark &&
      on.title &&
      Math.abs(on.mark.top + on.mark.height / 2 - (on.title.top + on.title.height / 2)) <= 1,
    ),
  )
  gate(
    "FEED_HEADER_NAME_UNCHANGED",
    on.titleText === feed.title &&
      on.titleEllipsis === "ellipsis" &&
      on.titleWhiteSpace === "nowrap",
    on.titleText,
  )
  gate("FEED_HEADER_COUNT_UNCHANGED", on.countText === "(404)", on.countText)
  gate(
    "FEED_HEADER_DECORATIVE_A11Y",
    markElement?.getAttribute("aria-hidden") === "true" && markImage?.getAttribute("alt") === "",
  )
  const countReadable = Boolean(
    on.count &&
    on.count.width > 0 &&
    on.pageInfo &&
    on.count.right <= on.pageInfo.right + 0.5 &&
    on.count.left >= (on.title?.right ?? 0) - 0.5,
  )
  gate("COUNT_READABLE", countReadable, `count=${on.countText}`)
  const titleBetweenMarkAndCount = Boolean(
    on.mark &&
    on.title &&
    on.count &&
    on.mark.right <= on.title.left + 0.5 &&
    on.title.right <= on.count.left + 0.5,
  )
  const controlsDoNotOverlap = Boolean(
    on.pageInfo && on.buttonGroup && on.pageInfo.right <= on.buttonGroup.left + 0.5,
  )
  gate("NO_HEADER_CONTROL_COLLISION", titleBetweenMarkAndCount && controlsDoNotOverlap)
  gate(
    "TITLE_BEHAVIOR_NOT_WORSE",
    on.titleEllipsis === "ellipsis" &&
      on.titleWhiteSpace === "nowrap" &&
      on.title.width > 0 &&
      on.title.right <= (on.count?.left ?? 0) + 0.5,
  )
  gate(
    "NO_CLIPPING",
    Boolean(
      on.header &&
      on.mark &&
      on.title &&
      on.count &&
      on.header.top >= -0.5 &&
      on.header.bottom <= innerHeight + 0.5 &&
      on.mark.left >= on.pageInfo.left - 0.5 &&
      on.title.left >= on.mark.right - 0.5 &&
      on.count.right <= on.pageInfo.right + 0.5,
    ),
  )
  gate(
    "NO_HORIZONTAL_OVERFLOW",
    on.documentScrollWidth <= innerWidth + 0.5 && on.headerScrollWidth <= on.headerClientWidth + 1,
  )

  await setFeedIcon(false)
  await waitFor(() => !document.querySelector(".page-info .feed-header-source-mark"))
  feedIconsState.set({ 0: { url: null, width: null, height: null } })
  await wait()
  const off = inspectHeader()
  const offMark = document.querySelector(".page-info .feed-header-source-mark")
  gate("FEED_HEADER_SOURCEMARK_OFF", !offMark)
  gate(
    "FEED_HEADER_HEIGHT_NOT_INFLATED",
    Boolean(on.header && off.header && Math.abs(on.header.height - off.header.height) <= 0.5),
  )
  gate("SOURCEMARK_OFF_CORRECT", !offMark)
  gate(
    "FEED_HEADER_NO_EMPTY_SLOT_WHEN_OFF",
    off.firstPageInfoChild.includes("title-container") &&
      off.title &&
      off.pageInfo &&
      Math.abs(off.title.left - off.pageInfo.left) <= 0.5,
    `titleX=${off.title?.left}; pageInfoX=${off.pageInfo?.left}`,
  )
  gate("FEED_HEADER_NO_EXTRA_NETWORK", apiRequests.length === 0 && providerWrites.length === 0)
  gate("WRONG_FEED_ID_ICON_REQUESTS", apiRequests.length === 0)
  gate(
    "NO_THIRD_PARTY_FAVICON_REQUESTS",
    performance.getEntriesByType("resource").every(({ name }) => {
      if (name.startsWith("data:")) {
        return true
      }
      try {
        return new URL(name).origin === location.origin
      } catch {
        return true
      }
    }),
  )
  gate("NO_MINIFLUX_WRITES", providerWrites.length === 0)
  gate(
    "VISUAL_VIEWPORT_THEME",
    (innerWidth === 390 && innerHeight === 844) ||
      (innerWidth === 884 && innerHeight === 1104) ||
      (innerWidth === 1440 && innerHeight === 900),
    `${innerWidth}x${innerHeight} ${theme}`,
  )

  feedIconsState.set({
    0: { url: null, width: null, height: null },
    [feed.icon.icon_id]: { url: providerIcon, width: 64, height: 24 },
  })
  await wait()
  await setFeedIcon(initialShowFeedIcon)
  const result = {
    viewport: `${innerWidth}x${innerHeight}`,
    theme,
    initialShowFeedIcon,
    on,
    off,
    gates,
    apiRequests,
    providerWrites,
  }
  globalThis.__nnw01dResults = result
  document.querySelector("#nnw01-d-report").textContent = JSON.stringify(result, null, 2)
  return result
}

const DesktopSidebarContextValue = {
  expandDesktopSidebar: () => {},
  isDesktopSidebarCollapsed: false,
  reopenButtonRef: { current: null },
}
const ContentContextValue = {
  closeActiveContent: () => {},
  entryListRef: { current: null },
}

const router = createMemoryRouter([{ path: "/feed/:id", element: <SearchAndSortBar /> }], {
  initialEntries: ["/feed/41"],
})

const FeedHeaderHarness = () => {
  useEffect(() => {
    if (query.get("autorun") !== "1") {
      return
    }
    void runGates().catch((error) => {
      const failure = {
        viewport: `${innerWidth}x${innerHeight}`,
        theme,
        gates: [makeGate("HARNESS", false, error.message)],
      }
      globalThis.__nnw01dResults = failure
      document.querySelector("#nnw01-d-report").textContent = JSON.stringify(failure, null, 2)
    })
  }, [])

  return (
    <ConfigProvider locale={enUS}>
      <DesktopSidebarContext.Provider value={DesktopSidebarContextValue}>
        <ContentContext.Provider value={ContentContextValue}>
          <div className="nnw01-d-root">
            <RouterProvider router={router} />
            <pre className="nnw01-d-report" id="nnw01-d-report" />
          </div>
        </ContentContext.Provider>
      </DesktopSidebarContext.Provider>
    </ConfigProvider>
  )
}

globalThis.__nnw01d = { runGates, inspectHeader }
createRoot(document.querySelector("#root")).render(<FeedHeaderHarness />)
