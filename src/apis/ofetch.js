import { ofetch } from "ofetch"

import router from "@/routes"
import { authState } from "@/store/authState"
import { getDataSessionRevision } from "@/store/dataState"
import * as authModule from "@/utils/auth"
import { createSafeRequestError, getSafeRequestErrorDetails } from "@/utils/safe-request-error"
import { clearSession } from "@/utils/session"

const isValidAuth = (auth) => authModule.default(auth)
const getAuthHeaders = (auth = {}) =>
  typeof authModule.getAuthHeaders === "function"
    ? authModule.getAuthHeaders(auth)
    : auth.token
      ? { "X-Auth-Token": auth.token }
      : { Authorization: `Basic ${btoa(`${auth.username ?? ""}:${auth.password ?? ""}`)}` }
const REQUEST_AUTH_SESSION_KEY = Symbol("requestAuth")
const MUTATING_HTTP_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"])

export const applyRawMutationRetryPolicy = (options = {}) => {
  const method = options.method?.toUpperCase()

  if (!MUTATING_HTTP_METHODS.has(method)) {
    return options
  }

  return { ...options, retry: options.retry ?? false }
}

const createRequestSessionSnapshot = ({ server, token, username, password }) => ({
  password,
  revision: getDataSessionRevision(),
  server,
  token,
  username,
})

const isCurrentRequestSession = (requestSession, auth) =>
  Boolean(requestSession) &&
  requestSession.revision === getDataSessionRevision() &&
  requestSession.server === auth.server &&
  requestSession.token === auth.token &&
  requestSession.username === auth.username &&
  requestSession.password === auth.password

// 创建 ofetch 实例并设置默认配置
const createApiClient = () => {
  return ofetch.create({
    onRequest({ _request, options }) {
      const auth = authState.get()
      const requestSession = options[REQUEST_AUTH_SESSION_KEY]

      if (requestSession && !isCurrentRequestSession(requestSession, auth)) {
        throw new Error("Stale auth request")
      }
      if (!isValidAuth(auth)) {
        throw new Error("Invalid auth")
      }

      options[REQUEST_AUTH_SESSION_KEY] = createRequestSessionSnapshot(auth)
      const { server } = auth
      options.baseURL = server
      options.headers = getAuthHeaders(auth)
    },
    onRequestError({ _request, _options, error }) {
      console.error("Request error:", getSafeRequestErrorDetails(createSafeRequestError(error)))
    },
    onResponse({ options }) {
      if (!isCurrentRequestSession(options[REQUEST_AUTH_SESSION_KEY], authState.get())) {
        throw new Error("Stale auth response")
      }
    },
    async onResponseError({ response, options }) {
      const statusCode = response.status
      if (
        statusCode === 401 &&
        isCurrentRequestSession(options[REQUEST_AUTH_SESSION_KEY], authState.get())
      ) {
        const { location } = router.state
        const from = `${location.pathname}${location.search}${location.hash}`
        clearSession()
        await router.navigate("/login", { replace: true, state: { from } })
      }
      console.error(
        "Response error:",
        getSafeRequestErrorDetails(createSafeRequestError({ status: statusCode })),
      )
    },
  })
}

const withSafeRequestError = (request) =>
  request.catch((error) => {
    throw createSafeRequestError(error)
  })

const apiClient = createApiClient()
const rawRequest = apiClient.raw
apiClient.raw = (url, options = {}) =>
  withSafeRequestError(rawRequest(url, applyRawMutationRetryPolicy(options)))
apiClient.get = (url, options = {}) =>
  withSafeRequestError(apiClient(url, { ...options, retry: options.retry ?? 3, method: "GET" }))
apiClient.post = (url, body, options = {}) =>
  withSafeRequestError(
    apiClient(url, { ...options, retry: options.retry ?? false, method: "POST", body }),
  )
apiClient.put = (url, body, options = {}) =>
  withSafeRequestError(
    apiClient(url, { ...options, retry: options.retry ?? false, method: "PUT", body }),
  )

export default apiClient
