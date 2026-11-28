import assert from "node:assert/strict"
import test from "node:test"

import {
  buildSignalBatches,
  createSignalStorage,
  getReadToEndDwellMs,
  isReadToEnd,
  MAX_BATCH_ROWS,
  MAX_SEEN_PER_KIND,
  recordSignal,
  removeSentRows,
  sanitizeSignalStorage,
} from "./reading-signals.js" // eslint-disable-line import/extensions

const ACCOUNT = "a".repeat(64)
const NOW = Date.parse("2026-11-28T12:00:00Z")
const DAY = 86_400_000

const record = (storage, kind, entryId, feedId, nowMs = NOW) =>
  recordSignal(storage, { account: ACCOUNT, kind, entryId, feedId, nowMs })

test("counts each kind once per entry per UTC day and keeps only per-feed daily counters", () => {
  let storage = createSignalStorage(ACCOUNT)
  storage = record(storage, "impressions", 1, 10)
  storage = record(storage, "impressions", 1, 10)
  storage = record(storage, "impressions", 2, 10)
  storage = record(storage, "opens", 1, 10)
  storage = record(storage, "impressions", 1, 10, NOW + DAY)
  const [batch] = buildSignalBatches(storage, NOW + DAY)
  assert.deepEqual(batch, {
    schema: 1,
    rows: [
      { feed_id: 10, day: "2026-11-28", impressions: 2, opens: 1, read_to_end: 0, stars: 0 },
      { feed_id: 10, day: "2026-11-29", impressions: 1, opens: 0, read_to_end: 0, stars: 0 },
    ],
  })
})

test("rejects invalid kinds, ids and foreign accounts without changing state", () => {
  const storage = createSignalStorage(ACCOUNT)
  for (const input of [
    { kind: "clicks", entryId: 1, feedId: 1 },
    { kind: "opens", entryId: 0, feedId: 1 },
    { kind: "opens", entryId: 1, feedId: -2 },
    { kind: "opens", entryId: "1", feedId: 1 },
    { kind: "opens", entryId: 1.5, feedId: 1 },
  ]) {
    assert.equal(recordSignal(storage, { account: ACCOUNT, nowMs: NOW, ...input }), storage)
  }
  const other = recordSignal(storage, {
    account: "b".repeat(64),
    kind: "opens",
    entryId: 1,
    feedId: 1,
    nowMs: NOW,
  })
  assert.equal(other.account, "b".repeat(64))
  assert.deepEqual(buildSignalBatches(other, NOW)[0].rows.length, 1)
})

test("the per-day seen set is bounded and never stored beyond the current day", () => {
  let storage = createSignalStorage(ACCOUNT)
  for (let id = 1; id <= MAX_SEEN_PER_KIND + 10; id += 1) {
    storage = record(storage, "impressions", id, 1)
  }
  assert.equal(storage.seen.impressions.length, MAX_SEEN_PER_KIND)
  storage = record(storage, "opens", 1, 1, NOW + DAY)
  assert.equal(storage.seen.impressions.length, 0)
  assert.equal(storage.day, "2026-11-29")
})

test("rows older than seven days are dropped and batches respect the server row limit", () => {
  let storage = createSignalStorage(ACCOUNT)
  storage = record(storage, "opens", 1, 1, NOW - 9 * DAY)
  for (let feed = 1; feed <= MAX_BATCH_ROWS + 5; feed += 1) {
    storage = record(storage, "impressions", feed, feed)
  }
  const batches = buildSignalBatches(storage, NOW)
  assert.equal(batches.length, 2)
  assert.equal(batches[0].rows.length, MAX_BATCH_ROWS)
  assert.equal(
    batches.flatMap((batch) => batch.rows).some((row) => row.day < "2026-11-21"),
    false,
  )
})

test("removing sent rows keeps increments recorded during the flush", () => {
  let storage = record(createSignalStorage(ACCOUNT), "impressions", 1, 1)
  const [batch] = buildSignalBatches(storage, NOW)
  storage = record(storage, "impressions", 2, 1)
  storage = removeSentRows(storage, batch.rows)
  assert.deepEqual(buildSignalBatches(storage, NOW)[0].rows, [
    { feed_id: 1, day: "2026-11-28", impressions: 1, opens: 0, read_to_end: 0, stars: 0 },
  ])
  const [rest] = buildSignalBatches(storage, NOW)
  assert.deepEqual(buildSignalBatches(removeSentRows(storage, rest.rows), NOW), [])
})

test("sanitizes stored state and never keeps titles, URLs or unknown fields", () => {
  const stored = {
    version: 1,
    account: ACCOUNT,
    day: "2026-11-28",
    seen: { impressions: [1, "x", -1], opens: [], read_to_end: [], stars: [], titles: ["t"] },
    rows: {
      "1|2026-11-28": { impressions: 2, opens: 0, read_to_end: 0, stars: 0, url: "https://x" },
      "bad|key": { impressions: 1, opens: 0, read_to_end: 0, stars: 0 },
    },
    title: "secret",
  }
  const clean = sanitizeSignalStorage(stored, ACCOUNT)
  assert.deepEqual(clean.seen.impressions, [1])
  assert.deepEqual(Object.keys(clean.rows), ["1|2026-11-28"])
  assert.equal(JSON.stringify(clean).includes("secret"), false)
  assert.equal(JSON.stringify(clean).includes("https"), false)
  assert.deepEqual(
    sanitizeSignalStorage(stored, "c".repeat(64)),
    createSignalStorage("c".repeat(64)),
  )
  assert.deepEqual(sanitizeSignalStorage("garbage", ACCOUNT), createSignalStorage(ACCOUNT))
})

test("read to end needs most of the body and a dwell scaled to reading time", () => {
  assert.equal(getReadToEndDwellMs(0), 5000)
  assert.equal(getReadToEndDwellMs(4), 72_000)
  assert.equal(getReadToEndDwellMs(60), 120_000)
  assert.equal(isReadToEnd({ progress: 0.9, dwellMs: 80_000, readingTimeMinutes: 4 }), true)
  assert.equal(isReadToEnd({ progress: 0.8, dwellMs: 80_000, readingTimeMinutes: 4 }), false)
  assert.equal(isReadToEnd({ progress: 1, dwellMs: 10_000, readingTimeMinutes: 4 }), false)
})
