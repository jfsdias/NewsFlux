/** Pure, secret-free view logic for the explicit LEGACY -> MANAGED policy migration panel. */
import { priceLabelKey } from "./litellm-admin-state.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const BLOCKERS = new Set([
  "not_discovered",
  "not_chat",
  "identity_unverified",
  "price_unknown",
  "price_conflict",
])
const CONSENTS = { external: "migration_consent_external", paid: "migration_consent_paid" }

/**
 * Preview is a read-only GET and stays available with admin writes OFF. Migrating needs a
 * pending legacy policy, writes enabled, a fresh preview for the current revision with a
 * verified gateway, and an explicit confirmation. The server re-checks all of it.
 */
export const migrationActions = (status, preview, confirmed, { busy = false } = {}) => {
  const visible = Boolean(status && !status.status_error && status.migration_required === true)
  if (!visible) {
    return { visible: false, canPreview: false, canMigrate: false, blocker: null }
  }
  let blocker = null
  if (!preview) {
    blocker = "migration_preview_first"
  } else if (preview.revision !== status.revision) {
    blocker = "migration_stale"
  } else if (preview.gateway !== "ok" || typeof preview.preview_token !== "string") {
    blocker = "migration_gateway_unavailable"
  } else if (status.writes_enabled !== true) {
    blocker = "writes_disabled"
  } else if (confirmed !== true) {
    blocker = "migration_confirm_required"
  }
  return { visible, canPreview: !busy, canMigrate: !busy && blocker === null, blocker }
}

const checked = (row) => row?.discovered === true || row?.discovered === false

/** Translation keys for one legacy model: gateway evidence, then the post-migration state. */
export const migrationRowFacts = (row) => {
  const known = checked(row)
  let discovery = "migration_not_checked"
  if (known) {
    discovery = row.discovered ? "migration_discovered" : "migration_not_discovered"
  }
  let mode = "migration_mode_unknown"
  if (row?.mode === "chat") {
    mode = "migration_mode_chat"
  } else if (typeof row?.mode === "string") {
    mode = "migration_mode_other"
  }
  let identity = null
  if (known) {
    identity = row.identity_verified
      ? "migration_identity_verified"
      : "migration_identity_unverified"
  }
  let location = "migration_location_unknown"
  if (known && row.local_ollama === true) {
    location = "local"
  } else if (known && row.identity_verified === true && row.local_ollama === false) {
    location = "external" // only claimed when the provider identity was verified
  }
  let legacyPrice = null
  if (row?.legacy_price_matches === true) {
    legacyPrice = "migration_legacy_price_matches"
  } else if (row?.legacy_price_matches === false) {
    legacyPrice = "migration_legacy_price_differs"
  }
  const consents = (Array.isArray(row?.consents_required) ? row.consents_required : [])
    .map((name) => CONSENTS[name])
    .filter(Boolean)
  const blockers = (Array.isArray(row?.blockers) ? row.blockers : [])
    .filter((code) => BLOCKERS.has(code))
    .map((code) => `migration_blocker_${code}`)
  return {
    discovery,
    mode,
    identity,
    location,
    price: priceLabelKey(row),
    legacyPrice,
    consents,
    blockers,
    after: "migration_after_not_approved",
  }
}
