import { Button, Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { createElement, useCallback } from "react"

import { updateEntriesStatusInBatches } from "@/apis"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import {
  contentState,
  invalidateArticleList,
  setActiveContent,
  setEntries,
} from "@/store/contentState"
import { getDataSessionRevision } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import {
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  markAllReadOperationCoordinator,
  markAllReadUndoActions,
  performCoordinatedMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import markRelativeEntriesAsRead from "@/utils/mark-relative-read"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import { getRelativeUnreadTargetIds } from "@/utils/relative-read-targets"

const updateEntriesAsRead = (entryIds) => {
  const { activeContent } = contentState.get()
  const { showStatus } = settingsState.get()
  const markedEntryIds = new Set(entryIds)
  if (activeContent && markedEntryIds.has(activeContent.id)) {
    setActiveContent({ ...activeContent, status: "read" })
  }
  setEntries((prev) => reconcileEntriesAfterMarkRead(prev, markedEntryIds, showStatus))
}

const getListIdentity = () =>
  createArticleListRequestKey({ content: contentState.get(), settings: settingsState.get() })

// BULK-03A: marks the loaded, unread entries strictly above/below an anchor as read. The write is
// an explicit entry-ID set and Undo reuses the shared one-shot Mark All Undo store/coordinator.
const useMarkRelativeRead = () => {
  const { polyglot } = useStore(polyglotState)
  const refreshCounts = useRefreshCounts()

  const handleUndo = useCallback(
    async (token) => {
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
            title: polyglot.t("article_list.mark_relative_as_read_error"),
            content: error.message,
          })
        },
      })
    },
    [polyglot, refreshCounts],
  )

  const offerUndo = useCallback(
    ({ acknowledgedIds, partialTitle, sessionRevision }) => {
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
          { size: "small", onClick: () => void handleUndo(token) },
          polyglot.t("actions.undo"),
        ),
        onClose: () => markAllReadUndoActions.clear(token),
      }
      if (partialTitle) {
        Notification.warning({ ...notification, title: partialTitle })
      } else {
        Notification.success({
          ...notification,
          title: polyglot.t("article_list.mark_relative_as_read_success", {
            smart_count: acknowledgedIds.length,
          }),
        })
      }
    },
    [handleUndo, polyglot],
  )

  return useCallback(
    async (anchorId, direction) => {
      const targetIds = getRelativeUnreadTargetIds(contentState.get().entries, anchorId, direction)
      if (targetIds.length === 0) {
        return
      }

      const sessionRevision = getDataSessionRevision()
      const listIdentity = getListIdentity()
      const isCurrentSession = () => sessionRevision === getDataSessionRevision()
      const isCurrentList = () => isCurrentSession() && listIdentity === getListIdentity()

      const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
      if (operationLease === null) {
        return
      }

      try {
        const result = await runEntryMutation(() =>
          markRelativeEntriesAsRead({
            entryIds: targetIds,
            sessionRevision,
            updateEntriesStatusInBatches,
            onBatchAcknowledged: (entryIds) => {
              if (isCurrentList()) {
                updateEntriesAsRead(entryIds)
              }
            },
          }),
        )

        if (!isCurrentSession()) {
          return
        }

        if (result.acknowledgedIds.length > 0) {
          await refreshCounts({ force: true })
          if (!isCurrentSession()) {
            return
          }
        }

        if (result.status === "success") {
          offerUndo({ acknowledgedIds: result.acknowledgedIds, sessionRevision })
          return
        }

        console.error("Failed to mark relative articles as read:", result.error)
        if (result.acknowledgedIds.length === 0) {
          await refreshCounts({ force: true })
        }
        if (isCurrentList()) {
          invalidateArticleList()
        }
        if (!isCurrentSession()) {
          return
        }

        if (result.status === "partial") {
          offerUndo({
            acknowledgedIds: result.acknowledgedIds,
            partialTitle: polyglot.t("article_list.mark_relative_as_read_partial", {
              marked: result.acknowledgedIds.length,
              total: result.requestedCount,
            }),
            sessionRevision,
          })
        } else {
          Notification.error({
            title: polyglot.t("article_list.mark_relative_as_read_error"),
            content: result.error?.message,
          })
        }
      } finally {
        markAllReadOperationCoordinator.release(operationLease)
      }
    },
    [offerUndo, polyglot, refreshCounts],
  )
}

export default useMarkRelativeRead
