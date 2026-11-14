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
    throw new TypeError("Model catalog is unavailable")
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

const requestArticleSummary = async ({ entryId, signal, modelId, profile } = {}) => {
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
      modelId && profile
        ? { schema_version: "2", request_id: requestId, model_id: modelId, profile }
        : { schema_version: "1", request_id: requestId, profile_id: "editorial-default" },
    ),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  })

  const result = await parseArticleSummaryResponse(response, {
    entryId: Number(entryId),
    requestId,
    modelId: modelId && profile ? modelId : undefined,
  })
  if (!isSameSession(revision, sessionKey)) {
    return null
  }
  return result
}

export default requestArticleSummary
