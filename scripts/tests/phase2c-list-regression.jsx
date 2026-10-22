// Local deterministic harness: real list hooks/API adapters, mocked network boundary only.
/* eslint-disable react-compiler/react-compiler -- Deterministic fixture orchestration controls the mocked network boundary. */
/* eslint-disable react-hooks/globals, react-hooks/immutability -- Isolated scenarios reset module-scoped fixture state outside React render. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useLayoutEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation } from "react-router"

import * as entriesApi from "@/apis/entries"
import apiClient from "@/apis/ofetch"
import FooterPanel from "@/components/Content/FooterPanel"
import AppDataContext from "@/contexts/app-data-context"
import useArticleList from "@/hooks/useArticleList"
import { polyglotState } from "@/hooks/useLanguage"
import useLoadMore from "@/hooks/useLoadMore"
import englishPhrases from "@/locales/en-US.json"
import { contentState, setArticleListSource } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import { MARK_ALL_READ_UNDO_DURATION_MS } from "@/utils/mark-all-read-undo"

const feed = {
  id: 1,
  title: "Fixture feed",
  site_url: "https://example.invalid",
  category: { id: 1, title: "Fixture category" },
}
const entry = (id, published_at, overrides = {}) => ({
  id,
  published_at,
  created_at: published_at,
  changed_at: published_at,
  status: "unread",
  starred: false,
  title: `Entry ${id}`,
  url: `https://example.invalid/${id}`,
  hash: `hash-${id}`,
  content: "<p>Deterministic local article content for list ordering regression.</p>",
  reading_time: 1,
  feed,
  ...overrides,
})
// Intentionally not editorial recency order: the ordinary path must keep server order.
const ordinaryEntries = [
  entry(31, "2026-10-10T10:00:00Z"),
  entry(12, "2026-10-12T10:00:00Z", { feed: { ...feed, id: 2 } }),
  entry(24, "2026-10-11T10:00:00Z"),
]
const fixtureNow = Date.now()
const homeEntries = [
  entry(101, "2026-10-12T10:00:00Z", { title: "Same title" }),
  entry(102, "2026-10-11T10:00:00Z", { title: "Same title" }),
]
const allAdapter = (status, _starred, filters) => entriesApi.getAllEntries(status, filters)
const feedAdapter = (status, starred, filters) =>
  entriesApi.getFeedEntries(1, status, starred, filters)
const categoryAdapter = (status, starred, filters) =>
  entriesApi.getCategoryEntries(1, status, starred, filters)
const todayAdapter = (status, _starred, filters) => entriesApi.getTodayEntries(status, filters)
const starredAdapter = (status, _starred, filters) => entriesApi.getStarredEntries(status, filters)
const historyAdapter = (_status, _starred, filters) => entriesApi.getHistoryEntries(filters)
// Fallback exposes pre-implementation Home leaks while keeping the harness executable in RED.
const homeAdapter = (...args) =>
  entriesApi.getHomeEntries ? entriesApi.getHomeEntries(...args) : allAdapter(...args)
const controls = { current: null }
const requests = []
const mutationBodies = []
const effectOrder = []
const notifications = new Map()
let respond
let mutationRequests = 0
let mutationFailure = false
let mutationFailureAfter = Infinity
let countRefreshes = 0
let serverEntries = []
let deferredMutation = null
let deferredGetResponse = null
apiClient.get = async (url) => {
  requests.push(url)
  if (deferredGetResponse) {
    const pendingResponse = deferredGetResponse
    deferredGetResponse = null
    return pendingResponse.promise
  }
  return respond(url)
}
apiClient.put = async (url, body, options) => {
  mutationRequests += 1
  mutationBodies.push({ body, options, url })
  if (deferredMutation) {
    await deferredMutation.promise
  }
  if (mutationFailure || mutationRequests > mutationFailureAfter) {
    throw new Error("Expected local mark-all failure")
  }
  const ids = body?.entry_ids ?? []
  serverEntries = serverEntries.map((item) =>
    ids.includes(item.id) ? { ...item, status: body.status } : item,
  )
}
Notification.success = (options) => {
  effectOrder.push("success")
  if (options.id) {
    notifications.set(options.id, options)
  }
}
Notification.error = (options) => {
  notifications.set("last-error", options)
}
Notification.remove = (id) => {
  const notification = notifications.get(id)
  notifications.delete(id)
  notification?.onClose?.()
}
polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))

const ListProbe = ({ source }) => {
  const adapter =
    {
      home: homeAdapter,
      feed: feedAdapter,
      category: categoryAdapter,
      today: todayAdapter,
      starred: starredAdapter,
      history: historyAdapter,
    }[source] ?? allAdapter
  const sourceId = ["feed", "category"].includes(source) ? 1 : source === "all" ? "" : null
  const list = useArticleList(source, sourceId, adapter)
  const pagination = useLoadMore()
  const content = useStore(contentState)
  const location = useLocation()
  useLayoutEffect(() => {
    controls.current = {
      ...list,
      loadMore: () => pagination.handleLoadMore(adapter),
      path: location.pathname,
    }
  })
  return (
    <>
      <ol aria-label="Committed entries">
        {content.entries.map(({ id, title }, index) => (
          <li key={`${id}:${index}`} data-entry-id={id}>
            {title} ({id})
          </li>
        ))}
      </ol>
      {source !== "home" && (
        <FooterPanel
          getEntries={adapter}
          info={{ from: source, id: sourceId }}
          refreshArticleList={list.fetchArticleList}
        />
      )}
    </>
  )
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
const createDeferred = () => {
  let settleDeferred
  const promise = new Promise((resolve) => {
    settleDeferred = resolve
  })
  return { promise, resolve: settleDeferred }
}
const waitFor = async (predicate, message = "Fixture timed out") => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await settle()
  }
  throw new Error(message)
}
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const assertIds = (ids) => {
  const actualIds = contentState.get().entries.map(({ id }) => id)
  assert(
    JSON.stringify(actualIds) === JSON.stringify(ids),
    `Committed server order/IDs changed: expected ${JSON.stringify(ids)}, received ${JSON.stringify(actualIds)}`,
  )
  assert(
    JSON.stringify(
      [...document.querySelectorAll("[data-entry-id]")].map((node) => Number(node.dataset.entryId)),
    ) === JSON.stringify(ids),
    "Rendered order/IDs changed",
  )
}
const query = (index = 0) => new URL(requests[index], "https://fixture.invalid").searchParams
const canonical = (params, limit, cursor, globallyVisible = true) => {
  const expected = {
    order: "published_at",
    direction: "desc",
    limit: String(limit),
    globally_visible: String(globallyVisible),
    status: "unread",
    ...(cursor !== undefined && { published_before: String(cursor) }),
  }
  assert(
    JSON.stringify(Object.fromEntries([...params].toSorted())) ===
      JSON.stringify(Object.fromEntries(Object.entries(expected).toSorted())),
    `Noncanonical Home query: ${params}`,
  )
}
const serverRespond = (url) => {
  const params = new URL(url, "https://fixture.invalid").searchParams
  let matching = serverEntries
  if (params.get("status")) {
    matching = matching.filter(({ status }) => status === params.get("status"))
  }
  if (params.get("starred") === "true") {
    matching = matching.filter(({ starred }) => starred)
  }
  if (params.get("search")) {
    matching = matching.filter(({ title }) => title.includes(params.get("search")))
  }
  for (const field of ["published_at", "changed_at"]) {
    const prefix = field.replace(/_at$/, "")
    for (const boundary of ["after", "before"]) {
      const cursor = params.get(`${prefix}_${boundary}`)
      if (cursor !== null) {
        matching = matching.filter((item) =>
          boundary === "after"
            ? Date.parse(item[field]) > Number(cursor) * 1000
            : Date.parse(item[field]) < Number(cursor) * 1000,
        )
      }
    }
  }
  const temporalOrder = params.get("order")
  if (["published_at", "changed_at"].includes(temporalOrder)) {
    const direction = params.get("direction") === "desc" ? -1 : 1
    matching = [...matching].toSorted(
      (left, right) =>
        direction * (Date.parse(left[temporalOrder]) - Date.parse(right[temporalOrder])),
    )
  } else if (temporalOrder === "id") {
    const direction = params.get("direction") === "desc" ? -1 : 1
    matching = [...matching].toSorted((left, right) => direction * (left.id - right.id))
  }
  if (params.has("before_entry_id")) {
    matching = matching.filter(({ id }) => id < Number(params.get("before_entry_id")))
  }
  if (params.has("after_entry_id")) {
    matching = matching.filter(({ id }) => id > Number(params.get("after_entry_id")))
  }
  if (url.startsWith("/v1/feeds/1/")) {
    matching = matching.filter((item) => item.feed.id === 1)
  }
  if (url.startsWith("/v1/categories/1/entries")) {
    matching = matching.filter((item) => item.feed.category?.id === 1)
  }
  return { entries: matching.slice(0, Number(params.get("limit") || 1000)), total: matching.length }
}
const clickMarkAll = () => {
  const button = document.querySelector(
    `button[aria-label="${CSS.escape(englishPhrases.article_list.mark_all_as_read_tooltip)}"]`,
  )
  assert(button && !button.disabled, "Real FooterPanel Mark All Read control missing")
  button.click()
}
const undoNotification = () =>
  [...notifications.values()].findLast(
    ({ id, btn }) => typeof id === "string" && typeof btn?.props?.onClick === "function",
  )
const clickUndo = () => {
  const undoButton = undoNotification()?.btn
  assert(undoButton?.props?.onClick, "Undo action is missing from the successful mark-all notice")
  undoButton.props.onClick()
}
const Harness = () => {
  const [probe, setProbe] = useState(null)
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const mount = async (
    source,
    settingChanges = {},
    contentChanges = {},
    entries = ordinaryEntries,
    { coldDirectAll = false, respondWithFilters = false } = {},
  ) => {
    setProbe(null)
    await settle()
    controls.current = null
    for (const notificationId of notifications.keys()) {
      Notification.remove(notificationId)
    }
    notifications.clear()
    effectOrder.length = 0
    requests.length = 0
    mutationBodies.length = 0
    mutationRequests = 0
    mutationFailure = false
    mutationFailureAfter = Infinity
    countRefreshes = 0
    deferredMutation = null
    deferredGetResponse = null
    serverEntries = entries.map((item) => ({ ...item }))
    respond = respondWithFilters ? serverRespond : () => ({ entries, total: 8 })
    dataState.setKey("sessionRevision", dataState.get().sessionRevision + 1)
    settingsState.set({
      ...getDefaultSettings(),
      removeDuplicates: "none",
      pageSize: 2,
      showHiddenFeeds: false,
      showStatus: "all",
      skipMarkAllReadConfirmation: true,
      orderBy: "created_at",
      orderDirection: "asc",
      ...settingChanges,
    })
    contentState.set({
      ...contentState.get(),
      entries: [],
      total: 0,
      articleListError: false,
      articleListRevision: contentState.get().articleListRevision + 1,
      filterString: "",
      filterDate: null,
      infoFrom: source,
      infoId: ["feed", "category"].includes(source)
        ? 1
        : source === "all" && !coldDirectAll
          ? ""
          : null,
      isArticleListReady: false,
      loadMoreVisible: false,
      ...contentChanges,
    })
    if (source === "all") {
      setArticleListSource({ from: "all", id: "" })
    }
    dataState.setKey("feedsData", [
      feed,
      { ...feed, id: 2, title: "Next fixture feed", category: { id: 2, title: "Next category" } },
    ])
    dataState.setKey("categoriesData", [feed.category, { id: 2, title: "Next category" }])
    dataState.setKey("unreadInfo", { 1: 2, 2: 3 })
    setProbe({ source, key: contentState.get().articleListRevision })
    await waitFor(() => contentState.get().isArticleListReady && controls.current)
    await settle()
  }
  const runMarkAllControl = async ({
    source,
    entries,
    expectedIds,
    expectedPath,
    matchesRequest,
  }) => {
    await mount(source, { showStatus: "unread", markAllReadJumpToNext: false }, {}, entries, {
      respondWithFilters: true,
    })
    assertIds(expectedIds)
    respond = serverRespond
    clickMarkAll()
    await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
    assertIds([])
    assert(controls.current.path === expectedPath, `${source} Mark All changed the route`)
    assert(matchesRequest(requests), `${source} Mark All did not preserve the source query scope`)
    assert(
      JSON.stringify(mutationBodies[0]?.body?.entry_ids?.toSorted()) ===
        JSON.stringify(expectedIds.toSorted()),
      `${source} Mark All acknowledged IDs outside its source scope`,
    )
    assert(undoNotification(), `${source} Mark All did not expose Undo`)
    clickUndo()
    await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
    assert(
      JSON.stringify(mutationBodies[1]?.body?.entry_ids?.toSorted()) ===
        JSON.stringify(expectedIds.toSorted()) &&
        serverEntries.every(({ status }) => status === "unread"),
      `${source} Undo did not restore exactly the acknowledged entries`,
    )
    assert(controls.current.path === expectedPath, `${source} Undo changed the route`)
    assert(!undoNotification(), `${source} Undo left a duplicate notice`)
  }
  const requiredListRegressionGates = [
    "PUBLISHED_DESC_TIE_RECOVERY",
    "PUBLISHED_ASC_TIE_RECOVERY",
    "CHANGED_DESC_TIE_RECOVERY",
    "CHANGED_ASC_TIE_RECOVERY",
    "MIXED_PAGE_TRANSITIONS_TO_TIE_DRAIN",
    "CREATED_AT_ID_CURSOR_UNCHANGED",
    "LOAD_MORE_VISIBILITY_RECONCILIATION",
    "TOTAL_RECONCILIATION",
    "STALE_SESSION_TIE_DRAIN_IGNORED",
    "SNAPSHOT_REVISION_PROTECTION",
    "REQUEST_KEY_PROTECTION",
    "MUTATION_DURING_TIE_DRAIN_RECONCILES",
    "ALL_SCOPE_PASS",
    "UNREAD_SCOPE_PASS",
    "STARRED_SCOPE_PASS",
    "HISTORY_SCOPE_PASS",
    "TODAY_SCOPE_PASS",
    "FEED_SCOPE_PASS",
    "CATEGORY_SCOPE_PASS",
    "SEARCH_SCOPE_PASS",
    "NO_ALL_RANKING",
    "NO_UNREAD_RANKING",
    "ALL_SORT_PREFERENCE_PRESERVED",
    "UNREAD_FILTER_PRESERVED",
    "MARK_ALL_READ_SUCCESS",
    "MARK_ALL_NAVIGATED_TO_ALL_CONTROL",
    "MARK_ALL_COLD_DIRECT_ALL_RECONCILIATION",
    "MARK_ALL_COLD_DIRECT_ALL_JUMP_ENABLED",
    "MARK_ALL_COLD_DIRECT_ALL_SEARCH_SCOPE",
    "MARK_ALL_FILTERED_QUERY_TOTAL_RECONCILIATION",
    "MARK_ALL_FILTERED_ALL_TOTAL_UNCHANGED",
    "MARK_ALL_FILTERED_STARRED_TOTAL_UNCHANGED",
    "STALE_LIST_QUERY_TOTAL_PROTECTION",
    "MARK_ALL_TODAY_CONTROL",
    "MARK_ALL_CATEGORY_CONTROL",
    "MARK_ALL_STARRED_CONTROL",
    "MARK_ALL_READ_FILTER_SCOPE",
    "MARK_ALL_READ_NO_JUMP_ON_FAILURE",
    "MARK_ALL_READ_JUMP_TO_NEXT",
    "MARK_ALL_READ_AND_JUMP_BEHAVIOR_PRESERVED",
    "STALE_SESSION_PROTECTION",
    "PARTIAL_FAILURE_RECONCILIATION",
    "COUNTS_REFRESH",
    "BULK_UNDO_FEED_FAST_PATH",
    "BULK_UNDO_CATEGORY_FAST_PATH",
    "BULK_UNDO_FILTERED_BATCH",
    "BULK_UNDO_SEARCH_SCOPE",
    "BULK_UNDO_DATE_SCOPE",
    "BULK_UNDO_PARTIAL_FAILURE",
    "BULK_UNDO_STALE_SESSION",
    "BULK_UNDO_AFTER_JUMP",
    "BULK_UNDO_COUNTS_REFRESH",
    "BULK_UNDO_DOUBLE_CLICK_OR_EXPIRED_ACTION",
    "UNDO_REVERSAL_FAILURE",
  ]
  const requiredHomeQueryGates = [
    "HOME_CANONICAL_QUERY",
    "HOME_ID_ONLY_INITIAL",
    "HOME_ID_ONLY_REFRESH",
    "HOME_ID_ONLY_APPEND",
    "HOME_REFRESH_FAILURE_PRESERVES",
  ]
  const expectedHelperSuites = [
    {
      file: "src/utils/article-list-request-key.test.js",
      coverage: ["ALL_SORT_PREFERENCE_PRESERVED", "UNREAD_FILTER_PRESERVED"],
    },
    {
      file: "src/utils/article-list-filters.test.js",
      coverage: ["filtered-total-refresh-predicate"],
    },
    {
      file: "src/utils/reconcile-entries-after-mark-read.test.js",
      coverage: ["successful-mark-read-subset", "batch-reconciliation"],
    },
    {
      file: "src/utils/mark-all-read-undo.test.js",
      coverage: ["undo-expiration-and-one-shot", "undo-session-and-reconciliation"],
    },
  ]
  const runTemporalTieRecovery = async (sortProperty, direction, source) => {
    const tieSecond = Math.floor(Date.parse("2026-10-20T12:00:00Z") / 1000)
    const tieTimestamp = new Date(tieSecond * 1000).toISOString()
    const adjacentSecond = tieSecond + (direction === "desc" ? -1 : 1)
    const adjacentTimestamp = new Date(adjacentSecond * 1000).toISOString()
    const useChangedAt = sortProperty === "changed_at"
    const tiedEntries = [905, 904, 903, 902, 901].map((id, index) =>
      entry(id, useChangedAt ? `2026-10-${15 + index}T12:00:00Z` : tieTimestamp, {
        ...(source === "starred" && { starred: true }),
        ...(useChangedAt && { changed_at: tieTimestamp }),
      }),
    )
    const adjacentEntries = [800, 799, 798, 797].map((id, index) =>
      entry(
        id,
        useChangedAt
          ? `2026-10-${10 + index}T12:00:00Z`
          : new Date(
              (adjacentSecond + (direction === "desc" ? -index : index)) * 1000,
            ).toISOString(),
        {
          ...(source === "starred" && { starred: true }),
          ...(useChangedAt && { changed_at: adjacentTimestamp }),
        },
      ),
    )
    const fixtures = [...tiedEntries, ...adjacentEntries]
    const expectedIds = fixtures.map(({ id }) => id)

    await mount(
      source,
      { showStatus: "all", orderBy: sortProperty, orderDirection: direction, pageSize: 2 },
      {},
      fixtures,
      { respondWithFilters: true },
    )
    const requestStart = requests.length
    assertIds(expectedIds.slice(0, 2))
    assert(
      query().get("order") === sortProperty && query().get("direction") === direction,
      `${sortProperty} ${direction} did not use its requested canonical sort`,
    )

    for (let page = 0; page < 12 && contentState.get().loadMoreVisible; page += 1) {
      const previousRequestCount = requests.length
      await controls.current.loadMore()
      await settle()
      if (requests.length === previousRequestCount) {
        break
      }
      assert(
        contentState.get().total === fixtures.length,
        `${sortProperty} ${direction} replaced canonical total with an auxiliary window total`,
      )
      if (contentState.get().temporalPaginationState?.tieDrain) {
        assert(
          contentState.get().loadMoreVisible,
          `${sortProperty} ${direction} hid Load More before its tie bucket drained`,
        )
      }
    }

    assertIds(expectedIds)
    const scenarioRequests = requests.slice(requestStart)
    const prefix = sortProperty.replace(/_at$/, "")
    const drainRequests = scenarioRequests.filter((url) => {
      const params = new URL(url, "https://fixture.invalid").searchParams
      return (
        params.get("order") === "id" &&
        params.get(`${prefix}_after`) === String(tieSecond - 1) &&
        params.get(`${prefix}_before`) === String(tieSecond + 1)
      )
    })
    assert(drainRequests.length === 3, `${sortProperty} ${direction} did not drain by ID pages`)
    const drainParams = drainRequests.map(
      (url) => new URL(url, "https://fixture.invalid").searchParams,
    )
    assert(
      drainParams[0].get("before_entry_id") === null &&
        drainParams[1].get("before_entry_id") === "904" &&
        drainParams[2].get("before_entry_id") === "902",
      `${sortProperty} ${direction} did not advance the tie-drain ID cursor`,
    )
    const resumedTemporalRequest = scenarioRequests.findLast((url) => {
      const params = new URL(url, "https://fixture.invalid").searchParams
      return (
        params.get("order") === sortProperty &&
        params.has(`${prefix}_${direction === "desc" ? "before" : "after"}`)
      )
    })
    assert(
      resumedTemporalRequest,
      `${sortProperty} ${direction} did not resume its temporal cursor`,
    )
    assert(
      contentState.get().loadMoreVisible === false,
      `${sortProperty} ${direction} did not reconcile Load More after all entries loaded`,
    )
    assert(
      mutationRequests === 0,
      `${sortProperty} ${direction} pagination issued a provider write`,
    )
  }
  const runTieDrainScope = async ({
    source,
    settingChanges = {},
    contentChanges = {},
    entryOverrides = {},
    expectedPath,
    expectedParams,
  }) => {
    const tieSecond = Math.floor((fixtureNow - 12 * 60 * 60 * 1000) / 1000)
    const timestamp = new Date(tieSecond * 1000).toISOString()
    const fixtures = [905, 904, 903].map((id) =>
      entry(id, timestamp, {
        ...(source === "starred" && { starred: true }),
        ...entryOverrides,
      }),
    )
    await mount(
      source,
      {
        orderBy: "published_at",
        orderDirection: "desc",
        pageSize: 2,
        ...settingChanges,
      },
      contentChanges,
      fixtures,
      { respondWithFilters: true },
    )
    await controls.current.loadMore()
    await settle()
    const drainUrl = requests.findLast((url) => {
      return new URL(url, "https://fixture.invalid").searchParams.get("order") === "id"
    })
    assert(drainUrl, `${source} did not enter temporal tie-drain`)
    const parsedUrl = new URL(drainUrl, "https://fixture.invalid")
    assert(parsedUrl.pathname === expectedPath, `${source} tie-drain changed endpoint scope`)
    const resolvedExpectedParams =
      typeof expectedParams === "function" ? expectedParams({ tieSecond }) : expectedParams
    for (const [key, value] of Object.entries(resolvedExpectedParams)) {
      assert(
        parsedUrl.searchParams.get(key) === value,
        `${source} tie-drain lost ${key}=${value}: ${parsedUrl.search}`,
      )
    }
    assert(
      parsedUrl.searchParams.get("limit") === "2" &&
        parsedUrl.searchParams.get("direction") === "desc",
      `${source} tie-drain did not use the bounded ID acquisition page`,
    )
  }
  const runMixedPageTieTransition = async () => {
    const tieSecond = Math.floor(Date.parse("2026-10-20T12:00:00Z") / 1000)
    const fixtures = [
      entry(1003, new Date((tieSecond + 2) * 1000).toISOString()),
      entry(1002, new Date((tieSecond + 1) * 1000).toISOString()),
      entry(1001, new Date(tieSecond * 1000).toISOString()),
      entry(1000, new Date(tieSecond * 1000).toISOString()),
      ...[900, 899].map((id) => entry(id, new Date((tieSecond - 1) * 1000).toISOString())),
    ]
    await mount(
      "all",
      { showStatus: "all", orderBy: "published_at", orderDirection: "desc", pageSize: 3 },
      {},
      fixtures,
      { respondWithFilters: true },
    )
    assert(
      !contentState.get().temporalPaginationState?.tieDrain,
      "A safe multi-second initial page entered tie-drain",
    )
    await controls.current.loadMore()
    await settle()
    assert(
      contentState.get().temporalPaginationState?.tieDrain?.bucketSecond === tieSecond,
      "A mixed continuation page did not detect a same-second bucket repeated from the prior page",
    )
    await controls.current.loadMore()
    await settle()
    assert(
      requests.some(
        (url) => new URL(url, "https://fixture.invalid").searchParams.get("order") === "id",
      ),
      "A mixed-page boundary did not transition into ID tie-drain",
    )
    await controls.current.loadMore()
    await settle()
    assert(
      !contentState.get().temporalPaginationState?.tieDrain,
      "The mixed-page tie-drain did not terminate after its bucket was exhausted",
    )
    assertIds(fixtures.map(({ id }) => id))
    assert(
      !contentState.get().loadMoreVisible,
      "The mixed-page pagination remained visible after the canonical total was loaded",
    )
  }
  const scenarios = [
    [
      "LIST_REGRESSION_MATRIX_COMPLETE",
      async () => {
        const registry = listRegressionMatrix
        const registered = registry.runtimeGates.map(({ name }) => name)
        const plannedNames = [...requiredListRegressionGates, ...requiredHomeQueryGates]
        const scenarioNames = scenarios
          .map(([name]) => name)
          .filter((name) => name !== "LIST_REGRESSION_MATRIX_COMPLETE")
        assert(
          JSON.stringify(registered.toSorted()) === JSON.stringify(plannedNames.toSorted()) &&
            JSON.stringify(registered.toSorted()) === JSON.stringify(scenarioNames.toSorted()),
          "Runtime gate registry does not exactly match the named integration scenarios",
        )
        const planOwned = registry.runtimeGates.filter(({ name }) =>
          requiredListRegressionGates.includes(name),
        )
        assert(
          JSON.stringify(planOwned.map(({ name }) => name).toSorted()) ===
            JSON.stringify(requiredListRegressionGates.toSorted()) &&
            planOwned.every(({ owner }) => owner === "scripts/tests/phase2c-list-regression.jsx"),
          "Plan-owned runtime gates are missing, renamed, duplicated, or assigned to another owner",
        )
        assert(
          JSON.stringify(registry.helperSuites) === JSON.stringify(expectedHelperSuites),
          "Helper-level suites are missing or claim broader coverage than their tests",
        )
      },
    ],
    [
      "PUBLISHED_DESC_TIE_RECOVERY",
      async () => runTemporalTieRecovery("published_at", "desc", "all"),
    ],
    [
      "PUBLISHED_ASC_TIE_RECOVERY",
      async () => runTemporalTieRecovery("published_at", "asc", "all"),
    ],
    [
      "CHANGED_DESC_TIE_RECOVERY",
      async () => runTemporalTieRecovery("changed_at", "desc", "starred"),
    ],
    [
      "CHANGED_ASC_TIE_RECOVERY",
      async () => runTemporalTieRecovery("changed_at", "asc", "starred"),
    ],
    ["MIXED_PAGE_TRANSITIONS_TO_TIE_DRAIN", runMixedPageTieTransition],
    [
      "CREATED_AT_ID_CURSOR_UNCHANGED",
      async () => {
        const fixtures = [
          entry(205, "2026-10-20T12:00:00Z"),
          entry(204, "2026-10-20T12:00:00Z"),
          entry(203, "2026-10-20T12:00:00Z"),
        ]
        await mount(
          "all",
          { showStatus: "all", orderBy: "created_at", orderDirection: "desc", pageSize: 2 },
          {},
          fixtures,
          { respondWithFilters: true },
        )
        await controls.current.loadMore()
        await settle()
        assert(
          query(1).get("before_entry_id") === "204" &&
            query(1).get("order") === "created_at" &&
            !query(1).has("published_before") &&
            !query(1).has("changed_before"),
          `created_at pagination changed from its entry-ID cursor: ${query(1)}`,
        )
        assertIds(fixtures.map(({ id }) => id))
      },
    ],
    [
      "LOAD_MORE_VISIBILITY_RECONCILIATION",
      async () => runTemporalTieRecovery("published_at", "desc", "all"),
    ],
    ["TOTAL_RECONCILIATION", async () => runTemporalTieRecovery("changed_at", "asc", "starred")],
    [
      "STALE_SESSION_TIE_DRAIN_IGNORED",
      async () => {
        const timestamp = "2026-10-20T12:00:00Z"
        const fixtures = [905, 904, 903].map((id) => entry(id, timestamp))
        await mount(
          "all",
          { showStatus: "all", orderBy: "published_at", orderDirection: "desc", pageSize: 2 },
          {},
          fixtures,
          { respondWithFilters: true },
        )
        const initialIds = contentState.get().entries.map(({ id }) => id)
        const pendingResponse = createDeferred()
        deferredGetResponse = pendingResponse
        const loadMore = controls.current.loadMore()
        await waitFor(
          () => requests.some((url) => query(requests.indexOf(url)).get("order") === "id"),
          "Stale-session tie-drain request did not start",
        )
        dataState.setKey("sessionRevision", dataState.get().sessionRevision + 1)
        pendingResponse.resolve({ entries: [fixtures[2]], total: fixtures.length })
        await loadMore
        assertIds(initialIds)
        assert(
          !contentState.get().entries.some(({ id }) => id === fixtures[2].id),
          "A stale-session tie-drain response entered the committed list",
        )
      },
    ],
    [
      "SNAPSHOT_REVISION_PROTECTION",
      async () => {
        const timestamp = "2026-10-20T12:00:00Z"
        const fixtures = [905, 904, 903].map((id) => entry(id, timestamp))
        await mount(
          "all",
          { showStatus: "all", orderBy: "published_at", orderDirection: "desc", pageSize: 2 },
          {},
          fixtures,
          { respondWithFilters: true },
        )
        const initialIds = contentState.get().entries.map(({ id }) => id)
        const initialSnapshotRevision = contentState.get().articleListSnapshotRevision
        const pendingResponse = createDeferred()
        deferredGetResponse = pendingResponse
        const loadMore = controls.current.loadMore()
        await waitFor(
          () =>
            requests.some(
              (url) => new URL(url, "https://fixture.invalid").searchParams.get("order") === "id",
            ),
          "Snapshot-fenced tie-drain request did not start",
        )
        await controls.current.fetchArticleList()
        assert(
          contentState.get().articleListSnapshotRevision > initialSnapshotRevision,
          "The replacement list response did not advance its snapshot revision",
        )
        pendingResponse.resolve({ entries: [fixtures[2]], total: fixtures.length })
        await loadMore
        assertIds(initialIds)
        assert(
          !contentState.get().entries.some(({ id }) => id === fixtures[2].id),
          "A stale snapshot tie-drain response entered the replacement list",
        )
      },
    ],
    [
      "REQUEST_KEY_PROTECTION",
      async () => {
        const timestamp = "2026-10-20T12:00:00Z"
        const fixtures = [
          entry(905, timestamp, { title: "Other first" }),
          entry(904, timestamp, { title: "Other second" }),
          entry(903, timestamp, { title: "Target article" }),
        ]
        await mount(
          "all",
          { showStatus: "all", orderBy: "published_at", orderDirection: "desc", pageSize: 2 },
          {},
          fixtures,
          { respondWithFilters: true },
        )
        const pendingResponse = createDeferred()
        deferredGetResponse = pendingResponse
        const loadMore = controls.current.loadMore()
        await waitFor(
          () =>
            requests.some(
              (url) => new URL(url, "https://fixture.invalid").searchParams.get("order") === "id",
            ),
          "Request-key-fenced tie-drain request did not start",
        )
        contentState.setKey("filterString", "Target")
        await waitFor(
          () =>
            contentState.get().isArticleListReady &&
            contentState.get().entries.some(({ id }) => id === fixtures[2].id),
          "New search scope did not replace the committed entries",
        )
        pendingResponse.resolve({ entries: [entry(902, timestamp)], total: fixtures.length })
        await loadMore
        assertIds([fixtures[2].id])
        assert(
          query(requests.length - 1).get("search") === "Target" &&
            !contentState.get().entries.some(({ id }) => id === 902),
          "A response from the old request key changed the new search scope",
        )
      },
    ],
    [
      "MUTATION_DURING_TIE_DRAIN_RECONCILES",
      async () => {
        const timestamp = "2026-10-20T12:00:00Z"
        const fixtures = [905, 904, 903].map((id) => entry(id, timestamp))
        await mount(
          "all",
          { showStatus: "all", orderBy: "published_at", orderDirection: "desc", pageSize: 2 },
          {},
          fixtures,
          { respondWithFilters: true },
        )
        const initialIds = contentState.get().entries.map(({ id }) => id)
        const staleResponse = createDeferred()
        deferredGetResponse = staleResponse
        const loadMore = controls.current.loadMore()
        await waitFor(
          () =>
            requests.some(
              (url) => new URL(url, "https://fixture.invalid").searchParams.get("order") === "id",
            ),
          "Mutation-coordinated tie-drain request did not start",
        )

        const pendingMutation = createDeferred()
        deferredMutation = pendingMutation
        const mutation = runEntryMutation(() => entriesApi.updateEntriesStatus([905], "read"))
        await waitFor(() => mutationRequests === 1, "Concurrent provider mutation did not start")
        staleResponse.resolve({ entries: [entry(902, timestamp)], total: fixtures.length })
        await settle()
        assertIds(initialIds)

        respond = async () => ({ entries: [fixtures[2]], total: fixtures.length })
        pendingMutation.resolve()
        await mutation
        await loadMore
        assert(
          requests.filter(
            (url) => new URL(url, "https://fixture.invalid").searchParams.get("order") === "id",
          ).length === 2,
          "Tie-drain did not re-query after the concurrent mutation settled",
        )
        assert(
          contentState.get().entries.some(({ id }) => id === fixtures[2].id) &&
            !contentState.get().entries.some(({ id }) => id === 902) &&
            new Set(contentState.get().entries.map(({ id }) => id)).size ===
              contentState.get().entries.length,
          "Mutation reconciliation committed stale or duplicate tie-drain entries",
        )
      },
    ],
    [
      "ALL_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "all",
          expectedPath: "/v1/entries",
          expectedParams: { globally_visible: "true" },
        }),
    ],
    [
      "UNREAD_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "all",
          settingChanges: { showStatus: "unread" },
          expectedPath: "/v1/entries",
          expectedParams: { globally_visible: "true", status: "unread" },
        }),
    ],
    [
      "STARRED_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "starred",
          entryOverrides: { starred: true },
          expectedPath: "/v1/entries",
          expectedParams: { globally_visible: "true", starred: "true" },
        }),
    ],
    [
      "HISTORY_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "history",
          entryOverrides: { status: "read" },
          expectedPath: "/v1/entries",
          expectedParams: { globally_visible: "true", status: "read" },
        }),
    ],
    [
      "TODAY_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "today",
          settingChanges: { showStatus: "unread" },
          expectedPath: "/v1/entries",
          expectedParams: ({ tieSecond }) => ({
            globally_visible: "true",
            status: "unread",
            published_after: String(tieSecond - 1),
            published_before: String(tieSecond + 1),
          }),
        }),
    ],
    [
      "FEED_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "feed",
          expectedPath: "/v1/feeds/1/entries",
          expectedParams: {},
        }),
    ],
    [
      "CATEGORY_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "category",
          expectedPath: "/v1/categories/1/entries",
          expectedParams: { globally_visible: "true" },
        }),
    ],
    [
      "SEARCH_SCOPE_PASS",
      async () =>
        runTieDrainScope({
          source: "all",
          contentChanges: { filterString: "target" },
          entryOverrides: { title: "target entry" },
          expectedPath: "/v1/entries",
          expectedParams: { globally_visible: "true", search: "target" },
        }),
    ],
    [
      "NO_ALL_RANKING",
      async () => {
        await mount("all")
        assertIds([31, 12, 24])
      },
    ],
    [
      "NO_UNREAD_RANKING",
      async () => {
        await mount("all", { showStatus: "unread" })
        assertIds([31, 12, 24])
        assert(query().get("status") === "unread", "Unread status missing")
      },
    ],
    [
      "ALL_SORT_PREFERENCE_PRESERVED",
      async () => {
        await mount("all")
        assert(
          query().get("order") === "created_at" && query().get("direction") === "asc",
          "Initial preference ignored",
        )
        settingsState.set({
          ...settingsState.get(),
          orderBy: "published_at",
          orderDirection: "desc",
        })
        await waitFor(() => requests.length === 2 && contentState.get().isArticleListReady)
        assert(
          query(1).get("order") === "published_at" && query(1).get("direction") === "desc",
          "Updated preference ignored",
        )
        await settle()
        assertIds([31, 12, 24])
      },
    ],
    [
      "UNREAD_FILTER_PRESERVED",
      async () => {
        await mount(
          "all",
          { showStatus: "unread", orderBy: "published_at" },
          { filterString: "climate", filterDate: "2026-10-10" },
        )
        const params = query()
        assert(
          params.get("status") === "unread" && params.get("search") === "climate",
          "Configured unread search missing",
        )
        assert(
          params.get("published_after") === String(new Date(2026, 9, 10).getTime() / 1000) &&
            params.get("published_before") ===
              String(new Date(2026, 9, 10, 23, 59, 59).getTime() / 1000),
          `Configured date missing: ${params}`,
        )
        assertIds([31, 12, 24])
      },
    ],
    [
      "HOME_CANONICAL_QUERY",
      async () => {
        await mount(
          "home",
          { showStatus: "starred" },
          { filterString: "ignored", filterDate: "2026-10-10" },
          homeEntries,
        )
        canonical(query(), 2)
        await entriesApi.getHomeEntries()
        canonical(query(1), 2)
        await entriesApi.getHomeEntries({ pageSize: 1 })
        canonical(query(2), 1)
        const count = requests.length
        settingsState.set({
          ...settingsState.get(),
          showStatus: "all",
          orderBy: "changed_at",
          orderDirection: "desc",
        })
        contentState.set({ ...contentState.get(), filterString: "other", filterDate: null })
        await settle()
        assert(
          requests.length === count,
          "Ordinary status/sort/search/date controls refetched Home",
        )
        settingsState.set({ ...settingsState.get(), showHiddenFeeds: true })
        await waitFor(() => requests.length > count && contentState.get().isArticleListReady)
        canonical(query(count), 2, undefined, false)
        await entriesApi.getHomeEntries({ pageSize: 1 })
        canonical(query(count + 1), 1, undefined, false)
      },
    ],
    [
      "HOME_ID_ONLY_INITIAL",
      async () => {
        await mount("home", { removeDuplicates: "title" }, {}, [
          ...homeEntries,
          { ...homeEntries[0], title: "Duplicate must not replace first" },
        ])
        assertIds([101, 102])
        assert(
          contentState.get().entries[0].title === "Same title",
          "Home replaced the first occurrence",
        )
        assert(mutationRequests === 0, "Home marked functional duplicates read")
      },
    ],
    [
      "HOME_ID_ONLY_REFRESH",
      async () => {
        await mount("home", { removeDuplicates: "title" }, {}, homeEntries)
        respond = () => ({
          entries: [
            homeEntries[1],
            homeEntries[0],
            { ...homeEntries[1], title: "Duplicate must not replace first" },
          ],
          total: 8,
        })
        await controls.current.fetchArticleList()
        await settle()
        assertIds([102, 101])
        assert(
          contentState.get().entries[0].title === "Same title",
          "Home refresh replaced the first occurrence",
        )
        assert(mutationRequests === 0, "Home refresh marked functional duplicates read")
      },
    ],
    [
      "HOME_ID_ONLY_APPEND",
      async () => {
        await mount("home", { removeDuplicates: "title" }, {}, homeEntries)
        respond = () => ({
          entries: [
            homeEntries[1],
            entry(103, "2026-10-10T10:00:00Z", { title: "Same title" }),
            entry(103, "2026-10-10T10:00:00Z", { title: "Same title" }),
          ],
          total: 8,
        })
        await controls.current.loadMore()
        await settle()
        canonical(query(1), 2, 1_791_799_200)
        assertIds([101, 102, 103])
        assert(mutationRequests === 0, "Home append marked duplicates read")
      },
    ],
    [
      "HOME_REFRESH_FAILURE_PRESERVES",
      async () => {
        await mount("home", {}, {}, homeEntries)
        const snapshot = contentState.get().articleListSnapshotRevision
        respond = () => {
          throw new Error("Expected fixture refresh failure")
        }
        await controls.current.fetchArticleList()
        await settle()
        assertIds([101, 102])
        assert(
          contentState.get().total === 8 &&
            contentState.get().articleListError &&
            contentState.get().isArticleListReady,
          "Refresh failure lost committed snapshot/error",
        )
        assert(
          contentState.get().articleListSnapshotRevision === snapshot,
          "Failed refresh advanced successful snapshot revision",
        )
      },
    ],
    [
      "MARK_ALL_READ_SUCCESS",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(
          () => mutationRequests === 1 && countRefreshes === 1,
          "Mark All mutation and counts did not complete",
        )
        assertIds([])
        assert(
          serverEntries.every(({ status }) => status === "read"),
          "ID-batched mutation did not mark server entries",
        )
        assert(
          mutationBodies.every(({ url }) => url === "/v1/entries") &&
            JSON.stringify(mutationBodies[0]?.body?.entry_ids?.toSorted()) ===
              JSON.stringify([12, 24, 31]),
          "Footer did not use the acknowledged ID batch path",
        )
      },
    ],
    [
      "MARK_ALL_NAVIGATED_TO_ALL_CONTROL",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        assert(contentState.get().infoId === "", "Navigated All fixture lost its normalized ID")
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assertIds([])
        assert(contentState.get().total === 8, "Unfiltered Mark All changed the query total")
        assert(controls.current.path === "/all", "All control unexpectedly changed route")
      },
    ],
    [
      "MARK_ALL_COLD_DIRECT_ALL_RECONCILIATION",
      async () => {
        await mount(
          "all",
          { showStatus: "unread", markAllReadJumpToNext: false },
          {},
          ordinaryEntries,
          { coldDirectAll: true },
        )
        assert(contentState.get().infoId === null, "Cold /all fixture did not retain null infoId")
        respond = serverRespond
        clickMarkAll()
        await waitFor(
          () => mutationRequests === 1 && countRefreshes === 1,
          `Cold /all Mark All mutation/counts timed out (${mutationRequests}, ${countRefreshes})`,
        )
        assertIds([])
        assert(controls.current.path === "/all", "Cold /all Mark All unexpectedly changed route")
        assert(
          JSON.stringify(mutationBodies[0]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([12, 24, 31]),
          "Cold /all did not acknowledge the exact scoped IDs",
        )
        assert(undoNotification(), "Cold /all successful Mark All did not expose Undo")
        clickUndo()
        await waitFor(
          () => mutationRequests === 2 && countRefreshes === 2,
          `Cold /all Undo mutation/counts timed out (${mutationRequests}, ${countRefreshes})`,
        )
        assert(
          JSON.stringify(mutationBodies[1]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([12, 24, 31]),
          "Cold /all Undo changed the exact acknowledged IDs",
        )
        assert(
          serverEntries.every(({ status }) => status === "unread"),
          "Cold /all Undo did not restore the acknowledged entries",
        )
        assert(controls.current.path === "/all", "Cold /all Undo changed the route")
        assert(!undoNotification(), "Cold /all Undo left a duplicate Undo notice")
      },
    ],
    [
      "MARK_ALL_COLD_DIRECT_ALL_JUMP_ENABLED",
      async () => {
        await mount(
          "all",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
          { coldDirectAll: true },
        )
        assert(contentState.get().infoId === null, "Cold /all jump fixture lost its null infoId")
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assertIds([])
        assert(controls.current.path === "/all", "Cold /all jumped to another route")
        assert(undoNotification(), "Cold /all jump-enabled Mark All did not expose Undo")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(
          JSON.stringify(mutationBodies[0]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([12, 24, 31]) &&
            JSON.stringify(mutationBodies[1]?.body?.entry_ids?.toSorted()) ===
              JSON.stringify([12, 24, 31]),
          "Cold /all jump-enabled Undo changed the acknowledged IDs",
        )
        assert(
          serverEntries.every(({ status }) => status === "unread"),
          "Cold /all jump-enabled Undo did not restore the entries",
        )
        assert(controls.current.path === "/all", "Cold /all Undo changed the route")
        assert(!undoNotification(), "Cold /all jump-enabled Undo left a duplicate notice")
      },
    ],
    [
      "MARK_ALL_COLD_DIRECT_ALL_SEARCH_SCOPE",
      async () => {
        const scopedEntries = [
          entry(51, "2026-10-10T10:00:00Z", { title: "climate match A" }),
          entry(52, "2026-10-10T11:00:00Z", { title: "climate match B" }),
          entry(53, "2026-10-11T10:00:00Z", { title: "outside scope" }),
        ]
        await mount(
          "all",
          { showStatus: "unread", markAllReadJumpToNext: false },
          { filterString: "climate" },
          scopedEntries,
          { coldDirectAll: true, respondWithFilters: true },
        )
        assert(contentState.get().infoId === null, "Cold /all search fixture lost its null infoId")
        assert(query(0).get("search") === "climate", "Cold /all search was not in the list query")
        assertIds([51, 52])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assertIds([])
        assert(controls.current.path === "/all", "Cold /all search Mark All changed the route")
        assert(
          JSON.stringify(mutationBodies[0]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([51, 52]) &&
            serverEntries.find(({ id }) => id === 53)?.status === "unread",
          "Cold /all search Mark All escaped the active filter scope",
        )
        assert(undoNotification(), "Cold /all search Mark All did not expose Undo")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(
          JSON.stringify(mutationBodies[1]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([51, 52]) && serverEntries.every(({ status }) => status === "unread"),
          "Cold /all search Undo did not restore exactly the acknowledged IDs",
        )
        assert(controls.current.path === "/all", "Cold /all search Undo changed the route")
        assert(!undoNotification(), "Cold /all search Undo left a duplicate notice")
      },
    ],
    [
      "MARK_ALL_FILTERED_QUERY_TOTAL_RECONCILIATION",
      async () => {
        const scopedEntries = [
          entry(151, "2026-10-10T10:00:00Z", { title: "climate match A" }),
          entry(152, "2026-10-10T11:00:00Z", { title: "climate match B" }),
          entry(153, "2026-10-11T10:00:00Z", { title: "outside scope" }),
        ]
        await mount(
          "all",
          { showStatus: "unread", markAllReadJumpToNext: false },
          { filterString: "climate" },
          scopedEntries,
          { coldDirectAll: true, respondWithFilters: true },
        )
        assert(contentState.get().total === 2, "Filtered unread query did not start at total 2")
        assertIds([151, 152])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assertIds([])
        assert(
          contentState.get().total === 0,
          `Filtered unread query total did not reconcile to zero: ${contentState.get().total}`,
        )
        assert(
          serverEntries.find(({ id }) => id === 153)?.status === "unread",
          "Filtered unread Mark All mutated the out-of-scope entry",
        )
        assert(controls.current.path === "/all", "Filtered unread Mark All changed the route")
        assert(undoNotification(), "Filtered unread Mark All did not expose Undo")
        clickUndo()
        await waitFor(
          () =>
            mutationRequests === 2 &&
            countRefreshes === 2 &&
            contentState.get().total === 2 &&
            JSON.stringify(contentState.get().entries.map(({ id }) => id)) ===
              JSON.stringify([151, 152]),
          "Filtered unread Undo did not restore the server-backed query total and entries",
        )
        assert(
          JSON.stringify(mutationBodies[1]?.body?.entry_ids?.toSorted()) ===
            JSON.stringify([151, 152]),
          "Filtered unread Undo did not restore exactly the acknowledged IDs",
        )
        assert(controls.current.path === "/all", "Filtered unread Undo changed the route")
        assert(!undoNotification(), "Filtered unread Undo left a duplicate notice")
      },
    ],
    [
      "MARK_ALL_FILTERED_ALL_TOTAL_UNCHANGED",
      async () => {
        const scopedEntries = [
          entry(161, "2026-10-10T10:00:00Z", { title: "climate match A" }),
          entry(162, "2026-10-10T11:00:00Z", { title: "climate match B" }),
          entry(163, "2026-10-11T10:00:00Z", { title: "outside scope" }),
        ]
        await mount(
          "all",
          { showStatus: "all", markAllReadJumpToNext: false },
          { filterString: "climate" },
          scopedEntries,
          { coldDirectAll: true, respondWithFilters: true },
        )
        assert(contentState.get().total === 2, "Filtered All query did not start at total 2")
        assertIds([161, 162])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(contentState.get().total === 2, "Mark All decremented a filtered All query total")
        assertIds([161, 162])
        assert(undoNotification(), "Filtered All Mark All did not expose Undo")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        await waitFor(
          () => contentState.get().total === 2 && contentState.get().entries.length === 2,
          "Filtered All Undo did not preserve the query total",
        )
      },
    ],
    [
      "MARK_ALL_FILTERED_STARRED_TOTAL_UNCHANGED",
      async () => {
        const scopedEntries = [
          entry(171, "2026-10-10T10:00:00Z", { title: "climate match unread", starred: true }),
          entry(172, "2026-10-10T11:00:00Z", {
            title: "climate match read",
            status: "read",
            starred: true,
          }),
          entry(173, "2026-10-11T10:00:00Z", { title: "outside scope", starred: false }),
        ]
        await mount(
          "feed",
          { showStatus: "starred", markAllReadJumpToNext: false },
          { filterString: "climate" },
          scopedEntries,
          { respondWithFilters: true },
        )
        assert(contentState.get().total === 2, "Filtered Starred query did not start at total 2")
        assertIds([171, 172])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          contentState.get().total === 2,
          "Mark All decremented a filtered Starred query total",
        )
        assertIds([171, 172])
        assert(
          JSON.stringify(mutationBodies[0]?.body?.entry_ids) === JSON.stringify([171]),
          "Filtered Starred Mark All mutated an entry outside unread-starred scope",
        )
        assert(undoNotification(), "Filtered Starred Mark All did not expose Undo")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        await waitFor(
          () => contentState.get().total === 2 && contentState.get().entries.length === 2,
          "Filtered Starred Undo did not preserve the query total",
        )
      },
    ],
    [
      "MARK_ALL_TODAY_CONTROL",
      async () => {
        const todayEntries = [
          entry(61, new Date(fixtureNow - 60_000).toISOString()),
          entry(62, "2026-10-10T10:00:00Z"),
        ]
        await runMarkAllControl({
          source: "today",
          entries: todayEntries,
          expectedIds: [61],
          expectedPath: "/today",
          matchesRequest: (observedRequests) =>
            observedRequests.some(
              (url) => url.includes("/v1/entries?") && url.includes("published_after="),
            ),
        })
      },
    ],
    [
      "MARK_ALL_CATEGORY_CONTROL",
      async () => {
        const categoryEntries = [
          entry(71, "2026-10-10T10:00:00Z"),
          entry(72, "2026-10-11T10:00:00Z", {
            feed: { ...feed, id: 2, category: { id: 2, title: "Other category" } },
          }),
        ]
        await runMarkAllControl({
          source: "category",
          entries: categoryEntries,
          expectedIds: [71],
          expectedPath: "/category/1",
          matchesRequest: (observedRequests) =>
            observedRequests.some((url) => url.startsWith("/v1/categories/1/entries?")),
        })
      },
    ],
    [
      "MARK_ALL_STARRED_CONTROL",
      async () => {
        const starredEntries = [
          entry(81, "2026-10-10T10:00:00Z", { starred: true }),
          entry(82, "2026-10-11T10:00:00Z", { starred: true }),
          entry(83, "2026-10-12T10:00:00Z", { starred: false }),
        ]
        await runMarkAllControl({
          source: "starred",
          entries: starredEntries,
          expectedIds: [81, 82],
          expectedPath: "/starred",
          matchesRequest: (observedRequests) =>
            observedRequests.some(
              (url) => url.includes("/v1/entries?") && url.includes("starred=true"),
            ),
        })
      },
    ],
    [
      "MARK_ALL_READ_FILTER_SCOPE",
      async () => {
        const scoped = [
          entry(41, "2026-10-10T10:00:00Z", { title: "climate A" }),
          entry(42, "2026-10-10T11:00:00Z", { title: "climate B" }),
          entry(43, "2026-10-11T10:00:00Z", { title: "other" }),
        ]
        await mount(
          "all",
          { showStatus: "unread" },
          { filterString: "climate", filterDate: "2026-10-10" },
          scoped,
        )
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => countRefreshes === 1)
        const batchQuery = requests
          .map((url) => new URL(url, "https://fixture.invalid").searchParams)
          .find((params) => params.get("limit") === "1000")
        assert(
          batchQuery?.get("search") === "climate" &&
            batchQuery.has("published_after") &&
            batchQuery.has("published_before"),
          "Batch request lost search/date scope",
        )
        assert(
          serverEntries.find(({ id }) => id === 43).status === "unread",
          "Out-of-scope entry was marked read",
        )
        assertIds([43])
      },
    ],
    [
      "MARK_ALL_READ_NO_JUMP_ON_FAILURE",
      async () => {
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
        )
        respond = serverRespond
        mutationFailure = true
        clickMarkAll()
        await waitFor(() => countRefreshes === 1)
        assert(controls.current.path === "/feed/1", "Failed Mark All Read navigated away")
        assert(
          serverEntries.every(({ status }) => status === "unread"),
          "Failed mutation changed server fixture",
        )
      },
    ],
    [
      "MARK_ALL_READ_JUMP_TO_NEXT",
      async () => {
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
        )
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => controls.current.path === "/feed/2")
        assert(countRefreshes === 1, "Jump happened before refreshed counts")
      },
    ],
    [
      "MARK_ALL_READ_AND_JUMP_BEHAVIOR_PRESERVED",
      async () => {
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
        )
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => controls.current.path === "/feed/2")
        assert(
          mutationBodies[0].url === "/v1/entries" &&
            JSON.stringify(mutationBodies[0].body.entry_ids.toSorted()) ===
              JSON.stringify([24, 31]),
          "Footer mark-all did not mutate the exact scoped IDs",
        )
        assert(countRefreshes === 1, "Footer jump occurred before count refresh")
      },
    ],
    [
      "STALE_SESSION_PROTECTION",
      async () => {
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
        )
        respond = serverRespond
        let resolveMutation
        deferredMutation = {
          promise: new Promise((resolve) => {
            resolveMutation = resolve
          }),
        }
        clickMarkAll()
        await waitFor(() => mutationRequests === 1)
        dataState.setKey("sessionRevision", dataState.get().sessionRevision + 1)
        resolveMutation()
        await settle()
        assert(
          countRefreshes === 0 && controls.current.path === "/feed/1",
          "Old session mutation committed FooterPanel effects",
        )
      },
    ],
    [
      "STALE_LIST_QUERY_TOTAL_PROTECTION",
      async () => {
        const scopedEntries = [
          entry(181, "2026-10-10T10:00:00Z", { title: "climate match A" }),
          entry(182, "2026-10-10T11:00:00Z", { title: "climate match B" }),
          entry(183, "2026-10-11T10:00:00Z", { title: "other current query" }),
        ]
        await mount(
          "all",
          { showStatus: "unread", markAllReadJumpToNext: false },
          { filterString: "climate" },
          scopedEntries,
          { coldDirectAll: true, respondWithFilters: true },
        )
        assert(contentState.get().total === 2, "Old query total did not start at 2")
        respond = serverRespond
        let resolveMutation
        deferredMutation = {
          promise: new Promise((resolve) => {
            resolveMutation = resolve
          }),
        }
        clickMarkAll()
        await waitFor(() => mutationRequests === 1)
        contentState.set({
          ...contentState.get(),
          entries: [scopedEntries[2]],
          filterString: "other",
          isArticleListReady: true,
          total: 1,
        })
        await settle()
        assertIds([183])
        resolveMutation()
        await waitFor(() => countRefreshes === 1)
        assert(
          contentState.get().total === 1 &&
            JSON.stringify(contentState.get().entries.map(({ id }) => id)) ===
              JSON.stringify([183]),
          "Stale Mark All callback changed the active query total or membership",
        )
      },
    ],
    [
      "PARTIAL_FAILURE_RECONCILIATION",
      async () => {
        const scoped = ordinaryEntries.map((item) => ({ ...item, title: `scope ${item.id}` }))
        await mount("all", { showStatus: "unread" }, { filterString: "scope" }, scoped, {
          coldDirectAll: true,
          respondWithFilters: true,
        })
        assert(
          contentState.get().total === 3,
          "Partial failure filtered query did not start at total 3",
        )
        respond = (url) => {
          const response = serverRespond(url)
          const params = new URL(url, "https://fixture.invalid").searchParams
          return params.get("limit") === "1000"
            ? { ...response, entries: response.entries.slice(0, 2) }
            : response
        }
        mutationFailureAfter = 1
        clickMarkAll()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 1)
        assertIds([24])
        assert(
          contentState.get().total === 1,
          `Partial failure did not reconcile query total to server truth: ${contentState.get().total}`,
        )
        assert(
          serverEntries.filter(({ status }) => status === "read").length === 2,
          "Failed later batch lost confirmed work",
        )
        assert(!undoNotification(), "Partial mark-all failure exposed an Undo action")
      },
    ],
    [
      "COUNTS_REFRESH",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => countRefreshes === 1)
        assert(dataState.get().unreadInfo[1] === 0, "Success did not refresh source count")
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        mutationFailure = true
        clickMarkAll()
        await waitFor(() => countRefreshes === 1)
        assert(dataState.get().unreadInfo[1] === 2, "Failure did not refresh source count")
      },
    ],
    [
      "BULK_UNDO_FEED_FAST_PATH",
      async () => {
        await mount("feed", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          mutationBodies[0].url === "/v1/entries" &&
            JSON.stringify(mutationBodies[0].body.entry_ids.toSorted()) ===
              JSON.stringify([24, 31]),
          "Feed Footer used a bulk endpoint or escaped its feed scope",
        )
        assert(serverEntries.find(({ id }) => id === 12).status === "unread")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(
          mutationBodies[1].body.status === "unread" &&
            JSON.stringify(mutationBodies[1].body.entry_ids.toSorted()) ===
              JSON.stringify([24, 31]),
          "Feed Undo did not reverse the exact acknowledged IDs",
        )
      },
    ],
    [
      "BULK_UNDO_CATEGORY_FAST_PATH",
      async () => {
        const scoped = [
          entry(51, "2026-10-10T10:00:00Z"),
          entry(52, "2026-10-11T10:00:00Z", {
            feed: { ...feed, id: 2, category: { id: 2, title: "Other category" } },
          }),
          entry(53, "2026-10-12T10:00:00Z", { feed: { ...feed, id: 3 } }),
        ]
        await mount("category", { showStatus: "unread" }, {}, scoped)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          mutationBodies[0].url === "/v1/entries" &&
            JSON.stringify(mutationBodies[0].body.entry_ids.toSorted()) ===
              JSON.stringify([51, 53]),
          "Category Footer used a bulk endpoint or escaped its category scope",
        )
        assert(serverEntries.find(({ id }) => id === 52).status === "unread")
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(
          JSON.stringify(mutationBodies[1].body.entry_ids.toSorted()) === JSON.stringify([51, 53]),
          "Category Undo did not use the exact acknowledged IDs",
        )
      },
    ],
    [
      "BULK_UNDO_FILTERED_BATCH",
      async () => {
        const recent = entry(61, new Date(fixtureNow - 60 * 60 * 1000).toISOString())
        const old = entry(62, new Date(fixtureNow - 48 * 60 * 60 * 1000).toISOString())
        await mount("today", { showStatus: "unread" }, {}, [recent, old])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          JSON.stringify(mutationBodies[0].body.entry_ids) === JSON.stringify([61]) &&
            serverEntries.find(({ id }) => id === 62).status === "unread",
          "Today mark-all escaped its rolling date scope",
        )

        const starred = [
          entry(71, "2026-10-10T10:00:00Z", { starred: true }),
          entry(72, "2026-10-11T10:00:00Z"),
          entry(73, "2026-10-12T10:00:00Z", {
            starred: true,
            feed: { ...feed, id: 2 },
          }),
        ]
        await mount("feed", { showStatus: "starred" }, {}, starred)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          JSON.stringify(mutationBodies[0].body.entry_ids) === JSON.stringify([71]) &&
            serverEntries.find(({ id }) => id === 72).status === "unread" &&
            serverEntries.find(({ id }) => id === 73).status === "unread",
          "Starred feed filter escaped its source or starred scope",
        )

        const manyEntries = Array.from({ length: 1001 }, (_, index) =>
          entry(1000 + index, "2026-10-12T10:00:00Z"),
        )
        await mount("all", { showStatus: "unread" }, {}, manyEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 1)
        assert(
          JSON.stringify(mutationBodies.map(({ body }) => body.entry_ids.length)) ===
            JSON.stringify([1000, 1]),
          "Mark-all requests did not honor the entry page batch boundary",
        )
        clickUndo()
        await waitFor(() => mutationRequests === 4 && countRefreshes === 2)
        assert(
          JSON.stringify(mutationBodies.slice(2).map(({ body }) => body.entry_ids.length)) ===
            JSON.stringify([1000, 1]),
          "Undo requests did not honor ENTRY_UPDATE_BATCH_SIZE",
        )
        assert(
          mutationBodies.slice(2).every(({ options }) => options?.retry === false),
          "Undo reversal requests retained automatic network retries",
        )
      },
    ],
    [
      "BULK_UNDO_SEARCH_SCOPE",
      async () => {
        const scoped = [
          entry(81, "2026-10-10T10:00:00Z", { title: "search match" }),
          entry(82, "2026-10-11T10:00:00Z", { title: "outside scope" }),
        ]
        await mount("all", { showStatus: "unread" }, { filterString: "match" }, scoped)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(query(0).get("search") === "match")
        assert(
          JSON.stringify(mutationBodies[0].body.entry_ids) === JSON.stringify([81]) &&
            serverEntries.find(({ id }) => id === 82).status === "unread",
          "Search-scoped mark-all changed an out-of-scope entry",
        )
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(JSON.stringify(mutationBodies[1].body.entry_ids) === JSON.stringify([81]))
      },
    ],
    [
      "BULK_UNDO_DATE_SCOPE",
      async () => {
        const scoped = [entry(91, "2026-10-10T10:00:00Z"), entry(92, "2026-10-11T10:00:00Z")]
        await mount("all", { showStatus: "unread" }, { filterDate: "2026-10-10" }, scoped)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        const batchQuery = requests
          .map((url) => new URL(url, "https://fixture.invalid").searchParams)
          .find((params) => params.get("limit") === "1000")
        assert(batchQuery?.has("published_after") && batchQuery.has("published_before"))
        assert(
          JSON.stringify(mutationBodies[0].body.entry_ids) === JSON.stringify([91]) &&
            serverEntries.find(({ id }) => id === 92).status === "unread",
          "Date-scoped mark-all changed an out-of-scope entry",
        )
      },
    ],
    [
      "BULK_UNDO_PARTIAL_FAILURE",
      async () => {
        const scoped = ordinaryEntries.map((item) => ({ ...item, title: `scope ${item.id}` }))
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          { filterString: "scope" },
          scoped,
        )
        respond = (url) => {
          const response = serverRespond(url)
          const params = new URL(url, "https://fixture.invalid").searchParams
          return params.get("limit") === "1000"
            ? { ...response, entries: response.entries.slice(0, 1) }
            : response
        }
        mutationFailureAfter = 1
        clickMarkAll()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 1)
        assert(!undoNotification(), "Partial mark-all failure exposed Undo")
        assert(controls.current.path === "/feed/1", "Partial mark-all failure navigated")
      },
    ],
    [
      "BULK_UNDO_STALE_SESSION",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        dataState.setKey("sessionRevision", dataState.get().sessionRevision + 1)
        clickUndo()
        await settle()
        assert(mutationRequests === 1, "Stale Undo wrote old IDs into the new session")
        assert(countRefreshes === 1, "Stale Undo refreshed the wrong session")
        assert(!undoNotification(), "Stale Undo notification remained available")
      },
    ],
    [
      "BULK_UNDO_AFTER_JUMP",
      async () => {
        await mount(
          "feed",
          { showStatus: "unread", markAllReadJumpToNext: true },
          {},
          ordinaryEntries,
        )
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => controls.current.path === "/feed/2")
        const listRevisionBeforeUndo = contentState.get().articleListRevision
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        await waitFor(() => contentState.get().articleListRevision > listRevisionBeforeUndo)
        assert(controls.current.path === "/feed/2", "Undo navigated back to the original feed")
        assert(
          JSON.stringify(mutationBodies[1].body.entry_ids.toSorted()) === JSON.stringify([24, 31]),
          "Undo after jump changed IDs outside the original acknowledged batch",
        )
      },
    ],
    [
      "BULK_UNDO_COUNTS_REFRESH",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        assert(
          effectOrder.join(",") === "counts,success",
          "Mark-all success notification appeared before the forced count refresh",
        )
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        assert(
          effectOrder.join(",") === "counts,success,counts",
          "Undo did not force a count refresh after its mutation",
        )
      },
    ],
    [
      "BULK_UNDO_DOUBLE_CLICK_OR_EXPIRED_ACTION",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        const firstUndoNotification = undoNotification()
        assert(
          typeof firstUndoNotification?.id === "string" &&
            firstUndoNotification.duration === MARK_ALL_READ_UNDO_DURATION_MS,
          "Successful mark-all did not expose its timed Undo action",
        )
        const firstUndoNotificationId = firstUndoNotification.id
        const obsoleteUndoButton = firstUndoNotification.btn
        await settle()
        clickMarkAll()
        await waitFor(() => countRefreshes === 2)
        assert(!undoNotification(), "A later empty success left the previous Undo action active")
        obsoleteUndoButton.props.onClick()
        await settle()
        assert(mutationRequests === 1, "A replaced Undo action still mutated entries")

        serverEntries = ordinaryEntries.map((item) => ({ ...item }))
        await settle()
        clickMarkAll()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 3)
        const currentUndoNotification = undoNotification()
        assert(
          typeof currentUndoNotification?.id === "string",
          "A later successful mark-all did not expose its Undo action",
        )
        assert(
          currentUndoNotification.id !== firstUndoNotificationId,
          "Sequential Undo actions reused a notification identity",
        )
        const undoButton = currentUndoNotification.btn
        undoButton.props.onClick()
        undoButton.props.onClick()
        await waitFor(() => mutationRequests === 3 && countRefreshes === 4)
        await settle()
        assert(mutationRequests === 3, "Double-click started more than one Undo request")

        await mount("all", { showStatus: "unread" }, {}, [])
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => countRefreshes === 1)
        assert(!undoNotification(), "Empty successful mark-all exposed Undo")
      },
    ],
    [
      "UNDO_REVERSAL_FAILURE",
      async () => {
        await mount("all", { showStatus: "unread" }, {}, ordinaryEntries)
        respond = serverRespond
        clickMarkAll()
        await waitFor(() => mutationRequests === 1 && countRefreshes === 1)
        const listRevisionBeforeUndo = contentState.get().articleListRevision
        mutationFailureAfter = 1
        clickUndo()
        await waitFor(() => mutationRequests === 2 && countRefreshes === 2)
        await waitFor(() => contentState.get().articleListRevision > listRevisionBeforeUndo)
        assert(!undoNotification(), "Failed Undo offered a second attempt")
        assert(notifications.has("last-error"), "Failed Undo did not show error feedback")
        assert(controls.current.path === "/all", "Failed Undo navigated away")
      },
    ],
  ]
  const listRegressionMatrix = {
    completenessGate: "LIST_REGRESSION_MATRIX_COMPLETE",
    runtimeGates: scenarios.slice(1).map(([name]) => ({
      name,
      owner: "scripts/tests/phase2c-list-regression.jsx",
      scope: requiredListRegressionGates.includes(name) ? "list-integration" : "home-query",
    })),
    helperSuites: expectedHelperSuites,
  }
  const runtimeOwners = new Map(
    listRegressionMatrix.runtimeGates.map(({ name, owner }) => [name, owner]),
  )
  const run = async () => {
    setRunning(true)
    setResults([])
    const nextResults = []
    for (const [name, scenario] of scenarios) {
      try {
        await scenario()
        nextResults.push({
          name,
          status: "PASS",
          owner:
            name === "LIST_REGRESSION_MATRIX_COMPLETE"
              ? "matrix-registry"
              : runtimeOwners.get(name),
          requests: [...requests],
        })
      } catch (error) {
        nextResults.push({
          name,
          status: "FAIL",
          owner:
            name === "LIST_REGRESSION_MATRIX_COMPLETE"
              ? "matrix-registry"
              : runtimeOwners.get(name),
          error: error.message,
          requests: [...requests],
        })
      }
      setResults([...nextResults])
    }
    setRunning(false)
  }
  return (
    <main>
      <h1>Phase 2C list regression</h1>
      <p>Deterministic local network fixtures; production list hooks and API adapters.</p>
      <button disabled={running} onClick={() => void run()}>
        Run list regression
      </button>
      <p data-testid="suite-summary">
        {running
          ? "RUNNING"
          : `${results.filter(({ status }) => status === "PASS").length}/${results.length} PASS`}
      </p>
      <section aria-labelledby="list-regression-matrix-heading">
        <h2 id="list-regression-matrix-heading">Regression matrix ownership</h2>
        <p>
          Integration behavior is exercised by its named runtime scenario. Helper suites below
          provide narrower unit coverage and do not replace those scenarios.
        </p>
        <pre data-testid="regression-matrix">{JSON.stringify(listRegressionMatrix, null, 2)}</pre>
      </section>
      {probe && (
        <AppDataContext.Provider
          value={{
            refreshCounts: async () => {
              countRefreshes += 1
              effectOrder.push("counts")
              dataState.setKey("unreadInfo", {
                1: serverEntries.filter((item) => item.feed.id === 1 && item.status === "unread")
                  .length,
                2: 3,
              })
            },
          }}
        >
          <MemoryRouter
            initialEntries={[
              {
                feed: "/feed/1",
                category: "/category/1",
                today: "/today",
                starred: "/starred",
              }[probe.source] ?? "/all",
            ]}
          >
            <ListProbe key={probe.key} source={probe.source} />
          </MemoryRouter>
        </AppDataContext.Provider>
      )}
      <pre data-testid="suite-results">{JSON.stringify(results, null, 2)}</pre>
    </main>
  )
}

const root =
  globalThis.__phase2cListRegressionRoot ??
  (globalThis.__phase2cListRegressionRoot = createRoot(document.querySelector("#root")))
root.render(<Harness />)

export default Harness
