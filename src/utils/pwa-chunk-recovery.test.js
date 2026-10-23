/* eslint-disable import/extensions -- Node's native ESM test runner requires explicit extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  getNewsFluxCacheCleanupPlan,
  getNewsFluxScopeUrl,
  installPwaChunkRecovery,
  isNewsFluxRuntimeAssetRequest,
  isNewsFluxServiceWorkerRegistration,
} from "./pwa-chunk-recovery.js"

class FakeElement {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.attributes = {}
    this.dataset = {}
    this.style = {}
    this.listeners = new Map()
    this.hidden = false
    this.disabled = false
    this.inert = false
    this.parentElement = null
    this.isConnected = false
    this.textContent = ""
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this
      child.isConnected = this.isConnected
      this.children.push(child)
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  focus() {
    if (this.isBlockedByInertAncestor()) {
      return
    }
    this.ownerDocument.activeElement = this
    this.ownerDocument.dispatch("focusin", { target: this })
  }

  isBlockedByInertAncestor() {
    return this.inert || this.parentElement?.isBlockedByInertAncestor() === true
  }

  click() {
    let result
    for (const listener of this.listeners.get("click") ?? []) {
      result = listener({ preventDefault() {} })
    }
    return result
  }

  querySelectorAll(tagName) {
    const matches = []
    for (const child of this.children) {
      if (child.tagName === tagName.toUpperCase()) {
        matches.push(child)
      }
      matches.push(...child.querySelectorAll(tagName))
    }
    return matches
  }

  querySelector(tagName) {
    const normalizedTagName = tagName.toUpperCase()
    for (const child of this.children) {
      if (child.tagName === normalizedTagName) {
        return child
      }
      const nestedMatch = child.querySelector(tagName)
      if (nestedMatch) {
        return nestedMatch
      }
    }
    return null
  }

  contains(element) {
    return element === this || this.children.some((child) => child.contains(element))
  }

  remove() {
    if (!this.parentElement) {
      return
    }
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this)
    this.parentElement = null
    this.isConnected = false
  }
}

class FakeDocument {
  activeElement = null
  listeners = new Map()

  constructor() {
    this.body = new FakeElement(this, "body")
    this.body.isConnected = true
  }

  createElement(tagName) {
    return new FakeElement(this, tagName)
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    const dispatched = {
      type,
      defaultPrevented: false,
      propagationStopped: false,
      ...event,
      preventDefault: () => {
        dispatched.defaultPrevented = true
      },
      stopImmediatePropagation: () => {
        dispatched.propagationStopped = true
      },
    }

    for (const listener of this.listeners.get(type) ?? []) {
      listener(dispatched)
      if (dispatched.propagationStopped) {
        break
      }
    }
    return dispatched
  }
}

class FakeWindow {
  constructor(url = "https://newsflux.test/feed/75?filter=unread") {
    const location = {
      href: url,
      origin: new URL(url).origin,
      replaceCalls: [],
    }
    location.replace = (target) => location.replaceCalls.push(target)
    this.location = location
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  removeEventListener(type, listener) {
    this.listeners.delete(type)
  }

  dispatch(type, event = {}) {
    const dispatched = {
      type,
      defaultPrevented: false,
      ...event,
    }
    dispatched.preventDefault = () => {
      dispatched.defaultPrevented = true
    }
    this.listeners.get(type)?.(dispatched)
    return dispatched
  }
}

class FakeCache {
  constructor(requests = []) {
    this.requests = [...requests]
    this.deleted = []
  }

  async keys() {
    return [...this.requests]
  }

  async delete(request) {
    const index = this.requests.findIndex((candidate) => candidate.url === request.url)
    if (index === -1) {
      return false
    }
    this.deleted.push(request.url)
    this.requests.splice(index, 1)
    return true
  }
}

class FakeCacheStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.deletedNames = []
  }

  async keys() {
    return [...this.entries.keys()]
  }

  async open(name) {
    if (!this.entries.has(name)) {
      this.entries.set(name, new FakeCache())
    }
    return this.entries.get(name)
  }

  async delete(name) {
    this.deletedNames.push(name)
    return this.entries.delete(name)
  }
}

const makeRequest = (url) => ({ url })
const origin = "https://newsflux.test"
const runtimeName = "runtime-build-assets-v2"
const unrelatedCacheName = "another-app-cache"

const makeRegistration = (scope, scriptPath) => {
  const makeWorker = () => {
    const worker = { scriptURL: `${origin}${scriptPath}`, skipWaitingCalls: 0 }
    worker.skipWaiting = () => {
      worker.skipWaitingCalls += 1
    }
    return worker
  }
  const registration = {
    scope,
    active: makeWorker(),
    waiting: makeWorker(),
    unregisterCalls: 0,
  }
  registration.unregister = async () => {
    registration.unregisterCalls += 1
    return true
  }
  return registration
}

const makeResponse = (url, { status = 200, contentType = "text/html; charset=utf-8" } = {}) => ({
  url,
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
  async text() {
    return '<!doctype html><html><body><div id="root"></div></body></html>'
  },
})

const createHarness = ({ basePath = "/", networkStatus = 200 } = {}) => {
  let currentNetworkStatus = networkStatus
  const windowObject = new FakeWindow()
  const documentObject = new FakeDocument()
  const scopeUrl = getNewsFluxScopeUrl(origin, basePath)
  const ownedRegistration = makeRegistration(scopeUrl.href, new URL("sw.js", scopeUrl).pathname)
  const otherRegistration = makeRegistration(`${origin}/other/`, "/other/sw.js")
  const serviceWorker = {
    registrations: [ownedRegistration, otherRegistration],
    getRegistrationsCalls: 0,
  }
  serviceWorker.getRegistrations = async () => {
    serviceWorker.getRegistrationsCalls += 1
    return serviceWorker.registrations
  }
  const prefix = scopeUrl.pathname
  const runtimeCache = new FakeCache([
    makeRequest(`${origin}${prefix}assets/old-build-lazy.js`),
    makeRequest(`${origin}${prefix}fonts/newsflux.woff2`),
    makeRequest(`${origin}/other/assets/other-app.js`),
  ])
  const precacheName = `workbox-precache-v2-${origin}${scopeUrl.pathname}`
  const cacheStorage = new FakeCacheStorage({
    [precacheName]: new FakeCache([makeRequest(`${origin}${prefix}index.html`)]),
    [runtimeName]: runtimeCache,
    [unrelatedCacheName]: new FakeCache([makeRequest(`${origin}/other/app-shell.js`)]),
  })
  const fetchCalls = []
  const fetchImpl = async (url, options) => {
    fetchCalls.push({ url: String(url), options })
    return makeResponse(String(url), { status: currentNetworkStatus })
  }
  const controller = installPwaChunkRecovery({
    windowObject,
    documentObject,
    navigatorObject: { serviceWorker },
    cacheStorage,
    fetchImpl,
    basePath,
  })

  return {
    windowObject,
    documentObject,
    serviceWorker,
    ownedRegistration,
    otherRegistration,
    cacheStorage,
    runtimeCache,
    fetchCalls,
    setNetworkStatus: (status) => {
      currentNetworkStatus = status
    },
    controller,
    firePreloadError: () => windowObject.dispatch("vite:preloadError"),
    buttons: () => documentObject.body.querySelectorAll("button"),
  }
}

test("PWA03A2C_SCOPE_ROOT_AND_NONROOT_ARE_EXACT", () => {
  assert.equal(getNewsFluxScopeUrl(origin, "/").href, `${origin}/`)
  assert.equal(getNewsFluxScopeUrl(origin, "/newsflux/").href, `${origin}/newsflux/`)
  assert.equal(getNewsFluxScopeUrl(origin, "/newsflux").href, `${origin}/newsflux/`)
})

test("PWA03A2C_UNREGISTER_ONLY_EXACT_NEWSFLUX_SCOPE_AND_SCRIPT", () => {
  const rootScope = getNewsFluxScopeUrl(origin, "/")
  const own = makeRegistration(rootScope.href, "/sw.js")
  const otherBase = makeRegistration(`${origin}/newsflux/`, "/newsflux/sw.js")
  const wrongScript = makeRegistration(rootScope.href, "/other/sw.js")

  assert.equal(isNewsFluxServiceWorkerRegistration(own, origin, "/"), true)
  assert.equal(isNewsFluxServiceWorkerRegistration(otherBase, origin, "/"), false)
  assert.equal(isNewsFluxServiceWorkerRegistration(wrongScript, origin, "/"), false)
})

test("PWA03A2C_CACHE_PLAN_IDENTIFIES_WORKBOX_AND_CONTROLLED_RUNTIME_NAMES", () => {
  const scope = getNewsFluxScopeUrl(origin, "/newsflux/")
  const ownPrecache = `workbox-precache-v2-${origin}/newsflux/`
  const plan = getNewsFluxCacheCleanupPlan(
    [
      ownPrecache,
      runtimeName,
      "runtime-build-assets",
      "runtime-build-assets-v3",
      "unrelated-cache",
      `workbox-precache-v2-${origin}/`,
    ],
    scope,
  )

  assert.deepEqual(plan.precacheNames, [ownPrecache])
  assert.deepEqual(plan.runtimeNames, [
    runtimeName,
    "runtime-build-assets",
    "runtime-build-assets-v3",
  ])
})

test("PWA03A2C_RUNTIME_CACHE_FILTERS_ENTRIES_TO_EXACT_BASE_PATH", () => {
  const root = getNewsFluxScopeUrl(origin, "/")
  const nested = getNewsFluxScopeUrl(origin, "/newsflux/")

  assert.equal(isNewsFluxRuntimeAssetRequest(`${origin}/assets/lazy.js`, root), true)
  assert.equal(isNewsFluxRuntimeAssetRequest(`${origin}/other/assets/lazy.js`, nested), false)
  assert.equal(isNewsFluxRuntimeAssetRequest(`${origin}/newsflux/assets/lazy.js`, nested), true)
  assert.equal(
    isNewsFluxRuntimeAssetRequest("https://other.test/newsflux/assets/lazy.js", nested),
    false,
  )
  assert.equal(isNewsFluxRuntimeAssetRequest(`${origin}/newsflux/index.html`, nested), false)
})

test("PWA03A2C_PRELOAD_ERROR_SHOWS_PRE_REACT_RECOVERY_WITH_ACCESSIBLE_FOCUS", () => {
  const harness = createHarness()
  const event = harness.firePreloadError()
  const dialog = harness.documentObject.body.querySelector("section")
  const [recoverButton, retryButton] = harness.buttons()

  assert.equal(event.defaultPrevented, true)
  assert.equal(dialog.attributes.role, "alertdialog")
  assert.equal(dialog.attributes["aria-modal"], "true")
  assert.ok(dialog.attributes["aria-labelledby"])
  assert.ok(dialog.attributes["aria-describedby"])
  assert.equal(harness.documentObject.activeElement, recoverButton)
  assert.equal(recoverButton.textContent, "Reload NewsFlux")
  assert.equal(retryButton.hidden, true)
  assert.equal(harness.windowObject.location.replaceCalls.length, 0)
  assert.equal(harness.serviceWorker.getRegistrationsCalls, 0)
})

test("PWA03A2C_FOCUS_CONTAINMENT_RESISTS_BACKGROUND_RESTORE_AND_RESTORES_INERT_ON_DISPOSE", () => {
  const harness = createHarness()
  const background = harness.documentObject.createElement("button")
  const previouslyInert = harness.documentObject.createElement("button")
  previouslyInert.inert = true
  harness.documentObject.body.append(background)
  harness.documentObject.body.append(previouslyInert)
  background.focus()

  harness.firePreloadError()
  const [recoverButton] = harness.documentObject.body
    .querySelector("section")
    .querySelectorAll("button")

  assert.equal(background.inert, true)
  assert.equal(previouslyInert.inert, true)
  background.focus()
  assert.equal(harness.documentObject.activeElement, recoverButton)

  harness.controller.dispose()

  assert.equal(background.inert, false)
  assert.equal(previouslyInert.inert, true)
  assert.equal(harness.documentObject.listeners.get("focusin")?.size ?? 0, 0)
  assert.equal(harness.documentObject.listeners.get("keydown")?.size ?? 0, 0)
})

test("PWA03A2C_TAB_AND_SHIFT_TAB_REMAIN_WITHIN_VISIBLE_RECOVERY_ACTIONS", async () => {
  const harness = createHarness({ networkStatus: 503 })
  harness.firePreloadError()
  const [recoverButton, retryButton] = harness.buttons()
  const dialog = harness.documentObject.body.querySelector("section")

  const singleActionTab = harness.documentObject.dispatch("keydown", { key: "Tab" })
  assert.equal(singleActionTab.defaultPrevented, true)
  assert.equal(harness.documentObject.activeElement, recoverButton)

  await recoverButton.click()
  assert.equal(retryButton.hidden, false)

  harness.documentObject.activeElement = recoverButton
  harness.documentObject.dispatch("keydown", { key: "Tab" })
  assert.equal(harness.documentObject.activeElement, retryButton)

  harness.documentObject.dispatch("keydown", { key: "Tab" })
  assert.equal(harness.documentObject.activeElement, recoverButton)

  harness.documentObject.dispatch("keydown", { key: "Tab", shiftKey: true })
  assert.equal(harness.documentObject.activeElement, retryButton)
  assert.equal(dialog.contains(harness.documentObject.activeElement), true)
})

test("PWA03A2C_ESCAPE_DOES_NOT_DISMISS_RECOVERY", () => {
  const harness = createHarness()
  harness.firePreloadError()

  const event = harness.documentObject.dispatch("keydown", { key: "Escape" })

  assert.equal(event.defaultPrevented, true)
  assert.ok(harness.documentObject.body.querySelector("section"))
})

test("PWA03A2C_NETWORK_FAILURE_PRESERVES_WORKERS_AND_CACHES_AND_OFFERS_RETRY", async () => {
  const harness = createHarness({ networkStatus: 503 })
  harness.firePreloadError()
  const [recoverButton, retryButton] = harness.buttons()

  await recoverButton.click()

  assert.equal(harness.fetchCalls.length, 1)
  assert.equal(harness.fetchCalls[0].options.cache, "no-store")
  assert.equal(harness.serviceWorker.getRegistrationsCalls, 0)
  assert.equal(harness.ownedRegistration.unregisterCalls, 0)
  assert.deepEqual(harness.cacheStorage.deletedNames, [])
  assert.deepEqual(harness.runtimeCache.deleted, [])
  assert.equal(harness.windowObject.location.replaceCalls.length, 0)
  assert.equal(retryButton.hidden, false)
  assert.match(dialogText(harness.documentObject), /could not reach/i)
})

test("PWA03A2C_RETRY_AFTER_NETWORK_RECOVERY_PERFORMS_ONE_EXPLICIT_NAVIGATION", async () => {
  const harness = createHarness({ networkStatus: 503 })
  harness.firePreloadError()
  await harness.buttons()[0].click()

  harness.setNetworkStatus(200)
  await harness.buttons()[1].click()

  assert.equal(harness.fetchCalls.length, 2)
  assert.equal(harness.ownedRegistration.unregisterCalls, 1)
  assert.equal(harness.windowObject.location.replaceCalls.length, 1)
})

const dialogText = (documentObject) => {
  const dialog = documentObject.body.querySelector("section")
  return dialog.children.map((child) => child.textContent).join(" ")
}

test("PWA03A2C_SUCCESS_REMOVES_ONLY_OWN_PWA_STATE_AND_RELOADS_ONCE", async () => {
  const harness = createHarness()
  harness.firePreloadError()
  const [recoverButton] = harness.buttons()

  await recoverButton.click()
  await recoverButton.click()

  assert.equal(harness.fetchCalls.length, 1)
  assert.equal(harness.fetchCalls[0].options.credentials, "same-origin")
  assert.match(harness.fetchCalls[0].url, /__newsflux_recovery_probe__\//)
  assert.equal(harness.ownedRegistration.unregisterCalls, 1)
  assert.equal(harness.otherRegistration.unregisterCalls, 0)
  assert.equal(harness.ownedRegistration.waiting.skipWaitingCalls, 0)
  assert.deepEqual(harness.cacheStorage.deletedNames, [`workbox-precache-v2-${origin}/`])
  assert.deepEqual(harness.runtimeCache.deleted, [
    `${origin}/assets/old-build-lazy.js`,
    `${origin}/fonts/newsflux.woff2`,
  ])
  assert.ok(harness.cacheStorage.entries.has(unrelatedCacheName))
  const unrelatedCache = await harness.cacheStorage.open(unrelatedCacheName)
  const unrelatedCacheEntries = await unrelatedCache.keys()
  assert.deepEqual(unrelatedCacheEntries, [makeRequest(`${origin}/other/app-shell.js`)])
  const runtimeCache = await harness.cacheStorage.open(runtimeName)
  const runtimeCacheEntries = await runtimeCache.keys()
  assert.deepEqual(runtimeCacheEntries, [makeRequest(`${origin}/other/assets/other-app.js`)])
  assert.equal(harness.windowObject.location.replaceCalls.length, 1)
})

test("PWA03A2C_RECOVERY_RELOAD_IS_ONE_EXPLICIT_CACHE_BUSTED_NAVIGATION", async () => {
  const harness = createHarness()
  harness.firePreloadError()
  await harness.buttons()[0].click()

  const target = new URL(harness.windowObject.location.replaceCalls[0])
  assert.equal(target.pathname, "/feed/75")
  assert.equal(target.searchParams.get("filter"), "unread")
  assert.ok(target.searchParams.has("__newsflux_recovery"))
  assert.equal(harness.windowObject.location.replaceCalls.length, 1)
})

test("PWA03A2C_NO_GLOBAL_ERROR_OR_UPDATE_EVENT_IS_CONVERTED_TO_RECOVERY", () => {
  const harness = createHarness()
  assert.deepEqual([...harness.windowObject.listeners.keys()], ["vite:preloadError"])
})

test("PWA03A2C_REPEATED_PRELOAD_ERRORS_REUSE_ONE_RECOVERY_SURFACE", () => {
  const harness = createHarness()
  harness.firePreloadError()
  harness.firePreloadError()

  assert.equal(harness.documentObject.body.children.length, 1)
  assert.equal(harness.buttons().length, 2)
})

test("PWA03A2C_DOES_NOT_CLEAR_USER_ORIGIN_STORAGE", async () => {
  const recoverySource = await import("./pwa-chunk-recovery.js")
  const sourceText = Object.values(recoverySource).join(" ")

  assert.doesNotMatch(sourceText, /localStorage|sessionStorage|indexedDB|document\.cookie/)
  assert.doesNotMatch(sourceText, /skipWaiting\s*\(/)
})
