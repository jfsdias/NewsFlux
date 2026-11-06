import assert from "node:assert/strict"
import { test } from "node:test"

const { createSafeRequestError, getSafeRequestErrorDetails } = await import(
  new URL("safe-request-error.js", import.meta.url)
)

test("creates a safe categorized error without retaining provider response data", () => {
  const error = createSafeRequestError(
    Object.assign(new Error("Bearer private-token at https://server/?token=secret"), {
      status: 503,
      data: { error_message: "password=hunter2" },
      request: "https://server/private?token=secret",
    }),
    "article-list",
  )

  assert.equal(error.status, 503)
  assert.equal(error.category, "server")
  assert.equal(error.operation, "article-list")
  assert.equal(error.message, "Request failed")
  assert.equal("data" in error, false)
  assert.equal("request" in error, false)
  assert.equal("cause" in error, false)
  assert.doesNotMatch(
    JSON.stringify(getSafeRequestErrorDetails(error)),
    /private-token|secret|hunter2/,
  )
})

test("categorizes authentication, forbidden, rate limit, server, HTTP and network failures", () => {
  const cases = [
    [{ status: 401 }, "authentication"],
    [{ status: 403 }, "forbidden"],
    [{ status: 429 }, "rate-limited"],
    [{ status: 500 }, "server"],
    [{ status: 200 }, "invalid-response"],
    [{ status: 404 }, "http"],
    [new TypeError("Failed to fetch https://private/?password=secret"), "network"],
  ]

  for (const [error, category] of cases) {
    assert.equal(createSafeRequestError(error, "reader").category, category)
  }
})

test("safe diagnostic details contain only approved structured fields", () => {
  const details = getSafeRequestErrorDetails(
    createSafeRequestError({ status: 429, message: "raw body token=secret" }, "article-list"),
  )

  assert.deepEqual(details, {
    category: "rate-limited",
    operation: "article-list",
    status: 429,
  })
  assert.doesNotMatch(JSON.stringify(details), /raw body|secret/)
  assert.equal(
    getSafeRequestErrorDetails(new Error("untrusted"), "https://private.invalid/token").operation,
    "request",
  )
  assert.equal(
    getSafeRequestErrorDetails(createSafeRequestError(new Error("network")), "reader").operation,
    "reader",
  )
})
