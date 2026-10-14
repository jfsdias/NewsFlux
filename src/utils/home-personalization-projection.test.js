import assert from "node:assert/strict"
import { test } from "node:test"

// eslint-disable-next-line import/extensions
const profileModule = await import("./home-personalization-profile.js")
const { createHomePersonalizationProfile, getCandidatePreferenceSignals } = profileModule

let projectionModule
let constantsModule
try {
  // eslint-disable-next-line import/extensions
  projectionModule = await import("./home-personalization-projection.js")
  // eslint-disable-next-line import/extensions
  constantsModule = await import("./home-personalization-constants.js")
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") {
    throw error
  }
}

const { projectHomePersonalization } = projectionModule ?? {}

// eslint-disable-next-line unicorn/no-negated-condition
if (typeof projectHomePersonalization !== "function") {
  test("exports the constrained Home personalization projection", () => {
    assert.equal(typeof projectHomePersonalization, "function")
  })
} else {
  const { HOME_PERSONALIZATION_FRESHNESS_WINDOW, HOME_STARRED_PROFILE_LIMIT } = constantsModule
  const HOUR = 60 * 60 * 1000
  const dateAtAge = (hours) =>
    hours == null ? null : new Date(Date.UTC(2026, 9, 13, 12) - hours * HOUR).toISOString()
  const article = (id, ageHours, feedId, categoryId, starred = false) => ({
    id,
    published_at: dateAtAge(ageHours),
    feed: { id: feedId, category: { id: categoryId } },
    starred,
  })
  const makeProfile = (entries = [], hiddenFeedIds = []) =>
    createHomePersonalizationProfile({ entries, hiddenFeedIds: new Set(hiddenFeedIds) })
  const project = (
    entries,
    baselineHighlightIds,
    baselineRecentIds,
    profile,
    freshnessWindow = HOUR,
  ) =>
    projectHomePersonalization({
      entries,
      baselineHighlightIds,
      baselineRecentIds,
      profile,
      freshnessWindow,
    })
  const assertConserved = (entries, result) => {
    const allIds = [...result.highlightIds.filter((id) => id != null), ...result.recentIds]
    assert.equal(allIds.length, new Set(allIds).size)
    assert.deepEqual(
      allIds.toSorted((left, right) => left - right),
      entries.map(({ id }) => id).toSorted((left, right) => left - right),
    )
  }

  test("uses only the PM-approved profile limit and freshness boundary", () => {
    assert.equal(HOME_STARRED_PROFILE_LIMIT, 75)
    assert.equal(HOME_PERSONALIZATION_FRESHNESS_WINDOW, HOUR)
  })

  test("keeps Primary newest and preserves exact Phase 2C order for empty, unmatched, and hidden-only profiles", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.1, 2, 2),
      article(3, 0.2, 3, 3),
      article(4, 0.3, 4, 4),
    ]
    const baselineHighlights = [1, 3, 2]
    const baselineRecent = [4]
    const profiles = [
      makeProfile(),
      makeProfile([article(90, 0.1, 90, 90)]),
      makeProfile([article(91, 0.1, 91, 91)], [91]),
    ]

    for (const profile of profiles) {
      const result = project(entries, baselineHighlights, baselineRecent, profile)
      assert.deepEqual(result.highlightIds, baselineHighlights)
      assert.deepEqual(result.recentIds, baselineRecent)
      assert.equal(result.personalizationApplied, false)
      assert.equal(result.highlightIds[0], 1)
    }
  })

  test("SECONDARY_BASELINE_ORDER_NEED_NOT_BE_CHRONOLOGICAL", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.1, 2, 2),
      article(3, 0.2, 3, 3),
      article(4, 0.3, 4, 4),
    ]
    const result = project(entries, [1, 3, 2], [4], makeProfile())
    assert.deepEqual(result.highlightIds, [1, 3, 2])
    assert.deepEqual(result.recentIds, [4])
  })

  test("SECONDARY_CAN_SELECT_FROM_RECENT and DISPLACED_SECONDARY_RETURNS_TO_RECENT", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.2, 2, 2),
      article(3, 0.3, 3, 3),
      article(4, 0.4, 4, 4),
    ]
    const result = project(entries, [1, 2], [3, 4], makeProfile([entries[2]]))

    assert.deepEqual(result.highlightIds, [1, 3])
    assert.deepEqual(result.recentIds, [2, 4])
    assert.equal(result.personalizationApplied, true)
    assertConserved(entries, result)
  })

  test("keeps every Secondary slot filled when an earlier promotion selects a later baseline slot", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.1, 2, 2),
      article(3, 0.2, 3, 3),
      article(4, 0.3, 4, 4),
    ]
    const result = project(
      entries,
      [1, 2, 3],
      [4],
      makeProfile([article(3, 0.2, 3, 3, true), article(30, 0.25, 3, 3, true)]),
    )

    assert.deepEqual(result.highlightIds, [1, 3, 2])
    assert.deepEqual(result.recentIds, [4])
    assert.equal(result.personalizationApplied, true)
    assertConserved(entries, result)
  })

  test("CANDIDATE_SELF_EXCLUDED_FROM_AFFINITY and CURRENT_STAR_DIRECT_SIGNAL", () => {
    const candidate = article(2, 0.2, 20, 200, true)
    const profile = makeProfile([candidate])
    assert.deepEqual(getCandidatePreferenceSignals(candidate, profile), {
      currentItemStarred: true,
      sourceAffinity: 0,
      categoryAffinity: 0,
    })

    const entries = [article(1, 0, 1, 1), candidate, article(3, 0.3, 30, 300)]
    const result = project(entries, [1, 3], [2], profile)
    assert.deepEqual(result.highlightIds, [1, 2])
  })

  test("SOURCE_AFFINITY_PRECEDES_CATEGORY_AFFINITY", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.1, 2, 2),
      article(3, 0.2, 3, 3),
      article(4, 0.3, 4, 4),
    ]
    const profile = makeProfile([
      article(90, 2, 2, 90),
      article(91, 3, 2, 91),
      article(92, 4, 92, 3),
      article(93, 5, 93, 3),
      article(94, 6, 94, 3),
    ])
    const result = project(entries, [1, 3], [2, 4], profile)

    assert.deepEqual(result.highlightIds, [1, 2])
    assert.deepEqual(result.recentIds, [3, 4])
    assert.equal(result.personalizationApplied, true)
  })

  test("DIVERSITY_BOUNDS_PERSONALIZATION with source diversity before category diversity", () => {
    const primary = article(1, 0, 10, 100)
    const repeatedSource = article(2, 0.1, 10, 200)
    const newSource = article(3, 0.2, 30, 100, true)
    const entries = [primary, repeatedSource, newSource]
    const result = project(entries, [1, 2], [3], makeProfile([newSource]))

    assert.deepEqual(result.highlightIds, [1, 3])
    assertConserved(entries, result)
  })

  test("uses stable entry ID only after matching preference signals", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.1, 2, 2, true),
      article(3, 0.2, 2, 2, true),
      article(5, 0.3, 2, 2),
    ]
    const result = project(entries, [1, 5], [2, 3], makeProfile([entries[1], entries[2]]))

    assert.deepEqual(result.highlightIds, [1, 2])
    assert.deepEqual(result.recentIds, [3, 5])
  })

  test("FRESHNESS_BOUNDS_PERSONALIZATION at below, inclusive, and above-window boundaries", () => {
    const cases = [
      { name: "below", age: 1 - 1 / HOUR, expectedSecondary: 3 },
      { name: "exact", age: 1, expectedSecondary: 3 },
      { name: "above", age: 1 + 1 / HOUR, expectedSecondary: 2 },
    ]

    for (const { name, age, expectedSecondary } of cases) {
      const entries = [article(1, 0, 1, 1), article(2, 0.2, 2, 2), article(3, age, 3, 3)]
      const result = project(entries, [1, 2], [3], makeProfile([entries[2]]))
      assert.equal(result.highlightIds[1], expectedSecondary, name)
    }
  })

  test("blocks neighbor chaining and treats an invalid timestamp as a singleton", () => {
    const chainedEntries = [article(1, 0, 1, 1), article(2, 0.6, 2, 2), article(3, 1.2, 3, 3, true)]
    const chained = project(chainedEntries, [1, 2], [3], makeProfile([chainedEntries[2]]))
    assert.deepEqual(chained.highlightIds, [1, 2])
    assert.equal(chained.personalizationApplied, false)

    const invalidEntries = [
      article(10, 0, 10, 10),
      article(11, null, 11, 11),
      article(12, 0.1, 12, 12, true),
    ]
    const invalid = project(invalidEntries, [10, 11], [12], makeProfile([invalidEntries[2]]))
    assert.deepEqual(invalid.highlightIds, [10, 11])
    assert.equal(invalid.personalizationApplied, false)
  })

  test("uses stable entry ID to resolve equal Recent preference signals", () => {
    const entries = [article(1, 0, 1, 1), article(3, 0.1, 2, 2, true), article(2, 0.2, 2, 2, true)]
    const result = project(entries, [1], [3, 2], makeProfile([entries[1], entries[2]]))

    assert.deepEqual(result.recentIds, [2, 3])
    assert.equal(result.personalizationApplied, true)
  })

  test("RECENT_GROUPS_USE_POST_HIGHLIGHT_REMAINDER after a within-group promotion", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 2, 20, 20),
      article(3, 2.5, 30, 30, true),
      article(4, 3.4, 40, 40),
      article(5, 3.6, 40, 40, true),
    ]
    const result = project(entries, [1, 2], [3, 4, 5], makeProfile([entries[2], entries[4]]))

    assert.deepEqual(result.highlightIds, [1, 3])
    assert.deepEqual(result.recentIds, [2, 5, 4])
    assertConserved(entries, result)
  })

  test("CROSS_GROUP_SECONDARY_PROMOTION_BLOCKED and CANDIDATE_PARTITION_CONSERVED", () => {
    const entries = [
      article(1, 0, 1, 1),
      article(2, 0.6, 2, 2),
      article(3, 1.2, 3, 3, true),
      article(4, 1.3, 4, 4),
    ]
    const result = project(entries, [1, 2], [3, 4], makeProfile([entries[2]]))

    assert.deepEqual(result.highlightIds, [1, 2])
    assert.deepEqual(result.recentIds, [3, 4])
    assertConserved(entries, result)
  })

  test("PERSONALIZATION_EXPLAINER_TRUTHFUL only reports a visible order change", () => {
    const entries = [article(1, 0, 1, 1), article(2, 0.1, 2, 2), article(3, 0.2, 3, 3)]
    const noMatch = project(entries, [1, 2], [3], makeProfile([article(90, 3, 90, 90)]))
    const changed = project(entries, [1, 2], [3], makeProfile([entries[2]]))

    assert.equal(noMatch.personalizationApplied, false)
    assert.equal(changed.personalizationApplied, true)
  })
}
