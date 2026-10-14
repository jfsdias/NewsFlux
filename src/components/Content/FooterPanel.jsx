import { Button, Notification, Popconfirm, Radio } from "@arco-design/web-react"
import {
  IconAlignLeft,
  IconCheck,
  IconRecord,
  IconRefresh,
  IconStarFill,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"

import { markEntriesAsReadInBatches } from "@/apis"
import CustomTooltip from "@/components/ui/CustomTooltip"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import { contentState, setActiveContent, setEntries } from "@/store/contentState"
import {
  getDataSessionRevision,
  isEntryScopeFullyVisible,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState, updateSettings } from "@/store/settingsState"
import { hasArticleListFilters } from "@/utils/article-list-filters"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { get24HoursAgoTimestamp } from "@/utils/date"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import findAdjacentItem from "@/utils/navigation"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import "./FooterPanel.css"

const isEntryInMarkAllReadScope = (
  entry,
  { globallyVisible, source, sourceId, visibleFeedIds },
) => {
  const feedId = Number(entry.feed?.id ?? entry.feed_id)
  if (globallyVisible && !visibleFeedIds.has(feedId)) {
    return false
  }
  switch (source) {
    case "all": {
      return true
    }
    case "feed": {
      return feedId === Number(sourceId)
    }
    case "category": {
      return Number(entry.feed?.category?.id) === Number(sourceId)
    }
    case "starred": {
      return Boolean(entry.starred)
    }
    default: {
      return false
    }
  }
}

const updateEntriesAsRead = (entryIds = null, scope = null) => {
  const { activeContent, entries } = contentState.get()
  const { showStatus } = settingsState.get()
  const markedEntryIds = new Set(
    entryIds ??
      entries
        .filter((entry) => !scope || isEntryInMarkAllReadScope(entry, scope))
        .map((entry) => entry.id),
  )
  const isActiveEntryMarkedRead =
    activeContent &&
    (scope ? isEntryInMarkAllReadScope(activeContent, scope) : markedEntryIds.has(activeContent.id))
  if (isActiveEntryMarkedRead) {
    setActiveContent({ ...activeContent, status: "read" })
  }
  setEntries((prev) => reconcileEntriesAfterMarkRead(prev, markedEntryIds, showStatus))
}

const handleFilterChange = (value) => {
  updateSettings({ showStatus: value })
}

const markAllProbeEnabled =
  globalThis.window !== undefined &&
  new URLSearchParams(globalThis.location.search).get("__newsflux_markall_probe") === "1"

const toProbeValue = (value) => {
  try {
    return value === undefined ? "<undefined>" : structuredClone(value)
  } catch {
    return String(value)
  }
}

const getRequestKeyFields = (requestKey) => {
  try {
    return JSON.parse(requestKey)
  } catch {
    return { raw: requestKey }
  }
}

const getRequestKeyDifferences = (initialFields, liveFields) => {
  const fieldNames = new Set([...Object.keys(initialFields), ...Object.keys(liveFields)])
  return [...fieldNames].flatMap((field) => {
    const initialHasField = Object.prototype.hasOwnProperty.call(initialFields, field)
    const liveHasField = Object.prototype.hasOwnProperty.call(liveFields, field)
    const initialValue = initialFields[field]
    const liveValue = liveFields[field]
    if (
      initialHasField === liveHasField &&
      JSON.stringify(initialValue) === JSON.stringify(liveValue)
    ) {
      return []
    }
    return [
      {
        field,
        initial: initialHasField ? toProbeValue(initialValue) : "<missing>",
        live: liveHasField ? toProbeValue(liveValue) : "<missing>",
      },
    ]
  })
}

const getSourceUnreadCount = (source, sourceId, feeds, categories) => {
  if (source === "feed") {
    return feeds.find((feed) => feed.id === Number(sourceId))?.unreadCount ?? null
  }
  if (source === "category") {
    return categories.find((category) => category.id === Number(sourceId))?.unreadCount ?? null
  }
  return null
}

const getUnreadCounts = (items) => items.map(({ id, unreadCount }) => ({ id, unreadCount }))

const getNextCandidate = (source, sourceId, categories, feeds) => {
  if (source === "category") {
    const currentIndex = categories.findIndex((category) => category.id === Number(sourceId))
    return {
      currentIndex,
      orderedItems: categories,
      candidate: findAdjacentItem(categories, currentIndex, "next", {
        predicate: (category) => category.unreadCount > 0,
        wrap: true,
      }),
    }
  }
  if (source === "feed") {
    const orderedItems = categories.flatMap((category) =>
      feeds.filter((feed) => feed.category.id === category.id),
    )
    const currentIndex = orderedItems.findIndex((feed) => feed.id === Number(sourceId))
    return {
      currentIndex,
      orderedItems,
      candidate: findAdjacentItem(orderedItems, currentIndex, "next", {
        predicate: (feed) => feed.unreadCount > 0,
        wrap: true,
      }),
    }
  }
  return { currentIndex: -1, orderedItems: [], candidate: undefined }
}

const getProbeCandidate = (candidate) =>
  candidate ? { id: candidate.id, unreadCount: candidate.unreadCount } : null

const getNoCandidateReason = ({ closureIndex, closureCandidate, liveCandidate }) => {
  if (closureCandidate) {
    return "NAVIGATE_CALLED"
  }
  if (liveCandidate) {
    return "CLOSURE_STALE_LIVE_CANDIDATE_EXISTS"
  }
  return closureIndex < 0 ? "NO_CLOSURE_CANDIDATE" : "NO_LIVE_CANDIDATE"
}

const copyProbeDiagnostics = async () => {
  const diagnostics = JSON.stringify(globalThis.__NEWSFLUX_MARK_ALL_PROBE__, null, 2)
  try {
    if (globalThis.navigator.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(diagnostics)
      return
    }
    const textarea = globalThis.document.createElement("textarea")
    textarea.value = diagnostics
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    globalThis.document.body.append(textarea)
    textarea.select()
    globalThis.document.execCommand("copy")
    textarea.remove()
  } catch {
    // Copy is an optional diagnostic convenience and must not affect the list controls.
  }
}

const MarkAllReadButton = ({ disabled, from, loading, onConfirm }) => {
  const { polyglot } = useStore(polyglotState)
  const { skipMarkAllReadConfirmation } = useStore(settingsState, {
    keys: ["skipMarkAllReadConfirmation"],
  })

  const isHidden = from === "history"
  const markAllReadLabel = polyglot.t("article_list.mark_all_as_read_tooltip")
  const [confirmVisible, setConfirmVisible] = useState(false)

  const button = (
    <CustomTooltip mini content={markAllReadLabel}>
      <Button
        aria-busy={loading}
        aria-expanded={skipMarkAllReadConfirmation ? undefined : confirmVisible}
        aria-label={markAllReadLabel}
        className="nf-glass-control"
        disabled={disabled || loading}
        icon={<IconCheck aria-hidden="true" />}
        loading={loading}
        shape="circle"
        style={{ visibility: isHidden ? "hidden" : "visible" }}
        onClick={skipMarkAllReadConfirmation ? onConfirm : undefined}
      />
    </CustomTooltip>
  )

  if (skipMarkAllReadConfirmation) {
    return button
  }

  return (
    <Popconfirm
      autoFocus
      focusLock
      className="mark-all-read-popconfirm"
      popupVisible={confirmVisible}
      title={polyglot.t("article_list.mark_all_as_read_confirm")}
      triggerProps={{
        boundaryDistance: { bottom: 8, left: 8, right: 8, top: 8 },
      }}
      onOk={onConfirm}
      onVisibleChange={setConfirmVisible}
    >
      {button}
    </Popconfirm>
  )
}

const FooterPanel = ({ getEntries, info, refreshArticleList, markAllAsRead }) => {
  const { from: source, id: sourceId } = info
  const { isArticleListReady } = useStore(contentState, { keys: ["isArticleListReady"] })
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [probeRecord, setProbeRecord] = useState(null)
  const markingAllReadRef = useRef(false)
  const probeRecordRef = useRef(null)
  const { markAllReadJumpToNext, showStatus } = useStore(settingsState, {
    keys: ["markAllReadJumpToNext", "showStatus"],
  })
  const { polyglot } = useStore(polyglotState)
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const refreshCounts = useRefreshCounts()
  const navigate = useNavigate()
  const refreshLabel = polyglot.t("article_list.refresh_tooltip")

  const recordProbe = (phase, details = {}) => {
    if (!markAllProbeEnabled) {
      return
    }
    try {
      const safeDetails = toProbeValue(details)
      const previous = probeRecordRef.current ?? {}
      const next = {
        ...previous,
        ...safeDetails,
        phases: [
          ...(previous.phases ?? []),
          { phase, capturedAt: new Date().toISOString(), ...safeDetails },
        ],
      }
      probeRecordRef.current = next
      globalThis.__NEWSFLUX_MARK_ALL_PROBE__ = next
      setProbeRecord(next)
    } catch {
      // Diagnostics must never interrupt the Mark-all-read flow.
    }
  }

  const jumpToNext = () => {
    if (source === "category") {
      const currentIndex = categories.findIndex((category) => category.id === Number(sourceId))
      const next = findAdjacentItem(categories, currentIndex, "next", {
        predicate: (category) => category.unreadCount > 0,
        wrap: true,
      })
      let liveEvaluation
      if (markAllProbeEnabled) {
        liveEvaluation = getNextCandidate(
          source,
          sourceId,
          visibleCategoriesState.get(),
          visibleFeedsState.get(),
        )
        recordProbe("JUMP_EVALUATION", {
          JUMP_TO_NEXT_ENTERED: true,
          CURRENT_CATEGORY_INDEX_CLOSURE: currentIndex,
          CURRENT_CATEGORY_INDEX_LIVE: liveEvaluation.currentIndex,
          ORDERED_CATEGORY_IDS_CLOSURE: categories.map(({ id }) => id),
          ORDERED_CATEGORY_IDS_LIVE: liveEvaluation.orderedItems.map(({ id }) => id),
          UNREAD_COUNTS_CLOSURE: getUnreadCounts(categories),
          UNREAD_COUNTS_LIVE: getUnreadCounts(liveEvaluation.orderedItems),
          NEXT_CANDIDATE_CLOSURE: getProbeCandidate(next),
          NEXT_CANDIDATE_LIVE: getProbeCandidate(liveEvaluation.candidate),
        })
      }
      if (next) {
        const target = `/category/${next.id}`
        if (markAllProbeEnabled) {
          recordProbe("NAVIGATE", {
            NAVIGATE_CALLED: true,
            NAVIGATE_TARGET: target,
            NO_CANDIDATE_REASON: "NAVIGATE_CALLED",
          })
        }
        navigate(target)
      } else if (markAllProbeEnabled) {
        recordProbe("NO_CANDIDATE", {
          NAVIGATE_CALLED: false,
          NAVIGATE_TARGET: null,
          NO_CANDIDATE_REASON: getNoCandidateReason({
            closureIndex: currentIndex,
            closureCandidate: next,
            liveCandidate: liveEvaluation?.candidate,
          }),
        })
      }
    } else if (source === "feed") {
      const orderedFeeds = categories.flatMap((category) =>
        feeds.filter((feed) => feed.category.id === category.id),
      )
      const currentIndex = orderedFeeds.findIndex((feed) => feed.id === Number(sourceId))
      const next = findAdjacentItem(orderedFeeds, currentIndex, "next", {
        predicate: (feed) => feed.unreadCount > 0,
        wrap: true,
      })
      let liveEvaluation
      if (markAllProbeEnabled) {
        liveEvaluation = getNextCandidate(
          source,
          sourceId,
          visibleCategoriesState.get(),
          visibleFeedsState.get(),
        )
        recordProbe("JUMP_EVALUATION", {
          JUMP_TO_NEXT_ENTERED: true,
          CURRENT_FEED_INDEX_CLOSURE: currentIndex,
          CURRENT_FEED_INDEX_LIVE: liveEvaluation.currentIndex,
          ORDERED_FEED_IDS_CLOSURE: orderedFeeds.map(({ id }) => id),
          ORDERED_FEED_IDS_LIVE: liveEvaluation.orderedItems.map(({ id }) => id),
          UNREAD_COUNTS_CLOSURE: getUnreadCounts(orderedFeeds),
          UNREAD_COUNTS_LIVE: getUnreadCounts(liveEvaluation.orderedItems),
          NEXT_CANDIDATE_CLOSURE: getProbeCandidate(next),
          NEXT_CANDIDATE_LIVE: getProbeCandidate(liveEvaluation.candidate),
        })
      }
      if (next) {
        const target = `/feed/${next.id}`
        if (markAllProbeEnabled) {
          recordProbe("NAVIGATE", {
            NAVIGATE_CALLED: true,
            NAVIGATE_TARGET: target,
            NO_CANDIDATE_REASON: "NAVIGATE_CALLED",
          })
        }
        navigate(target)
      } else if (markAllProbeEnabled) {
        recordProbe("NO_CANDIDATE", {
          NAVIGATE_CALLED: false,
          NAVIGATE_TARGET: null,
          NO_CANDIDATE_REASON: getNoCandidateReason({
            closureIndex: currentIndex,
            closureCandidate: next,
            liveCandidate: liveEvaluation?.candidate,
          }),
        })
      }
    } else if (markAllProbeEnabled) {
      recordProbe("JUMP_EVALUATION", {
        JUMP_TO_NEXT_ENTERED: true,
        NEXT_CANDIDATE_CLOSURE: null,
        NEXT_CANDIDATE_LIVE: null,
      })
      recordProbe("NO_CANDIDATE", {
        NAVIGATE_CALLED: false,
        NAVIGATE_TARGET: null,
        NO_CANDIDATE_REASON: "NO_LIVE_CANDIDATE",
      })
    }
  }

  const handleMarkAllAsRead = async () => {
    if (
      markingAllReadRef.current ||
      !contentState.get().isArticleListReady ||
      source === "history"
    ) {
      return
    }

    const content = { ...contentState.get(), infoFrom: source, infoId: sourceId }
    const settings = settingsState.get()
    const sessionRevision = getDataSessionRevision()
    const requestKey = createArticleListRequestKey({ content, settings })
    const initialRequestKeyFields = markAllProbeEnabled ? getRequestKeyFields(requestKey) : null
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentList = () =>
      isCurrentSession() &&
      requestKey ===
        createArticleListRequestKey({
          content: contentState.get(),
          settings: settingsState.get(),
        })
    const captureLiveProbePhase = (phase, countsRefreshResult) => {
      if (!markAllProbeEnabled) {
        return
      }
      const previous = probeRecordRef.current ?? {}
      const liveContent = contentState.get()
      const liveSettings = settingsState.get()
      const liveFeeds = visibleFeedsState.get()
      const liveCategories = visibleCategoriesState.get()
      const liveRequestKey = createArticleListRequestKey({
        content: liveContent,
        settings: liveSettings,
      })
      const liveRequestKeyFields = getRequestKeyFields(liveRequestKey)
      const isAfterMutation = phase === "AFTER_MUTATION"
      const stage = isAfterMutation ? "afterMutation" : "afterCountsRefresh"
      const liveStage = isAfterMutation ? "liveAfterMutation" : "liveAfterCountsRefresh"
      const previousRequestKey = previous.requestKey ?? {}
      recordProbe(phase, {
        MARK_ALL_REQUEST_RESOLVED: true,
        markAllReadJumpToNext: {
          ...previous.markAllReadJumpToNext,
          closure: markAllReadJumpToNext,
          live: liveSettings.markAllReadJumpToNext,
        },
        showStatus: {
          ...previous.showStatus,
          closure: showStatus,
          initial: settings.showStatus,
          [liveStage]: liveSettings.showStatus,
        },
        showUnreadFeedsOnly: {
          ...previous.showUnreadFeedsOnly,
          initial: settings.showUnreadFeedsOnly,
          [liveStage]: liveSettings.showUnreadFeedsOnly,
        },
        sessionRevision: {
          ...previous.sessionRevision,
          initial: sessionRevision,
          [stage]: getDataSessionRevision(),
        },
        requestKey: {
          ...previousRequestKey,
          initialCaptured: { value: requestKey, fields: initialRequestKeyFields },
          [liveStage]: { value: liveRequestKey, fields: liveRequestKeyFields },
          differencesFromInitial: {
            ...previousRequestKey.differencesFromInitial,
            [stage]: getRequestKeyDifferences(initialRequestKeyFields, liveRequestKeyFields),
          },
        },
        isCurrentSession: {
          ...previous.isCurrentSession,
          [stage]: isCurrentSession(),
        },
        isCurrentList: {
          ...previous.isCurrentList,
          [stage]: isCurrentList(),
        },
        [`CURRENT_SOURCE_UNREAD_COUNT_LIVE_${stage.toUpperCase()}`]: getSourceUnreadCount(
          source,
          sourceId,
          liveFeeds,
          liveCategories,
        ),
        [`LIVE_FEED_UNREAD_COUNTS_${stage.toUpperCase()}`]: getUnreadCounts(liveFeeds),
        [`LIVE_CATEGORY_UNREAD_COUNTS_${stage.toUpperCase()}`]: getUnreadCounts(liveCategories),
        ...(isAfterMutation ? {} : { COUNTS_REFRESH_RESULT: countsRefreshResult }),
      })
    }
    const isFeedOrCategory = ["feed", "category"].includes(source)
    const starred = isFeedOrCategory && settings.showStatus === "starred"
    const useBatches = hasArticleListFilters(content) || starred || source === "today"
    const scope = isFeedOrCategory ? source : "global"
    const filterParams = {
      filterDate: source === "today" ? null : content.filterDate,
      globally_visible: !isEntryScopeFullyVisible(scope, sourceId),
      order: source === "starred" ? "changed_at" : settings.orderBy,
      direction: settings.orderDirection,
      ...(content.filterString && { search: content.filterString }),
      ...(source === "today" && { published_after: get24HoursAgoTimestamp() }),
    }

    const fastPathScope = {
      source,
      sourceId,
      globallyVisible: filterParams.globally_visible,
      visibleFeedIds: new Set(visibleFeedsState.get().map((feed) => Number(feed.id))),
    }

    markingAllReadRef.current = true
    setMarkingAllRead(true)
    if (markAllProbeEnabled) {
      probeRecordRef.current = null
      globalThis.__NEWSFLUX_MARK_ALL_PROBE__ = null
      setProbeRecord(null)
      recordProbe("BEFORE_MUTATION", {
        source,
        sourceId,
        markAllReadJumpToNext: {
          closure: markAllReadJumpToNext,
          live: settingsState.get().markAllReadJumpToNext,
        },
        showStatus: { closure: showStatus, initial: settings.showStatus },
        showUnreadFeedsOnly: { initial: settings.showUnreadFeedsOnly },
        sessionRevision: { initial: sessionRevision },
        requestKey: {
          initialCaptured: { value: requestKey, fields: initialRequestKeyFields },
          differencesFromInitial: { afterMutation: [], afterCountsRefresh: [] },
        },
        isCurrentSession: { beforeMutation: isCurrentSession() },
        isCurrentList: { beforeMutation: isCurrentList() },
        CLOSURE_SOURCE_UNREAD_COUNT_BEFORE_MUTATION: getSourceUnreadCount(
          source,
          sourceId,
          feeds,
          categories,
        ),
        CLOSURE_FEED_UNREAD_COUNTS_BEFORE_MUTATION: getUnreadCounts(feeds),
        CLOSURE_CATEGORY_UNREAD_COUNTS_BEFORE_MUTATION: getUnreadCounts(categories),
        USE_BATCHES: useBatches,
        MARK_ALL_REQUEST_RESOLVED: false,
        COUNTS_REFRESH_RESULT: null,
        JUMP_CONDITION_SETTING: null,
        JUMP_CONDITION_CURRENT_LIST: null,
        JUMP_TO_NEXT_ENTERED: false,
        NAVIGATE_CALLED: false,
        NAVIGATE_TARGET: null,
        NO_CANDIDATE_REASON: "UNKNOWN",
      })
    }
    try {
      await runEntryMutation(() => {
        if (!useBatches) {
          return markAllAsRead()
        }

        return markEntriesAsReadInBatches(
          (status, options) => getEntries(status, starred, options),
          {
            filterParams,
            onBatchMarkedRead: (entryIds) => {
              if (isCurrentList()) {
                updateEntriesAsRead(entryIds)
              }
            },
          },
        )
      })

      if (!isCurrentSession()) {
        if (markAllProbeEnabled) {
          const previousProbeRecord = probeRecordRef.current ?? {}
          const liveSettings = settingsState.get()
          const liveRequestKey = createArticleListRequestKey({
            content: contentState.get(),
            settings: liveSettings,
          })
          const liveRequestKeyFields = getRequestKeyFields(liveRequestKey)
          recordProbe("AFTER_MUTATION", {
            MARK_ALL_REQUEST_RESOLVED: true,
            markAllReadJumpToNext: {
              closure: markAllReadJumpToNext,
              live: liveSettings.markAllReadJumpToNext,
            },
            showStatus: {
              closure: showStatus,
              initial: settings.showStatus,
              liveAfterMutation: liveSettings.showStatus,
            },
            showUnreadFeedsOnly: {
              initial: settings.showUnreadFeedsOnly,
              liveAfterMutation: liveSettings.showUnreadFeedsOnly,
            },
            sessionRevision: {
              initial: sessionRevision,
              afterMutation: getDataSessionRevision(),
            },
            requestKey: {
              initialCaptured: { value: requestKey, fields: initialRequestKeyFields },
              liveAfterMutation: { value: liveRequestKey, fields: liveRequestKeyFields },
              differencesFromInitial: {
                afterMutation: getRequestKeyDifferences(
                  initialRequestKeyFields,
                  liveRequestKeyFields,
                ),
              },
            },
            isCurrentSession: {
              beforeMutation: previousProbeRecord.isCurrentSession?.beforeMutation ?? null,
              afterMutation: isCurrentSession(),
            },
            isCurrentList: {
              beforeMutation: previousProbeRecord.isCurrentList?.beforeMutation ?? null,
              afterMutation: isCurrentList(),
            },
            CURRENT_SOURCE_UNREAD_COUNT_LIVE_AFTER_MUTATION: getSourceUnreadCount(
              source,
              sourceId,
              visibleFeedsState.get(),
              visibleCategoriesState.get(),
            ),
            LIVE_FEED_UNREAD_COUNTS_AFTER_MUTATION: getUnreadCounts(visibleFeedsState.get()),
            LIVE_CATEGORY_UNREAD_COUNTS_AFTER_MUTATION: getUnreadCounts(
              visibleCategoriesState.get(),
            ),
            NO_CANDIDATE_REASON: "SESSION_STALE",
          })
          recordProbe("NO_CANDIDATE", { NO_CANDIDATE_REASON: "SESSION_STALE" })
        }
        return
      }
      if (!useBatches && isCurrentList()) {
        updateEntriesAsRead(null, fastPathScope)
      }
      if (markAllProbeEnabled) {
        const previousProbeRecord = probeRecordRef.current ?? {}
        const liveSettings = settingsState.get()
        const liveRequestKey = createArticleListRequestKey({
          content: contentState.get(),
          settings: liveSettings,
        })
        const liveRequestKeyFields = getRequestKeyFields(liveRequestKey)
        recordProbe("AFTER_MUTATION", {
          MARK_ALL_REQUEST_RESOLVED: true,
          markAllReadJumpToNext: {
            closure: markAllReadJumpToNext,
            live: liveSettings.markAllReadJumpToNext,
          },
          showStatus: {
            closure: showStatus,
            initial: settings.showStatus,
            liveAfterMutation: liveSettings.showStatus,
          },
          showUnreadFeedsOnly: {
            initial: settings.showUnreadFeedsOnly,
            liveAfterMutation: liveSettings.showUnreadFeedsOnly,
          },
          sessionRevision: {
            initial: sessionRevision,
            afterMutation: getDataSessionRevision(),
          },
          requestKey: {
            initialCaptured: { value: requestKey, fields: initialRequestKeyFields },
            liveAfterMutation: { value: liveRequestKey, fields: liveRequestKeyFields },
            differencesFromInitial: {
              afterMutation: getRequestKeyDifferences(
                initialRequestKeyFields,
                liveRequestKeyFields,
              ),
            },
          },
          isCurrentSession: {
            beforeMutation: true,
            afterMutation: isCurrentSession(),
          },
          isCurrentList: {
            beforeMutation: true,
            afterMutation: isCurrentList(),
          },
          CURRENT_SOURCE_UNREAD_COUNT_LIVE_AFTER_MUTATION: getSourceUnreadCount(
            source,
            sourceId,
            visibleFeedsState.get(),
            visibleCategoriesState.get(),
          ),
          LIVE_FEED_UNREAD_COUNTS_AFTER_MUTATION: getUnreadCounts(visibleFeedsState.get()),
          LIVE_CATEGORY_UNREAD_COUNTS_AFTER_MUTATION: getUnreadCounts(visibleCategoriesState.get()),
        })
      }
      const countsRefreshResult = await refreshCounts({ force: true })
      if (markAllProbeEnabled) {
        const previousProbeRecord = probeRecordRef.current ?? {}
        const liveSettings = settingsState.get()
        const liveRequestKey = createArticleListRequestKey({
          content: contentState.get(),
          settings: liveSettings,
        })
        const liveRequestKeyFields = getRequestKeyFields(liveRequestKey)
        recordProbe("AFTER_COUNTS_REFRESH", {
          COUNTS_REFRESH_RESULT: countsRefreshResult,
          markAllReadJumpToNext: {
            closure: markAllReadJumpToNext,
            live: liveSettings.markAllReadJumpToNext,
          },
          showStatus: {
            closure: showStatus,
            initial: settings.showStatus,
            liveAfterMutation: previousProbeRecord.showStatus?.liveAfterMutation ?? null,
            liveAfterCountsRefresh: liveSettings.showStatus,
          },
          showUnreadFeedsOnly: {
            initial: settings.showUnreadFeedsOnly,
            liveAfterMutation: previousProbeRecord.showUnreadFeedsOnly?.liveAfterMutation ?? null,
            liveAfterCountsRefresh: liveSettings.showUnreadFeedsOnly,
          },
          sessionRevision: {
            initial: sessionRevision,
            afterMutation: previousProbeRecord.sessionRevision?.afterMutation ?? null,
            afterCountsRefresh: getDataSessionRevision(),
          },
          requestKey: {
            initialCaptured: { value: requestKey, fields: initialRequestKeyFields },
            liveAfterMutation: probeRecordRef.current?.requestKey?.liveAfterMutation ?? null,
            liveAfterCountsRefresh: { value: liveRequestKey, fields: liveRequestKeyFields },
            differencesFromInitial: {
              ...probeRecordRef.current?.requestKey?.differencesFromInitial,
              afterCountsRefresh: getRequestKeyDifferences(
                initialRequestKeyFields,
                liveRequestKeyFields,
              ),
            },
          },
          isCurrentSession: {
            beforeMutation: previousProbeRecord.isCurrentSession?.beforeMutation ?? null,
            afterMutation: previousProbeRecord.isCurrentSession?.afterMutation ?? null,
            afterCountsRefresh: isCurrentSession(),
          },
          isCurrentList: {
            beforeMutation: previousProbeRecord.isCurrentList?.beforeMutation ?? null,
            afterMutation: previousProbeRecord.isCurrentList?.afterMutation ?? null,
            afterCountsRefresh: isCurrentList(),
          },
          CURRENT_SOURCE_UNREAD_COUNT_LIVE_AFTER_COUNTS_REFRESH: getSourceUnreadCount(
            source,
            sourceId,
            visibleFeedsState.get(),
            visibleCategoriesState.get(),
          ),
          LIVE_FEED_UNREAD_COUNTS_AFTER_COUNTS_REFRESH: getUnreadCounts(visibleFeedsState.get()),
          LIVE_CATEGORY_UNREAD_COUNTS_AFTER_COUNTS_REFRESH: getUnreadCounts(
            visibleCategoriesState.get(),
          ),
        })
      }
      if (!isCurrentSession()) {
        if (markAllProbeEnabled) {
          recordProbe("NO_CANDIDATE", { NO_CANDIDATE_REASON: "SESSION_STALE" })
        }
        return
      }

      Notification.success({
        title: polyglot.t("article_list.mark_all_as_read_success"),
      })
      if (markAllProbeEnabled) {
        const previousProbeRecord = probeRecordRef.current ?? {}
        const jumpConditionCurrentList = isCurrentList()
        recordProbe("BEFORE_JUMP_DECISION", {
          markAllReadJumpToNext: {
            closure: markAllReadJumpToNext,
            live: settingsState.get().markAllReadJumpToNext,
          },
          isCurrentSession: {
            beforeMutation: previousProbeRecord.isCurrentSession?.beforeMutation ?? null,
            afterMutation: previousProbeRecord.isCurrentSession?.afterMutation ?? null,
            afterCountsRefresh: isCurrentSession(),
          },
          isCurrentList: {
            beforeMutation: previousProbeRecord.isCurrentList?.beforeMutation ?? null,
            afterMutation: previousProbeRecord.isCurrentList?.afterMutation ?? null,
            afterCountsRefresh: previousProbeRecord.isCurrentList?.afterCountsRefresh ?? null,
            immediatelyBeforeJumpCondition: jumpConditionCurrentList,
          },
          JUMP_CONDITION_SETTING: markAllReadJumpToNext,
          JUMP_CONDITION_CURRENT_LIST: jumpConditionCurrentList,
        })
        if (markAllReadJumpToNext && jumpConditionCurrentList) {
          jumpToNext()
        } else {
          recordProbe("NO_CANDIDATE", {
            NO_CANDIDATE_REASON: markAllReadJumpToNext ? "LIST_KEY_CHANGED" : "SETTING_DISABLED",
          })
        }
      } else if (markAllReadJumpToNext && isCurrentList()) {
        jumpToNext()
      }
    } catch (error) {
      if (!isCurrentSession()) {
        return
      }
      console.error("Failed to mark all as read:", error)
      if (isCurrentList()) {
        await refreshArticleList()
      }
      await refreshCounts({ force: true })
      if (isCurrentSession()) {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
          content: error.message,
        })
      }
    } finally {
      markingAllReadRef.current = false
      setMarkingAllRead(false)
    }
  }

  const baseFilterOptions = [
    {
      label: polyglot.t("article_list.filter_status_unread"),
      value: "unread",
      icon: <IconRecord aria-hidden="true" />,
    },
    {
      label: polyglot.t("article_list.filter_status_all"),
      value: "all",
      icon: <IconAlignLeft aria-hidden="true" />,
    },
  ]

  const starredOption = {
    label: polyglot.t("article_list.filter_status_starred"),
    value: "starred",
    icon: <IconStarFill aria-hidden="true" />,
  }

  const filterOptions = ["category", "feed"].includes(source)
    ? [starredOption, ...baseFilterOptions]
    : baseFilterOptions

  const renderRadioButton = (option) => {
    const isSelected = showStatus === option.value
    return (
      <Radio key={option.value} value={option.value}>
        {option.icon}
        <span
          className={`entry-panel-filter-label${isSelected ? "" : " entry-panel-filter-label-hidden"}`}
        >
          {option.label}
        </span>
      </Radio>
    )
  }

  useEffect(() => {
    if (showStatus === "starred" && ["all", "today", "starred"].includes(source)) {
      updateSettings({ showStatus: "all" })
    }
  }, [source, showStatus])

  const probeSetting =
    probeRecord?.JUMP_CONDITION_SETTING ?? probeRecord?.markAllReadJumpToNext?.closure ?? "UNKNOWN"
  const probeStatus =
    probeRecord?.showStatus?.liveAfterCountsRefresh ??
    probeRecord?.showStatus?.liveAfterMutation ??
    probeRecord?.showStatus?.initial ??
    "UNKNOWN"
  const probeSessionCurrent =
    probeRecord?.isCurrentSession?.afterCountsRefresh ??
    probeRecord?.isCurrentSession?.afterMutation ??
    "UNKNOWN"
  const probeListCurrent =
    probeRecord?.isCurrentList?.afterCountsRefresh ??
    probeRecord?.isCurrentList?.immediatelyBeforeJumpCondition ??
    "UNKNOWN"

  return (
    <>
      <div className="entry-panel">
        <MarkAllReadButton
          disabled={!isArticleListReady}
          from={source}
          loading={markingAllRead}
          onConfirm={handleMarkAllAsRead}
        />
        <Radio.Group
          className="nf-glass-group entry-panel-filter-group"
          style={{ visibility: source === "history" ? "hidden" : "visible" }}
          type="button"
          value={showStatus}
          onChange={handleFilterChange}
        >
          {filterOptions.map((option) => renderRadioButton(option))}
        </Radio.Group>
        <CustomTooltip mini content={refreshLabel}>
          <Button
            aria-label={refreshLabel}
            className="nf-glass-control"
            icon={<IconRefresh aria-hidden="true" />}
            loading={!isArticleListReady}
            shape="circle"
            onClick={refreshArticleList}
          />
        </CustomTooltip>
      </div>
      {markAllProbeEnabled && (
        <aside
          aria-label="Mark all read runtime diagnostics"
          style={{
            position: "fixed",
            top: 8,
            right: 8,
            zIndex: 9999,
            width: "min(320px, calc(100vw - 16px))",
            padding: 8,
            border: "1px solid #6b7280",
            borderRadius: 6,
            background: "rgba(255, 255, 255, 0.97)",
            color: "#111827",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.18)",
            font: "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
            pointerEvents: "none",
          }}
        >
          <div style={{ fontWeight: 700 }}>MARK_ALL_PROBE</div>
          <div>setting={String(probeSetting)}</div>
          <div>showStatus={String(probeStatus)}</div>
          <div>sessionCurrent={String(probeSessionCurrent)}</div>
          <div>listCurrentAfterRefresh={String(probeListCurrent)}</div>
          <div>jumpEntered={String(Boolean(probeRecord?.JUMP_TO_NEXT_ENTERED))}</div>
          <div>closureCandidate={probeRecord?.NEXT_CANDIDATE_CLOSURE?.id ?? "NONE"}</div>
          <div>liveCandidate={probeRecord?.NEXT_CANDIDATE_LIVE?.id ?? "NONE"}</div>
          <div>navigate={probeRecord?.NAVIGATE_TARGET ?? "NO"}</div>
          <div>reason={probeRecord?.NO_CANDIDATE_REASON ?? "UNKNOWN"}</div>
          <button
            style={{ pointerEvents: "auto", marginTop: 4 }}
            type="button"
            onClick={copyProbeDiagnostics}
          >
            Copy diagnostics
          </button>
        </aside>
      )}
    </>
  )
}

export default FooterPanel
