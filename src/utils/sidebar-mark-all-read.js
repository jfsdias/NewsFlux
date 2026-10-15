export const requestSidebarMarkAllRead = ({ scope, skipConfirmation, confirm, onConfirm }) => {
  if (!["feed", "category"].includes(scope)) {
    throw new TypeError(`Unsupported Sidebar Mark All scope: ${scope}`)
  }

  return skipConfirmation ? onConfirm() : confirm(onConfirm)
}

export const isSidebarSourceListAffected = ({
  scope,
  sourceId,
  infoFrom,
  infoId,
  feedsByCategory = {},
}) => {
  if (scope === "feed") {
    return infoFrom === "feed" && Number(infoId) === Number(sourceId)
  }
  if (scope !== "category") {
    return false
  }
  if (infoFrom === "category" && Number(infoId) === Number(sourceId)) {
    return true
  }
  return (
    infoFrom === "feed" &&
    (feedsByCategory[sourceId] || []).some((feed) => Number(feed.id) === Number(infoId))
  )
}

export const markSidebarSourceEntriesAsRead = async ({
  scope,
  sourceId,
  isEntryScopeFullyVisible,
  getFeedEntries,
  getCategoryEntries,
  markEntriesAsReadInBatches,
  onBatchMarkedRead,
}) => {
  if (!["feed", "category"].includes(scope)) {
    throw new TypeError(`Unsupported Sidebar Mark All scope: ${scope}`)
  }

  const fetchSourceEntries =
    scope === "feed"
      ? (status, filterParams) => getFeedEntries(sourceId, status, false, filterParams)
      : (status, filterParams) => getCategoryEntries(sourceId, status, false, filterParams)

  return markEntriesAsReadInBatches(fetchSourceEntries, {
    filterParams: {
      globally_visible: !isEntryScopeFullyVisible(scope, sourceId),
    },
    onBatchMarkedRead,
  })
}
