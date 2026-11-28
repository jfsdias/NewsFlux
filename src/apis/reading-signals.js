import { authState } from "@/store/authState"
import { getAuthSessionKey, hasProvisionedApiKey } from "@/utils/auth"
import { READING_SIGNALS_BASE_PATH } from "@/utils/reading-signals"

// Same-origin sidecar (ADR 0002). POST must carry a real Origin header: under the page's
// no-referrer policy browsers send `Origin: null`, which the service refuses.
const baseRequest = {
  mode: "same-origin",
  credentials: "omit",
  cache: "no-store",
  redirect: "error",
  referrerPolicy: "strict-origin",
}

const authenticatedHeaders = () => {
  const auth = authState.get()
  if (!hasProvisionedApiKey(auth) || !auth.server) {
    throw new Error("Reading signals are unavailable")
  }
  return {
    sessionKey: getAuthSessionKey(auth),
    headers: { "X-Miniflux-API-Key": auth.token, "X-NewsFlux-Miniflux-Server": auth.server },
  }
}

const isJson = (response) =>
  response.headers.get("content-type")?.toLowerCase().includes("application/json")

// Unauthenticated liveness check, used only when the user turns learning on. A missing route
// falls through to the app shell (HTML), which is not a healthy service.
export const probeReadingSignals = async ({ signal } = {}) => {
  try {
    const response = await fetch(`${READING_SIGNALS_BASE_PATH}/healthz`, { ...baseRequest, signal })
    if (!response.ok || !isJson(response)) {
      return false
    }
    const payload = await response.json()
    return payload?.status === "ok"
  } catch {
    return false
  }
}

export const sendReadingSignals = async (batch, { keepalive = false } = {}) => {
  const { headers, sessionKey } = authenticatedHeaders()
  const response = await fetch(`${READING_SIGNALS_BASE_PATH}/v1/signals`, {
    ...baseRequest,
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(batch),
    keepalive,
  })
  if (getAuthSessionKey(authState.get()) !== sessionKey) {
    throw new Error("Reading signals session changed")
  }
  if (!response.ok || !isJson(response)) {
    throw new Error("Reading signals were not accepted")
  }
  const payload = await response.json()
  if (payload?.accepted !== batch.rows.length) {
    throw new Error("Reading signals were not accepted")
  }
}

export const resetReadingSignalsOnServer = async () => {
  const { headers } = authenticatedHeaders()
  const response = await fetch(`${READING_SIGNALS_BASE_PATH}/v1/signals/reset`, {
    ...baseRequest,
    method: "POST",
    headers,
  })
  if (!response.ok || !isJson(response)) {
    throw new Error("Reading signals could not be reset")
  }
  return response.json()
}
