const stableIdKey = (value) => {
  if (typeof value !== "number" && typeof value !== "string") {
    return null
  }

  const numericId = Number(value)
  return Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : null
}

const incrementCount = (counts, id) => {
  if (id !== null) {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
}

const normalizedIdSet = (values) =>
  new Set([...values].map((value) => stableIdKey(value)).filter((id) => id !== null))

export const createHomePersonalizationProfile = ({ entries, hiddenFeedIds = new Set() }) => {
  const uniqueEntriesById = new Map()
  for (const entry of entries ?? []) {
    const entryId = stableIdKey(entry?.id)
    if (entryId !== null && !uniqueEntriesById.has(entryId)) {
      uniqueEntriesById.set(entryId, entry)
    }
  }

  const starredEntryIds = new Set()
  const hiddenFeedIdKeys = normalizedIdSet(hiddenFeedIds)
  const sourceCounts = new Map()
  const categoryCounts = new Map()
  const countedEntryMetadataById = new Map()

  for (const [entryId, entry] of uniqueEntriesById) {
    const sourceId = stableIdKey(entry?.feed?.id)
    if (sourceId !== null && hiddenFeedIdKeys.has(sourceId)) {
      continue
    }

    const categoryId = stableIdKey(entry?.feed?.category?.id)
    starredEntryIds.add(entryId)
    countedEntryMetadataById.set(entryId, { sourceId, categoryId })
    incrementCount(sourceCounts, sourceId)
    incrementCount(categoryCounts, categoryId)
  }

  return { starredEntryIds, sourceCounts, categoryCounts, countedEntryMetadataById }
}

export const getCandidatePreferenceSignals = (candidate, profile) => {
  const candidateId = stableIdKey(candidate?.id)
  const candidateSourceId = stableIdKey(candidate?.feed?.id)
  const candidateCategoryId = stableIdKey(candidate?.feed?.category?.id)
  const countedMetadata = profile.countedEntryMetadataById.get(candidateId)

  return {
    currentItemStarred: candidateId !== null && profile.starredEntryIds.has(candidateId),
    sourceAffinity: Math.max(
      0,
      (profile.sourceCounts.get(candidateSourceId) ?? 0) -
        Number(countedMetadata?.sourceId === candidateSourceId && candidateSourceId !== null),
    ),
    categoryAffinity: Math.max(
      0,
      (profile.categoryCounts.get(candidateCategoryId) ?? 0) -
        Number(countedMetadata?.categoryId === candidateCategoryId && candidateCategoryId !== null),
    ),
  }
}
