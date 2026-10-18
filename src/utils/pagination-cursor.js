const timestampOf = (entry, property) => {
  const value = entry?.[property]
  const milliseconds = typeof value === "number" ? value : Date.parse(value)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : Number.NaN
}

export const getPaginationReferenceEntry = (
  entries,
  sortProperty,
  orderDirection,
  pageDirection = "next",
) => {
  if (entries.length === 0) {
    return null
  }

  const sortedEntries = [...entries].toSorted((left, right) => {
    const leftValue = timestampOf(left, sortProperty)
    const rightValue = timestampOf(right, sortProperty)
    return orderDirection === "desc" ? rightValue - leftValue : leftValue - rightValue
  })
  const entriesByTimestamp = new Map()
  for (const entry of sortedEntries) {
    const timestamp = timestampOf(entry, sortProperty)
    if (!entriesByTimestamp.has(timestamp)) {
      entriesByTimestamp.set(timestamp, [])
    }
    entriesByTimestamp.get(timestamp).push(entry)
  }

  const timestamps = [...entriesByTimestamp.keys()].toSorted((left, right) =>
    orderDirection === "desc" ? right - left : left - right,
  )
  const referenceIndex =
    timestamps.length > 1 ? (pageDirection === "previous" ? 1 : timestamps.length - 2) : 0

  return entriesByTimestamp.get(timestamps[referenceIndex])?.at(-1) ?? null
}

export const buildPaginationCursorParams = ({
  entries,
  sortProperty,
  orderDirection,
  pageDirection = "next",
}) => {
  const referenceEntry = getPaginationReferenceEntry(
    entries,
    sortProperty,
    orderDirection,
    pageDirection,
  )
  if (!referenceEntry) {
    return {}
  }

  const cursorIsBefore =
    (pageDirection === "next" && orderDirection === "desc") ||
    (pageDirection === "previous" && orderDirection !== "desc")
  const cursorSuffix = cursorIsBefore ? "before" : "after"

  if (sortProperty === "created_at") {
    return { [`${cursorSuffix}_entry_id`]: referenceEntry.id }
  }

  if (sortProperty === "published_at" || sortProperty === "changed_at") {
    const prefix = sortProperty.replace(/_at$/, "")
    const timestamp = timestampOf(referenceEntry, sortProperty)
    return Number.isFinite(timestamp) ? { [`${prefix}_${cursorSuffix}`]: timestamp } : {}
  }

  return {}
}
