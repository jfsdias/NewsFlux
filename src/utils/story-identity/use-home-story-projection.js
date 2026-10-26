import { useEffect, useState } from "react"

import { isStoryIdentityEnabled } from "./constants"
import { applyStoryProjection } from "./home-story-adapter"
import { getStoryRequestController } from "./request-controller"

/**
 * React hook for optional Home-only Story Identity projection.
 *
 * Invariants:
 * - When feature flag is off: returns null (zero worker creation, zero overhead).
 * - When provider is NullScoreProvider (default): returns null (flat Home).
 * - When fixture provider is injected: returns projected items preserving H1 placement.
 * - Always fails open: on any error, returns null, preserving flat Home.
 *
 * @param {Object} params
 * @param {Array<Object>} params.recentEntries - Flat recent entries array
 * @param {number|string} params.sessionRevision - Current session revision
 * @returns {Array<import('./home-story-adapter').HomeItem> | null}
 */
export function useHomeStoryProjection({ recentEntries, sessionRevision }) {
  const isEnabled =
    isStoryIdentityEnabled() && Array.isArray(recentEntries) && recentEntries.length > 0
  const [projectedItems, setProjectedItems] = useState(null)

  useEffect(() => {
    if (!isEnabled) {
      return
    }

    let disposed = false
    const controller = getStoryRequestController()

    controller
      .processHomeArticles({
        articles: recentEntries,
        sessionRevision,
      })
      .then((result) => {
        if (disposed) {
          return null
        }
        if (result?.status === "ready" && Array.isArray(result?.projections)) {
          const items = applyStoryProjection(recentEntries, result.projections)
          setProjectedItems(items)
        } else {
          setProjectedItems(null)
        }
        return null
      })
      .catch(() => {
        if (!disposed) {
          setProjectedItems(null)
        }
        return null
      })

    return () => {
      disposed = true
    }
  }, [isEnabled, recentEntries, sessionRevision])

  return isEnabled ? projectedItems : null
}

export default useHomeStoryProjection
