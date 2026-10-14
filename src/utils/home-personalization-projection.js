// eslint-disable-next-line import/extensions
import { getCandidatePreferenceSignals } from "./home-personalization-profile.js"

const EMPTY_PROFILE = {
  starredEntryIds: new Set(),
  sourceCounts: new Map(),
  categoryCounts: new Map(),
  countedEntryMetadataById: new Map(),
}

const idKey = (id) => (id == null ? null : String(id))
const sourceKey = (entry) => idKey(entry?.feed?.id)
const categoryKey = (entry) => idKey(entry?.feed?.category?.id)

const compareStableIds = (left, right) => {
  const leftNumber = Number(left.id)
  const rightNumber = Number(right.id)
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber
  }
  return String(left.id).localeCompare(String(right.id))
}

const timestamp = (entry) => {
  const value = Date.parse(entry?.published_at)
  return Number.isNaN(value) ? null : value
}

const uniqueEntries = (entries) => {
  const seen = new Set()
  return entries.filter((entry) => {
    const key = idKey(entry?.id)
    if (key === null || seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const groupByFreshnessAnchor = (entries, freshnessWindow) => {
  const groups = []
  let currentGroup = null
  let anchorTimestamp = null

  for (const entry of entries) {
    const entryTimestamp = timestamp(entry)
    if (entryTimestamp === null) {
      groups.push([entry])
      currentGroup = null
      anchorTimestamp = null
      continue
    }

    if (currentGroup && anchorTimestamp - entryTimestamp <= freshnessWindow) {
      currentGroup.push(entry)
      continue
    }

    currentGroup = [entry]
    groups.push(currentGroup)
    anchorTimestamp = entryTimestamp
  }

  return groups
}

const hasUsefulSignal = (candidate, profile) => {
  const signal = getCandidatePreferenceSignals(candidate, profile)
  return signal.currentItemStarred || signal.sourceAffinity > 0 || signal.categoryAffinity > 0
}

const comparePreferences = (left, right, profile) => {
  const leftSignal = getCandidatePreferenceSignals(left, profile)
  const rightSignal = getCandidatePreferenceSignals(right, profile)
  return (
    Number(rightSignal.currentItemStarred) - Number(leftSignal.currentItemStarred) ||
    rightSignal.sourceAffinity - leftSignal.sourceAffinity ||
    rightSignal.categoryAffinity - leftSignal.categoryAffinity
  )
}

const compareDiversity = (left, right, represented) => {
  const leftNewSource = sourceKey(left) !== null && !represented.sources.has(sourceKey(left))
  const rightNewSource = sourceKey(right) !== null && !represented.sources.has(sourceKey(right))
  if (leftNewSource !== rightNewSource) {
    return Number(rightNewSource) - Number(leftNewSource)
  }

  const leftNewCategory =
    categoryKey(left) !== null && !represented.categories.has(categoryKey(left))
  const rightNewCategory =
    categoryKey(right) !== null && !represented.categories.has(categoryKey(right))
  return Number(rightNewCategory) - Number(leftNewCategory)
}

const representedBy = (entries) => ({
  sources: new Set(entries.map((entry) => sourceKey(entry)).filter((id) => id !== null)),
  categories: new Set(entries.map((entry) => categoryKey(entry)).filter((id) => id !== null)),
})

const addToRepresented = (entry, represented) => {
  const source = sourceKey(entry)
  const category = categoryKey(entry)
  if (source !== null) {
    represented.sources.add(source)
  }
  if (category !== null) {
    represented.categories.add(category)
  }
}

const selectSecondaryCandidate = (candidates, baselineEntry, represented, profile) => {
  if (candidates.length === 0) {
    return null
  }
  if (
    !candidates.some((entry) => hasUsefulSignal(entry, profile)) &&
    candidates.some((entry) => idKey(entry.id) === idKey(baselineEntry.id))
  ) {
    return baselineEntry
  }

  const bestDiversity = [...candidates].toSorted((left, right) =>
    compareDiversity(left, right, represented),
  )
  const diverseCandidates = bestDiversity.filter(
    (entry) => compareDiversity(entry, bestDiversity[0], represented) === 0,
  )
  const bestPreference = [...diverseCandidates].toSorted(
    (left, right) => comparePreferences(left, right, profile) || compareStableIds(left, right),
  )
  const preferredSignal = bestPreference[0]
  const equallyPreferred = bestPreference.filter(
    (entry) => comparePreferences(entry, preferredSignal, profile) === 0,
  )
  if (equallyPreferred.some((entry) => idKey(entry.id) === idKey(baselineEntry.id))) {
    return baselineEntry
  }

  return equallyPreferred.toSorted(compareStableIds)[0]
}

const selectRecentOrder = (groupEntries, baselineOrder, highlights, profile) => {
  if (!groupEntries.some((entry) => hasUsefulSignal(entry, profile))) {
    return baselineOrder
  }

  const remaining = [...groupEntries]
  const ordered = []
  const represented = representedBy(highlights)

  while (remaining.length > 0) {
    const bestDiversity = remaining.toSorted((left, right) =>
      compareDiversity(left, right, represented),
    )
    const diverseCandidates = bestDiversity.filter(
      (entry) => compareDiversity(entry, bestDiversity[0], represented) === 0,
    )
    const bestPreference = diverseCandidates.toSorted(
      (left, right) => comparePreferences(left, right, profile) || compareStableIds(left, right),
    )
    const selected = bestPreference[0]

    ordered.push(selected)
    remaining.splice(
      remaining.findIndex((entry) => idKey(entry.id) === idKey(selected.id)),
      1,
    )
    addToRepresented(selected, represented)
  }

  return ordered
}

const sameOrder = (left, right) =>
  left.length === right.length && left.every((id, index) => idKey(id) === idKey(right[index]))

// eslint-disable-next-line import/prefer-default-export
export const projectHomePersonalization = ({
  entries,
  baselineHighlightIds,
  baselineRecentIds,
  profile,
  freshnessWindow,
}) => {
  const canonicalEntries = uniqueEntries(entries ?? [])
  const profileContext = profile ?? EMPTY_PROFILE
  const entryById = new Map(canonicalEntries.map((entry) => [idKey(entry.id), entry]))
  const highlightGroups = groupByFreshnessAnchor(canonicalEntries, freshnessWindow)
  const groupById = new Map()
  for (const [index, group] of highlightGroups.entries()) {
    for (const entry of group) {
      groupById.set(idKey(entry.id), index)
    }
  }

  const baselineHighlights = Array.isArray(baselineHighlightIds) ? baselineHighlightIds : []
  const baselineRecent = Array.isArray(baselineRecentIds) ? baselineRecentIds : []
  const primary = entryById.get(idKey(baselineHighlights[0])) ?? canonicalEntries[0] ?? null
  const highlightEntries = primary ? [primary] : []
  const selectedIds = new Set(primary ? [idKey(primary.id)] : [])

  for (const baselineId of baselineHighlights.slice(1, 3)) {
    const baselineEntry = entryById.get(idKey(baselineId))
    if (!baselineEntry) {
      highlightEntries.push(null)
      continue
    }

    const group = highlightGroups[groupById.get(idKey(baselineEntry.id))] ?? [baselineEntry]
    const options = group.filter((entry) => !selectedIds.has(idKey(entry.id)))
    const represented = representedBy(highlightEntries.filter(Boolean))
    const selected = selectSecondaryCandidate(options, baselineEntry, represented, profileContext)
    highlightEntries.push(selected)
    if (selected) {
      selectedIds.add(idKey(selected.id))
      addToRepresented(selected, represented)
    }
  }

  const highlightIds = highlightEntries.map((entry) => entry?.id ?? null)
  const remainingEntries = canonicalEntries.filter((entry) => !selectedIds.has(idKey(entry.id)))
  const baselineHighlightSet = new Set(
    baselineHighlights.filter((id) => id != null).map((id) => idKey(id)),
  )
  const finalHighlightSet = new Set(
    highlightEntries.filter(Boolean).map((entry) => idKey(entry.id)),
  )
  const highlightMembershipChanged =
    baselineHighlightSet.size !== finalHighlightSet.size ||
    [...baselineHighlightSet].some((id) => !finalHighlightSet.has(id))

  const canonicalEntryById = new Map(remainingEntries.map((entry) => [idKey(entry.id), entry]))
  const fallbackRecentOrder = []
  const fallbackSeen = new Set()
  for (const id of baselineRecent) {
    const key = idKey(id)
    const entry = canonicalEntryById.get(key)
    if (entry && !fallbackSeen.has(key)) {
      fallbackRecentOrder.push(entry)
      fallbackSeen.add(key)
    }
  }
  for (const entry of remainingEntries) {
    const key = idKey(entry.id)
    if (!fallbackSeen.has(key)) {
      fallbackRecentOrder.push(entry)
      fallbackSeen.add(key)
    }
  }

  const recentGroups = groupByFreshnessAnchor(remainingEntries, freshnessWindow)
  const recentOrder = []
  for (const group of recentGroups) {
    const groupIds = new Set(group.map((entry) => idKey(entry.id)))
    const baselineGroupOrder = highlightMembershipChanged
      ? group
      : [
          ...fallbackRecentOrder.filter((entry) => groupIds.has(idKey(entry.id))),
          ...group.filter(
            (entry) =>
              !fallbackRecentOrder.some((candidate) => idKey(candidate.id) === idKey(entry.id)),
          ),
        ]
    recentOrder.push(
      ...selectRecentOrder(
        group,
        baselineGroupOrder,
        highlightEntries.filter(Boolean),
        profileContext,
      ),
    )
  }

  const recentIds = recentOrder.map((entry) => entry.id)
  const baselineVisibleOrder = [
    ...baselineHighlights.slice(1).filter((id) => id != null),
    ...baselineRecent,
  ]
  const visibleOrder = [...highlightIds.slice(1).filter((id) => id != null), ...recentIds]

  return {
    highlightIds,
    recentIds,
    personalizationApplied: !sameOrder(visibleOrder, baselineVisibleOrder),
  }
}
