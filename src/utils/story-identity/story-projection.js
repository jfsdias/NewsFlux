/**
 * Story Projection & Validation Contracts (STORY-02-A1).
 *
 * Enforces:
 * - Deterministic, ephemeral storyId derivation.
 * - H1 placement: story appears at min(original Home position of members).
 * - Article revision without read/starred state dependencies.
 * - Comprehensive projection validation and accounting invariants.
 */

/**
 * Extracts canonical feed identity string from diverse article schemas.
 *
 * @param {Object} article
 * @returns {string}
 */
export function getFeedIdentity(article) {
  if (!article || typeof article !== "object") {
    return ""
  }
  if (article.feedId !== undefined && article.feedId !== null) {
    return String(article.feedId)
  }
  if (article.feed_id !== undefined && article.feed_id !== null) {
    return String(article.feed_id)
  }
  if (article.feed && typeof article.feed === "object" && article.feed.id != null) {
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
 * Computes deterministic fingerprint from fields that affect Story Identity.
 * Explicitly DOES NOT include read/starred state.
 *
 * @param {Array<Object>} articles
 * @returns {string}
 */
export function computeArticleRevision(articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return "rev_empty"
  }

  // Simple, deterministic 32-bit FNV-1a hash over identity tokens
  let hash = 0x81_1c_9d_c5
  for (const a of articles) {
    const aid = String(a.id ?? "")
    const fid = getFeedIdentity(a)
    const title = String(a.title ?? "")
    const pub = String(a.published_at ?? a.publishedAt ?? 0)
    const token = `${aid}|${fid}|${title}|${pub};`

    for (let i = 0; i < token.length; i++) {
      hash ^= token.codePointAt(i)
      hash = Math.imul(hash, 0x01_00_01_93)
    }
  }

  return `rev_${articles.length}_${(hash >>> 0).toString(16)}`
}

/**
 * Deterministic representative selector:
 * Highest-ranked member in the original Home feed (lowest homePosition).
 *
 * @param {Array<number|string>} memberIds
 * @param {Map<number|string, Object>} articleLookup
 * @returns {number|string}
 */
export function selectRepresentative(memberIds, articleLookup) {
  if (!memberIds || memberIds.length === 0) {
    throw new Error("Cannot select representative from empty cluster")
  }

  let bestId = memberIds[0]
  let minPos = Infinity

  for (const id of memberIds) {
    const art = articleLookup.get(id)
    const pos = art?.homePosition ?? Infinity
    if (pos < minPos) {
      minPos = pos
      bestId = id
    }
  }

  return bestId
}

/**
 * Builds StoryProjection objects from P3 clusters and normalized articles.
 *
 * @param {Array<Array<number|string>>} clusters
 * @param {Array<{ id: number|string, feedId?: string, publishedAt?: number, homePosition?: number }>} articles
 * @returns {Array<Object>}
 */
export function buildStoryProjections(clusters, articles) {
  if (!Array.isArray(articles) || articles.length === 0) {
    return []
  }

  const articleLookup = new Map()
  for (const [i, a] of articles.entries()) {
    articleLookup.set(a.id, {
      ...a,
      homePosition: a.homePosition ?? i,
      publishedAt: Number(a.publishedAt ?? a.published_at ?? 0),
    })
  }

  const projections = []

  for (const cluster of clusters) {
    if (!Array.isArray(cluster) || cluster.length === 0) {
      continue
    }

    // Sort member IDs deterministically for stable storyId hashing
    const sortedMemberIds = cluster.toSorted((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true }),
    )

    const repId = selectRepresentative(sortedMemberIds, articleLookup)
    const altIds = sortedMemberIds.filter((id) => id !== repId)

    let placementIndex = Infinity
    let firstPublishedAt = Infinity
    let lastPublishedAt = -Infinity
    const distinctFeeds = new Set()

    for (const id of sortedMemberIds) {
      const art = articleLookup.get(id)
      if (art) {
        placementIndex = Math.min(placementIndex, art.homePosition)
        firstPublishedAt = Math.min(firstPublishedAt, art.publishedAt)
        lastPublishedAt = Math.max(lastPublishedAt, art.publishedAt)
        if (art.feedId) {
          distinctFeeds.add(art.feedId)
        }
      }
    }

    if (placementIndex === Infinity) {
      placementIndex = 0
    }
    if (firstPublishedAt === Infinity) {
      firstPublishedAt = 0
    }
    if (lastPublishedAt === -Infinity) {
      lastPublishedAt = 0
    }

    projections.push({
      storyId: `story_v1_${sortedMemberIds.join("_")}`,
      representativeArticleId: repId,
      memberArticleIds: sortedMemberIds,
      alternativeArticleIds: altIds,
      placementIndex,
      firstPublishedAt,
      lastPublishedAt,
      sourceCount: distinctFeeds.size,
      memberCount: sortedMemberIds.length,
      projectionVersion: "1.0",
    })
  }

  // Sort projections by H1 placement index ASC, tie-break by representative ID
  projections.sort((a, b) => {
    if (a.placementIndex !== b.placementIndex) {
      return a.placementIndex - b.placementIndex
    }
    return String(a.representativeArticleId).localeCompare(
      String(b.representativeArticleId),
      undefined,
      { numeric: true },
    )
  })

  return projections
}

/**
 * Validates StoryProjections against input articles snapshot (Section 27).
 *
 * Invariants:
 * 1. Every member ID exists in input.
 * 2. Article belongs to at most one StoryProjection.
 * 3. No duplicate member IDs inside any projection.
 * 4. No empty story (memberCount > 0).
 * 5. Representative belongs to members.
 * 6. Placement index is valid (>= 0).
 * 7. All original articles accounted for exactly once (INPUT_COUNT === sum(memberCount)).
 *
 * @param {Array<Object>} projections
 * @param {Array<Object>} originalArticles
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateStoryProjections(projections, originalArticles) {
  if (!Array.isArray(projections)) {
    return { valid: false, error: "Projections must be an array" }
  }
  if (!Array.isArray(originalArticles)) {
    return { valid: false, error: "Original articles must be an array" }
  }

  const originalIds = new Set(originalArticles.map((a) => a.id))
  const seenMemberIds = new Set()
  let totalMembers = 0

  for (const proj of projections) {
    if (!proj || typeof proj !== "object") {
      return { valid: false, error: "Projection item is not an object" }
    }

    if (!Array.isArray(proj.memberArticleIds) || proj.memberArticleIds.length === 0) {
      return { valid: false, error: `Empty story found: ${proj.storyId}` }
    }

    if (proj.memberCount !== proj.memberArticleIds.length) {
      return { valid: false, error: `memberCount mismatch in story ${proj.storyId}` }
    }

    if (!proj.memberArticleIds.includes(proj.representativeArticleId)) {
      return {
        valid: false,
        error: `Representative ${proj.representativeArticleId} not in members for story ${proj.storyId}`,
      }
    }

    if (typeof proj.placementIndex !== "number" || proj.placementIndex < 0) {
      return { valid: false, error: `Invalid placementIndex in story ${proj.storyId}` }
    }

    const localSeen = new Set()
    for (const mId of proj.memberArticleIds) {
      if (!originalIds.has(mId)) {
        return { valid: false, error: `Unknown member ID ${mId} in story ${proj.storyId}` }
      }
      if (localSeen.has(mId)) {
        return { valid: false, error: `Duplicate member ID ${mId} inside story ${proj.storyId}` }
      }
      if (seenMemberIds.has(mId)) {
        return { valid: false, error: `Article ${mId} belongs to multiple stories` }
      }
      localSeen.add(mId)
      seenMemberIds.add(mId)
    }

    totalMembers += proj.memberArticleIds.length
  }

  if (totalMembers !== originalArticles.length) {
    return {
      valid: false,
      error: `Accounting invariant failed: input articles (${originalArticles.length}) !== projected members (${totalMembers})`,
    }
  }

  return { valid: true }
}
