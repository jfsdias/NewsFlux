/**
 * Constants and Feature Flags for Story Identity Runtime Plumbing (STORY-02-A1).
 *
 * Scope:
 * - Scorer-agnostic runtime plumbing.
 * - Home-only activation boundary.
 * - Strict default-off feature flag.
 * - Research policy parameters.
 */

export const STORY_IDENTITY_FEATURE_FLAG = "VITE_STORY_IDENTITY_ENABLED"

// Research policy parameters (not final production configuration)
export const STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS = 24
export const STORY_RESEARCH_MAX_CLUSTER_SIZE = 10
export const STORY_IDENTITY_DEFAULT_THRESHOLD = 0.5
export const STORY_IDENTITY_TIMEOUT_MS = 2000

export const FAIL_OPEN_REASONS = Object.freeze({
  FEATURE_DISABLED: "FEATURE_DISABLED",
  NO_PROVIDER: "NO_PROVIDER",
  PROVIDER_FAILED: "PROVIDER_FAILED",
  WORKER_FAILED: "WORKER_FAILED",
  TIMEOUT: "TIMEOUT",
  STALE_RESULT: "STALE_RESULT",
  INVALID_PROJECTION: "INVALID_PROJECTION",
  EMPTY_INPUT: "EMPTY_INPUT",
})

export const PIPELINE_STATES = Object.freeze({
  DISABLED: "disabled",
  IDLE: "idle",
  PROCESSING: "processing",
  READY: "ready",
  FAILED_OPEN: "failed-open",
})

/**
 * Strict feature flag contract:
 * - undefined, 0, false, "0", "false", null, "" -> DISABLED (false)
 * - Only explicit 1 or "1" -> ENABLED (true)
 */
export function isStoryIdentityEnabled(
  envValue = (import.meta !== undefined && import.meta.env?.VITE_STORY_IDENTITY_ENABLED) ||
    (globalThis.process !== undefined && globalThis.process?.env?.VITE_STORY_IDENTITY_ENABLED),
) {
  if (envValue === "1" || envValue === 1) {
    return true
  }
  return false
}
