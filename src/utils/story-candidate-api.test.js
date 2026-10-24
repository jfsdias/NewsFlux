import assert from "node:assert/strict"
import test from "node:test"

// Node's direct test runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
const apiModule = await import("./story-candidate-api.js")
const { getStoryCandidates } = apiModule

const entries = [
  {
    id: 1,
    title: "Headline A",
    published_at: "2026-10-23T12:00:00Z",
    feed: { id: 10 },
  },
  {
    id: 2,
    title: "Headline B",
    published_at: "2026-10-23T13:00:00Z",
    feed: { id: 20 },
  },
]

test("posts only minimal article metadata to the same-origin rank endpoint", async () => {
  const calls = []
  const fetchImpl = async (...args) => {
    calls.push(args)
    return {
      ok: true,
      json: async () => ({
        candidates: [
          { entry_a_id: 1, entry_b_id: 2, rank: 1, qwen_score: 0.8, reranker_score: 4.2 },
        ],
        model: {
          candidate_k: 250,
          embedding_digest: "ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d",
          reranker_revision: "e61197ed45024b0ed8a2d74b80b4d909f1255473",
        },
      }),
    }
  }

  const result = await getStoryCandidates(entries, { fetchImpl })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], "/api/story-candidates/v1/rank")
  assert.equal(calls[0][1].method, "POST")
  assert.deepEqual(JSON.parse(calls[0][1].body), {
    entries: [
      { id: 2, feed_id: 20, published_at: "2026-10-23T13:00:00Z", title: "Headline B" },
      { id: 1, feed_id: 10, published_at: "2026-10-23T12:00:00Z", title: "Headline A" },
    ],
  })
  assert.equal(result.candidates[0].rank, 1)
})

test("throws on service failure so Home can fail open without changing its projection", async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 })

  await assert.rejects(() => getStoryCandidates(entries, { fetchImpl }), /503/)
})
