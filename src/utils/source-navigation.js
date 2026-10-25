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

export const getGroupedUnreadNavigationFeeds = (categories = [], visibleFeeds = [], query = "") => {
  const unreadFeeds = getUnreadNavigationFeeds(visibleFeeds, query)
  if (unreadFeeds.length === 0) {
    return []
  }

  const feedsByCategoryId = new Map()
  for (const feed of unreadFeeds) {
    const categoryId = feed?.category?.id ?? feed?.categoryId
    if (categoryId === undefined || categoryId === null) {
      continue
    }
    const key = String(categoryId)
    if (!feedsByCategoryId.has(key)) {
      feedsByCategoryId.set(key, [])
    }
    feedsByCategoryId.get(key).push(feed)
  }

  const groups = []
  const seenCategoryKeys = new Set()

  if (Array.isArray(categories)) {
    for (const category of categories) {
      if (!category || category.id === undefined || category.id === null) {
        continue
      }
      const key = String(category.id)
      seenCategoryKeys.add(key)
      const matchingFeeds = feedsByCategoryId.get(key)
      if (matchingFeeds && matchingFeeds.length > 0) {
        groups.push({
          category,
          feeds: matchingFeeds,
        })
      }
    }
  }

  for (const [key, matchingFeeds] of feedsByCategoryId.entries()) {
    if (!seenCategoryKeys.has(key) && matchingFeeds.length > 0) {
      const fallbackCategory = matchingFeeds[0].category || { id: key, title: "" }
      groups.push({
        category: fallbackCategory,
        feeds: matchingFeeds,
      })
    }
  }

  return groups
}

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
      smart_count: normalizedCount,
    })
  }

  if (countType === "items") {
    const unit = normalizedCount === 1 ? "item" : "items"
    return `${safeLabel}, ${normalizedCount} ${unit}`
  }

  return `${safeLabel}, ${normalizedCount} unread`
}
