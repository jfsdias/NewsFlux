import assert from "node:assert/strict"
import { test } from "node:test"

const {
  appendTemporalCanonicalEntries,
  createTemporalPaginationState,
  getTemporalTieDrainBucketSecond,
  inspectTemporalTieDrainPage,
  isTemporalPaginationStateCurrent,
  sortEntriesByTemporal,
} = await import(new URL("temporal-tie-drain.js", import.meta.url))

const bucketSecond = 1_792_512_000
const entry = (id, second = bucketSecond, sortProperty = "published_at") => ({
  id,
  [sortProperty]: new Date(second * 1000).toISOString(),
})

test("PUBLISHED_DESC_TIE_RECOVERY detects a saturated second with remaining entries", () => {
  const entries = Array.from({ length: 3 }, (_, index) => entry(30 - index))
  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries,
      total: 4,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    bucketSecond,
  )
})

test("PUBLISHED_ASC_TIE_RECOVERY uses the same whole-second boundary", () => {
  const entries = Array.from({ length: 3 }, (_, index) => entry(20 + index))
  const state = createTemporalPaginationState({
    entries,
    total: 4,
    pageSize: 3,
    sortProperty: "published_at",
    orderDirection: "asc",
    requestKey: "all-asc",
    sessionRevision: 2,
    snapshotRevision: 5,
  })
  assert.deepEqual(state.tieDrain, { bucketSecond, idCursor: null })
})

test("CHANGED_DESC_TIE_RECOVERY and CHANGED_ASC_TIE_RECOVERY detect changed-at ties", () => {
  const entries = Array.from({ length: 3 }, (_, index) =>
    entry(10 + index, bucketSecond, "changed_at"),
  )
  for (const orderDirection of ["desc", "asc"]) {
    const state = createTemporalPaginationState({
      entries,
      total: 4,
      pageSize: 3,
      sortProperty: "changed_at",
      orderDirection,
      requestKey: `history-${orderDirection}`,
      sessionRevision: 4,
      snapshotRevision: 9,
    })
    assert.deepEqual(state.tieDrain, { bucketSecond, idCursor: null })
  }
})

test("TIE_BUCKET_PAGE_SIZE_PLUS_ONE and TIE_BUCKET_SPANS_MULTIPLE_DRAIN_PAGES", () => {
  const firstPage = [entry(9), entry(8), entry(7)]
  const secondPage = [entry(6), entry(5), entry(4)]
  const first = inspectTemporalTieDrainPage({
    entries: firstPage,
    bucketSecond,
    idCursor: null,
    pageSize: 3,
    sortProperty: "published_at",
  })
  const second = inspectTemporalTieDrainPage({
    entries: secondPage,
    bucketSecond,
    idCursor: first.nextIdCursor,
    pageSize: 3,
    sortProperty: "published_at",
  })
  assert.equal(first.exhausted, false)
  assert.equal(first.nextIdCursor, 7)
  assert.equal(second.exhausted, false)
  assert.equal(second.nextIdCursor, 4)
})

test("TIE_DRAIN_DEDUPLICATES_REPLAYED_IDS and TIE_DRAIN_ADVANCES_BY_ID", () => {
  const initial = createTemporalPaginationState({
    entries: [entry(12), entry(11)],
    total: 3,
    pageSize: 2,
    sortProperty: "published_at",
    orderDirection: "desc",
    requestKey: "all",
    sessionRevision: 1,
    snapshotRevision: 2,
  })
  const appended = appendTemporalCanonicalEntries(initial, [entry(11), entry(10)])
  assert.deepEqual(appended.canonicalEntryIds, [12, 11, 10])

  const replayed = inspectTemporalTieDrainPage({
    entries: [entry(12), entry(11)],
    bucketSecond,
    idCursor: 11,
    pageSize: 2,
    sortProperty: "published_at",
  })
  assert.equal(replayed.advances, false)
})

test("TIE_DRAIN_EXHAUSTION_RESUMES_TEMPORAL_CURSOR after the bucket is drained", () => {
  const state = createTemporalPaginationState({
    entries: [entry(21), entry(20)],
    total: 4,
    pageSize: 2,
    sortProperty: "published_at",
    orderDirection: "desc",
    requestKey: "all",
    sessionRevision: 1,
    snapshotRevision: 2,
  })
  const page = inspectTemporalTieDrainPage({
    entries: [entry(19)],
    bucketSecond,
    idCursor: 20,
    pageSize: 2,
    sortProperty: "published_at",
  })
  assert.equal(page.exhausted, true)
  assert.deepEqual(
    page.entries.map(({ id }) => id),
    [19],
  )
  assert.deepEqual(
    appendTemporalCanonicalEntries(state, page.entries).canonicalEntries.map(({ id }) => id),
    [21, 20, 19],
  )
})

test("ADJACENT_SECOND_NOT_ADMITTED filters exact whole-second membership", () => {
  const page = inspectTemporalTieDrainPage({
    entries: [entry(30), entry(29, bucketSecond - 1), entry(28, bucketSecond + 1)],
    bucketSecond,
    idCursor: null,
    pageSize: 3,
    sortProperty: "published_at",
  })
  assert.deepEqual(
    page.entries.map(({ id }) => id),
    [30],
  )
})

test("SAFE_PAGE_NO_FALSE_POSITIVE, CREATED_AT_NO_TIE_DRAIN, and EMPTY_PAGE_NO_TIE_DRAIN", () => {
  const tied = [entry(4), entry(3), entry(2)]
  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: tied,
      total: 3,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    null,
  )
  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: [entry(4), entry(3, bucketSecond - 1), entry(2)],
      total: 8,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    null,
  )
  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: [],
      total: 2,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    null,
  )
  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: tied,
      total: 4,
      pageSize: 3,
      sortProperty: "created_at",
    }),
    null,
  )
})

test("MIXED_PAGE_TRANSITIONS_TO_TIE_DRAIN only when its continuation edge repeats a known second", () => {
  const knownEntries = [entry(40, bucketSecond + 2), entry(39, bucketSecond + 1), entry(38)]
  const mixedBoundaryPage = [entry(37), entry(36), entry(35, bucketSecond - 1)]

  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: mixedBoundaryPage,
      knownEntries,
      total: 7,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    bucketSecond,
  )

  assert.equal(
    getTemporalTieDrainBucketSecond({
      entries: [
        entry(37, bucketSecond - 2),
        entry(36, bucketSecond - 1),
        entry(35, bucketSecond - 2),
      ],
      knownEntries,
      total: 7,
      pageSize: 3,
      sortProperty: "published_at",
    }),
    null,
  )
})

test("DISPLAY_ORDER_PRESERVED sorts temporal fields, not ID acquisition order", () => {
  const entries = [entry(1, bucketSecond - 1), entry(3, bucketSecond + 1), entry(2, bucketSecond)]
  assert.deepEqual(
    sortEntriesByTemporal(entries, "published_at", "asc").map(({ id }) => id),
    [1, 2, 3],
  )
  assert.deepEqual(
    sortEntriesByTemporal(entries, "published_at", "desc").map(({ id }) => id),
    [3, 2, 1],
  )
})

test("REQUEST_KEY_PROTECTION, SESSION_REVISION, and SNAPSHOT_REVISION fence tie state", () => {
  const state = createTemporalPaginationState({
    entries: [entry(21), entry(20)],
    total: 3,
    pageSize: 2,
    sortProperty: "published_at",
    orderDirection: "desc",
    requestKey: "scope-a",
    sessionRevision: 3,
    snapshotRevision: 8,
  })
  assert.equal(
    isTemporalPaginationStateCurrent(state, {
      requestKey: "scope-a",
      sessionRevision: 3,
      snapshotRevision: 8,
    }),
    true,
  )
  assert.equal(
    isTemporalPaginationStateCurrent(state, {
      requestKey: "scope-b",
      sessionRevision: 3,
      snapshotRevision: 8,
    }),
    false,
  )
  assert.equal(
    isTemporalPaginationStateCurrent(state, {
      requestKey: "scope-a",
      sessionRevision: 4,
      snapshotRevision: 8,
    }),
    false,
  )
  assert.equal(
    isTemporalPaginationStateCurrent(state, {
      requestKey: "scope-a",
      sessionRevision: 3,
      snapshotRevision: 9,
    }),
    false,
  )
})
