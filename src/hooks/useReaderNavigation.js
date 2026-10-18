import { Message } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useCallback, useMemo, useState } from "react"

import { getCategoryEntries, getFeedEntries } from "@/apis"
import useContentContext from "@/hooks/useContentContext"
import { polyglotState } from "@/hooks/useLanguage"
import {
  contentState,
  setArticleListSource,
  setEntries,
  setHomePaginationBoundary,
  setLoadMoreVisible,
  setTotal,
} from "@/store/contentState"
import {
  dataState,
  getDataSessionRevision,
  isEntryScopeFullyVisible,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import buildArticleListRequestKey from "@/utils/article-list-request-key"
import { get24HoursAgoTimestamp } from "@/utils/date"
import prepareEntry from "@/utils/entry-presentation"
import { getHomePaginationBoundary } from "@/utils/home-editorial-session"
import {
  appendReaderPageEntries,
  buildReaderPageRequest,
  createReaderNavigationOperationGate,
  hasReaderPaginationContinuation,
  resolveReaderNavigation,
} from "@/utils/reader-navigation"
import { getNextUnreadSources } from "@/utils/source-navigation"

const idsEqual = (left, right) => String(left) === String(right)
const EMPTY_PROVEN_ENDS = new Set()

const useReaderNavigation = ({ source, sourceId, getEntries, homeProjection }) => {
  const { entryListRef, handleEntryClick } = useContentContext()
  const content = useStore(contentState)
  const settings = useStore(settingsState)
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const { polyglot } = useStore(polyglotState)
  const [operationGate] = useState(() => createReaderNavigationOperationGate())
  const [isResolving, setIsResolving] = useState(false)
  const [provenEndState, setProvenEndState] = useState({
    identity: null,
    values: EMPTY_PROVEN_ENDS,
  })

  const listRequestKey = buildArticleListRequestKey({
    content,
    settings,
    info: { from: source, id: sourceId },
    sessionRevision,
  })
  const sequenceIds = useMemo(() => {
    if (source === "home") {
      if (homeProjection?.requestKey !== listRequestKey) {
        return []
      }
      return [...homeProjection.highlightIds, ...homeProjection.recentIds]
    }
    return content.entries.map(({ id }) => id)
  }, [content.entries, homeProjection, listRequestKey, source])
  const activeSequenceIndex = sequenceIds.findIndex((id) => idsEqual(id, content.activeContent?.id))
  const navigationIdentity = JSON.stringify([
    listRequestKey,
    content.activeContent?.id,
    sequenceIds,
  ])
  const provenEnds =
    provenEndState.identity === navigationIdentity ? provenEndState.values : EMPTY_PROVEN_ENDS

  const canContinue = useCallback(
    (direction, context = {}) => {
      if (direction !== "next") {
        return false
      }
      const latest = contentState.get()
      if (source === "home") {
        return Boolean(latest.loadMoreVisible)
      }
      const total = context.total ?? latest.total
      return Boolean(latest.loadMoreVisible || total > (context.entries ?? latest.entries).length)
    },
    [source],
  )

  const isOperationCurrent = useCallback(
    ({ entryId, requestKey, revision }) => {
      const latest = contentState.get()
      return (
        revision === getDataSessionRevision() &&
        requestKey ===
          buildArticleListRequestKey({
            content: latest,
            settings: settingsState.get(),
            info: { from: source, id: sourceId },
            sessionRevision: getDataSessionRevision(),
          }) &&
        latest.infoFrom === source &&
        idsEqual(latest.infoId ?? "", sourceId ?? "") &&
        idsEqual(latest.activeContent?.id, entryId)
      )
    },
    [source, sourceId],
  )

  const fetchPage = useCallback(
    async ({ direction, mode }) => {
      const latestContent = contentState.get()
      const latestSettings = settingsState.get()
      const request = buildReaderPageRequest({
        source: { from: source, id: sourceId },
        content:
          source === "home" &&
          (latestContent.homePaginationBoundary?.requestKey !== listRequestKey ||
            latestContent.homePaginationBoundary?.sessionRevision !== getDataSessionRevision())
            ? { ...latestContent, homePaginationBoundary: null }
            : latestContent,
        settings: latestSettings,
        entries: latestContent.entries,
        direction,
        mode,
        todayPublishedAfter: source === "today" ? get24HoursAgoTimestamp() : undefined,
      })
      if (source === "home") {
        return getEntries({ pageSize: request.pageSize, cursor: request.cursor })
      }

      const scope = ["feed", "category"].includes(source) ? source : "global"
      const filterParams = {
        ...request.filterParams,
        globally_visible: !isEntryScopeFullyVisible(scope, sourceId),
      }
      return getEntries(request.status, request.starred, filterParams)
    },
    [getEntries, listRequestKey, source, sourceId],
  )

  const appendPage = useCallback(
    ({ entries: pageEntries, direction, sequenceIds: currentSequenceIds, response }) => {
      const latest = contentState.get()
      const appended = appendReaderPageEntries({
        currentEntries: latest.entries,
        pageEntries: pageEntries.map((entry) => prepareEntry(entry)),
        sequenceIds: currentSequenceIds,
        direction,
        source,
        removeDuplicates: settingsState.get().removeDuplicates,
        homeHighlightIds: homeProjection?.highlightIds,
      })
      if (appended.newEntries.length === 0) {
        if (Number.isFinite(response?.total)) {
          setLoadMoreVisible(false)
        }
        return { entries: latest.entries, sequenceIds: currentSequenceIds }
      }

      setEntries(appended.entries)
      if (Number.isFinite(response?.total)) {
        setTotal(response.total)
        setLoadMoreVisible(hasReaderPaginationContinuation(response, settings.pageSize))
      }
      if (source === "home") {
        const requestKey = buildArticleListRequestKey({
          content: latest,
          settings: settingsState.get(),
          info: { from: source, id: sourceId },
          sessionRevision: getDataSessionRevision(),
        })
        setHomePaginationBoundary({
          requestKey,
          sessionRevision: getDataSessionRevision(),
          cursor: getHomePaginationBoundary(pageEntries),
        })
      }
      return { entries: appended.entries, sequenceIds: appended.sequenceIds }
    },
    [homeProjection?.highlightIds, settings.pageSize, source, sourceId],
  )

  const fetchSourceEntries = useCallback(async (targetSource) => {
    const latestSettings = settingsState.get()
    const filterParams = {
      order: latestSettings.orderBy,
      direction: latestSettings.orderDirection,
      limit: latestSettings.pageSize,
      globally_visible: !isEntryScopeFullyVisible(targetSource.type, targetSource.id),
    }
    return targetSource.type === "feed"
      ? getFeedEntries(targetSource.id, "unread", false, filterParams)
      : getCategoryEntries(targetSource.id, "unread", false, filterParams)
  }, [])

  const scrollSelectedEntryIntoView = useCallback(
    (entryId) => {
      globalThis.setTimeout(() => {
        const elements = entryListRef.current?.el?.querySelectorAll("[data-entry-id]") ?? []
        const selectedCard = [...elements].find((element) =>
          idsEqual(element.dataset.entryId, entryId),
        )
        selectedCard?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 250)
    },
    [entryListRef],
  )

  const navigate = useCallback(
    (direction, mode) => {
      if (!content.activeContent) {
        return Promise.resolve()
      }
      const entryId = content.activeContent.id
      const requestKey = listRequestKey
      const revision = sessionRevision
      const operationIsCurrent = () => isOperationCurrent({ entryId, requestKey, revision })
      const endKey = `${mode}:${direction}`

      if (provenEnds.has(endKey)) {
        return Promise.resolve({ status: "end", reason: "scope-exhausted" })
      }

      return operationGate.run(async () => {
        setIsResolving(true)
        try {
          const resolved = await resolveReaderNavigation({
            activeEntryId: entryId,
            direction,
            mode,
            source: { from: source, id: sourceId },
            getEntries: () => contentState.get().entries,
            getSequenceIds: () => sequenceIds,
            canContinue,
            fetchPage,
            appendPage,
            isCurrent: operationIsCurrent,
            getNextSources: () =>
              getNextUnreadSources({ type: source, id: sourceId }, categories, feeds),
            fetchSourceEntries,
          })
          if (resolved.status === "stale") {
            return resolved
          }
          if (resolved.status === "error") {
            Message.error(polyglot?.t("content.entry_unavailable"))
            return resolved
          }
          if (resolved.status === "end") {
            setProvenEndState((previous) => ({
              identity: navigationIdentity,
              values: new Set([
                ...(previous.identity === navigationIdentity ? previous.values : []),
                endKey,
              ]),
            }))
            if (mode === "unread") {
              Message.info(
                polyglot?.t(
                  direction === "previous"
                    ? "actions.no_previous_unread_article"
                    : "actions.no_next_unread_article",
                ),
              )
            } else {
              Message.info(
                polyglot?.t(
                  direction === "previous"
                    ? "actions.no_previous_article"
                    : "actions.no_next_article",
                ),
              )
            }
            return resolved
          }
          if (!operationIsCurrent()) {
            return { status: "stale" }
          }
          if (resolved.targetSource) {
            setArticleListSource({ from: resolved.targetSource.type, id: resolved.targetSource.id })
            handleEntryClick(resolved.entry, {
              basePath: `/${resolved.targetSource.type}/${resolved.targetSource.id}`,
            })
          } else {
            handleEntryClick(resolved.entry)
          }
          scrollSelectedEntryIntoView(resolved.entry.id)
          return resolved
        } finally {
          setIsResolving(false)
        }
      })
    },
    [
      appendPage,
      canContinue,
      categories,
      content.activeContent,
      fetchPage,
      fetchSourceEntries,
      feeds,
      handleEntryClick,
      isOperationCurrent,
      listRequestKey,
      navigationIdentity,
      operationGate,
      polyglot,
      provenEnds,
      scrollSelectedEntryIntoView,
      sequenceIds,
      sessionRevision,
      source,
      sourceId,
    ],
  )

  const hasLoadedPrevious = activeSequenceIndex > 0
  const hasLoadedNext = activeSequenceIndex >= 0 && activeSequenceIndex < sequenceIds.length - 1
  const canNavigatePrevious = hasLoadedPrevious || canContinue("previous")
  const canNavigateNext = hasLoadedNext || (canContinue("next") && !provenEnds.has("article:next"))

  return {
    canNavigateNext,
    canNavigatePrevious,
    isResolving,
    navigateToNextArticle: () => navigate("next", "article"),
    navigateToPreviousArticle: () => navigate("previous", "article"),
    navigateToNextUnreadArticle: () => navigate("next", "unread"),
    navigateToPreviousUnreadArticle: () => navigate("previous", "unread"),
  }
}

export default useReaderNavigation
