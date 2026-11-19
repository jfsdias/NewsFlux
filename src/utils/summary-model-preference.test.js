import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveSummaryRouting } from "./article-intelligence-profile.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.
import {
  describeFallbackPreference,
  describePrimaryPreference,
} from "./summary-model-preference.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const entry = (id, available, unavailableReason = null) => ({ id, available, unavailableReason })
const catalog = (models, defaultModelId = "s5-free") => ({
  default_model_id: defaultModelId,
  models,
})
// LEGACY with inference OFF: every model is listed, none executable.
const inert = catalog([
  entry("s5-free", false, "INFERENCE_DISABLED"),
  entry("mistral-small", false, "INFERENCE_DISABLED"),
])
const live = catalog([
  entry("s5-free", true),
  entry("mistral-small", true),
  entry("gw-a", false, "OPERATOR_APPROVAL_REQUIRED"),
])

test("a saved primary is a preference; executable only when the catalog says so", () => {
  assert.deepEqual(describePrimaryPreference("s5-free", null), {
    state: "catalog_unavailable",
    modelId: null,
    reason: null,
  })
  assert.deepEqual(describePrimaryPreference("s5-free", live), {
    state: "executable",
    modelId: "s5-free",
    reason: null,
  })
  assert.deepEqual(describePrimaryPreference("s5-free", inert), {
    state: "saved_unavailable",
    modelId: "s5-free",
    reason: "INFERENCE_DISABLED",
  })
  assert.deepEqual(describePrimaryPreference("auto", inert), {
    state: "saved_unavailable",
    modelId: "s5-free",
    reason: "INFERENCE_DISABLED",
  })
  assert.equal(describePrimaryPreference("auto", live).state, "executable")
  assert.equal(describePrimaryPreference("../x", live).state, "invalid")
})

test("a preference for a model no longer in the catalog is preserved, never executed", () => {
  const migrated = catalog([entry("gw-a", false, "OPERATOR_APPROVAL_REQUIRED")], "gw-a")
  assert.deepEqual(describePrimaryPreference("s5-free", migrated), {
    state: "saved_missing",
    modelId: "s5-free",
    reason: "NOT_IN_CATALOG",
  })
  const routing = resolveSummaryRouting(
    {
      aiSummaryModel: "s5-free",
      aiSummaryFallbackEnabled: true,
      aiSummaryFallbackModel: "mistral-small",
    },
    migrated,
  )
  assert.equal(routing.modelId, null)
  assert.equal(routing.fallbackModelId, null)
})

test("fallback states: off, none, same as primary, missing, unavailable, waiting, eligible", () => {
  const base = { aiSummaryModel: "s5-free", aiSummaryFallbackEnabled: true }
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackEnabled: false }, live).state,
    "off",
  )
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "none" }, live).state,
    "none",
  )
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "s5-free" }, live).state,
    "same_as_primary",
  )
  assert.equal(
    describeFallbackPreference(
      { ...base, aiSummaryModel: "auto", aiSummaryFallbackModel: "s5-free" },
      live,
    ).state,
    "same_as_primary",
  )
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "gone" }, live).state,
    "saved_missing",
  )
  assert.deepEqual(describeFallbackPreference({ ...base, aiSummaryFallbackModel: "gw-a" }, live), {
    state: "saved_unavailable",
    modelId: "gw-a",
    reason: "OPERATOR_APPROVAL_REQUIRED",
  })
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "mistral-small" }, inert).state,
    "saved_unavailable",
  )
  const waiting = catalog([
    entry("s5-free", false, "INFERENCE_DISABLED"),
    entry("mistral-small", true),
  ])
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "mistral-small" }, waiting).state,
    "saved_waiting_for_primary",
  )
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "mistral-small" }, live).state,
    "eligible",
  )
  assert.equal(
    describeFallbackPreference({ ...base, aiSummaryFallbackModel: "../x" }, live).state,
    "invalid",
  )
})

test("the description agrees with routing: only an eligible fallback is ever sent", () => {
  const cases = [
    [live, "mistral-small", "s5-free"],
    [live, "s5-free", "s5-free"],
    [live, "gw-a", "s5-free"],
    [live, "gone", "s5-free"],
    [inert, "mistral-small", "s5-free"],
    [catalog([entry("s5-free", false), entry("mistral-small", true)]), "mistral-small", "s5-free"],
  ]
  for (const [current, fallback, primary] of cases) {
    const settings = {
      aiSummaryModel: primary,
      aiSummaryFallbackEnabled: true,
      aiSummaryFallbackModel: fallback,
    }
    const described = describeFallbackPreference(settings, current).state
    const routing = resolveSummaryRouting(settings, current)
    if (described === "eligible") {
      assert.equal(routing.fallbackModelId, fallback)
    }
    if (routing.modelId === null) {
      // No primary request means no fallback request: nothing is substituted silently.
      assert.equal(routing.fallbackModelId, null)
    }
  }
})

test("describing a preference never rewrites it", () => {
  const settings = Object.freeze({
    aiSummaryModel: "s5-free",
    aiSummaryFallbackEnabled: true,
    aiSummaryFallbackModel: "s5-free",
  })
  describePrimaryPreference(settings.aiSummaryModel, inert)
  describeFallbackPreference(settings, inert)
  assert.equal(settings.aiSummaryFallbackModel, "s5-free")
})
