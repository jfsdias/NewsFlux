import { performance } from "node:perf_hooks"

// eslint-disable-next-line import/no-relative-parent-imports -- offline evaluation composes the real Home production projection.
import { selectInitialHighlightIds } from "../../src/utils/home-editorial-projection.js"
import {
  appendHomeSessionEntries,
  createHomeEditorialSession,
  hasHomeEditorialCompositionChanged,
  projectHomeSession,
  transitionHomeSession,
} from "../../src/utils/home-editorial-session.js" // eslint-disable-line import/no-relative-parent-imports -- session metrics exercise the existing production contract.
import {
  HOME_PERSONALIZATION_FRESHNESS_WINDOW,
  HOME_STARRED_PROFILE_LIMIT,
} from "../../src/utils/home-personalization-constants.js" // eslint-disable-line import/no-relative-parent-imports -- record production freshness and profile bounds.
import {
  commitHomePersonalizationSnapshot,
  createHomePersonalizationGeneration,
  failHomePersonalizationProfile,
  resolveHomePersonalizationProfile,
} from "../../src/utils/home-personalization-generation.js" // eslint-disable-line import/no-relative-parent-imports -- reproduce the production post-PR191 commit/disclosure contract.
// eslint-disable-next-line import/no-relative-parent-imports -- build synthetic profiles with the actual production helper.
import { createHomePersonalizationProfile } from "../../src/utils/home-personalization-profile.js"
// eslint-disable-next-line import/no-relative-parent-imports -- compare the actual production V1 candidate with Phase 2C.
import { projectHomePersonalization } from "../../src/utils/home-personalization-projection.js"

export const EVALUATION_TOP_N = 12
export const EVALUATION_COMPOSITION_SAMPLES = 101
const EVALUATION_EPOCH = Date.UTC(2026, 10, 7, 12, 0, 0)

const entry = ({
  id,
  minutesAgo,
  feedId,
  categoryId,
  categoryTitle = `Category ${categoryId}`,
  starred = false,
  status = "unread",
}) => ({
  id,
  status,
  starred,
  title: `Synthetic article ${id}`,
  published_at: new Date(EVALUATION_EPOCH - minutesAgo * 60_000).toISOString(),
  feed: {
    id: feedId,
    title: `Synthetic source ${feedId}`,
    category: categoryId == null ? null : { id: categoryId, title: categoryTitle },
  },
})

const orderedEntries = (entries) =>
  [...entries].toSorted(
    (left, right) =>
      Date.parse(right.published_at) - Date.parse(left.published_at) || left.id - right.id,
  )

const makeEntries = (specs) => orderedEntries(specs.map((spec) => entry(spec)))

const starredRows = (rows) =>
  rows.map((row, index) =>
    entry({
      id: 90_000 + index,
      minutesAgo: 120 + index,
      feedId: row.feedId,
      categoryId: row.categoryId,
      categoryTitle: row.categoryTitle,
      starred: true,
      status: "read",
    }),
  )

const allEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const makeSession = (entries, initialProjection) =>
  createHomeEditorialSession({
    requestKey: "synthetic-home-eval",
    sessionRevision: 7,
    entries,
    ...(initialProjection ? { initialProjection } : {}),
  })

const compose = (entries, projection = null) => {
  const session = makeSession(entries, projection)
  const sections = projectHomeSession(session, entries)
  const highlightIds = session.highlightIds.filter((id) => id != null)
  const { latestIds } = sections
  const visualIds = [
    ...highlightIds,
    ...sections.categoryLanes.flatMap(({ entryIds }) => entryIds),
    ...latestIds,
  ]
  const readerIds = [...highlightIds, ...sections.readerRecentIds]

  return {
    session,
    sections,
    highlightIds,
    latestIds,
    visualIds,
    readerIds,
    presentationSignature: {
      highlightIds,
      categoryLanes: sections.categoryLanes.map(({ categoryId, categoryTitle, entryIds }) => ({
        categoryId,
        categoryTitle,
        entryIds,
      })),
      latestIds,
    },
  }
}

const unique = (values) => [...new Set(values)]

const longestRun = (values) => {
  let longest = 0
  let run = 0
  let previous = Symbol("none")
  for (const value of values) {
    if (value == null) {
      run = 0
      previous = Symbol("none")
      continue
    }
    run = value === previous ? run + 1 : 1
    previous = value
    longest = Math.max(longest, run)
  }
  return longest
}

const countConsecutiveRepeats = (values) =>
  values.slice(1).reduce((count, value, index) => count + Number(value === values[index]), 0)

const entryById = (entries) => new Map(entries.map((item) => [String(item.id), item]))

const summarizeComposition = (entries, composition) => {
  const byId = entryById(entries)
  const topIds = composition.visualIds.slice(0, EVALUATION_TOP_N)
  const topEntries = topIds.map((id) => byId.get(String(id))).filter(Boolean)
  const lane = composition.sections.categoryLanes.map(
    ({ categoryId, categoryTitle, entryIds }) => ({
      categoryId,
      categoryTitle,
      entryIds,
    }),
  )
  const highlights = composition.highlightIds

  return {
    primaryId: highlights[0] ?? null,
    highlightIds: highlights,
    categoryLanes: lane,
    sectionOrder: [
      ...(highlights.length > 0 ? ["Highlights"] : []),
      ...lane.map(({ categoryId }) => `category:${categoryId}`),
      ...(composition.latestIds.length > 0 ? ["Latest"] : []),
    ],
    sectionCounts: {
      highlights: highlights.length,
      categories: lane.map(({ categoryId, entryIds }) => ({ categoryId, count: entryIds.length })),
      latest: composition.latestIds.length,
    },
    latestIds: composition.latestIds,
    visibleIds: composition.visualIds,
    topN: {
      n: EVALUATION_TOP_N,
      articleIds: topIds,
      distinctSources: unique(topEntries.map(({ feed }) => feed?.id).filter((id) => id != null))
        .length,
      distinctCategories: unique(
        topEntries.map(({ feed }) => feed?.category?.id).filter((id) => id != null),
      ).length,
      consecutiveSameSourcePairs: countConsecutiveRepeats(topEntries.map(({ feed }) => feed?.id)),
      longestSameSourceRun: longestRun(topEntries.map(({ feed }) => feed?.id)),
    },
    readerIds: composition.readerIds,
    readerVisualOrderParity: allEqual(composition.readerIds, composition.visualIds),
    eligibleCount: entries.filter(({ status }) => status === "unread").length,
    visibleCount: composition.visualIds.length,
    uniqueVisibleCount: unique(composition.visualIds.map(String)).length,
    missingIds: entries
      .filter(({ status }) => status === "unread")
      .map(({ id }) => id)
      .filter((id) => !composition.visualIds.some((visibleId) => String(visibleId) === String(id))),
    extraIds: composition.visualIds.filter(
      (id) =>
        !entries.some(
          (candidate) => candidate.status === "unread" && String(candidate.id) === String(id),
        ),
    ),
  }
}

const calculateAgeDisplacement = (entries, baselineIds, personalizedIds) => {
  const byId = entryById(entries)
  const baselineIndex = new Map(baselineIds.map((id, index) => [String(id), index]))
  const personalizedIndex = new Map(personalizedIds.map((id, index) => [String(id), index]))
  const primaryTimestamp = Date.parse(byId.get(String(baselineIds[0]))?.published_at)
  const promoted = personalizedIds
    .map((id, index) => {
      const oldIndex = baselineIndex.get(String(id))
      if (oldIndex === undefined || index >= oldIndex) {
        return null
      }
      const timestamp = Date.parse(byId.get(String(id))?.published_at)
      return {
        id,
        fromRank: oldIndex + 1,
        toRank: index + 1,
        ageFromPrimaryMinutes: Number(((primaryTimestamp - timestamp) / 60_000).toFixed(2)),
      }
    })
    .filter(Boolean)
  const sameRankComparisons = personalizedIds
    .slice(0, baselineIds.length)
    .map((id, index) => {
      const baseEntry = byId.get(String(baselineIds[index]))
      const personalizedEntry = byId.get(String(id))
      if (
        !baseEntry ||
        !personalizedEntry ||
        String(baseEntry.id) === String(personalizedEntry.id)
      ) {
        return null
      }
      const olderByMinutes =
        (Date.parse(baseEntry.published_at) - Date.parse(personalizedEntry.published_at)) / 60_000
      return {
        rank: index + 1,
        baselineId: baseEntry.id,
        personalizedId: personalizedEntry.id,
        personalizedOlderByMinutes: Number(olderByMinutes.toFixed(2)),
      }
    })
    .filter(Boolean)

  return {
    promoted,
    rankPositionAgeComparisons: sameRankComparisons,
    maximumOlderByMinutesAtSameRank: Number(
      Math.max(
        0,
        ...sameRankComparisons.map(({ personalizedOlderByMinutes }) => personalizedOlderByMinutes),
      ).toFixed(2),
    ),
  }
}

const makeGenerationContext = () => ({
  generationId: 1,
  requestKey: "synthetic-home-eval",
  canonicalRequestKey: "synthetic-home-eval-canonical",
  identityKey: "synthetic-home-eval-identity",
  sessionRevision: 7,
})

const commitCandidateProjection = ({
  profileState,
  profile,
  baselineProjection,
  personalizedProjection,
  disclosureVisible,
}) => {
  const context = makeGenerationContext()
  let generation = createHomePersonalizationGeneration(context)
  generation =
    profileState === "ready"
      ? resolveHomePersonalizationProfile(generation, { ...context, profile })
      : failHomePersonalizationProfile(generation, context)

  return commitHomePersonalizationSnapshot(generation, {
    ...context,
    baselineProjection,
    personalizedProjection,
    disclosureVisible,
  }).generation
}

const runComposition = (entries, profile, useV1, profileState = "ready") => {
  const baselineSession = makeSession(entries)
  const baselineRecentIds = baselineSession.recentIds
  const baselineHighlights = baselineSession.highlightIds
  const baselineComposition = compose(entries)
  if (!useV1) {
    return {
      baselineSession,
      baselineComposition,
      personalizedProjection: null,
      v1Composition: baselineComposition,
      projectionApplied: false,
      disclosureVisible: false,
    }
  }

  const personalizedProjection = projectHomePersonalization({
    entries,
    baselineHighlightIds: baselineHighlights,
    baselineRecentIds,
    profile,
    freshnessWindow: HOME_PERSONALIZATION_FRESHNESS_WINDOW,
  })
  const v1Composition = compose(entries, {
    highlightIds: personalizedProjection.highlightIds,
    recentIds: personalizedProjection.recentIds,
  })
  const candidateDisclosureVisible = hasHomeEditorialCompositionChanged(
    baselineComposition.sections,
    v1Composition.sections,
  )
  const committedGeneration = commitCandidateProjection({
    profileState,
    profile,
    baselineProjection: baselineComposition.sections,
    personalizedProjection,
    disclosureVisible: candidateDisclosureVisible,
  })
  const committedComposition = committedGeneration.projectionApplied
    ? compose(entries, committedGeneration.projection)
    : baselineComposition
  return {
    baselineSession,
    baselineComposition,
    personalizedProjection,
    v1Composition: committedComposition,
    projectionApplied: committedGeneration.projectionApplied,
    disclosureVisible: committedGeneration.disclosureVisible,
  }
}

const composeForScenario = (scenario) => {
  const { entries } = scenario
  const baseline = runComposition(entries, null, false)
  let profile = null
  let useV1Projection = true

  if (["invalid", "late", "stale"].includes(scenario.profileState)) {
    useV1Projection = false
  } else {
    profile = createHomePersonalizationProfile({
      entries: scenario.profileEntries ?? [],
      hiddenFeedIds: new Set(scenario.hiddenFeedIds),
    })
  }

  const v1 = runComposition(entries, profile, useV1Projection, scenario.profileState ?? "ready")
  const baselineSummary = summarizeComposition(entries, baseline.baselineComposition)
  const v1Summary = summarizeComposition(entries, v1.v1Composition)
  const finalPresentationChanged = !allEqual(
    baseline.baselineComposition.presentationSignature,
    v1.v1Composition.presentationSignature,
  )
  const candidateFinalPresentationChanged = v1.personalizedProjection
    ? !allEqual(
        baseline.baselineComposition.presentationSignature,
        compose(entries, {
          highlightIds: v1.personalizedProjection.highlightIds,
          recentIds: v1.personalizedProjection.recentIds,
        }).presentationSignature,
      )
    : false
  const personalizedOrder = v1.personalizedProjection
    ? [
        ...v1.personalizedProjection.highlightIds.filter((id, index) => index > 0 && id != null),
        ...v1.personalizedProjection.recentIds,
      ]
    : [...baseline.baselineSession.highlightIds.slice(1), ...baseline.baselineSession.recentIds]
  const baselineOrder = [
    ...baseline.baselineSession.highlightIds.slice(1),
    ...baseline.baselineSession.recentIds,
  ]
  const ageDisplacement = calculateAgeDisplacement(
    entries,
    baseline.baselineComposition.visualIds,
    v1.v1Composition.visualIds,
  )
  const topNDelta = {
    distinctSources: v1Summary.topN.distinctSources - baselineSummary.topN.distinctSources,
    distinctCategories: v1Summary.topN.distinctCategories - baselineSummary.topN.distinctCategories,
    consecutiveSameSourcePairs:
      baselineSummary.topN.consecutiveSameSourcePairs - v1Summary.topN.consecutiveSameSourcePairs,
  }
  const measuredTopNBenefit = Object.values(topNDelta).some((delta) => delta > 0)

  return {
    name: scenario.name,
    profileState: scenario.profileState ?? "ready",
    baseline: baselineSummary,
    v1: v1Summary,
    comparison: {
      primaryUnchanged: baselineSummary.primaryId === v1Summary.primaryId,
      finalPresentationChanged,
      candidateFinalPresentationChanged,
      intermediateOrderChanged: !allEqual(baselineOrder, personalizedOrder),
      projectionApplied: v1.projectionApplied,
      disclosureVisible: v1.disclosureVisible,
      disclosureMatchesFinalComposition: v1.disclosureVisible === finalPresentationChanged,
      disclosureMismatch: v1.disclosureVisible !== finalPresentationChanged,
      topNDelta,
      measuredTopNBenefit,
      disclosureCase: v1.projectionApplied
        ? finalPresentationChanged
          ? "APPLIED_WITH_VISIBLE_FINAL_CHANGE"
          : "PROJECTION_APPLIED_BUT_FINAL_COMPOSITION_UNCHANGED"
        : finalPresentationChanged
          ? "NO_PROJECTION_WITH_FINAL_PRESENTATION_CHANGE"
          : "NO_PERSONALIZATION_CHANGE",
      categoryLaneMembershipChanged: !allEqual(
        baselineSummary.categoryLanes.map(({ categoryId, entryIds }) => [categoryId, entryIds]),
        v1Summary.categoryLanes.map(({ categoryId, entryIds }) => [categoryId, entryIds]),
      ),
      categoryLaneOrderChanged: !allEqual(
        baselineSummary.categoryLanes.map(({ categoryId }) => categoryId),
        v1Summary.categoryLanes.map(({ categoryId }) => categoryId),
      ),
      readerOrderParity: v1Summary.readerVisualOrderParity,
      candidateCoveragePass:
        v1Summary.missingIds.length === 0 &&
        v1Summary.extraIds.length === 0 &&
        v1Summary.uniqueVisibleCount === v1Summary.visibleCount &&
        v1Summary.visibleCount === v1Summary.eligibleCount,
      noDuplicateArticleIds: v1Summary.uniqueVisibleCount === v1Summary.visibleCount,
      categoryIdentityPass:
        new Set(v1Summary.categoryLanes.map(({ categoryId }) => categoryId)).size ===
        v1Summary.categoryLanes.length,
      ageDisplacement,
    },
  }
}

const median = (values) => {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

const measureComposition = (scenario, profileState, useV1) => {
  const profile = ["invalid", "late", "stale"].includes(profileState)
    ? null
    : createHomePersonalizationProfile({
        entries: scenario.profileEntries ?? [],
        hiddenFeedIds: new Set(scenario.hiddenFeedIds),
      })
  const durationMs = []
  for (let index = 0; index < EVALUATION_COMPOSITION_SAMPLES; index += 1) {
    const start = performance.now()
    runComposition(scenario.entries, profile, useV1)
    durationMs.push(performance.now() - start)
  }
  return {
    repetitions: EVALUATION_COMPOSITION_SAMPLES,
    medianMs: Number(median(durationMs).toFixed(4)),
    p95Ms: Number(
      durationMs
        .toSorted((left, right) => left - right)
        [Math.min(durationMs.length - 1, Math.ceil(durationMs.length * 0.95) - 1)].toFixed(4),
    ),
  }
}

const evaluateScenario = (scenario) => {
  const result = composeForScenario(scenario)
  return {
    ...result,
    offlineCompositionLatency: {
      phase2c: measureComposition(scenario, scenario.profileState, false),
      personalizationV1: measureComposition(
        scenario,
        scenario.profileState,
        !["invalid", "late", "stale"].includes(scenario.profileState),
      ),
    },
  }
}

const syntheticProfile = (specs) =>
  specs.map((spec, index) =>
    entry({
      id: 80_000 + index,
      minutesAgo: 180 + index,
      ...spec,
      starred: true,
      status: "read",
    }),
  )

const balancedEntries = makeEntries(
  Array.from({ length: 18 }, (_, index) => ({
    id: 1000 + index,
    minutesAgo: index * 3,
    feedId: (index % 6) + 1,
    categoryId: (index % 3) + 10,
  })),
)

const concentrationEntries = makeEntries(
  Array.from({ length: 24 }, (_, index) => ({
    id: 2000 + index,
    minutesAgo: index * 2,
    feedId: index < 12 ? 1 : (index % 5) + 2,
    categoryId: (index % 3) + 20,
  })),
)

const sameCategoryEntries = makeEntries(
  Array.from({ length: 12 }, (_, index) => ({
    id: 3000 + index,
    minutesAgo: index * 2,
    feedId: (index % 6) + 30,
    categoryId: 60,
    categoryTitle: "Shared topic",
  })),
)

const freshnessEdgeEntries = makeEntries([
  { id: 4001, minutesAgo: 0, feedId: 1, categoryId: 1 },
  { id: 4002, minutesAgo: 10, feedId: 2, categoryId: 2 },
  { id: 4003, minutesAgo: 60, feedId: 3, categoryId: 3 },
  { id: 4004, minutesAgo: 61, feedId: 4, categoryId: 4 },
  { id: 4005, minutesAgo: 62, feedId: 5, categoryId: 5 },
  { id: 4006, minutesAgo: 70, feedId: 6, categoryId: 6 },
])

const secondarySwitchEntries = makeEntries([
  { id: 5001, minutesAgo: 0, feedId: 10, categoryId: 100 },
  { id: 5002, minutesAgo: 5, feedId: 20, categoryId: 200 },
  { id: 5003, minutesAgo: 10, feedId: 20, categoryId: 200 },
  { id: 5004, minutesAgo: 15, feedId: 30, categoryId: 300 },
  { id: 5005, minutesAgo: 20, feedId: 40, categoryId: 400 },
  { id: 5006, minutesAgo: 25, feedId: 50, categoryId: 500 },
  { id: 5007, minutesAgo: 30, feedId: 60, categoryId: 600, starred: true },
])

export const EVALUATION_SCENARIOS = [
  {
    name: "balanced_sources_and_categories",
    entries: balancedEntries,
    profileEntries: syntheticProfile([
      { feedId: 1, categoryId: 10 },
      { feedId: 2, categoryId: 11 },
      { feedId: 3, categoryId: 12 },
      { feedId: 4, categoryId: 10 },
      { feedId: 5, categoryId: 11 },
      { feedId: 6, categoryId: 12 },
    ]),
  },
  {
    name: "star_profile_concentrated_in_one_source",
    entries: concentrationEntries,
    profileEntries: syntheticProfile(
      Array.from({ length: 12 }, () => ({ feedId: 1, categoryId: 20 })),
    ),
  },
  {
    name: "star_profile_concentrated_in_one_category",
    entries: concentrationEntries,
    profileEntries: syntheticProfile(
      Array.from({ length: 12 }, (_, index) => ({
        feedId: (index % 6) + 2,
        categoryId: 20,
      })),
    ),
  },
  {
    name: "different_sources_covering_the_same_category",
    entries: sameCategoryEntries,
    profileEntries: syntheticProfile([
      { feedId: 30, categoryId: 60 },
      { feedId: 31, categoryId: 60 },
      { feedId: 32, categoryId: 60 },
    ]),
  },
  {
    name: "exact_60_minute_freshness_boundary",
    entries: freshnessEdgeEntries,
    profileEntries: syntheticProfile([
      { feedId: 3, categoryId: 3 },
      { feedId: 4, categoryId: 4 },
      { feedId: 4, categoryId: 4 },
    ]),
  },
  {
    name: "secondary_highlight_changed_by_current_star",
    entries: secondarySwitchEntries,
    profileEntries: [],
  },
  {
    name: "empty_star_profile",
    entries: balancedEntries,
    profileEntries: [],
  },
  {
    name: "invalid_profile_fallback",
    entries: balancedEntries,
    profileState: "invalid",
    profileEntries: syntheticProfile([{ feedId: 1, categoryId: 10 }]),
  },
  {
    name: "late_profile_fallback",
    entries: balancedEntries,
    profileState: "late",
    profileEntries: syntheticProfile([{ feedId: 1, categoryId: 10 }]),
  },
  {
    name: "stale_session_profile_fallback",
    entries: balancedEntries,
    profileState: "stale",
    profileEntries: syntheticProfile([{ feedId: 1, categoryId: 10 }]),
  },
  {
    name: "same_category_title_different_ids",
    entries: makeEntries([
      { id: 6001, minutesAgo: 0, feedId: 61, categoryId: 71, categoryTitle: "Local" },
      { id: 6002, minutesAgo: 2, feedId: 62, categoryId: 71, categoryTitle: "Local" },
      { id: 6003, minutesAgo: 4, feedId: 63, categoryId: 72, categoryTitle: "Local" },
      { id: 6004, minutesAgo: 6, feedId: 64, categoryId: 72, categoryTitle: "Local" },
      { id: 6005, minutesAgo: 8, feedId: 65, categoryId: 71, categoryTitle: "Local" },
      { id: 6006, minutesAgo: 10, feedId: 66, categoryId: 72, categoryTitle: "Local" },
    ]),
    profileEntries: syntheticProfile([{ feedId: 63, categoryId: 72 }]),
  },
  {
    name: "intermediate_order_change_without_final_composition_change",
    entries: makeEntries(
      Array.from({ length: 12 }, (_, index) => {
        const categoryId = (index % 3) + 701
        return {
          id: 7001 + index,
          minutesAgo: index,
          feedId: categoryId,
          categoryId,
        }
      }),
    ),
    profileEntries: syntheticProfile(
      Array.from({ length: 3 }, () => ({ feedId: 701, categoryId: 701 })),
    ),
  },
]

const scenarioResult = (scenario) => evaluateScenario(scenario)

const summarizeDirectStarReevaluation = (result) => ({
  scenario: result.name,
  primaryHighlight: {
    baselineId: result.baseline.primaryId,
    candidateId: result.v1.primaryId,
    unchanged: result.comparison.primaryUnchanged,
  },
  secondaryHighlightIds: {
    baseline: result.baseline.highlightIds.slice(1),
    candidate: result.v1.highlightIds.slice(1),
  },
  visibleArticleIds: {
    baseline: result.baseline.visibleIds,
    candidate: result.v1.visibleIds,
  },
  coverage: {
    eligible: result.v1.eligibleCount,
    visible: result.v1.visibleCount,
    missingIds: result.v1.missingIds,
    extraIds: result.v1.extraIds,
    noDuplicateIds: result.comparison.noDuplicateArticleIds,
  },
  topN: {
    distinctSources: {
      baseline: result.baseline.topN.distinctSources,
      candidate: result.v1.topN.distinctSources,
    },
    distinctCategories: {
      baseline: result.baseline.topN.distinctCategories,
      candidate: result.v1.topN.distinctCategories,
    },
    adjacentSameSourcePairs: {
      baseline: result.baseline.topN.consecutiveSameSourcePairs,
      candidate: result.v1.topN.consecutiveSameSourcePairs,
    },
    longestSameSourceRun: {
      baseline: result.baseline.topN.longestSameSourceRun,
      candidate: result.v1.topN.longestSameSourceRun,
    },
  },
  promotedArticleAgeDisplacement: result.comparison.ageDisplacement,
  readerOrderParity: result.comparison.readerOrderParity,
  disclosureVisible: result.comparison.disclosureVisible,
  classification: "SYNTHETIC_OBSERVATION_NO_DIVERSITY_GAIN_MORE_REPETITION",
})

export const runEvaluationReport = () => {
  const scenarios = EVALUATION_SCENARIOS.map((scenario) => scenarioResult(scenario))
  const directStar = scenarios.find(
    ({ name }) => name === "secondary_highlight_changed_by_current_star",
  )

  return {
    metadata: {
      mainSha: "17135332f2948a3739b285cbcff112ea07f0996e",
      priorPrHead: "74a6f0ffc5681d0520c562e492eed9fb94847e15",
      historicalPre191MainSha: "430026000f2fe8c7f4e823e17ab39b38254198bf",
      disclosureContract: "PR191 production helpers compare the committed final Home composition",
      baseline: "Phase 2C projection composed through current Home category/session helpers",
      candidate:
        "Current Phase 2D V1 personalization projection composed through the same helpers and PR191 generation commit contract",
      topN: EVALUATION_TOP_N,
      topNDefinition:
        "first 12 article IDs in final visual order (up to 3 Highlights + 9 category-lane slots)",
      scenarioCount: EVALUATION_SCENARIOS.length,
      compositionSamples: EVALUATION_COMPOSITION_SAMPLES,
      freshnessWindowMs: HOME_PERSONALIZATION_FRESHNESS_WINDOW,
      starredProfileLimit: HOME_STARRED_PROFILE_LIMIT,
      data: "deterministic synthetic fixtures only; no Miniflux access",
      caveat:
        "latency measures local projection/composition and PR191 disclosure helpers only; excludes network and browser rendering",
    },
    scenarios,
    directStarReevaluation: summarizeDirectStarReevaluation(directStar),
    sessionStability: evaluateSessionStability(),
  }
}

export const evaluateSessionStability = () => {
  const initialEntries = makeEntries([
    { id: 9001, minutesAgo: 0, feedId: 91, categoryId: 901 },
    { id: 9002, minutesAgo: 2, feedId: 92, categoryId: 902 },
    { id: 9003, minutesAgo: 4, feedId: 93, categoryId: 903 },
    { id: 9004, minutesAgo: 6, feedId: 94, categoryId: 901 },
    { id: 9005, minutesAgo: 8, feedId: 95, categoryId: 902 },
    { id: 9006, minutesAgo: 10, feedId: 96, categoryId: 903 },
  ])
  const initialProjection = projectHomePersonalization({
    entries: initialEntries,
    baselineHighlightIds: selectInitialHighlightIds(initialEntries),
    baselineRecentIds: initialEntries
      .filter(({ status }) => status === "unread")
      .map(({ id }) => id),
    profile: createHomePersonalizationProfile({
      entries: syntheticProfile([{ feedId: 95, categoryId: 902 }]),
      hiddenFeedIds: new Set(),
    }),
    freshnessWindow: HOME_PERSONALIZATION_FRESHNESS_WINDOW,
  })
  const session = makeSession(initialEntries, initialProjection)
  const initial = projectHomeSession(session, initialEntries)
  const frozenSignature = JSON.stringify({
    highlightIds: initial.highlightIds,
    categoryLanes: initial.categoryLanes,
  })
  const appendedEntry = entry({
    id: 9007,
    minutesAgo: -1,
    feedId: 97,
    categoryId: 901,
  })
  const appendedEntries = [...initialEntries, appendedEntry]
  const appendedSession = appendHomeSessionEntries(session, appendedEntries)
  const afterLoadMore = projectHomeSession(appendedSession, appendedEntries)
  const afterRead = projectHomeSession(
    transitionHomeSession(session, {
      sessionRevision: session.sessionRevision,
      targetStatus: "read",
      outcome: "confirmed",
      entryIds: [initialEntries[0].id],
      previousStatuses: { [initialEntries[0].id]: "unread" },
    }),
    initialEntries.map((item) =>
      item.id === initialEntries[0].id ? { ...item, status: "read" } : item,
    ),
  )
  const afterRefresh = projectHomeSession(session, [
    { ...initialEntries[0], title: "Refreshed title" },
    ...initialEntries.slice(1),
    appendedEntry,
  ])
  const afterReaderReturn = projectHomeSession(session, initialEntries)
  const afterStar = projectHomeSession(
    session,
    initialEntries.map((item) => ({ ...item, starred: true })),
  )
  const afterUnstar = projectHomeSession(
    session,
    initialEntries.map((item) => ({ ...item, starred: false })),
  )

  const frozen = (projection) =>
    JSON.stringify({
      highlightIds: projection.highlightIds,
      categoryLanes: projection.categoryLanes,
    }) === frozenSignature

  const fallbackScenarios = [
    "invalid_profile_fallback",
    "late_profile_fallback",
    "stale_session_profile_fallback",
  ].map((name) =>
    composeForScenario(EVALUATION_SCENARIOS.find((scenario) => scenario.name === name)),
  )
  const categoryIdentityScenario = composeForScenario(
    EVALUATION_SCENARIOS.find(({ name }) => name === "same_category_title_different_ids"),
  )
  const freshnessScenario = composeForScenario(
    EVALUATION_SCENARIOS.find(({ name }) => name === "exact_60_minute_freshness_boundary"),
  )
  const generationContext = makeGenerationContext()
  const pendingGeneration = createHomePersonalizationGeneration(generationContext)
  const staleResolvedGeneration = resolveHomePersonalizationProfile(pendingGeneration, {
    ...generationContext,
    sessionRevision: generationContext.sessionRevision + 1,
    profile: { sourceWeights: {} },
  })
  const staleCommit = commitHomePersonalizationSnapshot(pendingGeneration, {
    ...generationContext,
    canonicalRequestKey: `${generationContext.canonicalRequestKey}-stale`,
    baselineProjection: initial,
    personalizedProjection: initialProjection,
    disclosureVisible: true,
  })
  const committedWithoutProfile = commitHomePersonalizationSnapshot(pendingGeneration, {
    ...generationContext,
    baselineProjection: initial,
    personalizedProjection: initialProjection,
    disclosureVisible: false,
  })
  const lateResolvedGeneration = resolveHomePersonalizationProfile(
    committedWithoutProfile.generation,
    { ...generationContext, profile: { sourceWeights: {} } },
  )

  return {
    loadMoreAppendsOnlyToLatest:
      afterLoadMore.latestIds.includes(appendedEntry.id) &&
      frozen(afterLoadMore) &&
      afterLoadMore.categoryLanes.every((lane) => !lane.entryIds.includes(appendedEntry.id)),
    readMutationDoesNotRecompose: frozen(afterRead),
    refreshDoesNotRecompose:
      frozen(afterRefresh) && afterRefresh.latestIds.includes(appendedEntry.id),
    readerReturnDoesNotRecompose: frozen(afterReaderReturn),
    starDoesNotRecompose: frozen(afterStar),
    unstarDoesNotRecompose: frozen(afterUnstar),
    lateProfileDoesNotRecompose: frozen(projectHomeSession(session, initialEntries)),
    invalidProfileFallsBack:
      allEqual(fallbackScenarios[0].v1.visibleIds, fallbackScenarios[0].baseline.visibleIds) &&
      fallbackScenarios[0].comparison.projectionApplied === false,
    lateProfileFallsBack:
      allEqual(fallbackScenarios[1].v1.visibleIds, fallbackScenarios[1].baseline.visibleIds) &&
      fallbackScenarios[1].comparison.projectionApplied === false,
    staleSessionProfileFallsBack:
      allEqual(fallbackScenarios[2].v1.visibleIds, fallbackScenarios[2].baseline.visibleIds) &&
      fallbackScenarios[2].comparison.projectionApplied === false,
    staleRevisionIgnored:
      transitionHomeSession(session, {
        sessionRevision: session.sessionRevision + 1,
        targetStatus: "read",
        outcome: "confirmed",
        entryIds: [initialEntries[0].id],
        previousStatuses: { [initialEntries[0].id]: "unread" },
      }) === session,
    staleGenerationIgnored: staleResolvedGeneration === pendingGeneration && !staleCommit.committed,
    lateProfileAfterCommitIgnored: lateResolvedGeneration === committedWithoutProfile.generation,
    categoryIdentityPreserved: categoryIdentityScenario.comparison.categoryIdentityPass,
    freshnessBoundaryPreserved:
      freshnessScenario.v1.highlightIds.includes(4003) &&
      !freshnessScenario.v1.highlightIds.includes(4004),
  }
}
