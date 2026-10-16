// Marks an explicit, already computed set of entry IDs as read and reports which IDs the provider
// acknowledged. Undo must only ever receive `acknowledgedIds`.
export const markRelativeEntriesAsRead = async ({
  entryIds,
  sessionRevision,
  updateEntriesStatusInBatches,
  onBatchAcknowledged,
}) => {
  const requestedIds = [...new Set(entryIds)]
  if (requestedIds.length === 0) {
    return { acknowledgedIds: [], requestedCount: 0, status: "empty" }
  }

  const acknowledgedIds = new Set()
  try {
    await updateEntriesStatusInBatches(requestedIds, "read", {
      sessionRevision,
      onBatchUpdated: (batchIds) => {
        const acknowledgedBatch = [...new Set(batchIds)]
        for (const entryId of acknowledgedBatch) {
          acknowledgedIds.add(entryId)
        }
        try {
          onBatchAcknowledged?.(acknowledgedBatch)
        } catch (error) {
          // A UI reconciliation failure must not turn an acknowledged batch into a failed one.
          console.error("Failed to reconcile acknowledged relative mark-read batch:", error)
        }
      },
    })
  } catch (error) {
    if (acknowledgedIds.size !== requestedIds.length) {
      return {
        acknowledgedIds: [...acknowledgedIds],
        error,
        requestedCount: requestedIds.length,
        status: acknowledgedIds.size > 0 ? "partial" : "failed",
      }
    }
  }

  return {
    acknowledgedIds: [...acknowledgedIds],
    requestedCount: requestedIds.length,
    status: "success",
  }
}

export default markRelativeEntriesAsRead
