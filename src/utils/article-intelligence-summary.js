const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const PARAGRAPH_ID_PATTERN = /^p[1-9][0-9]{0,2}$/u
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u
const SUMMARY_ERROR_CODES = new Set([
  "UNAUTHENTICATED",
  "NOT_AUTHORIZED",
  "ENTRY_NOT_ACCESSIBLE",
  "STALE_SNAPSHOT",
  "INVALID_REQUEST",
  "INVALID_JSON",
  "HTTPS_REQUIRED",
  "HOST_NOT_AUTHORIZED",
  "REQUEST_TOO_LARGE",
  "SUMMARY_BUSY",
  "MINIFLUX_UNAVAILABLE",
  "MODEL_OUTPUT_INVALID",
  "MODEL_NOT_AVAILABLE",
  "MODEL_NOT_AUTHORIZED",
])
const SUMMARY_STATUSES = new Set(["complete", "partial", "insufficient", "unavailable"])
const CONTENT_SCOPES = new Set(["full", "partial", "unknown"])
const MAX_RESPONSE_BYTES = 32 * 1024

export const buildArticleSummaryPath = (entryId) => {
  const numericId = Number(entryId)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return null
  }
  return `/api/ai/v1/entries/${numericId}/summary`
}

const isShortText = (value, maxLength, allowEmpty = false) =>
  typeof value === "string" && (allowEmpty || value.trim().length > 0) && value.length <= maxLength

const isStringArray = (value, { maxItems, maxLength, allowEmptyItems = false }) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => isShortText(item, maxLength, allowEmptyItems))

const isUniqueParagraphIdArray = (value, maxItems) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => typeof item === "string" && PARAGRAPH_ID_PATTERN.test(item)) &&
  new Set(value).size === value.length

const isGroundedPointArray = (value, maxItems = 3) =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every(
    (point) =>
      point &&
      typeof point === "object" &&
      !Array.isArray(point) &&
      Object.keys(point).length === 2 &&
      isShortText(point.text, 1000) &&
      isUniqueParagraphIdArray(point.paragraph_ids, 8) &&
      point.paragraph_ids.length > 0,
  )

const V2_POINT_FIELDS = ["key_points", "facts", "implications", "action_points", "open_questions"]
const V2_PROVENANCE_KEYS = [
  "content_origin",
  "content_fingerprint",
  "provider_id",
  "model_id",
  "effective_model_id",
  "prompt_version",
  "profile_version",
  "fallback_used",
]

const validateArticleSummaryResponseV2 = (payload, { entryId, requestId, modelId }) => {
  const numericEntryId = Number(entryId)
  if (
    Object.keys(payload).length !== 15 ||
    !UUID_PATTERN.test(payload.request_id ?? "") ||
    payload.request_id !== requestId ||
    !Number.isSafeInteger(numericEntryId) ||
    payload.entry_id !== numericEntryId ||
    !SUMMARY_STATUSES.has(payload.status) ||
    !CONTENT_SCOPES.has(payload.content_scope) ||
    !isShortText(payload.summary, 3000, true) ||
    !isUniqueParagraphIdArray(payload.summary_paragraph_ids, 32) ||
    !V2_POINT_FIELDS.every((field) => isGroundedPointArray(payload[field], 6)) ||
    !isStringArray(payload.limitations, { maxItems: 8, maxLength: 500 }) ||
    !payload.profile ||
    typeof payload.profile !== "object" ||
    !Array.isArray(payload.profile.sections)
  ) {
    return null
  }
  const { provenance } = payload
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).length !== V2_PROVENANCE_KEYS.length ||
    !V2_PROVENANCE_KEYS.every((key) => key in provenance) ||
    // The backend summarizes only its own Miniflux snapshot; any other origin is rejected.
    provenance.content_origin !== "ORIGINAL_MINIFLUX" ||
    provenance.fallback_used !== false ||
    provenance.model_id !== modelId ||
    !FINGERPRINT_PATTERN.test(provenance.content_fingerprint ?? "") ||
    !["provider_id", "effective_model_id", "prompt_version"].every(
      (key) => provenance[key] === null || isShortText(provenance[key], 128),
    )
  ) {
    return null
  }
  if (payload.status === "complete" && payload.content_scope !== "full") {
    return null
  }
  const generated = payload.status === "complete" || payload.status === "partial"
  if (generated && (!payload.summary.trim() || payload.summary_paragraph_ids.length === 0)) {
    return null
  }
  if (
    !generated &&
    (payload.summary ||
      payload.summary_paragraph_ids.length > 0 ||
      V2_POINT_FIELDS.some((field) => payload[field].length > 0))
  ) {
    return null
  }
  return payload
}

export const validateArticleSummaryResponse = (payload, { entryId, requestId, modelId } = {}) => {
  if (payload && typeof payload === "object" && payload.schema_version === "2") {
    return modelId
      ? validateArticleSummaryResponseV2(payload, { entryId, requestId, modelId })
      : null
  }
  const numericEntryId = Number(entryId)
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 11 ||
    payload.schema_version !== "1" ||
    !UUID_PATTERN.test(payload.request_id ?? "") ||
    payload.request_id !== requestId ||
    !Number.isSafeInteger(numericEntryId) ||
    payload.entry_id !== numericEntryId ||
    !SUMMARY_STATUSES.has(payload.status) ||
    !CONTENT_SCOPES.has(payload.content_scope) ||
    !isShortText(payload.summary, 3000, true) ||
    !isUniqueParagraphIdArray(payload.summary_paragraph_ids, 32) ||
    !isGroundedPointArray(payload.key_points) ||
    !isGroundedPointArray(payload.action_points) ||
    !isStringArray(payload.limitations, { maxItems: 8, maxLength: 500 })
  ) {
    return null
  }

  const { provenance } = payload
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    Object.keys(provenance).length !== 6 ||
    provenance.content_origin !== "miniflux" ||
    !FINGERPRINT_PATTERN.test(provenance.content_fingerprint ?? "") ||
    !["provider_id", "deployment_id", "effective_model_id", "prompt_version"].every(
      (key) => provenance[key] === null || isShortText(provenance[key], 128),
    )
  ) {
    return null
  }

  if (payload.status === "complete" && payload.content_scope !== "full") {
    return null
  }
  if (payload.status === "complete" || payload.status === "partial") {
    if (
      !payload.summary.trim() ||
      payload.summary_paragraph_ids.length === 0 ||
      payload.key_points.length === 0
    ) {
      return null
    }
  } else if (
    payload.summary ||
    payload.summary_paragraph_ids.length > 0 ||
    payload.key_points.length > 0 ||
    payload.action_points.length > 0
  ) {
    return null
  }

  const referencedParagraphs = [
    ...payload.summary_paragraph_ids,
    ...payload.key_points.flatMap((point) => point.paragraph_ids),
    ...payload.action_points.flatMap((point) => point.paragraph_ids),
  ]
  if (!referencedParagraphs.every((id) => PARAGRAPH_ID_PATTERN.test(id))) {
    return null
  }

  return payload
}

export const validateArticleSummaryError = (payload, { requestId } = {}) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 3 ||
    payload.schema_version !== "1" ||
    (payload.request_id !== null &&
      (!UUID_PATTERN.test(payload.request_id ?? "") || payload.request_id !== requestId)) ||
    !payload.error ||
    typeof payload.error !== "object" ||
    Array.isArray(payload.error) ||
    Object.keys(payload.error).length !== 2 ||
    !SUMMARY_ERROR_CODES.has(payload.error.code) ||
    typeof payload.error.retryable !== "boolean"
  ) {
    return null
  }
  return { code: payload.error.code, retryable: payload.error.retryable }
}

export const parseArticleSummaryResponse = async (response, options) => {
  if (
    !response ||
    !response.headers?.get("content-type")?.toLowerCase().includes("application/json")
  ) {
    return { kind: "invalid" }
  }
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    return { kind: "invalid" }
  }
  let text
  try {
    text = await response.text()
  } catch {
    return { kind: "invalid" }
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    return { kind: "invalid" }
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    return { kind: "invalid" }
  }
  if (response.ok) {
    const summary = validateArticleSummaryResponse(payload, options)
    return summary ? { kind: "summary", summary } : { kind: "invalid" }
  }
  if (
    (response.status === 422 && payload?.status === "insufficient") ||
    (response.status === 503 && payload?.status === "unavailable")
  ) {
    const summary = validateArticleSummaryResponse(payload, options)
    return summary ? { kind: "summary", summary } : { kind: "invalid" }
  }
  const error = validateArticleSummaryError(payload, options)
  return error ? { kind: "error", error } : { kind: "invalid" }
}

export const isCurrentArticleSummaryRequest = (
  request,
  { requestId, entryId, activeEntryId, routeEntryId, sessionRevision, authSessionKey },
) =>
  Boolean(
    request &&
    request.requestId === requestId &&
    request.entryId === entryId &&
    request.entryId === activeEntryId &&
    Number(routeEntryId) === request.entryId &&
    request.sessionRevision === sessionRevision &&
    request.authSessionKey === authSessionKey,
  )

const CATALOG_REASONS = new Set([
  null,
  "INFERENCE_DISABLED",
  "EXTERNAL_TRANSFER_NOT_AUTHORIZED",
  "NOT_CONFIGURED",
  "PAID_NOT_AUTHORIZED",
  "PRICE_NOT_VERIFIED",
  "RUNTIME_UNAVAILABLE",
])
const CATALOG_PRICING = new Set([
  "operator_declared_zero",
  "operator_declared_paid",
  "not_verified",
])
const CATALOG_NOTICES = new Set([
  "ARTICLE_SENT_TO_MODEL_PROVIDER",
  "PRICE_DECLARED_BY_OPERATOR",
  "PAID_INFERENCE",
])
const CATALOG_MODEL_IDS = new Set(["s5-free", "mistral-small"])
const isNullableNumber = (value) =>
  value === null || (typeof value === "number" && Number.isFinite(value))
const isNullablePrice = (value) =>
  value === null || (typeof value === "string" && /^[0-9]{1,12}(\.[0-9]{1,12})?$/u.test(value))

export const validateModelCatalog = (payload) => {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.schema_version !== "1" ||
    !(payload.default_model_id === null || CATALOG_MODEL_IDS.has(payload.default_model_id)) ||
    !Array.isArray(payload.models) ||
    payload.models.length > 8
  ) {
    return null
  }
  const models = []
  for (const model of payload.models) {
    if (
      !model ||
      typeof model !== "object" ||
      !CATALOG_MODEL_IDS.has(model.id) ||
      !isShortText(model.label, 64) ||
      !isShortText(model.provider, 64) ||
      typeof model.available !== "boolean" ||
      !CATALOG_REASONS.has(model.unavailable_reason) ||
      model.available !== (model.unavailable_reason === null) ||
      typeof model.requires_paid_authorization !== "boolean" ||
      !model.pricing ||
      !CATALOG_PRICING.has(model.pricing.status) ||
      !isNullablePrice(model.pricing.input_usd_per_million) ||
      !isNullablePrice(model.pricing.output_usd_per_million) ||
      !model.limits ||
      !["max_input_tokens", "max_output_tokens", "requests_per_minute", "timeout_seconds"].every(
        (key) => isNullableNumber(model.limits[key]),
      ) ||
      !Array.isArray(model.notices) ||
      !model.notices.every((notice) => CATALOG_NOTICES.has(notice))
    ) {
      return null
    }
    models.push({
      id: model.id,
      label: model.label,
      provider: model.provider,
      available: model.available,
      unavailableReason: model.unavailable_reason,
      requiresPaidAuthorization: model.requires_paid_authorization,
      pricing: { ...model.pricing },
      limits: { ...model.limits },
      notices: [...model.notices],
    })
  }
  return { default_model_id: payload.default_model_id, models }
}
