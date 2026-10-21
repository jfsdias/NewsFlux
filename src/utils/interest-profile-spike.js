// eslint-disable-next-line import/extensions
import { createHomePersonalizationProfile } from "./home-personalization-profile.js"

const stableIdKey = (value) => {
  if (typeof value !== "number" && typeof value !== "string") {
    return null
  }

  const numericId = Number(value)
  return Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : null
}

const sortedFrozenRecord = (map, transform = (value) => value) =>
  Object.freeze(
    Object.fromEntries(
      [...map]
        .toSorted(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, value]) => [key, transform(value)]),
    ),
  )

/**
 * Experimental, transient profile using only the current Miniflux-starred corpus.
 * This is intentionally not connected to Home or any persistence layer.
 */
export const createInterestProfile = ({ starredEntries = [], hiddenFeedIds = new Set() } = {}) => {
  const existingProfile = createHomePersonalizationProfile({
    entries: starredEntries,
    hiddenFeedIds,
  })

  return Object.freeze({
    sourceAffinity: sortedFrozenRecord(existingProfile.sourceCounts),
    categoryAffinity: sortedFrozenRecord(existingProfile.categoryCounts),
    countedEntryMetadataById: sortedFrozenRecord(
      existingProfile.countedEntryMetadataById,
      (value) => Object.freeze({ ...value }),
    ),
    signalAvailability: Object.freeze({
      currentItemStarred: true,
      sourceAffinity: true,
      categoryAffinity: true,
      topicSignals: false,
      recencyPreferences: false,
    }),
  })
}

export const explainInterestProfileCandidate = (candidate, profile) => {
  const candidateId = stableIdKey(candidate?.id)
  const sourceId = stableIdKey(candidate?.feed?.id)
  const categoryId = stableIdKey(candidate?.feed?.category?.id)
  const countedMetadata = profile.countedEntryMetadataById[candidateId]
  const sourceAffinity = Math.max(
    0,
    (profile.sourceAffinity[sourceId] ?? 0) -
      Number(countedMetadata?.sourceId === sourceId && sourceId !== null),
  )
  const categoryAffinity = Math.max(
    0,
    (profile.categoryAffinity[categoryId] ?? 0) -
      Number(countedMetadata?.categoryId === categoryId && categoryId !== null),
  )
  const currentItemStarred = candidate?.starred === true
  const reasons = []

  if (currentItemStarred) {
    reasons.push("current-item-starred")
  }
  if (sourceAffinity > 0) {
    reasons.push(`same-source-starred-entries:${sourceAffinity}`)
  }
  if (categoryAffinity > 0) {
    reasons.push(`same-category-starred-entries:${categoryAffinity}`)
  }

  return { currentItemStarred, sourceAffinity, categoryAffinity, reasons }
}
