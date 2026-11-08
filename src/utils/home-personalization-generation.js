const matchesGeneration = (generation, context) =>
  generation &&
  context &&
  (context.generationId == null || context.generationId === generation.generationId) &&
  context.requestKey === generation.requestKey &&
  (context.canonicalRequestKey == null ||
    context.canonicalRequestKey === generation.canonicalRequestKey) &&
  context.identityKey === generation.identityKey &&
  context.sessionRevision === generation.sessionRevision

const freezeProjection = (projection) =>
  Object.freeze({
    ...projection,
    highlightIds: Object.freeze([...(projection?.highlightIds ?? [])]),
    recentIds: Object.freeze([...(projection?.recentIds ?? [])]),
  })

export const createHomePersonalizationGeneration = ({
  generationId,
  requestKey,
  identityKey,
  sessionRevision,
  canonicalRequestKey = null,
  targetSnapshotRevision = null,
  previousProjection = null,
}) => ({
  generationId,
  requestKey,
  identityKey,
  sessionRevision,
  canonicalRequestKey,
  targetSnapshotRevision,
  status: "pending",
  profileStatus: "pending",
  profile: null,
  previousProjection,
  visibleProjection: previousProjection,
  projection: null,
  projectionApplied: false,
  disclosureVisible: false,
})

export const resolveHomePersonalizationProfile = (generation, { ...result }) => {
  if (
    !matchesGeneration(generation, result) ||
    generation.status !== "pending" ||
    generation.profileStatus !== "pending"
  ) {
    return generation
  }

  return { ...generation, profileStatus: "ready", profile: result.profile }
}

export const failHomePersonalizationProfile = (generation, context) => {
  if (
    !matchesGeneration(generation, context) ||
    generation.status !== "pending" ||
    generation.profileStatus !== "pending"
  ) {
    return generation
  }

  return { ...generation, profileStatus: "failed", profile: null }
}

export const commitHomePersonalizationSnapshot = (generation, { ...snapshot }) => {
  if (!matchesGeneration(generation, snapshot) || generation.status !== "pending") {
    return {
      generation,
      committed: false,
      projection: generation?.visibleProjection ?? null,
    }
  }

  const useProfile = generation.profileStatus === "ready" && generation.profile != null
  const projection = freezeProjection(
    useProfile ? snapshot.personalizedProjection : snapshot.baselineProjection,
  )
  const projectionApplied = Boolean(useProfile && projection.personalizationApplied)
  const nextGeneration = {
    ...generation,
    status: "committed",
    visibleProjection: projection,
    projection,
    projectionApplied,
    disclosureVisible: Boolean(projectionApplied && snapshot.disclosureVisible),
  }

  return { generation: nextGeneration, committed: true, projection }
}

export const failHomePersonalizationSnapshot = (generation, context) => {
  if (!matchesGeneration(generation, context) || generation.status !== "pending") {
    return generation
  }

  return {
    ...generation,
    status: "canonical-failed",
    profile: null,
    visibleProjection: generation.previousProjection,
    projectionApplied: false,
    disclosureVisible: false,
  }
}

export const invalidateHomePersonalizationGeneration = (generation) => {
  if (!generation || generation.status !== "pending") {
    return generation
  }

  return {
    ...generation,
    status: "invalidated",
    profileStatus: "discarded",
    profile: null,
  }
}
