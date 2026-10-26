/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  FAIL_OPEN_REASONS,
  isStoryIdentityEnabled,
  PIPELINE_STATES,
  STORY_IDENTITY_DEFAULT_THRESHOLD,
  STORY_IDENTITY_FEATURE_FLAG,
  STORY_IDENTITY_TIMEOUT_MS,
  STORY_RESEARCH_MAX_CLUSTER_SIZE,
  STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS,
} from "./constants.js"

test("feature flag strictly requires explicit '1' or 1", () => {
  // Disabled cases (Section 4, 45)
  assert.equal(isStoryIdentityEnabled(), false)
  assert.equal(isStoryIdentityEnabled(null), false)
  assert.equal(isStoryIdentityEnabled(""), false)
  assert.equal(isStoryIdentityEnabled(0), false)
  assert.equal(isStoryIdentityEnabled("0"), false)
  assert.equal(isStoryIdentityEnabled(false), false)
  assert.equal(isStoryIdentityEnabled("false"), false)
  assert.equal(isStoryIdentityEnabled("true"), false)
  assert.equal(isStoryIdentityEnabled("yes"), false)
  assert.equal(isStoryIdentityEnabled("2"), false)

  // Explicit enabled cases
  assert.equal(isStoryIdentityEnabled("1"), true)
  assert.equal(isStoryIdentityEnabled(1), true)
})

test("constants reflect research plumbing parameters", () => {
  assert.equal(STORY_IDENTITY_FEATURE_FLAG, "VITE_STORY_IDENTITY_ENABLED")
  assert.equal(STORY_RESEARCH_MAX_TEMPORAL_SPAN_HOURS, 24)
  assert.equal(STORY_RESEARCH_MAX_CLUSTER_SIZE, 10)
  assert.equal(STORY_IDENTITY_DEFAULT_THRESHOLD, 0.5)
  assert.equal(STORY_IDENTITY_TIMEOUT_MS, 2000)
})

test("fail-open reasons and pipeline states are frozen enums", () => {
  assert.ok(Object.isFrozen(FAIL_OPEN_REASONS))
  assert.ok(Object.isFrozen(PIPELINE_STATES))

  assert.equal(FAIL_OPEN_REASONS.FEATURE_DISABLED, "FEATURE_DISABLED")
  assert.equal(FAIL_OPEN_REASONS.PROVIDER_FAILED, "PROVIDER_FAILED")
  assert.equal(FAIL_OPEN_REASONS.WORKER_FAILED, "WORKER_FAILED")
  assert.equal(FAIL_OPEN_REASONS.TIMEOUT, "TIMEOUT")
  assert.equal(FAIL_OPEN_REASONS.STALE_RESULT, "STALE_RESULT")
  assert.equal(FAIL_OPEN_REASONS.INVALID_PROJECTION, "INVALID_PROJECTION")
})
