import assert from "node:assert/strict"
import { test } from "node:test"

import { errorMessageKey } from "./litellm-admin-state.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.
import { migrationActions, migrationRowFacts } from "./litellm-migration-state.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const status = (changes = {}) => ({
  configured: true,
  managed: false,
  revision: "bootstrap",
  writes_enabled: true,
  policy_source: "legacy",
  migration_required: true,
  ...changes,
})
const preview = (changes = {}) => ({
  source: "legacy",
  revision: "bootstrap",
  gateway: "ok",
  preview_token: "a".repeat(64),
  models: [],
  ...changes,
})

test("preview is read-only and allowed with writes OFF; migration needs every gate", () => {
  assert.deepEqual(migrationActions(status(), null, false), {
    visible: true,
    canPreview: true,
    canMigrate: false,
    blocker: "migration_preview_first",
  })
  assert.equal(
    migrationActions(status({ writes_enabled: false }), preview(), true).canPreview,
    true,
  )
  assert.equal(
    migrationActions(status({ writes_enabled: false }), preview(), true).blocker,
    "writes_disabled",
  )
  assert.equal(migrationActions(status(), preview(), false).blocker, "migration_confirm_required")
  assert.equal(
    migrationActions(status(), preview({ gateway: "unavailable" }), true).blocker,
    "migration_gateway_unavailable",
  )
  assert.equal(
    migrationActions(status(), preview({ revision: "other" }), true).blocker,
    "migration_stale",
  )
  assert.equal(migrationActions(status(), preview({ preview_token: null }), true).canMigrate, false)
  assert.deepEqual(migrationActions(status(), preview(), true), {
    visible: true,
    canPreview: true,
    canMigrate: true,
    blocker: null,
  })
  assert.equal(migrationActions(status(), preview(), true, { busy: true }).canMigrate, false)
})

test("the panel is hidden when no migration is pending", () => {
  for (const current of [
    null,
    status({ migration_required: false, policy_source: "managed", managed: true }),
    status({ migration_required: false, policy_source: "environment" }),
    { status_error: true },
  ]) {
    assert.equal(migrationActions(current, null, false).visible, false)
  }
})

test("row facts separate gateway evidence from what happens after migration", () => {
  const local = migrationRowFacts({
    discovered: true,
    mode: "chat",
    identity_verified: true,
    local_ollama: true,
    price_class: "free",
    legacy_price_matches: true,
    consents_required: [],
    blockers: [],
    after_migration: "not_approved",
  })
  assert.deepEqual(local, {
    discovery: "migration_discovered",
    mode: "migration_mode_chat",
    identity: "migration_identity_verified",
    location: "local",
    price: "price_free",
    legacyPrice: "migration_legacy_price_matches",
    consents: [],
    blockers: [],
    after: "migration_after_not_approved",
  })
  const external = migrationRowFacts({
    discovered: true,
    mode: "chat",
    identity_verified: true,
    local_ollama: false,
    price_class: "paid",
    legacy_price_matches: false,
    consents_required: ["external", "paid"],
    blockers: [],
    after_migration: "not_approved",
  })
  assert.equal(external.location, "external")
  assert.equal(external.legacyPrice, "migration_legacy_price_differs")
  assert.deepEqual(external.consents, ["migration_consent_external", "migration_consent_paid"])
  const unknown = migrationRowFacts({ discovered: null, after_migration: "not_approved" })
  assert.equal(unknown.discovery, "migration_not_checked")
  assert.equal(unknown.location, "migration_location_unknown")
  assert.equal(unknown.price, "price_unknown")
  assert.equal(unknown.legacyPrice, null)
  const missing = migrationRowFacts({
    discovered: false,
    identity_verified: false,
    blockers: ["not_discovered", "not_chat", "identity_unverified", "price_unknown", "bogus"],
  })
  assert.equal(missing.discovery, "migration_not_discovered")
  assert.deepEqual(missing.blockers, [
    "migration_blocker_not_discovered",
    "migration_blocker_not_chat",
    "migration_blocker_identity_unverified",
    "migration_blocker_price_unknown",
  ])
})

test("a refused implicit first write explains that an explicit migration is required", () => {
  assert.equal(errorMessageKey({ code: "MIGRATION_REQUIRED" }), "error_migration_required")
  assert.equal(errorMessageKey({ code: "MIGRATION_NOT_CONFIRMED" }), "migration_confirm_required")
})
