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

test("PWA-03A1 the only reloads in main.jsx are the preload-error guard and the user-approved reload", () => {
  assert.equal(
    countMatches(mainSource, /location\.reload\(\)/g),
    2,
    "one in handlePreloadError, one passed to the update controller",
  )
})

test("PWA-03A1 the existing preload-error guard is unchanged", () => {
  assert.match(mainSource, /const PRELOAD_ERROR_RELOAD_KEY = "reactflux:preload-error-reload"/)
  assert.match(mainSource, /const PRELOAD_ERROR_RELOAD_COOLDOWN_MS = 10_000/)
  assert.match(
    mainSource,
    /globalThis\.addEventListener\("vite:preloadError", handlePreloadError\)/,
  )
  const guard = mainSource.slice(
    mainSource.indexOf("const handlePreloadError"),
    mainSource.indexOf('globalThis.addEventListener("vite:preloadError"'),
  )
  assert.match(guard, /globalThis\.sessionStorage\.getItem\(PRELOAD_ERROR_RELOAD_KEY\)/)
  assert.match(guard, /elapsed < PRELOAD_ERROR_RELOAD_COOLDOWN_MS/)
  assert.match(guard, /event\.preventDefault\(\)\s*\n\s*globalThis\.location\.reload\(\)/)
})

test("PWA-03A1 a pending update is transient and adds no persistent state", () => {
  const persistence = /persistentAtom|localStorage|sessionStorage|indexedDB|document\.cookie/
  assert.doesNotMatch(updateStore, persistence)
  assert.doesNotMatch(updateController, persistence)
})
