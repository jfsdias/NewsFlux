import {
  Button,
  Dropdown,
  Menu,
  Modal,
  Notification,
  Popconfirm,
  Radio,
} from "@arco-design/web-react"
import {
  IconAlignLeft,
  IconCheck,
  IconClockCircle,
  IconRecord,
  IconRefresh,
  IconStarFill,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useRef, useState } from "react"
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
import {
  AGE_BASED_READ_PRESETS,
  getAgeReadConfirmationBoundaries,
  markAgeBasedUnreadEntriesAsRead,
} from "@/utils/age-based-mark-read"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { get24HoursAgoTimestamp } from "@/utils/date"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import {
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  markAllReadOperationCoordinator,
  markAllReadUndoActions,
  performCoordinatedMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import findAdjacentItem from "@/utils/navigation"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import "./FooterPanel.css"

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

const MarkAllReadButton = ({ disabled, from, id, loading, onConfirm }) => {
  const { polyglot } = useStore(polyglotState)
  const { skipMarkAllReadConfirmation } = useStore(settingsState, {
    keys: ["skipMarkAllReadConfirmation"],
  })

  const isHidden = from === "history"
  const markAllReadLabel = polyglot.t("article_list.mark_all_as_read_tooltip")
  const [confirmVisible, setConfirmVisible] = useState(false)
  const triggerRef = useRef(null)
  const getScopedListIdentity = useCallback(
    () =>
      JSON.stringify([
        createArticleListRequestKey({
          content: contentState.get(),
          settings: settingsState.get(),
          info: { from, id },
        }),
        getDataSessionRevision(),
      ]),
    [from, id],
  )
  const scopedListIdentity = getScopedListIdentity()
  const [pendingFocusReturn, setPendingFocusReturn] = useState(null)

  const handleVisibleChange = (visible) => {
    setConfirmVisible(visible)
  }

  const handleConfirm = async () => {
    const confirmedListIdentity = scopedListIdentity
    await onConfirm()
    setPendingFocusReturn(confirmedListIdentity)
  }

  // Wait for Arco to close and the async trigger to become enabled again.
  useEffect(() => {
    if (!pendingFocusReturn || confirmVisible || disabled || loading) {
      return
    }

    const frame = requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (
        trigger?.isConnected &&
        !trigger.disabled &&
        getScopedListIdentity() === pendingFocusReturn &&
        document.activeElement !== trigger
      ) {
        trigger.focus({ preventScroll: true })
      }
      setPendingFocusReturn(null)
    })

    return () => cancelAnimationFrame(frame)
  }, [
    confirmVisible,
    disabled,
    getScopedListIdentity,
    loading,
    pendingFocusReturn,
    scopedListIdentity,
  ])

  const button = (
    <CustomTooltip mini content={markAllReadLabel}>
      <Button
        ref={triggerRef}
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
      onOk={handleConfirm}
      onVisibleChange={handleVisibleChange}
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
  const [markingOlderRead, setMarkingOlderRead] = useState(false)
  const markingOlderReadRef = useRef(false)
  const [ageMenuVisible, setAgeMenuVisible] = useState(false)
  const [agePresetDays, setAgePresetDays] = useState(null)
  const listScopeRef = useRef({ from: source, id: sourceId })
  useEffect(() => {
    listScopeRef.current = { from: source, id: sourceId }
  }, [source, sourceId])
  const { markAllReadJumpToNext, showStatus } = useStore(settingsState, {
    keys: ["markAllReadJumpToNext", "showStatus"],
  })
  const { polyglot } = useStore(polyglotState)
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const refreshCounts = useRefreshCounts()
  const navigate = useNavigate()
  const refreshLabel = polyglot.t("article_list.refresh_tooltip")
  const getCurrentListIdentity = () => {
    const { from, id } = listScopeRef.current
    const content = { ...contentState.get(), infoFrom: from, infoId: id }
    return createArticleListRequestKey({
      content,
      settings: settingsState.get(),
      info: { from, id },
      sessionRevision: getDataSessionRevision(),
    })
  }

  const handleUndoMarkAllRead = async (token) => {
    await performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onConsume: (consumedToken) =>
        Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
      onError: (error) => {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
          content: error.message,
        })
      },
    })
  }

  const handleUndoOlderRead = async (token) => {
    await performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onConsume: (consumedToken) =>
        Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
      onError: (error) => {
        Notification.error({
          title: polyglot.t("article_list.mark_older_as_read_error"),
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

    const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
    if (operationLease === null) {
      return
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

      const previousUndoToken = markAllReadUndoActions.getCurrentToken()
      markAllReadUndoActions.clear()
      if (previousUndoToken !== null) {
        Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
      }
      const undoEntryIds = [...markedEntryIds]
      if (undoEntryIds.length > 0) {
        let token
        token = markAllReadUndoActions.replace(
          { entryIds: undoEntryIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
          },
        )
        Notification.success({
          id: getMarkAllReadUndoNotificationId(token),
          title: polyglot.t("article_list.mark_all_as_read_success"),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoMarkAllRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => markAllReadUndoActions.clear(token),
        })
      } else {
        Notification.success({
          title: polyglot.t("article_list.mark_all_as_read_success"),
        })
      }
      if (markAllReadJumpToNext && isCurrentList()) {
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
      markAllReadOperationCoordinator.release(operationLease)
      markingAllReadRef.current = false
      setMarkingAllRead(false)
    }
  }

  const handleConfirmOlderRead = async () => {
    const ageDays = agePresetDays
    const { from: confirmedSource, id: confirmedSourceId } = listScopeRef.current
    if (
      !ageDays ||
      markingOlderReadRef.current ||
      markingAllReadRef.current ||
      !contentState.get().isArticleListReady ||
      confirmedSource === "history"
    ) {
      setAgePresetDays(null)
      return
    }

    const confirmedAtMs = Date.now()
    const { cutoff, publishedAfter } = getAgeReadConfirmationBoundaries(
      ageDays,
      confirmedSource,
      confirmedAtMs,
    )
    const content = { ...contentState.get(), infoFrom: confirmedSource, infoId: confirmedSourceId }
    const settings = settingsState.get()
    const sessionRevision = getDataSessionRevision()
    const requestKey = getCurrentListIdentity()
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentList = () => isCurrentSession() && requestKey === getCurrentListIdentity()
    const starred =
      ["feed", "category"].includes(confirmedSource) && settings.showStatus === "starred"
    const scope = ["feed", "category"].includes(confirmedSource) ? confirmedSource : "global"
    const filterParams = {
      filterDate: confirmedSource === "today" ? null : content.filterDate,
      globally_visible: !isEntryScopeFullyVisible(scope, confirmedSourceId),
      order: confirmedSource === "starred" ? "changed_at" : settings.orderBy,
      direction: settings.orderDirection,
      ...(content.filterString && { search: content.filterString }),
      ...(confirmedSource === "today" && { published_after: publishedAfter }),
    }

    const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
    if (operationLease === null) {
      setAgePresetDays(null)
      return
    }

    markingOlderReadRef.current = true
    setMarkingOlderRead(true)
    try {
      // Reuse the confirmation-time boundaries throughout discovery and mutation.
      const result = await runEntryMutation(() =>
        markAgeBasedUnreadEntriesAsRead({
          cutoff,
          fetchEntries: (status, options) => getEntries(status, starred, options),
          filterParams,
          getSessionRevision: getDataSessionRevision,
          isCurrentList,
          sessionRevision,
          updateEntriesStatusInBatches,
          onBatchAcknowledged: (entryIds) => {
            if (isCurrentList()) {
              updateEntriesAsRead(entryIds)
            }
          },
        }),
      )

      if (!isCurrentSession() || result.status === "stale") {
        return
      }
      if (result.status === "empty") {
        return
      }

      await refreshCounts({ force: true })
      if (!isCurrentSession()) {
        return
      }
      if (isCurrentList()) {
        invalidateArticleList()
      }

      if (result.status === "success" || result.status === "partial") {
        const previousUndoToken = markAllReadUndoActions.getCurrentToken()
        markAllReadUndoActions.clear()
        if (previousUndoToken !== null) {
          Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
        }

        let token
        token = markAllReadUndoActions.replace(
          { entryIds: result.acknowledgedIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
          },
        )
        const notification = {
          id: getMarkAllReadUndoNotificationId(token),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoOlderRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => markAllReadUndoActions.clear(token),
        }

        if (result.status === "partial") {
          Notification.warning({
            ...notification,
            title: polyglot.t("article_list.mark_older_as_read_partial", {
              marked: result.acknowledgedIds.length,
              total: result.requestedCount,
            }),
          })
        } else {
          Notification.success({
            ...notification,
            title: polyglot.t("article_list.mark_older_as_read_success", {
              smart_count: result.acknowledgedIds.length,
            }),
          })
        }
      } else {
        console.error("Failed to mark older articles as read:", result.error)
        Notification.error({
          title: polyglot.t("article_list.mark_older_as_read_error"),
          content: result.error?.message,
        })
      }
    } finally {
      markAllReadOperationCoordinator.release(operationLease)
      markingOlderReadRef.current = false
      setMarkingOlderRead(false)
      setAgePresetDays(null)
    }
  }

  const getAgePresetLabel = (days) =>
    polyglot.t("article_list.mark_older_as_read_preset", {
      age: polyglot.t("date.days", days),
    })

  const markOlderReadLabel = polyglot.t("article_list.mark_older_as_read_tooltip")
  const agePresetMenu = (
    <Menu
      onClickMenuItem={(key) => {
        setAgeMenuVisible(false)
        setAgePresetDays(Number(key))
      }}
    >
      {AGE_BASED_READ_PRESETS.map((days) => (
        <Menu.Item key={days}>{getAgePresetLabel(days)}</Menu.Item>
      ))}
    </Menu>
  )

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
        id={sourceId}
        loading={markingAllRead}
        onConfirm={handleMarkAllAsRead}
      />
      {source !== "history" && (
        <Dropdown
          droplist={agePresetMenu}
          popupVisible={ageMenuVisible}
          trigger="click"
          onVisibleChange={setAgeMenuVisible}
        >
          <CustomTooltip mini content={markOlderReadLabel}>
            <Button
              aria-expanded={ageMenuVisible}
              aria-haspopup="menu"
              aria-label={markOlderReadLabel}
              className="nf-glass-control"
              disabled={!isArticleListReady || markingAllRead || markingOlderRead}
              icon={<IconClockCircle aria-hidden="true" />}
              loading={markingOlderRead}
              shape="circle"
              size="small"
            />
          </CustomTooltip>
        </Dropdown>
      )}
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
      <Modal
        className="mark-older-read-modal"
        confirmLoading={markingOlderRead}
        title={agePresetDays === null ? markOlderReadLabel : getAgePresetLabel(agePresetDays)}
        visible={agePresetDays !== null}
        onCancel={() => setAgePresetDays(null)}
        onOk={handleConfirmOlderRead}
      >
        <p>
          {agePresetDays === null
            ? markOlderReadLabel
            : polyglot.t("article_list.mark_older_as_read_confirm", {
                age: polyglot.t("date.days", agePresetDays),
              })}
        </p>
      </Modal>
    </div>
  )
}

export default FooterPanel
