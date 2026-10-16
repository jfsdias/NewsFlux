import "@arco-design/web-react/es/_util/react-19-adapter"
/* eslint-disable react-refresh/only-export-components -- Standalone browser validation harness. */
import { useStore } from "@nanostores/react"
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"

import * as entriesApi from "@/apis/entries"
import apiClient from "@/apis/ofetch"
import useArticleList from "@/hooks/useArticleList"
import useLoadMore from "@/hooks/useLoadMore"
import {
  contentState,
  setActiveContent,
  setArticleListSource,
  setFilterDate,
  setFilterString,
} from "@/store/contentState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import {
  isArticleListDateFilterActive,
  isArticleListDateFilterVisible,
} from "@/utils/article-list-filter-scope"
import { get24HoursAgoTimestamp } from "@/utils/date"

const requests = []
const controls = { current: null }
apiClient.get = async (url) => {
  requests.push(url)
  return { entries: [], total: 0 }
}

const getAdapter = (from, id) => {
  switch (from) {
    case "feed": {
      return (status, starred, filters) => entriesApi.getFeedEntries(id, status, starred, filters)
    }
    case "category": {
      return (status, starred, filters) =>
        entriesApi.getCategoryEntries(id, status, starred, filters)
    }
    case "today": {
      return (status, _starred, filters) => entriesApi.getTodayEntries(status, filters)
    }
    case "home": {
      return entriesApi.getHomeEntries
    }
    default: {
      return (status, starred, filters) => entriesApi.getAllEntries(status, filters)
    }
  }
}

const Probe = ({ scope, setScope }) => {
  const { filterDate } = useStore(contentState, { keys: ["filterDate"] })
  const adapter = useMemo(() => getAdapter(scope.from, scope.id), [scope.from, scope.id])
  const list = useArticleList(scope.from, scope.id, adapter)
  const pagination = useLoadMore()

  useEffect(() => {
    setArticleListSource({ from: scope.from, id: scope.id })
  }, [scope.from, scope.id])

  useLayoutEffect(() => {
    controls.current = {
      fetchArticleList: list.fetchArticleList,
      loadMore: () => pagination.handleLoadMore(adapter),
      setScope,
    }
  })

  return (
    <section>
      <output data-testid="active-source">{`${scope.from}:${scope.id ?? ""}`}</output>
      <output data-testid="date-visible">
        {String(isArticleListDateFilterVisible({ from: scope.from }))}
      </output>
      <output data-testid="date-active">
        {String(
          isArticleListDateFilterActive({
            from: scope.from,
            filterDate,
          }),
        )}
      </output>
    </section>
  )
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 30))
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await delay()
  }
  throw new Error("FILTER-01B harness timed out")
}
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const params = (url) => new URL(url, globalThis.location.origin).searchParams
const assertRenderedDateState = ({ visible, active }) => {
  assert(
    document.querySelector('[data-testid="date-visible"]')?.textContent === String(visible),
    `DateFilter visibility should be ${visible}`,
  )
  assert(
    document.querySelector('[data-testid="date-active"]')?.textContent === String(active),
    `DateFilter active state should be ${active}`,
  )
}
const results = []
const setQueryAndWait = async (query) => {
  const previousCount = requests.length
  setFilterString(query)
  await waitFor(() => requests.length > previousCount && contentState.get().isArticleListReady)
  assert(contentState.get().filterDate === "2026-10-10", "search transition cleared the date")
  assert(params(requests.at(-1)).has("published_after"), "search request lost its date")
}

const Harness = () => {
  const [scope, setScope] = useState({ from: "feed", id: 1 })
  const [running, setRunning] = useState(false)
  const [runResults, setRunResults] = useState([])

  const runGate = async (name, action) => {
    try {
      await action()
      results.push({ name, status: "PASS" })
    } catch (error) {
      results.push({ name, status: "FAIL", error: error.message })
    }
    setRunResults([...results])
  }

  const run = async () => {
    setRunning(true)
    results.length = 0
    setRunResults([])
    requests.length = 0
    settingsState.set({
      ...getDefaultSettings(),
      showStatus: "unread",
      orderBy: "published_at",
      orderDirection: "desc",
    })
    const currentContent = contentState.get()
    const currentScope = { from: currentContent.infoFrom, id: currentContent.infoId }
    contentState.set({
      ...currentContent,
      activeContent: null,
      articleListError: false,
      articleListRevision: currentContent.articleListRevision + 1,
      entries: [],
      filterDate: null,
      filterString: "",
      isArticleListReady: false,
      loadMoreError: false,
      loadMoreVisible: false,
      total: 0,
    })
    setScope(currentScope)
    await waitFor(() => contentState.get().isArticleListReady && requests.length > 0)

    const navigate = async (nextScope) => {
      const previousCount = requests.length
      controls.current.setScope(nextScope)
      await waitFor(
        () =>
          contentState.get().infoFrom === nextScope.from &&
          String(contentState.get().infoId ?? "") === String(nextScope.id ?? "") &&
          requests.length > previousCount &&
          contentState.get().isArticleListReady,
      )
      return requests.slice(previousCount)
    }
    if (currentScope.from !== "feed" || String(currentScope.id ?? "") !== "1") {
      await navigate({ from: "feed", id: 1 })
    }
    const initialRequestCount = requests.length
    contentState.set({
      ...contentState.get(),
      filterDate: "2026-10-10",
      filterString: "linux",
    })
    await waitFor(
      () => requests.length > initialRequestCount && contentState.get().isArticleListReady,
    )

    await runGate("INITIAL_FEED_DATE_AND_SEARCH", async () => {
      const initialFeedRequests = requests
        .slice(initialRequestCount)
        .filter((url) => url.startsWith("/v1/feeds/1/entries?"))
      const initialFeedRequest = initialFeedRequests.at(-1)
      assert(initialFeedRequest, "initial Feed A request missing")
      assert(params(initialFeedRequest).has("published_after"), "initial date filter missing")
      assert(params(initialFeedRequest).get("search") === "linux", "initial search missing")
      assertRenderedDateState({ visible: true, active: true })
    })

    const seedFilters = async () => {
      const previousCount = requests.length
      contentState.set({
        ...contentState.get(),
        filterDate: "2026-10-10",
        filterString: "linux",
      })
      await waitFor(() => requests.length > previousCount && contentState.get().isArticleListReady)
    }
    const assertDateCleared = (newRequests) => {
      assert(contentState.get().filterDate === null, "filterDate remained after source transition")
      assert(contentState.get().filterString === "", "search remained after source transition")
      assert(
        newRequests.every((url) => !params(url).has("published_after")),
        "date leaked to request",
      )
      assert(
        newRequests.every((url) => !params(url).has("search")),
        "search leaked to request",
      )
    }

    await runGate("DATE_FEED_TO_FEED_RESET", async () => {
      const newRequests = await navigate({ from: "feed", id: 2 })
      assertDateCleared(newRequests)
      assertRenderedDateState({ visible: true, active: false })
    })

    await runGate("DATE_FEED_TO_CATEGORY_RESET", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "category", id: 1 })
      assertDateCleared(newRequests)
    })

    await runGate("DATE_CATEGORY_TO_FEED_RESET", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "feed", id: 2 })
      assertDateCleared(newRequests)
    })

    await runGate("DATE_FEED_TO_ALL_RESET", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "all", id: null })
      assertDateCleared(newRequests)
    })

    await runGate("DATE_ALL_TO_FEED_RESET", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "feed", id: 1 })
      assertDateCleared(newRequests)
    })

    await runGate("DATE_STATUS_CHANGE_PRESERVE_AND_SEARCH_RESET", async () => {
      setFilterDate("2026-10-10")
      setFilterString("linux")
      await waitFor(() => contentState.get().isArticleListReady)
      const previousCount = requests.length
      settingsState.set({ ...settingsState.get(), showStatus: "all" })
      await waitFor(() => requests.length > previousCount && contentState.get().isArticleListReady)
      const lastRequest = params(requests.at(-1))
      assert(contentState.get().filterDate === "2026-10-10", "status change cleared the date")
      assert(contentState.get().filterString === "", "FILTER-01A status search reset changed")
      assertRenderedDateState({ visible: true, active: true })
      assert(lastRequest.has("published_after"), "status request lost its date filter")
      assert(!lastRequest.has("search"), "status request retained the old search")
    })

    await runGate("DATE_SEARCH_CHANGE_AND_CLEAR_PRESERVE", async () => {
      await setQueryAndWait("camera")
      await setQueryAndWait("")
    })

    await runGate("DATE_READER_RETURN_PRESERVE", async () => {
      const active = { id: 1, status: "read" }
      setActiveContent(active)
      setActiveContent(null)
      assert(contentState.get().filterDate === "2026-10-10", "reader return cleared date")
    })

    await runGate("DATE_REFRESH_PAGINATION_AND_SORT_PRESERVE", async () => {
      const previousCount = requests.length
      await controls.current.fetchArticleList()
      await waitFor(() => requests.length > previousCount && contentState.get().isArticleListReady)
      assert(params(requests.at(-1)).has("published_after"), "refresh lost the date filter")
      const beforeMore = requests.length
      await controls.current.loadMore()
      assert(requests.length > beforeMore, "pagination request did not run")
      assert(params(requests.at(-1)).has("published_after"), "pagination lost the date filter")
      const beforeSort = requests.length
      settingsState.set({ ...settingsState.get(), orderDirection: "asc" })
      await waitFor(() => requests.length > beforeSort && contentState.get().isArticleListReady)
      assert(contentState.get().filterDate === "2026-10-10", "sort change cleared the date")
      assert(params(requests.at(-1)).has("published_after"), "sort request lost the date filter")
    })

    await runGate("DATE_ENTER_TODAY_AND_HIDDEN_STATE_INVARIANT", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "today", id: null })
      assert(contentState.get().filterDate === null, "filterDate remained after source transition")
      assert(contentState.get().filterString === "", "search remained after source transition")
      assert(
        newRequests.every((url) => !params(url).has("search")),
        "search leaked to Today request",
      )
      const todayRequest = params(newRequests.at(-1))
      const expectedTodayStart = get24HoursAgoTimestamp()
      const actualTodayStart = Number(todayRequest.get("published_after"))
      assert(
        Number.isFinite(actualTodayStart) && Math.abs(actualTodayStart - expectedTodayStart) <= 2,
        "Today request did not retain its canonical 24-hour source window",
      )
      assert(
        !todayRequest.has("published_before"),
        "non-today date range leaked into Today request",
      )
      assert(
        !isArticleListDateFilterVisible({ from: "today" }),
        "Today unexpectedly exposes a DateFilter control",
      )
      assertRenderedDateState({ visible: false, active: false })
      setFilterDate("2026-10-11")
      assert(contentState.get().filterDate === null, "Today accepted hidden date state")
    })

    await runGate("DATE_LEAVE_TODAY_NO_RESURRECTION", async () => {
      const newRequests = await navigate({ from: "feed", id: 2 })
      assert(contentState.get().filterDate === null, "date resurrected after leaving Today")
      assert(
        newRequests.every((url) => !params(url).has("published_after")),
        "Today date leaked",
      )
    })

    await runGate("DATE_ENTER_HOME_AND_HOME_NO_HIDDEN_STATE", async () => {
      await seedFilters()
      const newRequests = await navigate({ from: "home", id: null })
      assertDateCleared(newRequests)
      assert(
        !isArticleListDateFilterVisible({ from: "home" }),
        "Home unexpectedly exposes DateFilter",
      )
      assertRenderedDateState({ visible: false, active: false })
      setFilterDate("2026-10-11")
      assert(contentState.get().filterDate === null, "Home accepted hidden date state")
    })

    await runGate("DATE_HOME_TO_ALL_HANDOFF", async () => {
      setFilterString("handoff query")
      const newRequests = await navigate({ from: "all", id: null })
      assert(contentState.get().filterDate === null, "Home→All restored a prior date")
      assert(
        contentState.get().filterString === "handoff query",
        "FILTER-01A Home search handoff lost",
      )
      assert(
        newRequests.every((url) => !params(url).has("published_after")),
        "Home date leaked",
      )
      assert(
        newRequests.some((url) => params(url).get("search") === "handoff query"),
        "search handoff request missing",
      )
    })

    await runGate("DATE_CLEAR_CURRENT_SCOPE_AND_VISIBLE_PARITY", async () => {
      let previousCount = requests.length
      setFilterDate("2026-10-10")
      await waitFor(() => requests.length > previousCount && contentState.get().isArticleListReady)
      assert(isArticleListDateFilterActive({ from: "all", filterDate: "2026-10-10" }))
      previousCount = requests.length
      setFilterDate(null)
      await waitFor(
        () =>
          requests.length > previousCount &&
          contentState.get().isArticleListReady &&
          contentState.get().filterDate === null,
      )
      assert(contentState.get().filterString === "handoff query", "clearing date changed search")
      assert(!isArticleListDateFilterActive({ from: "all", filterDate: null }))
    })

    setRunning(false)
  }

  return (
    <main>
      <h1>FILTER-01B Date / Status Transition Contract</h1>
      <button disabled={running} onClick={() => void run()}>
        Run FILTER-01B transition gate
      </button>
      <p data-testid="filter01b-suite-summary">
        {running
          ? "RUNNING"
          : `${runResults.filter(({ status }) => status === "PASS").length}/${runResults.length} PASS`}
      </p>
      <pre data-testid="filter01b-suite-results">{JSON.stringify(runResults, null, 2)}</pre>
      <div id="filter01b-probe">
        <Probe scope={scope} setScope={setScope} />
      </div>
    </main>
  )
}

const root = createRoot(document.querySelector("#root"))
root.render(<Harness />)
