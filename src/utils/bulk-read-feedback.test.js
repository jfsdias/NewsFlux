import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { createBulkReadFeedback, getBulkReadScopeLabel } from "./bulk-read-feedback.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const enUS = JSON.parse(readFileSync(new URL("../locales/en-US.json", import.meta.url), "utf8"))

const translate = (key, params = {}) => {
  let value = enUS
  for (const part of key.split(".")) {
    value = value?.[part]
  }
  assert.equal(typeof value, "string", `Missing English translation: ${key}`)
  let translated = value
  for (const [name, replacement] of Object.entries(params)) {
    translated = translated.replaceAll(`%{${name}}`, String(replacement))
  }
  return translated
}

const polyglot = { t: translate }

test("BULK-01C scope labels identify named feed and category scopes", () => {
  const feeds = [{ id: 7, title: "Alfa Tech" }]
  const categories = [{ id: 3, title: "Tecnologia" }]

  assert.equal(
    getBulkReadScopeLabel({ from: "feed", id: 7, feeds, categories, polyglot }),
    "Alfa Tech (Feed)",
  )
  assert.equal(
    getBulkReadScopeLabel({ from: "category", id: 3, feeds, categories, polyglot }),
    "Tecnologia (Category)",
  )
})

test("BULK-01C scope labels use safe fallbacks and preserve filtered scope", () => {
  assert.equal(
    getBulkReadScopeLabel({ from: "feed", id: 999, feeds: [], categories: [], polyglot }),
    "This feed",
  )
  assert.equal(
    getBulkReadScopeLabel({ from: "all", feeds: [], categories: [], isFiltered: true, polyglot }),
    "All articles with current filters",
  )
  assert.equal(
    getBulkReadScopeLabel({ from: "unknown", feeds: [], categories: [], polyglot }),
    "Current list",
  )
})

test("BULK-01C success count comes from acknowledged IDs, not requested count", () => {
  const feedback = createBulkReadFeedback({
    operation: "selected",
    status: "success",
    acknowledgedIds: [4, 9],
    requestedCount: 8,
    scope: "Tecnologia (Category)",
  })

  assert.equal(feedback.notificationType, "success")
  assert.equal(feedback.titleKey, "article_selection.read_success_scoped")
  assert.deepEqual(feedback.titleParams, {
    smart_count: 2,
    scope: "Tecnologia (Category)",
  })
  assert.deepEqual(feedback.undoEntryIds, [4, 9])
})

test("BULK-01C unknown success count does not invent a number", () => {
  const feedback = createBulkReadFeedback({
    operation: "markAll",
    status: "success",
    acknowledgedIds: null,
    scope: "All articles",
    operationLabel: "Mark all as read",
  })

  assert.equal(feedback.notificationType, "success")
  assert.equal(feedback.titleKey, "article_list.bulk_read_success_count_unknown")
  assert.deepEqual(feedback.titleParams, {
    operation: "Mark all as read",
    scope: "All articles",
  })
  assert.deepEqual(feedback.undoEntryIds, [])
})

test("BULK-01C partial feedback includes acknowledged count and requested total", () => {
  const feedback = createBulkReadFeedback({
    operation: "relative",
    status: "partial",
    acknowledgedIds: [2, 3],
    requestedCount: 5,
    scope: "All articles",
    direction: "above",
  })

  assert.equal(feedback.notificationType, "warning")
  assert.equal(feedback.titleKey, "article_list.mark_relative_as_read_partial_scoped")
  assert.deepEqual(feedback.titleParams, {
    marked: 2,
    total: 5,
    scope: "All articles",
    direction: "above",
  })
  assert.deepEqual(feedback.undoEntryIds, [2, 3])
})

test("BULK-01C partial failure without a known total reports only confirmed IDs", () => {
  const feedback = createBulkReadFeedback({
    operation: "markAll",
    status: "failure",
    acknowledgedIds: [5, 6],
    requestedCount: null,
    scope: "Alfa Tech (Feed)",
    operationLabel: "Mark all as read",
  })

  assert.equal(feedback.notificationType, "warning")
  assert.equal(feedback.titleKey, "article_list.bulk_read_partial_count_unknown")
  assert.deepEqual(feedback.titleParams, {
    marked: 2,
    smart_count: 2,
    operation: "Mark all as read",
    scope: "Alfa Tech (Feed)",
  })
  assert.deepEqual(feedback.undoEntryIds, [5, 6])
})

test("BULK-01C full failure has no success message or Undo IDs", () => {
  const feedback = createBulkReadFeedback({
    operation: "older",
    status: "failure",
    acknowledgedIds: [],
    requestedCount: 4,
    scope: "Tecnologia (Category)",
  })

  assert.equal(feedback.notificationType, "error")
  assert.equal(feedback.titleKey, "article_list.mark_older_as_read_error_scoped")
  assert.deepEqual(feedback.titleParams, { scope: "Tecnologia (Category)" })
  assert.deepEqual(feedback.undoEntryIds, [])
})

test("BULK-01C partial status without acknowledged IDs does not claim partial success", () => {
  const feedback = createBulkReadFeedback({
    operation: "markAll",
    status: "partial",
    acknowledgedIds: [],
    scope: "All articles",
  })

  assert.equal(feedback.notificationType, "error")
  assert.equal(feedback.titleKey, "article_list.mark_all_as_read_error_scoped")
  assert.deepEqual(feedback.undoEntryIds, [])
})

test("BULK-01C partial success can only offer Undo for unique acknowledged IDs", () => {
  const feedback = createBulkReadFeedback({
    operation: "selected",
    status: "partial",
    acknowledgedIds: [10, 10, 11],
    requestedCount: 7,
    scope: "Unread articles",
  })

  assert.equal(feedback.titleParams.marked, 2)
  assert.deepEqual(feedback.undoEntryIds, [10, 11])
})

test("BULK-01C all shipped locales define scoped bulk-read feedback", () => {
  for (const locale of ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]) {
    const messages = JSON.parse(
      readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8"),
    )
    for (const key of [
      "bulk_read_scope_named",
      "bulk_read_scope_filtered",
      "bulk_read_success_count_unknown",
      "bulk_read_partial_count_unknown",
      "mark_all_as_read_success_scoped",
      "mark_all_as_read_error_scoped",
      "mark_older_as_read_success_scoped",
      "mark_older_as_read_partial_scoped",
      "mark_relative_as_read_success_scoped",
      "mark_relative_as_read_partial_scoped",
      "bulk_read_direction_above",
      "bulk_read_direction_below",
    ]) {
      assert.ok(messages.article_list[key]?.length > 0, `${locale} article_list.${key}`)
    }
    for (const key of [
      "read_success_scoped",
      "partial_result_scoped",
      "read_error_scoped",
      "counts_refresh_error_scoped",
    ]) {
      assert.ok(messages.article_selection[key]?.length > 0, `${locale} article_selection.${key}`)
    }
  }
})
