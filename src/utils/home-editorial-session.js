// Node's direct unit runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
import { selectInitialHighlightIds } from "./home-editorial-projection.js"

const byPublishedAt = (left, right) =>
  Date.parse(right.published_at) - Date.parse(left.published_at) ||
  Number(left.id) - Number(right.id)

const uniqueById = (entries) => {
  const seen = new Set()
  return entries.filter((entry) => {
    if (entry?.id === undefined || entry?.id === null || seen.has(entry.id)) {
      return false
    }
    seen.add(entry.id)
    return true
  })
}

// The request generation is intentionally absent: a refresh retains the committed projection
// until its canonical response succeeds.
export const createHomeSessionKey = ({ identityKey, showHiddenFeeds, pageSize, sessionRevision }) =>
  JSON.stringify({ identityKey, showHiddenFeeds, pageSize, sessionRevision })

export const createHomeEditorialSession = ({
  requestKey,
  sessionRevision,
  entries,
  initialProjection,
  scrollRoot = null,
}) => {
  const highlightIds = initialProjection?.highlightIds ?? selectInitialHighlightIds(entries)
  const highlighted = new Set(highlightIds)
  const recentIds =
    initialProjection?.recentIds ??
    uniqueById(entries)
      .filter((entry) => entry.status === "unread" && !highlighted.has(entry.id))
      .toSorted(byPublishedAt)
      .map((entry) => entry.id)

  return {
    requestKey,
    sessionRevision,
    highlightIds: [...highlightIds],
    recentIds: [...recentIds],
    // IDs in the initial canonical page cannot be inserted later by status settlement.
    observedEntryIds: uniqueById(entries).map(({ id }) => id),
    pendingStatusById: {},
    scrollRoot,
  }
}

const appendableRecentEntries = (session, entries) => {
  const observed = new Set(session.observedEntryIds)
  const highlighted = new Set(session.highlightIds)
  return uniqueById(entries)
    .filter(
      (entry) => entry.status === "unread" && !observed.has(entry.id) && !highlighted.has(entry.id),
    )
    .toSorted(byPublishedAt)
}

// Load-more extends the committed Recent tail with new canonical unread entries only.
export const appendHomeSessionEntries = (session, entries) => {
  const currentIds = uniqueById(entries).map(({ id }) => id)
  const observed = new Set(session.observedEntryIds)
  const unseenIds = currentIds.filter((id) => !observed.has(id))
  if (unseenIds.length === 0) {
    return session
  }

  const newRecentIds = appendableRecentEntries(session, entries).map(({ id }) => id)
  const recentIds = [...session.recentIds]
  const recentSet = new Set(recentIds)
  for (const id of newRecentIds) {
    if (!recentSet.has(id)) {
      recentIds.push(id)
      recentSet.add(id)
    }
  }

  return {
    ...session,
    recentIds,
    observedEntryIds: [...(session.observedEntryIds ?? []), ...unseenIds],
  }
}

export const projectHomeSession = (session, entries) => {
  const additionalRecentIds = appendableRecentEntries(session, entries).map(({ id }) => id)
  const recentIds = [...session.recentIds]
  const seenRecentIds = new Set(recentIds)
  for (const id of additionalRecentIds) {
    if (!seenRecentIds.has(id)) {
      recentIds.push(id)
      seenRecentIds.add(id)
    }
  }

  // Membership and order are committed for this Home session. Entry objects remain live so
  // readers can reflect read/star state without removing or promoting cards.
  return {
    highlightIds: [...session.highlightIds],
    recentIds,
  }
}

export const transitionHomeSession = (session, event) => {
  if (!session || event.sessionRevision !== session.sessionRevision) {
    return session
  }
  if (event.targetStatus !== "read" && event.targetStatus !== "unread") {
    return session
  }

  const pendingStatusById = { ...session.pendingStatusById }
  const pendingAfterSettlement = new Set(
    event.pendingEntryIds ??
      event.entryIds.filter(
        (id) => pendingStatusById[id] && pendingStatusById[id].targetStatus !== event.targetStatus,
      ),
  )
  const settledStatus = (id) =>
    event.outcome === "confirmed"
      ? event.targetStatus
      : (pendingStatusById[id]?.confirmedStatus ?? event.previousStatuses[id])

  for (const id of event.entryIds) {
    const pending = pendingStatusById[id]
    if (event.outcome === "intent") {
      pendingStatusById[id] = {
        previousStatus: pending?.previousStatus ?? event.previousStatuses[id],
        targetStatus: event.targetStatus,
        confirmedStatus: pending?.confirmedStatus ?? event.previousStatuses[id],
      }
      continue
    }
    if (pendingAfterSettlement.has(id)) {
      pendingStatusById[id] = {
        ...pending,
        confirmedStatus: settledStatus(id),
      }
      continue
    }
    delete pendingStatusById[id]
  }

  return { ...session, pendingStatusById }
}
