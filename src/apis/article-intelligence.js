import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import {
  buildArticleSummaryPath,
  parseArticleSummaryResponse,
} from "@/utils/article-intelligence-summary"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"

const isSameSession = (revision, sessionKey) =>
  getDataSessionRevision() === revision && getAuthSessionKey(authState.get()) === sessionKey

const requestArticleSummary = async ({ entryId, signal } = {}) => {
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
      "X-Miniflux-API-Key": auth.token,
      "X-NewsFlux-Miniflux-Server": auth.server,
    },
    body: JSON.stringify({
      schema_version: "1",
      request_id: requestId,
      profile_id: "editorial-default",
    }),
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  })

  const result = await parseArticleSummaryResponse(response, {
    entryId: Number(entryId),
    requestId,
  })
  if (!isSameSession(revision, sessionKey)) {
    return null
  }
  return result
}

export default requestArticleSummary
