/**
 * Score Provider Abstraction & Pair Normalization Contract (STORY-02-A1).
 *
 * The score provider is strictly separated from:
 * - P3 clustering
 * - StoryProjection
 * - Home placement
 * - UI rendering
 */

export class ScoreProvider {
  /**
   * Evaluates pairwise similarity for a set of Home articles.
   *
   * @param {Array<Object>} articles - Normalized articles snapshot
   * @param {Object} context - Execution context { requestId, sessionRevision, articleRevision, signal }
   * @returns {Promise<{ version: string, articleRevision: string, pairs: Array<{ articleAId: number|string, articleBId: number|string, score: number }> }>}
   */
  async scorePairs(articles, context) {
    throw new Error("scorePairs must be implemented by concrete ScoreProvider")
  }
}

/**
 * Normalizes, deduplicates, and validates pairwise candidate scores.
 * Enforces:
 * - Reject NaN, undefined, non-numeric, or infinite scores.
 * - Reject self-pairs (articleAId === articleBId).
 * - Reject unknown article IDs not present in validArticleIds set.
 * - Canonicalize pair ordering: min(u, v)_max(u, v).
 * - Deduplicate duplicate pairs.
 *
 * @param {Array<Object>} rawPairs - Raw pair entries from provider
 * @param {Set<number|string>} validArticleIds - Set of valid article IDs in current snapshot
 * @returns {Array<{ articleAId: number|string, articleBId: number|string, score: number, pairKey: string }>}
 */
export function normalizeAndValidatePairs(rawPairs, validArticleIds) {
  if (!Array.isArray(rawPairs) || rawPairs.length === 0) {
    return []
  }

  const seenPairKeys = new Map()

  for (const item of rawPairs) {
    if (!item || typeof item !== "object") {
      continue
    }

    const rawA = item.articleAId ?? item.entryAId ?? item.a
    const rawB = item.articleBId ?? item.entryBId ?? item.b
    // Score must be explicitly provided and valid
    if (
      item.score === null ||
      item.score === undefined ||
      typeof item.score === "boolean" ||
      item.score === ""
    ) {
      continue
    }

    const rawScore = Number(item.score)

    // Score must be a valid, finite number
    if (typeof rawScore !== "number" || Number.isNaN(rawScore) || !Number.isFinite(rawScore)) {
      continue
    }

    if (rawA === undefined || rawB === undefined || rawA === null || rawB === null) {
      continue
    }

    // Reject self-pairs
    if (String(rawA) === String(rawB)) {
      continue
    }

    // Must exist in valid input articles
    if (validArticleIds && (!validArticleIds.has(rawA) || !validArticleIds.has(rawB))) {
      continue
    }

    // Canonical key formatting: string-based min and max
    const strA = String(rawA)
    const strB = String(rawB)
    const [u, v] =
      strA.localeCompare(strB, undefined, { numeric: true }) < 0 ? [rawA, rawB] : [rawB, rawA]
    const pairKey = `${u}_${v}`

    // Deduplicate: preserve the first or higher score
    if (!seenPairKeys.has(pairKey) || seenPairKeys.get(pairKey).score < rawScore) {
      seenPairKeys.set(pairKey, {
        articleAId: u,
        articleBId: v,
        score: rawScore,
        pairKey,
      })
    }
  }

  return [...seenPairKeys.values()]
}
