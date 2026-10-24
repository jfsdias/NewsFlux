import { getStoryCandidates } from "../apis/storyCandidates.js"
import {
  setStoryCandidateFailed,
  setStoryCandidatePending,
  setStoryCandidateReady,
} from "../store/storyCandidateState.js"
import {
  createStoryCandidateGeneration,
  failStoryCandidateGeneration,
  invalidateStoryCandidateGeneration,
  resolveStoryCandidateGeneration,
} from "./story-candidate-generation.js"
import {
  STORY_CANDIDATE_ENTRY_LIMIT,
  createStoryCandidateRequest,
} from "./story-candidate-request.js"

const validTargetCount = (content) => {
  const total = Number(content?.total)
  if (!Number.isSafeInteger(total) || total < 2) {
    return null
  }
  return Math.min(STORY_CANDIDATE_ENTRY_LIMIT, total)
}

const isHomeSnapshotReady = (content) =>
  content?.infoFrom === "home" &&
  content?.isArticleListReady === true &&
  !content?.articleListError &&
  Array.isArray(content?.entries)

export const startHomeStoryCandidateRuntime = ({
  contentStore,
  identityKey,
  sessionRevision,
  getCandidates = getStoryCandidates,
  onPending = setStoryCandidatePending,
  onReady = setStoryCandidateReady,
  onFailed = setStoryCandidateFailed,
}) => {
  let disposed = false
  let generation = null
  let generationSequence = 0
  let completedRequestKey = null
  let abortController = null

  const currentContext = (current) => ({
    generationId: current.generationId,
    requestKey: current.requestKey,
    identityKey: current.identityKey,
    sessionRevision: current.sessionRevision,
  })

  const invalidatePending = () => {
    if (generation?.status === "pending") {
      generation = invalidateStoryCandidateGeneration(generation)
    }
    abortController?.abort()
    abortController = null
  }

  const refresh = (content = contentStore.get()) => {
    if (disposed || !isHomeSnapshotReady(content)) {
      return
    }

    const targetCount = validTargetCount(content)
    if (targetCount === null || content.entries.length < targetCount) {
      return
    }

    const request = createStoryCandidateRequest(content.entries)
    if (request.entries.length < targetCount) {
      return
    }
    if (request.requestKey === completedRequestKey || generation?.requestKey === request.requestKey) {
      return
    }

    invalidatePending()
    const nextGeneration = createStoryCandidateGeneration({
      generationId: `story-${sessionRevision}-${++generationSequence}`,
      requestKey: request.requestKey,
      identityKey,
      sessionRevision,
    })
    generation = nextGeneration
    abortController = new AbortController()
    onPending({ requestKey: request.requestKey, identityKey, sessionRevision })

    Promise.resolve(
      getCandidates(content.entries, {
        signal: abortController.signal,
      }),
    )
      .then((response) => {
        if (disposed || generation?.generationId !== nextGeneration.generationId) {
          return
        }
        const resolved = resolveStoryCandidateGeneration(generation, {
          ...currentContext(nextGeneration),
          candidates: response.candidates,
        })
        if (resolved === generation && resolved.status !== "ready") {
          return
        }
        generation = resolved
        completedRequestKey = nextGeneration.requestKey
        abortController = null
        onReady({
          requestKey: nextGeneration.requestKey,
          identityKey,
          sessionRevision,
          candidates: response.candidates,
          model: response.model,
        })
      })
      .catch((error) => {
        if (
          disposed ||
          error?.name === "AbortError" ||
          generation?.generationId !== nextGeneration.generationId
        ) {
          return
        }
        const failed = failStoryCandidateGeneration(generation, currentContext(nextGeneration))
        if (failed === generation && failed.status !== "failed") {
          return
        }
        generation = failed
        completedRequestKey = nextGeneration.requestKey
        abortController = null
        onFailed({ requestKey: nextGeneration.requestKey, identityKey, sessionRevision })
      })
  }

  const unsubscribe = contentStore.listen(refresh)
  queueMicrotask(() => refresh())

  return {
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      unsubscribe()
      invalidatePending()
    },
  }
}
