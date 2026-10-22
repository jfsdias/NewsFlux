import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import { markDuplicatesAsRead } from "@/hooks/useEntryActions"
import {
  contentState,
  incrementArticleListSnapshotRevision,
  reconcileArticleListFilters,
  setArticleListError,
  setEntries,
  setEntriesWithDeduplication,
  setHomePaginationBoundary,
  setIsArticleListReady,
  setLoadMoreError,
  setLoadMoreVisible,
  setTemporalPaginationState,
  setTotal,
} from "@/store/contentState"
import {
  dataState,
  getDataSessionRevision,
  setHistoryCount,
  setStarredCount,
  setUnreadInfo,
  setUnreadStarredCount,
  setUnreadTodayCount,
} from "@/store/dataState"
import { articleListRequestSettingsState, settingsState } from "@/store/settingsState"
import { reconcileArticleListFilterScope } from "@/utils/article-list-filter-scope"
import { hasArticleListFilters } from "@/utils/article-list-filters"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { createArticleListSearchScopeKey } from "@/utils/article-list-search-scope"
import subscribeArticleListTotalRefresh from "@/utils/article-list-total-refresh"
import {
  getEntryMutationSnapshot,
  isEntryMutationSnapshotCurrent,
  waitForEntryMutations,
} from "@/utils/entry-mutation-state"
import prepareEntry from "@/utils/entry-presentation"
import {
  createHomePaginationBoundary,
  deduplicateHomeEntriesById,
  mergeHomeSessionEntries,
} from "@/utils/home-editorial-session"
import {
  createTemporalPaginationState,
  getArticleListTemporalSortProperty,
} from "@/utils/temporal-tie-drain"

const handleResponses = (
  response,
  isHome,
  preserveHomeSession = false,
  homePaginationSession = null,
  temporalPaginationSession = null,
) => {
  const isValidResponse =
    Array.isArray(response?.entries) && Number.isFinite(response?.total) && response.total >= 0
  if (!isValidResponse) {
    throw new TypeError("Invalid entries response")
  }

  const canonicalEntries = response.entries.map((entry) => prepareEntry(entry))
  const homeEntries = isHome ? deduplicateHomeEntriesById(canonicalEntries) : canonicalEntries
  const preparedEntries =
    isHome && preserveHomeSession
      ? mergeHomeSessionEntries(contentState.get().entries, homeEntries)
      : homeEntries
  if (isHome) {
    setEntries(preparedEntries)
    setHomePaginationBoundary({
      ...homePaginationSession,
      ...createHomePaginationBoundary({
        entries: canonicalEntries,
        total: response.total,
        pageSize: homePaginationSession?.pageSize,
      }),
    })
  } else {
    const duplicateEntries = setEntriesWithDeduplication(preparedEntries)
    markDuplicatesAsRead(duplicateEntries)
    setTemporalPaginationState(
      createTemporalPaginationState({
        entries: response.entries,
        total: response.total,
        ...temporalPaginationSession,
        snapshotRevision: contentState.get().articleListSnapshotRevision + 1,
      }),
    )
  }
  setTotal(response.total)
  setLoadMoreVisible(canonicalEntries.length < response.total)
  incrementArticleListSnapshotRevision()
}

const useArticleList = (source, sourceId, getEntries) => {
  const contentSnapshot = useStore(contentState, {
    keys: ["articleListRevision", "filterDate", "filterString", "infoFrom", "infoId"],
  })
  const settingsSnapshot = useStore(articleListRequestSettingsState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const automaticRequestKey = createArticleListRequestKey({
    content: contentSnapshot,
    settings: settingsSnapshot,
    info: { from: source, id: sourceId },
    sessionRevision,
  })
  const searchScope = { from: source, id: sourceId, showStatus: settingsSnapshot.showStatus }
  const searchScopeKey = createArticleListSearchScopeKey(searchScope)

  const committedHomeSnapshot = useRef(null)
  const latestRequestId = useRef(0)
  const loadingRequestKey = useRef(null)
  const currentRequestKey = useRef(null)
  const previousFilterScopeRef = useRef({
    from: contentSnapshot.infoFrom,
    id: contentSnapshot.infoId,
    showStatus: settingsSnapshot.showStatus,
  })

  useLayoutEffect(() => {
    const content = contentState.get()
    const nextScope = { from: source, id: sourceId, showStatus: settingsSnapshot.showStatus }
    const transition = reconcileArticleListFilterScope({
      previousScope: previousFilterScopeRef.current,
      nextScope,
      filterDate: content.filterDate,
      filterString: content.filterString,
    })

    previousFilterScopeRef.current = nextScope
    if (
      transition.filterDate !== content.filterDate ||
      transition.filterString !== content.filterString
    ) {
      reconcileArticleListFilters(transition)
    }
  }, [searchScopeKey, settingsSnapshot.showStatus, source, sourceId])

  useLayoutEffect(() => {
    if (currentRequestKey.current === automaticRequestKey) {
      return
    }

    currentRequestKey.current = automaticRequestKey
    setArticleListError(false)
    setLoadMoreError(false)
    setIsArticleListReady(false)
  }, [automaticRequestKey])

  const fetchArticleList = useCallback(async () => {
    const content = contentState.get()
    const settings = settingsState.get()
    const info = { from: source, id: sourceId }
    const requestSessionRevision = getDataSessionRevision()
    const requestKey = createArticleListRequestKey({
      content,
      settings,
      info,
      sessionRevision: requestSessionRevision,
    })
    const loadingKey = `${requestSessionRevision}:${requestKey}`

    if (loadingRequestKey.current === loadingKey) {
      return
    }

    loadingRequestKey.current = loadingKey
    const requestId = ++latestRequestId.current
    const isRequestSessionCurrent = () => requestSessionRevision === getDataSessionRevision()
    const isLatestRequest = () =>
      requestId === latestRequestId.current &&
      requestKey === currentRequestKey.current &&
      requestKey ===
        createArticleListRequestKey({
          content: contentState.get(),
          settings: settingsState.get(),
          info,
          sessionRevision: getDataSessionRevision(),
        })

    setArticleListError(false)
    setLoadMoreError(false)
    setIsArticleListReady(false)

    try {
      const filterParams = content.filterString ? { search: content.filterString } : {}

      let response
      let shouldRetry
      do {
        const mutationSnapshot = getEntryMutationSnapshot()
        if (mutationSnapshot.pendingRequests > 0) {
          const canContinue = await waitForEntryMutations(mutationSnapshot)
          if (!canContinue || !isLatestRequest() || !isRequestSessionCurrent()) {
            return
          }
          shouldRetry = true
          continue
        }

        if (source === "home") {
          response = await getEntries({ pageSize: settings.pageSize })
        } else {
          switch (settings.showStatus) {
            case "starred": {
              response = await getEntries(null, true, filterParams)
              break
            }
            case "unread": {
              response = await getEntries("unread", false, filterParams)
              break
            }
            default: {
              response = await getEntries(null, false, filterParams)
              break
            }
          }
        }

        if (!isLatestRequest() || !isRequestSessionCurrent()) {
          return
        }

        shouldRetry = !isEntryMutationSnapshotCurrent(mutationSnapshot)
        if (shouldRetry) {
          const canRetry = await waitForEntryMutations(mutationSnapshot)
          if (!canRetry || !isLatestRequest() || !isRequestSessionCurrent()) {
            return
          }
        }
      } while (shouldRetry)

      const previousHomeSnapshot = committedHomeSnapshot.current
      const preservesHomeSession =
        source === "home" &&
        previousHomeSnapshot?.requestKey === requestKey &&
        previousHomeSnapshot.sessionRevision === requestSessionRevision &&
        previousHomeSnapshot.pageSize === settings.pageSize &&
        previousHomeSnapshot.showHiddenFeeds === settings.showHiddenFeeds
      handleResponses(
        response,
        source === "home",
        preservesHomeSession,
        {
          requestKey,
          sessionRevision: requestSessionRevision,
          pageSize: settings.pageSize,
        },
        {
          orderDirection: settings.orderDirection,
          pageSize: settings.pageSize,
          requestKey,
          sessionRevision: requestSessionRevision,
          sortProperty: getArticleListTemporalSortProperty(source, settings.orderBy),
        },
      )
      if (source === "home") {
        committedHomeSnapshot.current = {
          requestKey,
          sessionRevision: requestSessionRevision,
          pageSize: settings.pageSize,
          showHiddenFeeds: settings.showHiddenFeeds,
        }
      }

      if (!hasArticleListFilters({ ...content, infoFrom: source })) {
        switch (source) {
          case "feed": {
            if (settings.showStatus === "unread") {
              setUnreadInfo((previous) => ({
                ...previous,
                [Number(sourceId)]: response.total,
              }))
            }
            break
          }
          case "history": {
            setHistoryCount(response.total)
            break
          }
          case "starred": {
            if (settings.showStatus === "unread") {
              setUnreadStarredCount(response.total)
            } else {
              setStarredCount(response.total)
            }
            break
          }
          case "today": {
            if (settings.showStatus === "unread") {
              setUnreadTodayCount(response.total)
            }
            break
          }
        }
      }
    } catch (error) {
      if (!isLatestRequest() || !isRequestSessionCurrent()) {
        return
      }

      console.error("Error fetching articles:", error)
      const snapshot = committedHomeSnapshot.current
      const preservesHomeSnapshot =
        source === "home" &&
        snapshot?.sessionRevision === requestSessionRevision &&
        snapshot.pageSize === settings.pageSize &&
        snapshot.showHiddenFeeds === settings.showHiddenFeeds
      if (!preservesHomeSnapshot) {
        setEntries([])
        setTotal(0)
        setLoadMoreVisible(false)
      }
      setArticleListError(true)
    } finally {
      if (requestId === latestRequestId.current && loadingRequestKey.current === loadingKey) {
        loadingRequestKey.current = null
      }
      if (isLatestRequest() && isRequestSessionCurrent()) {
        setIsArticleListReady(true)
      }
    }
  }, [getEntries, source, sourceId])

  useEffect(() => {
    // The existing list owner also owns Home's guarded canonical count reconciliation.
    // Task 2's Home skip lived here, so subscribing here preserves its request/session lifecycle.
    return subscribeArticleListTotalRefresh(getEntries, { from: source, id: sourceId })
  }, [automaticRequestKey, getEntries, source, sourceId])

  useEffect(() => {
    void fetchArticleList()

    return () => {
      latestRequestId.current += 1
      loadingRequestKey.current = null
    }
  }, [automaticRequestKey, fetchArticleList])

  return { fetchArticleList }
}

export default useArticleList
