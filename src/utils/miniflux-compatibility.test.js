import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/utils/version") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent("export default () => 0")}`,
      }
    }
    return nextResolve(specifier, context)
  },
})

const { createCompatibilityRequestError } = await import(
  new URL("miniflux-compatibility.js", import.meta.url)
)

test("compatibility request errors keep status without exposing the private server URL", () => {
  const error = createCompatibilityRequestError(
    Object.assign(
      new Error("fetch failed for https://user:password@miniflux.private/v1/version?token=secret"),
      { status: 503 },
    ),
  )

  assert.equal(error.status, 503)
  assert.equal(error.message, "Compatibility request failed")
  assert.doesNotMatch(
    error.message,
    /https?:|miniflux\.private|password|token|secret|\/v1\/version/,
  )
})
