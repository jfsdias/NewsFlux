/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import { ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation } from "react-router"

import apiClient from "@/apis/ofetch"
import FooterPanel from "@/components/Content/FooterPanel"
import Sidebar from "@/components/Sidebar/Sidebar"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings, settingsState } from "@/store/settingsState"
import { setExpandedCategories } from "@/store/sidebarState"
import { markAllReadUndoActions } from "@/utils/mark-all-read-undo"

const searchParams = new URLSearchParams(location.search)
const initialScope = searchParams.get("scope") === "category" ? "category" : "feed"
const skipConfirmation = searchParams.get("skip") === "1"
const failMutation = searchParams.get("fail") === "1"
const showHiddenFeeds = searchParams.get("hidden") === "1"
const jumpToNext = searchParams.get("jump") === "1"
const footerScopeOverride = searchParams.get("footerScope")
const category = { id: 5, title: "Fixture category", hide_globally: false }
const nextCategory = { id: 6, title: "Next category", hide_globally: false }
const feeds = [
  {
    id: 11,
    title: "Current fixture feed",
    category,
    hide_globally: false,
    icon: { icon_id: 0 },
    site_url: "https://example.invalid/current",
    feed_url: "https://example.invalid/current.xml",
  },
  {
    id: 12,
    title: "Hidden fixture feed",
    category,
    hide_globally: true,
    icon: { icon_id: 0 },
    site_url: "https://example.invalid/hidden",
    feed_url: "https://example.invalid/hidden.xml",
  },
  {
    id: 21,
    title: "Next fixture feed",
    category: nextCategory,
    hide_globally: false,
    icon: { icon_id: 0 },
    site_url: "https://example.invalid/next",
    feed_url: "https://example.invalid/next.xml",
  },
]
let fixtureEntries = [
  { id: 101, feed: feeds[0], status: "unread", starred: false },
  { id: 102, feed: feeds[0], status: "unread", starred: false },
  { id: 201, feed: feeds[1], status: "unread", starred: false },
  { id: 301, feed: feeds[2], status: "unread", starred: false },
]
let reportState = () => {}
let requestedSourceFilters = []
let mutationBodies = []
let delayNextMarkAllMutation = false
let releasePendingMarkAllMutation = null

globalThis.__delayNextMarkAllMutation = () => {
  delayNextMarkAllMutation = true
}
globalThis.__releasePendingMarkAllMutation = () => releasePendingMarkAllMutation?.()
globalThis.__hasPendingMarkAllMutation = () => releasePendingMarkAllMutation !== null
globalThis.__getActiveMarkAllUndoToken = () => markAllReadUndoActions.getCurrentToken()

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "", token: "", username: "", password: "" })
replaceSettings({
  ...getDefaultSettings(),
  compactSidebarGroups: false,
  markAllReadJumpToNext: jumpToNext,
  showFeedIcon: false,
  showHiddenFeeds,
  showStatus: "unread",
  skipMarkAllReadConfirmation: skipConfirmation,
})
setExpandedCategories(["/category/5", "/category/6"])
dataState.set({
  ...dataState.get(),
  feedsData: feeds,
  categoriesData: [category, nextCategory],
  unreadInfo: { 11: 2, 12: 1, 21: 1 },
  currentUser: { id: 1 },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
    identity: { ...dataState.get().loadState.identity, hasSnapshot: true },
  },
})
const initialPath = initialScope === "category" ? "/category/5" : "/feed/11"
contentState.set({
  ...contentState.get(),
  entries: fixtureEntries.filter((entry) => entry.feed.id === (initialScope === "feed" ? 11 : 11)),
  infoFrom: initialScope,
  infoId: initialScope === "category" ? 5 : 11,
  isArticleListReady: true,
  total: 2,
})

const visibleForQuery = (entry, query) =>
  query.get("globally_visible") !== "true" || !entry.feed.hide_globally

apiClient.get = async (url) => {
  const parsed = new URL(url, location.origin)
  const feedMatch = parsed.pathname.match(/^\/v1\/feeds\/(\d+)\/entries$/)
  const categoryMatch = parsed.pathname.match(/^\/v1\/categories\/(\d+)\/entries$/)
  if (feedMatch || categoryMatch) {
    const scope = feedMatch ? "feed" : "category"
    const sourceId = Number((feedMatch || categoryMatch)[1])
    const query = parsed.searchParams
    requestedSourceFilters.push({ query: query.toString(), scope, sourceId })
    reportState({ lastSourceQuery: `${scope}:${query.toString()}` })
    const entries = fixtureEntries.filter(
      (entry) =>
        entry.status === (query.get("status") || "unread") &&
        (scope === "feed" ? entry.feed.id === sourceId : entry.feed.category.id === sourceId) &&
        visibleForQuery(entry, query),
    )
    return { entries, total: entries.length }
  }
  if (parsed.pathname.startsWith("/v1/icons/")) {
    throw new Error("Icon endpoint intentionally unavailable in fixture")
  }
  throw new Error(`Unexpected fixture GET: ${parsed.pathname}`)
}

apiClient.put = async (url, body) => {
  if (url !== "/v1/entries") {
    throw new Error(`Unexpected fixture PUT: ${url}`)
  }
  mutationBodies.push(body)
  reportState({
    mutationState: "running",
    mutationCount: mutationBodies.length,
    lastMutationBody: JSON.stringify(body),
    mutationLog: JSON.stringify(mutationBodies),
  })
  if (delayNextMarkAllMutation) {
    delayNextMarkAllMutation = false
    reportState({ mutationState: "pending" })
    await new Promise((resolve) => {
      releasePendingMarkAllMutation = () => {
        releasePendingMarkAllMutation = null
        resolve()
      }
    })
  }
  if (failMutation) {
    throw new Error("Fixture mutation failure")
  }
  const ids = new Set(body.entry_ids)
  fixtureEntries = fixtureEntries.map((entry) =>
    ids.has(entry.id) ? { ...entry, status: body.status } : entry,
  )
}

const fixtureUnreadCounts = () => {
  return Object.fromEntries(
    feeds.map((feed) => [
      feed.id,
      fixtureEntries.filter((entry) => entry.feed.id === feed.id && entry.status === "unread")
        .length,
    ]),
  )
}

const entriesAdapter = async (requestedStatus, _starred, filters = {}) => {
  const footerScope = footerScopeOverride || initialScope
  const entries = fixtureEntries.filter(
    (entry) =>
      entry.status === requestedStatus &&
      (footerScope === "category" ? entry.feed.category.id === 5 : entry.feed.id === 11) &&
      visibleForQuery(entry, new URLSearchParams(filters)),
  )
  return { entries, total: entries.length }
}

const LocationProbe = () => {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

const RoutedFooter = () => {
  const { pathname } = useLocation()
  const source = footerScopeOverride || (pathname.startsWith("/category/") ? "category" : "feed")
  const id = source === "category" ? 5 : 11
  return (
    <FooterPanel
      getEntries={entriesAdapter}
      info={{ from: source, id }}
      refreshArticleList={async () => reportState({ listRefreshed: true })}
    />
  )
}

const Harness = () => {
  const [report, setReport] = useState({ mutationState: "idle", mutationCount: 0, refreshCount: 0 })
  const [refreshCount, setRefreshCount] = useState(0)
  const currentData = useStore(dataState)
  const currentContent = useStore(contentState)
  const currentSettings = useStore(settingsState)
  const updateReport = useCallback(
    (changes) => setReport((previous) => ({ ...previous, ...changes })),
    [],
  )
  useEffect(() => {
    reportState = updateReport
    return () => {
      reportState = () => {}
    }
  }, [updateReport])

  const refreshCounts = useCallback(async () => {
    const counts = fixtureUnreadCounts()
    dataState.setKey("unreadInfo", counts)
    setRefreshCount((previous) => previous + 1)
    reportState({ mutationState: "reconciled" })
    return {}
  }, [])

  const refreshFeedData = useCallback(async () => {
    dataState.setKey("unreadInfo", fixtureUnreadCounts())
  }, [])

  useEffect(() => {
    const scopeEntries = fixtureEntries.filter((entry) =>
      currentContent.infoFrom === "category"
        ? entry.feed.category.id === Number(currentContent.infoId)
        : currentContent.infoFrom === "feed"
          ? entry.feed.id === Number(currentContent.infoId)
          : true,
    )
    const visibleEntriesForScope = scopeEntries.filter(
      (entry) => showHiddenFeeds || !entry.feed.hide_globally,
    )
    contentState.setKey(
      "entries",
      currentSettings.showStatus === "unread"
        ? visibleEntriesForScope.filter((entry) => entry.status === "unread")
        : visibleEntriesForScope,
    )
  }, [
    currentContent.articleListRevision,
    currentContent.infoFrom,
    currentContent.infoId,
    currentSettings.showStatus,
  ])

  const unreadCounts = currentData.unreadInfo
  const visibleEntries = fixtureEntries.filter(
    (entry) => showHiddenFeeds || !entry.feed.hide_globally,
  )
  const listEntries = currentContent.entries
  return (
    <AppDataContext.Provider value={{ refreshCounts, refreshFeedData }}>
      <ConfigProvider locale={enUS}>
        <MemoryRouter initialEntries={[initialPath]}>
          <LocationProbe />
          <output data-testid="mutation-state">{report.mutationState}</output>
          <output data-testid="mutation-count">{report.mutationCount}</output>
          <output data-testid="refresh-count">{refreshCount}</output>
          <output data-testid="mutation-entry-ids">
            {report.lastMutationBody ? JSON.parse(report.lastMutationBody).entry_ids.join(",") : ""}
          </output>
          <output data-testid="mutation-bodies">{report.lastMutationBody ?? "[]"}</output>
          <output data-testid="mutation-log">{report.mutationLog ?? "[]"}</output>
          <output data-testid="feed-11-unread">{unreadCounts[11]}</output>
          <output data-testid="feed-12-unread">{unreadCounts[12]}</output>
          <output data-testid="feed-21-unread">{unreadCounts[21]}</output>
          <output data-testid="visible-unread-count">
            {visibleEntries.filter((entry) => entry.status === "unread").length}
          </output>
          <output data-testid="current-list-ids">
            {listEntries.map((entry) => entry.id).join(",")}
          </output>
          <output data-testid="current-list-statuses">
            {listEntries.map((entry) => `${entry.id}:${entry.status}`).join(",")}
          </output>
          <output data-testid="last-source-query">{report.lastSourceQuery ?? ""}</output>
          <div style={{ display: "flex", height: "100%" }}>
            <div style={{ width: 360, height: "100%", flex: "none" }}>
              <Sidebar />
            </div>
            <section style={{ flex: 1, minWidth: 0, position: "relative" }}>
              <RoutedFooter />
            </section>
          </div>
        </MemoryRouter>
      </ConfigProvider>
    </AppDataContext.Provider>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
