import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { beforeEach, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRootUrlPrefix = pathToFileURL(`${sourceRoot}${path.sep}`).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "validator/lib/isURL") {
      return nextResolve("validator/lib/isURL.js", context)
    }
    let target = null
    if (specifier.startsWith("@/")) {
      target = path.resolve(sourceRoot, specifier.slice(2))
    } else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith(sourceRootUrlPrefix) &&
      !path.extname(specifier)
    ) {
      target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier)
    }

    if (target) {
      if (!path.extname(target)) {
        const jsTarget = `${target}.js`
        const jsxTarget = `${target}.jsx`
        target = existsSync(jsTarget) ? jsTarget : jsxTarget
      }
      if (existsSync(target)) {
        return nextResolve(pathToFileURL(target).href, context)
      }
    }

    return nextResolve(specifier, context)
  },
})

const storageMap = new Map()
let storageSetItemFailure = null

const localStorageMock = {
  getItem(key) {
    return storageMap.has(key) ? storageMap.get(key) : null
  },
  setItem(key, value) {
    if (storageSetItemFailure) {
      throw storageSetItemFailure
    }
    storageMap.set(key, String(value))
  },
  removeItem(key) {
    storageMap.delete(key)
  },
  clear() {
    storageMap.clear()
  },
}

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageMock,
})

const [
  { authState, normalizeApiKeyId, setAuth },
  {
    default: isValidAuth,
    encodeBasicAuthCredentials,
    getSafeAuthErrorDetails,
    hasProvisionedApiKey,
    isLegacyPasswordAuth,
  },
  { clearSession, logoutSession, startSession },
  {
    AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS,
    AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION,
    AUTH_TRANSACTION_JOURNAL_STORAGE_KEY,
    buildDedicatedApiKeyDescription,
    clearAuthTransactionJournal,
    logoutWithKeyRevocation,
    migrateLegacyPasswordSession,
    provisionDedicatedApiKeySession,
    readAuthTransactionJournal,
    reconcileAuthTransactionJournal,
    writeAuthTransactionJournal,
  },
] = await Promise.all([
  import("@/store/authState"),
  import("@/utils/auth"),
  import("@/utils/session"),
  import("@/utils/auth-apikey"),
])

const SERVER_A = "https://miniflux-a.example.test"
const SERVER_B = "https://miniflux-b.example.test"
const FIXTURE_USERNAME = "reader_user"
const FIXTURE_PASSWORD = "fixture-password-not-a-secret"
const FIXTURE_TOKEN = "fixture-token-not-a-secret"

const supportedCompatibilityStub = async () => ({
  status: "supported",
  version: "2.3.4",
  minimumVersion: "2.3.2",
})

beforeEach(() => {
  storageSetItemFailure = null
  storageMap.clear()
  clearSession()
})

test("AUTH_CONSENT_REQUIRED: refuses to create an API key or drop password when consent is not granted", async () => {
  let requests = 0
  const rawFetch = async () => {
    requests += 1
    throw new Error("Should not issue network requests without consent")
  }

  await assert.rejects(
    provisionDedicatedApiKeySession(
      {
        server: SERVER_A,
        username: FIXTURE_USERNAME,
        password: FIXTURE_PASSWORD,
        token: "",
      },
      {
        consent: false,
        rawFetch,
      },
    ),
    (error) => error.code === "AUTH_CONSENT_REQUIRED" && error.stage === "consent",
  )

  assert.equal(requests, 0)
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)
})

test("successful provisioning: password login -> create dedicated key -> verify /v1/me -> store token + apiKeyId -> drop password", async () => {
  const callOrder = []

  const rawFetch = async (url, options = {}) => {
    const authHeader = options.headers?.Authorization ?? ""
    const tokenHeader = options.headers?.["X-Auth-Token"] ?? ""
    callOrder.push({
      url,
      method: options.method ?? "GET",
      hasBasicAuth: authHeader.startsWith("Basic "),
      hasTokenAuth: Boolean(tokenHeader),
      body: options.body,
    })

    if (url === "v1/me" && authHeader.startsWith("Basic ")) {
      return {
        status: 200,
        _data: { id: 17, username: FIXTURE_USERNAME },
      }
    }

    if (url === "v1/api-keys" && options.method === "POST") {
      assert.equal(authHeader.startsWith("Basic "), true)
      assert.equal(typeof options.body?.description, "string")
      assert.match(options.body.description, /^NewsFlux\b/)
      return {
        status: 201,
        _data: {
          id: 309,
          user_id: 17,
          token: FIXTURE_TOKEN,
          description: options.body.description,
        },
      }
    }

    if (url === "v1/me" && tokenHeader === FIXTURE_TOKEN) {
      assert.equal(authHeader, "")
      return {
        status: 200,
        _data: { id: 17, username: FIXTURE_USERNAME },
      }
    }

    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  const checkCompatibility = async (auth) => {
    callOrder.push({
      url: "v1/version",
      method: "GET",
      hasBasicAuth: Boolean(auth.username && auth.password && !auth.token),
      hasTokenAuth: Boolean(auth.token),
    })
    return {
      status: "supported",
      version: "2.3.4",
      minimumVersion: "2.3.2",
    }
  }

  const result = await provisionDedicatedApiKeySession(
    {
      server: SERVER_A,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      token: "",
    },
    {
      consent: true,
      rawFetch,
      checkCompatibility,
    },
  )

  assert.deepEqual(
    callOrder.map((entry) => `${entry.method} ${entry.url}`),
    ["GET v1/me", "GET v1/version", "POST v1/api-keys", "GET v1/me"],
  )
  assert.equal(callOrder[0].hasBasicAuth, true)
  assert.equal(callOrder[2].hasBasicAuth, true)
  assert.equal(callOrder[3].hasTokenAuth, true)
  assert.equal(callOrder[3].hasBasicAuth, false)

  assert.equal(result.auth.server, SERVER_A)
  assert.equal(result.auth.token, FIXTURE_TOKEN)
  assert.equal(result.auth.apiKeyId, 309)
  assert.equal(result.auth.username, FIXTURE_USERNAME)
  assert.equal(result.auth.password, "")

  const storedAuth = authState.get()
  assert.equal(storedAuth.token, FIXTURE_TOKEN)
  assert.equal(storedAuth.apiKeyId, 309)
  assert.equal(storedAuth.password, "")
  assert.equal(hasProvisionedApiKey(storedAuth), true)
  assert.equal(isLegacyPasswordAuth(storedAuth), false)

  const rawPersisted = storageMap.get("auth") ?? localStorage.getItem("auth") ?? ""
  assert.equal(rawPersisted.includes(FIXTURE_PASSWORD), false)
})

test("PARTIAL_CREATE_FAILURE_RECOVERY: preserves password and allows clean retry when create-key fails", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  let createAttempts = 0
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
      return { status: 200, _data: [] }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      createAttempts += 1
      if (createAttempts === 1) {
        const err = new Error("Unable to create API key")
        err.status = 500
        throw err
      }
      return {
        status: 201,
        _data: { id: 410, user_id: 17, token: FIXTURE_TOKEN, description: "NewsFlux" },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "create-key",
  )

  // Password must NOT be dropped on create failure, and uncertain 500 leaves journal for reconciliation
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)
  assert.equal(readAuthTransactionJournal().status, "pending")

  // Subsequent retry reconciles (zero-match on server), clears journal, and commits new key
  const retryResult = await migrateLegacyPasswordSession({
    consent: true,
    rawFetch,
    checkCompatibility: supportedCompatibilityStub,
  })
  assert.equal(retryResult.auth.token, FIXTURE_TOKEN)
  assert.equal(retryResult.auth.apiKeyId, 410)
  assert.equal(authState.get().password, "")
  assert.equal(readAuthTransactionJournal().status, "empty")
})

test("PARTIAL_VERIFY_FAILURE_RECOVERY & DROP_PASSWORD_ONLY_AFTER_VERIFY: keeps password and cleans up unverified key when /v1/me verification fails", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const deletedKeyIds = []
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      return {
        status: 201,
        _data: { id: 512, user_id: 17, token: "broken-token", description: "NewsFlux" },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === "broken-token") {
      const err = new Error("Unauthorized token")
      err.status = 401
      throw err
    }
    if (url === "v1/api-keys/512" && options.method === "DELETE") {
      deletedKeyIds.push(512)
      return { status: 204, _data: null }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "verify-key",
  )

  assert.deepEqual(deletedKeyIds, [512])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)
})

test("storage failure: revokes newly created key and preserves prior auth state if storage write fails", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const deletedKeyIds = []
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      return {
        status: 201,
        _data: { id: 615, user_id: 17, token: FIXTURE_TOKEN, description: "NewsFlux" },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys/615" && options.method === "DELETE") {
      deletedKeyIds.push(615)
      return { status: 204, _data: null }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
      commitSession: () => {
        throw new Error("QuotaExceededError: storage full")
      },
    }),
    (error) => error.stage === "store-auth",
  )

  assert.deepEqual(deletedKeyIds, [615])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)
})

test("LOGOUT_REVOKES_OWN_KEY_FIRST & NO_OTHER_KEYS_REVOKED: revokes only installation apiKeyId before clearing local auth state", async () => {
  startSession(
    {
      server: SERVER_A,
      token: FIXTURE_TOKEN,
      apiKeyId: 777,
      username: FIXTURE_USERNAME,
      password: "",
    },
    "2.3.4",
    { id: 17, username: FIXTURE_USERNAME },
  )

  const events = []
  const rawFetch = async (url, options = {}) => {
    // At the moment DELETE is issued, local auth state must not have been cleared yet
    events.push({
      type: "delete-request",
      url,
      method: options.method,
      tokenHeader: options.headers?.["X-Auth-Token"],
      authStillPresentDuringRequest: authState.get().token === FIXTURE_TOKEN,
    })
    return { status: 204, _data: null }
  }

  await logoutSession({
    rawFetch,
    onAfterClear: () => {
      events.push({
        type: "cleared",
        tokenAfterClear: authState.get().token,
        apiKeyIdAfterClear: authState.get().apiKeyId,
      })
    },
  })

  assert.equal(events.length, 2)
  assert.deepEqual(events[0], {
    type: "delete-request",
    url: "v1/api-keys/777",
    method: "DELETE",
    tokenHeader: FIXTURE_TOKEN,
    authStillPresentDuringRequest: true,
  })
  assert.deepEqual(events[1], {
    type: "cleared",
    tokenAfterClear: "",
    apiKeyIdAfterClear: null,
  })
})

test("NO_OTHER_KEYS_REVOKED: manual token session without apiKeyId never revokes any key on logout", async () => {
  startSession(
    {
      server: SERVER_A,
      token: FIXTURE_TOKEN,
      apiKeyId: null,
      username: FIXTURE_USERNAME,
      password: "",
    },
    "2.3.4",
    { id: 17, username: FIXTURE_USERNAME },
  )

  let deleteCalled = false
  await logoutSession({
    rawFetch: async () => {
      deleteCalled = true
      return { status: 204 }
    },
  })

  assert.equal(deleteCalled, false)
  assert.equal(authState.get().token, "")
})

test("LOGOUT_REVOKE_FAILURE_SAFE: clears local auth state even when key revocation fails", async () => {
  startSession(
    {
      server: SERVER_A,
      token: FIXTURE_TOKEN,
      apiKeyId: 888,
      username: FIXTURE_USERNAME,
      password: "",
    },
    "2.3.4",
    { id: 17, username: FIXTURE_USERNAME },
  )

  const result = await logoutWithKeyRevocation({
    rawFetch: async () => {
      const error = new Error("Service Unavailable")
      error.status = 503
      throw error
    },
  })

  assert.equal(result.revoked, false)
  assert.equal(authState.get().server, "")
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)
  assert.equal(authState.get().password, "")
})

test("page reload after migration & server change: migrated state restores without password and server switch clears prior apiKeyId", async () => {
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      return {
        status: 201,
        _data: { id: 901, user_id: 17, token: FIXTURE_TOKEN, description: "NewsFlux" },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  await migrateLegacyPasswordSession({
    consent: true,
    rawFetch,
    checkCompatibility: async () => ({
      status: "supported",
      version: "2.3.4",
      minimumVersion: "2.3.2",
    }),
  })

  // Simulate page reload reading from persisted JSON
  const persistedState = structuredClone(authState.get())
  setAuth(persistedState)
  assert.equal(isValidAuth(authState.get()), true)
  assert.equal(isLegacyPasswordAuth(authState.get()), false)
  assert.equal(authState.get().apiKeyId, 901)
  assert.equal(authState.get().password, "")

  // Server change with manual token must not retain Server A's apiKeyId
  startSession(
    {
      server: SERVER_B,
      token: "server-b-manual-token",
      username: FIXTURE_USERNAME,
      password: "",
    },
    "2.3.4",
    { id: 22, username: FIXTURE_USERNAME },
  )
  assert.equal(authState.get().server, SERVER_B)
  assert.equal(authState.get().apiKeyId, null)
})

test("invalid key & network timeout: rejects malformed key payload and timeout without dropping password", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  // 1. Invalid key payload (missing token / invalid id)
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          return { status: 201, _data: { id: 0, token: "" } }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      checkCompatibility: async () => ({
        status: "supported",
        version: "2.3.4",
        minimumVersion: "2.3.2",
      }),
    }),
    (error) => error.stage === "create-key" && error.code === "INVALID_API_KEY_RESPONSE",
  )
  assert.equal(authState.get().password, FIXTURE_PASSWORD)

  // 2. Network timeout
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch: async (url) => {
        if (url === "v1/me") {
          const timeoutErr = new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          )
          throw timeoutErr
        }
        throw new Error(`Unexpected request: ${url}`)
      },
      checkCompatibility: async () => ({
        status: "supported",
        version: "2.3.4",
        minimumVersion: "2.3.2",
      }),
    }),
    (error) => error.stage === "password-login",
  )
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
})

test("concurrent login attempts: coalesces in-flight provisioning so only one API key is created", async () => {
  let createKeyCount = 0
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      createKeyCount += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        status: 201,
        _data: {
          id: 999,
          user_id: 17,
          token: FIXTURE_TOKEN,
          description: options.body.description,
        },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${url}`)
  }

  const credentials = {
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  }

  const [first, second] = await Promise.all([
    provisionDedicatedApiKeySession(credentials, {
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    provisionDedicatedApiKeySession(credentials, {
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
  ])

  assert.equal(createKeyCount, 1)
  assert.equal(first.auth.apiKeyId, 999)
  assert.equal(second.auth.apiKeyId, 999)
})

test("NO_PASSWORD_LOGGING & NO_TOKEN_LOGGING: getSafeAuthErrorDetails redacts credentials, tokens, and auth headers", () => {
  const encodedBasic = encodeBasicAuthCredentials(FIXTURE_USERNAME, FIXTURE_PASSWORD)
  const rawError = new Error(
    `Request failed with Basic ${encodedBasic} and token=${FIXTURE_TOKEN} for ${FIXTURE_PASSWORD}`,
  )
  rawError.status = 401
  rawError.options = {
    headers: {
      Authorization: `Basic ${encodedBasic}`,
      "X-Auth-Token": FIXTURE_TOKEN,
    },
  }

  const safeDetails = getSafeAuthErrorDetails(rawError, [FIXTURE_PASSWORD, FIXTURE_TOKEN])
  const serialized = JSON.stringify(safeDetails)

  assert.equal(serialized.includes(FIXTURE_PASSWORD), false)
  assert.equal(serialized.includes(FIXTURE_TOKEN), false)
  assert.equal(serialized.includes(encodedBasic), false)
  assert.equal(safeDetails.status, 401)
  assert.equal(Object.hasOwn(safeDetails, "options"), false)
})

test("buildDedicatedApiKeyDescription produces unique non-empty descriptions and normalizeApiKeyId validates positive safe integers", () => {
  const desc1 = buildDedicatedApiKeyDescription({ server: SERVER_A })
  const desc2 = buildDedicatedApiKeyDescription({ server: SERVER_A })
  assert.ok(desc1.startsWith("NewsFlux ("))
  assert.notEqual(desc1, desc2)

  assert.equal(normalizeApiKeyId(42), 42)
  assert.equal(normalizeApiKeyId("42"), 42)
  assert.equal(normalizeApiKeyId(0), null)
  assert.equal(normalizeApiKeyId(-5), null)
  assert.equal(normalizeApiKeyId(""), null)
  assert.equal(normalizeApiKeyId(null), null)
})

test("all 6 locales define AUTH_APIKEY_01 consent and migration strings", () => {
  const locales = ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]
  const requiredLoginKeys = [
    "api_key_consent_label",
    "api_key_consent_required",
    "api_key_migration_title",
    "api_key_migration_description",
    "api_key_migration_action",
    "api_key_provisioning_error",
  ]

  for (const locale of locales) {
    const filePath = path.resolve(sourceRoot, "locales", `${locale}.json`)
    const data = JSON.parse(readFileSync(filePath, "utf8"))
    for (const key of requiredLoginKeys) {
      assert.equal(
        typeof data.login?.[key] === "string" && data.login[key].trim().length > 0,
        true,
        `Missing login.${key} in ${locale}.json`,
      )
    }
  }
})

test("AUTH_TRANSACTION_JOURNAL_01: (1) journal is written before POST, (2) cleared only after committed success, and (13) serialization contains no secrets", async () => {
  let journalDuringPost = null
  let journalDuringVerify = null
  let journalDuringCommit = null
  let rawJournalStringDuringPost = ""

  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      rawJournalStringDuringPost = localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY) ?? ""
      journalDuringPost = readAuthTransactionJournal()
      return {
        status: 201,
        _data: {
          id: 501,
          user_id: 17,
          token: FIXTURE_TOKEN,
          description: options.body.description,
          last_used_at: null,
        },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      journalDuringVerify = readAuthTransactionJournal()
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  const result = await provisionDedicatedApiKeySession(
    {
      server: `${SERVER_A}/`,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      token: "",
    },
    {
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
      commitSession: (auth, version, user) => {
        journalDuringCommit = readAuthTransactionJournal()
        startSession(auth, version, user)
      },
    },
  )

  // (1) Journal was written BEFORE POST /v1/api-keys and remained pending through /v1/me verify and commitSession
  assert.equal(journalDuringPost?.status, "pending")
  assert.equal(journalDuringPost?.entry?.schemaVersion, AUTH_TRANSACTION_JOURNAL_SCHEMA_VERSION)
  assert.equal(journalDuringPost?.entry?.server, SERVER_A)
  assert.equal(journalDuringPost?.entry?.userId, 17)
  assert.equal(journalDuringPost?.entry?.username, FIXTURE_USERNAME)
  assert.equal(journalDuringPost?.entry?.state, "pending_create")
  assert.equal(journalDuringPost?.entry?.attempt, 1)
  assert.equal(
    Date.parse(journalDuringPost.entry.expiresAt) - Date.parse(journalDuringPost.entry.createdAt),
    AUTH_TRANSACTION_JOURNAL_DEFAULT_TTL_MS,
  )
  assert.equal(journalDuringVerify?.status, "pending")
  assert.equal(journalDuringCommit?.status, "pending")

  // (13) Journal serialization contains NO password, token, or auth headers
  const encodedBasic = encodeBasicAuthCredentials(FIXTURE_USERNAME, FIXTURE_PASSWORD)
  assert.equal(rawJournalStringDuringPost.includes(FIXTURE_PASSWORD), false)
  assert.equal(rawJournalStringDuringPost.includes(FIXTURE_TOKEN), false)
  assert.equal(rawJournalStringDuringPost.includes(encodedBasic), false)
  assert.equal(rawJournalStringDuringPost.includes("Basic "), false)
  assert.equal(rawJournalStringDuringPost.includes("Authorization"), false)
  assert.equal(rawJournalStringDuringPost.includes("X-Auth-Token"), false)
  assert.equal(rawJournalStringDuringPost.includes("password"), false)
  assert.equal(rawJournalStringDuringPost.includes("token"), false)
  const parsedRaw = JSON.parse(rawJournalStringDuringPost)
  assert.deepEqual(Object.keys(parsedRaw).toSorted(), [
    "attempt",
    "createdAt",
    "description",
    "expiresAt",
    "schemaVersion",
    "server",
    "state",
    "userId",
    "username",
  ])

  // (2) Journal is cleared ONLY AFTER committed success
  assert.equal(result.auth.apiKeyId, 501)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), null)
  assert.equal(readAuthTransactionJournal().status, "empty")
})

test("AUTH_TRANSACTION_JOURNAL_01: (3) lost POST response leaves journal, (4) simulated reload reconstructs pending reconciliation, and (5) next login finds exact orphan and revokes only that key", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const serverKeys = [
    {
      id: 100,
      user_id: 17,
      token: "unrelated-manual-token",
      description: "Wallabag Integration",
      last_used_at: "2026-10-20T10:00:00Z",
    },
    {
      id: 101,
      user_id: 17,
      token: "other-newsflux-device-token",
      description: "NewsFlux (2026-10-20T09:00:00.000Z #otherdev)",
      last_used_at: null,
    },
  ]
  const deletedKeyIds = []
  let postAttempts = 0
  let lostDescription = ""

  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      postAttempts += 1
      if (postAttempts === 1) {
        lostDescription = options.body.description
        // Server creates key 555, then HTTP response is lost in transit
        serverKeys.push({
          id: 555,
          user_id: 17,
          token: "orphan-token-lost-in-transit",
          description: options.body.description,
          last_used_at: null,
        })
        throw new TypeError("network connection reset after server created key")
      }
      const created = {
        id: 556,
        user_id: 17,
        token: FIXTURE_TOKEN,
        description: options.body.description,
        last_used_at: null,
      }
      serverKeys.push(created)
      return { status: 201, _data: created }
    }
    if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
      return { status: 200, _data: serverKeys.map((key) => ({ ...key })) }
    }
    if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
      const id = Number(url.split("/").at(-1))
      deletedKeyIds.push(id)
      const index = serverKeys.findIndex((key) => key.id === id)
      if (index !== -1) {
        serverKeys.splice(index, 1)
      }
      return { status: 204, _data: null }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  // (3) Lost POST response leaves pending_create journal in durable localStorage and preserves password auth
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "create-key",
  )

  assert.deepEqual(deletedKeyIds, [])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(authState.get().token, "")
  assert.equal(authState.get().apiKeyId, null)

  // (4) Simulate browser reload: snapshot persisted auth + raw localStorage journal, clear storage, restore both
  const persistedAuthSnapshot = structuredClone(authState.get())
  const persistedJournalJson = localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)
  assert.equal(typeof persistedJournalJson, "string")
  storageMap.clear()
  localStorage.setItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY, persistedJournalJson)
  setAuth(persistedAuthSnapshot)

  const reconstructed = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
  })
  assert.equal(reconstructed.status, "pending")
  assert.equal(reconstructed.entry?.description, lostDescription)
  assert.equal(reconstructed.entry?.state, "pending_create")

  // (5) Next login after reload finds exact orphan 555, revokes ONLY 555 (protecting 100 & 101), clears journal, and commits 556
  const retryResult = await migrateLegacyPasswordSession({
    consent: true,
    rawFetch,
    checkCompatibility: supportedCompatibilityStub,
  })
  assert.deepEqual(deletedKeyIds, [555])
  assert.equal(retryResult.auth.apiKeyId, 556)
  assert.equal(retryResult.auth.token, FIXTURE_TOKEN)
  assert.equal(authState.get().password, "")
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), null)
  assert.deepEqual(
    serverKeys.map((key) => key.id),
    [100, 101, 556],
  )
})

test("AUTH_TRANSACTION_JOURNAL_01: (6) no second POST happens before unresolved journal reconciliation", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T10:00:00.000Z #pending1)",
  })

  let postCount = 0
  let listShoudFail = true

  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
      if (listShoudFail) {
        const err = new Error("Service Unavailable")
        err.status = 503
        throw err
      }
      return {
        status: 200,
        _data: [
          {
            id: 701,
            user_id: 17,
            token: "orphan-701",
            description: "NewsFlux (2026-10-24T10:00:00.000Z #pending1)",
            last_used_at: null,
          },
        ],
      }
    }
    if (url === "v1/api-keys/701" && options.method === "DELETE") {
      const err = new Error("Delete failed")
      err.status = 503
      throw err
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      postCount += 1
      return { status: 201, _data: { id: 702, token: FIXTURE_TOKEN } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  // Case A: GET /v1/api-keys fails -> must NOT issue a second POST /v1/api-keys and must keep journal
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "ORPHAN_RECONCILIATION_FAILED",
  )
  assert.equal(postCount, 0)
  assert.equal(readAuthTransactionJournal().status, "pending")

  // Case B: GET /v1/api-keys succeeds, but DELETE /v1/api-keys/701 fails -> must NOT issue a second POST /v1/api-keys and must keep journal
  listShoudFail = false
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "ORPHAN_RECONCILIATION_FAILED",
  )
  assert.equal(postCount, 0)
  assert.equal(readAuthTransactionJournal().status, "pending")
})

test("AUTH_TRANSACTION_JOURNAL_01: (7) zero-match safe outcome clears journal without deleting unrelated keys and proceeds", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T10:00:00.000Z #never-reached-server)",
  })

  const deletedKeyIds = []
  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
      return {
        status: 200,
        _data: [
          {
            id: 200,
            user_id: 17,
            token: "existing-key",
            description: "Existing CLI Key",
            last_used_at: null,
          },
        ],
      }
    }
    if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
      deletedKeyIds.push(Number(url.split("/").at(-1)))
      return { status: 204, _data: null }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      return {
        status: 201,
        _data: {
          id: 750,
          user_id: 17,
          token: FIXTURE_TOKEN,
          description: options.body.description,
          last_used_at: null,
        },
      }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  const result = await migrateLegacyPasswordSession({
    consent: true,
    rawFetch,
    checkCompatibility: supportedCompatibilityStub,
  })
  assert.deepEqual(deletedKeyIds, [])
  assert.equal(result.auth.apiKeyId, 750)
  assert.equal(readAuthTransactionJournal().status, "empty")
})

test("AUTH_TRANSACTION_JOURNAL_01: (8) duplicate or already-used ambiguous matches revoke none and block second POST", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const pendingDescription = "NewsFlux (2026-10-24T11:00:00.000Z #ambig)"
  writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: pendingDescription,
  })

  const deletedKeyIds = []
  let postCount = 0
  let returnedKeys = [
    {
      id: 301,
      user_id: 17,
      token: "dup-1",
      description: pendingDescription,
      last_used_at: null,
    },
    {
      id: 302,
      user_id: 17,
      token: "dup-2",
      description: pendingDescription,
      last_used_at: null,
    },
  ]

  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
      return { status: 200, _data: returnedKeys }
    }
    if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
      deletedKeyIds.push(Number(url.split("/").at(-1)))
      return { status: 204, _data: null }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      postCount += 1
      return { status: 201, _data: { id: 303, token: FIXTURE_TOKEN } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  // Case A: Multiple keys matching pending description -> revoke NONE, do NOT POST
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "AMBIGUOUS_ORPHAN_API_KEY",
  )
  assert.deepEqual(deletedKeyIds, [])
  assert.equal(postCount, 0)
  assert.equal(readAuthTransactionJournal().status, "pending")

  // Case B: Single key matching description, but last_used_at is non-null (already used) -> revoke NONE, do NOT POST
  returnedKeys = [
    {
      id: 301,
      user_id: 17,
      token: "already-used",
      description: pendingDescription,
      last_used_at: "2026-10-24T11:05:00Z",
    },
  ]
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch,
      checkCompatibility: supportedCompatibilityStub,
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "AMBIGUOUS_ORPHAN_API_KEY",
  )
  assert.deepEqual(deletedKeyIds, [])
  assert.equal(postCount, 0)
  assert.equal(readAuthTransactionJournal().status, "pending")
})

test("AUTH_TRANSACTION_JOURNAL_01: (9) stale journal and (10) corrupt journal are safely cleared without revoking keys", async () => {
  // (9) Stale journal (expired 1 hour ago)
  const pastNow = new Date("2026-10-20T00:00:00.000Z")
  writeAuthTransactionJournal(
    {
      server: SERVER_A,
      userId: 17,
      username: FIXTURE_USERNAME,
      description: "NewsFlux (2026-10-20T00:00:00.000Z #stale)",
    },
    {
      now: pastNow,
      ttlMs: 60_000,
    },
  )

  const staleRead = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    now: new Date("2026-10-20T02:00:00.000Z"),
  })
  assert.equal(staleRead.status, "stale")
  assert.equal(staleRead.entry, null)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), null)

  // (10) Corrupt journals (invalid JSON, wrong schemaVersion, forbidden secret field)
  for (const corruptPayload of [
    "{not-valid-json",
    JSON.stringify({ schemaVersion: 99, state: "pending_create" }),
    JSON.stringify({
      schemaVersion: 1,
      server: SERVER_A,
      userId: 17,
      username: FIXTURE_USERNAME,
      description: "NewsFlux (#1)",
      state: "pending_create",
      createdAt: "2026-10-24T00:00:00.000Z",
      expiresAt: "2026-10-25T00:00:00.000Z",
      attempt: 1,
      password: "forbidden-secret-in-journal",
    }),
  ]) {
    localStorage.setItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY, corruptPayload)
    const corruptRead = readAuthTransactionJournal({
      server: SERVER_A,
      userId: 17,
      username: FIXTURE_USERNAME,
    })
    assert.equal(corruptRead.status, "corrupt")
    assert.equal(corruptRead.entry, null)
    assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), null)
  }
})

test("AUTH_TRANSACTION_JOURNAL_01: (11) different server and (12) different user do not consume or delete foreign journal", async () => {
  const foreignJournal = writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T12:00:00.000Z #serverA-user17)",
  })

  // (11) Different server (SERVER_B) does not consume or clear SERVER_A's journal
  let listCalled = false
  const serverBReconcile = await reconcileAuthTransactionJournal({
    server: SERVER_B,
    userId: 17,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    rawFetch: async () => {
      listCalled = true
      return { status: 200, _data: [] }
    },
  })
  assert.equal(serverBReconcile.status, "server-mismatch")
  assert.equal(listCalled, false)
  assert.equal(
    clearAuthTransactionJournal({ server: SERVER_B, userId: 17, username: FIXTURE_USERNAME }),
    false,
  )
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17 }).entry?.description,
    foreignJournal.description,
  )

  // Even a full password provisioning on SERVER_B preserves SERVER_A's unconsumed journal
  await provisionDedicatedApiKeySession(
    {
      server: SERVER_B,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      token: "",
    },
    {
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          return {
            status: 201,
            _data: {
              id: 811,
              user_id: 17,
              token: FIXTURE_TOKEN,
              description: options.body.description,
              last_used_at: null,
            },
          }
        }
        if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        throw new Error(`Unexpected request on SERVER_B: ${options.method ?? "GET"} ${url}`)
      },
    },
  )
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17 }).entry?.description,
    foreignJournal.description,
  )

  // (12) Different user (userId: 29 / "other_user") on SERVER_A does not consume or clear userId 17's journal
  const userMismatchReconcile = await reconcileAuthTransactionJournal({
    server: SERVER_A,
    userId: 29,
    username: "other_user",
    password: FIXTURE_PASSWORD,
    rawFetch: async () => {
      listCalled = true
      return { status: 200, _data: [] }
    },
  })
  assert.equal(userMismatchReconcile.status, "user-mismatch")
  assert.equal(listCalled, false)
  assert.equal(
    clearAuthTransactionJournal({ server: SERVER_A, userId: 29, username: "other_user" }),
    false,
  )
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17 }).entry?.description,
    foreignJournal.description,
  )
})

test("DUPLICATE_DESCRIPTION_BEHAVIOR: retries with a fresh unique description on 400 collision without deleting pre-existing key", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const deletedKeyIds = []
  const attemptedDescriptions = []

  const rawFetch = async (url, options = {}) => {
    if (url === "v1/me" && options.headers?.Authorization) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    if (url === "v1/api-keys" && options.method === "POST") {
      attemptedDescriptions.push(options.body.description)
      if (attemptedDescriptions.length === 1) {
        const collisionError = new Error("An API key with the same description already exists.")
        collisionError.status = 400
        throw collisionError
      }
      return {
        status: 201,
        _data: {
          id: 808,
          user_id: 17,
          token: FIXTURE_TOKEN,
          description: options.body.description,
          last_used_at: null,
        },
      }
    }
    if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
      deletedKeyIds.push(Number(url.split("/").at(-1)))
      return { status: 204, _data: null }
    }
    if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
      return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
    }
    throw new Error(`Unexpected request: ${options.method ?? "GET"} ${url}`)
  }

  const result = await migrateLegacyPasswordSession({
    consent: true,
    rawFetch,
    checkCompatibility: supportedCompatibilityStub,
  })

  assert.equal(attemptedDescriptions.length, 2)
  assert.notEqual(attemptedDescriptions[0], attemptedDescriptions[1])
  assert.deepEqual(deletedKeyIds, [])
  assert.equal(result.auth.apiKeyId, 808)
  assert.equal(readAuthTransactionJournal().status, "empty")
})

test("AUTH_TRANSACTION_JOURNAL_01: (15) manual token login does not write or consume pending password journal and stays outside revocation lifecycle", async () => {
  const existingJournal = writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T13:00:00.000Z #manual-token-preserve)",
  })

  let listOrPostOrDeleteCalled = false
  const manualResult = await provisionDedicatedApiKeySession(
    {
      server: SERVER_A,
      token: FIXTURE_TOKEN,
      username: "",
      password: "",
    },
    {
      consent: false,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        listOrPostOrDeleteCalled = true
        throw new Error(`Unexpected request during manual token login: ${url}`)
      },
    },
  )

  assert.equal(listOrPostOrDeleteCalled, false)
  assert.equal(manualResult.auth.token, FIXTURE_TOKEN)
  assert.equal(manualResult.auth.apiKeyId, null)
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17 }).entry?.description,
    existingJournal.description,
  )

  let deleteCalledOnLogout = false
  await logoutSession({
    rawFetch: async () => {
      deleteCalledOnLogout = true
      return { status: 204 }
    },
  })
  assert.equal(deleteCalledOnLogout, false)
})
