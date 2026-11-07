const entryKey = (id) => (id === undefined || id === null ? null : String(id))

const categoryId = (entry) => {
  const value = Number(entry?.feed?.category?.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

const categoryTitle = (entry) => {
  const title = entry?.feed?.category?.title
  return typeof title === "string" && title.trim().length > 0 ? title.trim() : null
}

const publishedAt = (entry) => {
  const value = Date.parse(entry?.published_at)
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value
}

export const createHomeCategoryLanes = ({
  entries,
  highlightIds,
  recentIds,
  maxCategories = 3,
  minEntriesPerCategory = 2,
  maxEntriesPerCategory = 3,
}) => {
  const maximumCategories = Number.isFinite(maxCategories)
    ? Math.max(0, Math.floor(maxCategories))
    : 3
  const minimumEntries = Number.isFinite(minEntriesPerCategory)
    ? Math.max(1, Math.floor(minEntriesPerCategory))
    : 2
  const maximumEntries = Number.isFinite(maxEntriesPerCategory)
    ? Math.max(minimumEntries, Math.floor(maxEntriesPerCategory))
    : 3
  const entryById = new Map()

  for (const entry of entries ?? []) {
    const key = entryKey(entry?.id)
    if (key !== null && !entryById.has(key)) {
      entryById.set(key, entry)
    }
  }

  const highlightedIds = new Set(
    (highlightIds ?? []).map((id) => entryKey(id)).filter((id) => id !== null),
  )
  const seenRecentIds = new Set()
  const groups = new Map()

  for (const id of recentIds ?? []) {
    const key = entryKey(id)
    if (key === null || seenRecentIds.has(key) || highlightedIds.has(key)) {
      continue
    }
    seenRecentIds.add(key)

    const entry = entryById.get(key)
    const idForCategory = categoryId(entry)
    const title = categoryTitle(entry)
    if (entry?.status !== "unread" || idForCategory === null || title === null) {
      continue
    }

    let group = groups.get(idForCategory)
    if (!group) {
      group = {
        categoryId: idForCategory,
        categoryTitle: title,
        entryIds: [],
        newestPublishedAt: Number.NEGATIVE_INFINITY,
      }
      groups.set(idForCategory, group)
    }
    group.entryIds.push(entry.id)
    group.newestPublishedAt = Math.max(group.newestPublishedAt, publishedAt(entry))
  }

  return [...groups.values()]
    .filter((group) => group.entryIds.length >= minimumEntries)
    .toSorted(
      (left, right) =>
        right.newestPublishedAt - left.newestPublishedAt || left.categoryId - right.categoryId,
    )
    .slice(0, maximumCategories)
    .map(({ categoryId: id, categoryTitle: title, entryIds }) => ({
      categoryId: id,
      categoryTitle: title,
      entryIds: entryIds.slice(0, maximumEntries),
    }))
}

export const projectHomeCategoryEntries = ({ recentIds, categoryLanes }) => {
  const uniqueRecentIds = []
  const seenRecentIds = new Set()
  for (const id of recentIds ?? []) {
    const key = entryKey(id)
    if (key !== null && !seenRecentIds.has(key)) {
      uniqueRecentIds.push(id)
      seenRecentIds.add(key)
    }
  }

  const recentIdByKey = new Map(uniqueRecentIds.map((id) => [entryKey(id), id]))
  const seenLaneIds = new Set()
  const projectedLanes = []
  for (const lane of categoryLanes ?? []) {
    const entryIds = []
    for (const id of lane.entryIds ?? []) {
      const key = entryKey(id)
      if (key === null || !recentIdByKey.has(key) || seenLaneIds.has(key)) {
        continue
      }
      seenLaneIds.add(key)
      entryIds.push(recentIdByKey.get(key))
    }
    if (entryIds.length > 0) {
      projectedLanes.push({ ...lane, entryIds })
    }
  }

  const latestIds = uniqueRecentIds.filter((id) => !seenLaneIds.has(entryKey(id)))
  return {
    categoryLanes: projectedLanes,
    latestIds,
    readerRecentIds: [...projectedLanes.flatMap(({ entryIds }) => entryIds), ...latestIds],
  }
}
