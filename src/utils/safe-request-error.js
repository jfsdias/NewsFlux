const ERROR_CATEGORIES = new Set([
  "authentication",
  "forbidden",
  "http",
  "invalid-response",
  "network",
  "rate-limited",
  "server",
])

const SAFE_OPERATIONS = new Set(["article-list", "reader", "request", "route"])

const getStatus = (error) => {
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status)
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
}

const getCategory = (error, status) => {
  if (ERROR_CATEGORIES.has(error?.category)) {
    return error.category
  }
  if (status === 401) {
    return "authentication"
  }
  if (status === 403) {
    return "forbidden"
  }
  if (status === 429) {
    return "rate-limited"
  }
  if (status !== null && status >= 500) {
    return "server"
  }
  if (status !== null && status >= 200 && status < 300) {
    return "invalid-response"
  }
  return status === null ? "network" : "http"
}

export const createSafeRequestError = (error, operation = "request") => {
  const status = getStatus(error)
  const safeError = new Error("Request failed")
  safeError.name = "SafeRequestError"
  safeError.category = getCategory(error, status)
  safeError.operation = SAFE_OPERATIONS.has(operation) ? operation : "request"
  if (status !== null) {
    safeError.status = status
  }
  return safeError
}

export const createInvalidResponseError = (operation = "request") => {
  const error = new TypeError("Invalid server response")
  error.name = "SafeRequestError"
  error.category = "invalid-response"
  error.operation = SAFE_OPERATIONS.has(operation) ? operation : "request"
  error.status = 200
  return error
}

export const getSafeRequestErrorDetails = (error, operation = "request") => {
  const status = getStatus(error)
  const errorOperation =
    SAFE_OPERATIONS.has(error?.operation) && error.operation !== "request" ? error.operation : null
  return {
    category: getCategory(error, status),
    operation: errorOperation || (SAFE_OPERATIONS.has(operation) && operation) || "request",
    status,
  }
}

export const getRequestErrorCategory = (error) => {
  const status = getStatus(error)
  return getCategory(error, status)
}
