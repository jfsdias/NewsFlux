import assert from "node:assert/strict"
import test from "node:test"

import dayjs from "dayjs"

import {
  canOpenSmartView,
  describeSmartView,
  getSmartViewRestoredStatus,
  getSmartViews,
  moveSmartView,
  normalizeSmartViewDate,
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

test("restoration is bound to identity, session and destination lifecycle", () => {
  const pending = {
    key: "account-a",
    sessionRevision: 4,
    originPath: "/all",
    targetPath: "/feed/7",
    view: base,
  }
  assert.equal(smartViewRestorationState(pending, "account-a", 4, "/all", "all", null), "wait")
  assert.equal(
    smartViewRestorationState(pending, "account-a", 4, "/feed/7", "feed", "7"),
    "restore",
  )
  assert.equal(smartViewRestorationState(pending, "account-b", 4, "/feed/7", "feed", 7), "cancel")
  assert.equal(smartViewRestorationState(pending, "account-a", 5, "/feed/7", "feed", 7), "cancel")
  assert.equal(
    smartViewRestorationState(pending, "account-a", 4, "/starred", "starred", null),
    "cancel",
  )
})

test("restore normalizes starred only where destination controls do", () => {
  assert.equal(getSmartViewRestoredStatus({ ...base, source: "all", showStatus: "starred" }), "all")
  assert.equal(
    getSmartViewRestoredStatus({ ...base, source: "today", showStatus: "starred" }),
    "all",
  )
  assert.equal(
    getSmartViewRestoredStatus({ ...base, source: "starred", showStatus: "starred" }),
    "all",
  )
  assert.equal(
    getSmartViewRestoredStatus({ ...base, source: "feed", showStatus: "starred" }),
    "starred",
  )
  assert.equal(
    getSmartViewRestoredStatus({ ...base, source: "category", showStatus: "starred" }),
    "starred",
  )
})

test("date picker Today and calendar values retain the local calendar date", () => {
  const today = dayjs("2026-11-20T00:00:00")
  assert.equal(normalizeSmartViewDate(today), "2026-11-20")
  assert.equal(normalizeSmartViewDate("2026-11-19"), "2026-11-19")
  assert.equal(
    sanitizeSmartView({ ...base, filterDate: normalizeSmartViewDate(today) }).filterDate,
    "2026-11-20",
  )
  assert.equal(
    sanitizeSmartView({ ...base, filterDate: normalizeSmartViewDate(dayjs("invalid")) }),
    null,
  )
})

test("descriptions reflect the effective predicates of source adapters", () => {
  const view = { ...base, filterDate: null, showStatus: "starred" }
  assert.equal(
    describeSmartView({ ...view, source: "all", sourceId: null }),
    "all; all statuses; published_at desc",
  )
  assert.equal(
    describeSmartView({ ...view, source: "today", sourceId: null }),
    "today; all statuses; published_at desc",
  )
  assert.equal(
    describeSmartView({ ...view, source: "starred", sourceId: null }),
    "starred; starred; changed_at desc",
  )
  assert.equal(
    describeSmartView({ ...view, source: "starred", sourceId: null, showStatus: "unread" }),
    "starred; unread starred; changed_at desc",
  )
  assert.equal(
    describeSmartView({ ...view, source: "history", sourceId: null }),
    "history; read; changed_at desc",
  )
  assert.equal(describeSmartView(view), "feed 7; starred; published_at desc")
})
