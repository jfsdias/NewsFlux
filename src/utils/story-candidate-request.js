export const STORY_CANDIDATE_ENTRY_LIMIT = 200
export const STORY_CANDIDATE_K = 250
export const STORY_RERANKER_REVISION = "e61197ed45024b0ed8a2d74b80b4d909f1255473"

const FORBIDDEN_IDENTITY_FIELDS = new Set([
  "cluster_id",
  "decision",
  "is_same_story",
  "label",
  "merge",
  "same_story",
  "sameStory",
  "story_id",
])

const normalizePositiveInteger = (value) => {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null
}

const normalizeEntry = (entry) => {
  const id = normalizePositiveInteger(entry?.id)
  const feedId = normalizePositiveInteger(entry?.feed?.id)
  const title = typeof entry?.title === "string" ? entry.title.trim() : ""
  const publishedAt = typeof entry?.published_at === "string" ? entry.published_at : ""
  const publishedAtMs = Date.parse(publishedAt)

  if (id === null || feedId === null || !title || !Number.isFinite(publishedAtMs)) {
    return null
  }

  return {
    id,
    feed_id: feedId,
    published_at: publishedAt,
    title,
    publishedAtMs,
  }
}

const stableRequestHash = (entries) => {
  const input = JSON.stringify(entries)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

export const createStoryCandidateRequest = (entries) => {
  const entriesById = new Map()
  for (const entry of entries ?? []) {
    const normalized = normalizeEntry(entry)
    if (normalized !== null) {
      entriesById.set(normalized.id, normalized)
    }
  }

  const normalizedEntries = [...entriesById.values()]
    .sort(
      (left, right) =>
        right.publishedAtMs - left.publishedAtMs || left.id - right.id,
    )
    .slice(0, STORY_CANDIDATE_ENTRY_LIMIT)
    .map(({ publishedAtMs: _publishedAtMs, ...entry }) => entry)

  return Object.freeze({
    entries: Object.freeze(normalizedEntries.map((entry) => Object.freeze(entry))),
    requestKey: `story-candidates:${stableRequestHash(normalizedEntries)}`,
  })
}

const assertNoIdentityDecisionFields = (candidate) => {
  for (const key of Object.keys(candidate ?? {})) {
    if (FORBIDDEN_IDENTITY_FIELDS.has(key)) {
      throw new TypeError(`Story candidate response contains identity decision field: ${key}`)
    }
  }
}

const normalizeCandidate = (candidate) => {
  assertNoIdentityDecisionFields(candidate)

  const entryAId = normalizePositiveInteger(candidate?.entry_a_id)
  const entryBId = normalizePositiveInteger(candidate?.entry_b_id)
  const rank = normalizePositiveInteger(candidate?.rank)
  const qwenScore = Number(candidate?.qwen_score)
  const rerankerScore = Number(candidate?.reranker_score)

  if (
    entryAId === null ||
    entryBId === null ||
    entryAId === entryBId ||
    rank === null ||
    !Number.isFinite(qwenScore) ||
    !Number.isFinite(rerankerScore)
  ) {
    throw new TypeError("Invalid story candidate ranking response")
  }

  return Object.freeze({ entryAId, entryBId, rank, qwenScore, rerankerScore })
}

export const normalizeStoryCandidateResponse = (response) => {
  if (!Array.isArray(response?.candidates)) {
    throw new TypeError("Invalid story candidate ranking response")
  }
  if (
    Number(response?.model?.candidate_k) !== STORY_CANDIDATE_K ||
    response?.model?.reranker_revision !== STORY_RERANKER_REVISION
  ) {
    throw new TypeError("Story candidate model contract mismatch")
  }

  const candidates = response.candidates.map(normalizeCandidate).sort((a, b) => a.rank - b.rank)
  const seenPairs = new Set()
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.rank !== index + 1) {
      throw new TypeError("Story candidate ranks must be contiguous")
    }
    const pairKey = [candidate.entryAId, candidate.entryBId].sort((a, b) => a - b).join(":")
    if (seenPairs.has(pairKey)) {
      throw new TypeError("Story candidate response contains duplicate pairs")
    }
    seenPairs.add(pairKey)
  }

  const model = Object.freeze({
    candidateK: STORY_CANDIDATE_K,
    rerankerRevision: STORY_RERANKER_REVISION,
    embeddingDigest:
      typeof response.model.embedding_digest === "string" ? response.model.embedding_digest : null,
  })

  return Object.freeze({ candidates: Object.freeze(candidates), model })
}
