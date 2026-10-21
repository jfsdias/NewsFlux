import assert from "node:assert/strict"
import test from "node:test"

// eslint-disable-next-line import/extensions
import { createInterestProfile, explainInterestProfileCandidate } from "./interest-profile-spike.js"

const entry = (id, feedId, categoryId, starred = true) => ({
  id,
  starred,
  feed: { id: feedId, category: { id: categoryId } },
})

test("INTEREST_PROFILE_SPIKE_IS_DETERMINISTIC_AND_EXPLAINABLE", () => {
  const entries = [entry(1, 10, 100), entry(2, 10, 100), entry(3, 20, 100)]
  const first = createInterestProfile({ starredEntries: entries })
  const second = createInterestProfile({ starredEntries: entries })

  assert.deepEqual(first, second)
  assert.deepEqual(explainInterestProfileCandidate(entry(4, 10, 100, false), first), {
    currentItemStarred: false,
    sourceAffinity: 2,
    categoryAffinity: 3,
    reasons: ["same-source-starred-entries:2", "same-category-starred-entries:3"],
  })
})

test("INTEREST_PROFILE_SPIKE_EXCLUDES_HIDDEN_FEEDS_AND_CANDIDATE_SELF", () => {
  const profile = createInterestProfile({
    starredEntries: [entry(1, 10, 100), entry(2, 10, 100)],
    hiddenFeedIds: new Set([10]),
  })

  assert.deepEqual(explainInterestProfileCandidate(entry(1, 10, 100), profile), {
    currentItemStarred: true,
    sourceAffinity: 0,
    categoryAffinity: 0,
    reasons: ["current-item-starred"],
  })
  assert.deepEqual(profile, {
    sourceAffinity: {},
    categoryAffinity: {},
    countedEntryMetadataById: {},
    signalAvailability: {
      currentItemStarred: true,
      sourceAffinity: true,
      categoryAffinity: true,
      topicSignals: false,
      recencyPreferences: false,
    },
  })
})

test("INTEREST_PROFILE_SPIKE_HAS_NO_TOPIC_OR_RECENCY_SIGNAL", () => {
  const profile = createInterestProfile({ starredEntries: [] })
  assert.equal(profile.signalAvailability.topicSignals, false)
  assert.equal(profile.signalAvailability.recencyPreferences, false)
  assert.deepEqual(explainInterestProfileCandidate(entry(4, 10, 100, false), profile), {
    currentItemStarred: false,
    sourceAffinity: 0,
    categoryAffinity: 0,
    reasons: [],
  })
})
