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

  // 1. Invalid key payload (missing token / invalid id: 0) -> retains pending journal and password
  let postedDescription = ""
  let deleteCalled = false
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          postedDescription = options.body.description
          return { status: 201, _data: { id: 0, token: "" } }
        }
        if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
          deleteCalled = true
          return { status: 204, _data: null }
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
  assert.equal(deleteCalled, false)
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  const journalAfterInvalidPayload = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
  })
  assert.equal(journalAfterInvalidPayload.status, "pending")
  assert.equal(journalAfterInvalidPayload.entry?.description, postedDescription)

  // 2. Network timeout (leaves existing pending journal and password intact)
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
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17, username: FIXTURE_USERNAME }).status,
    "pending",
  )
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

test("AUTH_TRANSACTION_JOURNAL_01: (9) STALE journal remains persisted, performs no DELETE and no POST, preserves password, and fails closed with AUTH_JOURNAL_STALE_REQUIRES_RECOVERY", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  const pastNow = new Date("2026-10-20T00:00:00.000Z")
  const staleEntry = writeAuthTransactionJournal(
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
  const rawStaleBefore = localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)
  const expiredNow = new Date("2026-10-20T02:00:00.000Z")

  const staleRead = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    now: expiredNow,
  })
  assert.equal(staleRead.status, "stale")
  assert.equal(staleRead.entry?.description, staleEntry.description)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawStaleBefore)

  let postCount = 0
  let deleteCount = 0
  let listCount = 0

  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      now: expiredNow,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
          listCount += 1
          return { status: 200, _data: [] }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          postCount += 1
          return { status: 201, _data: {} }
        }
        if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
          deleteCount += 1
          return { status: 204, _data: null }
        }
        throw new Error(`Unexpected request on stale journal: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) =>
      error.stage === "reconcile-journal" && error.code === "AUTH_JOURNAL_STALE_REQUIRES_RECOVERY",
  )

  assert.equal(listCount, 0)
  assert.equal(postCount, 0)
  assert.equal(deleteCount, 0)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawStaleBefore)
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(authState.get().token, "")
})

test("AUTH_TRANSACTION_JOURNAL_01: (10) CORRUPT journal remains persisted unchanged, performs no DELETE and no POST, preserves password, and fails closed with AUTH_JOURNAL_CORRUPT_REQUIRES_RECOVERY", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

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
    assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), corruptPayload)

    let postCount = 0
    let deleteCount = 0
    let listCount = 0

    await assert.rejects(
      migrateLegacyPasswordSession({
        consent: true,
        checkCompatibility: supportedCompatibilityStub,
        rawFetch: async (url, options = {}) => {
          if (url === "v1/me" && options.headers?.Authorization) {
            return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
          }
          if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
            listCount += 1
            return { status: 200, _data: [] }
          }
          if (url === "v1/api-keys" && options.method === "POST") {
            postCount += 1
            return { status: 201, _data: {} }
          }
          if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
            deleteCount += 1
            return { status: 204, _data: null }
          }
          throw new Error(
            `Unexpected request on corrupt journal: ${options.method ?? "GET"} ${url}`,
          )
        },
      }),
      (error) =>
        error.stage === "reconcile-journal" &&
        error.code === "AUTH_JOURNAL_CORRUPT_REQUIRES_RECOVERY",
    )

    assert.equal(listCount, 0)
    assert.equal(postCount, 0)
    assert.equal(deleteCount, 0)
    assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), corruptPayload)
    assert.equal(authState.get().password, FIXTURE_PASSWORD)
    assert.equal(authState.get().token, "")
  }
})

test("AUTH_TRANSACTION_JOURNAL_01: (11) SERVER_MISMATCH, (12) USER_MISMATCH, and FOREIGN_SCOPE_LOST_RESPONSE_PREVENTION fail closed with AUTH_JOURNAL_FOREIGN_SCOPE_PENDING", async () => {
  const foreignJournal = writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T12:00:00.000Z #serverA-user17)",
  })
  const rawForeignBefore = localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)

  // (11) SERVER_MISMATCH: direct reconcile and full password provisioning on SERVER_B fail closed with zero POST and zero DELETE
  let listCount = 0
  let postCount = 0
  let deleteCount = 0

  await assert.rejects(
    reconcileAuthTransactionJournal({
      server: SERVER_B,
      userId: 17,
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      rawFetch: async () => {
        listCount += 1
        return { status: 200, _data: [] }
      },
    }),
    (error) =>
      error.stage === "reconcile-journal" && error.code === "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
  )
  assert.equal(listCount, 0)
  assert.equal(
    clearAuthTransactionJournal({ server: SERVER_B, userId: 17, username: FIXTURE_USERNAME }),
    false,
  )
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawForeignBefore)

  // FOREIGN_SCOPE_LOST_RESPONSE_PREVENTION: even if SERVER_B POST would lose its response, no second provisioning transaction is started at all
  await assert.rejects(
    provisionDedicatedApiKeySession(
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
            postCount += 1
            throw new Error("Simulated SERVER_B lost POST response")
          }
          if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
            deleteCount += 1
            return { status: 204, _data: null }
          }
          listCount += 1
          return { status: 200, _data: [] }
        },
      },
    ),
    (error) =>
      error.stage === "reconcile-journal" && error.code === "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
  )
  assert.equal(listCount, 0)
  assert.equal(postCount, 0)
  assert.equal(deleteCount, 0)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawForeignBefore)

  // Direct writeAuthTransactionJournal for SERVER_B also refuses to overwrite foreign journal
  assert.throws(
    () =>
      writeAuthTransactionJournal({
        server: SERVER_B,
        userId: 17,
        username: FIXTURE_USERNAME,
        description: "NewsFlux (#attempt-overwrite)",
      }),
    (error) => error.code === "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
  )
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawForeignBefore)

  // (12) USER_MISMATCH: different user (userId: 29 / "other_user") on SERVER_A fails closed with zero POST and zero DELETE
  await assert.rejects(
    reconcileAuthTransactionJournal({
      server: SERVER_A,
      userId: 29,
      username: "other_user",
      password: FIXTURE_PASSWORD,
      rawFetch: async () => {
        listCount += 1
        return { status: 200, _data: [] }
      },
    }),
    (error) =>
      error.stage === "reconcile-journal" && error.code === "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
  )
  assert.equal(listCount, 0)
  assert.equal(
    clearAuthTransactionJournal({ server: SERVER_A, userId: 29, username: "other_user" }),
    false,
  )
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawForeignBefore)

  await assert.rejects(
    provisionDedicatedApiKeySession(
      {
        server: SERVER_A,
        username: "other_user",
        password: FIXTURE_PASSWORD,
        token: "",
      },
      {
        consent: true,
        checkCompatibility: supportedCompatibilityStub,
        rawFetch: async (url, options = {}) => {
          if (url === "v1/me" && options.headers?.Authorization) {
            return { status: 200, _data: { id: 29, username: "other_user" } }
          }
          if (url === "v1/api-keys" && options.method === "POST") {
            postCount += 1
            return { status: 201, _data: {} }
          }
          if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
            deleteCount += 1
            return { status: 204, _data: null }
          }
          listCount += 1
          return { status: 200, _data: [] }
        },
      },
    ),
    (error) =>
      error.stage === "reconcile-journal" && error.code === "AUTH_JOURNAL_FOREIGN_SCOPE_PENDING",
  )
  assert.equal(listCount, 0)
  assert.equal(postCount, 0)
  assert.equal(deleteCount, 0)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawForeignBefore)
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

test("AUTH_TRANSACTION_JOURNAL_01: (15) MANUAL_TOKEN_WITH_FOREIGN_JOURNAL and same-scope/corrupt journal remains allowed, leaves journal byte-for-byte unchanged, and performs no dedicated-key mutation", async () => {
  const existingJournal = writeAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
    description: "NewsFlux (2026-10-24T13:00:00.000Z #manual-token-preserve)",
  })
  const rawJournalBefore = localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY)

  let listOrPostOrDeleteCalled = false
  // 1. Manual token login on foreign server (SERVER_B) while SERVER_A journal is pending
  const foreignManualResult = await provisionDedicatedApiKeySession(
    {
      server: SERVER_B,
      token: FIXTURE_TOKEN,
      username: "",
      password: "",
    },
    {
      consent: false,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.["X-Auth-Token"] === FIXTURE_TOKEN) {
          return { status: 200, _data: { id: 99, username: "other_user" } }
        }
        listOrPostOrDeleteCalled = true
        throw new Error(`Unexpected request during foreign manual token login: ${url}`)
      },
    },
  )

  assert.equal(listOrPostOrDeleteCalled, false)
  assert.equal(foreignManualResult.auth.server, SERVER_B)
  assert.equal(foreignManualResult.auth.token, FIXTURE_TOKEN)
  assert.equal(foreignManualResult.auth.apiKeyId, null)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawJournalBefore)

  // 2. Manual token login on same server (SERVER_A) while journal is pending
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
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawJournalBefore)
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
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawJournalBefore)

  // 3. Manual token login when journal is corrupt remains allowed and preserves raw corrupt journal
  const rawCorrupt = "{corrupt-journal-preserve-on-manual-token"
  localStorage.setItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY, rawCorrupt)
  const corruptManualResult = await provisionDedicatedApiKeySession(
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
  assert.equal(corruptManualResult.auth.token, FIXTURE_TOKEN)
  assert.equal(corruptManualResult.auth.apiKeyId, null)
  assert.equal(localStorage.getItem(AUTH_TRANSACTION_JOURNAL_STORAGE_KEY), rawCorrupt)
})

test("AUTH_TRANSACTION_JOURNAL_01: (A) SUCCESS_STATUS_MISSING_ID and (B) SUCCESS_STATUS_EMPTY_BODY preserve journal, perform zero speculative DELETE, block second POST until reconciliation, and reconcile exact orphan on next login", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  // --- (A) SUCCESS_STATUS_MISSING_ID: POST returns 201 with token but no valid id ---
  let journalSnapshotDuringFirstPost = null
  let firstPostedDescription = ""
  const deletedKeyIds = []
  const callSequence = []

  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          firstPostedDescription = options.body.description
          journalSnapshotDuringFirstPost = readAuthTransactionJournal({
            server: SERVER_A,
            userId: 17,
            username: FIXTURE_USERNAME,
          })
          return {
            status: 201,
            _data: {
              id: null,
              user_id: 17,
              token: FIXTURE_TOKEN,
              description: firstPostedDescription,
            },
          }
        }
        if (url.startsWith("v1/api-keys/") && options.method === "DELETE") {
          deletedKeyIds.push(Number(url.split("/").at(-1)))
          return { status: 204, _data: null }
        }
        throw new Error(`Unexpected request in step A1: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "create-key" && error.code === "INVALID_API_KEY_RESPONSE",
  )

  assert.equal(journalSnapshotDuringFirstPost?.status, "pending")
  assert.equal(journalSnapshotDuringFirstPost?.entry?.description, firstPostedDescription)
  assert.deepEqual(deletedKeyIds, [])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  const journalAfterMissingId = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
  })
  assert.equal(journalAfterMissingId.status, "pending")
  assert.equal(journalAfterMissingId.entry?.description, firstPostedDescription)

  // Next login must reconcile via GET /v1/api-keys, find exact unused orphan (id: 610), revoke ONLY 610, and only THEN issue a new POST
  const serverKeys = [
    {
      id: 100,
      user_id: 17,
      token: "cli-key",
      description: "CLI Key",
      last_used_at: "2026-10-20T00:00:00Z",
    },
    {
      id: 610,
      user_id: 17,
      token: "orphan-from-missing-id-response",
      description: firstPostedDescription,
      last_used_at: null,
    },
  ]

  const recoveryResult = await migrateLegacyPasswordSession({
    consent: true,
    checkCompatibility: supportedCompatibilityStub,
    rawFetch: async (url, options = {}) => {
      const method = options.method ?? "GET"
      callSequence.push(`${method} ${url}`)
      if (url === "v1/me" && options.headers?.Authorization) {
        return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
      }
      if (url === "v1/api-keys" && method === "GET") {
        return { status: 200, _data: [...serverKeys] }
      }
      if (url === "v1/api-keys/610" && method === "DELETE") {
        deletedKeyIds.push(610)
        return { status: 204, _data: null }
      }
      if (url === "v1/api-keys" && method === "POST") {
        assert.deepEqual(
          deletedKeyIds,
          [610],
          "Orphan key must be revoked before any new POST /v1/api-keys",
        )
        return {
          status: 201,
          _data: {
            id: 611,
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
      throw new Error(`Unexpected request in step A2: ${method} ${url}`)
    },
  })

  assert.deepEqual(deletedKeyIds, [610])
  assert.deepEqual(callSequence, [
    "GET v1/me",
    "GET v1/api-keys",
    "DELETE v1/api-keys/610",
    "POST v1/api-keys",
    "GET v1/me",
  ])
  assert.equal(recoveryResult.auth.apiKeyId, 611)
  assert.equal(readAuthTransactionJournal().status, "empty")

  // --- (B) SUCCESS_STATUS_EMPTY_BODY: POST returns 201 with missing/empty _data ---
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  let emptyBodyDescription = ""
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          emptyBodyDescription = options.body.description
          return { status: 201, _data: undefined }
        }
        throw new Error(`Unexpected request in step B1: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "create-key" && error.code === "INVALID_API_KEY_RESPONSE",
  )

  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  const journalAfterEmptyBody = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
  })
  assert.equal(journalAfterEmptyBody.status, "pending")
  assert.equal(journalAfterEmptyBody.entry?.description, emptyBodyDescription)

  // If next login reconciliation fails (e.g. GET /v1/api-keys 503), no second POST occurs
  let postDuringBlockedRetry = 0
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
          const err = new Error("Service Unavailable")
          err.status = 503
          throw err
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          postDuringBlockedRetry += 1
          return { status: 201, _data: {} }
        }
        throw new Error(`Unexpected request in step B2: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "ORPHAN_RECONCILIATION_FAILED",
  )
  assert.equal(postDuringBlockedRetry, 0)
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17, username: FIXTURE_USERNAME }).status,
    "pending",
  )
})

test("AUTH_TRANSACTION_JOURNAL_01: (C) VALID_ID_MISSING_TOKEN_DELETE_SUCCESS and (D) VALID_ID_MISSING_TOKEN_DELETE_FAILURE handle known ID cleanup and fail closed when DELETE fails", async () => {
  setAuth({
    server: SERVER_A,
    username: FIXTURE_USERNAME,
    password: FIXTURE_PASSWORD,
    token: "",
  })

  // --- (C) VALID_ID_MISSING_TOKEN_DELETE_SUCCESS: POST returns 201 with valid ID (710), missing token; DELETE 710 succeeds -> journal clears safely ---
  const deletedKeyIds = []
  await assert.rejects(
    migrateLegacyPasswordSession({
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
              id: 710,
              user_id: 17,
              token: "",
              description: options.body.description,
            },
          }
        }
        if (url === "v1/api-keys/710" && options.method === "DELETE") {
          deletedKeyIds.push(710)
          return { status: 204, _data: null }
        }
        throw new Error(`Unexpected request in step C: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "create-key" && error.code === "INVALID_API_KEY_RESPONSE",
  )

  assert.deepEqual(deletedKeyIds, [710])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(readAuthTransactionJournal().status, "empty")

  // --- (D) VALID_ID_MISSING_TOKEN_DELETE_FAILURE: POST returns 201 with valid ID (720), missing token; DELETE 720 fails -> journal remains pending and blocks second POST until reconciliation ---
  let failedDeleteDescription = ""
  const deleteAttempts = []
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          failedDeleteDescription = options.body.description
          return {
            status: 201,
            _data: {
              id: 720,
              user_id: 17,
              token: "",
              description: failedDeleteDescription,
            },
          }
        }
        if (url === "v1/api-keys/720" && options.method === "DELETE") {
          deleteAttempts.push(720)
          const deleteErr = new Error("Delete failed")
          deleteErr.status = 503
          throw deleteErr
        }
        throw new Error(`Unexpected request in step D1: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "create-key" && error.code === "INVALID_API_KEY_RESPONSE",
  )

  assert.deepEqual(deleteAttempts, [720])
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  const journalAfterDeleteFailure = readAuthTransactionJournal({
    server: SERVER_A,
    userId: 17,
    username: FIXTURE_USERNAME,
  })
  assert.equal(journalAfterDeleteFailure.status, "pending")
  assert.equal(journalAfterDeleteFailure.entry?.description, failedDeleteDescription)

  // Subsequent password provisioning must NOT POST before reconciliation
  let secondPostCount = 0
  await assert.rejects(
    migrateLegacyPasswordSession({
      consent: true,
      checkCompatibility: supportedCompatibilityStub,
      rawFetch: async (url, options = {}) => {
        if (url === "v1/me" && options.headers?.Authorization) {
          return { status: 200, _data: { id: 17, username: FIXTURE_USERNAME } }
        }
        if (url === "v1/api-keys" && (!options.method || options.method === "GET")) {
          return {
            status: 200,
            _data: [
              {
                id: 720,
                user_id: 17,
                token: "orphan-720",
                description: failedDeleteDescription,
                last_used_at: null,
              },
            ],
          }
        }
        if (url === "v1/api-keys/720" && options.method === "DELETE") {
          const deleteErr = new Error("Delete still failing")
          deleteErr.status = 503
          throw deleteErr
        }
        if (url === "v1/api-keys" && options.method === "POST") {
          secondPostCount += 1
          return { status: 201, _data: {} }
        }
        throw new Error(`Unexpected request in step D2: ${options.method ?? "GET"} ${url}`)
      },
    }),
    (error) => error.stage === "reconcile-journal" && error.code === "ORPHAN_RECONCILIATION_FAILED",
  )

  assert.equal(secondPostCount, 0)
  assert.equal(authState.get().password, FIXTURE_PASSWORD)
  assert.equal(
    readAuthTransactionJournal({ server: SERVER_A, userId: 17, username: FIXTURE_USERNAME }).status,
    "pending",
  )
})
