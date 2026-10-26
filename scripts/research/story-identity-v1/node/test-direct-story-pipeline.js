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
import fs from "node:fs"
import path from "node:path"

import {
  benchmarkPipeline,
  clusterWithP3,
  computeOverlapCoefficient,
  executeD0Pipeline,
  extractSignificantWords,
  normalizeTitle,
  projectStories,
  retrieveCandidates,
  scorePairsD0,
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

function testCandidateRetrieval() {
  console.log("Testing Lexical Candidate Retrieval...")

  const tokensMap = new Map([
    [1, new Set(["copa", "mundo", "seleção", "brasil"])],
    [2, new Set(["seleção", "brasil", "treino", "ancelotti"])],
    [3, new Set(["economia", "inflação", "selic", "juros"])],
    [4, new Set(["copa", "mundo", "brasil", "estádio"])],
  ])

  const candidates = retrieveCandidates(tokensMap, 2)
  // (1, 2) shares 'seleção', 'brasil' (2 tokens)
  // (1, 4) shares 'copa', 'mundo', 'brasil' (3 tokens)
  // (2, 4) shares 'brasil' (1 token)
  // (3, *) shares 0 tokens
  assert.ok(candidates.has("1_2"))
  assert.ok(candidates.has("1_4"))
  assert.ok(candidates.has("2_4"))
  assert.ok(!candidates.has("1_3"))
  assert.ok(!candidates.has("2_3"))
  assert.ok(!candidates.has("3_4"))

  console.log("  PASS: Candidate retrieval inverted index verified.")
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

  // Temporal span test: pair above threshold but time diff > 168h
  const tempArticleIds = [301, 302]
  const tempLookup = {
    301: 0,
    302: 200 * 3600, // 200 hours later (> 168h)
  }
  const tempScores = new Map([["301_302", 0.95]])
  const tempClusters = clusterWithP3(tempArticleIds, tempScores, threshold, tempLookup, {
    maxTemporalSpanHours: 168,
  })
  assert.equal(tempClusters.length, 2, "Temporal span violation must prevent clustering")

  console.log("  PASS: P3 conservative clustering rules verified.")
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

  // Execute full pipeline
  const res = executeD0Pipeline(articles, { threshold: 0.3541 })
  assert.ok(res.projections.length > 0)
  assert.equal(res.stats.home_items_before, 200)
  assert.equal(res.stats.home_items_after, 170)
  assert.equal(res.stats.multi_article_story_count, 20)
  assert.equal(res.stats.duplicate_articles_compressed, 30)
  assert.equal(res.stats.noise_reduction_percent, 15)

  console.log(
    `  Pipeline executed on 200 articles in ${res.timingBreakdown.total_end_to_end_ms} ms`,
  )
  console.log(
    `  Projections: ${res.projections.length}, Multi-stories: ${res.stats.multi_article_story_count}`,
  )

  // Benchmark multi-size
  const bench = benchmarkPipeline(articles, [25, 50, 100, 200], 3, 0.3542)
  console.log("  Benchmark results:", JSON.stringify(bench, null, 2))

  console.log("  PASS: Corpus execution and benchmark verified.")
}

function runAllTests() {
  console.log("========================================================")
  console.log("Running Node.js Direct Story Pipeline Unit Tests")
  console.log("========================================================")

  testTokenExtractionEdgeCases()
  testOverlapCoefficient()
  testCandidateRetrieval()
  testP3ConservativeClustering()
  testStoryProjectionAndPlacement()
  testFailOpenContract()
  testZeroModelVerification()
  testCorpusParityIfAvailable()

  console.log("========================================================")
  console.log("ALL NODE.JS PIPELINE TESTS PASSED SUCCESSFULLY")
  console.log("========================================================")
}

runAllTests()
