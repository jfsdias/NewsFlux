import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import {
  buildArticleSummaryPath,
  parseArticleSummaryResponse,
  validateModelCatalog,
} from "@/utils/article-intelligence-summary"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

const isSameSession = (revision, sessionKey) =>
  getDataSessionRevision() === revision && getAuthSessionKey(authState.get()) === sessionKey

const MODEL_CATALOG_PATH = "/api/ai/v1/models"
const MAX_CATALOG_BYTES = 16 * 1024

const authHeaders = (auth) => ({
  "X-Miniflux-API-Key": auth.token,
  "X-NewsFlux-Miniflux-Server": auth.server,
})

// The catalog is authenticated and per identity; the caller keys any cache by auth session.
export const fetchModelCatalog = async ({ signal } = {}) => {
  const auth = authState.get()
  const revision = getDataSessionRevision()
  const sessionKey = getAuthSessionKey(auth)
  if (!auth.server || !hasProvisionedApiKey(auth)) {
    throw new TypeError("Model catalog is unavailable")
  }
  const response = await fetch(MODEL_CATALOG_PATH, {
    method: "GET",
    mode: "same-origin",
    headers: authHeaders(auth),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  })
  if (
    !response.ok ||
    !response.headers.get("content-type")?.toLowerCase().includes("application/json")
  ) {
    const error = new TypeError("Model catalog is unavailable")
    // Lets the Reader name the cause (for example an unauthorized session) instead of "network".
    error.status = response.status
    throw error
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_CATALOG_BYTES) {
    throw new TypeError("Model catalog is unavailable")
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new TypeError("Model catalog is unavailable")
  }
  if (!isSameSession(revision, sessionKey)) {
    return null
  }
  const catalog = validateModelCatalog(payload)
  if (!catalog) {
    throw new TypeError("Model catalog is unavailable")
  }
  return { ...catalog, sessionKey }
}

const buildSummaryBody = ({ requestId, modelId, fallbackModelId, consent, profile }) => {
  if (!(modelId && profile)) {
    return { schema_version: "1", request_id: requestId, profile_id: "editorial-default" }
  }
  if (fallbackModelId) {
    // v3 only when a distinct fallback is explicitly configured; otherwise the v2 contract.
    return {
      schema_version: "3",
      request_id: requestId,
      primary_model_id: modelId,
      fallback_model_id: fallbackModelId,
      fallback_consent: {
        paid: consent?.paid === true,
        cross_provider: consent?.cross_provider === true,
      },
      profile,
    }
  }
  return { schema_version: "2", request_id: requestId, model_id: modelId, profile }
}

const requestArticleSummary = async ({
  entryId,
  signal,
  modelId,
  fallbackModelId = null,
  consent,
  profile,
} = {}) => {
  const path = buildArticleSummaryPath(entryId)
  const auth = authState.get()
  const revision = getDataSessionRevision()
  const sessionKey = getAuthSessionKey(auth)
  if (!path || !auth.server || !hasProvisionedApiKey(auth)) {
    throw new TypeError("Article summary is unavailable")
  }

  const requestId = globalThis.crypto?.randomUUID?.()
  if (typeof requestId !== "string") {
    throw new TypeError("Article summary is unavailable")
  }
  if (!isSameSession(revision, sessionKey)) {
    return null
  }

  const response = await fetch(path, {
    method: "POST",
    mode: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(auth),
    },
    body: JSON.stringify(
      buildSummaryBody({ requestId, modelId, fallbackModelId, consent, profile }),
    ),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    // POST must carry a real Origin header: under the page's no-referrer policy browsers send `Origin: null`,
    // which the API refuses (NOT_AUTHORIZED). strict-origin sends only the origin, never the path.
    referrerPolicy: "strict-origin",
    signal,
  })

  const result = await parseArticleSummaryResponse(response, {
    entryId: Number(entryId),
    requestId,
    modelId: modelId && profile ? modelId : undefined,
    fallbackModelId: modelId && profile ? fallbackModelId : undefined,
  })
  if (!isSameSession(revision, sessionKey)) {
    return null
  }
  return result
}

export default requestArticleSummary
