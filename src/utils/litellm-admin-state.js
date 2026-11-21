/** Pure, secret-free view logic for the admin LiteLLM integration panel. */

const ERROR_KEYS = {
  CONFIG_CONFLICT: "error_conflict",
  CHANGES_DISABLED: "writes_disabled",
  KEY_INVALID: "error_key_invalid",
  KEY_UNVERIFIED: "error_key_unverified",
  MODEL_UNVERIFIED: "error_model_unverified",
  MODEL_NOT_DISCOVERED: "error_model_unverified",
  MIGRATION_REQUIRED: "error_migration_required",
  MIGRATION_NOT_CONFIRMED: "migration_confirm_required",
}

/**
 * CONNECTED is only claimed after a successful authenticated catalog discovery.
 * A configured key that has not (yet) been verified is UNVERIFIED.
 */
export const connectionState = (status, discovery) => {
  if (status?.status_error) {
    return "validation_failed"
  }
  if (!status) {
    return "unverified"
  }
  if (!status.configured) {
    return "not_configured"
  }
  if (discovery === "ok") {
    return "connected"
  }
  if (discovery === "failed") {
    return "validation_failed"
  }
  return "unverified"
}

/** D1 successor: the LiteLLM virtual key governs models and LiteLLM governs cost; NewsFlux shows neither. */
export const isKeyAuthority = (status) => status?.model_authority === "litellm_key"

/** Key-authority rows: identity facts only, never a price or an approval flag. */
export const keyAuthorityModelLabel = (model) =>
  [model?.id, model?.provider, model?.mode ?? "unverified"].filter(Boolean).join(" · ")

export const priceLabelKey = (model) => {
  if (model?.price_class === "free") {
    return "price_free"
  }
  if (model?.price_class === "paid") {
    return "price_paid"
  }
  return "price_unknown"
}

/** Mirrors the server rule; the server remains the authority. */
export const canApproveModel = (model, { allowExternal = false, allowPaid = false } = {}) => {
  if (!model || model.approved || model.mode !== "chat" || !model.identity_verified) {
    return false
  }
  if (model.local_ollama) {
    return model.price_class !== "paid" || allowPaid === true
  }
  if (allowExternal !== true || model.price_class === "unknown" || !model.price_class) {
    return false
  }
  return model.price_class !== "paid" || allowPaid === true
}

export const errorMessageKey = (error) => {
  const code = error?.code
  return typeof code === "string" && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : "failed"
}
