import assert from "node:assert/strict"
import { test } from "node:test"

import {
  canApproveModel,
  connectionState,
  errorMessageKey,
  priceLabelKey,
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
