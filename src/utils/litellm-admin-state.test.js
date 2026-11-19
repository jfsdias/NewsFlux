import assert from "node:assert/strict"
import { test } from "node:test"

import {
  canApproveModel,
  canBrowseCatalog,
  connectionState,
  errorMessageKey,
  inspectModel,
  priceLabelKey,
  summarizeCatalog,
} from "./litellm-admin-state.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

test("connection state never claims CONNECTED without a successful authenticated discovery", () => {
  assert.equal(connectionState(null, "idle"), "unverified")
  assert.equal(connectionState({ configured: false }, "idle"), "not_configured")
  assert.equal(connectionState({ configured: false }, "ok"), "not_configured")
  assert.equal(connectionState({ configured: true }, "idle"), "unverified")
  assert.equal(connectionState({ configured: true }, "ok"), "connected")
  assert.equal(connectionState({ configured: true }, "failed"), "validation_failed")
  assert.equal(connectionState({ status_error: true }, "idle"), "validation_failed")
})

test("price label is a classification only and unknown is never treated as free", () => {
  assert.equal(priceLabelKey({ price_class: "free" }), "price_free")
  assert.equal(priceLabelKey({ price_class: "paid" }), "price_paid")
  assert.equal(priceLabelKey({ price_class: "unknown" }), "price_unknown")
  assert.equal(priceLabelKey({}), "price_unknown")
  assert.equal(priceLabelKey({ price_class: "0" }), "price_unknown")
})

test("approval requires verified chat identity and explicit consents for external and paid", () => {
  const local = {
    mode: "chat",
    identity_verified: true,
    local_ollama: true,
    price_class: "unknown",
  }
  assert.equal(canApproveModel(local, { allowExternal: false, allowPaid: false }), true)
  const external = { ...local, local_ollama: false, price_class: "free" }
  assert.equal(canApproveModel(external, { allowExternal: false, allowPaid: false }), false)
  assert.equal(canApproveModel(external, { allowExternal: true, allowPaid: false }), true)
  const paid = { ...external, price_class: "paid" }
  assert.equal(canApproveModel(paid, { allowExternal: true, allowPaid: false }), false)
  assert.equal(canApproveModel(paid, { allowExternal: true, allowPaid: true }), true)
  const unpriced = { ...external, price_class: "unknown" }
  assert.equal(canApproveModel(unpriced, { allowExternal: true, allowPaid: true }), false)
  assert.equal(canApproveModel({ ...local, approved: true }, {}), false)
  assert.equal(canApproveModel({ ...local, mode: "embedding" }, {}), false)
  assert.equal(canApproveModel({ ...local, identity_verified: false }, {}), false)
  assert.equal(canApproveModel(undefined, {}), false)
})

test("server error codes map to fixed translated messages and unknown codes stay generic", () => {
  assert.equal(errorMessageKey({ code: "CONFIG_CONFLICT" }), "error_conflict")
  assert.equal(errorMessageKey({ code: "CHANGES_DISABLED" }), "writes_disabled")
  assert.equal(errorMessageKey({ code: "KEY_INVALID" }), "error_key_invalid")
  assert.equal(errorMessageKey({ code: "KEY_UNVERIFIED" }), "error_key_unverified")
  assert.equal(errorMessageKey({ code: "MODEL_UNVERIFIED" }), "error_model_unverified")
  assert.equal(errorMessageKey({ code: "MODEL_NOT_DISCOVERED" }), "error_model_unverified")
  assert.equal(errorMessageKey({ code: "sk-leaked-value" }), "failed")
  assert.equal(errorMessageKey(new Error("boom")), "failed")
  assert.equal(errorMessageKey(null), "failed")
})

test("admin component and transport never persist or log the transient credential", async () => {
  const { readFile } = await import("node:fs/promises")
  const sources = await Promise.all(
    [
      "../components/Settings/LiteLlmAdminSettings.jsx",
      "../apis/article-intelligence-admin.js",
      "./litellm-admin-state.js",
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
  )
  for (const source of sources) {
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "persistentAtom",
      "persistentMap",
      "console.",
      "URLSearchParams",
      "document.cookie",
      "navigator.sendBeacon",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden)
    }
  }
  const component = sources[0]
  assert.match(component, /type="password"/)
  assert.match(component, /autoComplete="off"/)
  assert.equal(/\bvalue=\{status\./.test(component), false)
})

// NEWSFLUX-AI-CATALOG-READONLY-01: browsing and inspection never depend on write permission.
const catalogFixture = () => {
  // 26 aliases: 14 chat, 12 non-chat; 7 price-known (3 free, 4 paid); 13 identity-verified; 0 approved.
  const models = []
  for (let index = 0; index < 26; index += 1) {
    const chat = index < 14
    const priceKnown = index % 4 === 0 && models.filter((model) => model.price_known).length < 7
    models.push({
      id: `catalog-${chat ? "chat" : "other"}-${String(index).padStart(2, "0")}`,
      approved: false,
      provider: index % 2 === 0 ? "groq" : "Unverified",
      mode: chat ? "chat" : index % 3 === 0 ? null : "embedding",
      identity_verified: index % 2 === 0,
      local_ollama: index === 2,
      price_known: priceKnown,
      price_class: priceKnown ? (index % 8 === 0 ? "paid" : "free") : "unknown",
    })
  }
  return models
}

test("catalog can be browsed whenever the key is configured and discovery succeeded, writes are irrelevant", () => {
  assert.equal(canBrowseCatalog({ configured: true, writes_enabled: false }, "ok"), true)
  assert.equal(canBrowseCatalog({ configured: true, writes_enabled: true }, "ok"), true)
  assert.equal(canBrowseCatalog({ configured: true, writes_enabled: false }, "failed"), false)
  assert.equal(canBrowseCatalog({ configured: true, writes_enabled: false }, "idle"), false)
  assert.equal(canBrowseCatalog({ configured: false, writes_enabled: true }, "ok"), false)
  assert.equal(canBrowseCatalog(null, "ok"), false)
})

test("catalog summary counts each dimension independently and never assumes the subsets coincide", () => {
  const summary = summarizeCatalog(catalogFixture())
  assert.deepEqual(summary, {
    discovered: 26,
    chat: 14,
    approved: 0,
    identityVerified: 13,
    priceKnown: 7,
  })
  assert.deepEqual(summarizeCatalog([]), {
    discovered: 0,
    chat: 0,
    approved: 0,
    identityVerified: 0,
    priceKnown: 0,
  })
  assert.deepEqual(summarizeCatalog(null), {
    discovered: 0,
    chat: 0,
    approved: 0,
    identityVerified: 0,
    priceKnown: 0,
  })
})

test("inspection reports discovery, mode, identity, price, location and approval from sanitized fields only", () => {
  const local = {
    id: "llama",
    mode: "chat",
    identity_verified: true,
    local_ollama: true,
    price_class: "free",
    approved: true,
  }
  assert.deepEqual(inspectModel(local, { writesEnabled: true }), {
    discovery: "inspect_discovered",
    mode: "mode_chat",
    identity: "identity_verified",
    price: "price_free",
    location: "local",
    approval: "approved",
    availability: "availability_server_checked",
    blockers: [],
  })
  const external = {
    id: "x",
    mode: "chat",
    identity_verified: true,
    local_ollama: false,
    price_class: "paid",
    approved: false,
  }
  const inspected = inspectModel(external, { writesEnabled: false })
  assert.equal(inspected.location, "external")
  assert.equal(inspected.approval, "not_approved")
  assert.equal(inspected.availability, "availability_not_approved")
  assert.deepEqual(inspected.blockers, [
    "reason_not_approved",
    "reason_external_consent",
    "reason_paid_consent",
    "reason_writes_disabled",
  ])
})

test("unverified identity is never classified as external or local, and non-chat is incompatible", () => {
  const unknown = {
    id: "u",
    mode: "embedding",
    identity_verified: false,
    local_ollama: false,
    price_class: "unknown",
  }
  const inspected = inspectModel(unknown, { writesEnabled: true })
  assert.equal(inspected.location, "location_unknown")
  assert.equal(inspected.identity, "identity_unverified")
  assert.equal(inspected.mode, "mode_incompatible")
  assert.equal(inspected.price, "price_unknown")
  assert.deepEqual(inspected.blockers, [
    "reason_not_approved",
    "reason_not_chat",
    "reason_identity_unverified",
    "reason_price_unknown",
  ])
  assert.equal(inspectModel({ id: "m", mode: null }, { writesEnabled: true }).mode, "mode_unknown")
})

test("an approved model reports no approval blocker but writes-off still explains why it cannot be changed", () => {
  const approved = {
    id: "a",
    mode: "chat",
    identity_verified: true,
    local_ollama: false,
    price_class: "free",
    approved: true,
  }
  assert.deepEqual(inspectModel(approved, { writesEnabled: false }).blockers, [
    "reason_writes_disabled",
  ])
  assert.equal(inspectModel(null, { writesEnabled: true }), null)
})

test("blocker reasons match the approval rule: a model with no blockers except consent is approvable with consent", () => {
  for (const model of catalogFixture()) {
    const { blockers } = inspectModel(model, { writesEnabled: true })
    const hard = blockers.filter(
      (key) =>
        !["reason_external_consent", "reason_paid_consent", "reason_not_approved"].includes(key),
    )
    const approvableWithConsent = canApproveModel(model, { allowExternal: true, allowPaid: true })
    assert.equal(hard.length === 0, approvableWithConsent, model.id)
  }
})
