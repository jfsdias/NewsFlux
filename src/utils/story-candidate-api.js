// Node's direct contract tests require explicit sibling extensions.
import {
  createStoryCandidateRequest,
  normalizeStoryCandidateResponse,
  STORY_CANDIDATE_K,
  STORY_EMBEDDING_DIGEST,
  STORY_RERANKER_REVISION,
} from "./story-candidate-request.js" // eslint-disable-line import/extensions

export const STORY_CANDIDATE_ENDPOINT = "/api/story-candidates/v1/rank"

const emptyResponse = () =>
  normalizeStoryCandidateResponse({
    candidates: [],
    model: {
      candidate_k: STORY_CANDIDATE_K,
      embedding_digest: STORY_EMBEDDING_DIGEST,
      reranker_revision: STORY_RERANKER_REVISION,
    },
  })

export const getStoryCandidates = async (
  entries,
  { fetchImpl = globalThis.fetch, signal } = {},
) => {
  const request = createStoryCandidateRequest(entries)
  if (request.entries.length < 2) {
    return emptyResponse()
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Story candidate ranking requires fetch")
  }

  const response = await fetchImpl(STORY_CANDIDATE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entries: request.entries }),
    signal,
  })

  if (!response?.ok) {
    throw new Error(`Story candidate ranking failed with HTTP ${response?.status ?? "unknown"}`)
  }

  return normalizeStoryCandidateResponse(await response.json())
}
