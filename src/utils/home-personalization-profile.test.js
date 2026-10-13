import assert from "node:assert/strict"
import { test } from "node:test"

let profileModule
try {
  // eslint-disable-next-line import/extensions
  profileModule = await import("./home-personalization-profile.js")
} catch (error) {
  if (error.code !== "ERR_MODULE_NOT_FOUND") {
    throw error
  }
}

const { createHomePersonalizationProfile, getCandidatePreferenceSignals } = profileModule ?? {}

const entry = (id, feedId, categoryId) => ({
  id,
  feed:
    feedId == null
      ? null
      : { id: feedId, category: categoryId == null ? null : { id: categoryId } },
})

test("deduplicates stable entry IDs and excludes hidden feeds from aggregate counts", () => {
  assert.equal(typeof createHomePersonalizationProfile, "function")
  const profile = createHomePersonalizationProfile({
    entries: [
      entry(1, 10, 100),
      entry("1", 20, 200),
      entry(2, 10, 100),
      entry(3, 99, 100),
      entry(4, null, null),
    ],
    hiddenFeedIds: new Set([99]),
  })

  assert.deepEqual([...profile.starredEntryIds], ["1", "2", "4"])
  assert.equal(getCandidatePreferenceSignals(entry(3, 99, 100), profile).currentItemStarred, false)
  assert.equal(profile.sourceCounts.get("10"), 2)
  assert.equal(profile.sourceCounts.has("99"), false)
  assert.equal(profile.categoryCounts.get("100"), 2)
})

test("excludes each candidate itself from source and category affinity", () => {
  assert.equal(typeof createHomePersonalizationProfile, "function")
  assert.equal(typeof getCandidatePreferenceSignals, "function")
  const entries = [entry(1, 10, 100), entry(2, 10, 100), entry(3, 20, 100)]
  const profile = createHomePersonalizationProfile({ entries, hiddenFeedIds: new Set() })

  assert.deepEqual(getCandidatePreferenceSignals(entries[0], profile), {
    currentItemStarred: true,
    sourceAffinity: 1,
    categoryAffinity: 2,
  })
  assert.deepEqual(getCandidatePreferenceSignals(entries[1], profile), {
    currentItemStarred: true,
    sourceAffinity: 1,
    categoryAffinity: 2,
  })
})

test("keeps current-item star separate and missing metadata has no affinity", () => {
  assert.equal(typeof createHomePersonalizationProfile, "function")
  assert.equal(typeof getCandidatePreferenceSignals, "function")
  const starred = entry(1, null, null)
  const profile = createHomePersonalizationProfile({
    entries: [starred, entry(2, 10, 100)],
    hiddenFeedIds: new Set(),
  })

  assert.deepEqual(getCandidatePreferenceSignals(starred, profile), {
    currentItemStarred: true,
    sourceAffinity: 0,
    categoryAffinity: 0,
  })
  assert.deepEqual(getCandidatePreferenceSignals(entry(3, null, null), profile), {
    currentItemStarred: false,
    sourceAffinity: 0,
    categoryAffinity: 0,
  })
})
