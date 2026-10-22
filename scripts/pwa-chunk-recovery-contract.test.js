import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8")
const recoverySource = readFileSync(
  new URL("../src/utils/pwa-chunk-recovery.js", import.meta.url),
  "utf8",
)

test("PWA03A2C_PRELOAD_FAILURE_NEVER_RELOADS_BEFORE_EXPLICIT_USER_ACTION", () => {
  const handlerStart = recoverySource.indexOf("const handlePreloadError")
  const listenerStart = recoverySource.indexOf(
    'windowObject.addEventListener("vite:preloadError", handlePreloadError)',
  )
  const preloadHandler = recoverySource.slice(handlerStart, listenerStart)

  assert.match(preloadHandler, /event\.preventDefault\(\)/)
  assert.doesNotMatch(preloadHandler, /location\.(?:reload|replace)\(/)
  assert.doesNotMatch(recoverySource, /sessionStorage/)
})

test("PWA03A2C_RECOVERY_CONTROLLER_IS_INSTALLED_BEFORE_REACT_MOUNTS", () => {
  const recoveryInstall = mainSource.indexOf("installPwaChunkRecovery({")
  const reactMount = mainSource.indexOf("ReactDOM.createRoot")

  assert.notEqual(recoveryInstall, -1)
  assert.ok(recoveryInstall < reactMount)
})
