import assert from "node:assert/strict"
import test from "node:test"

// Node's direct test runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
const generationModule = await import("./home-personalization-generation.js")
const {
  commitHomePersonalizationSnapshot,
  createHomePersonalizationGeneration,
  failHomePersonalizationProfile,
  failHomePersonalizationSnapshot,
  invalidateHomePersonalizationGeneration,
  resolveHomePersonalizationProfile,
} = generationModule

const context = {
  requestKey: "home-request-1",
  canonicalRequestKey: "canonical-request-1",
  identityKey: "https://miniflux.example|user:7",
  sessionRevision: 12,
}
const generationContext = (generation, overrides = {}) => ({
  ...context,
  generationId: generation.generationId,
  ...overrides,
})
const createGeneration = (overrides = {}) =>
  createHomePersonalizationGeneration({
    generationId: "generation-1",
    ...context,
    ...overrides,
  })
const baseline = {
  highlightIds: [1, 2],
  recentIds: [3, 4],
  personalizationApplied: false,
}
const personalized = {
  highlightIds: [1, 3],
  recentIds: [2, 4],
  personalizationApplied: true,
}
const snapshot = (generation, values = {}) =>
  commitHomePersonalizationSnapshot(generation, {
    ...generationContext(generation),
    baselineProjection: baseline,
    personalizedProjection: personalized,
    ...values,
  })

test("uses a profile resolved before the canonical snapshot", () => {
  const generation = createGeneration()
  const profile = { sourceCounts: new Map([["20", 2]]) }
  const ready = resolveHomePersonalizationProfile(generation, {
    ...generationContext(generation),
    profile,
  })
  const committed = snapshot(ready)

  assert.equal(committed.committed, true)
  assert.deepEqual(committed.projection, personalized)
  assert.equal(committed.generation.status, "committed")
  assert.equal(committed.generation.personalizationApplied, true)
  assert.equal(Object.isFrozen(committed.projection), true)
  assert.equal(Object.isFrozen(committed.projection.highlightIds), true)
})

test("PROFILE_TIMEOUT_FALLS_BACK immediately and discards a late profile without recomposition", () => {
  const pending = createGeneration()
  const committed = snapshot(pending)

  assert.equal(committed.committed, true)
  assert.deepEqual(committed.projection, baseline)
  assert.equal(committed.generation.personalizationApplied, false)

  const late = resolveHomePersonalizationProfile(committed.generation, {
    ...generationContext(committed.generation),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })
  const repeated = snapshot(late)

  assert.equal(late, committed.generation)
  assert.equal(repeated.committed, false)
  assert.deepEqual(repeated.projection, baseline)
})

test("PROFILE_FAILURE_FALLS_BACK without a retry", () => {
  const generation = createGeneration()
  const failedProfile = failHomePersonalizationProfile(generation, generationContext(generation))
  const committed = snapshot(failedProfile)

  assert.equal(failedProfile.profileStatus, "failed")
  assert.deepEqual(committed.projection, baseline)
  assert.equal(committed.generation.profile, null)
})

test("discards a profile from a stale session revision", () => {
  const generation = createGeneration()
  const stale = resolveHomePersonalizationProfile(generation, {
    ...generationContext(generation, { sessionRevision: 11 }),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })

  assert.equal(stale, generation)
  assert.equal(stale.profileStatus, "pending")
  assert.deepEqual(snapshot(stale).projection, baseline)
})

test("discards a profile from a stale normalized account identity", () => {
  const generation = createGeneration()
  const stale = resolveHomePersonalizationProfile(generation, {
    ...generationContext(generation, { identityKey: "https://other.example|user:7" }),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })

  assert.equal(stale, generation)
  assert.equal(stale.profileStatus, "pending")
  assert.deepEqual(snapshot(stale).projection, baseline)
})

test("discards a profile from a stale canonical request or generation", () => {
  const generation = createGeneration()
  const staleCanonical = resolveHomePersonalizationProfile(generation, {
    ...generationContext(generation, { canonicalRequestKey: "canonical-request-2" }),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })
  const staleGeneration = resolveHomePersonalizationProfile(generation, {
    ...generationContext(generation, { generationId: "generation-2" }),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })

  assert.equal(staleCanonical, generation)
  assert.equal(staleGeneration, generation)
})

test("failed canonical refresh preserves the prior projection", () => {
  const previousProjection = {
    highlightIds: [8, 9],
    recentIds: [10],
    personalizationApplied: true,
  }
  const generation = createGeneration({ previousProjection })
  const failed = failHomePersonalizationSnapshot(generation, generationContext(generation))

  assert.equal(failed.status, "canonical-failed")
  assert.equal(failed.visibleProjection, previousProjection)
})

test("explicit refresh keeps the prior projection until one replacement commits", () => {
  const previousProjection = {
    highlightIds: [8, 9],
    recentIds: [10],
    personalizationApplied: false,
  }
  const refresh = createGeneration({
    generationId: "generation-2",
    previousProjection,
  })
  const ready = resolveHomePersonalizationProfile(refresh, {
    ...generationContext(refresh),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })

  assert.equal(ready.visibleProjection, previousProjection)
  const replacement = snapshot(ready)
  const repeated = snapshot(replacement.generation)

  assert.equal(replacement.committed, true)
  assert.deepEqual(replacement.projection, personalized)
  assert.equal(replacement.generation.visibleProjection, replacement.projection)
  assert.equal(repeated.committed, false)
  assert.equal(repeated.projection, replacement.projection)
})

test("invalidation discards later profile results", () => {
  const generation = createGeneration()
  const invalidated = invalidateHomePersonalizationGeneration(generation)
  const late = resolveHomePersonalizationProfile(invalidated, {
    ...generationContext(invalidated),
    profile: { sourceCounts: new Map([["20", 2]]) },
  })

  assert.equal(invalidated.status, "invalidated")
  assert.equal(late, invalidated)
  assert.equal(late.profile, null)
})
