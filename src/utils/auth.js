import isURL from "validator/lib/isURL"

export const encodeBasicAuthCredentials = (username = "", password = "") => {
  const rawCredentials = `${username}:${password}`
  if (typeof TextEncoder === "function" && typeof btoa === "function") {
    const bytes = new TextEncoder().encode(rawCredentials)
    let binary = ""
    for (const byte of bytes) {
      binary += String.fromCodePoint(byte)
    }
    return btoa(binary)
  }
  return btoa(rawCredentials)
}

export const getAuthHeaders = ({ token = "", username = "", password = "" } = {}) =>
  token
    ? { "X-Auth-Token": token }
    : { Authorization: `Basic ${encodeBasicAuthCredentials(username, password)}` }

export const getAuthSessionKey = ({ server = "", token = "", username = "", password = "" } = {}) =>
  JSON.stringify([server ?? "", token ?? "", username ?? "", password ?? ""])

export const isLegacyPasswordAuth = (auth = {}) => {
  const { server, token, username, password } = auth ?? {}
  if (!server || !isURL(server, { require_protocol: true })) {
    return false
  }
  return !token && Boolean(username && password)
}

export const hasProvisionedApiKey = (auth = {}) => {
  const { token, apiKeyId } = auth ?? {}
  const numericId = Number(apiKeyId)
  return Boolean(token) && Number.isSafeInteger(numericId) && numericId > 0
}

export const redactSensitiveAuthText = (input, secrets = []) => {
  let sanitized = typeof input === "string" ? input : String(input ?? "")

  sanitized = sanitized
    .replaceAll(/\bBasic\s+[A-Za-z0-9+/=_-]+/gi, "Basic [REDACTED]")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replaceAll(/([?&](?:password|token|api_key|apiKey)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replaceAll(/(https?:\/\/[^/\s:@]+:)[^@\s/]+@/gi, "$1[REDACTED]@")

  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      sanitized = sanitized.replaceAll(secret, "[REDACTED]")
    }
  }

  return sanitized
}

export const getSafeAuthErrorDetails = (error, secrets = []) => {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Unknown error")
  const extraSecrets = [...secrets]

  const headerAuth = error?.options?.headers?.Authorization ?? error?.headers?.Authorization
  const headerToken = error?.options?.headers?.["X-Auth-Token"] ?? error?.headers?.["X-Auth-Token"]
  if (typeof headerAuth === "string" && headerAuth.length > 0) {
    extraSecrets.push(headerAuth, headerAuth.replace(/^Basic\s+/i, ""))
  }
  if (typeof headerToken === "string" && headerToken.length > 0) {
    extraSecrets.push(headerToken)
  }

  return {
    message: redactSensitiveAuthText(rawMessage, extraSecrets),
    status: error?.status ?? error?.response?.status,
  }
}

const isValidAuth = (auth = {}) => {
  const { server, token, username, password } = auth ?? {}
  if (!server || !isURL(server, { require_protocol: true })) {
    return false
  }
  return Boolean(token || (username && password))
}

export default isValidAuth
