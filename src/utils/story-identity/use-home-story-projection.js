import { useEffect, useRef, useState } from "react"

import { isStoryIdentityEnabled } from "./constants"
import { applyStoryProjection } from "./home-story-adapter"
import { getStoryRequestController } from "./request-controller"
import { computeArticleRevision } from "./story-projection"

/**
 * Pure lifecycle helper for Home Story Identity projection context (STORY-02-A1 R1).
 *
 * Encapsulates the core decision boundaries:
 * - Is feature enabled?
 * - What is the semantic article revision?
 * - What is the projection key (sessionRevision + articleRevision)?
 * - Is the currently held projection applicable to this exact context?
 * - Given current live articles and valid projections, what are the live adapted items?
 *
 * @param {Object} params
 * @param {Array<Object>} params.recentEntries
 * @param {number|string} params.sessionRevision
 * @param {Object|null} params.projectionState - { projectionKey, projections }
 * @param {boolean} [params.isFlagEnabled]
 * @returns {Object}
 */
export function getHomeStoryProjectionContext({
  recentEntries,
  sessionRevision,
  projectionState,
  isFlagEnabled = isStoryIdentityEnabled(),
}) {
  const isEnabled =
    Boolean(isFlagEnabled) && Array.isArray(recentEntries) && recentEntries.length > 0
  const articleRevision = isEnabled ? computeArticleRevision(recentEntries) : ""
  const projectionKey = isEnabled ? `${sessionRevision}_${articleRevision}` : ""

  const isCurrent =
    isEnabled &&
    projectionState?.projectionKey === projectionKey &&
    Array.isArray(projectionState?.projections)

  const activeProjections = isCurrent ? projectionState.projections : null
  const projectedItems = activeProjections
    ? applyStoryProjection(recentEntries, activeProjections)
    : null

  return {
    isEnabled,
    articleRevision,
    projectionKey,
    isCurrent,
    activeProjections,
    projectedItems,
  }
}

/**
 * React hook for optional Home-only Story Identity projection (STORY-02-A1 R1).
 *
 * Invariants & Lifecycle Guarantees:
 * - When feature flag is off: returns null (zero worker creation, zero overhead).
 * - When provider is NullScoreProvider (default): returns null (flat Home).
 * - Recomputation triggers on semantic identity revision, NOT raw array reference.
 * - Stores StoryProjection[] in state, NOT adapted article snapshots.
 * - Live Home adaptation runs on every render with current live article objects.
 * - Read/star mutations do not recompute stories.
 * - Identity or session changes immediately invalidate old projections (yield flat Home).
 * - Always fails open: on any error or timeout, returns null (flat Home).
 *
 * @param {Object} params
 * @param {Array<Object>} params.recentEntries - Flat recent entries array
 * @param {number|string} params.sessionRevision - Current session revision
 * @returns {Array<import('./home-story-adapter').HomeItem> | null}
 */
export function useHomeStoryProjection({ recentEntries, sessionRevision }) {
  const isEnabled =
    isStoryIdentityEnabled() && Array.isArray(recentEntries) && recentEntries.length > 0
  const articleRevision = isEnabled ? computeArticleRevision(recentEntries) : ""
  const currentProjectionKey = isEnabled ? `${sessionRevision}_${articleRevision}` : ""

  const recentEntriesRef = useRef(recentEntries)
  useEffect(() => {
    recentEntriesRef.current = recentEntries
  })

  const [projectionState, setProjectionState] = useState(null)

  useEffect(() => {
    if (!isEnabled || !articleRevision) {
      return
    }

    let disposed = false
    const controller = getStoryRequestController()
    const targetKey = currentProjectionKey
    const targetRevision = articleRevision

    controller
      .processHomeArticles({
        articles: recentEntriesRef.current,
        sessionRevision,
      })
      .then((result) => {
        if (disposed) {
          return null
        }
        if (
          result?.status === "ready" &&
          Array.isArray(result?.projections) &&
          result.articleRevision === targetRevision
        ) {
          setProjectionState({
            projectionKey: targetKey,
            projections: result.projections,
          })
        } else {
          setProjectionState(null)
        }
        return null
      })
      .catch(() => {
        if (!disposed) {
          setProjectionState(null)
        }
        return null
      })

    return () => {
      disposed = true
    }
  }, [isEnabled, articleRevision, sessionRevision, currentProjectionKey])

  const context = getHomeStoryProjectionContext({
    recentEntries,
    sessionRevision,
    projectionState,
    isFlagEnabled: isEnabled,
  })

  return context.projectedItems
}

export default useHomeStoryProjection
