/**
 * Saved summary model preferences versus what can execute now. Pure and read-only: a saved
 * preference is described, never rewritten or swapped for another model. Saving a preference
 * approves nothing, enables nothing and grants no consent; the Summary API decides on every
 * request (resolveSummaryRouting sends nothing for an unavailable primary).
 */
import {
  isSummaryModelId,
  SUMMARY_FALLBACK_NONE,
  SUMMARY_MODEL_AUTO,
} from "./article-intelligence-profile.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const describeEntry = (modelId, catalog) => {
  const entry = catalog.models.find((model) => model.id === modelId)
  if (!entry) {
    return { state: "saved_missing", modelId, reason: "NOT_IN_CATALOG" }
  }
  if (entry.available) {
    return { state: "executable", modelId, reason: null }
  }
  return { state: "saved_unavailable", modelId, reason: entry.unavailableReason ?? null }
}

export const describePrimaryPreference = (preference, catalog) => {
  if (!catalog) {
    return { state: "catalog_unavailable", modelId: null, reason: null }
  }
  const modelId = preference === SUMMARY_MODEL_AUTO ? catalog.default_model_id : preference
  if (!isSummaryModelId(modelId)) {
    return { state: "invalid", modelId: null, reason: null }
  }
  return describeEntry(modelId, catalog)
}

export const describeFallbackPreference = (settings = {}, catalog) => {
  if (settings.aiSummaryFallbackEnabled !== true) {
    return { state: "off", modelId: null, reason: null }
  }
  const fallback = settings.aiSummaryFallbackModel
  if ([undefined, null, SUMMARY_FALLBACK_NONE].includes(fallback)) {
    return { state: "none", modelId: null, reason: null }
  }
  if (!isSummaryModelId(fallback)) {
    return { state: "invalid", modelId: null, reason: null }
  }
  if (!catalog) {
    return { state: "catalog_unavailable", modelId: fallback, reason: null }
  }
  const primary = describePrimaryPreference(settings.aiSummaryModel, catalog)
  if (primary.modelId === fallback) {
    return { state: "same_as_primary", modelId: fallback, reason: null }
  }
  const described = describeEntry(fallback, catalog)
  if (described.state !== "executable") {
    return described
  }
  if (primary.state !== "executable") {
    return { state: "saved_waiting_for_primary", modelId: fallback, reason: null }
  }
  // Eligible to be sent; the server still revalidates it at the moment of the attempt.
  return { state: "eligible", modelId: fallback, reason: null }
}
