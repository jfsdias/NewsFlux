/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import { ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "@/App.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router"

import apiClient from "@/apis/ofetch"
import Content from "@/components/Content/Content"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState, setFilterDate, setFilterString } from "@/store/contentState"
import { dataState, setUnreadInfo } from "@/store/dataState"
import { defaultIcon, feedIconsState } from "@/store/feedIconsState"
import {
  getDefaultSettings,
  replaceSettings,
  settingsState,
  updateSettings,
} from "@/store/settingsState"
import { markAllReadUndoActions } from "@/utils/mark-all-read-undo"

const params = new URLSearchParams(globalThis.location.search)
const initialLayout = ["card", "column", "list"].includes(params.get("layout"))
  ? params.get("layout")
  : "card"
const initialTheme = params.get("theme") === "light" ? "light" : "dark"
const entryCount = Math.max(12, Math.min(Number(params.get("count") || 80), 2500))
const failAtCall = Number(params.get("failAt") || 0)
const deepLinkId = params.get("deepLink")

const feed = {
  id: 11,
  title: "BULK-02 Fixture Feed",
  site_url: "https://example.invalid",
  feed_url: "https://example.invalid/feed.xml",
  icon: { icon_id: 1 },
  hide_globally: false,
  category: { id: 5 },
}
const category = { id: 5, title: "BULK-02 Fixture Category", hide_globally: false }
const makeEntry = (id) => {
  const title = `Fixture article ${id}${id === 1 ? " — a deliberately long headline for wrapping and selection layout checks" : ""}`
  const publishedAt = new Date(Date.now() - id * 60_000).toISOString()
  return {
    id,
    title,
    status: id % 4 === 0 ? "read" : "unread",
    starred: id % 7 === 0,
    feed,
    published_at: publishedAt,
    changed_at: publishedAt,
    content: `<p>${title}</p><p>Fixture copy for NewsFlux selection behavior without external requests.</p>`,
    url: `https://example.invalid/${id}`,
  }
}

let fixtureEntries = Array.from({ length: entryCount }, (_, index) => makeEntry(index + 1))
let putCallCount = 0
const apiLog = []
const unexpectedRequests = []
const report = { countsRefreshes: 0, listReads: 0 }
const record = (change) => Object.assign(report, change)
const getBounds = (element) => {
  if (!element) {
    return null
  }
  const rect = element.getBoundingClientRect()
  return {
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  }
}
const applyLayout = (layout) => updateSettings({ articleListLayout: layout })
const applyStatus = (showStatus) => updateSettings({ showStatus })

apiClient.get = async (url) => {
  const entryMatch = String(url).match(/\/v1\/entries\/(\d+)(?:\/fetch-content)?/)
  if (entryMatch) {
    const entry = fixtureEntries.find(({ id }) => id === Number(entryMatch[1]))
    if (String(url).includes("/fetch-content")) {
      return { content: entry?.content ?? "" }
    }
    if (entry) {
      return { ...entry }
    }
  }
  unexpectedRequests.push(`GET ${url}`)
  throw new Error(`Unexpected fixture GET: ${url}`)
}
apiClient.post = async (url) => {
  unexpectedRequests.push(`POST ${url}`)
  throw new Error(`Unexpected fixture POST: ${url}`)
}
apiClient.raw = async (url) => {
  unexpectedRequests.push(`RAW ${url}`)
  throw new Error(`Unexpected fixture RAW: ${url}`)
}
apiClient.put = async (url, body) => {
  if (url !== "/v1/entries") {
    unexpectedRequests.push(`PUT ${url}`)
    throw new Error(`Unexpected fixture PUT: ${url}`)
  }
  putCallCount += 1
  const call = {
    entry_ids: [...(body.entry_ids ?? [])],
    status: body.status,
    starred: body.starred,
  }
  apiLog.push(call)
  if (failAtCall > 0 && putCallCount === failAtCall) {
    throw new Error("Fixture mutation failure")
  }
  const ids = new Set(call.entry_ids)
  fixtureEntries = fixtureEntries.map((entry) => {
    if (!ids.has(entry.id)) {
      return entry
    }
    return {
      ...entry,
      ...(body.status === undefined ? {} : { status: body.status }),
      ...(body.starred === undefined ? {} : { starred: body.starred }),
    }
  })
  return { total: call.entry_ids.length }
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "https://fixture.invalid", token: "fixture", username: "", password: "" })
replaceSettings({
  ...getDefaultSettings(),
  articleListLayout: initialLayout,
  enableContextMenu: true,
  markReadBy: "manual",
  markReadOnScroll: false,
  showStatus: params.get("status") === "unread" ? "unread" : "all",
  themeMode: initialTheme,
})
contentState.set({
  ...contentState.get(),
  activeContent: null,
  articleListRevision: 0,
  articleListSnapshotRevision: 0,
  articleListError: false,
  entries: [],
  filterDate: null,
  filterString: "",
  infoFrom: "feed",
  infoId: 11,
  isArticleListReady: false,
  isArticleLoading: false,
  total: 0,
})
dataState.set({
  ...dataState.get(),
  currentUser: { id: 1 },
  feedsData: [feed],
  categoriesData: [category],
  unreadInfo: { [feed.id]: fixtureEntries.filter(({ status }) => status === "unread").length },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})
document.body.setAttribute("arco-theme", initialTheme)
feedIconsState.set({ 0: defaultIcon, 1: defaultIcon })

const getEntries = async (statusOrOptions, starred = false, options = {}) => {
  report.listReads += 1
  if (typeof statusOrOptions === "object" && statusOrOptions !== null) {
    options = statusOrOptions
    statusOrOptions = null
  }

  const activeFilterDate = contentState.get().filterDate
  const search = options.search?.toLocaleLowerCase() ?? ""
  let entries = [...fixtureEntries]
  if (statusOrOptions === "unread") {
    entries = entries.filter(({ status }) => status === "unread")
  }
  if (starred) {
    entries = entries.filter(({ starred: isStarred }) => isStarred)
  }
  if (search) {
    entries = entries.filter(({ title, content }) =>
      `${title} ${content}`.toLocaleLowerCase().includes(search),
    )
  }
  if (activeFilterDate instanceof Date && !Number.isNaN(activeFilterDate.getTime())) {
    const selectedDay = activeFilterDate.toDateString()
    entries = entries.filter(
      ({ published_at }) => new Date(published_at).toDateString() === selectedDay,
    )
  }

  const total = entries.length
  const offset = Number(options.offset ?? 0)
  const limit = Number(options.limit ?? total)
  return { entries: entries.slice(offset, offset + limit), total }
}

const HomeFixture = () => (
  <div data-testid="home-scope">Home fixture; selection is unavailable.</div>
)

const HarnessRoute = () => {
  const location = useLocation()
  const { pathname: currentPath } = location
  const source = location.pathname.startsWith("/home")
    ? "home"
    : location.pathname.startsWith("/history")
      ? "history"
      : location.pathname.startsWith("/all")
        ? "all"
        : location.pathname.startsWith("/today")
          ? "today"
          : "feed"
  const info = { from: source, id: source === "feed" ? 11 : null }
  const entryIdOverride = location.pathname.match(/\/entry\/(\d+)/)?.[1]

  return (
    <HarnessPage
      currentPath={currentPath}
      entryIdOverride={entryIdOverride}
      info={info}
      listContent={source === "home" ? HomeFixture : undefined}
    />
  )
}

const HarnessPage = ({ currentPath, entryIdOverride, info, listContent }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const [theme, setTheme] = useState(initialTheme)
  const collapseButtonRef = useRef(null)
  const detailCloseButtonRef = useRef(null)
  const reopenButtonRef = useRef(null)
  const content = useStore(contentState)
  const settings = useStore(settingsState)
  const [refreshCount, setRefreshCount] = useState(0)

  const refreshCounts = useCallback(async () => {
    setRefreshCount((current) => current + 1)
    record({ countsRefreshes: report.countsRefreshes + 1 })
    const unreadCount = fixtureEntries.filter(({ status }) => status === "unread").length
    setUnreadInfo((previous) => ({ ...previous, [feed.id]: unreadCount }))
    return {}
  }, [])
  const refreshFeedData = useCallback(async () => {}, [])
  const collapseDesktopSidebar = useCallback(() => {}, [])
  const expandDesktopSidebar = useCallback(() => {}, [])
  const desktopSidebarContext = useMemo(
    () => ({
      collapseButtonRef,
      collapseDesktopSidebar,
      detailCloseButtonRef,
      expandDesktopSidebar,
      isDesktopSidebarCollapsed: false,
      reopenButtonRef,
    }),
    [collapseDesktopSidebar, expandDesktopSidebar],
  )

  useEffect(() => {
    const nextInfo = currentPath.startsWith("/home")
      ? { from: "home", id: null }
      : currentPath.startsWith("/history")
        ? { from: "history", id: null }
        : currentPath.startsWith("/all")
          ? { from: "all", id: null }
          : currentPath.startsWith("/today")
            ? { from: "today", id: null }
            : { from: "feed", id: 11 }
    contentState.setKey("infoFrom", nextInfo.from)
    contentState.setKey("infoId", nextInfo.id)
  }, [currentPath])

  useEffect(() => {
    document.body.setAttribute("arco-theme", theme)
  }, [theme])

  useEffect(() => {
    globalThis.__bulk02 = {
      apiLog,
      clearApiLog: () => {
        apiLog.length = 0
        putCallCount = 0
      },
      entries: () => fixtureEntries.map((entry) => ({ ...entry })),
      navigate,
      refreshCount: () => report.countsRefreshes,
      snapshot: () => {
        const viewport = document.querySelector("[data-testid='content-viewport']")
        const list = document.querySelector(".entry-list")
        const entries = [...document.querySelectorAll("a[data-entry-id]")]
        const checkboxes = [...document.querySelectorAll("input[data-bulk-entry-checkbox]")]
        const detail = document.querySelector(".article-container-full-size")
        const summary = document.querySelector(".article-selection-count")
        const select = document.querySelector(".article-selection-trigger")
        return {
          activeArticleId: contentState.get().activeContent?.id ?? null,
          articleLinks: entries.length,
          checkboxCount: checkboxes.length,
          checkedIds: checkboxes
            .filter((input) => input.checked)
            .map((input) => Number(input.dataset.bulkEntryId)),
          contentOverflow: viewport ? viewport.scrollWidth > viewport.clientWidth : false,
          documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
          firstCheckboxDomIsValid:
            checkboxes.length === 0 ||
            (!checkboxes[0].closest("a") &&
              Boolean(
                checkboxes[0]
                  .closest(".article-entry-shell")
                  ?.querySelector(":scope > a[data-entry-id]"),
              )),
          detailVisible: Boolean(detail),
          focusedElement: document.activeElement?.className ?? document.activeElement?.tagName,
          layout: settingsStateValue().articleListLayout,
          listMounted: Boolean(list),
          listInert: list?.closest(".entry-col")?.hasAttribute("inert") ?? false,
          listScrollHeight: list?.scrollHeight ?? 0,
          listScrollTop: list?.scrollTop ?? 0,
          listWidth: list?.getBoundingClientRect().width ?? 0,
          selectionControlsBounds: getBounds(document.querySelector(".article-selection-controls")),
          selectedCount: summary?.textContent ?? "",
          selectButton: Boolean(select),
          selectionMode: Boolean(summary),
          status: settingsStateValue().showStatus,
          theme,
          viewport: getBounds(viewport),
          listBounds: getBounds(list),
          firstCheckboxTarget: getBounds(checkboxes[0]?.closest("label")),
          route: currentPath,
          countsRefreshes: report.countsRefreshes,
        }
      },
      unexpectedRequests,
      undoToken: () => markAllReadUndoActions.getCurrentToken(),
    }
  }, [content.activeContent, currentPath, navigate, settings, theme])

  const applySource = (path) => navigate(path)
  const setHarnessTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark"
    setTheme(nextTheme)
    updateSettings({ themeMode: nextTheme })
  }

  return (
    <AppDataContext.Provider value={{ refreshCounts, refreshFeedData }}>
      <DesktopSidebarContext.Provider value={desktopSidebarContext}>
        <ConfigProvider locale={enUS}>
          <div className="bulk02-harness-controls" data-testid="harness-controls">
            <button data-testid="layout-column" onClick={() => applyLayout("column")}>
              column
            </button>
            <button data-testid="layout-card" onClick={() => applyLayout("card")}>
              card
            </button>
            <button data-testid="layout-list" onClick={() => applyLayout("list")}>
              list
            </button>
            <button data-testid="status-all" onClick={() => applyStatus("all")}>
              All
            </button>
            <button data-testid="status-unread" onClick={() => applyStatus("unread")}>
              Unread
            </button>
            <button data-testid="scope-home" onClick={() => applySource("/home")}>
              Home
            </button>
            <button data-testid="scope-history" onClick={() => applySource("/history")}>
              History
            </button>
            <button data-testid="scope-feed" onClick={() => applySource("/feed/11")}>
              Feed
            </button>
            <button data-testid="toggle-theme" onClick={setHarnessTheme}>
              {theme}
            </button>
            <button data-testid="router-back" onClick={() => navigate(-1)}>
              Back
            </button>
            <button data-testid="router-forward" onClick={() => navigate(1)}>
              Forward
            </button>
            <button data-testid="set-search" onClick={() => setFilterString("fixture article 1")}>
              Search scope
            </button>
            <button
              data-testid="clear-search-date"
              onClick={() => {
                setFilterString("")
                setFilterDate(null)
              }}
            >
              Clear filters
            </button>
            <output data-testid="runtime-report">
              {JSON.stringify({
                route: location.pathname,
                ready: content.isArticleListReady,
                layout: settings.articleListLayout,
                refreshCount,
              })}
            </output>
          </div>
          <div className="bulk02-content-frame" data-testid="content-viewport">
            <Content
              entryIdOverride={entryIdOverride}
              getEntries={getEntries}
              info={info}
              listContent={listContent}
            />
          </div>
        </ConfigProvider>
      </DesktopSidebarContext.Provider>
    </AppDataContext.Provider>
  )
}

const settingsStateValue = () => settingsState.get()

const mountPath = deepLinkId ? `/feed/11/entry/${deepLinkId}` : "/feed/11"
const renderApplication = () => (
  <MemoryRouter initialEntries={[mountPath]}>
    <ContextProvider>
      <Routes>
        <Route element={<HarnessRoute />} path="*" />
      </Routes>
    </ContextProvider>
  </MemoryRouter>
)

createRoot(document.querySelector("#root")).render(renderApplication())
