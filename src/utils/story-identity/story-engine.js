import {
  STORY_IDENTITY_DEFAULT_THRESHOLD,
  STORY_RESEARCH_MAX_CLUSTER_SIZE,
  STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS,
} from "./constants"

/**
 * P3 Conservative Clustering Engine (STORY-02-A1).
 *
 * Implements:
 * - Positive edge starts a 2-member cluster.
 * - Multi-member support: candidate joining cluster of size >= 2 must have >= 2 positive edges to existing members.
 * - Anti-transitivity: no chain propagation without direct multi-member positive support.
 * - Cluster bridging prevention: established clusters NEVER merge into one another.
 * - Temporal bounding: maximum delta between any two cluster members.
 * - Cluster size bound: maximum cluster capacity.
 * - Known cross-feed requirement: same-feed or unknown-feed pairs are strictly ineligible.
 *
 * @param {Array<{ id: number|string, feedId?: string, publishedAt?: number, homePosition?: number }>} articles
 * @param {Array<{ articleAId: number|string, articleBId: number|string, score: number }>} pairScores
 * @param {Object} [options]
 * @param {number} [options.threshold=0.5]
 * @param {number} [options.maxTemporalSpanHours=24]
 * @param {number} [options.maxClusterSize=10]
 * @param {boolean} [options.requireCrossFeed=true]
 * @param {boolean} [options.requireKnownFeeds=true]
 * @returns {Array<Array<number|string>>} Array of clusters (each cluster is array of article IDs)
 */
export function runP3Clustering(articles, pairScores, options = {}) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return []
  }

  const threshold = options.threshold ?? STORY_IDENTITY_DEFAULT_THRESHOLD
  const maxTemporalSpanHours =
    options.maxTemporalSpanHours ?? STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS
  const maxClusterSize = options.maxClusterSize ?? STORY_RESEARCH_MAX_CLUSTER_SIZE
  const requireCrossFeed = options.requireCrossFeed ?? true
  const requireKnownFeeds = options.requireKnownFeeds ?? true

  const maxTemporalSeconds = maxTemporalSpanHours * 3600

  // Lookup structures
  const articleLookup = new Map()
  for (const a of articles) {
    articleLookup.set(a.id, a)
  }

  // Build edge map and collect eligible positive edges
  const edgeScores = new Map()
  const eligibleEdges = []

  if (Array.isArray(pairScores)) {
    for (const p of pairScores) {
      if (!p || typeof p.score !== "number" || p.score < threshold) {
        continue
      }

      const u = p.articleAId
      const v = p.articleBId
      const artU = articleLookup.get(u)
      const artV = articleLookup.get(v)

      if (!artU || !artV) {
        continue
      }

      const feedU = String(artU.feedId ?? "")
      const feedV = String(artV.feedId ?? "")

      // Feed eligibility checks
      if (requireKnownFeeds && (!feedU || !feedV)) {
        continue
      }
      if (requireCrossFeed && feedU === feedV) {
        continue
      }

      // Temporal check between pair
      const tU = Number(artU.publishedAt ?? 0)
      const tV = Number(artV.publishedAt ?? 0)
      if (Math.abs(tU - tV) > maxTemporalSeconds) {
        continue
      }

      // Canonical pair representation
      const strU = String(u)
      const strV = String(v)
      const pairKey = strU < strV ? `${u}_${v}` : `${v}_${u}`

      edgeScores.set(`${u}_${v}`, p.score)
      edgeScores.set(`${v}_${u}`, p.score)

      eligibleEdges.push({
        u,
        v,
        score: p.score,
        pairKey,
      })
    }
  }

  // Sort edges deterministically: score DESC, then pairKey ASC
  eligibleEdges.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.pairKey.localeCompare(b.pairKey)
  })

  const clusters = []
  const articleToCluster = new Map()

  const canJoinCluster = (clusterIndex, candidateId) => {
    const cluster = clusters[clusterIndex]
    if (!cluster || cluster.length >= maxClusterSize) {
      return false
    }

    const candArt = articleLookup.get(candidateId)
    const tCand = Number(candArt?.publishedAt ?? 0)

    // Check temporal distance to all existing members
    for (const memberId of cluster) {
      const memberArt = articleLookup.get(memberId)
      const tMember = Number(memberArt?.publishedAt ?? 0)
      if (Math.abs(tCand - tMember) > maxTemporalSeconds) {
        return false
      }
    }

    // If cluster size >= 2, candidate must have >= 2 positive member edges
    if (cluster.length >= 2) {
      let positiveEdgeCount = 0
      for (const memberId of cluster) {
        const edgeScore = edgeScores.get(`${candidateId}_${memberId}`)
        if (edgeScore !== undefined && edgeScore >= threshold) {
          positiveEdgeCount++
        }
      }
      if (positiveEdgeCount < 2) {
        return false
      }
    }

    return true
  }

  for (const edge of eligibleEdges) {
    const { u, v } = edge
    const cU = articleToCluster.get(u)
    const cV = articleToCluster.get(v)

    if (cU === undefined && cV === undefined) {
      // Both unclustered -> form new 2-member cluster
      const cIdx = clusters.length
      clusters.push([u, v])
      articleToCluster.set(u, cIdx)
      articleToCluster.set(v, cIdx)
    } else if (cU !== undefined && cV === undefined) {
      // u in cluster, v unclustered -> test if v can join cU
      if (canJoinCluster(cU, v)) {
        clusters[cU].push(v)
        articleToCluster.set(v, cU)
      }
    } else // v in cluster, u unclustered -> test if u can join cV
    if (cU === undefined && cV !== undefined && canJoinCluster(cV, u)) {
      clusters[cV].push(u)
      articleToCluster.set(u, cV)
    }
    // If both are already clustered (cU !== undefined && cV !== undefined):
    // P3 strictly prevents established cluster-to-cluster bridging.
  }

  // Preserve singletons for all articles not in a multi-article cluster
  for (const a of articles) {
    if (!articleToCluster.has(a.id)) {
      clusters.push([a.id])
    }
  }

  return clusters
}

export default runP3Clustering
