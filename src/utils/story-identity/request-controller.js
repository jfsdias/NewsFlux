import {
  FAIL_OPEN_REASONS,
  isStoryIdentityEnabled,
  PIPELINE_STATES,
  STORY_IDENTITY_TIMEOUT_MS,
  STORY_RESEARCH_MAX_CLUSTER_SIZE,
  STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS,
} from "./constants"
import { NullScoreProvider } from "./null-score-provider"
import { normalizeAndValidatePairs } from "./score-provider"
import {
  computeArticleRevision,
  getFeedIdentity,
  validateStoryProjections,
} from "./story-projection"

/**
 * Story Request Controller (STORY-02-A1).
 *
 * Responsibilities:
 * - Orchestrates ScoreProvider calls, worker lifecycle, and stale fencing.
 * - Protects against stale responses when Home updates during asynchronous computation.
 * - Enforces timeout limits and fail-open guarantees.
 * - Minimizes worker payload to avoid cloning full article contents.
 * - Safe across SSR, Node test runners, and browser environments.
 */
export class StoryRequestController {
  /**
   * @param {Object} [options]
   * @param {import('./score-provider.js').ScoreProvider} [options.scoreProvider]
   * @param {() => Worker|null} [options.workerFactory]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    this.scoreProvider = options.scoreProvider ?? new NullScoreProvider()
    this.workerFactory =
      options.workerFactory ??
      (() => {
        if (typeof Worker === "undefined") {
          return null
        }
        try {
          return new Worker(new URL("../../workers/story-identity.worker.js", import.meta.url), {
            type: "module",
          })
        } catch {
          return null
        }
      })
    this.timeoutMs = options.timeoutMs ?? STORY_IDENTITY_TIMEOUT_MS

    this.activeRequestId = 0
    this.activeSessionRevision = null
    this.activeArticleRevision = null
    this.status = PIPELINE_STATES.IDLE
    this.lastFailOpenReason = null
    this.activeWorker = null
    this.workerAvailable = true
  }

  /**
   * Checks whether the given request context matches the latest active request.
   * Only the latest active request is allowed to mutate controller-global state.
   *
   * @param {string|number} requestId
   * @param {number|string} [sessionRevision]
   * @param {string} [articleRevision]
   * @returns {boolean}
   */
  isCurrentRequest(requestId, sessionRevision, articleRevision) {
    const numericId =
      typeof requestId === "string" ? Number(requestId.replace("req_", "")) : Number(requestId)
    if (this.activeRequestId !== numericId) {
      return false
    }
    if (sessionRevision !== undefined && this.activeSessionRevision !== sessionRevision) {
      return false
    }
    if (articleRevision !== undefined && this.activeArticleRevision !== articleRevision) {
      return false
    }
    return true
  }

  /**
   * Updates the active score provider.
   *
   * @param {import('./score-provider.js').ScoreProvider} provider
   */
  setScoreProvider(provider) {
    this.scoreProvider = provider ?? new NullScoreProvider()
  }

  /**
   * @returns {import('./score-provider.js').ScoreProvider}
   */
  getScoreProvider() {
    return this.scoreProvider
  }

  /**
   * Disposes any active worker instance.
   */
  dispose() {
    if (this.activeWorker) {
      try {
        this.activeWorker.terminate()
      } catch {
        // Safe disposal
      }
      this.activeWorker = null
    }
    this.status = PIPELINE_STATES.IDLE
  }

  /**
   * Coordinates processing of Home articles.
   *
   * @param {Object} params
   * @param {Array<Object>} params.articles - Live Home articles
   * @param {number|string} [params.sessionRevision=0]
   * @param {number} [params.timeoutMs]
   * @returns {Promise<{ status: string, projections: Array<Object>|null, failOpenReason: string|null, timing: Object }>}
   */
  async processHomeArticles({ articles, sessionRevision = 0, timeoutMs }) {
    const t0 = performance.now()
    const effectiveTimeout = timeoutMs ?? this.timeoutMs

    // 1. Feature Flag Gate (Section 4)
    if (!isStoryIdentityEnabled()) {
      this.status = PIPELINE_STATES.DISABLED
      this.lastFailOpenReason = FAIL_OPEN_REASONS.FEATURE_DISABLED
      return {
        status: PIPELINE_STATES.DISABLED,
        projections: null,
        failOpenReason: FAIL_OPEN_REASONS.FEATURE_DISABLED,
        timing: { totalMs: 0 },
      }
    }

    // 2. Empty input check
    if (!Array.isArray(articles) || articles.length === 0) {
      this.status = PIPELINE_STATES.READY
      this.lastFailOpenReason = FAIL_OPEN_REASONS.EMPTY_INPUT
      return {
        status: PIPELINE_STATES.READY,
        projections: [],
        failOpenReason: FAIL_OPEN_REASONS.EMPTY_INPUT,
        timing: { totalMs: 0 },
      }
    }

    // 3. Stale Fencing setup (Sections 20, 21, 22)
    const requestId = `req_${++this.activeRequestId}`
    const articleRevision = computeArticleRevision(articles)
    this.activeSessionRevision = sessionRevision
    this.activeArticleRevision = articleRevision
    this.status = PIPELINE_STATES.PROCESSING
    this.lastFailOpenReason = null

    const validArticleIds = new Set(articles.map((a) => a.id))

    // 4. Score Provider Execution (Section 6, 8, 9, 10)
    let pairResult = null
    let providerMs = 0
    try {
      const p0 = performance.now()
      const provider = this.scoreProvider ?? new NullScoreProvider()
      pairResult = await provider.scorePairs(articles, {
        requestId,
        sessionRevision,
        articleRevision,
      })
      providerMs = Math.round((performance.now() - p0) * 1000) / 1000
    } catch (error) {
      // Provider failure fails open (Section 24, 25)
      if (this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
        this.status = PIPELINE_STATES.FAILED_OPEN
        this.lastFailOpenReason = FAIL_OPEN_REASONS.PROVIDER_FAILED
      }
      return {
        status: PIPELINE_STATES.FAILED_OPEN,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: FAIL_OPEN_REASONS.PROVIDER_FAILED,
        error: String(error?.message || error),
        timing: { providerMs, totalMs: Math.round((performance.now() - t0) * 1000) / 1000 },
      }
    }

    // Check if request became stale during provider call
    if (!this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
      // Stale request: DO NOT overwrite controller-global state!
      return {
        status: PIPELINE_STATES.FAILED_OPEN,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: FAIL_OPEN_REASONS.STALE_RESULT,
        timing: { providerMs, totalMs: Math.round((performance.now() - t0) * 1000) / 1000 },
      }
    }

    // Normalize and validate candidate pairs
    const validatedPairs = normalizeAndValidatePairs(pairResult?.pairs, validArticleIds)

    // Fast path: if zero positive pairs returned (e.g. NullScoreProvider),
    // return null projections -> Home renders flat Home (Sections 8, 31)
    if (validatedPairs.length === 0) {
      if (this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
        this.status = PIPELINE_STATES.READY
        this.lastFailOpenReason = null
      }
      return {
        status: PIPELINE_STATES.READY,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: null,
        timing: {
          providerMs,
          workerMs: 0,
          totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
        },
      }
    }

    // 5. Worker Payload Minimization (Section 62)
    const minimizedArticles = articles.map((a, idx) => ({
      id: a.id,
      feedId: getFeedIdentity(a),
      title: a.title ?? "",
      publishedAt: Number(a.published_at ?? a.publishedAt ?? 0),
      homePosition: idx,
    }))

    // 6. Worker Execution with Timeout & Stale Fencing (Sections 19, 21, 26, 40, 41, 43)
    let workerResult = null
    try {
      workerResult = await this._dispatchToWorker({
        requestId,
        sessionRevision,
        articleRevision,
        articles: minimizedArticles,
        pairScores: validatedPairs,
        timeoutMs: effectiveTimeout,
      })
    } catch (error) {
      const reason =
        error?.message === "TIMEOUT" ? FAIL_OPEN_REASONS.TIMEOUT : FAIL_OPEN_REASONS.WORKER_FAILED
      if (this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
        this.status = PIPELINE_STATES.FAILED_OPEN
        this.lastFailOpenReason = reason
      }
      return {
        status: PIPELINE_STATES.FAILED_OPEN,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: reason,
        error: String(error?.message || error),
        timing: { providerMs, totalMs: Math.round((performance.now() - t0) * 1000) / 1000 },
      }
    }

    // 7. Stale Result Validation (Section 21)
    if (!this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
      // Stale request: DO NOT overwrite controller-global state!
      return {
        status: PIPELINE_STATES.FAILED_OPEN,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: FAIL_OPEN_REASONS.STALE_RESULT,
        timing: { providerMs, totalMs: Math.round((performance.now() - t0) * 1000) / 1000 },
      }
    }

    // 8. Projection Accounting & Invariant Validation (Section 27)
    const validation = validateStoryProjections(workerResult.projections, articles)
    if (!validation.valid) {
      if (this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
        this.status = PIPELINE_STATES.FAILED_OPEN
        this.lastFailOpenReason = FAIL_OPEN_REASONS.INVALID_PROJECTION
      }
      return {
        status: PIPELINE_STATES.FAILED_OPEN,
        articleRevision,
        sessionRevision,
        projections: null,
        failOpenReason: FAIL_OPEN_REASONS.INVALID_PROJECTION,
        error: validation.error,
        timing: {
          providerMs,
          workerMs: workerResult.timingMs?.totalMs ?? 0,
          totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
        },
      }
    }

    if (this.isCurrentRequest(requestId, sessionRevision, articleRevision)) {
      this.status = PIPELINE_STATES.READY
      this.lastFailOpenReason = null
    }

    return {
      status: PIPELINE_STATES.READY,
      articleRevision,
      sessionRevision,
      projections: workerResult.projections,
      failOpenReason: null,
      timing: {
        providerMs,
        workerMs: workerResult.timingMs?.totalMs ?? 0,
        totalMs: Math.round((performance.now() - t0) * 1000) / 1000,
      },
    }
  }

  /**
   * Internal helper: dispatches payload to worker with timeout racing.
   *
   * @private
   */
  _dispatchToWorker({
    requestId,
    sessionRevision,
    articleRevision,
    articles,
    pairScores,
    timeoutMs,
  }) {
    return new Promise((resolve, reject) => {
      let worker = null
      try {
        worker = this.workerFactory()
      } catch (error) {
        return reject(new Error(`Worker instantiation failed: ${error?.message || error}`))
      }

      if (!worker) {
        return reject(new Error("Worker unavailable in current runtime"))
      }

      this.activeWorker = worker

      let timer = null
      let settled = false

      const cleanup = () => {
        settled = true
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (this.activeWorker === worker) {
          this.activeWorker = null
        }
        try {
          if (typeof worker.removeEventListener === "function") {
            worker.removeEventListener("message", onMessage)
            worker.removeEventListener("error", onError)
          }
        } catch {
          // Ignore
        }
        try {
          worker.terminate()
        } catch {
          // Safe terminate
        }
      }

      const onMessage = (event) => {
        if (settled) {
          return
        }
        const { data } = event
        if (data?.requestId !== requestId) {
          return
        }

        cleanup()
        if (data.type === "STORY_PROJECTION_SUCCESS") {
          resolve(data)
        } else {
          reject(new Error(data.error || "Worker processing error"))
        }
      }

      const onError = (err) => {
        if (settled) {
          return
        }
        cleanup()
        reject(new Error(`Worker error: ${err?.message || err}`))
      }

      timer = setTimeout(() => {
        if (!settled) {
          cleanup()
          reject(new Error("TIMEOUT"))
        }
      }, timeoutMs)

      worker.addEventListener("message", onMessage)
      worker.addEventListener("error", onError)

      try {
        worker.postMessage({
          type: "RUN_STORY_PROJECTION",
          requestId,
          sessionRevision,
          articleRevision,
          articles,
          pairScores,
          policy: {
            maxTemporalSpanHours: STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS,
            maxClusterSize: STORY_RESEARCH_MAX_CLUSTER_SIZE,
            requireCrossFeed: true,
            requireKnownFeeds: true,
          },
        })
      } catch (error) {
        cleanup()
        reject(new Error(`Failed to postMessage to worker: ${error?.message || error}`))
      }
    })
  }
}

let globalController = null

/**
 * Returns the singleton StoryRequestController instance.
 *
 * @returns {StoryRequestController}
 */
export function getStoryRequestController() {
  if (!globalController) {
    globalController = new StoryRequestController()
  }
  return globalController
}

/**
 * Injects a score provider into the global controller (for dev / test harness).
 *
 * @param {import('./score-provider').ScoreProvider} provider
 */
export function setGlobalStoryScoreProvider(provider) {
  const controller = getStoryRequestController()
  controller.setScoreProvider(provider)
}

/**
 * Resets and disposes the global controller.
 */
export function resetGlobalStoryIdentity() {
  if (globalController) {
    globalController.dispose()
    globalController = null
  }
}

export default StoryRequestController
