import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
let fetchImplementation = null
const nativeFetch = globalThis.fetch
globalThis.__articleSummaryAuth = {
  server: "https://miniflux.example",
  token: "synthetic-miniflux-key",
  apiKeyId: 9,
  username: "synthetic-user",
  password: "",
}
globalThis.__articleSummaryRevision = 4
globalThis.fetch = (...args) =>
  fetchImplementation ? fetchImplementation(...args) : nativeFetch(...args)

const moduleMocks = {
  "@/store/authState": "export const authState = { get: () => globalThis.__articleSummaryAuth }",
  "@/store/dataState":
    "export const getDataSessionRevision = () => globalThis.__articleSummaryRevision",
  "@/utils/auth": `
    export const getAuthSessionKey = (auth = {}) => JSON.stringify([auth.server, auth.token, auth.username, auth.password]);
    export const hasProvisionedApiKey = (auth = {}) => Boolean(auth.token && Number.isSafeInteger(Number(auth.apiKeyId)) && Number(auth.apiKeyId) > 0);
  `,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduleMocks[specifier]) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(moduleMocks[specifier])}`,
      }
    }
    if (specifier.startsWith("@/")) {
      const target = path.resolve(sourceRoot, specifier.slice(2))
      for (const candidate of [`${target}.js`, `${target}.jsx`]) {
        if (existsSync(candidate)) {
          return nextResolve(pathToFileURL(candidate).href)
        }
      }
    }
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !path.extname(specifier)
    ) {
      const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
      const candidate = `${target}.js`
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href)
      }
    }
    return nextResolve(specifier)
  },
})

const { default: requestArticleSummary, fetchModelCatalog } = await import("./article-intelligence")
const { buildSummaryProfile, resolveSummaryModel } =
  await import("@/utils/article-intelligence-profile")
const { sanitizeSettings } = await import("@/utils/settings-schema")

const REQUEST_FIELDS = ["model_id", "profile", "request_id", "schema_version"]
const catalogPayload = (changes = {}) => ({
  schema_version: "1",
  default_model_id: "s5-free",
  profile_version: "summary-profile-v1",
  default_profile: {},
  models: [
    {
      id: "s5-free",
      label: "S5",
      provider: "LiteLLM",
      available: true,
      unavailable_reason: null,
      requires_paid_authorization: false,
      pricing: {
        status: "operator_declared_zero",
        input_usd_per_million: "0",
        output_usd_per_million: "0",
      },
      limits: {
        max_input_tokens: 4096,
        max_output_tokens: 1024,
        requests_per_minute: 5,
        timeout_seconds: 25,
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_DECLARED_BY_OPERATOR"],
    },
    {
      id: "mistral-small",
      label: "Mistral Small",
      provider: "LiteLLM",
      available: false,
      unavailable_reason: "PAID_NOT_AUTHORIZED",
      requires_paid_authorization: true,
      pricing: {
        status: "operator_declared_paid",
        input_usd_per_million: "0.15",
        output_usd_per_million: "0.6",
      },
      limits: {
        max_input_tokens: 4096,
        max_output_tokens: 512,
        requests_per_minute: 5,
        timeout_seconds: 15,
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_DECLARED_BY_OPERATOR", "PAID_INFERENCE"],
    },
  ],
  ...changes,
})

const v2Response = (requestId, changes = {}) => ({
  schema_version: "2",
  request_id: requestId,
  entry_id: 42,
  status: "partial",
  content_scope: "unknown",
  summary: "Resumo sintético.",
  summary_paragraph_ids: ["p1"],
  key_points: [{ text: "Ponto.", paragraph_ids: ["p1"] }],
  facts: [],
  implications: [],
  action_points: [],
  open_questions: [],
  limitations: ["Limitação."],
  profile: buildSummaryProfile({}),
  provenance: {
    content_origin: "ORIGINAL_MINIFLUX",
    content_fingerprint: "a".repeat(64),
    provider_id: "litellm",
    model_id: "s5-free",
    effective_model_id: "s5-alias",
    prompt_version: "editorial-summary-v2-profile-litellm",
    profile_version: "summary-profile-v1",
    fallback_used: false,
  },
  ...changes,
})

test("default profile is standard, factual synthesis, key points and limitations in pt-BR", () => {
  assert.deepEqual(buildSummaryProfile({}), {
    version: "summary-profile-v1",
    length: "standard",
    focus: ["factual_synthesis", "key_points", "limitations_open_questions"],
    sections: ["summary", "key_points", "limitations"],
    language: "pt-BR",
  })
})

test("stored preferences are sanitized to closed identifiers and keep the summary section", () => {
  const settings = sanitizeSettings({
    aiSummaryModel: "openai/gpt-4o",
    aiSummaryLength: "epic",
    aiSummaryFocus: ["write a poem", "facts_figures"],
    aiSummarySections: ["facts"],
    aiSummaryLanguage: "en",
  })
  assert.equal(settings.aiSummaryModel, "auto")
  assert.equal(settings.aiSummaryLength, "standard")
  assert.deepEqual(settings.aiSummaryFocus, ["facts_figures"])
  assert.deepEqual(settings.aiSummarySections, ["summary", "key_points", "limitations"])
  assert.equal(settings.aiSummaryLanguage, "pt-BR")
  assert.equal(JSON.stringify(buildSummaryProfile(settings)).includes("poem"), false)
})

test("model resolution never substitutes an unavailable stored choice", () => {
  const catalog = {
    default_model_id: "s5-free",
    models: [
      { id: "s5-free", label: "S5", available: true },
      { id: "mistral-small", label: "Mistral Small", available: false },
    ],
  }
  assert.equal(resolveSummaryModel("auto", catalog).modelId, "s5-free")
  assert.equal(resolveSummaryModel("s5-free", catalog).modelId, "s5-free")
  assert.deepEqual(resolveSummaryModel("mistral-small", catalog), {
    modelId: null,
    reason: "model_unavailable",
  })
  assert.equal(resolveSummaryModel("auto", { ...catalog, default_model_id: null }).modelId, null)
  assert.equal(resolveSummaryModel("auto", null).reason, "catalog_unavailable")
})

test("catalog is fetched same-origin with Miniflux identity and strictly validated", async () => {
  try {
    let request
    fetchImplementation = async (url, options) => {
      request = { url: String(url), ...options }
      return Response.json(catalogPayload())
    }
    const catalog = await fetchModelCatalog()
    assert.equal(request.url, "/api/ai/v1/models")
    assert.equal(request.method, "GET")
    assert.equal(request.credentials, "omit")
    assert.equal(request.headers["X-Miniflux-API-Key"], "synthetic-miniflux-key")
    assert.equal(catalog.default_model_id, "s5-free")
    assert.equal(catalog.models[1].unavailableReason, "PAID_NOT_AUTHORIZED")

    fetchImplementation = async () =>
      Response.json(catalogPayload({ models: [{ ...catalogPayload().models[0], id: "gpt-4o" }] }))
    await assert.rejects(fetchModelCatalog())
    fetchImplementation = async () =>
      Response.json(
        catalogPayload({
          models: [{ ...catalogPayload().models[1], available: true }],
        }),
      )
    await assert.rejects(fetchModelCatalog())
  } finally {
    fetchImplementation = null
  }
})

test("v2 summary request sends only model id and closed profile, and checks provenance", async () => {
  try {
    let body
    fetchImplementation = async (_url, options) => {
      body = JSON.parse(options.body)
      return Response.json(v2Response(body.request_id))
    }
    const profile = buildSummaryProfile({ aiSummaryLength: "brief" })
    const result = await requestArticleSummary({ entryId: 42, modelId: "s5-free", profile })
    assert.equal(result.kind, "summary")
    assert.deepEqual(Object.keys(body).toSorted(), REQUEST_FIELDS)
    assert.equal(body.schema_version, "2")
    assert.equal(body.profile.length, "brief")

    fetchImplementation = async (_url, options) => {
      const { request_id: requestId } = JSON.parse(options.body)
      const payload = v2Response(requestId)
      payload.provenance = { ...payload.provenance, model_id: "mistral-small" }
      return Response.json(payload)
    }
    const mismatched = await requestArticleSummary({ entryId: 42, modelId: "s5-free", profile })
    assert.equal(mismatched.kind, "invalid")

    fetchImplementation = async (_url, options) => {
      const { request_id: requestId } = JSON.parse(options.body)
      const payload = v2Response(requestId)
      payload.provenance = { ...payload.provenance, content_origin: "RECOVERED_WALLHOP" }
      return Response.json(payload)
    }
    const otherOrigin = await requestArticleSummary({ entryId: 42, modelId: "s5-free", profile })
    assert.equal(otherOrigin.kind, "invalid")

    fetchImplementation = async (_url, options) => {
      const { request_id: requestId } = JSON.parse(options.body)
      return Response.json(
        {
          schema_version: "1",
          request_id: requestId,
          error: { code: "MODEL_NOT_AUTHORIZED", retryable: false },
        },
        { status: 403 },
      )
    }
    const refused = await requestArticleSummary({ entryId: 42, modelId: "mistral-small", profile })
    assert.deepEqual(refused, {
      kind: "error",
      error: { code: "MODEL_NOT_AUTHORIZED", retryable: false },
    })
  } finally {
    fetchImplementation = null
    globalThis.fetch = nativeFetch
  }
})

// --- Dynamic catalog (schema v2) ---------------------------------------------------------------

// The previous test restores the native fetch; reinstall the dispatcher for this block.
const installFetchDispatcher = () => {
  globalThis.fetch = (...args) =>
    fetchImplementation ? fetchImplementation(...args) : nativeFetch(...args)
}

const dynamicModel = (changes = {}) => ({
  id: "acme-7b",
  label: "Acme 7B",
  provider: "Synthetic",
  status: "AVAILABLE",
  available: true,
  unavailable_reason: null,
  requires_paid_authorization: false,
  checks: {
    discovered: true,
    compatible: true,
    operator_approved: true,
    pricing_verified: true,
    paid_authorized: false,
    transfer_authorized: true,
  },
  pricing: { status: "verified_zero", input_usd_per_million: "0", output_usd_per_million: "0" },
  limits: {
    max_input_tokens: 4096,
    max_output_tokens: 512,
    requests_per_minute: 5,
    timeout_seconds: 15,
  },
  notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_VERIFIED_BY_GATEWAY"],
  ...changes,
})
const catalogV2 = (changes = {}) => ({
  schema_version: "2",
  default_model_id: "acme-7b",
  profile_version: "summary-profile-v1",
  default_profile: {},
  discovery: { status: "OK" },
  policy: { status: "CONFIGURED" },
  models: [
    dynamicModel(),
    dynamicModel({
      id: "gw-0123456789ab",
      label: "unapproved-alias",
      status: "OPERATOR_APPROVAL_REQUIRED",
      available: false,
      unavailable_reason: "OPERATOR_APPROVAL_REQUIRED",
      checks: { ...dynamicModel().checks, operator_approved: false, pricing_verified: false },
      pricing: {
        status: "not_verified",
        input_usd_per_million: null,
        output_usd_per_million: null,
      },
      notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
    }),
  ],
  ...changes,
})

test("v2 catalog accepts gateway-discovered models without fixed identifiers", async () => {
  installFetchDispatcher()
  try {
    fetchImplementation = async () => Response.json(catalogV2())
    const catalog = await fetchModelCatalog()
    assert.equal(catalog.default_model_id, "acme-7b")
    assert.equal(catalog.discoveryStatus, "OK")
    assert.equal(catalog.models[0].status, "AVAILABLE")
    assert.equal(catalog.models[0].checks.pricing_verified, true)
    assert.equal(catalog.models[1].status, "OPERATOR_APPROVAL_REQUIRED")
    assert.equal(resolveSummaryModel("acme-7b", catalog).modelId, "acme-7b")
    assert.equal(resolveSummaryModel("gw-0123456789ab", catalog).reason, "model_unavailable")
  } finally {
    fetchImplementation = null
  }
})

test("D1 key-authority catalog: gateway-governed cost, no price shown, unproven cost authority blocked", async () => {
  installFetchDispatcher()
  const governed = {
    status: "gateway_governed",
    input_usd_per_million: null,
    output_usd_per_million: null,
  }
  try {
    fetchImplementation = async () =>
      Response.json(
        catalogV2({
          default_model_id: "gw-aaaaaaaaaaaa",
          policy: { status: "KEY_AUTHORITY" },
          models: [
            dynamicModel({
              id: "gw-aaaaaaaaaaaa",
              label: "acme-7b",
              requires_paid_authorization: false,
              checks: { ...dynamicModel().checks, pricing_verified: false, paid_authorized: false },
              pricing: governed,
              notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
            }),
            dynamicModel({
              id: "gw-bbbbbbbbbbbb",
              label: "other-13b",
              status: "DISABLED",
              available: false,
              unavailable_reason: "COST_AUTHORITY_UNPROVEN",
              requires_paid_authorization: false,
              checks: { ...dynamicModel().checks, pricing_verified: false, paid_authorized: false },
              pricing: governed,
              notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER"],
            }),
          ],
        }),
      )
    const catalog = await fetchModelCatalog()
    assert.ok(catalog, "the key-authority catalog must be accepted")
    assert.equal(catalog.models[0].pricing.status, "gateway_governed")
    assert.equal(resolveSummaryModel("gw-aaaaaaaaaaaa", catalog).modelId, "gw-aaaaaaaaaaaa")
    assert.equal(catalog.models[1].unavailableReason, "COST_AUTHORITY_UNPROVEN")
    assert.equal(resolveSummaryModel("gw-bbbbbbbbbbbb", catalog).reason, "model_unavailable")
  } finally {
    fetchImplementation = null
  }
})

test("v2 catalog is rejected when malformed, inconsistent or oversized", async () => {
  installFetchDispatcher()
  const broken = [
    catalogV2({ models: [dynamicModel({ id: "Bad/ID" })] }),
    catalogV2({ models: [dynamicModel({ status: "DISABLED" })] }),
    catalogV2({
      models: [dynamicModel({ status: "WHATEVER", available: false, unavailable_reason: "X" })],
    }),
    catalogV2({
      models: [
        dynamicModel({ available: false, status: "UNVERIFIED", unavailable_reason: "MADE_UP" }),
      ],
    }),
    catalogV2({
      models: [dynamicModel({ pricing: { ...dynamicModel().pricing, status: "free!" } })],
    }),
    catalogV2({ models: [dynamicModel({ checks: { discovered: true } })] }),
    catalogV2({ discovery: { status: "MAYBE" } }),
    catalogV2({ default_model_id: "Not An Id" }),
    catalogV2({ models: Array.from({ length: 33 }, (_, i) => dynamicModel({ id: `m${i}` })) }),
    catalogV2({ models: [dynamicModel(), dynamicModel()] }),
    catalogV2({ models: [dynamicModel({ id: "auto" })], default_model_id: null }),
    catalogV2({ models: [dynamicModel({ id: "none" })], default_model_id: null }),
  ]
  try {
    fetchImplementation = async () => Response.json(catalogV2())
    const valid = await fetchModelCatalog()
    assert.equal(valid.models.length, 2)
    for (const payload of broken) {
      fetchImplementation = async () => Response.json(payload)
      await assert.rejects(fetchModelCatalog(), JSON.stringify(payload).slice(0, 120))
    }
  } finally {
    fetchImplementation = null
  }
})

test("a saved dynamic model survives its removal and is never substituted", () => {
  const stored = sanitizeSettings({ aiSummaryModel: "acme-7b" })
  assert.equal(stored.aiSummaryModel, "acme-7b")
  assert.equal(sanitizeSettings({ aiSummaryModel: "Bad/ID" }).aiSummaryModel, "auto")
  assert.equal(sanitizeSettings({ aiSummaryModel: "x".repeat(65) }).aiSummaryModel, "auto")
  const withoutIt = { default_model_id: "s5-free", models: [{ id: "s5-free", available: true }] }
  assert.deepEqual(resolveSummaryModel("acme-7b", withoutIt), {
    modelId: null,
    reason: "model_unavailable",
  })
})

test("v2 summary provenance accepts a dynamic model id only when it matches the request", async () => {
  installFetchDispatcher()
  try {
    fetchImplementation = async (_url, options) => {
      const { request_id: requestId } = JSON.parse(options.body)
      return Response.json(
        v2Response(requestId, {
          provenance: { ...v2Response(requestId).provenance, model_id: "acme-7b" },
        }),
      )
    }
    const profile = buildSummaryProfile({})
    const ok = await requestArticleSummary({ entryId: 42, modelId: "acme-7b", profile })
    assert.equal(ok.kind, "summary")
    const mismatch = await requestArticleSummary({ entryId: 42, modelId: "s5-free", profile })
    assert.notEqual(mismatch.kind, "summary")
  } finally {
    fetchImplementation = null
  }
})

// --- Primary / fallback (request + response v3) ------------------------------------------------

const { resolveSummaryRouting } = await import("@/utils/article-intelligence-profile")

const v3Response = (requestId, provenance = {}, changes = {}) => {
  const base = v2Response(requestId)
  return {
    ...base,
    schema_version: "3",
    provenance: {
      content_origin: "ORIGINAL_MINIFLUX",
      content_fingerprint: "a".repeat(64),
      provider_id: "litellm",
      requested_model_id: "free-a",
      primary_model_id: "free-a",
      fallback_model_id: "free-b",
      effective_model_id: "free-a",
      effective_model_alias: "alias-a",
      fallback_used: false,
      fallback_reason: null,
      fallback_outcome: "NOT_NEEDED",
      attempts: 1,
      pricing_class: "free",
      prompt_version: "editorial-summary-v2-profile-litellm",
      profile_version: "summary-profile-v1",
      ...provenance,
    },
    ...changes,
  }
}

test("routing: fallback only when enabled, well-formed and distinct; consent is explicit", () => {
  const catalog = {
    default_model_id: "free-a",
    models: [
      { id: "free-a", label: "A", available: true },
      { id: "free-b", label: "B", available: true },
    ],
  }
  const base = { aiSummaryModel: "free-a", aiSummaryFallbackModel: "free-b" }
  assert.equal(resolveSummaryRouting(base, catalog).fallbackModelId, null)
  const enabled = { ...base, aiSummaryFallbackEnabled: true }
  assert.equal(resolveSummaryRouting(enabled, catalog).fallbackModelId, "free-b")
  assert.deepEqual(resolveSummaryRouting(enabled, catalog).consent, {
    paid: false,
    cross_provider: false,
  })
  assert.equal(
    resolveSummaryRouting({ ...enabled, aiSummaryFallbackModel: "free-a" }, catalog)
      .fallbackModelId,
    null,
  )
  assert.equal(
    resolveSummaryRouting({ ...enabled, aiSummaryFallbackModel: "none" }, catalog).fallbackModelId,
    null,
  )
  // A saved fallback that disappeared is still sent: the server reports NOT_AVAILABLE; it is
  // never replaced by another model on the client.
  assert.equal(
    resolveSummaryRouting({ ...enabled, aiSummaryFallbackModel: "gone-model" }, catalog)
      .fallbackModelId,
    "gone-model",
  )
  assert.deepEqual(
    resolveSummaryRouting(
      { ...enabled, aiSummaryFallbackAllowPaid: true, aiSummaryFallbackAllowCrossProvider: true },
      catalog,
    ).consent,
    { paid: true, cross_provider: true },
  )
})

test("fallback settings are sanitized and default to off", () => {
  const defaults = sanitizeSettings({})
  assert.equal(defaults.aiSummaryFallbackEnabled, false)
  assert.equal(defaults.aiSummaryFallbackModel, "none")
  assert.equal(defaults.aiSummaryFallbackAllowPaid, false)
  assert.equal(defaults.aiSummaryFallbackAllowCrossProvider, false)
  const stored = sanitizeSettings({
    aiSummaryFallbackEnabled: "yes",
    aiSummaryFallbackModel: "Bad/ID",
    aiSummaryFallbackAllowPaid: 1,
  })
  assert.equal(stored.aiSummaryFallbackEnabled, false)
  assert.equal(stored.aiSummaryFallbackModel, "none")
  assert.equal(stored.aiSummaryFallbackAllowPaid, false)
  assert.equal(
    sanitizeSettings({ aiSummaryFallbackModel: "free-b" }).aiSummaryFallbackModel,
    "free-b",
  )
})

test("v3 request carries primary, fallback and consent only; provenance is cross-checked", async () => {
  installFetchDispatcher()
  const profile = buildSummaryProfile({})
  const ask = () =>
    requestArticleSummary({
      entryId: 42,
      modelId: "free-a",
      fallbackModelId: "free-b",
      consent: { paid: false, cross_provider: false },
      profile,
    })
  try {
    let body
    fetchImplementation = async (_url, options) => {
      body = JSON.parse(options.body)
      return Response.json(v3Response(body.request_id))
    }
    const first = await ask()
    assert.equal(first.kind, "summary")
    assert.deepEqual(Object.keys(body).toSorted(), [
      "fallback_consent",
      "fallback_model_id",
      "primary_model_id",
      "profile",
      "request_id",
      "schema_version",
    ])
    assert.equal(body.schema_version, "3")

    const used = {
      effective_model_id: "free-b",
      effective_model_alias: "alias-b",
      fallback_used: true,
      fallback_reason: "PRIMARY_TIMEOUT",
      fallback_outcome: "USED",
      attempts: 2,
    }
    fetchImplementation = async (_url, options) =>
      Response.json(v3Response(JSON.parse(options.body).request_id, used))
    const viaFallback = await ask()
    assert.equal(viaFallback.kind, "summary")
    assert.equal(viaFallback.summary.provenance.fallback_used, true)

    const forged = [
      { effective_model_id: "other-c" },
      { ...used, attempts: 1 },
      { fallback_used: true },
      { requested_model_id: "free-b" },
      { fallback_model_id: "other-c" },
      { content_origin: "RECOVERED_WALLHOP" },
      { fallback_outcome: "SOMETHING" },
      { attempts: 3 },
    ]
    for (const provenance of forged) {
      fetchImplementation = async (_url, options) =>
        Response.json(v3Response(JSON.parse(options.body).request_id, provenance))
      const result = await ask()
      assert.equal(result.kind, "invalid", JSON.stringify(provenance))
    }

    // SEC-249-02: an unverified provider identity is a known "not used" outcome, never a fallback.
    fetchImplementation = async (_url, options) =>
      Response.json(
        v3Response(JSON.parse(options.body).request_id, {
          fallback_outcome: "PROVIDER_UNVERIFIED",
        }),
      )
    const unverified = await ask()
    assert.equal(unverified.kind, "summary")
    assert.equal(unverified.summary.provenance.fallback_used, false)
    for (const provenance of [
      { ...used, fallback_outcome: "PROVIDER_UNVERIFIED" },
      { fallback_outcome: "provider_unverified" },
    ]) {
      fetchImplementation = async (_url, options) =>
        Response.json(v3Response(JSON.parse(options.body).request_id, provenance))
      const rejected = await ask()
      assert.equal(rejected.kind, "invalid", JSON.stringify(provenance))
    }

    // Without a fallback the request stays on the unchanged v2 contract.
    fetchImplementation = async (_url, options) => {
      body = JSON.parse(options.body)
      return Response.json(
        v2Response(body.request_id, {
          provenance: { ...v2Response(body.request_id).provenance, model_id: "free-a" },
        }),
      )
    }
    const single = await requestArticleSummary({ entryId: 42, modelId: "free-a", profile })
    assert.equal(body.schema_version, "2")
    assert.equal(single.kind, "summary")
  } finally {
    fetchImplementation = null
  }
})
