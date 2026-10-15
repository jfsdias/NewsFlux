export const MARK_ALL_READ_UNDO_DURATION_MS = 8000
export const MARK_ALL_READ_UNDO_NOTIFICATION_ID = "footer-mark-all-read-undo"
export const getMarkAllReadUndoNotificationId = (token) =>
  `${MARK_ALL_READ_UNDO_NOTIFICATION_ID}-${token}`

export const createTimedOneShotActionStore = ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) => {
  let activeAction = null
  let nextToken = 0

  const clear = (token) => {
    if (!activeAction || (token !== undefined && activeAction.token !== token)) {
      return false
    }

    clearTimer(activeAction.timer)
    activeAction = null
    return true
  }

  const expire = (token) => {
    if (!activeAction || activeAction.token !== token) {
      return false
    }

    const { onExpire, timer } = activeAction
    clearTimer(timer)
    activeAction = null
    onExpire?.()
    return true
  }

  return {
    clear,
    getCurrentToken() {
      return activeAction?.token ?? null
    },
    consume(token) {
      if (!activeAction || activeAction.token !== token) {
        return null
      }
      if (now() >= activeAction.expiresAt) {
        expire(token)
        return null
      }

      const { value } = activeAction
      clear(token)
      return value
    },
    replace(value, { durationMs = MARK_ALL_READ_UNDO_DURATION_MS, onExpire } = {}) {
      clear()
      const token = ++nextToken
      const timer = setTimer(() => expire(token), durationMs)
      activeAction = { expiresAt: now() + durationMs, onExpire, timer, token, value }
      return token
    },
  }
}

export const performMarkAllReadUndo = async ({
  entryIds,
  sessionRevision,
  getCurrentSessionRevision,
  updateEntriesStatusInBatches,
  refreshCounts,
  invalidateArticleList,
  onError,
}) => {
  if (sessionRevision !== getCurrentSessionRevision()) {
    return { status: "stale" }
  }

  const reconcile = async () => {
    try {
      await refreshCounts({ force: true })
    } catch (error) {
      console.error("Failed to refresh counts after mark-all undo:", error)
    } finally {
      invalidateArticleList()
    }
  }

  try {
    await updateEntriesStatusInBatches(entryIds, "unread", { sessionRevision })
  } catch (error) {
    await reconcile()
    onError?.(error)
    return { error, status: "failed" }
  }

  await reconcile()
  return { status: "success" }
}
