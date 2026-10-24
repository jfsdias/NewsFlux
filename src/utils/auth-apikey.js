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
const MAX_DESCRIPTION_COLLISION_RETRIES = 3

export const AUTH_TRANSACTION_JOURNAL_STORAGE_KEY = "newsflux_auth_transaction_journal"
export const AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION = 1
export const AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const ALLOWED_JOURNAL_KEYS = new Set([
  "schemaVersion",
  "server",
  "userId",
  "username",
  "description",
  "state",
  "createdAt",
  "expiresAt",
  "attempt",
])

const FORBIDDEN_JOURNAL_SECRET_KEYS = [
  "password",
  "token",
  "apiKey",
  "api_key",
  "authorization",
  "Authorization",
  "x-auth-token",
  "X-Auth-Token",
  "basicAuth",
  "secret",
]

export const normalizeCanonicalServer = (server = "") => {
  if (typeof server !== "string") {
    return ""
  }
  const trimmed = server.trim()
  if (!trimmed) {
    return ""
  }
  try {
    const parsed = new URL(trimmed)
    const normalizedPath = parsed.pathname.replace(/\/+$/, "")
    return `${parsed.origin}${normalizedPath}`
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}

export const sanitizeAuthTransactionJournalEntry = (
  input = {},
  { now = new Date(), ttlMs = AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS } = {},
) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid auth transaction journal input")
  }

  const server = normalizeCanonicalServer(input.server)
  const userId = normalizeApiKeyId(input.userId)
  const username = typeof input.username === "string" ? input.username.trim() : ""
  const description = typeof input.description === "string" ? input.description.trim() : ""
  const attemptNum = Number(input.attempt ?? 1)
  const attempt = Number.isSafeInteger(attemptNum) && attemptNum > 0 ? attemptNum : 1

  const nowDate = now instanceof Date ? now : new Date(now)
  const nowMs = nowDate.getTime()
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("Invalid auth transaction journal timestamp")
  }

  const createdAtMs =
    typeof input.createdAt === "string" && Number.isFinite(Date.parse(input.createdAt))
      ? Date.parse(input.createdAt)
      : nowMs
  const effectiveTtlMs =
    Number.isFinite(Number(ttlMs)) && Number(ttlMs) > 0
      ? Number(ttlMs)
      : AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS
  const expiresAtMs =
    typeof input.expiresAt === "string" && Number.isFinite(Date.parse(input.expiresAt))
      ? Date.parse(input.expiresAt)
      : createdAtMs + effectiveTtlMs

  if (!server || !userId || !description) {
    throw new Error("Auth transaction journal requires canonical server, userId, and description")
  }

  const entry = {
    schemaVersion: AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION,
    server,
    userId,
    username,
    description,
    state: "pending_create",
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    attempt,
  }

  return Object.freeze(entry)
}

const isValidStoredJournalEntry = (candidate) => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false
  }
  const keys = Object.keys(candidate)
  if (keys.length === 0 || keys.some((key) => !ALLOWED_JOURNAL_KEYS.has(key))) {
    return false
  }
  for (const forbidden of FORBIDDEN_JOURNAL_SECRET_KEYS) {
    if (Object.hasOwn(candidate, forbidden)) {
      return false
    }
  }
  if (candidate.schemaVersion !== AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION) {
    return false
  }
  if (candidate.state !== "pending_create") {
    return false
  }
  const server = normalizeCanonicalServer(candidate.server)
  const userId = normalizeApiKeyId(candidate.userId)
  const description = typeof candidate.description === "string" ? candidate.description.trim() : ""
  if (!server || !userId || !description) {
    return false
  }
  if (typeof candidate.username !== "string") {
    return false
  }
  const createdAtMs = Date.parse(candidate.createdAt)
  const expiresAtMs = Date.parse(candidate.expiresAt)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs < createdAtMs) {
    return false
  }
  const attempt = Number(candidate.attempt)
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    return false
  }
  return true
}

export const readAuthTransactionJournal = ({
  server,
  userId,
  username,
  now = new Date(),
  storage = globalThis.localStorage,
} = {}) => {
  if (!storage || typeof storage.getItem !== "function") {
    return { status: "empty", entry: null }
  }

  let raw
  try {
    raw = storage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)
  } catch {
    return { status: "empty", entry: null }
  }

  if (typeof raw !== "string" || raw.length === 0) {
    return { status: "empty", entry: null }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: "corrupt", entry: null }
  }

  if (!isValidStoredJournalEntry(parsed)) {
    return { status: "corrupt", entry: null }
  }

  const normalizedEntry = Object.freeze({
    schemaVersion: AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION,
    server: normalizeCanonicalServer(parsed.server),
    userId: normalizeApiKeyId(parsed.userId),
    username: parsed.username.trim(),
    description: parsed.description.trim(),
    state: "pending_create",
    createdAt: parsed.createdAt,
    expiresAt: parsed.expiresAt,
    attempt: Number(parsed.attempt),
  })

  if (server !== undefined && server !== null && String(server).trim() !== "") {
    const requestedServer = normalizeCanonicalServer(server)
    if (requestedServer !== normalizedEntry.server) {
      return {
        status: "server-mismatch",
        entry: normalizedEntry,
        preservedEntry: normalizedEntry,
      }
    }
  }

  if (userId !== undefined && userId !== null) {
    const requestedUserId = normalizeApiKeyId(userId)
    if (requestedUserId !== normalizedEntry.userId) {
      return {
        status: "user-mismatch",
        entry: normalizedEntry,
        preservedEntry: normalizedEntry,
      }
    }
  }

  if (
    typeof username === "string" &&
    username.trim() !== "" &&
    normalizedEntry.username !== "" &&
    username.trim().toLowerCase() !== normalizedEntry.username.toLowerCase()
  ) {
    return {
      status: "user-mismatch",
      entry: normalizedEntry,
      preservedEntry: normalizedEntry,
    }
  }

  const nowMs = (now instanceof Date ? now : new Date(now)).getTime()
  const expiresAtMs = Date.parse(parsed.expiresAt)
  if (Number.isFinite(nowMs) && expiresAtMs <= nowMs) {
    return {
      status: "stale",
      entry: normalizedEntry,
      preservedEntry: normalizedEntry,
    }
  }

  return {
    status: "pending",
    entry: normalizedEntry,
  }
}

export const writeAuthTransactionJournal = (
  input,
  {
    now = new Date(),
    ttlMs = AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS,
    storage = globalThis.localStorage,
  } = {},
) => {
  const entry = sanitizeAuthTransactionJournalEntry(input, { now, ttlMs })
  if (!storage || typeof storage.setItem !== "function") {
    throw new Error("Durable localStorage is unavailable for auth transaction journal")
  }

  const existing = readAuthTransactionJournal({
    server: entry.server,
    userId: entry.userId,
    username: entry.username,
    now,
    storage,
  })
  if (existing.status === "corrupt") {
    const error = new Error(
      "Corrupt pending API key transaction journal requires recovery before provisioning a new key",
    )
    error.code = "AUTH_JOURNAL_CORRUPT_REQUIRES_RECOVERY"
    throw error
  }
  if (existing.status === "stale") {
    const error = new Error(
      "Stale pending API key transaction journal requires recovery before provisioning a new key",
    )
    error.code = "AUTH_JOURNAL_STALE_REQUIRES_RECOVERY"
    throw error
  }
  if (existing.status === "server-mismatch" || existing.status === "user-mismatch") {
    const error = new Error(
      "Pending API key transaction journal belongs to another server or user scope",
    )
    error.code = "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING"
    throw error
  }

  storage.setItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY, JSON.stringify(entry))
  return entry
}

const PROTECTED_JOURNAL_STATUSES = new Set(["corrupt", "stale", "server-mismatch", "user-mismatch"])

export const clearAuthTransactionJournal = ({
  server,
  userId,
  username,
  now = new Date(),
  storage = globalThis.localStorage,
  force = false,
} = {}) => {
  if (!storage || typeof storage.removeItem !== "function") {
    return false
  }

  if (!force) {
    const current = readAuthTransactionJournal({ server, userId, username, now, storage })
    if (PROTECTED_JOURNAL_STATUSES.has(current.status)) {
      return false
    }
  }

  try {
    storage.removeItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

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

export const reconcileAuthTransactionJournal = async ({
  server,
  username,
  password,
  userId,
  rawFetch = ofetch.raw,
  now = new Date(),
  storage = globalThis.localStorage,
  signal,
} = {}) => {
  const basicSecret = username && password ? encodeBasicAuthCredentials(username, password) : ""
  const secrets = [password, basicSecret]

  const journalRead = readAuthTransactionJournal({
    server,
    userId,
    username,
    now,
    storage,
  })

  if (journalRead.status === "empty") {
    return {
      status: "empty",
      reconciled: true,
      inspected: 0,
      revokedIds: [],
      preservedEntry: null,
    }
  }

  if (journalRead.status === "corrupt") {
    throw createAuthProvisioningError(
      "Corrupt pending API key transaction journal requires recovery before provisioning a new key",
      {
        code: "AUTH_JOURNAL_CORRUPT_REQUIRES_RECOVERY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  if (journalRead.status === "stale") {
    throw createAuthProvisioningError(
      "Stale pending API key transaction journal requires recovery before provisioning a new key",
      {
        code: "AUTH_JOURNAL_STALE_REQUIRES_RECOVERY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  if (journalRead.status === "server-mismatch" || journalRead.status === "user-mismatch") {
    throw createAuthProvisioningError(
      "Pending API key transaction journal belongs to another server or user scope",
      {
        code: "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  const pendingEntry = journalRead.entry

  let listResponse
  try {
    listResponse = await rawFetch("v1/api-keys", {
      baseURL: server,
      headers: getAuthHeaders({ username, password }),
      method: "GET",
      redirect: "error",
      retry: false,
      signal,
    })
  } catch (error) {
    throw createAuthProvisioningError(
      "Failed to query Miniflux API keys for pending transaction reconciliation",
      {
        code: "ORPHAN_RECONCILIATION_FAILED",
        stage: "reconcile-journal",
        cause: error,
        secrets,
      },
    )
  }

  if (listResponse?.status !== 200 || !Array.isArray(listResponse?._data)) {
    throw createAuthProvisioningError(
      "Unexpected response listing Miniflux API keys for pending transaction reconciliation",
      {
        code: "ORPHAN_RECONCILIATION_FAILED",
        stage: "reconcile-journal",
        status: listResponse?.status,
        secrets,
      },
    )
  }

  const keys = listResponse._data
  const targetDescriptionLower = pendingEntry.description.trim().toLowerCase()

  const matchingKeys = keys.filter((key) => {
    const keyDesc = typeof key?.description === "string" ? key.description.trim() : ""
    if (!keyDesc || keyDesc.toLowerCase() !== targetDescriptionLower) {
      return false
    }
    const sameUser =
      key?.user_id === undefined ||
      key?.user_id === null ||
      Number(key.user_id) === Number(pendingEntry.userId)
    return sameUser
  })

  if (matchingKeys.length === 0) {
    clearAuthTransactionJournal({
      server: pendingEntry.server,
      userId: pendingEntry.userId,
      username: pendingEntry.username,
      now,
      storage,
    })
    return {
      status: "zero-match",
      reconciled: true,
      inspected: keys.length,
      revokedIds: [],
      preservedEntry: null,
    }
  }

  if (matchingKeys.length > 1) {
    throw createAuthProvisioningError(
      "Ambiguous multiple API keys match pending transaction journal; refusing speculative revocation",
      {
        code: "AMBIGUOUS_ORPHAN_API_KEY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  const candidate = matchingKeys[0]
  const candidateId = normalizeApiKeyId(candidate?.id)
  const exactDescriptionMatch =
    typeof candidate?.description === "string" &&
    candidate.description.trim() === pendingEntry.description
  const exactUserMatch =
    candidate?.user_id === undefined ||
    candidate?.user_id === null ||
    Number(candidate.user_id) === Number(pendingEntry.userId)
  const isNeverUsed = candidate?.last_used_at === null || candidate?.last_used_at === undefined

  if (!candidateId || !exactDescriptionMatch || !exactUserMatch || !isNeverUsed) {
    throw createAuthProvisioningError(
      "Matched API key is not an unambiguous unused orphan; refusing speculative revocation",
      {
        code: "AMBIGUOUS_ORPHAN_API_KEY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  const revokeResult = await revokeDedicatedApiKey(
    { server, username, password },
    { apiKeyId: candidateId, rawFetch, signal },
  )

  if (!revokeResult.revoked) {
    throw createAuthProvisioningError(
      "Failed to revoke orphan API key from pending transaction journal",
      {
        code: "ORPHAN_RECONCILIATION_FAILED",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  clearAuthTransactionJournal({
    server: pendingEntry.server,
    userId: pendingEntry.userId,
    username: pendingEntry.username,
    now,
    storage,
  })

  return {
    status: "orphan-revoked",
    reconciled: true,
    inspected: keys.length,
    revokedIds: [candidateId],
    preservedEntry: null,
  }
}

export const reconcilePendingOrphanKeys = reconcileAuthTransactionJournal

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

const DEFINITIVE_PRE_CREATE_REJECTION_STATUSES = new Set([400, 401, 403, 404, 409, 422])

const isDefinitivePreCreateRejectionStatus = (status) =>
  DEFINITIVE_PRE_CREATE_REJECTION_STATUSES.has(status)

const assertNoBlockingJournalBeforeProvisioning = ({
  server,
  userId,
  username,
  now,
  storage,
  secrets,
}) => {
  const journalRead = readAuthTransactionJournal({
    server,
    userId,
    username,
    now,
    storage,
  })

  if (journalRead.status === "corrupt") {
    throw createAuthProvisioningError(
      "Corrupt pending API key transaction journal requires recovery before provisioning a new key",
      {
        code: "AUTH_JOURNAL_CORRUPT_REQUIRES_RECOVERY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  if (journalRead.status === "stale") {
    throw createAuthProvisioningError(
      "Stale pending API key transaction journal requires recovery before provisioning a new key",
      {
        code: "AUTH_JOURNAL_STALE_REQUIRES_RECOVERY",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }

  if (journalRead.status === "server-mismatch" || journalRead.status === "user-mismatch") {
    throw createAuthProvisioningError(
      "Pending API key transaction journal belongs to another server or user scope",
      {
        code: "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
        stage: "reconcile-journal",
        secrets,
      },
    )
  }
}

const executeProvisionDedicatedApiKeySession = async (
  normalizedAuth,
  {
    consent = false,
    rawFetch = ofetch.raw,
    checkCompatibility = checkMinifluxCompatibility,
    commitSession = startSession,
    now = new Date(),
    journalTtlMs = AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS,
    storage = globalThis.localStorage,
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

  if (isPasswordFlow) {
    assertNoBlockingJournalBeforeProvisioning({
      server,
      username,
      now,
      storage,
      secrets: baseSecrets,
    })
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

  // Step 2: Resolve canonical user identity
  const initialUser = initialMeResponse._data
  if (!isValidUserIdentity(initialUser)) {
    throw createAuthProvisioningError("The server returned an invalid user identity.", {
      code: "INVALID_USER_IDENTITY",
      stage: isPasswordFlow ? "password-login" : "token-login",
      secrets: baseSecrets,
    })
  }
  const canonicalUsername = initialUser.username || username || ""

  // Step 3: Check Miniflux compatibility before creating any key
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
      username: canonicalUsername,
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

  // Step 4: Reconcile any prior journal transaction safely BEFORE creating any new key
  await reconcileAuthTransactionJournal({
    server,
    username: canonicalUsername,
    password,
    userId: initialUser.id,
    rawFetch,
    now,
    storage,
    signal,
  })

  // Steps 5–7: Generate exact API-key description, persist PENDING_CREATE journal BEFORE POST /v1/api-keys, then POST /v1/api-keys
  let createKeyResponse
  for (let attempt = 1; attempt <= MAX_DESCRIPTION_COLLISION_RETRIES; attempt += 1) {
    const description = buildDedicatedApiKeyDescription({ now })

    try {
      writeAuthTransactionJournal(
        {
          server,
          userId: initialUser.id,
          username: canonicalUsername,
          description,
          attempt,
        },
        {
          now,
          ttlMs: journalTtlMs,
          storage,
        },
      )
    } catch (error) {
      clearAuthTransactionJournal({
        server,
        userId: initialUser.id,
        username: canonicalUsername,
        now,
        storage,
      })
      throw createAuthProvisioningError("Failed to persist pending auth transaction journal", {
        code: error?.code ?? "WRITE_AUTH_JOURNAL_FAILED",
        stage: "write-journal",
        cause: error,
        secrets: baseSecrets,
      })
    }

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
      const errorStatus = error?.status ?? error?.response?.status
      if (errorStatus === 400 || errorStatus === 409) {
        clearAuthTransactionJournal({
          server,
          userId: initialUser.id,
          username: canonicalUsername,
          now,
          storage,
        })
        if (attempt < MAX_DESCRIPTION_COLLISION_RETRIES) {
          continue
        }
      } else if (isDefinitivePreCreateRejectionStatus(errorStatus)) {
        clearAuthTransactionJournal({
          server,
          userId: initialUser.id,
          username: canonicalUsername,
          now,
          storage,
        })
      }
      // Step 10: If outcome is uncertain (e.g. lost response / timeout / 5xx), retain journal, preserve password auth, do not create another key
      throw createAuthProvisioningError("Failed to create dedicated Miniflux API key", {
        code: "CREATE_API_KEY_FAILED",
        stage: "create-key",
        cause: error,
        secrets: baseSecrets,
      })
    }

    const responseStatus = createKeyResponse?.status
    if (responseStatus === 400 || responseStatus === 409) {
      clearAuthTransactionJournal({
        server,
        userId: initialUser.id,
        username: canonicalUsername,
        now,
        storage,
      })
      if (attempt < MAX_DESCRIPTION_COLLISION_RETRIES) {
        continue
      }
      throw createAuthProvisioningError("Unexpected status creating Miniflux API key", {
        code: "CREATE_API_KEY_FAILED",
        stage: "create-key",
        status: responseStatus,
        secrets: baseSecrets,
      })
    }

    if (responseStatus !== 201 && responseStatus !== 200) {
      if (isDefinitivePreCreateRejectionStatus(responseStatus)) {
        clearAuthTransactionJournal({
          server,
          userId: initialUser.id,
          username: canonicalUsername,
          now,
          storage,
        })
      }
      throw createAuthProvisioningError("Unexpected status creating Miniflux API key", {
        code: "CREATE_API_KEY_FAILED",
        stage: "create-key",
        status: responseStatus,
        secrets: baseSecrets,
      })
    }
    break
  }

  // Step 8: Verify returned ID/token, verify identity via /v1/me, commit auth state, and clear journal ONLY after committed success
  const createdKeyData = createKeyResponse._data
  const createdKeyId = normalizeApiKeyId(createdKeyData?.id)
  const createdToken = typeof createdKeyData?.token === "string" ? createdKeyData.token.trim() : ""

  if (!createdKeyId || !createdToken) {
    if (createdKeyId) {
      const revokeResult = await revokeDedicatedApiKey(
        { server, username, password },
        { apiKeyId: createdKeyId, rawFetch, signal },
      )
      if (revokeResult.revoked) {
        clearAuthTransactionJournal({
          server,
          userId: initialUser.id,
          username: canonicalUsername,
          now,
          storage,
        })
      }
    }
    throw createAuthProvisioningError("Miniflux returned an invalid API key payload", {
      code: "INVALID_API_KEY_RESPONSE",
      stage: "create-key",
      secrets: [...baseSecrets, createdToken],
    })
  }

  const allSecrets = [...baseSecrets, createdToken]

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
    const revokeResult = await revokeDedicatedApiKey(
      { server, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    if (revokeResult.revoked) {
      clearAuthTransactionJournal({
        server,
        userId: initialUser.id,
        username: canonicalUsername,
        now,
        storage,
      })
    }
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
    const revokeResult = await revokeDedicatedApiKey(
      { server, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    if (revokeResult.revoked) {
      clearAuthTransactionJournal({
        server,
        userId: initialUser.id,
        username: canonicalUsername,
        now,
        storage,
      })
    }
    throw createAuthProvisioningError("Newly created API key failed /v1/me identity verification", {
      code: "VERIFY_API_KEY_IDENTITY_MISMATCH",
      stage: "verify-key",
      status: verifyResponse?.status,
      secrets: allSecrets,
    })
  }

  const previousAuth = normalizeAuthValue(authState.get())
  const committedAuth = normalizeAuthValue({
    server,
    token: createdToken,
    apiKeyId: createdKeyId,
    username: verifiedUser.username || canonicalUsername,
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
    const revokeResult = await revokeDedicatedApiKey(
      { server, token: createdToken, username, password },
      { apiKeyId: createdKeyId, rawFetch, signal },
    )
    if (revokeResult.revoked) {
      clearAuthTransactionJournal({
        server,
        userId: initialUser.id,
        username: canonicalUsername,
        now,
        storage,
      })
    }
    throw createAuthProvisioningError("Failed to persist verified API key session", {
      code: "STORE_AUTH_FAILED",
      stage: "store-auth",
      cause: error,
      secrets: allSecrets,
    })
  }

  // Clear journal ONLY after committed success
  clearAuthTransactionJournal({
    server,
    userId: initialUser.id,
    username: canonicalUsername,
    now,
    storage,
  })

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
  now,
  journalTtlMs,
  storage,
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
    now,
    journalTtlMs,
    storage,
    signal,
  })
}
