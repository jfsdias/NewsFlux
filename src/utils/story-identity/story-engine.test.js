import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const sourceRootUrlPrefix = pathToFileURL(`${sourceRoot}${path.sep}`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null
    if (specifier.startsWith("@/")) {
      target = path.resolve(sourceRoot, specifier.slice(2))
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith(sourceRootUrlPrefix) &&
      !path.extname(specifier)
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }

    if (target) {
      if (!path.extname(target)) {
        const jsTarget = `${target}.js`
        const jsxTarget = `${target}.jsx`
        if (existsSync(jsTarget)) {
          return nextResolve(pathToFileURL(jsTarget).href, context)
        }
        if (existsSync(jsxTarget)) {
          return nextResolve(pathToFileURL(jsxTarget).href, context)
        }
      } else if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const { runP3Clustering } = await import("./story-engine")

test("P3: positive edge starts a 2-member cluster", () => {
  const articles = [
    { id: 1, feedId: "feed1", publishedAt: 1000 },
    { id: 2, feedId: "feed2", publishedAt: 1500 },
    { id: 3, feedId: "feed3", publishedAt: 2000 },
  ]
  const pairScores = [{ articleAId: 1, articleBId: 2, score: 0.8 }]

  const clusters = runP3Clustering(articles, pairScores, { threshold: 0.5 })

  // 1 and 2 form a cluster, 3 is a singleton
  const c12 = clusters.find((c) => c.includes(1))
  assert.ok(c12)
  assert.deepEqual(c12.toSorted(), [1, 2])

  const c3 = clusters.find((c) => c.includes(3))
  assert.deepEqual(c3, [3])
  assert.equal(clusters.length, 2)
})

test("P3: multi-member fixture (clique) forms 3-member cluster", () => {
  // A-B positive, A-C positive, B-C positive -> ABC cluster
  const articles = [
    { id: "A", feedId: "feed1", publishedAt: 1000 },
    { id: "B", feedId: "feed2", publishedAt: 1500 },
    { id: "C", feedId: "feed3", publishedAt: 2000 },
  ]
  const pairScores = [
    { articleAId: "A", articleBId: "B", score: 0.9 },
    { articleAId: "A", articleBId: "C", score: 0.85 },
    { articleAId: "B", articleBId: "C", score: 0.8 },
  ]

  const clusters = runP3Clustering(articles, pairScores, { threshold: 0.5 })
  assert.equal(clusters.length, 1)
  assert.deepEqual(clusters[0].toSorted(), ["A", "B", "C"])
})

test("P3: transitive bridge fixture (A-B, B-C, no A-C) does NOT form ABC", () => {
  // A-B positive, B-C positive, A-C missing/negative
  const articles = [
    { id: "A", feedId: "feed1", publishedAt: 1000 },
    { id: "B", feedId: "feed2", publishedAt: 1500 },
    { id: "C", feedId: "feed3", publishedAt: 2000 },
  ]
  const pairScores = [
    { articleAId: "A", articleBId: "B", score: 0.9 },
    { articleAId: "B", articleBId: "C", score: 0.8 },
    // A-C is missing!
  ]

  const clusters = runP3Clustering(articles, pairScores, { threshold: 0.5 })

  // A and B form cluster, C cannot join because it only has 1 edge to AB (multi-member support requires >= 2)
  const cAB = clusters.find((c) => c.includes("A"))
  assert.deepEqual(cAB.toSorted(), ["A", "B"])

  const cC = clusters.find((c) => c.includes("C"))
  assert.deepEqual(cC, ["C"])
  assert.equal(clusters.length, 2)
})

test("P3: multi-cluster bridge fixture (AB and CD, bridge B-C) prevents cluster merging", () => {
  // A-B positive (0.9), C-D positive (0.85), bridge B-C positive (0.7)
  const articles = [
    { id: "A", feedId: "f1", publishedAt: 1000 },
    { id: "B", feedId: "f2", publishedAt: 1500 },
    { id: "C", feedId: "f3", publishedAt: 2000 },
    { id: "D", feedId: "f4", publishedAt: 2500 },
  ]
  const pairScores = [
    { articleAId: "A", articleBId: "B", score: 0.9 },
    { articleAId: "C", articleBId: "D", score: 0.85 },
    { articleAId: "B", articleBId: "C", score: 0.7 },
  ]

  const clusters = runP3Clustering(articles, pairScores, { threshold: 0.5 })

  // AB and CD must remain separate clusters
  assert.equal(clusters.length, 2)
  const cAB = clusters.find((c) => c.includes("A"))
  const cCD = clusters.find((c) => c.includes("C"))
  assert.deepEqual(cAB.toSorted(), ["A", "B"])
  assert.deepEqual(cCD.toSorted(), ["C", "D"])
})

test("P3: temporal fixtures (23h eligible vs 25h rejected)", () => {
  // Delta = 23h (<= 24h) -> eligible
  const eligibleArticles = [
    { id: 1, feedId: "f1", publishedAt: 0 },
    { id: 2, feedId: "f2", publishedAt: 23 * 3600 },
  ]
  const eligiblePairs = [{ articleAId: 1, articleBId: 2, score: 0.9 }]
  const res23 = runP3Clustering(eligibleArticles, eligiblePairs, {
    maxTemporalSpanHours: 24,
  })
  assert.equal(res23.length, 1)
  assert.deepEqual(res23[0].toSorted(), [1, 2])

  // Delta = 25h (> 24h) -> rejected
  const rejectedArticles = [
    { id: 10, feedId: "f1", publishedAt: 0 },
    { id: 20, feedId: "f2", publishedAt: 25 * 3600 },
  ]
  const rejectedPairs = [{ articleAId: 10, articleBId: 20, score: 0.9 }]
  const res25 = runP3Clustering(rejectedArticles, rejectedPairs, {
    maxTemporalSpanHours: 24,
  })
  assert.equal(res25.length, 2) // Remains singletons
})

test("P3: cluster size bound respects maxClusterSize", () => {
  // Create 11 articles all mutually connected (complete graph)
  const count = 11
  const articles = []
  for (let i = 1; i <= count; i++) {
    articles.push({ id: i, feedId: `feed_${i}`, publishedAt: 1000 + i * 10 })
  }

  const pairScores = []
  for (let i = 1; i <= count; i++) {
    for (let j = i + 1; j <= count; j++) {
      pairScores.push({ articleAId: i, articleBId: j, score: 0.9 })
    }
  }

  const clusters = runP3Clustering(articles, pairScores, {
    maxClusterSize: 10,
    threshold: 0.5,
  })

  const mainCluster = clusters.find((c) => c.length > 1)
  assert.ok(mainCluster)
  assert.equal(mainCluster.length, 10, "Cluster size must not exceed maxClusterSize 10")

  // Exactly 1 article cannot join the full cluster and remains a singleton
  const singletons = clusters.filter((c) => c.length === 1)
  assert.equal(singletons.length, 1)
})

test("P3: unknown feed and same-feed articles are rejected", () => {
  const articles = [
    { id: 1, feedId: "feedA", publishedAt: 1000 },
    { id: 2, feedId: "feedA", publishedAt: 1000 }, // Same feed as 1
    { id: 3, feedId: "", publishedAt: 1000 }, // Unknown feed
    { id: 4, feedId: "feedB", publishedAt: 1000 }, // Distinct known feed
  ]

  const pairScores = [
    { articleAId: 1, articleBId: 2, score: 0.95 }, // Same feed -> rejected
    { articleAId: 1, articleBId: 3, score: 0.95 }, // Unknown feed -> rejected
    { articleAId: 1, articleBId: 4, score: 0.95 }, // Valid cross-feed -> accepted
  ]

  const clusters = runP3Clustering(articles, pairScores, {
    requireCrossFeed: true,
    requireKnownFeeds: true,
  })

  const c14 = clusters.find((c) => c.includes(1))
  assert.deepEqual(c14.toSorted(), [1, 4])

  const c2 = clusters.find((c) => c.includes(2))
  assert.deepEqual(c2, [2])

  const c3 = clusters.find((c) => c.includes(3))
  assert.deepEqual(c3, [3])
})
