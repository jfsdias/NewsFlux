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
