import assert from "node:assert/strict"
import test from "node:test"

// Node's direct test runner requires the extension; Vite resolves the same module.
// eslint-disable-next-line import/extensions
const generationModule = await import("./story-candidate-generation.js")
const {
  createStoryCandidateGeneration,
  failStoryCandidateGeneration,
  invalidateStoryCandidateGeneration,
  resolveStoryCandidateGeneration,
} = generationModule

const base = {
  generationId: "story-generation-1",
  requestKey: "story-candidates:abc",
  identityKey: "https://miniflux.example|user:7",
  sessionRevision: 12,
}

const context = (generation, overrides = {}) => ({
  generationId: generation.generationId,
  requestKey: generation.requestKey,
  identityKey: generation.identityKey,
  sessionRevision: generation.sessionRevision,
  ...overrides,
})

test("commits ranked candidates only for the current Home generation", () => {
  const pending = createStoryCandidateGeneration(base)
  const candidates = Object.freeze([
    Object.freeze({ entryAId: 1, entryBId: 2, rank: 1, qwenScore: 0.8, rerankerScore: 4.2 }),
  ])
  const resolved = resolveStoryCandidateGeneration(pending, {
    ...context(pending),
    candidates,
  })

  assert.equal(resolved.status, "ready")
  assert.equal(resolved.candidates, candidates)
})

test("discards a stale session response instead of overwriting current ranking", () => {
  const pending = createStoryCandidateGeneration(base)
  const stale = resolveStoryCandidateGeneration(pending, {
    ...context(pending, { sessionRevision: 11 }),
    candidates: Object.freeze([]),
  })

  assert.equal(stale, pending)
  assert.equal(stale.status, "pending")
})

test("fails open with an empty ranking when the local service is unavailable", () => {
  const pending = createStoryCandidateGeneration(base)
  const failed = failStoryCandidateGeneration(pending, context(pending))

  assert.equal(failed.status, "failed")
  assert.deepEqual(failed.candidates, [])
})

test("invalidated Home generations discard late ranking responses", () => {
  const pending = createStoryCandidateGeneration(base)
  const invalidated = invalidateStoryCandidateGeneration(pending)
  const late = resolveStoryCandidateGeneration(invalidated, {
    ...context(invalidated),
    candidates: Object.freeze([
      Object.freeze({ entryAId: 1, entryBId: 2, rank: 1, qwenScore: 0.8, rerankerScore: 4.2 }),
    ]),
  })

  assert.equal(invalidated.status, "invalidated")
  assert.equal(late, invalidated)
  assert.deepEqual(late.candidates, [])
})
