// Native Node ESM tests require the explicit file extension.
// eslint-disable-next-line import/extensions
import { markAllReadOperationCoordinator } from "./mark-all-read-undo.js"

const runSelectedReadBatches = async ({
  entryIds,
  sessionRevision,
  getCurrentSessionRevision,
  updateEntriesStatusInBatches,
  operationCoordinator = markAllReadOperationCoordinator,
  onBatchAcknowledged,
  onResult,
}) => {
  const requestedIds = [...new Set(entryIds)]
  if (sessionRevision !== getCurrentSessionRevision()) {
    return { status: "stale", acknowledgedIds: [] }
  }
  if (requestedIds.length === 0) {
    return { status: "empty", acknowledgedIds: [] }
  }

  const operationLease = operationCoordinator.acquire(sessionRevision)
  if (operationLease === null) {
    return { status: "busy", acknowledgedIds: [] }
  }

  const acknowledgedIds = new Set()
  const isCurrentSession = () => sessionRevision === getCurrentSessionRevision()

  try {
    let result
    try {
      await updateEntriesStatusInBatches(requestedIds, "read", {
        sessionRevision,
        onBatchUpdated: (batchIds) => {
          if (!isCurrentSession()) {
            return
          }
          const newlyAcknowledgedIds = batchIds.filter((id) => !acknowledgedIds.has(id))
          if (newlyAcknowledgedIds.length === 0) {
            return
          }
          for (const id of newlyAcknowledgedIds) {
            acknowledgedIds.add(id)
          }
          onBatchAcknowledged?.(newlyAcknowledgedIds)
        },
      })
      result = isCurrentSession()
        ? { status: "success", acknowledgedIds: [...acknowledgedIds] }
        : { status: "stale", acknowledgedIds: [] }
    } catch (error) {
      result = isCurrentSession()
        ? {
            status: acknowledgedIds.size > 0 ? "partial" : "failure",
            acknowledgedIds: [...acknowledgedIds],
            error,
            requestedCount: requestedIds.length,
          }
        : { status: "stale", acknowledgedIds: [] }
    }

    if (result.status === "stale") {
      return result
    }

    await onResult?.(result)
    return isCurrentSession() ? result : { status: "stale", acknowledgedIds: [] }
  } finally {
    operationCoordinator.release(operationLease)
  }
}

export default runSelectedReadBatches
