import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

// eslint-disable-next-line import/no-relative-parent-imports -- this test composes the actual Home production helpers without changing them.
import { createHomeCategoryLanes } from "../src/utils/home-category-projection.js"
// eslint-disable-next-line import/no-relative-parent-imports -- verify PR191's final-composition disclosure contract with production helpers.
import { hasHomeEditorialCompositionChanged } from "../src/utils/home-editorial-session.js"
import {
  commitHomePersonalizationSnapshot,
  createHomePersonalizationGeneration,
  resolveHomePersonalizationProfile,
} from "../src/utils/home-personalization-generation.js" // eslint-disable-line import/no-relative-parent-imports -- verify projection application and visible disclosure separately.
// eslint-disable-next-line import/no-relative-parent-imports -- this test uses the actual production profile helper with synthetic rows.
import { createHomePersonalizationProfile } from "../src/utils/home-personalization-profile.js"
// eslint-disable-next-line import/no-relative-parent-imports -- this test runs the actual production projection against paired fixtures.
import { projectHomePersonalization } from "../src/utils/home-personalization-projection.js"

import {
  evaluateSessionStability,
  EVALUATION_COMPOSITION_SAMPLES,
  EVALUATION_SCENARIOS,
  EVALUATION_TOP_N,
  runEvaluationReport,
} from "./tests/personalization-v2-eval-01.js"

const scenarioByName = new Map(EVALUATION_SCENARIOS.map((scenario) => [scenario.name, scenario]))
const report = runEvaluationReport()
const resultsByName = new Map(report.scenarios.map((scenario) => [scenario.name, scenario]))
const evidenceReport = JSON.parse(
  readFileSync(new URL("tests/reports/personalization-v2-eval-01.json", import.meta.url), "utf8"),
)
const evaluationCore = ({ scenarios }) =>
  scenarios.map(({ name, baseline, v1, comparison }) => ({ name, baseline, v1, comparison }))

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
  assert.equal(EVALUATION_COMPOSITION_SAMPLES, 101)
  assert.equal(report.metadata.topN, 12)
  assert.equal(report.metadata.scenarioCount, 12)
  assert.equal(report.metadata.compositionSamples, 101)
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
    assert.equal(result.comparison.disclosureMatchesFinalComposition, true, result.name)
    assert.equal(result.comparison.disclosureMismatch, false, result.name)
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
    assert.equal(result.offlineCompositionLatency.phase2c.repetitions, 101, result.name)
    assert.equal(result.offlineCompositionLatency.personalizationV1.repetitions, 101, result.name)
  }
})

test("current star can select a different Secondary Highlight while preserving the Primary", () => {
  const result = resultsByName.get("secondary_highlight_changed_by_current_star")
  assert.equal(result.comparison.primaryUnchanged, true)
  assert.equal(result.baseline.primaryId, 5001)
  assert.equal(result.v1.primaryId, 5001)
  assert.equal(result.baseline.highlightIds[0], result.v1.highlightIds[0])
  assert.ok(result.baseline.highlightIds.includes(5002))
  assert.ok(result.v1.highlightIds.includes(5007))
  assert.deepEqual(result.baseline.highlightIds.slice(1), [5002, 5004])
  assert.deepEqual(result.v1.highlightIds.slice(1), [5007, 5004])
  assert.deepEqual(result.baseline.topN.articleIds, [5001, 5002, 5004, 5003, 5005, 5006, 5007])
  assert.deepEqual(result.v1.topN.articleIds, [5001, 5007, 5004, 5002, 5003, 5005, 5006])
  assert.equal(result.baseline.eligibleCount, 7)
  assert.equal(result.v1.visibleCount, 7)
  assert.equal(result.comparison.noDuplicateArticleIds, true)
  assert.equal(result.baseline.topN.distinctSources, 6)
  assert.equal(result.v1.topN.distinctSources, 6)
  assert.equal(result.baseline.topN.distinctCategories, 6)
  assert.equal(result.v1.topN.distinctCategories, 6)
  assert.equal(result.baseline.topN.consecutiveSameSourcePairs, 0)
  assert.equal(result.v1.topN.consecutiveSameSourcePairs, 1)
  assert.equal(result.baseline.topN.longestSameSourceRun, 1)
  assert.equal(result.v1.topN.longestSameSourceRun, 2)
  assert.equal(result.comparison.ageDisplacement.promoted[0].id, 5007)
  assert.equal(result.comparison.ageDisplacement.promoted[0].fromRank, 7)
  assert.equal(result.comparison.ageDisplacement.promoted[0].toRank, 2)
  assert.equal(result.comparison.ageDisplacement.maximumOlderByMinutesAtSameRank, 25)
  assert.equal(result.v1.readerVisualOrderParity, true)
  assert.equal(result.comparison.disclosureVisible, true)
  assert.equal(
    report.directStarReevaluation.classification,
    "SYNTHETIC_OBSERVATION_NO_DIVERSITY_GAIN_MORE_REPETITION",
  )
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

test("intermediate personalization without a final composition change does not show disclosure", () => {
  const result = resultsByName.get("intermediate_order_change_without_final_composition_change")

  assert.equal(result.comparison.intermediateOrderChanged, true)
  assert.equal(result.comparison.projectionApplied, true)
  assert.equal(result.comparison.finalPresentationChanged, false)
  assert.equal(result.comparison.disclosureVisible, false)
  assert.equal(result.comparison.disclosureMismatch, false)
  assert.deepEqual(result.comparison.topNDelta, {
    distinctSources: 0,
    distinctCategories: 0,
    consecutiveSameSourcePairs: 0,
  })
  assert.ok(
    report.scenarios.some(
      ({ comparison }) => comparison.disclosureCase === "APPLIED_WITH_VISIBLE_FINAL_CHANGE",
    ),
  )
  assert.equal(report.scenarios.filter(({ comparison }) => comparison.disclosureMismatch).length, 0)
})

test("PR191 production helpers keep applied projection separate from visible disclosure", () => {
  const context = {
    generationId: 1,
    requestKey: "synthetic",
    canonicalRequestKey: "synthetic-canonical",
    identityKey: "synthetic-identity",
    sessionRevision: 1,
  }
  const baseline = {
    highlightIds: [1],
    categoryLanes: [],
    latestIds: [2, 3],
    personalizationApplied: false,
  }
  const personalized = {
    highlightIds: [1],
    categoryLanes: [],
    latestIds: [3, 2],
    personalizationApplied: true,
  }
  const finalPersonalized = { ...personalized, latestIds: [2, 3] }
  const generation = resolveHomePersonalizationProfile(
    createHomePersonalizationGeneration(context),
    { ...context, profile: { sourceWeights: {} } },
  )

  assert.equal(hasHomeEditorialCompositionChanged(baseline, finalPersonalized), false)

  const committed = commitHomePersonalizationSnapshot(generation, {
    ...context,
    baselineProjection: baseline,
    personalizedProjection: personalized,
    disclosureVisible: hasHomeEditorialCompositionChanged(baseline, finalPersonalized),
  })

  assert.equal(committed.generation.projectionApplied, true)
  assert.equal(committed.generation.disclosureVisible, false)
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
    assert.equal(result.comparison.projectionApplied, false, name)
    assert.equal(result.comparison.disclosureVisible, false, name)
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

test("session and fallback scenarios preserve load, mutation, refresh, Reader and identity contracts", () => {
  const stability = evaluateSessionStability()
  assert.deepEqual(stability, {
    loadMoreAppendsOnlyToLatest: true,
    readMutationDoesNotRecompose: true,
    refreshDoesNotRecompose: true,
    readerReturnDoesNotRecompose: true,
    starDoesNotRecompose: true,
    unstarDoesNotRecompose: true,
    lateProfileDoesNotRecompose: true,
    invalidProfileFallsBack: true,
    lateProfileFallsBack: true,
    staleSessionProfileFallsBack: true,
    staleRevisionIgnored: true,
    staleGenerationIgnored: true,
    lateProfileAfterCommitIgnored: true,
    categoryIdentityPreserved: true,
    freshnessBoundaryPreserved: true,
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

test("historical pre-PR191 report remains attached for metric comparability", () => {
  const historical = evidenceReport.historicalPre191
  assert.equal(historical.sourcePrHead, "74a6f0ffc5681d0520c562e492eed9fb94847e15")
  assert.equal(historical.report.metadata.mainSha, "430026000f2fe8c7f4e823e17ab39b38254198bf")
  assert.equal(historical.report.metadata.topN, 12)
  assert.equal(historical.report.metadata.compositionSamples, 101)
  assert.equal(historical.report.scenarios.length, 12)
  assert.deepEqual(
    report.scenarios.map(({ name }) => name),
    historical.report.scenarios.map(({ name }) => name),
  )

  const oldDisclosure = historical.report.scenarios.find(
    ({ name }) => name === "intermediate_order_change_without_final_composition_change",
  )
  assert.equal(oldDisclosure.comparison.personalizationApplied, true)
  assert.equal(oldDisclosure.comparison.finalPresentationChanged, false)
  assert.equal(oldDisclosure.comparison.disclosureMismatch, true)

  const oldDirectStar = historical.report.scenarios.find(
    ({ name }) => name === "secondary_highlight_changed_by_current_star",
  )
  assert.deepEqual(oldDirectStar.baseline.highlightIds, [5001, 5002, 5004])
  assert.deepEqual(oldDirectStar.v1.highlightIds, [5001, 5007, 5004])
  assert.equal(oldDirectStar.baseline.topN.consecutiveSameSourcePairs, 0)
  assert.equal(oldDirectStar.v1.topN.consecutiveSameSourcePairs, 1)
})

test("evaluation replay preserves deterministic compositions across measurement runs", () => {
  const replay = runEvaluationReport()
  assert.deepEqual(evaluationCore(replay), evaluationCore(report))
  assert.deepEqual(replay.directStarReevaluation, report.directStarReevaluation)
  assert.deepEqual(replay.sessionStability, report.sessionStability)
})
