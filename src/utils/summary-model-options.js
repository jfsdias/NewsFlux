/**
 * Options for the summary model pickers (Settings → Reading → Article intelligence). Pure and
 * read-only: it lists what the catalog offers and the saved preference as it is. It never
 * rewrites, swaps or approves a model; the server decides on every request.
 *
 * Every catalog entry appears once per picker (the catalog validators refuse a repeated ID), and
 * a saved preference gets its own "saved, no longer offered" row only when the catalog does not
 * list it. Two distinct entries that share a label are both kept (they are different models to
 * the server) and marked sameLabel, so the picker can tell them apart by ID.
 */
import {
  isSummaryModelId,
  SUMMARY_FALLBACK_NONE,
  SUMMARY_MODEL_AUTO,
} from "./article-intelligence-profile.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const modelOption = (model, models) => ({
  type: "model",
  value: model.id,
  model,
  disabled: false,
  sameLabel: models.some((other) => other !== model && other.label === model.label),
})

/** "Automatic", every catalog model, then the saved primary when the catalog no longer lists it. */
export const buildPrimaryModelOptions = (catalog, savedModelId) => {
  if (!catalog) {
    return []
  }
  const defaultModel = catalog.models.find((model) => model.id === catalog.default_model_id)
  const options = [
    {
      type: "auto",
      value: SUMMARY_MODEL_AUTO,
      model: defaultModel ?? null,
      disabled: !defaultModel?.available,
    },
    ...catalog.models.map((model) => modelOption(model, catalog.models)),
  ]
  if (
    isSummaryModelId(savedModelId) &&
    !catalog.models.some((model) => model.id === savedModelId)
  ) {
    options.push({ type: "missing", value: savedModelId, model: null, disabled: true })
  }
  return options
}

/**
 * "No fallback", every catalog model except the effective primary, then the saved fallback when
 * the catalog no longer lists it. A saved fallback equal to the primary is not added back.
 */
export const buildFallbackModelOptions = (catalog, primaryModelId, savedModelId) => {
  if (!catalog) {
    return []
  }
  const options = [
    { type: "none", value: SUMMARY_FALLBACK_NONE, model: null, disabled: false },
    ...catalog.models
      .filter((model) => model.id !== primaryModelId)
      .map((model) => modelOption(model, catalog.models)),
  ]
  if (
    isSummaryModelId(savedModelId) &&
    savedModelId !== primaryModelId &&
    !catalog.models.some((model) => model.id === savedModelId)
  ) {
    options.push({ type: "missing", value: savedModelId, model: null, disabled: true })
  }
  return options
}

/**
 * The search field's rule: catalog models match on label, provider or ID (case-insensitive);
 * "Automatic", "No fallback" and a saved-but-missing preference always stay listed.
 */
export const filterModelOptions = (options, query) => {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : ""
  if (!needle) {
    return options
  }
  return options.filter(
    (option) =>
      option.type !== "model" ||
      `${option.model.label} ${option.model.provider} ${option.model.id}`
        .toLowerCase()
        .includes(needle),
  )
}
