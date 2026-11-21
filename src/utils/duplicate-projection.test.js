import { test } from "node:test"
import assert from "node:assert/strict"
import { projectDuplicates } from "./duplicate-projection.js"

test("collapse and expand preserve canonical entries and chronological positions", () => {
  const entries = [
    { id: 1, title: "same", status: "unread", feed: { title: "A" } },
    { id: 2, title: "other", starred: true },
    { id: 3, title: "same", status: "unread", feed: { title: "B" } },
  ]
  const collapsed = projectDuplicates(entries, "title")
  assert.deepEqual(
    collapsed.entries.map((e) => e.id),
    [1, 2],
  )
  assert.equal(collapsed.counts.get(1), 2)
  assert.deepEqual(projectDuplicates(entries, "title", new Set([1])).entries, entries)
  assert.equal(entries[2].status, "unread")
  assert.equal(entries[1].starred, true)
})
test("missing keys, disabled setting and repeated page IDs do not hide entries", () => {
  const entries = [{ id: 1, title: "" }, { id: 2 }, { id: 3, title: "x" }, { id: 3, title: "x" }]
  assert.deepEqual(projectDuplicates(entries, "title").entries, entries)
  assert.deepEqual(projectDuplicates(entries, "none").entries, entries)
})
test("equal titles can always be revealed independently", () => {
  const entries = [
    { id: 1, title: "Update" },
    { id: 2, title: "Update" },
  ]
  assert.deepEqual(projectDuplicates(entries, "title", new Set([1])).entries, entries)
})
