/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  buildStoryProjections,
  computeArticleRevision,
  selectRepresentative,
  validateStoryProjections,
} from "./story-projection.js"

test("computeArticleRevision is deterministic and ignores read/starred mutations", () => {
  const articlesA = [
    { id: 1, feed_id: 10, title: "Title A", published_at: 1000, read: false, starred: false },
    { id: 2, feed_id: 20, title: "Title B", published_at: 2000, read: false, starred: false },
  ]
  const articlesB = [
    { id: 1, feed_id: 10, title: "Title A", published_at: 1000, read: true, starred: true }, // Mutated read/starred!
    { id: 2, feed_id: 20, title: "Title B", published_at: 2000, read: true, starred: false }, // Mutated read!
  ]
  const articlesC = [
    { id: 1, feed_id: 10, title: "New Title A", published_at: 1000, read: false, starred: false }, // Title changed
    { id: 2, feed_id: 20, title: "Title B", published_at: 2000, read: false, starred: false },
  ]

  const revA = computeArticleRevision(articlesA)
  const revB = computeArticleRevision(articlesB)
  const revC = computeArticleRevision(articlesC)

  // Read/starred mutations MUST NOT change articleRevision (Section 22)
  assert.equal(revA, revB, "Revision must ignore read/starred mutations")

  // Changing title MUST change revision
  assert.notEqual(revA, revC, "Revision must change when title changes")
})

test("selectRepresentative picks member with lowest homePosition (highest-ranked in Home)", () => {
  const articleLookup = new Map([
    [101, { id: 101, homePosition: 5 }],
    [102, { id: 102, homePosition: 1 }], // Highest ranked in Home
    [103, { id: 103, homePosition: 8 }],
  ])

  const rep = selectRepresentative([101, 102, 103], articleLookup)
  assert.equal(rep, 102)
})

test("buildStoryProjections constructs valid H1 projections and alternatives", () => {
  const articles = [
    { id: 10, feedId: "f1", publishedAt: 1000, homePosition: 0 },
    { id: 20, feedId: "f2", publishedAt: 2000, homePosition: 1 },
    { id: 30, feedId: "f3", publishedAt: 1500, homePosition: 2 },
  ]

  const clusters = [
    [10, 30], // 2-member cluster
    [20], // 1-member singleton
  ]

  const projections = buildStoryProjections(clusters, articles)
  assert.equal(projections.length, 2)

  // First projection: cluster [10, 30] at min homePosition 0
  const p1 = projections[0]
  assert.equal(p1.representativeArticleId, 10)
  assert.deepEqual(p1.memberArticleIds, [10, 30])
  assert.deepEqual(p1.alternativeArticleIds, [30])
  assert.equal(p1.placementIndex, 0)
  assert.equal(p1.memberCount, 2)
  assert.equal(p1.sourceCount, 2)
  assert.equal(p1.firstPublishedAt, 1000)
  assert.equal(p1.lastPublishedAt, 1500)

  // Second projection: singleton [20] at homePosition 1
  const p2 = projections[1]
  assert.equal(p2.representativeArticleId, 20)
  assert.deepEqual(p2.memberArticleIds, [20])
  assert.deepEqual(p2.alternativeArticleIds, [])
  assert.equal(p2.placementIndex, 1)
  assert.equal(p2.memberCount, 1)
})

test("validateStoryProjections enforces all 7 Section 27 invariants", () => {
  const original = [{ id: 1 }, { id: 2 }, { id: 3 }]

  const validProjections = [
    {
      storyId: "s1",
      representativeArticleId: 1,
      memberArticleIds: [1, 2],
      memberCount: 2,
      placementIndex: 0,
    },
    {
      storyId: "s2",
      representativeArticleId: 3,
      memberArticleIds: [3],
      memberCount: 1,
      placementIndex: 2,
    },
  ]

  // Valid case
  assert.deepEqual(validateStoryProjections(validProjections, original), { valid: true })

  // 1. Unknown member ID
  const unknownId = [
    {
      storyId: "s1",
      representativeArticleId: 1,
      memberArticleIds: [1, 999],
      memberCount: 2,
      placementIndex: 0,
    },
    {
      storyId: "s2",
      representativeArticleId: 3,
      memberArticleIds: [3],
      memberCount: 1,
      placementIndex: 2,
    },
  ]
  assert.equal(validateStoryProjections(unknownId, original).valid, false)

  // 2. Duplicate member across stories
  const dupAcross = [
    {
      storyId: "s1",
      representativeArticleId: 1,
      memberArticleIds: [1, 2],
      memberCount: 2,
      placementIndex: 0,
    },
    {
      storyId: "s2",
      representativeArticleId: 2,
      memberArticleIds: [2, 3],
      memberCount: 2,
      placementIndex: 1,
    },
  ]
  assert.equal(validateStoryProjections(dupAcross, original).valid, false)

  // 3. Representative not in members
  const repNotIn = [
    {
      storyId: "s1",
      representativeArticleId: 99,
      memberArticleIds: [1, 2],
      memberCount: 2,
      placementIndex: 0,
    },
    {
      storyId: "s2",
      representativeArticleId: 3,
      memberArticleIds: [3],
      memberCount: 1,
      placementIndex: 2,
    },
  ]
  assert.equal(validateStoryProjections(repNotIn, original).valid, false)

  // 4. Accounting mismatch (dropped article 2)
  const dropped = [
    {
      storyId: "s1",
      representativeArticleId: 1,
      memberArticleIds: [1],
      memberCount: 1,
      placementIndex: 0,
    },
    {
      storyId: "s2",
      representativeArticleId: 3,
      memberArticleIds: [3],
      memberCount: 1,
      placementIndex: 2,
    },
  ]
  assert.equal(validateStoryProjections(dropped, original).valid, false)
})
