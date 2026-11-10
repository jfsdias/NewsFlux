import { Button, Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { createElement, useCallback, useRef, useState } from "react"

import { updateEntriesStatusInBatches } from "@/apis"
import useAppData from "@/hooks/useAppData"
import { polyglotState } from "@/hooks/useLanguage"
import {
  contentState,
  invalidateArticleList,
  setActiveContent,
  setEntries,
} from "@/store/contentState"
import {
  getDataSessionRevision,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import { hasArticleListFilters } from "@/utils/article-list-filters"
import { getEligibleArticleSelectionIds } from "@/utils/article-selection"
import { createBulkReadFeedback, getBulkReadScopeLabel } from "@/utils/bulk-read-feedback"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import {
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  markAllReadUndoActions,
  performCoordinatedMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import runSelectedReadBatches from "@/utils/selected-read-operation"

const useMarkSelectedRead = (selection) => {
  const { polyglot } = useStore(polyglotState)
  const { refreshCounts } = useAppData()
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const [isBusy, setIsBusy] = useState(false)
  const busyRef = useRef(false)

  const handleUndo = useCallback(
    async (token, sessionRevision) => {
      const guardedRefreshCounts = async (options) => {
        if (sessionRevision !== getDataSessionRevision()) {
          return
        }
        const result = await refreshCounts({ ...options, includeEntrySummary: true })
        if (result?.error) {
          throw new Error(result.error)
        }
      }
      await performCoordinatedMarkAllReadUndo({
        token,
        getCurrentSessionRevision: getDataSessionRevision,
        updateEntriesStatusInBatches,
        refreshCounts: guardedRefreshCounts,
        invalidateArticleList: () => {
          if (sessionRevision === getDataSessionRevision()) {
            invalidateArticleList()
          }
        },
        onConsume: (consumedToken) =>
          Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
        onError: () => {
          if (sessionRevision === getDataSessionRevision()) {
            Notification.error({
              title: polyglot.t("article_selection.undo_error"),
            })
          }
        },
      })
    },
    [polyglot, refreshCounts],
  )

  const offerUndo = useCallback(
    (acknowledgedIds, sessionRevision, countsError, result, scope) => {
      const previousUndoToken = markAllReadUndoActions.getCurrentToken()
      markAllReadUndoActions.clear()
      if (previousUndoToken !== null) {
        Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
      }

      let token
      token = markAllReadUndoActions.replace(
        { entryIds: acknowledgedIds, sessionRevision },
        {
          durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
          onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
        },
      )
      const notification = {
        id: getMarkAllReadUndoNotificationId(token),
        duration: MARK_ALL_READ_UNDO_DURATION_MS,
        btn: createElement(
          Button,
          { size: "small", onClick: () => void handleUndo(token, sessionRevision) },
          polyglot.t("actions.undo"),
        ),
        onClose: () => markAllReadUndoActions.clear(token),
      }

      const feedback = createBulkReadFeedback({
        operation: "selected",
        status: result.status,
        acknowledgedIds,
        requestedCount: result.requestedCount,
        scope,
      })

      if (result.status === "partial") {
        Notification.warning({
          ...notification,
          title: polyglot.t(feedback.titleKey, feedback.titleParams),
          content: countsError?.message ?? result.error?.message,
        })
      } else if (countsError) {
        Notification.error({
          ...notification,
          title: polyglot.t("article_selection.counts_refresh_error_scoped", {
            smart_count: acknowledgedIds.length,
            scope,
          }),
          content: countsError.message,
        })
      } else {
        Notification.success({
          ...notification,
          title: polyglot.t(feedback.titleKey, feedback.titleParams),
        })
      }
    },
    [handleUndo, polyglot],
  )

  const markSelectedRead = useCallback(async () => {
    if (busyRef.current) {
      return { status: "busy" }
    }

    const content = contentState.get()
    const scope = getBulkReadScopeLabel({
      from: content.infoFrom,
      id: content.infoId,
      isFiltered: hasArticleListFilters(content),
      categories,
      feeds,
      polyglot,
    })
    const sessionRevision = getDataSessionRevision()
    const scopeKey = selection.getCurrentScopeKey()
    if (!selection.isSelectionMode || content.activeContent || selection.scopeKey !== scopeKey) {
      return { status: "stale" }
    }

    const eligibleIds = getEligibleArticleSelectionIds(content.entries)
    const entryIds = [...selection.selectedIds].filter((entryId) => eligibleIds.has(entryId))
    if (entryIds.length === 0) {
      return { status: "empty" }
    }

    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentScope = () => scopeKey === selection.getCurrentScopeKey()
    busyRef.current = true
    setIsBusy(true)
    selection.setSelectionLocked(true)

    try {
      return await runSelectedReadBatches({
        entryIds,
        sessionRevision,
        getCurrentSessionRevision: getDataSessionRevision,
        updateEntriesStatusInBatches: (ids, status, options) =>
          runEntryMutation(() => updateEntriesStatusInBatches(ids, status, options)),
        onBatchAcknowledged: (acknowledgedIds) => {
          if (!isCurrentSession() || !isCurrentScope()) {
            return
          }
          const { activeContent } = contentState.get()
          if (activeContent && acknowledgedIds.includes(activeContent.id)) {
            setActiveContent({ ...activeContent, status: "read" })
          }
          setEntries((previousEntries) =>
            reconcileEntriesAfterMarkRead(
              previousEntries,
              acknowledgedIds,
              settingsState.get().showStatus,
            ),
          )
          selection.removeAcknowledgedIds(acknowledgedIds, scopeKey)
        },
        onResult: async (result) => {
          if (!isCurrentSession()) {
            return
          }

          invalidateArticleList()
          let countsError = null
          try {
            const refreshResult = await refreshCounts({
              force: true,
              includeEntrySummary: true,
            })
            if (refreshResult?.error) {
              throw new Error(refreshResult.error)
            }
          } catch (error) {
            countsError = error instanceof Error ? error : new Error(String(error))
          }

          if (!isCurrentSession()) {
            return
          }
          invalidateArticleList()

          if (result.acknowledgedIds.length > 0) {
            offerUndo(result.acknowledgedIds, sessionRevision, countsError, result, scope)
            if (result.status === "success" && isCurrentScope()) {
              selection.exitSelectionMode({
                restoreFocus: !contentState.get().activeContent,
              })
            }
            return
          }

          if (result.status === "failure") {
            Notification.error({
              title: polyglot.t("article_selection.read_error_scoped", { scope }),
              content: countsError?.message ?? result.error?.message,
            })
          }
        },
      })
    } finally {
      busyRef.current = false
      selection.setSelectionLocked(false)
      setIsBusy(false)
    }
  }, [categories, feeds, offerUndo, polyglot, refreshCounts, selection])

  return { isBusy, markSelectedRead }
}

export default useMarkSelectedRead
