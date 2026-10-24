import assert from "node:assert/strict"
import test from "node:test"

// Node's direct test runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
const requestModule = await import("./story-candidate-request.js")
const {
  STORY_CANDIDATE_ENTRY_LIMIT,
  createStoryCandidateRequest,
  normalizeStoryCandidateResponse,
} = requestModule

const entry = (overrides = {}) => ({
  id: 10,
  title: "  Example headline  ",
  published_at: "2026-10-23T12:00:00Z",
  feed: { id: 3 },
  ...overrides,
})

test("normalizes Home entries to the minimal story-ranking contract", () => {
  const request = createStoryCandidateRequest([
    entry({ id: 11, published_at: "2026-10-23T12:00:00Z" }),
    entry({ id: 9, published_at: "2026-10-24T12:00:00Z", feed: { id: 7 } }),
    entry({ id: 10, title: "Duplicate ignored" }),
    entry(),
    entry({ id: null }),
  ])

  assert.equal(STORY_CANDIDATE_ENTRY_LIMIT, 200)
  assert.deepEqual(request.entries, [
    {
      id: 9,
      feed_id: 7,
      published_at: "2026-10-24T12:00:00Z",
      title: "Example headline",
    },
    {
      id: 10,
      feed_id: 3,
      published_at: "2026-10-23T12:00:00Z",
      title: "Example headline",
    },
    {
      id: 11,
      feed_id: 3,
      published_at: "2026-10-23T12:00:00Z",
      title: "Example headline",
    },
  ])
  assert.match(request.requestKey, /^story-candidates:/)
})

test("caps the candidate snapshot at the 200 newest valid entries", () => {
  const entries = Array.from({ length: 205 }, (_, index) =>
    entry({
      id: index + 1,
      published_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }),
  )

  const request = createStoryCandidateRequest(entries)

  assert.equal(request.entries.length, 200)
  assert.equal(request.entries[0].id, 205)
  assert.equal(request.entries.at(-1).id, 6)
})

test("rejects response fields that could silently turn ranking into identity decisions", () => {
  assert.throws(
    () =>
      normalizeStoryCandidateResponse({
        candidates: [
          {
            entry_a_id: 10,
            entry_b_id: 11,
            rank: 1,
            qwen_score: 0.7,
            reranker_score: 2.1,
            same_story: true,
          },
        ],
      }),
    /identity decision/i,
  )
})

test("accepts ranked pairs only and freezes the normalized response", () => {
  const normalized = normalizeStoryCandidateResponse({
    candidates: [
      {
        entry_a_id: 10,
        entry_b_id: 11,
        rank: 1,
        qwen_score: 0.7,
        reranker_score: 2.1,
      },
    ],
    model: {
      candidate_k: 250,
      reranker_revision: "e61197ed45024b0ed8a2d74b80b4d909f1255473",
    },
  })

  assert.deepEqual(normalized.candidates, [
    {
      entryAId: 10,
      entryBId: 11,
      rank: 1,
      qwenScore: 0.7,
      rerankerScore: 2.1,
    },
  ])
  assert.equal(Object.isFrozen(normalized), true)
  assert.equal(Object.isFrozen(normalized.candidates), true)
})
