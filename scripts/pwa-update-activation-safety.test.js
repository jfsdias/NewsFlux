import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const viteConfig = readFileSync(new URL("../vite.config.js", import.meta.url), "utf8")
const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8")
const updateStore = readFileSync(new URL("../src/store/pwaUpdateState.js", import.meta.url), "utf8")
const updateController = readFileSync(
  new URL("../src/utils/pwa-update.js", import.meta.url),
  "utf8",
)

const countMatches = (source, pattern) => source.match(pattern)?.length ?? 0

test("PWA-03A1 the service worker waits for the user instead of activating on its own", () => {
  assert.doesNotMatch(
    viteConfig,
    /registerType:\s*"autoUpdate"/,
    "autoUpdate makes the generated register code reload the page when a worker activates",
  )
  assert.match(viteConfig, /registerType:\s*"prompt"/)
  assert.doesNotMatch(
    viteConfig,
    /skipWaiting:\s*true/,
    "skipWaiting activates every new worker immediately; activation must follow a user action",
  )
})

test("PWA-03A1 first installs still take control of the page", () => {
  assert.match(
    viteConfig,
    /clientsClaim:\s*true/,
    "prompt mode does not set clientsClaim, and the runtime-asset warm-up needs a controlled first load",
  )
})

test("PWA-03A1 the page never reloads from a service worker event on its own", () => {
  assert.doesNotMatch(
    mainSource,
    /registerSW\(\{\s*immediate:\s*false\s*\}\)/,
    "registering without update callbacks falls back to the generated automatic reload",
  )
  assert.match(mainSource, /createPwaUpdateController/)
})

test("PWA-03A1 the only reload in main.jsx is the user-approved update reload", () => {
  assert.equal(
    countMatches(mainSource, /location\.reload\(\)/g),
    1,
    "the preload-error recovery must not reload without an explicit user action",
  )
})

test("PWA-03A1 preload recovery is installed before React and remains separate from updates", () => {
  const recoveryInstall = mainSource.indexOf("installPwaChunkRecovery({")
  const reactMount = mainSource.indexOf("ReactDOM.createRoot")

  assert.notEqual(recoveryInstall, -1)
  assert.ok(recoveryInstall < reactMount)
  assert.match(mainSource, /createPwaUpdateController/)
  assert.doesNotMatch(mainSource, /reactflux:preload-error-reload/)
})

test("PWA-03A1 a pending update is transient and adds no persistent state", () => {
  const persistence = /persistentAtom|localStorage|sessionStorage|indexedDB|document\.cookie/
  assert.doesNotMatch(updateStore, persistence)
  assert.doesNotMatch(updateController, persistence)
})
