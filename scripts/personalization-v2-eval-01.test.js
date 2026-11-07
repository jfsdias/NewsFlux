import assert from "node:assert/strict"
import { test } from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- this test composes the actual Home production helpers without changing them.
import { createHomeCategoryLanes } from "../src/utils/home-category-projection.js"
// eslint-disable-next-line import/no-relative-parent-imports -- this test uses the actual production profile helper with synthetic rows.
import { createHomePersonalizationProfile } from "../src/utils/home-personalization-profile.js"
// eslint-disable-next-line import/no-relative-parent-imports -- this test runs the actual production projection against paired fixtures.
import { projectHomePersonalization } from "../src/utils/home-personalization-projection.js"

import {
  evaluateSessionStability,
  EVALUATION_SCENARIOS,
  EVALUATION_TOP_N,
  runEvaluationReport,
} from "./tests/personalization-v2-eval-01.js"

const scenarioByName = new Map(EVALUATION_SCENARIOS.map((scenario) => [scenario.name, scenario]))
const report = runEvaluationReport()
const resultsByName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]))

const entry = ({ id, minutesAgo, feedId, categoryId, starred = false }) => ({
  id,
  status: "unread",
  starred,
  title: `Synthetic ${id}`,
  published_at: new Date(Date.UTC(2026, 10, 7, 12) - minutesAgo * 60_000).toISOString(),
  feed: {
    id: feedId,
    category: categoryId == null ? null : { id: categoryId, title: `Category ${categoryId}` },
  },
})

const profileEntry = ({ id, feedId, categoryId }) => ({
  id,
  status: "read",
  starred: true,
  feed: { id: feedId, category: { id: categoryId, title: `Category ${categoryId}` } },
})

test("evaluation declares Top-N before running and covers all ten required scenario families", () => {
  assert.equal(EVALUATION_TOP_N, 12)
  assert.equal(report.metadata.topN, 12)
  assert.match(report.metadata.topNDefinition, /first 12 article IDs in final visual order/)
  assert.equal(report.scenarios.length, 12)

  for (const name of [
    "balanced_sources_and_categories",
    "star_profile_concentrated_in_one_source",
    "star_profile_concentrated_in_one_category",
    "different_sources_covering_the_same_category",
    "exact_60_minute_freshness_boundary",
    "secondary_highlight_changed_by_current_star",
    "empty_star_profile",
    "invalid_profile_fallback",
    "late_profile_fallback",
    "stale_session_profile_fallback",
    "same_category_title_different_ids",
    "intermediate_order_change_without_final_composition_change",
  ]) {
    assert.ok(resultsByName.has(name), `missing scenario ${name}`)
  }
})

test("each fixture compares through final sections and preserves primary, coverage, IDs and Reader order", () => {
  for (const result of report.scenarios) {
    assert.equal(result.comparison.primaryUnchanged, true, result.name)
    assert.equal(result.comparison.candidateCoveragePass, true, result.name)
    assert.equal(result.comparison.noDuplicateArticleIds, true, result.name)
    assert.equal(result.comparison.categoryIdentityPass, true, result.name)
    assert.equal(result.comparison.readerOrderParity, true, result.name)
    assert.deepEqual(result.v1.missingIds, [], result.name)
    assert.deepEqual(result.v1.extraIds, [], result.name)
    assert.equal(result.v1.uniqueVisibleCount, result.v1.visibleCount, result.name)
    assert.equal(result.v1.visibleCount, result.v1.eligibleCount, result.name)
    assert.equal(result.v1.sectionOrder[0], "Highlights", result.name)
    assert.equal(
      result.v1.sectionOrder.includes("Latest"),
      result.v1.latestIds.length > 0,
      result.name,
    )
    const latestIndex = result.v1.sectionOrder.indexOf("Latest")
    assert.ok(latestIndex === -1 || latestIndex === result.v1.sectionOrder.length - 1, result.name)
    assert.ok(result.offlineCompositionLatency.phase2c.repetitions >= 100, result.name)
    assert.ok(result.offlineCompositionLatency.personalizationV1.repetitions >= 100, result.name)
  }
})

test("current star can select a different Secondary Highlight while preserving the Primary", () => {
  const result = resultsByName.get("secondary_highlight_changed_by_current_star")
  assert.equal(result.comparison.primaryUnchanged, true)
  assert.equal(result.baseline.highlightIds[0], result.v1.highlightIds[0])
  assert.ok(result.baseline.highlightIds.includes(5002))
  assert.ok(result.v1.highlightIds.includes(5007))
  assert.equal(scenarioByName.get(result.name).entries.find(({ id }) => id === 5007).starred, true)
})

test("the exact 60-minute freshness boundary joins the current group; 61 minutes does not", () => {
  const entries = [
    entry({ id: 1, minutesAgo: 0, feedId: 1, categoryId: 1 }),
    entry({ id: 2, minutesAgo: 1, feedId: 2, categoryId: 2 }),
    entry({ id: 3, minutesAgo: 61, feedId: 3, categoryId: 3 }),
    entry({ id: 4, minutesAgo: 62, feedId: 4, categoryId: 4 }),
  ]
  const profile = createHomePersonalizationProfile({
    entries: [
      profileEntry({ id: 101, feedId: 3, categoryId: 3 }),
      profileEntry({ id: 102, feedId: 4, categoryId: 4 }),
    ],
    hiddenFeedIds: new Set(),
  })

  const result = projectHomePersonalization({
    entries,
    baselineHighlightIds: [1],
    baselineRecentIds: [2, 3, 4],
    profile,
    freshnessWindow: 60 * 60 * 1000,
  })

  assert.deepEqual(result.recentIds, [3, 2, 4])
})

test("a V1 order change can set disclosure while final category composition is unchanged", () => {
  const result = resultsByName.get("intermediate_order_change_without_final_composition_change")

  assert.equal(result.comparison.intermediateOrderChanged, true)
  assert.equal(result.comparison.personalizationApplied, true)
  assert.equal(result.comparison.finalPresentationChanged, false)
  assert.equal(result.comparison.disclosureCase, "APPLIED_WITHOUT_FINAL_PRESENTATION_CHANGE")
  assert.equal(result.comparison.disclosureMismatch, true)
  assert.deepEqual(result.comparison.topNDelta, {
    distinctSources: 0,
    distinctCategories: 0,
    consecutiveSameSourcePairs: 0,
  })
  assert.ok(
    report.scenarios.some(
      ({ comparison }) => comparison.disclosureCase === "APPLIED_WITH_FINAL_PRESENTATION_CHANGE",
    ),
  )
  assert.equal(
    report.scenarios.filter(
      ({ comparison }) => !comparison.personalizationApplied && comparison.finalPresentationChanged,
    ).length,
    0,
  )
})

test("empty, invalid, late and stale profile cases fall back to the deterministic composition", () => {
  for (const name of [
    "empty_star_profile",
    "invalid_profile_fallback",
    "late_profile_fallback",
    "stale_session_profile_fallback",
  ]) {
    const result = resultsByName.get(name)
    assert.equal(result.comparison.finalPresentationChanged, false, name)
    assert.equal(result.comparison.personalizationApplied, false, name)
    assert.deepEqual(result.v1.visibleIds, result.baseline.visibleIds, name)
  }
})

test("same category titles with different IDs remain separate category lanes", () => {
  const fixture = scenarioByName.get("same_category_title_different_ids").entries
  const lanes = createHomeCategoryLanes({
    entries: fixture,
    highlightIds: [],
    recentIds: fixture.map(({ id }) => id),
  })

  assert.deepEqual(
    lanes.map(({ categoryId, categoryTitle }) => [categoryId, categoryTitle]),
    [
      [71, "Local"],
      [72, "Local"],
    ],
  )
})

test("load more, read, star/unstar, refresh, Reader return and stale revision preserve the session contract", () => {
  const stability = evaluateSessionStability()
  assert.deepEqual(stability, {
    loadMoreAppendsOnlyToLatest: true,
    readMutationDoesNotRecompose: true,
    refreshDoesNotRecompose: true,
    readerReturnDoesNotRecompose: true,
    starDoesNotRecompose: true,
    unstarDoesNotRecompose: true,
    lateProfileDoesNotRecompose: true,
    staleRevisionIgnored: true,
  })
})

test("evaluation fixtures remain unread and are not mutated by the A/B run", () => {
  const before = EVALUATION_SCENARIOS.map(({ entries }) =>
    entries.map(({ id, status, starred, published_at, feed }) => ({
      id,
      status,
      starred,
      published_at,
      feed,
    })),
  )
  runEvaluationReport()
  const after = EVALUATION_SCENARIOS.map(({ entries }) =>
    entries.map(({ id, status, starred, published_at, feed }) => ({
      id,
      status,
      starred,
      published_at,
      feed,
    })),
  )

  assert.deepEqual(after, before)
  assert.ok(
    EVALUATION_SCENARIOS.every(({ entries }) => entries.every(({ status }) => status === "unread")),
  )
})
