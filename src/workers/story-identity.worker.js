/**
 * Dedicated Web Worker for Story Identity (STORY-02-A1).
 *
 * Responsibilities:
 * - Offload heavy P3 clustering and projection building off the main UI thread.
 * - Receive minimal article metadata + pair scores.
 * - Compute P3 multi-member clusters and H1 StoryProjections.
 * - Return structured projections with execution timing breakdown.
 *
 * Strict Isolation:
 * - NO network calls.
 * - NO browser storage access.
 * - NO Miniflux state manipulation.
 * - NO model downloads or inference.
 */

import { runP3Clustering } from "@/utils/story-identity/story-engine"
import { buildStoryProjections } from "@/utils/story-identity/story-projection"

if (globalThis.self !== undefined) {
  globalThis.addEventListener("message", function handleWorkerMessage(event) {
    const { data } = event
    if (!data || data.type !== "RUN_STORY_PROJECTION") {
      return
    }

    const {
      requestId,
      sessionRevision,
      articleRevision,
      articles = [],
      pairScores = [],
      policy = {},
    } = data

    try {
      const t0 = performance.now()

      // 1. Run P3 conservative clustering
      const clusters = runP3Clustering(articles, pairScores, policy)
      const t1 = performance.now()

      // 2. Build StoryProjection objects
      const projections = buildStoryProjections(clusters, articles)
      const t2 = performance.now()

      globalThis.postMessage({
        type: "STORY_PROJECTION_SUCCESS",
        requestId,
        sessionRevision,
        articleRevision,
        projections,
        timingMs: {
          clusteringMs: Math.round((t1 - t0) * 1000) / 1000,
          projectionMs: Math.round((t2 - t1) * 1000) / 1000,
          totalMs: Math.round((t2 - t0) * 1000) / 1000,
        },
      })
    } catch (error) {
      globalThis.postMessage({
        type: "STORY_PROJECTION_ERROR",
        requestId,
        sessionRevision,
        articleRevision,
        error: String(error?.message || error),
      })
    }
  })
}
