import assert from "node:assert/strict"
import { test } from "node:test"

const {
  createHomePaginationBoundary,
  deduplicateHomeEntriesById,
  getHomeTieDrainBucketSecond,
  inspectHomeTieDrainPage,
} = await import(new URL("home-editorial-session.js", import.meta.url))

const bucketSecond = 1_791_792_000
const entry = (id, second = bucketSecond) => ({
  id,
  published_at: new Date(second * 1000 + 250).toISOString(),
})

test("BOUNDARY_TIE_RECOVERS_OMITTED_ID starts a drain for a saturated second", () => {
  const entries = Array.from({ length: 20 }, (_, index) => entry(11_000 + index))
  assert.equal(getHomeTieDrainBucketSecond({ entries, total: 23, pageSize: 20 }), bucketSecond)
  assert.deepEqual(createHomePaginationBoundary({ entries, total: 23, pageSize: 20 }), {
    cursor: bucketSecond,
    tieDrain: { bucketSecond, beforeEntryId: null },
  })
})

test("TIE_BUCKET_PAGE_SIZE_PLUS_ONE drains a single extra tied entry", () => {
  const entries = Array.from({ length: 20 }, (_, index) => entry(100 + index))
  const page = Array.from({ length: 20 }, (_, index) => entry(120 - index))
  const inspected = inspectHomeTieDrainPage({
    entries: page,
    bucketSecond,
    beforeEntryId: null,
    pageSize: 20,
  })
  assert.equal(entries.length + 1, 21)
  assert.equal(inspected.advances, true)
  assert.equal(inspected.exhausted, false)
  assert.equal(inspected.nextBeforeEntryId, 101)
})

test("TIE_BUCKET_SPANS_MULTIPLE_DRAIN_PAGES advances to the last provider ID", () => {
  const firstPage = Array.from({ length: 5 }, (_, index) => entry(50 - index))
  const secondPage = Array.from({ length: 5 }, (_, index) => entry(45 - index))
  const first = inspectHomeTieDrainPage({
    entries: firstPage,
    bucketSecond,
    beforeEntryId: null,
    pageSize: 5,
  })
  const second = inspectHomeTieDrainPage({
    entries: secondPage,
    bucketSecond,
    beforeEntryId: first.nextBeforeEntryId,
    pageSize: 5,
  })
  assert.equal(first.exhausted, false)
  assert.equal(second.exhausted, false)
  assert.equal(second.nextBeforeEntryId, 41)
})

test("MIXED_PAGE_TRANSITIONS_TO_TIE_DRAIN only after a full single-second response", () => {
  const mixedPage = [entry(10), entry(9, bucketSecond - 60), entry(8, bucketSecond - 120)]
  assert.equal(
    createHomePaginationBoundary({ entries: mixedPage, total: 30, pageSize: 3 }).tieDrain,
    undefined,
  )
  const tiedContinuation = Array.from({ length: 3 }, (_, index) => entry(7 - index))
  assert.deepEqual(
    createHomePaginationBoundary({ entries: tiedContinuation, total: 20, pageSize: 3 }).tieDrain,
    { bucketSecond, beforeEntryId: null },
  )
})

test("TIE_DRAIN_DEDUPLICATES_REPLAYED_IDS accepts overlap while the ID cursor advances", () => {
  const inspected = inspectHomeTieDrainPage({
    entries: [entry(20), entry(19), entry(18)],
    bucketSecond,
    beforeEntryId: 21,
    pageSize: 3,
  })
  assert.equal(inspected.advances, true)
  assert.deepEqual(
    inspected.entries.map(({ id }) => id),
    [20, 19, 18],
  )
  const retained = deduplicateHomeEntriesById([entry(20), ...inspected.entries])
  assert.deepEqual(
    retained.map(({ id }) => id),
    [20, 19, 18],
  )
})

test("TIE_DRAIN_ADVANCES_BY_ID rejects a repeated or non-descending provider page", () => {
  const replayed = inspectHomeTieDrainPage({
    entries: [entry(20), entry(19)],
    bucketSecond,
    beforeEntryId: 20,
    pageSize: 2,
  })
  const unordered = inspectHomeTieDrainPage({
    entries: [entry(20), entry(21)],
    bucketSecond,
    beforeEntryId: null,
    pageSize: 2,
  })
  assert.equal(replayed.advances, false)
  assert.equal(unordered.advances, false)
})

test("TIE_DRAIN_EXHAUSTION_RESUMES_PUBLISHED_CURSOR after a short page", () => {
  const inspected = inspectHomeTieDrainPage({
    entries: [entry(10), entry(9)],
    bucketSecond,
    beforeEntryId: 11,
    pageSize: 3,
  })
  assert.equal(inspected.exhausted, true)
  assert.equal(inspected.nextBeforeEntryId, 9)
  const boundary = {
    cursor: bucketSecond,
    ...(!inspected.exhausted && {
      tieDrain: { bucketSecond, beforeEntryId: inspected.nextBeforeEntryId },
    }),
  }
  assert.deepEqual(boundary, { cursor: bucketSecond })
})

test("ADJACENT_SECOND_NOT_ADMITTED filters provider-window neighbors", () => {
  const inspected = inspectHomeTieDrainPage({
    entries: [entry(30), entry(29, bucketSecond - 1), entry(28, bucketSecond + 1)],
    bucketSecond,
    beforeEntryId: null,
    pageSize: 3,
  })
  assert.deepEqual(
    inspected.entries.map(({ id }) => id),
    [30],
  )
})
