const normalizeSourceQuery = (query) => query.trim().toLocaleLowerCase()

export const getNextUnreadSources = (source, categories, feeds) => {
  const isCategory = source?.type === "category" || source?.from === "category"
  const items = isCategory
    ? categories
    : categories.flatMap((category) => feeds.filter((feed) => feed.category.id === category.id))
  const currentIndex = items.findIndex((item) => String(item.id) === String(source.id))
  if (currentIndex === -1 || items.length < 2) {
    return []
  }
  const ordered = []
  for (let offset = 1; offset < items.length; offset += 1) {
    const item = items[(currentIndex + offset) % items.length]
    if (item.unreadCount > 0) {
      ordered.push({
        type: isCategory ? "category" : "feed",
        id: item.id,
      })
    }
  }
  return ordered
}

export const getNextUnreadSource = (source, categories, feeds = []) =>
  getNextUnreadSources(source, categories, feeds)[0] ?? null

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

export const formatNavigationCountLabel = (
  label,
  count,
  { countType = "unread", polyglot, showZero = false } = {},
) => {
  const safeLabel = typeof label === "string" ? label : ""
  const numericCount = Number(count)
  const hasVisibleCount =
    Number.isFinite(numericCount) && (numericCount > 0 || (showZero && numericCount === 0))

  if (!hasVisibleCount) {
    return safeLabel
  }

  const normalizedCount = Math.max(0, Math.trunc(numericCount))
  if (polyglot && typeof polyglot.t === "function") {
    const phraseKey =
      countType === "items" ? "sidebar.items_count_aria" : "sidebar.unread_count_aria"
    return polyglot.t(phraseKey, {
      label: safeLabel,
      count: normalizedCount,
    })
  }

  return countType === "items"
    ? `${safeLabel}, ${normalizedCount} items`
    : `${safeLabel}, ${normalizedCount} unread`
}
