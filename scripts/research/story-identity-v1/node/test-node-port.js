/**
 * Unit tests for pure JavaScript story-engine.js (STORY-01B-C14)
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { runNodeBenchmark } from "./node-benchmark.js"
import { runPropertyTesting } from "./property-tester.js"
import {
  buildStoryProjections,
  clusterArticles,
  pairKey,
  selectAlternatives,
  selectRepresentative,
} from "./story-engine.js"

describe("Node Story Engine Portability Tests", () => {
  test("pairKey canonical ordering", () => {
    assert.equal(pairKey(102, 101), "101:102")
    assert.equal(pairKey(101, 102), "101:102")
    assert.equal(pairKey("200", "50"), "50:200")
  })

  test("P0 unrestricted connected components on synthetic chain", () => {
    const articles = [1, 2, 3]
    const scores = { "1:2": 0.8, "2:3": 0.8 }
    const clusters = clusterArticles(articles, scores, {
      policy: "P0_UNRESTRICTED_CC",
      threshold: 0.5,
    })

    assert.equal(clusters.length, 1)
    assert.deepEqual(clusters[0], [1, 2, 3])
  })

  test("P1 representative guard blocks third article when edge to rep is missing", () => {
    const articles = [1, 2, 3]
    const scores = { "1:2": 0.9, "2:3": 0.8 }
    const published = { 1: 100, 2: 200, 3: 300 }

    const clusters = clusterArticles(articles, scores, {
      policy: "P1_REPRESENTATIVE_GUARD",
      threshold: 0.5,
      publishedLookup: published,
    })

    const multi = clusters.filter((c) => c.length > 1)
    assert.equal(multi.length, 1)
    assert.deepEqual(multi[0], [1, 2])
    assert.ok(clusters.some((c) => c.length === 1 && c[0] === 3))
  })

  test("P2 observed edge compatibility vetoes candidate on negative edge", () => {
    const articles = [1, 2, 3]
    const scores = {
      "1:2": 0.8,
      "1:3": 0.6,
      "2:3": 0.2,
    }
    const published = { 1: 100, 2: 200, 3: 300 }

    const clusters = clusterArticles(articles, scores, {
      policy: "P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY",
      threshold: 0.5,
      publishedLookup: published,
    })

    const multi = clusters.filter((c) => c.length > 1)
    assert.equal(multi.length, 1)
    assert.deepEqual(multi[0], [1, 2])
  })

  test("P3 strong multi-member support requires >= 2 edges to existing members", () => {
    const articles = [1, 2, 3]
    const scores = {
      "1:2": 0.8,
      "1:3": 0.6,
    }
    const published = { 1: 100, 2: 200, 3: 300 }

    const clusters = clusterArticles(articles, scores, {
      policy: "P3_STRONG_MULTI_MEMBER_SUPPORT",
      threshold: 0.5,
      publishedLookup: published,
    })

    const multi = clusters.filter((c) => c.length > 1)
    assert.equal(multi.length, 1)
    assert.deepEqual(multi[0], [1, 2])
  })

  test("Representative selection R0 Earliest vs R1 Latest", () => {
    const members = [101, 102, 103]
    const published = { 101: 200, 102: 100, 103: 300 }

    const repEarliest = selectRepresentative(members, {
      policy: "R0_EARLIEST",
      publishedLookup: published,
    })
    assert.equal(repEarliest, 102)

    const repLatest = selectRepresentative(members, {
      policy: "R1_LATEST",
      publishedLookup: published,
    })
    assert.equal(repLatest, 103)
  })

  test("Alternatives selection A2 Diverse Top-K distinct feed prioritization", () => {
    const members = [1, 2, 3, 4]
    const feedLookup = { 1: "FeedA", 2: "FeedB", 3: "FeedB", 4: "FeedC" }

    const alts = selectAlternatives(members, 1, { policy: "A2_DIVERSE_TOP_K", maxK: 2, feedLookup })
    assert.equal(alts.length, 2)
    assert.ok(alts.includes(2) || alts.includes(3))
    assert.ok(alts.includes(4))
    assert.ok(!alts.includes(1))
  })

  test("Story projection object construction and confidence debt note", () => {
    const clusters = [[10, 20], [30]]
    const articlesLookup = {
      10: { published_at: 100, feed_title: "Feed1" },
      20: { published_at: 120, feed_title: "Feed2" },
      30: { published_at: 150, feed_title: "Feed3" },
    }
    const pairScores = { "10:20": 0.85 }

    const projs = buildStoryProjections(clusters, { articlesLookup, pairScores })
    assert.equal(projs.length, 2)

    const multiStory = projs[0]
    assert.equal(multiStory.member_count, 2)
    assert.equal(multiStory.confidence, "UNVERIFIED_MULTI_MEMBER")
    assert.ok(multiStory.confidence_methodological_debt_note.includes("methodological debt"))
    assert.ok(multiStory.story_id.startsWith("story_"))

    const saStory = projs[1]
    assert.equal(saStory.member_count, 1)
    assert.equal(saStory.confidence, "STANDALONE")
  })

  test("Python <-> Node Home-200 Parity verification", () => {
    const { parityReport } = runNodeBenchmark()
    assert.equal(parityReport.parity_gates.CLUSTER_MEMBERSHIP_PARITY, "PASS")
    assert.equal(parityReport.parity_gates.REPRESENTATIVE_PARITY, "PASS")
    assert.equal(parityReport.parity_gates.ALTERNATIVE_PARITY, "PASS")
    assert.equal(parityReport.parity_gates.STORY_COUNT_PARITY, "PASS")
    assert.equal(parityReport.parity_gates.OVERALL_NODE_PORT_PARITY, "PASS")
  })

  test("Adversarial property testing (1000 generative topologies)", () => {
    const report = runPropertyTesting(1000)
    assert.equal(report.scenarios_passed, 1000)
    assert.equal(report.scenarios_failed, 0)
    assert.equal(report.gate_verdict, "PASS")
  })
})
