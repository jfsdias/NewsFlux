import assert from "node:assert/strict"
import test from "node:test"

const {
  appendHomeSessionEntries,
  createHomeEditorialSession,
  createHomeSessionKey,
  deduplicateHomeEntriesById,
  getHomePaginationBoundary,
  mergeHomeSessionEntries,
  projectHomeSession,
  transitionHomeSession,
} = await import(new URL("home-editorial-session.js", import.meta.url))

const entry = (id, time, feedId = id, status = "unread") => ({
  id,
  status,
  published_at: `2026-10-${String(time).padStart(2, "0")}T00:00:00Z`,
  feed: { id: feedId, category: { id: feedId } },
})

const loaded = [entry(1, 12), entry(2, 11), entry(3, 10), entry(4, 9), entry(5, 8)]
const defaultProjection = { highlightIds: [1, 2, 3], recentIds: [4, 5] }
const fields = {
  identityKey: "server:user",
  showHiddenFeeds: false,
  pageSize: 5,
  sessionRevision: 1,
}
const key = createHomeSessionKey(fields)
const start = (entries = loaded, initialProjection = defaultProjection, sessionRevision = 1) =>
  createHomeEditorialSession({
    requestKey: key,
    sessionRevision,
    entries,
    initialProjection,
  })
const event = (
  entryIds,
  targetStatus,
  outcome,
  previousStatus = "unread",
  sessionRevision = 1,
) => ({
  entryIds: Array.isArray(entryIds) ? entryIds : [entryIds],
  previousStatuses: Object.fromEntries(
    (Array.isArray(entryIds) ? entryIds : [entryIds]).map((id) => [id, previousStatus]),
  ),
  targetStatus,
  outcome,
  sessionRevision,
})
const setStatus = (entries, ids, status) =>
  entries.map((item) => (ids.includes(item.id) ? { ...item, status } : item))
const projection = (session, entries) => projectHomeSession(session, entries)

test("home session key ignores refresh generation", () => {
  assert.equal(
    createHomeSessionKey({ ...fields, articleListRevision: 1 }),
    createHomeSessionKey({ ...fields, articleListRevision: 9 }),
  )
})

test("CONFIRMED_PRIMARY_READ_RETAINS_SLOT — Phase 2D keeps committed Highlights stable", () => {
  const initial = start()
  const pending = transitionHomeSession(initial, event(1, "read", "intent"), loaded)
  const confirmed = transitionHomeSession(
    pending,
    event(1, "read", "confirmed"),
    setStatus(loaded, [1], "read"),
  )

  assert.deepEqual(confirmed.highlightIds, [1, 2, 3])
  assert.deepEqual(projection(confirmed, setStatus(loaded, [1], "read")).highlightIds, [1, 2, 3])
})

test("CONFIRMED_SECONDARY_READ_RETAINS_SLOT — confirmed read does not backfill Highlights", () => {
  const readEntries = setStatus(loaded, [2], "read")
  const confirmed = transitionHomeSession(start(), event(2, "read", "confirmed"), readEntries)

  assert.deepEqual(confirmed.highlightIds, [1, 2, 3])
  assert.deepEqual(projection(confirmed, readEntries).highlightIds, [1, 2, 3])
})

test("CONFIRMED_RECENT_READ_RETAINS_POSITION — committed Recent order survives read settlement", () => {
  const initial = start(loaded, { highlightIds: [1, 2, 3], recentIds: [5, 4] })
  const readEntries = setStatus(loaded, [4], "read")
  const confirmed = transitionHomeSession(initial, event(4, "read", "confirmed"), readEntries)

  assert.deepEqual(projection(confirmed, readEntries).recentIds, [5, 4])
})

test("READER_STYLE_STATUS_CAN_CHANGE_WITHOUT_MEMBERSHIP_CHANGE", () => {
  const readEntries = setStatus(loaded, [1], "read")
  const committed = transitionHomeSession(start(), event(1, "read", "confirmed"), readEntries)

  assert.equal(readEntries.find(({ id }) => id === 1).status, "read")
  assert.deepEqual(projection(committed, readEntries).highlightIds, [1, 2, 3])
})

test("CONFIRMED_UNREAD_DOES_NOT_INSERT_NONCOMMITTED_ENTRY", () => {
  const readEntry = entry(6, 13, 6, "read")
  const initialEntries = [...loaded, readEntry]
  const initial = start(initialEntries)
  const unreadEntries = setStatus(initialEntries, [6], "unread")
  const confirmed = transitionHomeSession(
    initial,
    event(6, "unread", "confirmed", "read"),
    unreadEntries,
  )

  assert.deepEqual(projection(confirmed, unreadEntries), defaultProjection)
})

test("REJECTED_READ_DOES_NOT_CHANGE_PROJECTION after status rollback", () => {
  const initial = start()
  const pending = transitionHomeSession(initial, event(1, "read", "intent"), loaded)
  const rolledBack = transitionHomeSession(pending, event(1, "read", "rejected"), loaded)

  assert.deepEqual(projection(rolledBack, loaded), defaultProjection)
})

test("BATCHED_READS_DO_NOT_BACKFILL — exact committed Highlight order remains", () => {
  const readEntries = setStatus(loaded, [1, 2], "read")
  const confirmed = transitionHomeSession(start(), event([1, 2], "read", "confirmed"), readEntries)

  assert.deepEqual(projection(confirmed, readEntries).highlightIds, [1, 2, 3])
})

test("ZERO_UNREAD_SESSION_RETAINS_COMMITTED_PROJECTION", () => {
  const readEntries = setStatus(loaded, [1, 2, 3, 4, 5], "read")
  const confirmed = transitionHomeSession(
    start(),
    event([1, 2, 3, 4, 5], "read", "confirmed"),
    readEntries,
  )

  assert.deepEqual(projection(confirmed, readEntries), defaultProjection)
})

test("LOAD_MORE_APPENDS_WITHOUT_REORDER — newly loaded canonical entries follow committed Recent", () => {
  const initial = start(loaded, { highlightIds: [1, 2, 3], recentIds: [5, 4] })
  const loadedMore = [...loaded, entry(6, 7), entry(7, 6)]
  const appended = appendHomeSessionEntries(initial, loadedMore)

  assert.deepEqual(appended.highlightIds, [1, 2, 3])
  assert.deepEqual(appended.recentIds, [5, 4, 6, 7])

  const readSix = setStatus(loadedMore, [6], "read")
  const confirmed = transitionHomeSession(appended, event(6, "read", "confirmed"), readSix)
  assert.deepEqual(projection(confirmed, readSix).recentIds, [5, 4, 6, 7])
})

test("STAR_UNSTAR_NO_RECOMPOSE — star-only state keeps the committed projection", () => {
  const initial = start()
  const afterStar = transitionHomeSession(initial, event(1, "starred", "confirmed"), loaded)
  const afterUnstar = transitionHomeSession(afterStar, event(1, "unstarred", "confirmed"), loaded)

  assert.equal(afterStar, initial)
  assert.equal(afterUnstar, initial)
  assert.deepEqual(projection(afterUnstar, loaded), defaultProjection)
})

test("LATE_PROFILE_NO_RECOMPOSE — a late profile result cannot change a committed projection", () => {
  const initial = start()
  const before = projection(initial, loaded)
  const afterLateProfile = projection(initial, loaded)

  assert.deepEqual(afterLateProfile, before)
  assert.deepEqual(afterLateProfile, defaultProjection)
})

test("NEW_SESSION_REBUILDS_FROM_CURRENT_UNREAD", () => {
  const currentUnread = setStatus(loaded, [1], "read")
  const nextSession = createHomeEditorialSession({
    requestKey: key,
    sessionRevision: 2,
    entries: currentUnread,
  })

  assert.equal(projection(nextSession, currentUnread).highlightIds.includes(1), false)
  assert.deepEqual(projection(nextSession, currentUnread).highlightIds, [2, 3, 4])
})

test("MANUAL_REFRESH_PRESERVES_PROJECTION_AND_APPENDS_NEW_UNREAD_TO_RECENT", () => {
  const initial = start(loaded, { highlightIds: [1, 3, 2], recentIds: [5, 4] })
  const refreshedEntries = [...setStatus(loaded, [1], "read"), entry(6, 13)]
  const refreshedSession = appendHomeSessionEntries(initial, refreshedEntries)

  assert.deepEqual(refreshedSession.highlightIds, [1, 3, 2])
  assert.deepEqual(refreshedSession.recentIds, [5, 4, 6])
  assert.deepEqual(projection(refreshedSession, refreshedEntries), {
    highlightIds: [1, 3, 2],
    recentIds: [5, 4, 6],
  })
  assert.equal(refreshedEntries.find(({ id }) => id === 1).status, "read")
})

test("REFRESH_MERGE_PRESERVES_SESSION_MEMBERS_AND_USES_CANONICAL_ENTRY_OBJECTS", () => {
  const canonicalUpdate = { ...loaded[0], title: "Fresh title", status: "read" }
  const merged = mergeHomeSessionEntries(loaded, [canonicalUpdate, entry(6, 13)])

  assert.deepEqual(
    merged.map(({ id }) => id),
    [1, 6, 2, 3, 4, 5],
  )
  assert.equal(merged[0], canonicalUpdate)
  assert.equal(
    merged.find(({ id }) => id === 2),
    loaded[1],
  )
})

test("HOME_CANONICAL_ENTRIES_DEDUPLICATE_IDS_WITHOUT_REPLACING_THE_FIRST_ENTRY", () => {
  const first = entry(1, 13)
  const duplicate = { ...first, title: "Duplicate response" }

  assert.deepEqual(deduplicateHomeEntriesById([first, entry(2, 12), duplicate]), [
    first,
    entry(2, 12),
  ])
})

test("Home pagination boundary uses the second-oldest canonical timestamp for overlap", () => {
  const canonicalPage = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    published_at: new Date(Date.UTC(2026, 9, 18, 12, -index)).toISOString(),
  }))

  assert.equal(
    getHomePaginationBoundary(canonicalPage),
    Math.floor(Date.parse(canonicalPage[18].published_at) / 1000),
  )
  assert.equal(getHomePaginationBoundary([]), null)
})

test("session identity or visibility change discards old Highlights", () => {
  assert.notEqual(key, createHomeSessionKey({ ...fields, identityKey: "other" }))
  assert.notEqual(key, createHomeSessionKey({ ...fields, showHiddenFeeds: true }))
})

test("stale status settlement cannot mutate the current Home session", () => {
  const session = start()
  assert.equal(
    transitionHomeSession(session, event(1, "read", "confirmed", "unread", 0), loaded),
    session,
  )
})

test("a new Home session retains canonical Phase 2C order before personalization", () => {
  const session = createHomeEditorialSession({
    requestKey: key,
    sessionRevision: 1,
    entries: loaded,
  })
  assert.deepEqual(projection(session, loaded), defaultProjection)
})

test("retains an explicitly committed personalized projection", () => {
  const session = start(loaded, { highlightIds: [1, 3, 2], recentIds: [5, 4] })
  assert.deepEqual(projection(session, loaded), { highlightIds: [1, 3, 2], recentIds: [5, 4] })
})

test("load-more ignores already observed IDs and read entries", () => {
  const initial = start()
  const appended = appendHomeSessionEntries(initial, [
    ...loaded,
    entry(6, 7, 6, "read"),
    entry(7, 6),
  ])

  assert.deepEqual(appended.recentIds, [4, 5, 7])
  assert.deepEqual(appendHomeSessionEntries(appended, [...loaded, entry(7, 6)]), appended)
})
