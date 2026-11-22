import assert from "node:assert/strict"
import test from "node:test"

import {
  canOpenSmartView,
  getSmartViews,
  moveSmartView,
  sanitizeSmartView,
  sanitizeSmartViewStorage,
  setSmartViews,
  smartViewPath,
  smartViewRestorationState,
} from "./smart-views.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const base = {
  id: "one",
  name: "Reading",
  query: '"red apple" OR banana -rotten',
  source: "feed",
  sourceId: 7,
  filterDate: "2026-11-20",
  showStatus: "unread",
  orderBy: "published_at",
  orderDirection: "desc",
}
test("preserves manual query syntax and supported search scope and sorting", () => {
  assert.deepEqual(sanitizeSmartView(base), base)
  assert.equal(smartViewPath(base), "/feed/7")
  assert.equal(sanitizeSmartView({ ...base, sourceId: -1 }), null)
  assert.equal(sanitizeSmartView({ ...base, source: "home" }), null)
})
test("accounts remain isolated through save, reorder and reset", () => {
  let data = sanitizeSmartViewStorage(null)
  data = setSmartViews(data, "account-a", [base, { ...base, id: "two" }])
  data = setSmartViews(data, "account-b", [{ ...base, id: "other" }])
  data = setSmartViews(
    data,
    "account-a",
    moveSmartView(getSmartViews(data, "account-a"), "two", -1),
  )
  assert.deepEqual(
    getSmartViews(data, "account-a").map((v) => v.id),
    ["two", "one"],
  )
  data = setSmartViews(data, "account-a", [])
  assert.equal(getSmartViews(data, "account-b")[0].id, "other")
  assert.deepEqual(getSmartViews(data, ""), [])
})
test("unavailable and deleted sources do not open", () => {
  assert.equal(canOpenSmartView(base, [], []), false)
  assert.equal(canOpenSmartView(base, [{ id: 7 }], []), true)
  assert.equal(canOpenSmartView({ ...base, source: "category" }, [], [{ id: 7 }]), true)
})
test("malformed storage and duplicates do not become views", () => {
  const data = sanitizeSmartViewStorage({
    version: 1,
    accounts: [{ key: "a", views: [base, base, { ...base, query: "" }] }],
  })
  assert.equal(getSmartViews(data, "a").length, 1)
  assert.deepEqual(sanitizeSmartViewStorage({ version: 2 }), { version: 1, accounts: [] })
})

test("restoration waits for the exact destination and cancels on account change", () => {
  const pending = { key: "account-a", view: base }
  assert.equal(smartViewRestorationState(pending, "account-a", "all", null, "unread"), "wait")
  assert.equal(smartViewRestorationState(pending, "account-a", "feed", 7, "all"), "wait")
  assert.equal(smartViewRestorationState(pending, "account-a", "feed", "7", "unread"), "restore")
  assert.equal(smartViewRestorationState(pending, "account-b", "feed", 7, "unread"), "cancel")
})
