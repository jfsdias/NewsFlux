const matchesGeneration = (generation, context) =>
  generation &&
  context &&
  context.generationId === generation.generationId &&
  context.requestKey === generation.requestKey &&
  context.identityKey === generation.identityKey &&
  context.sessionRevision === generation.sessionRevision

const EMPTY_CANDIDATES = Object.freeze([])

export const createStoryCandidateGeneration = ({
  generationId,
  requestKey,
  identityKey,
  sessionRevision,
}) => ({
  generationId,
  requestKey,
  identityKey,
  sessionRevision,
  status: "pending",
  candidates: EMPTY_CANDIDATES,
})

export const resolveStoryCandidateGeneration = (generation, context) => {
  if (!matchesGeneration(generation, context) || generation.status !== "pending") {
    return generation
  }

  return {
    ...generation,
    status: "ready",
    candidates: context.candidates,
  }
}

export const failStoryCandidateGeneration = (generation, context) => {
  if (!matchesGeneration(generation, context) || generation.status !== "pending") {
    return generation
  }

  return {
    ...generation,
    status: "failed",
    candidates: EMPTY_CANDIDATES,
  }
}

export const invalidateStoryCandidateGeneration = (generation) => {
  if (!generation || generation.status !== "pending") {
    return generation
  }

  return {
    ...generation,
    status: "invalidated",
    candidates: EMPTY_CANDIDATES,
  }
}
