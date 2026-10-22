const temporalSortProperties = new Set(["published_at", "changed_at"])

export const getArticleListTemporalSortProperty = (source, orderBy) =>
  ["starred", "history"].includes(source) ? "changed_at" : orderBy

const temporalValue = (entry, sortProperty) => {
  const value = entry?.[sortProperty]
  const milliseconds = typeof value === "number" ? value : Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : Number.NaN
}

export const getTemporalTimestampSecond = (entry, sortProperty) => {
  const milliseconds = temporalValue(entry, sortProperty)
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : Number.NaN
}

export const getTemporalTieDrainBucketSecond = ({
  entries,
  knownEntries = [],
  total,
  pageSize,
  sortProperty,
}) => {
  if (
    !temporalSortProperties.has(sortProperty) ||
    !Array.isArray(entries) ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    entries.length !== pageSize ||
    !Number.isFinite(total) ||
    total <= new Set([...knownEntries, ...entries].map(({ id }) => id)).size
  ) {
    return null
  }

  const seconds = entries.map((entry) => getTemporalTimestampSecond(entry, sortProperty))
  if (!Number.isFinite(seconds[0])) {
    return null
  }

  if (seconds.every((second) => second === seconds[0])) {
    return seconds[0]
  }

  const knownSeconds = new Set(
    knownEntries
      .map((entry) => getTemporalTimestampSecond(entry, sortProperty))
      .filter((second) => Number.isFinite(second)),
  )

  // A continued temporal page can start by replaying the boundary second from
  // the previous page, then contain older/newer seconds. Drain that repeated
  // boundary before the next strict temporal cursor can move past it.
  return knownSeconds.has(seconds[0]) ? seconds[0] : null
}

const uniqueEntriesById = (entries, sortProperty) => {
  const seen = new Set()
  return entries.flatMap((entry) => {
    if (
      entry?.id === undefined ||
      entry?.id === null ||
      seen.has(entry.id) ||
      !Number.isFinite(temporalValue(entry, sortProperty))
    ) {
      return []
    }

    seen.add(entry.id)
    return [{ id: entry.id, [sortProperty]: entry[sortProperty] }]
  })
}

export const createTemporalPaginationState = ({
  entries,
  total,
  pageSize,
  sortProperty,
  orderDirection,
  requestKey,
  sessionRevision,
  snapshotRevision,
}) => {
  if (!temporalSortProperties.has(sortProperty)) {
    return null
  }

  const canonicalEntries = uniqueEntriesById(entries, sortProperty)
  const bucketSecond = getTemporalTieDrainBucketSecond({
    entries,
    total,
    pageSize,
    sortProperty,
  })

  return {
    canonicalEntries,
    canonicalEntryIds: canonicalEntries.map(({ id }) => id),
    total,
    orderDirection,
    requestKey,
    sessionRevision,
    snapshotRevision,
    sortProperty,
    tieDrain:
      bucketSecond === null
        ? null
        : {
            bucketSecond,
            idCursor: null,
          },
  }
}

export const appendTemporalCanonicalEntries = (state, entries) => {
  if (!state || !Array.isArray(entries) || entries.length === 0) {
    return state
  }

  const canonicalEntries = uniqueEntriesById(
    [...state.canonicalEntries, ...entries],
    state.sortProperty,
  )

  return {
    ...state,
    canonicalEntries,
    canonicalEntryIds: canonicalEntries.map(({ id }) => id),
  }
}

export const inspectTemporalTieDrainPage = ({
  entries,
  bucketSecond,
  idCursor,
  pageSize,
  sortProperty,
}) => {
  if (
    !Array.isArray(entries) ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    entries.length > pageSize
  ) {
    return {
      advances: false,
      entries: [],
      exhausted: false,
      nextIdCursor: idCursor,
    }
  }

  const ids = entries.map(({ id }) => Number(id))
  const previousId = idCursor === null ? Infinity : Number(idCursor)
  const advances = ids.every(
    (id, index) => Number.isSafeInteger(id) && id < (index === 0 ? previousId : ids[index - 1]),
  )

  if (entries.length > 0 && !advances) {
    return {
      advances: false,
      entries: [],
      exhausted: false,
      nextIdCursor: idCursor,
    }
  }

  return {
    advances: true,
    entries: entries.filter(
      (entry) => getTemporalTimestampSecond(entry, sortProperty) === bucketSecond,
    ),
    exhausted: entries.length < pageSize,
    nextIdCursor: entries.length > 0 ? ids.at(-1) : idCursor,
  }
}

export const sortEntriesByTemporal = (entries, sortProperty, orderDirection) => {
  const direction = orderDirection === "asc" ? 1 : -1
  return [...entries].toSorted((left, right) => {
    const leftValue = temporalValue(left, sortProperty)
    const rightValue = temporalValue(right, sortProperty)
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return 0
    }
    return direction * (leftValue - rightValue)
  })
}

export const isTemporalPaginationStateCurrent = (
  state,
  { requestKey, sessionRevision, snapshotRevision },
) =>
  Boolean(
    state &&
    state.requestKey === requestKey &&
    state.sessionRevision === sessionRevision &&
    state.snapshotRevision === snapshotRevision,
  )
