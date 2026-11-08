const round = (value) => Number(value.toFixed(6))
const idKey = (value) => (value == null ? null : String(value))

const compareIds = (left, right) => {
  if (left === null) {
    return right === null ? 0 : 1
  }
  if (right === null) {
    return -1
  }
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber - rightNumber
    : left.localeCompare(right)
}

const unique = (values) => [...new Set(values.filter((value) => value !== null))]

const summarizeSourceMetrics = (eligibleEntries, topIds) => {
  const entryById = new Map(eligibleEntries.map((entry) => [idKey(entry.id), entry]))
  const topEntries = topIds.map((id) => entryById.get(idKey(id))).filter(Boolean)
  const sourceCounts = new Map()
  let unidentifiedSourceSlots = topIds.length - topEntries.length

  for (const entry of topEntries) {
    const sourceId = idKey(entry.feed?.id)
    if (sourceId === null) {
      unidentifiedSourceSlots += 1
      continue
    }
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1)
  }

  const knownSourceSlots = [...sourceCounts.values()].reduce((sum, count) => sum + count, 0)
  const sourceShares = [...sourceCounts]
    .toSorted(([left], [right]) => compareIds(left, right))
    .map(([sourceId, articleCount]) => ({
      sourceId,
      articleCount,
      share: knownSourceSlots > 0 ? round(articleCount / knownSourceSlots) : null,
    }))
  const concentrationHhi =
    knownSourceSlots > 0
      ? round(
          [...sourceCounts.values()].reduce(
            (sum, count) => sum + (count / knownSourceSlots) ** 2,
            0,
          ),
        )
      : null
  const eligibleSourceIds = unique(eligibleEntries.map((entry) => idKey(entry.feed?.id)))
  const representedSourceIds = unique(topEntries.map((entry) => idKey(entry.feed?.id)))

  return {
    topNSlots: topIds.length,
    knownSourceSlots,
    unidentifiedSourceSlots,
    distinctSources: representedSourceIds.length,
    eligibleDistinctSources: eligibleSourceIds.length,
    representedEligibleSources: representedSourceIds.length,
    eligibleSourceRepresentation:
      eligibleSourceIds.length > 0
        ? round(representedSourceIds.length / eligibleSourceIds.length)
        : null,
    sourceShares,
    largestSourceShare:
      sourceShares.length > 0 ? Math.max(...sourceShares.map(({ share }) => share)) : null,
    concentrationHhi,
  }
}

const summarizeCategoryMetrics = (eligibleEntries, topIds) => {
  const entryById = new Map(eligibleEntries.map((entry) => [idKey(entry.id), entry]))
  const topEntries = topIds.map((id) => entryById.get(idKey(id))).filter(Boolean)
  const eligibleCategoryIds = unique(
    eligibleEntries.map((entry) => idKey(entry.feed?.category?.id)),
  )
  const representedCategoryIds = unique(topEntries.map((entry) => idKey(entry.feed?.category?.id)))

  return {
    topNSlots: topIds.length,
    unidentifiedCategorySlots:
      topIds.length - topEntries.filter((entry) => idKey(entry.feed?.category?.id) !== null).length,
    distinctCategories: representedCategoryIds.length,
    eligibleDistinctCategories: eligibleCategoryIds.length,
    representedEligibleCategories: representedCategoryIds.length,
    eligibleCategoryRepresentation:
      eligibleCategoryIds.length > 0
        ? round(representedCategoryIds.length / eligibleCategoryIds.length)
        : null,
  }
}

const makeArmMetrics = (scenario, arm) => {
  const eligibleEntries = scenario.entries.filter((entry) => entry.status === "unread")
  const topIds = arm.topN.articleIds
  const sourceMetrics = summarizeSourceMetrics(eligibleEntries, topIds)
  const categoryMetrics = summarizeCategoryMetrics(eligibleEntries, topIds)

  return {
    topNArticleIds: [...topIds],
    eligibleArticleCount: eligibleEntries.length,
    sourceMetrics,
    categoryMetrics,
    adjacentSameSourcePairs: arm.topN.consecutiveSameSourcePairs,
    longestSameSourceRun: arm.topN.longestSameSourceRun,
  }
}

const delta = (baseline, v1, field) => {
  const left = baseline[field]
  const right = v1[field]
  return left === null || right === null ? null : round(right - left)
}

const compareScenario = (result, scenario) => {
  const baseline = makeArmMetrics(scenario, result.baseline)
  const v1 = makeArmMetrics(scenario, result.v1)

  return {
    name: result.name,
    baseline,
    v1,
    delta: {
      distinctSources: v1.sourceMetrics.distinctSources - baseline.sourceMetrics.distinctSources,
      distinctCategories:
        v1.categoryMetrics.distinctCategories - baseline.categoryMetrics.distinctCategories,
      eligibleSourceRepresentation: delta(
        baseline.sourceMetrics,
        v1.sourceMetrics,
        "eligibleSourceRepresentation",
      ),
      eligibleCategoryRepresentation: delta(
        baseline.categoryMetrics,
        v1.categoryMetrics,
        "eligibleCategoryRepresentation",
      ),
      largestSourceShare: delta(baseline.sourceMetrics, v1.sourceMetrics, "largestSourceShare"),
      sourceConcentrationHhi: delta(baseline.sourceMetrics, v1.sourceMetrics, "concentrationHhi"),
      adjacentSameSourcePairs: v1.adjacentSameSourcePairs - baseline.adjacentSameSourcePairs,
      longestSameSourceRun: v1.longestSameSourceRun - baseline.longestSameSourceRun,
    },
    ageDisplacement: {
      promoted: result.comparison.ageDisplacement.promoted,
      maximumV1OlderByMinutesAtSameRank:
        result.comparison.ageDisplacement.maximumOlderByMinutesAtSameRank,
    },
    functionalGuardrails: {
      primaryHighlightPreserved: result.comparison.primaryUnchanged,
      eligibleCoveragePreserved: result.comparison.candidateCoveragePass,
      noDuplicateArticleIds: result.comparison.noDuplicateArticleIds,
      categoryIdentityPreserved: result.comparison.categoryIdentityPass,
      readerOrderParity: result.comparison.readerOrderParity,
      disclosureParity: result.comparison.disclosureMatchesFinalComposition,
    },
  }
}

const compareDirection = (items, getDelta, higherIsBetter) => {
  const counts = { improved: 0, unchanged: 0, movedOppositeDirection: 0, notComparable: 0 }
  for (const item of items) {
    const value = getDelta(item)
    if (value === null || !Number.isFinite(value)) {
      counts.notComparable += 1
    } else if (value === 0) {
      counts.unchanged += 1
    } else if (value > 0 === higherIsBetter) {
      counts.improved += 1
    } else {
      counts.movedOppositeDirection += 1
    }
  }
  return counts
}

export default function buildPersonalizationRelevanceGateReport({
  evaluationReport,
  scenarios,
  baseSha,
}) {
  if (
    !evaluationReport ||
    !Array.isArray(evaluationReport.scenarios) ||
    !Array.isArray(scenarios)
  ) {
    throw new TypeError("The existing evaluator report and fixtures are required.")
  }

  const fixtureByName = new Map(scenarios.map((scenario) => [scenario.name, scenario]))
  const metrics = evaluationReport.scenarios.map((result) => {
    const scenario = fixtureByName.get(result.name)
    if (!scenario) {
      throw new Error(`Missing historical scenario fixture: ${result.name}`)
    }
    return compareScenario(result, scenario)
  })
  const guardrailPasses = (name) =>
    metrics.every((scenario) => scenario.functionalGuardrails[name] === true)

  return {
    metadata: {
      schemaVersion: 1,
      baseSha,
      sourceEvaluator: "scripts/tests/personalization-v2-eval-01.js",
      sourceEvaluatorHistoricalScenarioCount: evaluationReport.metadata.scenarioCount,
      scenarioCount: metrics.length,
      topN: evaluationReport.metadata.topN,
      topNDefinition: evaluationReport.metadata.topNDefinition,
      dataClass: "DETERMINISTIC_SYNTHETIC_ONLY",
      humanRelevanceGate: "NOT_MEASURED",
      allUnreadChronology: "UNCHANGED_NOT_RANKED_BY_THIS_EVALUATOR",
      externalServicesUsed: false,
    },
    scenarios: metrics,
    summary: {
      primaryHighlightPreserved: guardrailPasses("primaryHighlightPreserved"),
      articleCoveragePreserved: guardrailPasses("eligibleCoveragePreserved"),
      noDuplicateArticleIds: guardrailPasses("noDuplicateArticleIds"),
      categoryIdentityPreserved: guardrailPasses("categoryIdentityPreserved"),
      readerOrderParity: guardrailPasses("readerOrderParity"),
      disclosureParity: guardrailPasses("disclosureParity"),
      sourceDistinctCountDirection: compareDirection(
        metrics,
        (scenario) => scenario.delta.distinctSources,
        true,
      ),
      sourceConcentrationProxyDirection: compareDirection(
        metrics,
        (scenario) => scenario.delta.sourceConcentrationHhi,
        false,
      ),
      sourceRepresentationDirection: compareDirection(
        metrics,
        (scenario) => scenario.delta.eligibleSourceRepresentation,
        true,
      ),
      categoryRepresentationDirection: compareDirection(
        metrics,
        (scenario) => scenario.delta.eligibleCategoryRepresentation,
        true,
      ),
      adjacentSameSourcePairDirection: compareDirection(
        metrics,
        (scenario) => scenario.delta.adjacentSameSourcePairs,
        false,
      ),
      editorialBenefitEstablished: false,
      editorialBenefitReason:
        "Synthetic proxy metrics do not measure perceived relevance or establish population-level benefit.",
    },
  }
}
