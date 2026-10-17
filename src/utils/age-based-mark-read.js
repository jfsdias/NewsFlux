import { MAX_ENTRIES_PER_PAGE } from "./constants.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

export const AGE_BASED_READ_PRESETS = Object.freeze([1, 7, 30])

const SECONDS_PER_DAY = 24 * 60 * 60

export const getAgeReadCutoffTimestamp = (ageDays, nowMs = Date.now()) => {
  if (!AGE_BASED_READ_PRESETS.includes(ageDays)) {
    throw new RangeError(`Unsupported age-based mark-as-read preset: ${ageDays}`)
  }
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("The age-based mark-as-read time must be finite")
  }

  return Math.floor(nowMs / 1000) - ageDays * SECONDS_PER_DAY
}

const getPublishedAtTimestamp = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? (Math.abs(value) >= 1e12 ? value / 1000 : value) : Number.NaN
  }

  if (typeof value !== "string" || value.trim() === "") {
    return Number.NaN
  }

  const trimmedValue = value.trim()
  if (/^-?\d+(?:\.\d+)?$/.test(trimmedValue)) {
    const numericValue = Number(trimmedValue)
    return Math.abs(numericValue) >= 1e12 ? numericValue / 1000 : numericValue
  }

  const parsedDate = Date.parse(trimmedValue)
  return Number.isFinite(parsedDate) ? parsedDate / 1000 : Number.NaN
}

export const getAgeBasedUnreadTargetIds = (entries, cutoff) => {
  if (!Number.isFinite(cutoff)) {
    throw new TypeError("The age-based mark-as-read cutoff must be finite")
  }

  const targetIds = new Set()
  for (const entry of entries) {
    if (
      entry?.status === "unread" &&
      entry.id !== undefined &&
      entry.id !== null &&
      getPublishedAtTimestamp(entry.published_at) < cutoff
    ) {
      targetIds.add(entry.id)
    }
  }

  return [...targetIds]
}

const createStaleRequestError = (message) => {
  const error = new Error(message)
  error.name = "StaleAgeBasedMarkReadError"
  return error
}

export const markAgeBasedUnreadEntriesAsRead = async ({
  cutoff,
  fetchEntries,
  filterParams = {},
  getSessionRevision = () => sessionRevision,
  isCurrentList = () => true,
  onBatchAcknowledged,
  pageSize = MAX_ENTRIES_PER_PAGE,
  sessionRevision,
  updateEntriesStatusInBatches,
}) => {
  if (!Number.isFinite(cutoff)) {
    throw new TypeError("The age-based mark-as-read cutoff must be finite")
  }
  if (typeof fetchEntries !== "function" || typeof updateEntriesStatusInBatches !== "function") {
    throw new TypeError("Age-based mark-as-read requires entry fetch and update functions")
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError("The age-based mark-as-read page size must be a positive integer")
  }

  const isCurrentSession = () => sessionRevision === getSessionRevision()
  const targetIds = new Set()
  let offset = 0
  let total = Infinity
  const assertCurrentRequest = () => {
    if (!isCurrentSession()) {
      throw createStaleRequestError("Stale age-based mark-as-read session")
    }
    if (!isCurrentList()) {
      throw createStaleRequestError("Stale age-based mark-as-read list")
    }
  }

  try {
    while (offset < total) {
      assertCurrentRequest()

      const response = await fetchEntries("unread", {
        ...filterParams,
        published_before: cutoff,
        limit: pageSize,
        offset,
      })

      assertCurrentRequest()
      if (
        !Array.isArray(response?.entries) ||
        !Number.isFinite(response?.total) ||
        response.total < 0
      ) {
        throw new TypeError("Invalid age-based mark-as-read entries response")
      }

      for (const entryId of getAgeBasedUnreadTargetIds(response.entries, cutoff)) {
        targetIds.add(entryId)
      }

      if (response.entries.length === 0) {
        break
      }

      offset += response.entries.length
      total = response.total
    }
    assertCurrentRequest()
  } catch (error) {
    if (error.name === "StaleAgeBasedMarkReadError") {
      return { acknowledgedIds: [], error, requestedCount: 0, status: "stale" }
    }
    return { acknowledgedIds: [], error, requestedCount: 0, status: "failed" }
  }

  const requestedIds = [...targetIds]
  if (requestedIds.length === 0) {
    return { acknowledgedIds: [], requestedCount: 0, status: "empty" }
  }

  const acknowledgedIds = new Set()
  let mutationError
  try {
    await updateEntriesStatusInBatches(requestedIds, "read", {
      sessionRevision,
      onBatchUpdated: (entryIds) => {
        const acknowledgedBatch = [...new Set(entryIds)].filter((entryId) => targetIds.has(entryId))
        for (const entryId of acknowledgedBatch) {
          acknowledgedIds.add(entryId)
        }
        try {
          onBatchAcknowledged?.(acknowledgedBatch)
        } catch (error) {
          console.error("Failed to reconcile acknowledged age-based mark-read batch:", error)
        }
      },
    })
  } catch (error) {
    mutationError = error
  }

  if (acknowledgedIds.size !== requestedIds.length && !mutationError) {
    mutationError = new Error("Not all age-based mark-as-read IDs were acknowledged")
  }

  return {
    acknowledgedIds: [...acknowledgedIds],
    ...(mutationError && { error: mutationError }),
    requestedCount: requestedIds.length,
    status:
      acknowledgedIds.size === requestedIds.length
        ? "success"
        : acknowledgedIds.size > 0
          ? "partial"
          : "failed",
  }
}

export default markAgeBasedUnreadEntriesAsRead
