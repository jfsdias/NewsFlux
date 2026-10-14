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

import { markEntriesAsReadInBatches, updateEntriesStatusInBatches } from "@/apis"
import CustomTooltip from "@/components/ui/CustomTooltip"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import {
  contentState,
  invalidateArticleList,
  setActiveContent,
  setEntries,
} from "@/store/contentState"
import {
  getDataSessionRevision,
  isEntryScopeFullyVisible,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState, updateSettings } from "@/store/settingsState"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { get24HoursAgoTimestamp } from "@/utils/date"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import {
  createTimedOneShotActionStore,
  MARK_ALL_READ_UNDO_DURATION_MS,
  MARK_ALL_READ_UNDO_NOTIFICATION_ID,
  performMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import {
  getMarkAllReadUndoNotificationCount,
  recordMarkAllReadUndoProbeEvent,
  scheduleMarkAllReadUndoNotificationObservation,
  scheduleMarkAllReadUndoProbeFlush,
  stopMarkAllReadUndoNotificationObservationAfterClose,
} from "@/utils/mark-all-read-undo-diagnostics"
import findAdjacentItem from "@/utils/navigation"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import "./FooterPanel.css"

const markAllReadUndoActions = createTimedOneShotActionStore()

const updateEntriesAsRead = (entryIds) => {
  const { activeContent } = contentState.get()
  const { showStatus } = settingsState.get()
  const markedEntryIds = new Set(entryIds)
  if (activeContent && markedEntryIds.has(activeContent.id)) {
    setActiveContent({ ...activeContent, status: "read" })
  }
  setEntries((prev) => reconcileEntriesAfterMarkRead(prev, markedEntryIds, showStatus))
}

const handleFilterChange = (value) => {
  updateSettings({ showStatus: value })
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

const FooterPanel = ({ getEntries, info, refreshArticleList }) => {
  const { from: source, id: sourceId } = info
  const { isArticleListReady } = useStore(contentState, { keys: ["isArticleListReady"] })
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const markingAllReadRef = useRef(false)
  const { markAllReadJumpToNext, showStatus } = useStore(settingsState, {
    keys: ["markAllReadJumpToNext", "showStatus"],
  })
  const { polyglot } = useStore(polyglotState)
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const refreshCounts = useRefreshCounts()
  const navigate = useNavigate()
  const refreshLabel = polyglot.t("article_list.refresh_tooltip")

  const handleUndoMarkAllRead = async (token) => {
    const action = markAllReadUndoActions.consume(token)
    if (!action) {
      return
    }

    recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_CLEARED")
    scheduleMarkAllReadUndoProbeFlush()

    Notification.remove(MARK_ALL_READ_UNDO_NOTIFICATION_ID)
    await performMarkAllReadUndo({
      entryIds: action.entryIds,
      sessionRevision: action.sessionRevision,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onError: (error) => {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
          content: error.message,
        })
      },
    })
  }

  const jumpToNext = () => {
    if (source === "category") {
      const currentIndex = categories.findIndex((category) => category.id === Number(sourceId))
      const next = findAdjacentItem(categories, currentIndex, "next", {
        predicate: (category) => category.unreadCount > 0,
        wrap: true,
      })
      if (next) {
        recordMarkAllReadUndoProbeEvent("NAVIGATE_CALL")
        navigate(`/category/${next.id}`)
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
      if (next) {
        recordMarkAllReadUndoProbeEvent("NAVIGATE_CALL")
        navigate(`/feed/${next.id}`)
      }
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
    const markedEntryIds = new Set()
    const requestKey = createArticleListRequestKey({ content, settings })
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentList = () =>
      isCurrentSession() &&
      requestKey ===
        createArticleListRequestKey({
          content: contentState.get(),
          settings: settingsState.get(),
        })
    const starred = ["feed", "category"].includes(source) && settings.showStatus === "starred"
    const scope = ["feed", "category"].includes(source) ? source : "global"
    const filterParams = {
      filterDate: source === "today" ? null : content.filterDate,
      globally_visible: !isEntryScopeFullyVisible(scope, sourceId),
      order: source === "starred" ? "changed_at" : settings.orderBy,
      direction: settings.orderDirection,
      ...(content.filterString && { search: content.filterString }),
      ...(source === "today" && { published_after: get24HoursAgoTimestamp() }),
    }

    markingAllReadRef.current = true
    setMarkingAllRead(true)
    try {
      await runEntryMutation(() => {
        return markEntriesAsReadInBatches(
          (status, options) => getEntries(status, starred, options),
          {
            filterParams,
            onBatchMarkedRead: (entryIds) => {
              for (const entryId of entryIds) {
                markedEntryIds.add(entryId)
              }
              if (isCurrentList()) {
                updateEntriesAsRead(entryIds)
              }
            },
          },
        )
      })

      if (!isCurrentSession()) {
        return
      }
      await refreshCounts({ force: true })
      if (!isCurrentSession()) {
        return
      }

      recordMarkAllReadUndoProbeEvent("MARK_ALL_COMPLETE")
      if (markAllReadUndoActions.clear()) {
        recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_CLEARED")
      }
      Notification.remove(MARK_ALL_READ_UNDO_NOTIFICATION_ID)
      const undoEntryIds = [...markedEntryIds]
      let notificationBaselineCount = null
      if (undoEntryIds.length > 0) {
        const token = markAllReadUndoActions.replace(
          { entryIds: undoEntryIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => {
              recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_EXPIRED")
              scheduleMarkAllReadUndoProbeFlush()
              Notification.remove(MARK_ALL_READ_UNDO_NOTIFICATION_ID)
            },
          },
        )
        recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_CREATED")
        notificationBaselineCount = getMarkAllReadUndoNotificationCount()
        recordMarkAllReadUndoProbeEvent("UNDO_NOTIFICATION_CALL_START")
        Notification.success({
          id: MARK_ALL_READ_UNDO_NOTIFICATION_ID,
          title: polyglot.t("article_list.mark_all_as_read_success"),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoMarkAllRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => {
            recordMarkAllReadUndoProbeEvent("UNDO_NOTIFICATION_ON_CLOSE")
            if (markAllReadUndoActions.clear(token)) {
              recordMarkAllReadUndoProbeEvent("UNDO_TOKEN_CLEARED")
            }
            scheduleMarkAllReadUndoProbeFlush()
            stopMarkAllReadUndoNotificationObservationAfterClose()
          },
        })
        recordMarkAllReadUndoProbeEvent("UNDO_NOTIFICATION_CALL_RETURNED")
      } else {
        Notification.success({
          title: polyglot.t("article_list.mark_all_as_read_success"),
        })
      }
      if (markAllReadJumpToNext && isCurrentList()) {
        jumpToNext()
      }
      if (notificationBaselineCount !== null) {
        scheduleMarkAllReadUndoNotificationObservation(notificationBaselineCount)
      }
      scheduleMarkAllReadUndoProbeFlush()
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

  return (
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
  )
}

export default FooterPanel
