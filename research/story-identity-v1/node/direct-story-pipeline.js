/**
 * STORY-02-A0 R3: Direct Pair Scorer Pipeline in Node.js.
 *
 * Implements the D0_TITLE_OVERLAP_DIRECT executable pipeline in vanilla Node.js:
 * 1. getFeedIdentity: extracts canonical feed identifier for cross-feed enforcement.
 * 2. extractSignificantWords: zero-model lexical token extraction.
 * 3. computeOverlapCoefficient: pure set overlap metric.
 * 4. retrieveCandidatesRF0R: symmetric per-article top-K with deterministic lexical tie-break (cross-feed only).
 * 5. Conservative P3 clustering under RESEARCH_POLICY_24H (24 hours).
 * 6. Representative selection (D0_LEXICAL_MEDOID) & H1 Ranking Preservation Placement.
 *
 * Constraints:
 * - Zero models, zero containers, zero native compilation, zero external libraries.
 * - Cross-feed only: zero same-feed pairs retrieved or clustered.
 * - Fail-open contract: returns flat feed on error.
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

export const R3_P3_MAX_TEMPORAL_SPAN_HOURS = 24

/**
 * Extracts canonical feed identity for an article.
 *
 * Contract:
 * - Returns string representation of feed_id if present.
 * - Fallback to nested feed.id if present.
 * - Fallback to string feed or feed_title if numeric ID is missing.
 * - Returns empty string if unidentifiable.
 */
export function getFeedIdentity(article) {
  if (!article) {
    return ""
  }
  if (article.feed_id !== undefined && article.feed_id !== null) {
    return String(article.feed_id)
  }
  if (
    article.feed &&
    typeof article.feed === "object" &&
    article.feed.id !== undefined &&
    article.feed.id !== null
  ) {
    return String(article.feed.id)
  }
  if (typeof article.feed === "string" || typeof article.feed === "number") {
    return String(article.feed)
  }
  if (article.feed_title) {
    return String(article.feed_title)
  }
  return ""
}

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
 * Retrieves cross-feed candidate pairs using RF0R_RUNTIME_LEXICAL_TOP_K.
 *
 * Contract:
 * - CROSS_FEED_ONLY: Same-feed article pairs are strictly excluded.
 * - UNKNOWN_FEED_NOT_ELIGIBLE: Both feed identities must be known and non-empty (unknown vs known and unknown vs unknown rejected).
 * - SYMMETRIC_PER_ARTICLE_TOP_K: Every article independently ranks its cross-feed candidate neighbors.
 * - HIGHER_ID_CAN_SELECT_LOWER_ID: No directional ID restriction before forming per-article top-K.
 * - CANONICAL_PAIR_DEDUP: Returned pair keys are canonical `${min(u, v)}_${max(u, v)}`.
 * - DETERMINISTIC_TIE_BREAK: 1. title_overlap_coefficient DESC, 2. canonical_pair_key ASC.
 */
export function retrieveCandidatesRF0R(articles, articleTokens, kRetrieval = 10) {
  const invertedIndex = buildInvertedIndex(articleTokens)
  const feedLookup = new Map()
  for (const a of articles) {
    feedLookup.set(Number(a.id), getFeedIdentity(a))
  }

  const candidatePairs = new Set()
  const pairScores = new Map()

  for (const a of articles) {
    const aid = Number(a.id)
    const aFeed = feedLookup.get(aid)
    const tokensA = articleTokens.get(aid)
    if (!tokensA || tokensA.size === 0) {
      continue
    }

    const seenNeighbors = new Set()
    const cands = []

    for (const token of tokensA) {
      const posting = invertedIndex.get(token)
      if (posting) {
        for (const otherAid of posting) {
          const otherFeed = feedLookup.get(otherAid)
          if (
            otherAid !== aid &&
            Boolean(aFeed) &&
            Boolean(otherFeed) &&
            otherFeed !== aFeed &&
            !seenNeighbors.has(otherAid)
          ) {
            seenNeighbors.add(otherAid)
            const tokensB = articleTokens.get(otherAid)
            const coef = computeOverlapCoefficient(tokensA, tokensB)
            const minId = Math.min(aid, otherAid)
            const maxId = Math.max(aid, otherAid)
            const canonicalKey = `${minId}_${maxId}`
            cands.push({
              otherAid,
              coef,
              canonicalKey,
              minId,
              maxId,
            })
          }
        }
      }
    }

    // Sort deterministically:
    // 1. coef DESC
    // 2. canonicalKey ASC
    const sorted = cands.toSorted((left, right) => {
      if (right.coef !== left.coef) {
        return right.coef - left.coef
      }
      return left.canonicalKey.localeCompare(right.canonicalKey)
    })

    const topK = sorted.slice(0, kRetrieval)
    for (const cand of topK) {
      candidatePairs.add(cand.canonicalKey)
      pairScores.set(cand.canonicalKey, Math.round(cand.coef * 10_000) / 10_000)
    }
  }

  return { candidatePairs, pairScores }
}

/**
 * P3 Conservative Clustering under RESEARCH_POLICY_24H.
 *
 * Rules:
 * - Edges sorted descending by score, then u, then v.
 * - Max cluster size enforcement (default 10).
 * - Max temporal span enforcement (default 24 hours).
 * - Multi-member rule: candidate joining an existing cluster of size >= 2 must have
 *   at least 2 positive edges (score >= threshold) to existing members.
 * - No cluster-to-cluster bridging.
 * - Singletons preserved.
 */
export function clusterWithP3(
  articleIds,
  pairScores,
  threshold = 0.3541,
  publishedLookup = {},
  options = {},
) {
  const { maxSize = 10, maxTemporalSpanHours = R3_P3_MAX_TEMPORAL_SPAN_HOURS } = options

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
 * Representative selection (D0_LEXICAL_MEDOID) & H1 Ranking Preservation Placement.
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
      representative_policy: "D0_LEXICAL_MEDOID",
      placement_policy: "H1_HIGHEST_RANKED_MEMBER_POSITION",
      alternative_article_ids: alternatives,
      member_article_ids: members,
      member_count: members.length,
      h1_home_position: h1Pos === Infinity ? 0 : h1Pos,
    })
  }

  // Sort projections by H1 position, tie-break by representative article id
  return projections.toSorted((a, b) => {
    if (a.h1_home_position !== b.h1_home_position) {
      return a.h1_home_position - b.h1_home_position
    }
    return a.representative_article_id - b.representative_article_id
  })
}

/**
 * Executes full D0 raw pipeline from raw article objects under cross-feed only contract.
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

  const threshold = options.threshold ?? 0.3541
  const kRetrieval = options.kRetrieval ?? 10
  const maxTemporalSpanHours = options.maxTemporalSpanHours ?? R3_P3_MAX_TEMPORAL_SPAN_HOURS

  try {
    const articleTokens = new Map()
    const publishedLookup = {}
    const homeOrder = []

    for (const a of articles) {
      const aid = Number(a.id)
      homeOrder.push(aid)
      publishedLookup[aid] = Number(a.published_at || 0)
      const feedTitle = a.feed_title || a.feed || ""
      articleTokens.set(aid, extractSignificantWords(a.title || "", feedTitle))
    }
    const t1 = performance.now()

    const { candidatePairs, pairScores } = retrieveCandidatesRF0R(
      articles,
      articleTokens,
      kRetrieval,
    )
    const t2 = performance.now()

    const clusters = clusterWithP3(homeOrder, pairScores, threshold, publishedLookup, {
      maxTemporalSpanHours,
    })
    const t3 = performance.now()

    const projections = projectStories(clusters, pairScores, homeOrder)
    const t4 = performance.now()

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
      candidate_retrieval_and_scoring_ms: Math.round((t2 - t1) * 1000) / 1000,
      p3_clustering_ms: Math.round((t3 - t2) * 1000) / 1000,
      projection_and_h1_ms: Math.round((t4 - t3) * 1000) / 1000,
      total_end_to_end_ms: Math.round((t4 - t0) * 1000) / 1000,
    }

    return { projections, stats, timingBreakdown, candidatePairs, pairScores, clusters }
  } catch (error) {
    // Fail-open fallback: return 1:1 singletons
    const fallbackProjections = articles.map((a, idx) => ({
      story_id: `story_single_${a.id}`,
      representative_article_id: Number(a.id),
      representative_policy: "D0_SINGLETON_FALLBACK",
      placement_policy: "H1_HIGHEST_RANKED_MEMBER_POSITION",
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
export function benchmarkPipeline(articles, sizes = [25, 50, 100, 200], runs = 5, options = {}) {
  const results = {}

  for (const size of sizes) {
    const slice = articles.slice(0, size)
    const timings = []

    for (let r = 0; r < runs; r++) {
      const res = executeD0Pipeline(slice, options)
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
