import assert from "node:assert/strict"
import test from "node:test"

// Node runs these tests without a bundler.
/* eslint-disable import/extensions -- Node runs tests without a bundler. */
import {
  canCaptureReaderScroll,
  clampReaderPosition,
  findReaderPosition,
} from "./reader-position.js"

test("restores only the matching account, article and content version", () => {
  const records = [{ kind: "reader", account: "a", entryId: 1, scope: "digest", offset: 800 }]
  assert.equal(findReaderPosition(records, "a", 1, "digest"), 800)
  assert.equal(findReaderPosition(records, "b", 1, "digest"), null)
  assert.equal(findReaderPosition(records, "a", 2, "digest"), null)
  assert.equal(findReaderPosition(records, "a", 1, "changed"), null)
  assert.equal(findReaderPosition([{ ...records[0], offset: Infinity }], "a", 1, "digest"), null)
})

test("clamps positions to the scrollable range", () => {
  assert.equal(clampReaderPosition(800, 500, 100), 400)
  assert.equal(clampReaderPosition(800, 100, 500), 0)
})

test("gesture permits momentum briefly and reset immediately invalidates capture", () => {
  const gesture = { revision: 7, at: 1000 }
  assert.equal(canCaptureReaderScroll(gesture, 7, 1000), true)
  assert.equal(canCaptureReaderScroll(gesture, 7, 2400), true)
  assert.equal(canCaptureReaderScroll(gesture, 7, 2501), false)
  assert.equal(canCaptureReaderScroll(gesture, 8, 1100), false)
  assert.equal(canCaptureReaderScroll(null, 7, 1100), false)
})
