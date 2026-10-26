/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import { applyStoryProjection } from "./home-story-adapter.js"

test("Flat-Home Parity: null or empty projections produce exact flat Home items", () => {
  const articles = [
    { id: 101, title: "Article 1" },
    { id: 102, title: "Article 2" },
    { id: 103, title: "Article 3" },
  ]

  // With null projections
  const itemsNull = applyStoryProjection(articles, null)
  assert.equal(itemsNull.length, 3)
  assert.equal(itemsNull[0].articleId, 101)
  assert.equal(itemsNull[1].articleId, 102)
  assert.equal(itemsNull[2].articleId, 103)
  assert.equal(itemsNull[0].type, "article")

  // With empty array projections
  const itemsEmpty = applyStoryProjection(articles, [])
  assert.equal(itemsEmpty.length, 3)
  assert.equal(itemsEmpty[0].articleId, 101)
  assert.equal(itemsEmpty[1].articleId, 102)
  assert.equal(itemsEmpty[2].articleId, 103)
})

test("Zero-Scores Parity: singleton projections yield identical flat Home ordering", () => {
  const articles = [
    { id: 201, title: "First" },
    { id: 202, title: "Second" },
    { id: 203, title: "Third" },
  ]

  // All singletons
  const singletonProjections = [
    {
      storyId: "s1",
      representativeArticleId: 201,
      memberArticleIds: [201],
      alternativeArticleIds: [],
      placementIndex: 0,
      memberCount: 1,
    },
    {
      storyId: "s2",
      representativeArticleId: 202,
      memberArticleIds: [202],
      alternativeArticleIds: [],
      placementIndex: 1,
      memberCount: 1,
    },
    {
      storyId: "s3",
      representativeArticleId: 203,
      memberArticleIds: [203],
      alternativeArticleIds: [],
      placementIndex: 2,
      memberCount: 1,
    },
  ]

  const items = applyStoryProjection(articles, singletonProjections)
  assert.equal(items.length, 3)
  assert.equal(items[0].articleId, 201)
  assert.equal(items[1].articleId, 202)
  assert.equal(items[2].articleId, 203)
  assert.equal(items[0].type, "article")
  assert.equal(items[1].type, "article")
  assert.equal(items[2].type, "article")
})

test("Story Fixture Test: articles A (pos 0) and B (pos 3) form single story item at pos 0", () => {
  const articles = [
    { id: 1, title: "Article 1 (pos 0)" },
    { id: 2, title: "Article 2 (pos 1)" },
    { id: 3, title: "Article 3 (pos 2)" },
    { id: 4, title: "Article 4 (pos 3)" },
  ]

  // Cluster: 1 and 4 form a story at min position 0
  const projections = [
    {
      storyId: "s_1_4",
      representativeArticleId: 1,
      memberArticleIds: [1, 4],
      alternativeArticleIds: [4],
      placementIndex: 0,
      memberCount: 2,
    },
    {
      storyId: "s_2",
      representativeArticleId: 2,
      memberArticleIds: [2],
      alternativeArticleIds: [],
      placementIndex: 1,
      memberCount: 1,
    },
    {
      storyId: "s_3",
      representativeArticleId: 3,
      memberArticleIds: [3],
      alternativeArticleIds: [],
      placementIndex: 2,
      memberCount: 1,
    },
  ]

  const items = applyStoryProjection(articles, projections)

  // 4 original articles condensed into 3 items (1 story item + 2 article items)
  assert.equal(items.length, 3)

  // Story item placed at position 0
  assert.equal(items[0].type, "story")
  assert.equal(items[0].articleId, 1)
  assert.equal(items[0].representative.title, "Article 1 (pos 0)")
  assert.equal(items[0].alternatives.length, 1)
  assert.equal(items[0].alternatives[0].title, "Article 4 (pos 3)")

  // Subsequent items preserved in relative order
  assert.equal(items[1].type, "article")
  assert.equal(items[1].articleId, 2)
  assert.equal(items[2].type, "article")
  assert.equal(items[2].articleId, 3)
})

test("Article Accounting & Live State: consumes live article objects without mutation", () => {
  const liveArticle = {
    id: 10,
    title: "Breaking News",
    status: "read", // Live Miniflux state
    starred: true, // Live Miniflux state
  }
  const livePartner = {
    id: 20,
    title: "Partner Story",
    status: "unread",
    starred: false,
  }

  const articles = [liveArticle, livePartner]
  const projections = [
    {
      storyId: "s_10_20",
      representativeArticleId: 10,
      memberArticleIds: [10, 20],
      alternativeArticleIds: [20],
      placementIndex: 0,
      memberCount: 2,
    },
  ]

  const items = applyStoryProjection(articles, projections)
  assert.equal(items.length, 1)
  assert.equal(items[0].type, "story")

  // Live state reflected directly (Section 84)
  assert.equal(items[0].representative.status, "read")
  assert.equal(items[0].representative.starred, true)
  assert.equal(items[0].alternatives[0].status, "unread")
  assert.equal(items[0].alternatives[0].starred, false)

  // Exact reference to live object
  assert.equal(items[0].representative, liveArticle)
  assert.equal(items[0].alternatives[0], livePartner)
})
