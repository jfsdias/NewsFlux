import assert from "node:assert/strict"
import { test } from "node:test"

import buildPersonalizationRelevanceGateReport from "./tests/personalization-relevance-gate-01.js"
import { EVALUATION_SCENARIOS, runEvaluationReport } from "./tests/personalization-v2-eval-01.js"

const evaluationReport = runEvaluationReport()
const report = buildPersonalizationRelevanceGateReport({
  evaluationReport,
  scenarios: EVALUATION_SCENARIOS,
  baseSha: "0faedf939f6c97867d6fac6c019f48476163d629",
})
const buildReport = () =>
  buildPersonalizationRelevanceGateReport({
    evaluationReport,
    scenarios: EVALUATION_SCENARIOS,
    baseSha: "0faedf939f6c97867d6fac6c019f48476163d629",
  })

const scenarioByName = (report, name) => report.scenarios.find((scenario) => scenario.name === name)

test("relevance report preserves the historical 12 scenario identities and marks human relevance unmeasured", () => {
  const report = buildReport()

  assert.equal(report.metadata.scenarioCount, 12)
  assert.equal(report.metadata.topN, 12)
  assert.equal(report.metadata.humanRelevanceGate, "NOT_MEASURED")
  assert.equal(report.metadata.dataClass, "DETERMINISTIC_SYNTHETIC_ONLY")
  assert.deepEqual(
    report.scenarios.map(({ name }) => name),
    EVALUATION_SCENARIOS.map(({ name }) => name),
  )
})

test("source shares and HHI use displayed Top-N slots and match the declared formulas", () => {
  const report = buildReport()
  const directStar = scenarioByName(report, "secondary_highlight_changed_by_current_star")

  assert.equal(directStar.baseline.sourceMetrics.topNSlots, 7)
  assert.equal(directStar.baseline.sourceMetrics.distinctSources, 6)
  assert.equal(directStar.baseline.sourceMetrics.eligibleDistinctSources, 6)
  assert.equal(directStar.baseline.sourceMetrics.eligibleSourceRepresentation, 1)
  assert.equal(directStar.baseline.sourceMetrics.largestSourceShare, 0.285714)
  assert.equal(directStar.baseline.sourceMetrics.concentrationHhi, 0.183673)
  assert.deepEqual(directStar.baseline.sourceMetrics.sourceShares, [
    { sourceId: "10", articleCount: 1, share: 0.142857 },
    { sourceId: "20", articleCount: 2, share: 0.285714 },
    { sourceId: "30", articleCount: 1, share: 0.142857 },
    { sourceId: "40", articleCount: 1, share: 0.142857 },
    { sourceId: "50", articleCount: 1, share: 0.142857 },
    { sourceId: "60", articleCount: 1, share: 0.142857 },
  ])
  assert.equal(directStar.delta.sourceConcentrationHhi, 0)
  assert.equal(directStar.delta.adjacentSameSourcePairs, 1)
})

test("synthetic concentrated-source fixtures expose concentration changes without calling them relevance gains", () => {
  const report = buildReport()
  const concentrated = scenarioByName(report, "star_profile_concentrated_in_one_source")
  const concentratedCategory = scenarioByName(report, "star_profile_concentrated_in_one_category")

  assert.equal(concentrated.baseline.sourceMetrics.largestSourceShare, 0.833333)
  assert.equal(concentrated.v1.sourceMetrics.largestSourceShare, 0.583333)
  assert.equal(concentrated.delta.sourceConcentrationHhi < 0, true)
  assert.equal(concentratedCategory.delta.sourceConcentrationHhi < 0, true)
  assert.equal(report.summary.editorialBenefitEstablished, false)
})

test("eligible identity representation stays bounded and does not invent categories", () => {
  for (const scenario of report.scenarios) {
    for (const arm of [scenario.baseline, scenario.v1]) {
      assert.ok(
        arm.sourceMetrics.eligibleSourceRepresentation >= 0 &&
          arm.sourceMetrics.eligibleSourceRepresentation <= 1,
      )
      assert.ok(
        arm.categoryMetrics.eligibleCategoryRepresentation >= 0 &&
          arm.categoryMetrics.eligibleCategoryRepresentation <= 1,
      )
      assert.equal(
        arm.sourceMetrics.sourceShares.reduce((sum, item) => sum + item.articleCount, 0),
        arm.sourceMetrics.knownSourceSlots,
      )
      assert.ok(
        arm.categoryMetrics.representedEligibleCategories <=
          arm.categoryMetrics.eligibleDistinctCategories,
      )
    }
  }
})

test("empty eligible input yields unavailable concentration and representation instead of NaN", () => {
  const emptyArm = {
    topN: {
      articleIds: [99],
      consecutiveSameSourcePairs: 0,
      longestSameSourceRun: 0,
    },
  }
  const emptyReport = buildPersonalizationRelevanceGateReport({
    baseSha: "0faedf939f6c97867d6fac6c019f48476163d629",
    evaluationReport: {
      metadata: { scenarioCount: 1, topN: 12, topNDefinition: "first 12 visual slots" },
      scenarios: [
        {
          name: "empty_eligible_set_metric_guard",
          baseline: emptyArm,
          v1: emptyArm,
          comparison: {
            ageDisplacement: { promoted: [], maximumOlderByMinutesAtSameRank: 0 },
            primaryUnchanged: true,
            candidateCoveragePass: true,
            noDuplicateArticleIds: true,
            categoryIdentityPass: true,
            readerOrderParity: true,
            disclosureMatchesFinalComposition: true,
          },
        },
      ],
    },
    scenarios: [{ name: "empty_eligible_set_metric_guard", entries: [] }],
  })
  const emptyMetrics = emptyReport.scenarios[0].baseline

  assert.equal(emptyMetrics.sourceMetrics.concentrationHhi, null)
  assert.equal(emptyMetrics.sourceMetrics.eligibleSourceRepresentation, null)
  assert.equal(emptyMetrics.sourceMetrics.topNSlots, 1)
  assert.equal(emptyMetrics.sourceMetrics.unidentifiedSourceSlots, 1)
  assert.equal(emptyMetrics.categoryMetrics.eligibleCategoryRepresentation, null)
  assert.equal(emptyMetrics.categoryMetrics.unidentifiedCategorySlots, 1)
  assert.equal(JSON.stringify(emptyReport).includes("NaN"), false)
})

test("all synthetic functional guardrails remain visible in the report and do not imply All/Unread ranking", () => {
  const report = buildReport()

  assert.equal(report.summary.primaryHighlightPreserved, true)
  assert.equal(report.summary.articleCoveragePreserved, true)
  assert.equal(report.summary.noDuplicateArticleIds, true)
  assert.equal(report.summary.readerOrderParity, true)
  assert.equal(report.summary.disclosureParity, true)
  assert.equal(report.metadata.allUnreadChronology, "UNCHANGED_NOT_RANKED_BY_THIS_EVALUATOR")
})

test("metric output is deterministic and does not mutate the historical evaluator fixtures", () => {
  const before = JSON.stringify(EVALUATION_SCENARIOS)
  const first = buildReport()
  const second = buildReport()

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(EVALUATION_SCENARIOS), before)
})
