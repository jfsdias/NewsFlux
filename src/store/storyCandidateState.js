import { map } from "nanostores"

const EMPTY_CANDIDATES = Object.freeze([])

const defaultValue = () => ({
  status: "idle",
  requestKey: null,
  identityKey: null,
  sessionRevision: null,
  candidates: EMPTY_CANDIDATES,
  model: null,
})

export const storyCandidateState = map(defaultValue())

export const resetStoryCandidateState = () => storyCandidateState.set(defaultValue())

export const setStoryCandidatePending = ({ requestKey, identityKey, sessionRevision }) =>
  storyCandidateState.set({
    status: "pending",
    requestKey,
    identityKey,
    sessionRevision,
    candidates: EMPTY_CANDIDATES,
    model: null,
  })

export const setStoryCandidateReady = ({
  requestKey,
  identityKey,
  sessionRevision,
  candidates,
  model,
}) =>
  storyCandidateState.set({
    status: "ready",
    requestKey,
    identityKey,
    sessionRevision,
    candidates,
    model,
  })

export const setStoryCandidateFailed = ({ requestKey, identityKey, sessionRevision }) =>
  storyCandidateState.set({
    status: "failed",
    requestKey,
    identityKey,
    sessionRevision,
    candidates: EMPTY_CANDIDATES,
    model: null,
  })
