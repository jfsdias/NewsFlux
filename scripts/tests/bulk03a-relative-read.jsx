/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import { ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import apiClient from "@/apis/ofetch"
import ArticleEntry from "@/components/Article/ArticleEntry"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings, settingsState } from "@/store/settingsState"
import { markAllReadUndoActions } from "@/utils/mark-all-read-undo"

const params = new URLSearchParams(location.search)
const order = params.get("order") === "asc" ? "asc" : "desc"
const contextMenuEnabled = params.get("ctx") !== "0"
const showStatus = params.get("status") === "unread" ? "unread" : "all"
const failAtCall = Number(params.get("failAt") || 0)
const fillerCount = Number(params.get("filler") || 0)

const feed = { id: 11, title: "Fixture feed", hide_globally: false, category: { id: 5 } }
const makeEntry = (id, title, status, publishedAt) => ({
  id,
  title,
  status,
  starred: false,
  feed,
  published_at: publishedAt,
  changed_at: publishedAt,
  content: `<p>${title}</p>`,
  url: `https://example.invalid/${id}`,
})

// Ids and timestamps are deliberately NOT aligned with display order for the scrambled fixture.
const baseRows = [
  makeEntry(101, "Row A", "unread", "2026-10-05T00:00:00Z"),
  makeEntry(102, "Row B", "read", "2026-10-04T00:00:00Z"),
  makeEntry(103, "Row C anchor", "unread", "2026-10-03T00:00:00Z"),
  makeEntry(104, "Row D", "unread", "2026-10-02T00:00:00Z"),
  makeEntry(105, "Row E", "read", "2026-10-01T00:00:00Z"),
]
const fillerRows = Array.from({ length: fillerCount }, (_, index) =>
  makeEntry(1000 + index, `Filler ${index}`, "unread", "2026-09-01T00:00:00Z"),
)
const initialRows = [...baseRows, ...fillerRows]
let fixtureEntries = order === "asc" ? initialRows.toReversed() : initialRows

const putCalls = []
const otherCalls = []
let putCallCount = 0
let delayNextPut = false
let releasePendingPut = null
let reportState = () => {}

const recordOther = (method) => async (url) => {
  otherCalls.push(`${method} ${url}`)
  throw new Error(`Unexpected fixture ${method}: ${url}`)
}
apiClient.get = recordOther("GET")
apiClient.post = recordOther("POST")
apiClient.raw = recordOther("RAW")
apiClient.put = async (url, body) => {
  if (url !== "/v1/entries") {
    otherCalls.push(`PUT ${url}`)
    throw new Error(`Unexpected fixture PUT: ${url}`)
  }
  putCallCount += 1
  putCalls.push({ entry_ids: [...body.entry_ids], status: body.status, starred: body.starred })
  reportState({ putLog: JSON.stringify(putCalls) })
  if (delayNextPut) {
    delayNextPut = false
    await new Promise((resolve) => {
      releasePendingPut = () => {
        releasePendingPut = null
        resolve()
      }
    })
  }
  if (failAtCall > 0 && putCallCount === failAtCall) {
    throw new Error("Fixture mutation failure")
  }
  const ids = new Set(body.entry_ids)
  fixtureEntries = fixtureEntries.map((entry) =>
    ids.has(entry.id) ? { ...entry, status: body.status } : entry,
  )
}

globalThis.__delayNextPut = () => {
  delayNextPut = true
}
globalThis.__releasePendingPut = () => releasePendingPut?.()
globalThis.__getUndoToken = () => markAllReadUndoActions.getCurrentToken()
globalThis.__bumpSession = () =>
  dataState.setKey("sessionRevision", dataState.get().sessionRevision + 1)
globalThis.__otherCalls = () => [...otherCalls]
globalThis.__putCalls = () => putCalls.map((call) => ({ ...call }))

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "", token: "", username: "", password: "" })
replaceSettings({
  ...getDefaultSettings(),
  enableContextMenu: contextMenuEnabled,
  markReadOnScroll: false,
  showStatus,
})
dataState.set({ ...dataState.get(), unreadInfo: { 11: 0 }, currentUser: { id: 1 } })
contentState.set({
  ...contentState.get(),
  entries: fixtureEntries,
  infoFrom: "feed",
  infoId: 11,
  isArticleListReady: true,
  total: fixtureEntries.length,
})

const articleActivation = {
  getPrimaryLinkProps: () => ({ href: "#" }),
  openInReactFlux: () => {},
  opensSourceOnCardClick: false,
}
const Presenter = ({ entry }) => <span className="fixture-title">{entry.title}</span>
const noop = () => {}
const observeRead = () => noop

const Harness = () => {
  const [report, setReport] = useState({})
  const [refreshCount, setRefreshCount] = useState(0)
  const content = useStore(contentState)
  const updateReport = useCallback((changes) => setReport((prev) => ({ ...prev, ...changes })), [])
  useEffect(() => {
    reportState = updateReport
    return () => {
      reportState = () => {}
    }
  }, [updateReport])

  const refreshCounts = useCallback(async () => {
    setRefreshCount((previous) => previous + 1)
    return {}
  }, [])
  const refreshFeedData = useCallback(async () => {}, [])

  // Emulates the list refetch that invalidateArticleList triggers in the real app.
  useEffect(() => {
    if (content.articleListRevision === 0 || content.articleListRevision === undefined) {
      return
    }
    contentState.setKey(
      "entries",
      showStatus === "unread"
        ? fixtureEntries.filter((entry) => entry.status === "unread")
        : fixtureEntries,
    )
  }, [content.articleListRevision])

  const visibleRows = content.entries.slice(0, 5)
  return (
    <AppDataContext.Provider value={{ refreshCounts, refreshFeedData }}>
      <ConfigProvider locale={enUS}>
        <output data-testid="put-log">{report.putLog ?? "[]"}</output>
        <output data-testid="refresh-count">{refreshCount}</output>
        <output data-testid="list-revision">{content.articleListRevision ?? 0}</output>
        <output data-testid="list-statuses">
          {content.entries
            .slice(0, 5)
            .map((entry) => `${entry.id}:${entry.status}`)
            .join(",")}
        </output>
        <main style={{ maxWidth: 720, margin: "0 auto", padding: 8 }}>
          {visibleRows.map((entry) => (
            <ArticleEntry
              key={entry.id}
              articleActivation={articleActivation}
              entry={entry}
              layout="list"
              observeRead={observeRead}
              presenter={Presenter}
            />
          ))}
        </main>
      </ConfigProvider>
    </AppDataContext.Provider>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
