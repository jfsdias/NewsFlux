import assert from "node:assert/strict"
import { test } from "node:test"

import { validateModelCatalog } from "./article-intelligence-summary.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.
import {
  buildFallbackModelOptions,
  buildPrimaryModelOptions,
  filterModelOptions,
} from "./summary-model-options.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

// A D1 (key authority) catalog as the Summary API serves it: one gw-<hash> entry per alias the
// LiteLLM virtual key lists, gateway-governed cost, one alias not yet verified as chat.
const ALIASES = [
  ["gpt-4o-mini", "openai"],
  ["gpt-4o", "openai"],
  ["nvidia/nemotron-3-ultra-550b-a55b:free", "openrouter"],
  ["mistral-small-latest", "mistral"],
  ["gemini-2.5-flash", "gemini"],
  ["llama-3.3-70b", "groq"],
  ["gemma3-local", "ollama"],
  ["kimi-k2", "moonshot"],
]
const d1Entry = ([alias, provider], index) => {
  const available = alias !== "kimi-k2"
  return {
    id: `gw-${String(index).padStart(12, "0")}`,
    label: alias,
    provider,
    status: available ? "AVAILABLE" : "UNVERIFIED",
    available,
    unavailable_reason: available ? null : "COMPATIBILITY_UNVERIFIED",
    requires_paid_authorization: false,
    checks: {
      discovered: true,
      compatible: available ? true : null,
      operator_approved: true,
      pricing_verified: false,
      paid_authorized: false,
      transfer_authorized: true,
    },
    pricing: {
      status: "gateway_governed",
      input_usd_per_million: null,
      output_usd_per_million: null,
    },
    limits: {
      max_input_tokens: 16_000,
      max_output_tokens: 4096,
      requests_per_minute: 30,
      timeout_seconds: 25,
    },
    notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
  }
}
const d1Payload = (models = ALIASES.map((alias, index) => d1Entry(alias, index))) => ({
  schema_version: "2",
  default_model_id: "gw-000000000000",
  profile_version: "summary-profile-v1",
  default_profile: {},
  discovery: { status: "OK" },
  policy: { status: "KEY_AUTHORITY" },
  models,
})
const d1 = validateModelCatalog(d1Payload())

const values = (options) => options.map((option) => option.value)
const counts = (options) => {
  const all = new Map()
  for (const option of options) {
    all.set(option.value, (all.get(option.value) ?? 0) + 1)
  }
  return all
}
const assertEachOnce = (options) => {
  for (const [value, count] of counts(options)) {
    assert.equal(count, 1, `${value} is listed ${count} times`)
  }
}

test("D1 catalog: the fallback picker lists every model except the primary exactly once", () => {
  assert.ok(d1, "the D1 catalog is valid")
  for (const primary of [d1.default_model_id, "gw-000000000002", "gw-000000000007"]) {
    for (const saved of ["none", "gw-000000000000", "gw-000000000002", "gw-000000000007"]) {
      const options = buildFallbackModelOptions(d1, primary, saved)
      assertEachOnce(options)
      assert.deepEqual(
        values(options),
        ["none", ...d1.models.map((model) => model.id).filter((id) => id !== primary)],
        `primary ${primary}, saved fallback ${saved}: no extra row for a listed model`,
      )
      assert.equal(options.filter((option) => option.type === "missing").length, 0)
    }
  }
})

test("D1 catalog: the primary picker lists Automatic and every model exactly once", () => {
  for (const saved of ["auto", "gw-000000000000", "gw-000000000007"]) {
    const options = buildPrimaryModelOptions(d1, saved)
    assertEachOnce(options)
    assert.deepEqual(values(options), ["auto", ...d1.models.map((model) => model.id)])
  }
})

test("the catalog itself never carries the same model twice", () => {
  // Two entries with the same ID are refused as a whole: the pickers never get a duplicate.
  const models = ALIASES.map((alias, index) => d1Entry(alias, index))
  assert.equal(validateModelCatalog(d1Payload([...models, { ...models[0] }])), null)
})

test("a saved preference the catalog no longer lists gets one disabled row, never two", () => {
  const fallback = buildFallbackModelOptions(d1, d1.default_model_id, "mistral-legacy-removed")
  assertEachOnce(fallback)
  assert.deepEqual(fallback.at(-1), {
    type: "missing",
    value: "mistral-legacy-removed",
    model: null,
    disabled: true,
  })
  const primary = buildPrimaryModelOptions(d1, "s5-legacy-removed")
  assertEachOnce(primary)
  assert.deepEqual(
    primary.filter((option) => option.type === "missing").map((option) => option.value),
    ["s5-legacy-removed"],
  )
  // A saved fallback equal to the primary is warned about elsewhere, not listed again.
  assert.equal(
    buildFallbackModelOptions(d1, "gw-000000000000", "gw-000000000000").some(
      (option) => option.value === "gw-000000000000",
    ),
    false,
  )
  // Reserved or malformed values never become rows.
  for (const saved of ["none", "auto", "", null, undefined, "Bad/ID"]) {
    assert.equal(
      buildFallbackModelOptions(d1, d1.default_model_id, saved).some(
        (option) => option.type === "missing",
      ),
      false,
    )
  }
})

test("disabled states are kept: Automatic follows the default, unavailable models stay selectable", () => {
  const options = buildPrimaryModelOptions(d1, "auto")
  assert.equal(options[0].disabled, false)
  // Unavailable models can still be saved as an inert preference (summary-model-preference).
  const kimi = options.find((option) => option.model?.label === "kimi-k2")
  assert.equal(kimi.model.available, false)
  assert.equal(kimi.disabled, false)
  const noDefault = { ...d1, default_model_id: null }
  assert.equal(buildPrimaryModelOptions(noDefault, "auto")[0].disabled, true)
  assert.deepEqual(buildPrimaryModelOptions(null, "auto"), [])
  assert.deepEqual(buildFallbackModelOptions(null, null, "none"), [])
})

test("search matches label, provider or ID and keeps Automatic, No fallback and saved rows", () => {
  const primary = buildPrimaryModelOptions(d1, "s5-legacy-removed")
  assert.deepEqual(values(filterModelOptions(primary, "  NEMOTRON ")), [
    "auto",
    "gw-000000000002",
    "s5-legacy-removed",
  ])
  assert.deepEqual(values(filterModelOptions(primary, "openai")), [
    "auto",
    "gw-000000000000",
    "gw-000000000001",
    "s5-legacy-removed",
  ])
  assert.deepEqual(values(filterModelOptions(primary, "gw-000000000006")), [
    "auto",
    "gw-000000000006",
    "s5-legacy-removed",
  ])
  assert.deepEqual(values(filterModelOptions(primary, "no-such-model")), [
    "auto",
    "s5-legacy-removed",
  ])
  assert.equal(filterModelOptions(primary, ""), primary)
  const fallback = buildFallbackModelOptions(d1, d1.default_model_id, "none")
  assert.deepEqual(values(filterModelOptions(fallback, "gemma")), ["none", "gw-000000000006"])
})
