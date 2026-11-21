/* eslint-disable import/extensions -- Native ESM tests import these utilities directly. */

import assert from "node:assert/strict"
import { test } from "node:test"

import { projectDuplicates } from "./duplicate-projection.js"
import { getRelativeUnreadTargetIds } from "./relative-read-targets.js"

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

test("relative actions target displayed entries in collapsed and expanded groups", () => {
  const entries = [
    { id: 1, title: "same", status: "unread" },
    { id: 2, title: "same", status: "unread" },
    { id: 3, title: "other", status: "unread" },
  ]
  const collapsed = projectDuplicates(entries, "title").entries
  const expanded = projectDuplicates(entries, "title", new Set([1])).entries
  assert.deepEqual(getRelativeUnreadTargetIds(collapsed, 3, "above"), [1])
  assert.deepEqual(getRelativeUnreadTargetIds(expanded, 3, "above"), [1, 2])
  assert.deepEqual(getRelativeUnreadTargetIds(collapsed, 1, "below"), [3])
  assert.deepEqual(getRelativeUnreadTargetIds(expanded, 1, "below"), [2, 3])
})
