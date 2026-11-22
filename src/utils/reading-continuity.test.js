import assert from "node:assert/strict"
import test from "node:test"

import {
  clearContinuityAccount,
  MAX_CONTINUITY_RECORDS,
  sanitizeContinuityStorage,
  upsertContinuity,
} from "./reading-continuity.js" // eslint-disable-line import/extensions

const reader = {
  account: "a".repeat(64),
  kind: "reader",
  scope: "b".repeat(64),
  entryId: 42,
  offset: 120,
}
test("rejects malformed, unknown-version and out-of-range records", () => {
  assert.deepEqual(sanitizeContinuityStorage({ version: 2, records: [reader] }).records, [])
  for (const patch of [
    { offset: -1 },
    { offset: Infinity },
    { entryId: 0 },
    { scope: "" },
    { kind: "other" },
  ]) {
    assert.deepEqual(
      sanitizeContinuityStorage({ version: 1, records: [{ ...reader, ...patch }] }).records,
      [],
    )
  }
})
test("drops unrelated fields and preserves independent account and content scopes", () => {
  let storage = upsertContinuity(null, { ...reader, content: "secret" })
  storage = upsertContinuity(storage, { ...reader, account: "c".repeat(64) })
  storage = upsertContinuity(storage, { ...reader, scope: "d".repeat(64) })
  assert.equal(storage.records.length, 3)
  assert.equal(JSON.stringify(storage).includes("secret"), false)
  assert.deepEqual(
    clearContinuityAccount(storage, "a".repeat(64)).records.map((x) => x.account),
    ["c".repeat(64)],
  )
})
test("caps storage and replaces an existing list anchor for the same scope", () => {
  let storage = null
  for (let id = 1; id <= MAX_CONTINUITY_RECORDS + 10; id++) {
    storage = upsertContinuity(storage, { ...reader, entryId: id })
  }
  assert.equal(storage.records.length, MAX_CONTINUITY_RECORDS)
  storage = upsertContinuity(storage, { ...reader, kind: "list", entryId: 1 })
  storage = upsertContinuity(storage, { ...reader, kind: "list", entryId: 2 })
  assert.equal(storage.records.filter((x) => x.kind === "list").length, 1)
  assert.equal(storage.records[0].entryId, 2)
})
