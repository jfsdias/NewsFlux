const normalizeSourceQuery = (query) => query.trim().toLocaleLowerCase()

export const getVisibleFeedSearchMatches = (feeds, query = "") => {
  const normalizedQuery = normalizeSourceQuery(query)
  if (!normalizedQuery) {
    return feeds
  }

  return feeds.filter((feed) => feed.title.toLocaleLowerCase().includes(normalizedQuery))
}

export const getUnreadNavigationFeeds = (visibleFeeds, query = "") =>
  getVisibleFeedSearchMatches(visibleFeeds, query).filter((feed) => feed.unreadCount > 0)

export const getMatchingCategories = (categories, feedsGroupedById, query = "") => {
  const normalizedQuery = normalizeSourceQuery(query)
  if (!normalizedQuery) {
    return categories
  }

  return categories.filter(
    (category) =>
      getVisibleFeedSearchMatches(feedsGroupedById[category.id] || [], normalizedQuery).length > 0,
  )
}

export const getSearchExpandedCategoryKeys = (expandedKeys, matchingCategoryKeys, query = "") => {
  if (!normalizeSourceQuery(query)) {
    return expandedKeys
  }

  return [...new Set([...expandedKeys, ...matchingCategoryKeys])]
}

export const getCurrentZeroUnreadSource = (
  visibleFeeds,
  currentFeedId,
  isUnreadMode,
  retainedCurrentFeedId,
) => {
  if (
    !isUnreadMode ||
    currentFeedId === null ||
    currentFeedId === undefined ||
    retainedCurrentFeedId === null ||
    retainedCurrentFeedId === undefined ||
    String(currentFeedId) !== String(retainedCurrentFeedId)
  ) {
    return null
  }

  return (
    visibleFeeds.find(
      (feed) => String(feed.id) === String(currentFeedId) && feed.unreadCount === 0,
    ) ?? null
  )
}
