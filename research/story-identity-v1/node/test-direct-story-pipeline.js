/**
 * Test Suite for Node.js D0 Direct Story Pipeline.
 *
 * Verifies:
 * 1. Token extraction parity against Python specifications.
 * 2. Multilingual, accented, and edge case token normalization.
 * 3. Overlap coefficient calculation precision.
 * 4. Inverted index lexical candidate retrieval.
 * 5. P3 conservative clustering invariants (multi-member support, temporal gating, cluster bridging block).
 * 6. StoryProjection and H1 ranking preservation placement.
 * 7. Fail-open execution contract.
 * 8. Zero-model verification (no learned weights, no scalers, no native containers).
 */

import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import {
  benchmarkPipeline,
  clusterWithP3,
  computeOverlapCoefficient,
  executeD0Pipeline,
  extractSignificantWords,
  getFeedIdentity,
  normalizeTitle,
  projectStories,
  R3_P3_MAX_TEMPORAL_SPAN_HOURS,
  retrieveCandidatesRF0R,
  STOPWORDS,
} from "./direct-story-pipeline.js"

const CORPUS_PATH = "/Users/jfsdias/NewsFlux-STORY00/private-p4/20261023-220212/home-200.jsonl"

function testTokenExtractionEdgeCases() {
  console.log("Testing Token Extraction Edge Cases...")

  // Empty or null
  assert.equal(extractSignificantWords("").size, 0)
  assert.equal(extractSignificantWords(null).size, 0)
  assert.equal(extractSignificantWords().size, 0)

  // Single characters excluded
  const single = extractSignificantWords("a b c d e f g")
  assert.equal(single.size, 0)

  // Pure digits excluded
  const digits = extractSignificantWords("123 4567 890 2026")
  assert.equal(digits.size, 0)

  // Alphanumeric preserved
  const mixed = extractSignificantWords("qwen3 gpt4 b0")
  assert.deepEqual([...mixed].toSorted(), ["b0", "gpt4", "qwen3"])

  // Stopwords excluded
  const stopwords = extractSignificantWords("sobre o que foi para com the with from")
  assert.equal(stopwords.size, 0)

  // Accented Portuguese words preserved (and stopword 'são' excluded)
  const accented = extractSignificantWords(
    "Operação da Polícia Federal investiga corrupção em Brasília",
  )
  assert.ok(accented.has("operação"))
  assert.ok(accented.has("polícia"))
  assert.ok(accented.has("federal"))
  assert.ok(accented.has("investiga"))
  assert.ok(accented.has("corrupção"))
  assert.ok(accented.has("brasília"))
  assert.ok(!accented.has("da")) // stopword
  assert.ok(!accented.has("em")) // stopword

  // Feed title tokens excluded
  const withFeed = extractSignificantWords("G1 Notícias: Tempestade atinge litoral", "G1 Notícias")
  assert.ok(!withFeed.has("notícias"))
  assert.ok(withFeed.has("tempestade"))
  assert.ok(withFeed.has("atinge"))
  assert.ok(withFeed.has("litoral"))

  console.log("  PASS: Token extraction edge cases verified.")
}

function testOverlapCoefficient() {
  console.log("Testing Overlap Coefficient Calculation...")

  assert.equal(computeOverlapCoefficient(new Set(), new Set(["a"])), 0)
  assert.equal(computeOverlapCoefficient(new Set(["a"]), new Set()), 0)

  const setA = new Set(["lula", "haddad", "fazenda", "reforma"])
  const setB = new Set(["lula", "fazenda", "brasilia", "congresso", "senado"])
  // Intersection = {lula, fazenda} (size 2). Min size = min(4, 5) = 4. Overlap = 2/4 = 0.5.
  assert.equal(computeOverlapCoefficient(setA, setB), 0.5)

  // Identical sets
  assert.equal(computeOverlapCoefficient(setA, setA), 1)

  // Disjoint sets
  const setC = new Set(["futebol", "flamengo", "vasco"])
  assert.equal(computeOverlapCoefficient(setA, setC), 0)

  console.log("  PASS: Overlap coefficient calculations verified.")
}

function testFeedIdentity() {
  console.log("Testing Feed Identity Extraction...")

  assert.equal(getFeedIdentity({ feed_id: 42 }), "42")
  assert.equal(getFeedIdentity({ feed: { id: 99 } }), "99")
  assert.equal(getFeedIdentity({ feed: "TechCrunch" }), "TechCrunch")
  assert.equal(getFeedIdentity({ feed: 123 }), "123")
  assert.equal(getFeedIdentity({ feed_title: "BBC News" }), "BBC News")
  assert.equal(getFeedIdentity({}), "")
  assert.equal(getFeedIdentity(null), "")

  console.log("  PASS: Feed identity extraction verified.")
}

function testCrossFeedOnlyContract() {
  console.log("Testing Cross-Feed Only Contract...")

  const articles = [
    { id: 1, feed_id: 10, title: "OpenAI launches new GPT-5 model today" },
    { id: 2, feed_id: 10, title: "OpenAI launches new GPT-5 model today" }, // SAME FEED as 1
    { id: 3, feed_id: 20, title: "OpenAI launches new GPT-5 model today" }, // CROSS FEED
  ]

  const tokensMap = new Map()
  for (const a of articles) {
    tokensMap.set(Number(a.id), extractSignificantWords(a.title))
  }

  const { candidatePairs } = retrieveCandidatesRF0R(articles, tokensMap, 10)

  // 1 and 2 are in the same feed -> pair 1_2 MUST NOT be retrieved
  assert.ok(!candidatePairs.has("1_2"), "Same feed pair 1_2 must NOT be retrieved")

  // 1 and 3 are in different feeds -> pair 1_3 MUST be retrieved
  assert.ok(candidatePairs.has("1_3"), "Cross feed pair 1_3 must be retrieved")

  // 2 and 3 are in different feeds -> pair 2_3 MUST be retrieved
  assert.ok(candidatePairs.has("2_3"), "Cross feed pair 2_3 must be retrieved")

  console.log("  PASS: Cross-feed only contract verified.")
}

function testUnknownFeedContract() {
  console.log("Testing Unknown Feed Contract (UNKNOWN_FEED_NOT_ELIGIBLE)...")

  const articles = [
    { id: 1, feed_id: 10, title: "Breaking technology announcement today" },
    { id: 2, feed_id: "", title: "Breaking technology announcement today" }, // Unknown feed
    { id: 3, feed: null, title: "Breaking technology announcement today" }, // Unknown feed
    { id: 4, feed_id: 20, title: "Breaking technology announcement today" }, // Known feed (different)
  ]

  const tokensMap = new Map()
  for (const a of articles) {
    tokensMap.set(Number(a.id), extractSignificantWords(a.title))
  }

  const { candidatePairs } = retrieveCandidatesRF0R(articles, tokensMap, 10)

  // 1 (known) and 2 (unknown) -> MUST NOT be retrieved
  assert.ok(!candidatePairs.has("1_2"), "Pair 1_2 (known vs unknown) must NOT be retrieved")
  // 1 (known) and 3 (unknown) -> MUST NOT be retrieved
  assert.ok(!candidatePairs.has("1_3"), "Pair 1_3 (known vs unknown) must NOT be retrieved")
  // 2 (unknown) and 3 (unknown) -> MUST NOT be retrieved
  assert.ok(!candidatePairs.has("2_3"), "Pair 2_3 (unknown vs unknown) must NOT be retrieved")
  // 2 (unknown) and 4 (known) -> MUST NOT be retrieved
  assert.ok(!candidatePairs.has("2_4"), "Pair 2_4 (unknown vs known) must NOT be retrieved")
  // 1 (feed 10) and 4 (feed 20) -> MUST be retrieved
  assert.ok(candidatePairs.has("1_4"), "Pair 1_4 (known distinct feeds) must be retrieved")

  console.log("  PASS: Unknown feed contract verified.")
}

function testSymmetricPerArticleTopKAndHigherId() {
  console.log("Testing Symmetric Per-Article Top-K & Higher-ID Selection...")

  // Case: article 100 has a higher numeric ID than article 1.
  // Under the old "otherAid > aid" logic, article 100 could never select article 1.
  // Under RF0R, article 100 ranks all cross-feed candidates and selects article 1 as top neighbor.
  const articles = [
    { id: 1, feed_id: 1, title: "Apple unveils new M4 MacBook Pro with OLED display" },
    { id: 100, feed_id: 2, title: "Apple unveils new M4 MacBook Pro with OLED display" },
    { id: 200, feed_id: 3, title: "Totally unrelated story about agriculture and farming" },
  ]

  const tokensMap = new Map()
  for (const a of articles) {
    tokensMap.set(Number(a.id), extractSignificantWords(a.title))
  }

  const { candidatePairs, pairScores } = retrieveCandidatesRF0R(articles, tokensMap, 5)

  // Pair 1_100 must be retrieved
  assert.ok(
    candidatePairs.has("1_100"),
    "Article 100 must select Article 1 and form canonical pair 1_100",
  )
  assert.ok(pairScores.has("1_100"))
  assert.equal(pairScores.get("1_100"), 1)

  // Article 200 shares no tokens with 1 or 100
  assert.ok(!candidatePairs.has("1_200"))
  assert.ok(!candidatePairs.has("100_200"))

  console.log("  PASS: Symmetric per-article top-K and higher-ID selection verified.")
}

function testP3ConservativeClustering() {
  console.log("Testing P3 Conservative Clustering Rules...")

  const articleIds = [101, 102, 103, 104, 201, 202]
  const publishedLookup = {
    101: 1000,
    102: 1500,
    103: 2000,
    104: 3000,
    201: 5000,
    202: 5500,
  }

  // Pair scores:
  // 101 - 102: 0.85 (strong)
  // 102 - 103: 0.80 (strong)
  // 101 - 103: 0.75 (strong) -> 101, 102, 103 form a 3-member cluster
  // 201 - 202: 0.70 (separate cluster)
  // 102 - 201: 0.65 (cross-cluster bridge after both formed) -> MUST BE PREVENTED
  // 101 - 104: 0.55 (above threshold 0.50), but 102 - 104 = 0.10, 103 - 104 = 0.10 (only 1 positive edge) -> 104 REJECTED
  const pairScores = new Map([
    ["101_102", 0.85],
    ["102_103", 0.8],
    ["101_103", 0.75],
    ["201_202", 0.7],
    ["102_201", 0.65],
    ["101_104", 0.55],
    ["102_104", 0.1],
    ["103_104", 0.1],
  ])

  const threshold = 0.5
  const clusters = clusterWithP3(articleIds, pairScores, threshold, publishedLookup)

  const cluster101 = clusters.find((c) => c.includes(101))
  assert.ok(cluster101, "Cluster with 101 must exist")
  assert.ok(cluster101.includes(102), "102 must be in cluster")
  assert.ok(
    cluster101.includes(103),
    "103 must be in cluster (multi-member support >= 2 satisfied)",
  )
  assert.ok(
    !cluster101.includes(104),
    "104 must NOT be in cluster (only 1 positive edge, multi-member violated)",
  )
  assert.ok(!cluster101.includes(201), "Cluster bridging must be prevented")

  const cluster201 = clusters.find((c) => c.includes(201))
  assert.ok(cluster201.includes(202), "201 and 202 must form their own cluster")
  assert.ok(!cluster201.includes(102), "201 must not merge with 102 cluster")

  const cluster104 = clusters.find((c) => c.includes(104))
  assert.equal(cluster104.length, 1, "104 must remain a singleton")

  // Temporal span test under R3 24h policy (RESEARCH_POLICY_24H):
  // 1. Delta = 25h (> 24h) -> REJECTED
  const tempArticleIds25 = [301, 302]
  const tempLookup25 = {
    301: 0,
    302: 25 * 3600, // 25 hours later
  }
  const tempScores25 = new Map([["301_302", 0.95]])
  const tempClusters25 = clusterWithP3(tempArticleIds25, tempScores25, threshold, tempLookup25, {
    maxTemporalSpanHours: R3_P3_MAX_TEMPORAL_SPAN_HOURS,
  })
  assert.equal(
    tempClusters25.length,
    2,
    "Temporal span delta = 25h must reject clustering under 24h policy",
  )

  // 2. Delta = 23h (<= 24h) -> ACCEPTED
  const tempArticleIds23 = [401, 402]
  const tempLookup23 = {
    401: 0,
    402: 23 * 3600, // 23 hours later
  }
  const tempScores23 = new Map([["401_402", 0.95]])
  const tempClusters23 = clusterWithP3(tempArticleIds23, tempScores23, threshold, tempLookup23, {
    maxTemporalSpanHours: R3_P3_MAX_TEMPORAL_SPAN_HOURS,
  })
  assert.equal(
    tempClusters23.length,
    1,
    "Temporal span delta = 23h must be eligible for clustering",
  )
  assert.equal(tempClusters23[0].length, 2)

  console.log("  PASS: P3 conservative clustering rules and 24h temporal policy verified.")
}

function testStoryProjectionAndPlacement() {
  console.log("Testing StoryProjection and H1 Placement...")

  const clusters = [
    [103, 101, 102], // 3-member cluster
    [202, 201], // 2-member cluster
    [301], // singleton
  ]

  // Home feed order: 301 is at pos 0, 102 is at pos 1, 201 is at pos 2, etc.
  const homeOrder = [301, 102, 201, 101, 202, 103]

  const pairScores = new Map([
    ["101_102", 0.8],
    ["101_103", 0.6],
    ["102_103", 0.9], // 102 has highest sum to others (0.8 + 0.9 = 1.7) -> medoid representative
    ["201_202", 0.85],
  ])

  const projections = projectStories(clusters, pairScores, homeOrder)

  assert.equal(projections.length, 3)

  // Position check:
  // 301 is pos 0 -> first projection
  // 101/102/103 min pos is 1 (article 102) -> second projection
  // 201/202 min pos is 2 (article 201) -> third projection
  assert.equal(projections[0].representative_article_id, 301)
  assert.equal(projections[0].h1_home_position, 0)

  assert.equal(projections[1].representative_article_id, 102)
  assert.equal(projections[1].h1_home_position, 1)
  assert.deepEqual(projections[1].alternative_article_ids.toSorted(), [101, 103])

  assert.equal(projections[2].h1_home_position, 2)

  // Determinism check: running again produces identical story_id hashes
  const projections2 = projectStories(clusters, pairScores, homeOrder)
  assert.equal(projections[1].story_id, projections2[1].story_id)

  console.log("  PASS: StoryProjection and H1 placement verified.")
}

function testFailOpenContract() {
  console.log("Testing Fail-Open Contract...")

  // Empty articles
  const emptyRes = executeD0Pipeline([])
  assert.equal(emptyRes.projections.length, 0)
  assert.equal(emptyRes.stats.home_items_before, 0)

  // Malformed articles that might cause null property access
  const malformed = [
    { id: 999 }, // missing title, published_at, feed
    { id: 1000, title: "Valid Title Here" },
  ]
  const safeRes = executeD0Pipeline(malformed)
  assert.equal(safeRes.projections.length, 2)
  assert.ok(safeRes.projections[0].story_id)
  assert.ok(safeRes.projections[1].story_id)

  console.log("  PASS: Fail-open contract verified.")
}

function testZeroModelVerification() {
  console.log("Testing Zero-Model Verification...")

  const codePath = path.resolve("scripts/research/story-identity-v1/node/direct-story-pipeline.js")
  const code = fs.readFileSync(codePath, "utf8")

  // Ensure no ML artifacts, pickle, joblib, onnx, or model weights are loaded
  assert.ok(!code.includes("joblib"), "No joblib allowed")
  assert.ok(!code.includes("pickle"), "No pickle allowed")
  assert.ok(!code.includes("onnx"), "No onnx allowed")
  assert.ok(!code.includes("weights"), "No weights allowed")
  assert.ok(!code.includes("StandardScaler"), "No scaler allowed")
  assert.ok(!code.includes("LogisticRegression"), "No learned classifier allowed")

  console.log("  PASS: Zero-model constraint verified.")
}

function testCorpusParityIfAvailable() {
  if (!fs.existsSync(CORPUS_PATH)) {
    console.log(`Corpus file not found at ${CORPUS_PATH}, skipping corpus parity test.`)
    return
  }

  console.log("Testing Corpus Token Extraction & Full Pipeline on Home-200...")
  const lines = fs.readFileSync(CORPUS_PATH, "utf8").trim().split("\n")
  const articles = lines.map((l) => JSON.parse(l))

  assert.equal(articles.length, 200)

  // Execute full pipeline under cross-feed only contract
  const res = executeD0Pipeline(articles, { threshold: 0.3541 })
  assert.ok(res.projections.length > 0)
  assert.equal(res.stats.home_items_before, 200)
  assert.equal(res.stats.home_items_after, 180)
  assert.equal(res.stats.multi_article_story_count, 12)
  assert.equal(res.stats.duplicate_articles_compressed, 20)
  assert.equal(res.stats.noise_reduction_percent, 10)

  // Card count positions in top windows
  assert.equal(res.stats.top10_story_card_count, 1)
  assert.equal(res.stats.top20_story_card_count, 1)
  assert.equal(res.stats.top50_story_card_count, 6)
  assert.equal(res.stats.top100_story_card_count, 10)

  console.log(
    `  Pipeline executed on 200 articles in ${res.timingBreakdown.total_end_to_end_ms} ms`,
  )
  console.log(
    `  Projections: ${res.projections.length}, Multi-stories: ${res.stats.multi_article_story_count}`,
  )

  // Benchmark multi-size
  const bench = benchmarkPipeline(articles, [25, 50, 100, 200], 3, { threshold: 0.3541 })
  console.log("  Benchmark results:", JSON.stringify(bench, null, 2))

  console.log("  PASS: Corpus execution and benchmark verified under cross-feed contract.")
}

function testNodeCryptographicParity() {
  if (!fs.existsSync(CORPUS_PATH)) {
    console.log(`Corpus file not found at ${CORPUS_PATH}, skipping cryptographic parity test.`)
    return
  }

  console.log("Testing Node.js Cryptographic 4-Way Parity on Home-200...")
  const lines = fs.readFileSync(CORPUS_PATH, "utf8").trim().split("\n")
  const articles = lines.map((l) => JSON.parse(l))

  const res = executeD0Pipeline(articles, { threshold: 0.3541 })

  // 1. Candidate Set SHA256 (newline-joined sorted keys)
  const sortedCands = [...res.candidatePairs].toSorted()
  const candidateSetSha = crypto.createHash("sha256").update(sortedCands.join("\n")).digest("hex")
  assert.equal(
    candidateSetSha,
    "5a3d36d6f1cbc2341be511bdb72c7a8eaddab8b90f86b86f35c1f18431fb7fd2",
    "Candidate Set SHA must match canonical hash",
  )

  // 2. Pair Score SHA256 (newline-joined sorted key,score lines)
  const scoreKeys = [...res.pairScores.keys()].toSorted()
  const scoreLines = scoreKeys.map((k) => `${k},${res.pairScores.get(k).toFixed(4)}`)
  const pairScoreSha = crypto.createHash("sha256").update(scoreLines.join("\n")).digest("hex")
  assert.equal(
    pairScoreSha,
    "e58557dbf79266e1aa448c0356f1f852ab7f1aa73721bacaadb65e8616f4e4b9",
    "Pair Score SHA must match canonical hash",
  )

  // 3. Cluster Membership SHA256
  const canonicalClusters = res.clusters.map((c) => c.toSorted((a, b) => a - b))
  const sortedClusters = canonicalClusters.toSorted((a, b) => {
    if (a[0] !== b[0]) {
      return a[0] - b[0]
    }
    return a.length - b.length
  })
  const clusterSha = crypto
    .createHash("sha256")
    .update(JSON.stringify(sortedClusters))
    .digest("hex")
  assert.equal(
    clusterSha,
    "0f695257fa3f8260eed113ad378e3212a8f74637e7897ccca87532b90ac15c52",
    "Cluster Membership SHA must match canonical hash",
  )

  // 4. Story Projection Semantic SHA256
  const semanticProj = res.projections.map((p) => ({
    story_id: p.story_id,
    member_article_ids: p.member_article_ids.toSorted((a, b) => a - b),
    representative_article_id: p.representative_article_id,
    h1_home_position: p.h1_home_position,
  }))
  const semanticProjSorted = semanticProj.toSorted((a, b) => {
    if (a.h1_home_position !== b.h1_home_position) {
      return a.h1_home_position - b.h1_home_position
    }
    return a.story_id.localeCompare(b.story_id)
  })
  const projSha = crypto
    .createHash("sha256")
    .update(JSON.stringify(semanticProjSorted))
    .digest("hex")
  assert.equal(
    projSha,
    "0b8bc7bf3ab2ded2525e0e726160cf10cf9957e56bdbde52f396e0f5a941318a",
    "Story Projection Semantic SHA must match canonical hash",
  )

  console.log("  PASS: All 4 cryptographic SHA256 hashes match canonical benchmarks perfectly.")
}

function runAllTests() {
  console.log("========================================================")
  console.log("Running Node.js Direct Story Pipeline Unit Tests (R4)")
  console.log("========================================================")

  testTokenExtractionEdgeCases()
  testOverlapCoefficient()
  testFeedIdentity()
  testCrossFeedOnlyContract()
  testUnknownFeedContract()
  testSymmetricPerArticleTopKAndHigherId()
  testP3ConservativeClustering()
  testStoryProjectionAndPlacement()
  testFailOpenContract()
  testZeroModelVerification()
  testCorpusParityIfAvailable()
  testNodeCryptographicParity()

  console.log("========================================================")
  console.log("ALL NODE.JS PIPELINE TESTS PASSED SUCCESSFULLY")
  console.log("========================================================")
}

runAllTests()
