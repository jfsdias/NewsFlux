export const MARK_ALL_READ_UNDO_DURATION_MS = 8000
export const MARK_ALL_READ_UNDO_NOTIFICATION_ID = "footer-mark-all-read-undo"

export const createTimedOneShotActionStore = ({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onEvent = () => {},
} = {}) => {
  let activeAction = null
  let nextToken = 0

  const clear = (token, trigger = "clear") => {
    if (!activeAction || (token !== undefined && activeAction.token !== token)) {
      return false
    }

    clearTimer(activeAction.timer)
    activeAction = null
    onEvent("MARK_ALL_UNDO_TOKEN_CLEARED", {
      clearTrigger: trigger,
      undoTokenPresent: false,
    })
    return true
  }

  const expire = (token) => {
    if (!activeAction || activeAction.token !== token) {
      return false
    }

    const { onExpire, timer } = activeAction
    clearTimer(timer)
    activeAction = null
    onEvent("MARK_ALL_UNDO_EXPIRED", { undoTokenPresent: false })
    onExpire?.()
    return true
  }

  return {
    clear,
    consume(token) {
      if (!activeAction || activeAction.token !== token) {
        return null
      }
      if (now() >= activeAction.expiresAt) {
        expire(token)
        return null
      }

      const { value } = activeAction
      clear(token, "undo_consumed")
      return value
    },
    replace(value, { durationMs = MARK_ALL_READ_UNDO_DURATION_MS, onExpire } = {}) {
      clear(undefined, "replaced")
      const token = ++nextToken
      const timer = setTimer(() => expire(token), durationMs)
      activeAction = { expiresAt: now() + durationMs, onExpire, timer, token, value }
      onEvent("MARK_ALL_UNDO_CREATED", { undoTokenPresent: true })
      return token
    },
    hasActiveAction() {
      return activeAction !== null
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
