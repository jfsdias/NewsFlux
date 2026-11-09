import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"
import {
  buildContentFallbackReaderUrl,
  getContentFallbackReaderBasePath,
  validateContentFallbackReaderResponse,
} from "@/utils/content-fallback-reader"

const MAX_RESPONSE_TEXT_LENGTH = 2 * 1024 * 1024 + 16 * 1024

export const fingerprintArticleUrl = async (url) => {
  if (typeof url !== "string" || !url || url.length > 8192 || !globalThis.crypto?.subtle) {
    throw new Error("Reader recovery is unavailable")
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

export const requestReaderContentRecovery = async ({ entryId, url, basePath } = {}) => {
  const auth = authState.get()
  const sessionRevision = getDataSessionRevision()
  const expectedAuthSessionKey = getAuthSessionKey(auth)
  const endpoint = buildContentFallbackReaderUrl(
    basePath ?? getContentFallbackReaderBasePath(),
    entryId,
  )
  if (!endpoint || !hasProvisionedApiKey(auth) || !auth.server || !url) {
    throw new Error("Reader recovery is unavailable")
  }

  const urlFingerprint = await fingerprintArticleUrl(url)
  if (
    getDataSessionRevision() !== sessionRevision ||
    getAuthSessionKey(authState.get()) !== expectedAuthSessionKey
  ) {
    throw new Error("Reader recovery is unavailable")
  }

  const response = await fetch(endpoint, {
    method: "POST",
    mode: "same-origin",
    headers: {
      "X-Miniflux-API-Key": auth.token,
      "X-NewsFlux-Miniflux-Server": auth.server,
    },
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  })

  if (
    !response.ok ||
    !response.headers.get("content-type")?.toLowerCase().includes("application/json")
  ) {
    throw new Error("Reader recovery is unavailable")
  }

  const responseText = await response.text()
  if (responseText.length > MAX_RESPONSE_TEXT_LENGTH) {
    throw new Error("Reader recovery is unavailable")
  }

  let payload
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new Error("Reader recovery is unavailable")
  }

  if (
    getDataSessionRevision() !== sessionRevision ||
    getAuthSessionKey(authState.get()) !== expectedAuthSessionKey
  ) {
    throw new Error("Reader recovery is unavailable")
  }

  const validated = validateContentFallbackReaderResponse(payload, { entryId, urlFingerprint })
  if (!validated) {
    throw new Error("Reader recovery is unavailable")
  }
  return validated
}
