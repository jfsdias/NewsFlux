/* eslint-disable react-refresh/only-export-components -- The fixture is a browser entrypoint, not a hot-reload module. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Notification } from "@arco-design/web-react"
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

const searchParams = new URLSearchParams(location.search)
const source = searchParams.get("source") ?? "feed"
const status = searchParams.get("status") ?? "unread"
const shouldFail = searchParams.get("fail") === "1"
const skipConfirmation = searchParams.get("skip") === "1"
const jumpToNext = searchParams.get("jump") === "1"
const sourceId = ["feed", "category"].includes(source) ? 1 : null
const category = { id: 1, title: "Fixture category", hide_globally: false }
const secondCategory = { id: 2, title: "Next category", hide_globally: false }
const feeds = [
  {
    id: 1,
    title: "Current fixture feed",
    category,
    hide_globally: false,
    site_url: "https://example.invalid/current",
  },
  {
    id: 2,
    title: "Next fixture feed",
    category: secondCategory,
    hide_globally: false,
    site_url: "https://example.invalid/next",
  },
]
let fixtureEntries = [
  {
    id: 101,
    feed: feeds[0],
    status: "unread",
    starred: status === "starred",
  },
  {
    id: 102,
    feed: feeds[0],
    status: "unread",
    starred: status === "starred",
  },
]
let reportState = () => {}
let mutationCount = 0

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
replaceSettings({
  ...getDefaultSettings(),
  markAllReadJumpToNext: jumpToNext,
  showStatus: status,
  skipMarkAllReadConfirmation: skipConfirmation,
})
dataState.set({
  ...dataState.get(),
  feedsData: feeds,
  categoriesData: [category, secondCategory],
  unreadInfo: { 1: fixtureEntries.length, 2: 1 },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})
contentState.set({
  ...contentState.get(),
  entries: fixtureEntries,
  infoFrom: source,
  infoId: sourceId,
  isArticleListReady: true,
})

apiClient.put = async (_url, body) => {
  mutationCount += 1
  reportState({ mutation: "running", mutationCount })
  if (shouldFail) {
    throw new Error("Fixture mutation failure")
  }
  const ids = new Set(body.entry_ids)
  fixtureEntries = fixtureEntries.map((entry) =>
    ids.has(entry.id) ? { ...entry, status: body.status } : entry,
  )
}

Notification.success = () => {}
Notification.error = () => {}
Notification.warning = () => {}
Notification.remove = () => {}

const entriesAdapter = async (requestedStatus, starred) => ({
  entries: fixtureEntries.filter(
    (entry) =>
      entry.status === requestedStatus &&
      (!starred || entry.starred) &&
      (source !== "feed" || entry.feed.id === sourceId) &&
      (source !== "category" || entry.feed.category.id === sourceId),
  ),
})

const getPath = (currentSource) =>
  ({
    category: "/category/1",
    feed: "/feed/1",
    starred: "/starred",
    today: "/today",
  })[currentSource] ?? "/all"

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
          : "all"
  const routeSourceId = ["feed", "category"].includes(routeSource)
    ? Number(pathname.split("/").at(-1))
    : null

  return (
    <FooterPanel
      key={pathname}
      getEntries={entriesAdapter}
      info={{ from: routeSource, id: routeSourceId }}
      refreshArticleList={async () => reportState({ mutation: "list-refreshed" })}
    />
  )
}

const Harness = () => {
  const [state, setState] = useState({ mutation: "idle", mutationCount: 0, refreshes: 0 })
  const updateReport = useCallback(
    (changes) => setState((previous) => ({ ...previous, ...changes })),
    [],
  )
  useEffect(() => {
    reportState = updateReport
    return () => {
      reportState = () => {}
    }
  }, [updateReport])
  return (
    <main>
      <p data-testid="scenario">
        {source}:{status}:fail={shouldFail}:skip={skipConfirmation}:jump={jumpToNext}
      </p>
      <output data-testid="mutation-state">{state.mutation}</output>
      <output data-testid="mutation-count">{state.mutationCount}</output>
      <output data-testid="refresh-count">{state.refreshes}</output>
      <AppDataContext.Provider
        value={{
          refreshCounts: async () => {
            reportState({ mutation: "reconciled", refreshes: state.refreshes + 1 })
            dataState.setKey("unreadInfo", {
              1: fixtureEntries.filter((entry) => entry.feed.id === 1 && entry.status === "unread")
                .length,
              2: 1,
            })
          },
        }}
      >
        <MemoryRouter initialEntries={[getPath(source)]}>
          <LocationProbe />
          <RoutedFooter />
        </MemoryRouter>
      </AppDataContext.Provider>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
