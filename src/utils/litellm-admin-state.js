/** Pure, secret-free view logic for the admin LiteLLM integration panel. */

const ERROR_KEYS = {
  CONFIG_CONFLICT: "error_conflict",
  CHANGES_DISABLED: "writes_disabled",
  KEY_INVALID: "error_key_invalid",
  KEY_UNVERIFIED: "error_key_unverified",
  MODEL_UNVERIFIED: "error_model_unverified",
  MODEL_NOT_DISCOVERED: "error_model_unverified",
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

/**
 * Browsing the gateway catalog is read-only: it needs a configured key and a successful
 * authenticated discovery, never write permission. Selecting a row only inspects it.
 */
export const canBrowseCatalog = (status, discovery) =>
  Boolean(status?.configured) && discovery === "ok"

/** Independent counts; discovery, chat mode, identity, price and approval are separate facts. */
export const summarizeCatalog = (models) => {
  const list = Array.isArray(models) ? models : []
  return {
    discovered: list.length,
    chat: list.filter((model) => model?.mode === "chat").length,
    approved: list.filter((model) => model?.approved === true).length,
    identityVerified: list.filter((model) => model?.identity_verified === true).length,
    priceKnown: list.filter(
      (model) => model?.price_class === "free" || model?.price_class === "paid",
    ).length,
  }
}

const modeKey = (model) => {
  if (model.mode === "chat") {
    return "mode_chat"
  }
  return model.mode ? "mode_incompatible" : "mode_unknown"
}

// Local or external only when the gateway proved the provider identity; otherwise unknown.
const locationKey = (model) => {
  if (model.local_ollama === true) {
    return "local"
  }
  return model.identity_verified === true ? "external" : "location_unknown"
}

/**
 * Sanitized, read-only description of one discovered model and every reason it cannot be used
 * for summaries yet. Uses only fields the admin API already returns; the server is the authority.
 */
export const inspectModel = (model, { writesEnabled = false } = {}) => {
  if (!model) {
    return null
  }
  const local = model.local_ollama === true
  const price = priceLabelKey(model)
  const blockers = []
  if (model.approved !== true) {
    blockers.push("reason_not_approved")
  }
  if (model.mode !== "chat") {
    blockers.push("reason_not_chat")
  }
  if (model.identity_verified !== true) {
    blockers.push("reason_identity_unverified")
  }
  if (!local && price === "price_unknown") {
    blockers.push("reason_price_unknown")
  }
  if (
    model.approved !== true &&
    !local &&
    model.identity_verified === true &&
    model.mode === "chat" &&
    price !== "price_unknown"
  ) {
    blockers.push("reason_external_consent")
  }
  if (
    model.approved !== true &&
    price === "price_paid" &&
    model.mode === "chat" &&
    model.identity_verified === true
  ) {
    blockers.push("reason_paid_consent")
  }
  if (!writesEnabled) {
    blockers.push("reason_writes_disabled")
  }
  return {
    discovery: "inspect_discovered",
    mode: modeKey(model),
    identity: model.identity_verified === true ? "identity_verified" : "identity_unverified",
    price,
    location: locationKey(model),
    approval: model.approved === true ? "approved" : "not_approved",
    availability:
      model.approved === true ? "availability_server_checked" : "availability_not_approved",
    blockers,
  }
}
