import assert from "node:assert/strict"
import { test } from "node:test"

// RED contract for QA-004: validate a provider response before the Reader or list consumes it.
const { validateMinifluxEntry, validateMinifluxEntryList } = await import(
  new URL("miniflux-response-validation.js", import.meta.url)
)

const validEntry = (overrides = {}) => ({
  id: 5,
  status: "unread",
  starred: false,
  title: "A valid article",
  content: "<p>Article body</p>",
  feed: {
    id: 3,
    category: { id: 1, title: "News" },
  },
  ...overrides,
})

test("validates a Reader entry and returns the original entry", () => {
  const entry = validEntry()

  assert.equal(validateMinifluxEntry(entry, 5), entry)
  assert.equal(validateMinifluxEntry(validEntry({ status: "read" }), 5).status, "read")
})

test("rejects missing, non-positive and non-integer entry IDs", () => {
  for (const id of [undefined, null, 0, -1, 1.5, "5"]) {
    assert.throws(() => validateMinifluxEntry(validEntry({ id }), 5), TypeError)
  }
})

test("rejects an entry whose ID does not match the requested article", () => {
  assert.throws(() => validateMinifluxEntry(validEntry({ id: 6 }), 5), TypeError)
})

test("rejects entries with missing or unsupported read state", () => {
  for (const status of [undefined, null, "archived"]) {
    assert.throws(() => validateMinifluxEntry(validEntry({ status }), 5), TypeError)
  }
})

test("rejects entries without a boolean starred state", () => {
  for (const starred of [undefined, null, "false", 0]) {
    assert.throws(() => validateMinifluxEntry(validEntry({ starred }), 5), TypeError)
  }
})

test("rejects null, array, and Reader-incomplete entry structures", () => {
  for (const entry of [
    null,
    [],
    { ...validEntry(), feed: null },
    { ...validEntry(), feed: { category: { id: 1, title: "News" } } },
    { ...validEntry(), feed: { id: 0, category: { id: 1, title: "News" } } },
  ]) {
    assert.throws(() => validateMinifluxEntry(entry, 5), TypeError)
  }
})

test("accepts null and empty article title/content so existing fallbacks remain usable", () => {
  for (const title of [null, ""]) {
    for (const content of [null, ""]) {
      const entry = validEntry({ title, content })

      assert.equal(validateMinifluxEntry(entry, 5), entry)
    }
  }
})

test("rejects non-text title/content types without rejecting nullable values", () => {
  assert.throws(() => validateMinifluxEntry(validEntry({ title: 42 }), 5), TypeError)
  assert.throws(() => validateMinifluxEntry(validEntry({ content: {} }), 5), TypeError)
})

test("validates a list envelope and each entry without filtering the list", () => {
  const response = { total: 1, entries: [validEntry()] }

  assert.equal(validateMinifluxEntryList(response), response)
})

test("rejects invalid list envelopes", () => {
  for (const response of [
    null,
    [],
    { entries: [] },
    { total: -1, entries: [] },
    { total: 1.5, entries: [] },
    { total: 1, entries: null },
  ]) {
    assert.throws(() => validateMinifluxEntryList(response), TypeError)
  }
})

test("rejects a malformed list member instead of silently dropping it", () => {
  const response = { total: 2, entries: [validEntry(), { id: 0 }] }

  assert.throws(() => validateMinifluxEntryList(response), TypeError)
  assert.equal(response.entries.length, 2)
})
