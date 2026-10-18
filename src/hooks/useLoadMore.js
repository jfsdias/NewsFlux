import { Message } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { atom } from "nanostores"
import { useRef } from "react"

import { markDuplicatesAsRead } from "@/hooks/useEntryActions"
import { polyglotState } from "@/hooks/useLanguage"
import {
  contentState,
  setEntries,
  setEntriesWithDeduplication,
  setHomePaginationBoundary,
  setLoadMoreError,
  setLoadMoreVisible,
} from "@/store/contentState"
import { getDataSessionRevision } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import {
  getEntryMutationSnapshot,
  isEntryMutationSnapshotCurrent,
  waitForEntryMutations,
} from "@/utils/entry-mutation-state"
import prepareEntry from "@/utils/entry-presentation"
import { getHomePaginationBoundary } from "@/utils/home-editorial-session"
import createSetter from "@/utils/nanostores"
import { buildPaginationCursorParams } from "@/utils/pagination-cursor"

const loadingMoreState = atom(false)
const setLoadingMore = createSetter(loadingMoreState)

const haveSameIds = (left, right) =>
  left.size === right.size && [...left].every((entryId) => right.has(entryId))

const useLoadMore = () => {
  const { filterString, infoFrom, loadMoreError } = useStore(contentState, {
    keys: ["filterString", "infoFrom", "loadMoreError"],
  })
  const { polyglot } = useStore(polyglotState)
  const { pageSize, showStatus, orderBy, orderDirection } = useStore(settingsState, {
    keys: ["pageSize", "showStatus", "orderBy", "orderDirection"],
  })
  const loadingMore = useStore(loadingMoreState)
  const paginationProgressRef = useRef({
    committedEntryIds: new Set(),
    requestKey: null,
    seenResponseEntryIds: new Set(),
    snapshotRevision: -1,
  })

  const updateEntries = (newEntries) => {
    const currentEntries = contentState.get().entries
    const seenEntryIds = new Set(currentEntries.map((entry) => entry.id))
    const uniqueNewEntries = newEntries.filter(({ id }) => {
      if (seenEntryIds.has(id)) {
        return false
      }

      seenEntryIds.add(id)
      return true
    })
    const combinedEntries = [...currentEntries, ...uniqueNewEntries]
    if (infoFrom === "home") {
      setEntries(combinedEntries)
    } else {
      const duplicateEntries = setEntriesWithDeduplication(combinedEntries)
      markDuplicatesAsRead(duplicateEntries)
    }
  }

  const getFilterParams = (currentEntries, requestKey, sessionRevision) => {
    if (currentEntries.length === 0) {
      return {}
    }

    if (infoFrom === "home") {
      const boundary = contentState.get().homePaginationBoundary
      const cursor =
        boundary?.requestKey === requestKey && boundary.sessionRevision === sessionRevision
          ? boundary.cursor
          : getHomePaginationBoundary(currentEntries)
      return cursor === null ? {} : { published_before: cursor }
    }

    return buildPaginationCursorParams({
      entries: currentEntries,
      sortProperty,
      orderDirection: cursorDirection,
    })
  }

  const sortProperty =
    infoFrom === "home"
      ? "published_at"
      : ["starred", "history"].includes(infoFrom)
        ? "changed_at"
        : orderBy
  const cursorDirection = infoFrom === "home" ? "desc" : orderDirection

  const getCurrentArticleListRequestKey = () =>
    createArticleListRequestKey({
      content: contentState.get(),
      settings: settingsState.get(),
      sessionRevision: getDataSessionRevision(),
    })

  const handleLoadMore = async (getEntries) => {
    if (loadingMoreState.get()) {
      return
    }

    const requestKey = getCurrentArticleListRequestKey()
    const requestSessionRevision = getDataSessionRevision()
    const requestSnapshotRevision = contentState.get().articleListSnapshotRevision
    const isCurrentRequest = () =>
      requestKey === getCurrentArticleListRequestKey() &&
      requestSessionRevision === getDataSessionRevision() &&
      requestSnapshotRevision === contentState.get().articleListSnapshotRevision
    const synchronizePaginationProgress = () => {
      const currentEntryIds = new Set(contentState.get().entries.map(({ id }) => id))
      const paginationProgress = paginationProgressRef.current
      if (
        paginationProgress.requestKey !== requestKey ||
        paginationProgress.snapshotRevision !== requestSnapshotRevision ||
        !haveSameIds(paginationProgress.committedEntryIds, currentEntryIds)
      ) {
        paginationProgressRef.current = {
          committedEntryIds: currentEntryIds,
          requestKey,
          seenResponseEntryIds: new Set(currentEntryIds),
          snapshotRevision: requestSnapshotRevision,
        }
      }
    }

    setLoadMoreError(false)
    setLoadingMore(true)

    try {
      let response
      let shouldRetry
      do {
        const mutationSnapshot = getEntryMutationSnapshot()
        if (mutationSnapshot.pendingRequests > 0) {
          const canContinue = await waitForEntryMutations(mutationSnapshot)
          if (!canContinue || !isCurrentRequest()) {
            return
          }
          shouldRetry = true
          continue
        }

        synchronizePaginationProgress()
        const filterParams = getFilterParams(
          contentState.get().entries,
          requestKey,
          requestSessionRevision,
        )
        if (infoFrom !== "home" && filterString) {
          filterParams.search = filterString
        }

        if (infoFrom === "starred") {
          response = await getEntries(showStatus === "unread" ? "unread" : null, null, filterParams)
        } else if (infoFrom === "history") {
          response = await getEntries(null, null, filterParams)
        } else {
          if (infoFrom === "home") {
            response = await getEntries({ pageSize, cursor: filterParams.published_before })
          } else {
            switch (showStatus) {
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
        }

        if (!isCurrentRequest()) {
          return
        }

        shouldRetry = !isEntryMutationSnapshotCurrent(mutationSnapshot)
        if (shouldRetry) {
          const canRetry = await waitForEntryMutations(mutationSnapshot)
          if (!canRetry || !isCurrentRequest()) {
            return
          }
        }
      } while (shouldRetry)

      const isValidResponse =
        Array.isArray(response?.entries) && Number.isFinite(response?.total) && response.total >= 0
      if (!isValidResponse) {
        throw new TypeError("Invalid entries response")
      }

      const progress = paginationProgressRef.current
      const responseEntryIds = new Set(response.entries.map(({ id }) => id))
      const hasNewResponseEntries = [...responseEntryIds].some(
        (entryId) => !progress.seenResponseEntryIds.has(entryId),
      )

      if (response.entries.length > 0 && !hasNewResponseEntries) {
        console.warn("Stopped loading more articles because the pagination cursor did not advance")
        setLoadMoreVisible(false)
        return
      }

      if (response.entries.length > 0) {
        const newEntries = response.entries.map((entry) => prepareEntry(entry))
        updateEntries(newEntries)
        if (infoFrom === "home") {
          setHomePaginationBoundary({
            requestKey,
            sessionRevision: requestSessionRevision,
            cursor: getHomePaginationBoundary(response.entries),
          })
        }
        for (const entryId of responseEntryIds) {
          progress.seenResponseEntryIds.add(entryId)
        }
        progress.committedEntryIds = new Set(contentState.get().entries.map(({ id }) => id))
      }
      if (response.total <= pageSize || response.entries.length < pageSize) {
        setLoadMoreVisible(false)
      }
    } catch (error) {
      console.error("Error fetching more articles:", error)
      if (!isCurrentRequest()) {
        return
      }

      setLoadMoreError(true)
      Message.error(polyglot.t("article_list.load_more_error"))
    } finally {
      setLoadingMore(false)
    }
  }

  return { handleLoadMore, loadMoreError, loadingMore }
}

export default useLoadMore
