const SELECTABLE_SOURCES = new Set(["all", "today", "starred", "feed", "category"])
const ID_SCOPED_SOURCES = new Set(["feed", "category"])

const normalizeDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  return value ?? null
}

export const isArticleSelectionAvailable = ({ from, homeMode = false }) =>
  !homeMode && SELECTABLE_SOURCES.has(from)

export const createArticleSelectionScopeKey = ({
  from,
  id,
  showStatus,
  filterString,
  filterDate,
  showHiddenFeeds,
  removeDuplicates,
  sessionRevision,
}) =>
  JSON.stringify({
    source: from ?? "all",
    sourceId: ID_SCOPED_SOURCES.has(from) ? String(id ?? "") : "",
    showStatus: showStatus ?? "all",
    search: filterString ?? "",
    date: normalizeDate(filterDate),
    showHiddenFeeds: Boolean(showHiddenFeeds),
    removeDuplicates: removeDuplicates ?? "none",
    sessionRevision: sessionRevision ?? 0,
  })

export const getEligibleArticleSelectionIds = (entries = []) =>
  new Set(
    entries
      .filter((entry) => entry?.status === "unread" && entry.id !== undefined && entry.id !== null)
      .map((entry) => entry.id),
  )

export const reconcileArticleSelection = (selectedIds, loadedFilteredEntries) => {
  const eligibleIds = getEligibleArticleSelectionIds(loadedFilteredEntries)
  return new Set([...selectedIds].filter((entryId) => eligibleIds.has(entryId)))
}

export const toggleArticleSelection = (selectedIds, entryId, eligibleIds) => {
  if (!eligibleIds.has(entryId)) {
    return new Set(selectedIds)
  }

  const nextSelectedIds = new Set(selectedIds)
  if (nextSelectedIds.has(entryId)) {
    nextSelectedIds.delete(entryId)
  } else {
    nextSelectedIds.add(entryId)
  }
  return nextSelectedIds
}
