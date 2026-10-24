import { ofetch } from "ofetch"

import { authState, normalizeApiKeyId, normalizeAuthValue, setAuth } from "@/store/authState"
import isValidAuth, {
  encodeBasicAuthCredentials,
  getAuthHeaders,
  getSafeAuthErrorDetails,
  isLegacyPasswordAuth,
} from "@/utils/auth"
import { checkMinifluxCompatibility } from "@/utils/miniflux-compatibility"
import { clearSession, startSession } from "@/utils/session"

let descriptionCounter = 0
const inFlightProvisioningBySession = new Map()

const createRandomSuffix = () => {
  descriptionCounter += 1
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().slice(0, 8)
  }
  const randomHex = Math.floor(Math.random() * 0xff_ff_ff_ff)
    .toString(16)
    .padStart(8, "0")
  return `${randomHex}-${descriptionCounter}`
}

export const buildDedicatedApiKeyDescription = ({
  clientLabel = "NewsFlux",
  now = new Date(),
  randomSuffix = createRandomSuffix(),
} = {}) => {
  const timestamp = (now instanceof Date ? now : new Date(now)).toISOString()
  return `${clientLabel} (${timestamp} #${randomSuffix})`
}

export const createAuthProvisioningError = (
  message,
  { code = "AUTH_PROVISIONING_ERROR", stage = "unknown", status, cause, secrets = [] } = {},
) => {
  const safeDetails = getSafeAuthErrorDetails(cause ?? new Error(message), secrets)
  const error = new Error(safeDetails.message || message)
  error.name = "AuthProvisioningError"
  error.code = code
  error.stage = stage
  error.status = status ?? safeDetails.status
  return error
}

const isValidUserIdentity = (user) =>
  Boolean(user && typeof user === "object" && Number.isSafeInteger(user.id) && user.id > 0)

export const revokeDedicatedApiKey = async (
  auth,
  { apiKeyId = auth?.apiKeyId, rawFetch = ofetch.raw, signal } = {},
) => {
  const normalizedId = normalizeApiKeyId(apiKeyId)
  const normalizedAuth = normalizeAuthValue(auth)
  if (!normalizedId || !isValidAuth(normalizedAuth)) {
    return { attempted: false, revoked: false }
  }

  try {
    const response = await rawFetch(`v1/api-keys/${normalizedId}`, {
      baseURL: normalizedAuth.server,
      headers: getAuthHeaders(normalizedAuth),
      method: "DELETE",
      redirect: "error",
      retry: false,
      signal,
    })
    return {
      attempted: true,
      revoked: response?.status === 204 || response?.status === 200 || response?.status === 404,
    }
  } catch (error) {
    if (error?.status === 404 || error?.response?.status === 404) {
      return { attempted: true, revoked: true }
    }
    const secrets = [
      normalizedAuth.password,
      normalizedAuth.token,
      normalizedAuth.username && normalizedAuth.password
        ? encodeBasicAuthCredentials(normalizedAuth.username, normalizedAuth.password)
        : "",
    ]
    console.error("Failed to revoke dedicated API key:", getSafeAuthErrorDetails(error, secrets))
    return { attempted: true, revoked: false }
  }
}

export const logoutWithKeyRevocation = async ({
  auth = authState.get(),
  rawFetch = ofetch.raw,
  onClearSession = clearSession,
  onAfterClear,
  signal,
} = {}) => {
  const snapshotAuth = normalizeAuthValue(auth)
  let revocationResult = { attempted: false, revoked: false }

  try {
    if (snapshotAuth.apiKeyId) {
      revocationResult = await revokeDedicatedApiKey(snapshotAuth, {
        apiKeyId: snapshotAuth.apiKeyId,
        rawFetch,
        signal,
      })
    }
  } finally {
    onClearSession()
    onAfterClear?.()
  }

  return revocationResult
}

const executeProvisionDedicatedApiKeySession = async (
  normalizedAuth,
  {
    consent = false,
    rawFetch = ofetch.raw,
    checkCompatibility = checkMinifluxCompatibility,
    commitSession = startSession,
    signal,
  } = {},
) => {
  const { server, token, username, password } = normalizedAuth
  const basicSecret = username && password ? encodeBasicAuthCredentials(username, password) : ""
  const baseSecrets = [password, token, basicSecret]

  if (!isValidAuth(normalizedAuth)) {
    throw createAuthProvisioningError("Invalid authentication parameters", {
      code: "INVALID_AUTH_INPUT",
      stage: "validation",
      secrets: baseSecrets,
    })
  }

  const isPasswordFlow = !token && Boolean(username && password)
  if (isPasswordFlow && consent !== true) {
    throw createAuthProvisioningError(
      "Explicit user consent is required to create a dedicated Miniflux API key.",
      {
        code: "AUTH_CONSENT_REQUIRED",
        stage: "consent",
        secrets: baseSecrets,
      },
    )
  }

  // Step 1: Authenticate initial credentials against /v1/me
  let initialMeResponse
  try {
    initialMeResponse = await rawFetch("v1/me", {
      baseURL: server,
      headers: getAuthHeaders(normalizedAuth),
      method: "GET",
      redirect: "error",
      retry: false,
      signal,
    })
  } catch (error) {
    throw createAuthProvisioningError("Initial authentication check failed", {
      code: "INITIAL_AUTH_FAILED",
      stage: isPasswordFlow ? "password-login" : "token-login",
      cause: error,
      secrets: baseSecrets,
    })
  }

  if (initialMeResponse?.status !== 200) {
    throw createAuthProvisioningError("Initial authentication check returned non-200 status", {
      code: "INITIAL_AUTH_NON_200",
      stage: isPasswordFlow ? "password-login" : "token-login",
      status: initialMeResponse?.status,
      secrets: baseSecrets,
    })
  }

  const initialUser = initialMeResponse._data
  if (!isValidUserIdentity(initialUser)) {
    throw createAuthProvisioningError("The server returned an invalid user identity.", {
      code: "INVALID_USER_IDENTITY",
      stage: isPasswordFlow ? "password-login" : "token-login",
      secrets: baseSecrets,
    })
  }

  // Step 2: Check Miniflux compatibility before creating any key
  let compatibility
  try {
    compatibility = await checkCompatibility(normalizedAuth, { signal })
  } catch (error) {
    throw createAuthProvisioningError("Failed to check Miniflux compatibility", {
      code: "COMPATIBILITY_CHECK_FAILED",
      stage: "compatibility",
      cause: error,
      secrets: baseSecrets,
    })
  }

  if (compatibility.status !== "supported") {
    return {
      status: "incompatible",
      auth: null,
      compatibility,
      currentUser: initialUser,
    }
  }

  // Manual token login path: commit without apiKeyId so user's manual token is never revoked on logout
  if (!isPasswordFlow) {
    const manualTokenAuth = normalizeAuthValue({
      server,
      token,
      apiKeyId: null,
      username: initialUser.username || username || "",
      password: "",
    })

    try {
      commitSession(manualTokenAuth, compatibility.version, initialUser)
    } catch (error) {
      throw createAuthProvisioningError("Failed to store authentication session", {
        code: "STORE_AUTH_FAILED",
        stage: "store-auth",
        cause: error,
        secrets: baseSecrets,
      })
    }

    return {
      status: "authenticated",
      auth: manualTokenAuth,
      compatibility,
      currentUser: initialUser,
    }
  }

  // Step 3: Create dedicated installation API key via POST /v1/api-keys
  const description = buildDedicatedApiKeyDescription({ server, username })
  let createKeyResponse
  try {
    createKeyResponse = await rawFetch("v1/api-keys", {
      baseURL: server,
      body: { description },
      headers: getAuthHeaders({ username, password }),
      method: "POST",
      redirect: "error",
      retry: false,
      signal,
    })
  } catch (error) {
    throw createAuthProvisioningError("Failed to create dedicated Miniflux API key", {
      code: "CREATE_API_KEY_FAILED",
      stage: "create-key",
      cause: error,
      secrets: baseSecrets,
    })
  }

  if (createKeyResponse?.status !== 201 && createKeyResponse?.status !== 200) {
    throw createAuthProvisioningError("Unexpected status creating Miniflux API key", {
      code: "CREATE_API_KEY_FAILED",
      stage: "create-key",
      status: createKeyResponse?.status,
      secrets: baseSecrets,
    })
  }

  const createdKeyData = createKeyResponse._data
  const createdKeyId = normalizeApiKeyId(createdKeyData?.id)
  const createdToken = typeof createdKeyData?.token === "string" ? createdKeyData.token.trim() : ""

  if (!createdKeyId || !createdToken) {
    if (createdKeyId) {
      await revokeDedicatedApiKey(
        { server, username, password },
        { apiKeyId: createdKeyId, rawFetch, signal },
      )
    }
    throw createAuthProvisioningError("Miniflux returned an invalid API key payload", {
      code: "INVALID_API_KEY_RESPONSE",
      stage: "create-key",
      secrets: [...baseSecrets, createdToken],
    })
  }

  const allSecrets = [...baseSecrets, createdToken]

  // Step 4: Verify the newly created key via GET /v1/me using X-Auth-Token BEFORE committing
  let verifyResponse
  try {
    verifyResponse = await rawFetch("v1/me", {
      baseURL: server,
      headers: { "X-Auth-Token": createdToken },
      method: "GET",
      redirect: "error",
      retry: false,
      signal,
    })
  } catch (error) {
    await revokeDedicatedApiKey(
      { server, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    throw createAuthProvisioningError("Failed to verify newly created API key via /v1/me", {
      code: "VERIFY_API_KEY_FAILED",
      stage: "verify-key",
      cause: error,
      secrets: allSecrets,
    })
  }

  const verifiedUser = verifyResponse?._data
  if (
    verifyResponse?.status !== 200 ||
    !isValidUserIdentity(verifiedUser) ||
    verifiedUser.id !== initialUser.id
  ) {
    await revokeDedicatedApiKey(
      { server, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    throw createAuthProvisioningError("Newly created API key failed /v1/me identity verification", {
      code: "VERIFY_API_KEY_IDENTITY_MISMATCH",
      stage: "verify-key",
      status: verifyResponse?.status,
      secrets: allSecrets,
    })
  }

  // Step 5: Store token + apiKeyId and drop password ONLY after successful verification
  const previousAuth = normalizeAuthValue(authState.get())
  const committedAuth = normalizeAuthValue({
    server,
    token: createdToken,
    apiKeyId: createdKeyId,
    username: verifiedUser.username || username || "",
    password: "",
  })

  try {
    commitSession(committedAuth, compatibility.version, verifiedUser)
  } catch (error) {
    try {
      setAuth(previousAuth)
    } catch {
      // Preserve best-effort fallback
    }
    await revokeDedicatedApiKey(
      { server, token: createdToken, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    throw createAuthProvisioningError("Failed to persist verified API key session", {
      code: "STORE_AUTH_FAILED",
      stage: "store-auth",
      cause: error,
      secrets: allSecrets,
    })
  }

  return {
    status: "authenticated",
    auth: committedAuth,
    compatibility,
    currentUser: verifiedUser,
  }
}

export const provisionDedicatedApiKeySession = (auth, options = {}) => {
  const normalizedAuth = normalizeAuthValue(auth)
  const isPasswordFlow =
    !normalizedAuth.token && Boolean(normalizedAuth.username && normalizedAuth.password)

  if (!isPasswordFlow || options.consent !== true) {
    return executeProvisionDedicatedApiKeySession(normalizedAuth, options)
  }

  const singleFlightKey = `${normalizedAuth.server}::${normalizedAuth.username}`
  const existingPromise = inFlightProvisioningBySession.get(singleFlightKey)
  if (existingPromise) {
    return existingPromise
  }

  const provisioningPromise = executeProvisionDedicatedApiKeySession(
    normalizedAuth,
    options,
  ).finally(() => {
    inFlightProvisioningBySession.delete(singleFlightKey)
  })

  inFlightProvisioningBySession.set(singleFlightKey, provisioningPromise)
  return provisioningPromise
}

export const migrateLegacyPasswordSession = async ({
  auth = authState.get(),
  consent = false,
  rawFetch = ofetch.raw,
  checkCompatibility = checkMinifluxCompatibility,
  commitSession = startSession,
  signal,
} = {}) => {
  const normalizedAuth = normalizeAuthValue(auth)
  if (!isLegacyPasswordAuth(normalizedAuth)) {
    return {
      status: "not-needed",
      auth: normalizedAuth,
    }
  }

  return provisionDedicatedApiKeySession(normalizedAuth, {
    consent,
    rawFetch,
    checkCompatibility,
    commitSession,
    signal,
  })
}
