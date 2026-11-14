// Closed, versioned summary options. The browser stores and sends identifiers only;
// the Summary API maps them to fixed server-side instructions.
const SUMMARY_PROFILE_VERSION = "summary-profile-v1"
export const SUMMARY_MODEL_IDS = ["s5-free", "mistral-small"]
export const SUMMARY_MODEL_AUTO = "auto"
export const SUMMARY_LENGTHS = ["brief", "standard", "detailed"]
export const SUMMARY_FOCUSES = [
  "factual_synthesis",
  "key_points",
  "facts_figures",
  "context_implications",
  "actions_next_steps",
  "limitations_open_questions",
]
export const SUMMARY_SECTIONS = [
  "summary",
  "key_points",
  "facts",
  "implications",
  "actions",
  "limitations",
]
export const SUMMARY_LANGUAGES = ["pt-BR", "original"]

export const DEFAULT_SUMMARY_FOCUS = [
  "factual_synthesis",
  "key_points",
  "limitations_open_questions",
]
export const DEFAULT_SUMMARY_SECTIONS = ["summary", "key_points", "limitations"]

export const SECTION_RESPONSE_FIELDS = {
  key_points: "key_points",
  facts: "facts",
  implications: "implications",
  actions: "action_points",
  limitations: "open_questions",
}

const canonicalSubset = (value, allowed) => {
  if (!Array.isArray(value)) {
    return null
  }
  const selected = new Set(value.filter((item) => typeof item === "string"))
  return allowed.filter((item) => selected.has(item))
}

export const sanitizeSummaryFocus = (value, fallback) => {
  const subset = canonicalSubset(value, SUMMARY_FOCUSES)
  if (subset && subset.length > 0) {
    return subset
  }
  return canonicalSubset(fallback, SUMMARY_FOCUSES)?.length
    ? canonicalSubset(fallback, SUMMARY_FOCUSES)
    : [...DEFAULT_SUMMARY_FOCUS]
}

export const sanitizeSummarySections = (value, fallback) => {
  const subset = canonicalSubset(value, SUMMARY_SECTIONS)
  if (subset && subset.includes("summary")) {
    return subset
  }
  const fallbackSubset = canonicalSubset(fallback, SUMMARY_SECTIONS)
  return fallbackSubset?.includes("summary") ? fallbackSubset : [...DEFAULT_SUMMARY_SECTIONS]
}

export const buildSummaryProfile = (settings = {}) => ({
  version: SUMMARY_PROFILE_VERSION,
  length: SUMMARY_LENGTHS.includes(settings.aiSummaryLength)
    ? settings.aiSummaryLength
    : "standard",
  focus: sanitizeSummaryFocus(settings.aiSummaryFocus, DEFAULT_SUMMARY_FOCUS),
  sections: sanitizeSummarySections(settings.aiSummarySections, DEFAULT_SUMMARY_SECTIONS),
  language: SUMMARY_LANGUAGES.includes(settings.aiSummaryLanguage)
    ? settings.aiSummaryLanguage
    : "pt-BR",
})

// No silent substitution: a stored choice that the catalog does not authorize is an error,
// never a different model. "auto" follows the operator default.
export const resolveSummaryModel = (preference, catalog) => {
  if (!catalog) {
    return { modelId: null, reason: "catalog_unavailable" }
  }
  const modelId = preference === SUMMARY_MODEL_AUTO ? catalog.default_model_id : preference
  if (!SUMMARY_MODEL_IDS.includes(modelId)) {
    return { modelId: null, reason: "model_unavailable" }
  }
  const entry = catalog.models.find((model) => model.id === modelId)
  if (!entry?.available) {
    return { modelId: null, reason: "model_unavailable" }
  }
  return { modelId, entry, reason: null }
}
