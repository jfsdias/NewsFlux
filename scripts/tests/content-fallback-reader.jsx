/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes, useNavigate } from "react-router"

import { fingerprintArticleUrl } from "@/apis/content-fallback-reader"
import ArticleDetail from "@/components/Article/ArticleDetail"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { defaultIcon, feedIconsState } from "@/store/feedIconsState"
import { settingsState } from "@/store/settingsState"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/theme.css"
import "@/liquid-glass.css"
import "@/App.css"
import "@/components/Article/ArticleDetail.css"
import "@/components/Article/ReaderStyles.css"
import "@/components/Article/littlefoot.css"
import "@/components/Content/Content.css"

const mode = new URLSearchParams(location.search).get("mode") ?? "success"
const articleSummaryMode = new URLSearchParams(location.search).get("article_summary")
const polyglot = new Polyglot({ phrases, locale: "en-US" })
polyglotState.set({ polyglot })

const feed = {
  id: 12,
  title: "Synthetic feed",
  icon: { icon_id: 1 },
  site_url: "https://publisher.example",
  feed_url: "https://publisher.example/feed.xml",
  category: { id: 4, title: "Synthetic category" },
}
feedIconsState.setKey(1, defaultIcon)
const firstEntry = {
  id: 501,
  title: "Synthetic recovery article",
  status: "unread",
  starred: true,
  feed,
  author: "Synthetic author",
  published_at: "2026-11-01T12:00:00.000Z",
  reading_time: 3,
  content: "<p>Original Miniflux body stays visible on failure.</p>",
  url: "https://publisher.example/story-501",
  attachments: { items: [], primaryMedia: null },
}
const secondEntry = {
  ...firstEntry,
  id: 502,
  title: "Second synthetic article",
  content: "<p>Original body for entry 502.</p>",
  url: "https://publisher.example/story-502",
}

authState.set({
  server: "https://miniflux.example",
  token: "synthetic-user-api-key",
  apiKeyId: 9,
  username: "synthetic-user",
  password: "",
})
settingsState.set({ ...settingsState.get(), markReadBy: "manually" })
dataState.set({ ...dataState.get(), sessionRevision: 4 })
contentState.set({
  ...contentState.get(),
  activeContent: firstEntry,
  entries: [firstEntry, secondEntry],
  infoFrom: "all",
  isArticleLoading: false,
})

let pendingResolve = null
let pendingSummaryResolve = null
const requestLedger = []
const otherRequestLedger = []
const articleSummaryLedger = []
const responseFor = async (entry = firstEntry, changes = {}) => ({
  status: "recovered",
  entry_id: entry.id,
  url_fingerprint: await fingerprintArticleUrl(entry.url),
  content_html: "<p>Recovered synthetic full text.</p><p>Second safe paragraph.</p>",
  content_origin: "wallhop",
  validation: { state: "SUFFICIENT", word_count: 190, sentence_count: 6, paragraph_count: 4 },
  provenance: { provider: "wallhop.io", fetched_at: "2026-11-01T12:00:00+00:00" },
  ...changes,
})

globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url)
  if (requestUrl.includes("/api/ai/v1/entries/")) {
    articleSummaryLedger.push({
      path: requestUrl,
      method: String(options.method ?? "GET").toUpperCase(),
      headerNames: Object.keys(options.headers ?? {}).toSorted(),
      bodyKeys: Object.keys(JSON.parse(options.body ?? "{}")).toSorted(),
    })
    report()
    const requestId = JSON.parse(options.body).request_id
    const payload = {
      schema_version: "1",
      request_id: requestId,
      entry_id: Number(requestUrl.match(/entries\/(\d+)/)?.[1]),
      status: "partial",
      content_scope: "unknown",
      summary: "Synthetic AI summary for the current article.",
      summary_paragraph_ids: ["p1"],
      key_points: [{ text: "Synthetic grounded key point.", paragraph_ids: ["p1"] }],
      action_points: [],
      limitations: ["Only the available Miniflux text was summarized."],
      provenance: {
        content_origin: "miniflux",
        content_fingerprint: "a".repeat(64),
        provider_id: "litellm",
        deployment_id: "s5-free",
        effective_model_id: "synthetic-s5-free",
        prompt_version: "summary-v1",
      },
    }
    if (articleSummaryMode === "retry" && articleSummaryLedger.length === 1) {
      return Response.json(
        {
          schema_version: "1",
          request_id: requestId,
          error: { code: "SUMMARY_BUSY", retryable: true },
        },
        { status: 429 },
      )
    }
    if (["stale", "loading"].includes(articleSummaryMode)) {
      return new Promise((resolve) => {
        pendingSummaryResolve = () => resolve(Response.json(payload, { status: 200 }))
      })
    }
    return Response.json(payload, { status: 200 })
  }
  if (!requestUrl.includes("/reader/v1/entries/")) {
    otherRequestLedger.push({
      url: requestUrl,
      method: String(options.method ?? "GET").toUpperCase(),
    })
    return Response.json({})
  }
  requestLedger.push({ url: String(url), ...options, headers: { ...options.headers } })
  if (mode === "failure") {
    throw new TypeError("Synthetic network failure")
  }
  if (mode === "malformed") {
    return new Response("{invalid", {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  if (mode === "http-error") {
    return new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } })
  }
  const body = await responseFor(
    firstEntry,
    mode === "wrong-entry"
      ? { entry_id: 777 }
      : mode === "wrong-fingerprint"
        ? { url_fingerprint: "0".repeat(64) }
        : mode === "insufficient"
          ? { status: "incomplete", validation: { state: "INSUFFICIENT" } }
          : {},
  )
  if (["stale", "session-stale", "logout"].includes(mode)) {
    return new Promise((resolve) => {
      pendingResolve = () => resolve(Response.json(body, { status: 200 }))
    })
  }
  return Response.json(body, { status: 200 })
}

const results = {}
const report = () => {
  const output = document.querySelector("[data-testid='reader-recovery-report']")
  const minifluxWrites = otherRequestLedger.filter((request) =>
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method),
  ).length
  output.textContent = JSON.stringify({
    mode,
    results,
    requestCount: requestLedger.length,
    articleSummaryRequestCount: articleSummaryLedger.length,
    minifluxWrites,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
  })
  output.dataset.status = Object.values(results).every(Boolean) ? "pass" : "fail"
  globalThis.__contentFallbackReaderReport = {
    mode,
    results: { ...results },
    requests: requestLedger.map(({ headers, ...request }) => ({
      ...request,
      headerNames: Object.keys(headers ?? {}).toSorted(),
    })),
    articleSummaryRequests: articleSummaryLedger.map((request) => ({ ...request })),
    minifluxWrites,
  }
}

const waitFor = async (predicate, timeoutMs = 3000) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

const driveChecks = async () => {
  const originalVisible = document.body.textContent.includes(
    "Original Miniflux body stays visible on failure.",
  )
  const action = document.querySelector(".reader-content-recovery__action")
  results.NO_HORIZONTAL_OVERFLOW = document.documentElement.scrollWidth <= window.innerWidth
  results.READ_STAR_STATE_PRESERVED =
    contentState.get().activeContent?.status === "unread" &&
    contentState.get().activeContent?.starred === true
  if (articleSummaryMode) {
    const summaryAction = document.querySelector(".article-intelligence-summary__action")
    results.ORIGINAL_CONTENT_VISIBLE = originalVisible
    results.SUMMARY_ACTION_PRESENT = Boolean(summaryAction)
    results.SUMMARY_ACTION_ACCESSIBLE =
      summaryAction?.tagName === "BUTTON" &&
      summaryAction.textContent.trim() === "Summarize with AI"
    results.NO_SUMMARY_BEFORE_ACTIVATION = articleSummaryLedger.length === 0
    results.NO_HORIZONTAL_OVERFLOW = document.documentElement.scrollWidth <= window.innerWidth
    results.READ_STAR_STATE_PRESERVED =
      contentState.get().activeContent?.status === "unread" &&
      contentState.get().activeContent?.starred === true
    globalThis.__articleIntelligenceHarness?.ready?.()
    report()
    return
  }
  if (mode === "disabled") {
    results.ORIGINAL_CONTENT_VISIBLE = originalVisible
    results.RECOVERY_ACTION_ABSENT = action === null
    results.NO_REQUESTS = requestLedger.length === 0
    report()
    return
  }

  results.ORIGINAL_CONTENT_VISIBLE = originalVisible
  results.EXPLICIT_ACTION_PRESENT = Boolean(action)
  if (!action) {
    report()
    return
  }

  if (mode === "interactive") {
    results.NATIVE_BUTTON_AND_ACCESSIBLE_NAME =
      action.tagName === "BUTTON" && action.textContent.trim() === "Recover full text"
    results.NO_RECOVERY_BEFORE_ACTIVATION = requestLedger.length === 0
    action.addEventListener(
      "click",
      async () => {
        results.KEYBOARD_ACTIVATION_RECOVERS = await waitFor(() =>
          document.body.textContent.includes("Recovered synthetic full text."),
        )
        results.MINIFLUX_WRITES_ZERO = otherRequestLedger.every(
          (request) => !["POST", "PUT", "PATCH", "DELETE"].includes(request.method),
        )
        report()
      },
      { once: true },
    )
    report()
    return
  }

  action.click()
  action.click()
  if (mode === "stale") {
    const requestStarted = await waitFor(() => requestLedger.length > 0 && Boolean(pendingResolve))
    results.REQUEST_STARTED_ONCE = requestStarted && requestLedger.length === 1
    document.querySelector("[data-testid='navigate-other']").click()
    const secondArticleLoaded = await waitFor(() =>
      document.body.textContent.includes("Original body for entry 502."),
    )
    pendingResolve?.()
    await new Promise((resolve) => setTimeout(resolve, 100))
    results.NAVIGATION_CONTENT_PRESERVED =
      secondArticleLoaded && document.body.textContent.includes("Original body for entry 502.")
    results.STALE_RESPONSE_NOT_DISPLAYED = !document.body.textContent.includes(
      "Recovered synthetic full text.",
    )
    report()
    return
  }

  if (mode === "session-stale" || mode === "logout") {
    const requestStarted = await waitFor(() => requestLedger.length > 0 && Boolean(pendingResolve))
    results.REQUEST_STARTED_ONCE = requestStarted && requestLedger.length === 1
    if (mode === "session-stale") {
      dataState.set({ ...dataState.get(), sessionRevision: 5 })
    } else {
      authState.set({ ...authState.get(), token: "", apiKeyId: null })
    }
    pendingResolve?.()
    await new Promise((resolve) => setTimeout(resolve, 100))
    results.STALE_RESPONSE_NOT_DISPLAYED =
      document.body.textContent.includes("Original Miniflux body stays visible on failure.") &&
      !document.body.textContent.includes("Recovered synthetic full text.")
    report()
    return
  }

  if (
    [
      "failure",
      "wrong-entry",
      "wrong-fingerprint",
      "insufficient",
      "malformed",
      "http-error",
    ].includes(mode)
  ) {
    const failureVisible = await waitFor(() =>
      document.body.textContent.includes("original content is still shown"),
    )
    results.FAILURE_KEEPS_ORIGINAL =
      failureVisible &&
      document.body.textContent.includes("Original Miniflux body stays visible on failure.")
    results.NO_RECOVERED_BODY = !document.body.textContent.includes(
      "Recovered synthetic full text.",
    )
    results.MINIFLUX_WRITES_ZERO = otherRequestLedger.every(
      (request) => !["POST", "PUT", "PATCH", "DELETE"].includes(request.method),
    )
    report()
    return
  }

  const recovered = await waitFor(() =>
    document.body.textContent.includes("Recovered synthetic full text."),
  )
  results.RECOVERED_BODY_DISPLAYED = recovered
  results.ORIGINAL_MINIFLUX_RECORD_UNCHANGED = firstEntry.content.includes("Original Miniflux body")
  results.SINGLE_REQUEST_NO_RETRY = requestLedger.length === 1
  const request = requestLedger[0]
  results.NO_COOKIES_OR_SERVICE_TOKEN =
    request?.credentials === "omit" &&
    request?.headers?.Authorization === undefined &&
    request?.headers?.["X-Miniflux-API-Key"] === "synthetic-user-api-key" &&
    !JSON.stringify(request).includes("synthetic-internal-service-token")
  results.MINIFLUX_WRITES_ZERO = otherRequestLedger.every(
    (request) => !["POST", "PUT", "PATCH", "DELETE"].includes(request.method),
  )
  results.READ_STAR_STATE_PRESERVED =
    contentState.get().activeContent?.status === "unread" &&
    contentState.get().activeContent?.starred === true
  results.SOURCE_LABEL_SHOWN = document.body.textContent.includes(
    "Full text recovered from WallHop",
  )
  report()
}

const NavigateControls = () => {
  const navigate = useNavigate()
  useEffect(() => {
    globalThis.__articleIntelligenceHarness = {
      ready: () => {},
      navigateToOther: () => {
        setActiveContent(secondEntry)
        navigate("/all/entry/502")
      },
      resolvePendingSummary: () => pendingSummaryResolve?.(),
      changeSession: () => {
        dataState.set({ ...dataState.get(), sessionRevision: 5 })
        authState.set({ ...authState.get(), token: "synthetic-rotated-user-api-key" })
      },
      summaryRequests: () => articleSummaryLedger.map((request) => ({ ...request })),
    }
    return () => {
      delete globalThis.__articleIntelligenceHarness
    }
  }, [navigate])
  return (
    <button
      hidden
      data-testid="navigate-other"
      type="button"
      onClick={() => {
        setActiveContent(secondEntry)
        navigate("/all/entry/502")
      }}
    >
      Navigate
    </button>
  )
}

const readerCommands = {
  canNavigateNext: true,
  canNavigatePrevious: true,
  exitDetailView: () => {},
  isResolving: false,
  navigateToNextArticle: () => {},
  navigateToPreviousArticle: () => {},
}

const HarnessPage = () => (
  <AppDataContext.Provider
    value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
  >
    <DesktopSidebarContext.Provider value={{ detailCloseButtonRef: { current: null } }}>
      <ReaderCommandsContext.Provider value={readerCommands}>
        <ContextProvider>
          <NavigateControls />
          <div className="article-container article-container-full-size content-wrapper">
            <ArticleDetail />
          </div>
          <aside hidden aria-label="Content Fallback Reader report">
            <h2>Content Fallback Reader gate</h2>
            <output data-testid="reader-recovery-report">RUNNING</output>
          </aside>
        </ContextProvider>
      </ReaderCommandsContext.Provider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>
)

createRoot(document.querySelector("#root")).render(
  <MemoryRouter initialEntries={["/all/entry/501"]}>
    <Routes>
      <Route element={<HarnessPage />} path="/all/entry/:entryId" />
    </Routes>
  </MemoryRouter>,
)

requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => void driveChecks(), 300)))
