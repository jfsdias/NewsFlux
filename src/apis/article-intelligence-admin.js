/** Admin-only NewsFlux LiteLLM settings transport. Secrets are transient request bodies only. */
import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

const ROOT = "/api/ai/v1/admin/litellm/"
const ALLOWED_ACTIONS = new Set([
  "status",
  "models",
  "policy",
  "test-key",
  "save-key",
  "approve-model",
  "remove-model",
  "migration-preview",
  "migrate-policy",
])
// Exact phrase the server requires; sent only after the administrator ticks the confirmation.
const MIGRATION_CONFIRMATION = "MIGRATE-LEGACY-POLICY"
const MAX_RESPONSE_BYTES = 96 * 1024

export class AdminLiteLLMError extends Error {
  constructor(code, status) {
    super(code)
    this.name = "AdminLiteLLMError"
    this.code = code
    this.status = status
  }
}

const safeCode = (value) =>
  typeof value === "string" && /^[A-Z_]{2,64}$/.test(value) ? value : "CONFIG_UNAVAILABLE"

const request = async (action, body, { signal } = {}) => {
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new AdminLiteLLMError("INVALID_REQUEST", 400)
  }
  const auth = authState.get()
  const revision = getDataSessionRevision()
  const sessionKey = getAuthSessionKey(auth)
  if (!auth.server || !hasProvisionedApiKey(auth)) {
    throw new AdminLiteLLMError("UNAUTHENTICATED", 401)
  }
  const response = await fetch(ROOT + action, {
    method: body === undefined ? "GET" : "POST",
    mode: "same-origin",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
    headers: {
      "X-Miniflux-API-Key": auth.token,
      "X-NewsFlux-Miniflux-Server": auth.server,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AdminLiteLLMError("CONFIG_UNAVAILABLE", response.status)
  }
  const content = await response.text()
  if (new TextEncoder().encode(content).byteLength > MAX_RESPONSE_BYTES) {
    throw new AdminLiteLLMError("CONFIG_UNAVAILABLE", response.status)
  }
  let data
  try {
    data = JSON.parse(content)
  } catch {
    throw new AdminLiteLLMError("CONFIG_UNAVAILABLE", response.status)
  }
  if (getDataSessionRevision() !== revision || getAuthSessionKey(authState.get()) !== sessionKey) {
    return null
  }
  if (!response.ok) {
    throw new AdminLiteLLMError(safeCode(data?.error?.code), response.status)
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new AdminLiteLLMError("CONFIG_UNAVAILABLE", response.status)
  }
  return data
}

export const readLiteLLMStatus = (options) => request("status", undefined, options)
export const readLiteLLMModels = (options) => request("models", undefined, options)
export const readLiteLLMPolicy = (options) => request("policy", undefined, options)
export const testLiteLLMKey = (key, options) => request("test-key", { key }, options)
export const replaceLiteLLMKey = (key, expectedRevision, options) =>
  request("save-key", { key, expected_revision: expectedRevision }, options)
export const approveLiteLLMModel = (alias, expectedRevision, allowPaid, allowExternal, options) =>
  request(
    "approve-model",
    {
      alias,
      expected_revision: expectedRevision,
      allow_paid: allowPaid === true,
      allow_external: allowExternal === true,
    },
    options,
  )
export const removeLiteLLMModel = (alias, expectedRevision, options) =>
  request("remove-model", { alias, expected_revision: expectedRevision }, options)
export const readLiteLLMMigrationPreview = (options) =>
  request("migration-preview", undefined, options)
export const migrateLiteLLMPolicy = (expectedRevision, previewToken, options) =>
  request(
    "migrate-policy",
    {
      expected_revision: expectedRevision,
      preview_token: previewToken,
      confirm: MIGRATION_CONFIRMATION,
    },
    options,
  )
