const STALE_SESSION_MESSAGE = "Stale entry update session"

// Sends explicit entry IDs in sequential batches. `onBatchUpdated` runs only after the provider
// accepted a batch, so callers can treat the union of reported batches as acknowledged. A failed
// batch throws before the callback and later batches are never attempted.
export const updateEntryIdsInBatches = async ({
  entryIds,
  batchSize,
  send,
  sessionRevision,
  getSessionRevision,
  onBatchUpdated,
}) => {
  for (let batchStart = 0; batchStart < entryIds.length; batchStart += batchSize) {
    if (sessionRevision !== getSessionRevision()) {
      throw new Error(STALE_SESSION_MESSAGE)
    }
    const batch = entryIds.slice(batchStart, batchStart + batchSize)
    await send(batch)
    onBatchUpdated?.(batch)
    if (sessionRevision !== getSessionRevision()) {
      throw new Error(STALE_SESSION_MESSAGE)
    }
  }

  return entryIds.length
}

export default updateEntryIdsInBatches
