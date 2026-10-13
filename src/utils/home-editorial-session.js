// Node's direct unit runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
import { selectBackfillCandidate, selectInitialHighlightIds } from "./home-editorial-projection.js"

const byPublishedAt = (left, right) =>
  Date.parse(right.published_at) - Date.parse(left.published_at) ||
  Number(left.id) - Number(right.id)

const uniqueById = (entries) => {
  const seen = new Set()
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
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
  const defaultHighlightIds = selectInitialHighlightIds(entries)
  const highlightIds = initialProjection?.highlightIds ?? defaultHighlightIds
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
    preserveRecentOrder: Boolean(initialProjection),
    pendingStatusById: {},
    scrollRoot,
  }
}

export const projectHomeSession = (session, entries) => {
  const highlighted = new Set(session.highlightIds)
  const seen = new Set()
  const eligible = entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false
    }
    seen.add(entry.id)
    const pending = session.pendingStatusById[entry.id]
    return pending ? pending.previousStatus === "unread" : entry.status === "unread"
  })
  const eligibleIds = new Set(eligible.map(({ id }) => id))
  let recentIds
  if (session.preserveRecentOrder) {
    recentIds = []
    const seenRecentIds = new Set()
    for (const id of session.recentIds ?? []) {
      if (eligibleIds.has(id) && !highlighted.has(id) && !seenRecentIds.has(id)) {
        recentIds.push(id)
        seenRecentIds.add(id)
      }
    }
    const unseenRecentEntries = eligible
      .filter((entry) => !highlighted.has(entry.id) && !seenRecentIds.has(entry.id))
      .toSorted(byPublishedAt)
    for (const entry of unseenRecentEntries) {
      recentIds.push(entry.id)
    }
  } else {
    recentIds = eligible
      .filter((entry) => !highlighted.has(entry.id))
      .toSorted(byPublishedAt)
      .map((entry) => entry.id)
  }

  return {
    highlightIds: session.highlightIds.map((id) => (eligibleIds.has(id) ? id : null)),
    recentIds,
  }
}

export const transitionHomeSession = (session, event, entries) => {
  if (!session || event.sessionRevision !== session.sessionRevision) {
    return session
  }
  if (event.targetStatus !== "read" && event.targetStatus !== "unread") {
    return session
  }
  const pendingStatusById = { ...session.pendingStatusById }
  const highlightIds = [...session.highlightIds]
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
  const confirmedReadIds = new Set(
    event.outcome === "intent"
      ? []
      : event.entryIds.filter(
          (id) => !pendingAfterSettlement.has(id) && settledStatus(id) === "read",
        ),
  )
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
    if (!confirmedReadIds.has(id)) {
      continue
    }
    const vacancy = highlightIds.indexOf(id)
    if (vacancy === -1) {
      continue
    }
    const survivingIds = new Set(
      highlightIds.filter((candidate) => candidate != null && !confirmedReadIds.has(candidate)),
    )
    const surviving = entries.filter((entry) => survivingIds.has(entry.id))
    const recent = entries.filter(
      (entry) =>
        entry.status === "unread" &&
        !confirmedReadIds.has(entry.id) &&
        !survivingIds.has(entry.id) &&
        pendingStatusById[entry.id]?.previousStatus !== "read" &&
        pendingStatusById[entry.id]?.confirmedStatus !== "read",
    )
    highlightIds[vacancy] = selectBackfillCandidate(recent, surviving)?.id ?? null
  }
  return { ...session, highlightIds, pendingStatusById }
}
