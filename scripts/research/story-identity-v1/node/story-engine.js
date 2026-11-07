/**
 * STORY-01B-C14: Pure JavaScript/Node.js Story Identity Engine
 *
 * Implements deterministic candidate retrieval, clustering, representative selection,
 * alternatives selection, and story projection using ONLY Node.js standard library.
 * Zero external dependencies. Uses standard ES modules.
 */

import crypto from "node:crypto"

/**
 * Canonical pair key: "min(u, v):max(u, v)"
 */
export function pairKey(u, v) {
  const numU = Number(u)
  const numV = Number(v)
  return `${Math.min(numU, numV)}:${Math.max(numU, numV)}`
}

/**
 * SHA256 helper
 */
export function sha256(string_) {
  return crypto.createHash("sha256").update(string_, "utf8").digest("hex")
}

/**
 * Cluster articles according to policy (P0..P4)
 */
export function clusterArticles(articleIds, pairScores, options = {}) {
  const policy = options.policy || "P3_STRONG_MULTI_MEMBER_SUPPORT"
  const threshold = options.threshold === undefined ? 0.3787 : options.threshold
  const maxClusterSize = options.maxClusterSize || 10
  const maxTemporalSpanHours =
    options.maxTemporalSpanHours === undefined ? 24 : options.maxTemporalSpanHours
  const publishedLookup = options.publishedLookup || {}

  const articleSet = new Set(articleIds.map(Number))
  const sortedArticleIds = [...articleSet].toSorted((a, b) => a - b)

  // Extract positive edges
  const rawEdges = []
  for (const [pk, sc] of Object.entries(pairScores)) {
    if (sc >= threshold) {
      const parts = pk.split(":")
      const u = Number(parts[0])
      const v = Number(parts[1])
      if (articleSet.has(u) && articleSet.has(v)) {
        rawEdges.push({ score: sc, u: Math.min(u, v), v: Math.max(u, v), key: pk })
      }
    }
  }

  // Sort edges descending by score, then canonical key
  const posEdges = rawEdges.toSorted((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    if (b.u !== a.u) {
      return b.u - a.u
    }
    return b.v - a.v
  })

  if (policy === "P0_UNRESTRICTED_CC") {
    const parent = {}
    for (const a of sortedArticleIds) {
      parent[a] = a
    }

    function find(a) {
      if (parent[a] !== a) {
        parent[a] = find(parent[a])
      }
      return parent[a]
    }
    function union(a, b) {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) {
        parent[ra] = rb
      }
    }

    for (const edge of posEdges) {
      union(edge.u, edge.v)
    }

    const clustersMap = new Map()
    for (const a of sortedArticleIds) {
      const root = find(a)
      if (!clustersMap.has(root)) {
        clustersMap.set(root, [])
      }
      clustersMap.get(root).push(a)
    }

    const result = [...clustersMap.values()].map((c) => c.toSorted((a, b) => a - b))
    return result.toSorted((a, b) => {
      if (b.length !== a.length) {
        return b.length - a.length
      }
      return a[0] - b[0]
    })
  }

  // Seed-based conservative clustering (P1..P4)
  const clusters = []
  const articleToClusterIdx = new Map()
  const representativeOf = new Map()

  function getPub(a) {
    return publishedLookup[a] || 0
  }

  function getScore(u, v) {
    return pairScores[pairKey(u, v)]
  }

  function admitCandidate(cand, cIdx) {
    const members = clusters[cIdx]
    if (members.length >= maxClusterSize) {
      return
    }

    const pubCand = getPub(cand)
    if (
      maxTemporalSpanHours > 0 &&
      members.some((m) => Math.abs(pubCand - getPub(m)) > maxTemporalSpanHours * 3600)
    ) {
      return
    }

    const rep = representativeOf.get(cIdx)
    const repScore = getScore(cand, rep)
    if (repScore === undefined || repScore < threshold) {
      return
    }

    switch (policy) {
      case "P1_REPRESENTATIVE_GUARD": {
        // Admitted

        break
      }
      case "P2_CONSERVATIVE_OBSERVED_EDGE_COMPATIBILITY": {
        for (const m of members) {
          const sc = getScore(cand, m)
          if (sc !== undefined && sc < threshold) {
            return
          }
        }

        break
      }
      case "P3_STRONG_MULTI_MEMBER_SUPPORT": {
        if (members.length >= 2) {
          let posCount = 0
          for (const m of members) {
            const sc = getScore(cand, m)
            if (sc !== undefined && sc >= threshold) {
              posCount++
            }
          }
          if (posCount < 2) {
            return
          }
        }

        break
      }
      case "P4_CONTRADICTION_VETO": {
        for (const m of members) {
          const sc = getScore(cand, m)
          if (sc !== undefined && sc < threshold * 0.7) {
            return
          }
        }

        break
      }
      // No default
    }

    members.push(cand)
    articleToClusterIdx.set(cand, cIdx)
  }

  for (const edge of posEdges) {
    const { u, v } = edge
    const cU = articleToClusterIdx.get(u)
    const cV = articleToClusterIdx.get(v)

    if (cU === undefined && cV === undefined) {
      // Seed cluster
      const rep = getPub(u) < getPub(v) || (getPub(u) === getPub(v) && u <= v) ? u : v
      const cIdx = clusters.length
      clusters.push([u, v])
      representativeOf.set(cIdx, rep)
      articleToClusterIdx.set(u, cIdx)
      articleToClusterIdx.set(v, cIdx)
    } else if (cU !== undefined && cV === undefined) {
      admitCandidate(v, cU)
    } else if (cU === undefined && cV !== undefined) {
      admitCandidate(u, cV)
    }
  }

  // Add singletons
  for (const a of sortedArticleIds) {
    if (!articleToClusterIdx.has(a)) {
      clusters.push([a])
    }
  }

  const result = clusters.map((c) => c.toSorted((a, b) => a - b))
  return result.toSorted((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length
    }
    return a[0] - b[0]
  })
}

/**
 * Select representative article (R0..R4)
 */
export function selectRepresentative(memberIds, options = {}) {
  const policy = options.policy || "R4_HYBRID_MEDOID"
  const publishedLookup = options.publishedLookup || {}
  const pairScores = options.pairScores || {}

  if (memberIds.length === 1) {
    return memberIds[0]
  }

  function getPub(a) {
    return publishedLookup[a] || 0
  }

  if (policy === "R0_EARLIEST") {
    let best = memberIds[0]
    for (const m of memberIds) {
      if (getPub(m) < getPub(best) || (getPub(m) === getPub(best) && m < best)) {
        best = m
      }
    }
    return best
  }

  if (policy === "R1_LATEST") {
    let best = memberIds[0]
    for (const m of memberIds) {
      if (getPub(m) > getPub(best) || (getPub(m) === getPub(best) && m > best)) {
        best = m
      }
    }
    return best
  }

  // Medoid (R2, R3, R4)
  let bestArt = memberIds[0]
  let bestAvg = -1

  for (const cand of memberIds) {
    let sum = 0
    let count = 0
    for (const other of memberIds) {
      if (cand === other) {
        continue
      }
      const sc = pairScores[pairKey(cand, other)] || 0
      sum += sc
      count++
    }
    const avg = count > 0 ? sum / count : 0
    if (avg > bestAvg || (avg === bestAvg && getPub(cand) < getPub(bestArt))) {
      bestAvg = avg
      bestArt = cand
    }
  }
  return bestArt
}

/**
 * Select alternatives (A0..A2)
 */
export function selectAlternatives(memberIds, repId, options = {}) {
  const policy = options.policy || "A2_DIVERSE_TOP_K"
  const maxK = options.maxK || 3
  const feedLookup = options.feedLookup || {}

  const candidates = memberIds.filter((m) => m !== repId)
  if (candidates.length === 0) {
    return []
  }

  if (policy === "A0_ALL") {
    return candidates.toSorted((a, b) => a - b)
  }

  const repFeed = feedLookup[repId] || ""
  const distinctFeed = []
  const sameFeed = []

  for (const c of candidates) {
    const f = feedLookup[c] || ""
    if (f === repFeed) {
      sameFeed.push({ id: c, feed: f })
    } else {
      distinctFeed.push({ id: c, feed: f })
    }
  }

  const selected = []
  const seenFeeds = new Set()
  for (const item of distinctFeed) {
    if (!seenFeeds.has(item.feed)) {
      selected.push(item.id)
      seenFeeds.add(item.feed)
    }
    if (selected.length >= maxK) {
      break
    }
  }

  if (selected.length < maxK) {
    for (const item of sameFeed) {
      selected.push(item.id)
      if (selected.length >= maxK) {
        break
      }
    }
  }

  return selected.toSorted((a, b) => a - b)
}

/**
 * Build story projections
 */
export function buildStoryProjections(clusters, options = {}) {
  const articlesLookup = options.articlesLookup || {}
  const pairScores = options.pairScores || {}
  const repPolicy = options.repPolicy || "R4_HYBRID_MEDOID"
  const altPolicy = options.altPolicy || "A2_DIVERSE_TOP_K"
  const clusterPolicy = options.clusterPolicy || "P3_STRONG_MULTI_MEMBER_SUPPORT"

  const publishedLookup = {}
  const feedLookup = {}
  for (const [idStr, art] of Object.entries(articlesLookup)) {
    const id = Number(idStr)
    publishedLookup[id] = Number(art.published_at || 0)
    feedLookup[id] = art.feed_title || ""
  }

  const projections = []
  for (const c of clusters) {
    const memberIds = [...c].toSorted((a, b) => a - b)
    const canonicalStr = memberIds.join(",")
    const storyId = `story_${sha256(canonicalStr).slice(0, 16)}`

    const repId = selectRepresentative(memberIds, {
      policy: repPolicy,
      publishedLookup,
      pairScores,
    })

    const altIds = selectAlternatives(memberIds, repId, {
      policy: altPolicy,
      maxK: 3,
      feedLookup,
    })

    const pubTimes = memberIds.map((m) => publishedLookup[m] || 0)
    const feeds = new Set(memberIds.map((m) => feedLookup[m] || ""))

    const confidence = memberIds.length > 1 ? "UNVERIFIED_MULTI_MEMBER" : "STANDALONE"

    projections.push({
      story_id: storyId,
      representative_article_id: repId,
      alternative_article_ids: altIds,
      member_article_ids: memberIds,
      member_count: memberIds.length,
      source_count: feeds.size,
      first_published_at: Math.min(...pubTimes),
      last_published_at: Math.max(...pubTimes),
      confidence,
      confidence_methodological_debt_note:
        "Assigning confidence=HIGH based purely on member_count > 1 is methodological debt. " +
        "True confidence bands (STRONG_SUPPORT, MODERATE_SUPPORT, WEAK_SUPPORT) require edge support, " +
        "crossfit consensus, and absence of contradictions (formalized in Stage C6).",
      cluster_policy: clusterPolicy,
      representative_policy: repPolicy,
      alternative_policy: altPolicy,
    })
  }

  return projections.toSorted((a, b) => {
    if (b.member_count !== a.member_count) {
      return b.member_count - a.member_count
    }
    return a.member_article_ids[0] - b.member_article_ids[0]
  })
}

const storyEngine = {
  pairKey,
  sha256,
  clusterArticles,
  selectRepresentative,
  selectAlternatives,
  buildStoryProjections,
}

export default storyEngine
