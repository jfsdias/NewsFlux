/**
 * STORY-02-A0 R2: Direct Pair Scorer Pipeline in Node.js.
 *
 * Implements the D0_TITLE_OVERLAP_DIRECT executable pipeline in vanilla Node.js:
 * 1. extractSignificantWords: zero-model lexical token extraction.
 * 2. computeOverlapCoefficient: pure set overlap metric.
 * 3. Inverted index lexical candidate retrieval (top-K).
 * 4. Direct D0 pair scoring.
 * 5. Conservative P3 clustering with multi-member support and temporal gating.
 * 6. Representative selection (medoid) & H1 ranking preservation placement.
 *
 * Constraints:
 * - Zero models, zero containers, zero native compilation, zero external libraries.
 * - Score provider contract: synchronous or asynchronous, fail-open.
 * - 100% deterministic: identical inputs produce identical outputs and identical SHA256 hashes.
 */

import crypto from "node:crypto"

export const STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren",
  "as",
  "at",
  "até",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "cannot",
  "com",
  "como",
  "could",
  "d",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "does",
  "doing",
  "don",
  "down",
  "during",
  "each",
  "em",
  "en",
  "entre",
  "era",
  "essa",
  "esse",
  "essas",
  "esses",
  "esta",
  "este",
  "estas",
  "estes",
  "eu",
  "few",
  "foi",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "há",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isn",
  "isso",
  "isto",
  "it",
  "its",
  "itself",
  "ja",
  "já",
  "la",
  "le",
  "les",
  "mais",
  "me",
  "more",
  "most",
  "muito",
  "my",
  "myself",
  "na",
  "nas",
  "no",
  "nor",
  "nos",
  "not",
  "num",
  "numa",
  "nuns",
  "numas",
  "o",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "os",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "pra",
  "pro",
  "qual",
  "quando",
  "que",
  "quem",
  "s",
  "same",
  "se",
  "sem",
  "ser",
  "seu",
  "seus",
  "she",
  "should",
  "so",
  "some",
  "sobre",
  "sua",
  "suas",
  "such",
  "são",
  "t",
  "tem",
  "ter",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "um",
  "uma",
  "umas",
  "uns",
  "under",
  "until",
  "up",
  "very",
  "você",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
])

const TOKEN_REGEX = /[a-zA-Z0-9_\u00C0-\u00FF]{2,}/g

/**
 * Normalizes title by lowercasing and replacing non-alphanumeric chars with spaces.
 */
export function normalizeTitle(title) {
  if (!title) {
    return ""
  }
  const t = String(title)
    .toLowerCase()
    .replaceAll(/[^\w\s]/g, " ")
  return t.trim().replaceAll(/\s+/g, " ")
}

/**
 * Extracts significant words (>=2 chars), excluding pure numbers, stopwords, and feed title tokens.
 * Matches Python extract_significant_words exactly.
 */
export function extractSignificantWords(title, feedTitle = "") {
  if (!title) {
    return new Set()
  }

  const titleLower = String(title).toLowerCase()
  const rawMatches = titleLower.match(TOKEN_REGEX) || []

  let feedWords = new Set()
  if (feedTitle) {
    const feedLower = String(feedTitle).toLowerCase()
    const feedMatches = feedLower.match(TOKEN_REGEX) || []
    feedWords = new Set(feedMatches)
  }

  const result = new Set()
  for (const token of rawMatches) {
    if (!/^\d+$/.test(token) && !STOPWORDS.has(token) && !feedWords.has(token)) {
      result.add(token)
    }
  }

  return result
}

/**
 * Computes overlap coefficient: |A n B| / min(|A|, |B|).
 */
export function computeOverlapCoefficient(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) {
    return 0
  }
  const smallerSize = Math.min(setA.size, setB.size)
  if (smallerSize === 0) {
    return 0
  }

  let intersectionCount = 0
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA]

  for (const item of smaller) {
    if (larger.has(item)) {
      intersectionCount++
    }
  }

  return intersectionCount / smallerSize
}

/**
 * Builds inverted index mapping token -> article IDs.
 */
export function buildInvertedIndex(articleTokens) {
  const index = new Map()
  for (const [aid, tokens] of articleTokens.entries()) {
    for (const token of tokens) {
      let list = index.get(token)
      if (!list) {
        list = []
        index.set(token, list)
      }
      list.push(aid)
    }
  }
  return index
}

/**
 * Retrieves candidate pairs via inverted index token matching (top K shared tokens).
 */
export function retrieveCandidates(articleTokens, kRetrieval = 20) {
  const invertedIndex = buildInvertedIndex(articleTokens)
  const candidatePairs = new Set()

  for (const [aid, tokens] of articleTokens.entries()) {
    const counts = new Map()
    for (const token of tokens) {
      const posting = invertedIndex.get(token)
      if (posting) {
        for (const otherAid of posting) {
          if (otherAid > aid) {
            counts.set(otherAid, (counts.get(otherAid) || 0) + 1)
          }
        }
      }
    }

    if (counts.size > 0) {
      const sortedEntries = [...counts.entries()].toSorted((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1]
        }
        return a[0] - b[0]
      })
      const topK = sortedEntries.slice(0, kRetrieval)
      for (const [otherAid] of topK) {
        candidatePairs.add(`${aid}_${otherAid}`)
      }
    }
  }

  return candidatePairs
}

/**
 * Scores candidate pairs using D0 title overlap coefficient.
 */
export function scorePairsD0(candidatePairs, articleTokens) {
  const pairScores = new Map()
  for (const pairKey of candidatePairs) {
    const [uStr, vStr] = pairKey.split("_")
    const u = Number(uStr)
    const v = Number(vStr)
    const tokensU = articleTokens.get(u) || new Set()
    const tokensV = articleTokens.get(v) || new Set()
    const coef = computeOverlapCoefficient(tokensU, tokensV)
    pairScores.set(pairKey, Math.round(coef * 10_000) / 10_000)
  }
  return pairScores
}

/**
 * P3 Conservative Clustering.
 *
 * Rules:
 * - Edges sorted descending by score, then u, then v.
 * - Max cluster size enforcement (default 10).
 * - Max temporal span enforcement (default 168 hours).
 * - Multi-member rule: candidate joining an existing cluster of size >= 2 must have
 *   at least 2 positive edges (score >= threshold) to existing members.
 * - No cluster-to-cluster bridging.
 * - Singletons preserved.
 */
export function clusterWithP3(
  articleIds,
  pairScores,
  threshold = 0.3542,
  publishedLookup = {},
  options = {},
) {
  const { maxSize = 10, maxTemporalSpanHours = 168 } = options

  const sortedIds = [...articleIds].toSorted((a, b) => a - b)
  const articleSet = new Set(sortedIds)

  const rawEdges = []
  for (const [pairKey, score] of pairScores.entries()) {
    if (score >= threshold) {
      const [uStr, vStr] = pairKey.split("_")
      const u = Number(uStr)
      const v = Number(vStr)
      if (articleSet.has(u) && articleSet.has(v)) {
        rawEdges.push({ score, u: Math.min(u, v), v: Math.max(u, v) })
      }
    }
  }

  // Sort descending by score, then ascending by u, then ascending by v
  const sortedEdges = rawEdges.toSorted((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    if (a.u !== b.u) {
      return a.u - b.u
    }
    return a.v - b.v
  })

  const clusters = []
  const articleToCluster = new Map()

  function getScore(u, v) {
    const k = `${Math.min(u, v)}_${Math.max(u, v)}`
    return pairScores.get(k) || 0
  }

  function canAdd(cIdx, cand) {
    const members = clusters[cIdx]
    if (members.length >= maxSize) {
      return false
    }

    const times = members.map((m) => publishedLookup[m] || 0)
    times.push(publishedLookup[cand] || 0)
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    if (maxTime - minTime > maxTemporalSpanHours * 3600) {
      return false
    }

    if (members.length >= 2) {
      let posCount = 0
      for (const m of members) {
        if (getScore(cand, m) >= threshold) {
          posCount++
        }
      }
      if (posCount < 2) {
        return false
      }
    }

    return true
  }

  for (const edge of sortedEdges) {
    const { u, v } = edge
    const cU = articleToCluster.get(u)
    const cV = articleToCluster.get(v)

    if (cU === undefined && cV === undefined) {
      const tU = publishedLookup[u]
      const tV = publishedLookup[v]
      if (tU !== undefined && tV !== undefined && Math.abs(tU - tV) > maxTemporalSpanHours * 3600) {
        continue
      }
      const cIdx = clusters.length
      clusters.push([u, v])
      articleToCluster.set(u, cIdx)
      articleToCluster.set(v, cIdx)
    } else if (cU !== undefined && cV === undefined) {
      if (canAdd(cU, v)) {
        clusters[cU].push(v)
        articleToCluster.set(v, cU)
      }
    } else if (cU === undefined && cV !== undefined && canAdd(cV, u)) {
      clusters[cV].push(u)
      articleToCluster.set(u, cV)
    }
    // If both are already clustered, P3 does not bridge clusters
  }

  // Append singletons
  for (const aid of sortedIds) {
    if (!articleToCluster.has(aid)) {
      clusters.push([aid])
    }
  }

  return clusters
}

/**
 * Representative selection (R4 Hybrid Medoid) & H1 Ranking Preservation Placement.
 */
export function projectStories(clusters, pairScores, homeOrder) {
  const homeIndexMap = new Map()
  for (const [idx, aid] of homeOrder.entries()) {
    homeIndexMap.set(aid, idx)
  }

  function getScore(u, v) {
    const k = `${Math.min(u, v)}_${Math.max(u, v)}`
    return pairScores.get(k) || 0
  }

  const projections = []

  for (const cluster of clusters) {
    const members = [...cluster].toSorted((a, b) => a - b)
    let representative
    let alternatives = []

    if (members.length === 1) {
      representative = members[0]
    } else {
      let bestRep = members[0]
      let bestSim = -1

      for (const cand of members) {
        let simSum = 0
        for (const m of members) {
          if (m !== cand) {
            simSum += getScore(cand, m)
          }
        }
        if (simSum > bestSim) {
          bestSim = simSum
          bestRep = cand
        }
      }
      representative = bestRep
      alternatives = members.filter((m) => m !== representative)
    }

    const memberPositions = members.map((m) =>
      homeIndexMap.has(m) ? homeIndexMap.get(m) : Infinity,
    )
    const h1Pos = Math.min(...memberPositions)
    const hash = crypto.createHash("sha256").update(members.join(",")).digest("hex").slice(0, 16)

    projections.push({
      story_id: `story_${hash}`,
      representative_article_id: representative,
      alternative_article_ids: alternatives,
      member_article_ids: members,
      member_count: members.length,
      h1_home_position: h1Pos === Infinity ? 0 : h1Pos,
    })
  }

  // Sort projections by H1 position
  return projections.toSorted((a, b) => {
    if (a.h1_home_position !== b.h1_home_position) {
      return a.h1_home_position - b.h1_home_position
    }
    return a.representative_article_id - b.representative_article_id
  })
}

/**
 * Executes full D0 raw pipeline from raw article objects.
 * Fail-open guarantee: If any error occurs, falls back to unclustered singletons.
 */
export function executeD0Pipeline(articles, options = {}) {
  const t0 = performance.now()

  if (!Array.isArray(articles) || articles.length === 0) {
    return {
      projections: [],
      stats: {
        home_items_before: 0,
        home_items_after: 0,
        multi_article_story_count: 0,
        duplicate_articles_compressed: 0,
        noise_reduction_percent: 0,
      },
      timingBreakdown: { total_end_to_end_ms: 0 },
    }
  }

  const threshold = options.threshold ?? 0.3542
  const kRetrieval = options.kRetrieval ?? 20

  try {
    const articleTokens = new Map()
    const publishedLookup = {}
    const feedLookup = {}
    const homeOrder = []

    for (const a of articles) {
      const aid = Number(a.id)
      homeOrder.push(aid)
      publishedLookup[aid] = Number(a.published_at || 0)
      feedLookup[aid] = a.feed_title || a.feed || ""
      articleTokens.set(aid, extractSignificantWords(a.title || "", feedLookup[aid]))
    }
    const t1 = performance.now()

    const candidatePairs = retrieveCandidates(articleTokens, kRetrieval)
    const t2 = performance.now()

    const pairScores = scorePairsD0(candidatePairs, articleTokens)
    const t3 = performance.now()

    const clusters = clusterWithP3(homeOrder, pairScores, threshold, publishedLookup, options)
    const t4 = performance.now()

    const projections = projectStories(clusters, pairScores, homeOrder)
    const t5 = performance.now()

    const multiStories = projections.filter((p) => p.member_count > 1)
    const compressed = multiStories.reduce((acc, p) => acc + (p.member_count - 1), 0)

    const stats = {
      home_items_before: articles.length,
      home_items_after: projections.length,
      multi_article_story_count: multiStories.length,
      duplicate_articles_compressed: compressed,
      noise_reduction_percent: Math.round((compressed / articles.length) * 10_000) / 100,
      top10_story_card_count: multiStories.filter((p) => p.h1_home_position < 10).length,
      top20_story_card_count: multiStories.filter((p) => p.h1_home_position < 20).length,
      top50_story_card_count: multiStories.filter((p) => p.h1_home_position < 50).length,
      top100_story_card_count: multiStories.filter((p) => p.h1_home_position < 100).length,
    }

    const timingBreakdown = {
      token_extraction_ms: Math.round((t1 - t0) * 1000) / 1000,
      candidate_retrieval_ms: Math.round((t2 - t1) * 1000) / 1000,
      d0_scoring_ms: Math.round((t3 - t2) * 1000) / 1000,
      p3_clustering_ms: Math.round((t4 - t3) * 1000) / 1000,
      projection_and_h1_ms: Math.round((t5 - t4) * 1000) / 1000,
      total_end_to_end_ms: Math.round((t5 - t0) * 1000) / 1000,
    }

    return { projections, stats, timingBreakdown }
  } catch (error) {
    // Fail-open fallback: return 1:1 singletons
    const fallbackProjections = articles.map((a, idx) => ({
      story_id: `story_single_${a.id}`,
      representative_article_id: Number(a.id),
      alternative_article_ids: [],
      member_article_ids: [Number(a.id)],
      member_count: 1,
      h1_home_position: idx,
    }))

    return {
      projections: fallbackProjections,
      stats: {
        home_items_before: articles.length,
        home_items_after: articles.length,
        multi_article_story_count: 0,
        duplicate_articles_compressed: 0,
        noise_reduction_percent: 0,
      },
      timingBreakdown: {
        error: String(error),
        total_end_to_end_ms: Math.round((performance.now() - t0) * 1000) / 1000,
      },
    }
  }
}

/**
 * Benchmarks pipeline across different article batch sizes.
 */
export function benchmarkPipeline(
  articles,
  sizes = [25, 50, 100, 200],
  runs = 5,
  threshold = 0.3542,
) {
  const results = {}

  for (const size of sizes) {
    const slice = articles.slice(0, size)
    const timings = []

    for (let r = 0; r < runs; r++) {
      const res = executeD0Pipeline(slice, { threshold })
      timings.push(res.timingBreakdown.total_end_to_end_ms)
    }

    const sortedTimings = timings.toSorted((a, b) => a - b)
    const median = sortedTimings[Math.floor(sortedTimings.length / 2)]
    const p90 =
      sortedTimings[Math.min(sortedTimings.length - 1, Math.floor(sortedTimings.length * 0.9))]

    results[`articles_${size}`] = {
      median_ms: median,
      p90_ms: p90,
      min_ms: sortedTimings[0],
      max_ms: sortedTimings.at(-1),
    }
  }

  return results
}
