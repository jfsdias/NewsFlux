/* eslint-disable react-refresh/only-export-components -- This file is a browser test harness. */
import { ConfigProvider, Notification } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import { useStore } from "@nanostores/react"
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation } from "react-router"

import apiClient from "@/apis/ofetch"
import FooterPanel from "@/components/Content/FooterPanel"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings } from "@/store/settingsState"

const params = new URLSearchParams(location.search)
const source = params.get("source") ?? "all"
const showStatus = params.get("status") ?? "unread"
const sourceId = ["feed", "category"].includes(source) ? 1 : null
const filterDate = params.get("date")
const filterString = params.get("search") ?? ""
const failAt = Number(params.get("failAt") ?? 0)
const pageSize = Number(params.get("pageSize") ?? 1000)
const bulkCount = Number(params.get("bulk") ?? 0)
const fixedNow = Date.now()
const nowSeconds = Math.floor(fixedNow / 1000)

const categories = [
  { id: 1, title: "Visible category", hide_globally: false },
  { id: 2, title: "Hidden category", hide_globally: true },
]
const feeds = [
  {
    id: 1,
    title: "Visible feed",
    category: categories[0],
    hide_globally: false,
    site_url: "https://example.invalid/visible",
  },
  {
    id: 2,
    title: "Hidden feed",
    category: categories[1],
    hide_globally: false,
    site_url: "https://example.invalid/hidden",
  },
  {
    id: 3,
    title: "Next visible feed",
    category: categories[0],
    hide_globally: false,
    site_url: "https://example.invalid/next",
  },
]

const makeEntry = (
  id,
  ageDays,
  { status = "unread", starred = false, feed = feeds[0], title } = {},
) => {
  const publishedAt = nowSeconds - Math.round(ageDays * 24 * 60 * 60)
  return {
    id,
    status,
    starred,
    feed,
    title: title ?? `Fixture article ${id}`,
    published_at: publishedAt,
    changed_at: publishedAt,
    created_at: publishedAt,
  }
}

let fixtureEntries = [
  makeEntry(101, 0.5, { title: "Unread Linux fresh" }),
  makeEntry(102, 2, { title: "Unread Linux old" }),
  makeEntry(103, 10, { starred: true, title: "Unread starred older" }),
  makeEntry(104, 40, { starred: true, feed: feeds[1], title: "Unread hidden feed" }),
  makeEntry(105, 40, { status: "read", title: "Read old" }),
  makeEntry(106, 40, { title: "Unread old without search match" }),
]
fixtureEntries = [
  ...fixtureEntries,
  ...Array.from({ length: bulkCount }, (_, index) =>
    makeEntry(10_000 + index, 40, { title: `Bulk old ${index}` }),
  ),
]

const queryLog = []
const putLog = []
const operationLog = []
const notices = []
let reportState = () => {}
let holdNextGet = false
let releaseHeldGet = null

const delayNextGet = () => {
  holdNextGet = true
}
const releaseGet = () => releaseHeldGet?.()
globalThis.__ageReadFixture = {
  delayNextGet,
  getNotices: () => [...notices],
  getOperations: () => [...operationLog],
  getPuts: () => putLog.map((put) => ({ ...put, entry_ids: [...put.entry_ids] })),
  getQueries: () => queryLog.map((query) => ({ ...query, options: { ...query.options } })),
  releaseGet,
}

const routePath = (currentSource) =>
  ({
    category: "/category/1",
    feed: "/feed/1",
    history: "/history",
    starred: "/starred",
    today: "/today",
  })[currentSource] ?? "/all"

const matchesScope = (entry, requestedSource, requestedSourceId) => {
  if (requestedSource === "feed") {
    return entry.feed.id === Number(requestedSourceId)
  }
  if (requestedSource === "category") {
    return entry.feed.category.id === Number(requestedSourceId)
  }
  if (requestedSource === "starred") {
    return entry.starred
  }
  return true
}

const isInsideDateFilter = (entry, date, order) => {
  if (!date) {
    return true
  }
  const start = new Date(`${date}T00:00:00`).getTime() / 1000
  const end = start + 24 * 60 * 60
  const field = order === "changed_at" ? entry.changed_at : entry.published_at
  return field >= start && field < end
}

const getFixtureEntries = async (requestedStatus, starred, options = {}) => {
  queryLog.push({ requestedStatus, starred, options: { ...options } })
  operationLog.push(["get", options.offset ?? 0])
  reportState({
    queryLog: JSON.stringify(queryLog),
    operationLog: JSON.stringify(operationLog),
  })
  if (holdNextGet) {
    holdNextGet = false
    await new Promise((resolve) => {
      releaseHeldGet = () => {
        releaseHeldGet = null
        resolve()
      }
    })
  }

  const cutoff = Number(options.published_before)
  if (Number.isFinite(cutoff)) {
    const boundaryId = -cutoff
    if (!fixtureEntries.some((entry) => entry.id === boundaryId)) {
      fixtureEntries.push({
        ...makeEntry(boundaryId, 0),
        published_at: cutoff,
        changed_at: cutoff,
        created_at: cutoff,
        title: "Cutoff boundary",
      })
    }
  }

  let matches = fixtureEntries.filter((entry) => {
    if (!matchesScope(entry, source, sourceId)) {
      return false
    }
    if (requestedStatus && entry.status !== requestedStatus) {
      return false
    }
    if (starred && !entry.starred) {
      return false
    }
    if (
      options.globally_visible &&
      (entry.feed.hide_globally || entry.feed.category.hide_globally)
    ) {
      return false
    }
    if (options.search && !entry.title.toLowerCase().includes(options.search.toLowerCase())) {
      return false
    }
    if (!isInsideDateFilter(entry, options.filterDate, options.order)) {
      return false
    }
    if (
      Number.isFinite(Number(options.published_after)) &&
      entry.published_at < Number(options.published_after)
    ) {
      return false
    }
    // Deliberately return the exact cutoff too, like an inclusive provider bound, so the client
    // must enforce the approved strict `published_at < cutoff` rule.
    if (Number.isFinite(cutoff) && entry.published_at > cutoff) {
      return false
    }
    return true
  })

  const orderField = options.order ?? "published_at"
  matches.sort((left, right) => {
    const comparison = left[orderField] - right[orderField]
    return options.direction === "asc" ? comparison : -comparison
  })

  const total = matches.length
  const offset = Number(options.offset ?? 0)
  const limit = Number(options.limit ?? pageSize)
  matches = matches.slice(offset, offset + limit)
  return { entries: matches, total }
}

let putCallCount = 0
apiClient.put = async (_url, body) => {
  putCallCount += 1
  const put = { entry_ids: [...body.entry_ids], status: body.status }
  putLog.push(put)
  operationLog.push(["put", putCallCount, ...body.entry_ids])
  reportState({
    operationLog: JSON.stringify(operationLog),
    putLog: JSON.stringify(putLog),
  })
  if (failAt === putCallCount) {
    throw new Error(`Fixture mutation failure ${putCallCount}`)
  }
  const ids = new Set(body.entry_ids)
  fixtureEntries = fixtureEntries.map((entry) =>
    ids.has(entry.id) ? { ...entry, status: body.status } : entry,
  )
}

const recordNotice = (type, notice) => {
  notices.push({ type, title: notice.title })
  reportState({
    notificationLog: JSON.stringify(notices),
    noticeButton: notice.btn ?? null,
    noticeTitle: notice.title ?? "",
  })
}
Notification.success = (notice) => recordNotice("success", notice)
Notification.error = (notice) => recordNotice("error", notice)
Notification.warning = (notice) => recordNotice("warning", notice)
Notification.remove = () => {}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
replaceSettings({
  ...getDefaultSettings(),
  markAllReadJumpToNext: true,
  orderBy: params.get("order") === "created_at" ? "created_at" : "published_at",
  orderDirection: params.get("direction") === "asc" ? "asc" : "desc",
  showHiddenFeeds: false,
  showStatus,
  skipMarkAllReadConfirmation: true,
})
dataState.set({
  ...dataState.get(),
  feedsData: feeds,
  categoriesData: categories,
  unreadInfo: {
    1: fixtureEntries.filter((entry) => entry.feed.id === 1 && entry.status === "unread").length,
    3: 1,
  },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})
contentState.set({
  ...contentState.get(),
  entries: fixtureEntries.slice(0, 5),
  filterDate,
  filterString,
  infoFrom: source,
  infoId: sourceId,
  isArticleListReady: true,
})

const LocationProbe = () => {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

const RoutedFooter = () => {
  const { pathname } = useLocation()
  const routeSource = pathname.startsWith("/feed/")
    ? "feed"
    : pathname.startsWith("/category/")
      ? "category"
      : pathname === "/starred"
        ? "starred"
        : pathname === "/today"
          ? "today"
          : pathname === "/history"
            ? "history"
            : "all"
  const routeSourceId = ["feed", "category"].includes(routeSource)
    ? Number(pathname.split("/").at(-1))
    : null

  return (
    <FooterPanel
      getEntries={getFixtureEntries}
      info={{ from: routeSource, id: routeSourceId }}
      refreshArticleList={async () => {
        const revision = contentState.get().articleListRevision ?? 0
        contentState.setKey("articleListRevision", revision + 1)
        reportState({ listRefreshes: 1 })
      }}
    />
  )
}

const Harness = () => {
  const content = useStore(contentState)
  const [state, setState] = useState({ countsRefreshes: 0, listRefreshes: 0, putLog: "[]" })
  const updateReport = useCallback(
    (changes) => setState((current) => ({ ...current, ...changes })),
    [],
  )
  useEffect(() => {
    reportState = updateReport
    return () => {
      reportState = () => {}
    }
  }, [updateReport])

  return (
    <ConfigProvider locale={enUS}>
      <AppDataContext.Provider
        value={{
          refreshCounts: async () => {
            setState((current) => ({ ...current, countsRefreshes: current.countsRefreshes + 1 }))
            return {}
          },
          refreshFeedData: async () => {},
        }}
      >
        <MemoryRouter initialEntries={[routePath(source)]}>
          <div
            aria-hidden="true"
            className="fixture-readouts"
            style={{ position: "fixed", left: "-10000px", top: 0 }}
          >
            <LocationProbe />
            <output data-testid="query-log">{JSON.stringify(queryLog)}</output>
            <output data-testid="put-log">{state.putLog}</output>
            <output data-testid="notification-log">{state.notificationLog ?? "[]"}</output>
            <output data-testid="operation-log">{state.operationLog ?? "[]"}</output>
            <output data-testid="query-log-state">{state.queryLog ?? "[]"}</output>
            <output data-testid="counts-refreshes">{state.countsRefreshes}</output>
            <output data-testid="article-list-revision">{content.articleListRevision ?? 0}</output>
            <output data-testid="notice-title">{state.noticeTitle ?? ""}</output>
          </div>
          <div
            className="fixture-controls"
            style={{ position: "fixed", top: 0, left: 0, zIndex: 2000 }}
          >
            <button data-testid="hold-next-request" type="button" onClick={delayNextGet}>
              Hold next request
            </button>
            <button data-testid="release-request" type="button" onClick={releaseGet}>
              Release request
            </button>
            <div data-testid="notice-button">{state.noticeButton}</div>
          </div>
          <main
            style={{
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
            }}
          >
            <RoutedFooter />
          </main>
        </MemoryRouter>
      </AppDataContext.Provider>
    </ConfigProvider>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
