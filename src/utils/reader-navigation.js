/* eslint-disable import/extensions -- Native ESM tests import this pure utility directly. */
import removeDuplicateEntries from "./deduplicate.js"
import { buildPaginationCursorParams } from "./pagination-cursor.js"
/* eslint-enable import/extensions */

const entryIdEquals = (left, right) => String(left) === String(right)

const uniqueEntries = (entries) => {
  const seen = new Set()
  return entries.filter((entry) => {
    if (entry?.id == null || seen.has(String(entry.id))) {
      return false
    }
    seen.add(String(entry.id))
    return true
  })
}

const entryTimestamp = (entry, property) => {
  const timestamp = Date.parse(entry?.[property])
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

const homeBoundary = (entries) => {
  const timestamps = [
    ...new Set(
      entries
        .map((entry) => entryTimestamp(entry, "published_at"))
        .filter((timestamp) => timestamp !== null),
    ),
  ].toSorted((left, right) => right - left)
  return timestamps.at(timestamps.length > 1 ? -2 : -1) ?? null
}

export const getReaderSourceHopQuery = (showStatus) => ({
  status: "unread",
  starred: showStatus === "starred",
})

const getScopeStatus = (source, settings) => {
  if (source.from === "home") {
    return { status: "unread", starred: false }
  }
  if (source.from === "history") {
    return { status: "read", starred: false }
  }
  if (settings.showStatus === "unread") {
    return { status: "unread", starred: false }
  }
  if (settings.showStatus === "starred") {
    return { status: null, starred: ["feed", "category"].includes(source.from) }
  }
  return { status: null, starred: false }
}

export const hasReaderPaginationContinuation = (response, pageSize) => {
  const entries = Array.isArray(response) ? response : response?.entries
  if (!Array.isArray(entries) || entries.length < pageSize) {
    return false
  }

  return !Number.isFinite(response?.total) || response.total > pageSize
}

export const buildReaderPageRequest = ({
  source,
  content,
  settings,
  entries,
  direction,
  mode = "article",
  todayPublishedAfter,
}) => {
  const currentEntries = uniqueEntries(entries ?? [])
  if (source.from === "home") {
    const cursor = content.homePaginationBoundary?.cursor ?? homeBoundary(currentEntries)
    return {
      source,
      cursor,
      filterParams: {
        limit: settings.pageSize,
        order: "published_at",
        direction: "desc",
        ...(cursor !== null && { published_before: cursor }),
      },
      pageSize: settings.pageSize,
      mode,
      direction,
    }
  }

  const order = ["history", "starred"].includes(source.from)
    ? "changed_at"
    : (settings.orderBy ?? "published_at")
  const orderDirection = settings.orderDirection ?? "desc"
  const cursorParams = buildPaginationCursorParams({
    entries: currentEntries,
    sortProperty: order,
    orderDirection,
    pageDirection: direction,
  })

  const { status, starred } = getScopeStatus(source, settings)
  const filterParams = {
    order,
    direction: orderDirection,
    limit: settings.pageSize,
    filterDate: source.from === "today" ? null : (content.filterDate ?? null),
    ...(content.filterString && { search: content.filterString }),
    ...(source.from === "today" && todayPublishedAfter !== undefined
      ? { published_after: todayPublishedAfter }
      : {}),
    ...cursorParams,
  }

  return { source, status, starred, filterParams, mode, direction }
}

export const appendReaderPageEntries = ({
  currentEntries,
  pageEntries,
  sequenceIds,
  direction,
  source,
  removeDuplicates = "none",
  homeHighlightIds = [],
}) => {
  const knownIds = new Set(currentEntries.map(({ id }) => String(id)))
  const newEntries = uniqueEntries(pageEntries).filter(({ id }) => !knownIds.has(String(id)))
  const combinedEntries =
    direction === "previous"
      ? [...newEntries, ...currentEntries]
      : [...currentEntries, ...newEntries]
  const shouldDeduplicate =
    source !== "home" && !["starred", "history"].includes(source) && removeDuplicates !== "none"
  const retainedEntries = shouldDeduplicate
    ? removeDuplicateEntries(combinedEntries, removeDuplicates).entries
    : combinedEntries

  if (source === "home") {
    const retainedSequenceIds = [
      ...sequenceIds,
      ...newEntries
        .filter(
          ({ id, status }) =>
            status === "unread" &&
            !homeHighlightIds.some((highlightId) => entryIdEquals(highlightId, id)) &&
            !sequenceIds.some((sequenceId) => entryIdEquals(sequenceId, id)),
        )
        .map(({ id }) => id),
    ]
    return { entries: retainedEntries, sequenceIds: retainedSequenceIds, newEntries }
  }

  return {
    entries: retainedEntries,
    sequenceIds: retainedEntries.map(({ id }) => id),
    newEntries,
  }
}

const findAdjacentInSequence = (entries, sequenceIds, activeEntryId, direction, mode) => {
  const activeIndex = sequenceIds.findIndex((entryId) => entryIdEquals(entryId, activeEntryId))
  if (activeIndex === -1) {
    return null
  }
  const ids =
    direction === "previous"
      ? sequenceIds.slice(0, activeIndex).toReversed()
      : sequenceIds.slice(activeIndex + 1)
  const byId = new Map(entries.map((entry) => [String(entry.id), entry]))
  for (const id of ids) {
    const entry = byId.get(String(id))
    if (entry && (mode !== "unread" || entry.status === "unread")) {
      return entry
    }
  }
  return null
}

const result = (status, values = {}) => ({ status, ...values })

export const resolveReaderNavigation = async (input) => {
  const {
    activeEntryId,
    direction,
    mode = "article",
    source,
    getEntries,
    getSequenceIds,
    canContinue,
    fetchPage,
    appendPage,
    isCurrent,
    getNextSources,
    fetchSourceEntries,
    showStatus = "all",
    prepareTargetEntry = (entry) => entry,
  } = input

  if (!isCurrent()) {
    return result("stale")
  }

  const initialSequence = getSequenceIds()
  if (!initialSequence.some((entryId) => entryIdEquals(entryId, activeEntryId))) {
    return result("end", { reason: "no-originating-session" })
  }

  let currentEntries = getEntries()
  let paginationEntries = uniqueEntries(input.getPaginationEntries?.() ?? currentEntries)
  let adjacent = findAdjacentInSequence(
    currentEntries,
    initialSequence,
    activeEntryId,
    direction,
    mode,
  )
  if (adjacent) {
    return result("found", { entry: adjacent })
  }

  let sequenceIds = initialSequence
  let latestTotal = null
  while (
    canContinue(direction, {
      entries: currentEntries,
      paginationEntries,
      sequenceIds,
      total: latestTotal,
    })
  ) {
    if (!isCurrent()) {
      return result("stale")
    }
    let response
    try {
      response = await fetchPage({
        activeEntryId,
        direction,
        mode,
        entries: currentEntries,
        paginationEntries,
        sequenceIds,
      })
    } catch (error) {
      return isCurrent() ? result("error", { error }) : result("stale")
    }
    if (!isCurrent()) {
      return result("stale")
    }
    const pageEntries = Array.isArray(response) ? response : response?.entries
    latestTotal = Array.isArray(response) ? null : (response?.total ?? null)
    if (!Array.isArray(pageEntries) || pageEntries.length === 0) {
      break
    }

    const canonicalIds = new Set(paginationEntries.map(({ id }) => String(id)))
    const newCanonicalEntries = uniqueEntries(pageEntries).filter(
      ({ id }) => !canonicalIds.has(String(id)),
    )
    if (newCanonicalEntries.length === 0) {
      break
    }
    paginationEntries =
      direction === "previous"
        ? [...newCanonicalEntries, ...paginationEntries]
        : [...paginationEntries, ...newCanonicalEntries]

    const appended = await appendPage({
      entries: uniqueEntries(pageEntries),
      direction,
      sequenceIds,
      currentEntries,
      response,
    })
    if (!isCurrent()) {
      return result("stale")
    }
    currentEntries = appended?.entries ?? getEntries()
    sequenceIds = appended?.sequenceIds ?? getSequenceIds()
    adjacent = findAdjacentInSequence(currentEntries, sequenceIds, activeEntryId, direction, mode)
    if (adjacent) {
      return result("found", { entry: adjacent })
    }
  }

  if (mode !== "unread" || direction !== "next" || !["feed", "category"].includes(source.from)) {
    return result("end", { reason: "scope-exhausted" })
  }

  const seenSources = new Set()
  for (const targetSource of getNextSources()) {
    const key = `${targetSource.type}:${targetSource.id}`
    if (seenSources.has(key) || !isCurrent()) {
      if (!isCurrent()) {
        return result("stale")
      }
      continue
    }
    seenSources.add(key)
    let response
    try {
      response = await fetchSourceEntries(targetSource)
    } catch (error) {
      return isCurrent() ? result("error", { error, targetSource }) : result("stale")
    }
    if (!isCurrent()) {
      return result("stale")
    }
    const entries = Array.isArray(response) ? response : response?.entries
    const firstUnread = entries?.find(
      (entry) => entry.status === "unread" && (showStatus !== "starred" || entry.starred === true),
    )
    if (firstUnread) {
      return result("found", { entry: prepareTargetEntry(firstUnread), targetSource })
    }
  }

  return result("end", { reason: "no-unread-source" })
}

export const createReaderNavigationOperationGate = () => {
  let running = false
  return {
    get isRunning() {
      return running
    },
    async run(operation) {
      if (running) {
        return { status: "busy" }
      }
      running = true
      try {
        return { value: await operation() }
      } finally {
        running = false
      }
    },
  }
}
