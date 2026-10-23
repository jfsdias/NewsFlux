const RUNTIME_ASSET_CACHE_PATTERN = /^runtime-build-assets(?:-v\d+)?$/
const WORKBOX_PRECACHE_PREFIX = "workbox-precache-v"
const RUNTIME_ASSET_PATH_PATTERN = /^(?:assets\/.+\.(?:css|js)|fonts\/.+\.woff2)$/i

const escapeRegExp = (value) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

export const getNewsFluxScopeUrl = (origin, basePath) => {
  if (typeof basePath !== "string" || !basePath.startsWith("/")) {
    throw new TypeError("NewsFlux base path must be an absolute path")
  }

  const normalizedPath = basePath.endsWith("/") ? basePath : `${basePath}/`
  const scopeUrl = new URL(normalizedPath, origin)

  if (scopeUrl.origin !== new URL(origin).origin || scopeUrl.pathname !== normalizedPath) {
    throw new TypeError("NewsFlux base path must remain within its current origin")
  }

  return scopeUrl
}

export const isNewsFluxServiceWorkerRegistration = (registration, origin, basePath) => {
  const scopeUrl = getNewsFluxScopeUrl(origin, basePath)

  if (registration.scope !== scopeUrl.href) {
    return false
  }

  const expectedScriptUrl = new URL("sw.js", scopeUrl).href
  return [registration.active, registration.waiting, registration.installing].some(
    (worker) => worker?.scriptURL === expectedScriptUrl,
  )
}

export const getNewsFluxCacheCleanupPlan = (cacheNames, scopeUrl) => {
  const precachePattern = new RegExp(
    String.raw`^${WORKBOX_PRECACHE_PREFIX}\d+-${escapeRegExp(scopeUrl.href)}$`,
  )

  return {
    precacheNames: cacheNames.filter((name) => precachePattern.test(name)),
    runtimeNames: cacheNames.filter((name) => RUNTIME_ASSET_CACHE_PATTERN.test(name)),
  }
}

export const isNewsFluxRuntimeAssetRequest = (requestUrl, scopeUrl) => {
  let url

  try {
    url = new URL(typeof requestUrl === "string" ? requestUrl : requestUrl.url)
  } catch {
    return false
  }

  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) {
    return false
  }

  const appRelativePath = url.pathname.slice(scopeUrl.pathname.length)
  return RUNTIME_ASSET_PATH_PATTERN.test(appRelativePath)
}

const getDialogText = (documentObject) => {
  let status = documentObject.querySelector?.("[data-newsflux-recovery-status]")
  if (!status) {
    status = documentObject.createElement("p")
    status.dataset.newsfluxRecoveryStatus = ""
    status.setAttribute("role", "status")
    status.setAttribute("aria-live", "polite")
    status.style.margin = "0"
  }
  return status
}

const setRecoveryBackgroundInert = (host, overlay) => {
  const previousStates = [...host.children]
    .filter((element) => element !== overlay)
    .map((element) => [element, element.inert])

  for (const [element] of previousStates) {
    element.inert = true
  }

  return () => {
    for (const [element, wasInert] of previousStates) {
      element.inert = wasInert
    }
  }
}

const makeProbeUrl = (scopeUrl) => {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return new URL(`__newsflux_recovery_probe__/${nonce}`, scopeUrl)
}

const isHealthyAppDocument = async (response, probeUrl, scopeUrl) => {
  if (!response?.ok || response.status !== 200) {
    return false
  }

  const contentType = response.headers?.get("content-type")?.split(";", 1)[0].trim().toLowerCase()
  if (contentType !== "text/html") {
    return false
  }

  let responseUrl
  try {
    responseUrl = new URL(response.url || probeUrl.href)
  } catch {
    return false
  }

  if (
    responseUrl.origin !== scopeUrl.origin ||
    !responseUrl.pathname.startsWith(scopeUrl.pathname)
  ) {
    return false
  }

  try {
    const documentText = await response.text()
    return /<div\b[^>]*\bid=["']root["']/.test(documentText)
  } catch {
    return false
  }
}

const preflightCurrentServer = async ({ fetchImpl, scopeUrl, windowObject }) => {
  if (typeof fetchImpl !== "function") {
    return false
  }

  const probeUrl = makeProbeUrl(scopeUrl)
  try {
    const response = await fetchImpl(probeUrl.href, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "text/html",
        "Cache-Control": "no-cache, no-store, max-age=0",
        Pragma: "no-cache",
      },
      mode: "same-origin",
      redirect: "follow",
    })
    return await isHealthyAppDocument(response, probeUrl, scopeUrl)
  } catch {
    return false
  }
}

const unregisterNewsFluxWorkers = async ({ navigatorObject, origin, basePath }) => {
  const serviceWorker = navigatorObject?.serviceWorker
  if (!serviceWorker || typeof serviceWorker.getRegistrations !== "function") {
    return true
  }

  const registrations = await serviceWorker.getRegistrations()
  const ownedRegistrations = registrations.filter((registration) =>
    isNewsFluxServiceWorkerRegistration(registration, origin, basePath),
  )

  for (const registration of ownedRegistrations) {
    if (!(await registration.unregister())) {
      return false
    }
  }

  return true
}

const prepareNewsFluxCacheCleanup = async ({ cacheStorage, scopeUrl }) => {
  if (!cacheStorage || typeof cacheStorage.keys !== "function") {
    return null
  }

  const plan = getNewsFluxCacheCleanupPlan(await cacheStorage.keys(), scopeUrl)
  const runtimeCleanups = []

  for (const cacheName of plan.runtimeNames) {
    const cache = await cacheStorage.open(cacheName)
    const requests = await cache.keys()
    runtimeCleanups.push({
      cache,
      cacheName,
      requests: requests.filter((request) => isNewsFluxRuntimeAssetRequest(request, scopeUrl)),
    })
  }

  return { ...plan, runtimeCleanups }
}

const clearNewsFluxCaches = async ({ cacheStorage, cleanupPlan }) => {
  if (!cacheStorage || !cleanupPlan) {
    return false
  }

  for (const cacheName of cleanupPlan.precacheNames) {
    await cacheStorage.delete(cacheName)
  }

  for (const { cache, cacheName, requests } of cleanupPlan.runtimeCleanups) {
    for (const request of requests) {
      await cache.delete(request)
    }

    const remainingRequests = await cache.keys()
    if (remainingRequests.length === 0) {
      await cacheStorage.delete(cacheName)
    }
  }

  return true
}

const createRecoverySurface = (documentObject) => {
  const overlay = documentObject.createElement("div")
  overlay.dataset.newsfluxChunkRecovery = ""
  Object.assign(overlay.style, {
    alignItems: "center",
    background: "rgba(7, 9, 12, 0.92)",
    boxSizing: "border-box",
    color: "#f5f7fa",
    display: "flex",
    inset: "0",
    justifyContent: "center",
    padding: "24px",
    position: "fixed",
    zIndex: "2147483647",
  })

  const dialog = documentObject.createElement("section")
  dialog.setAttribute("role", "alertdialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-labelledby", "newsflux-chunk-recovery-title")
  dialog.setAttribute("aria-describedby", "newsflux-chunk-recovery-description")
  dialog.tabIndex = -1
  Object.assign(dialog.style, {
    background: "#171b20",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    borderRadius: "12px",
    boxSizing: "border-box",
    fontFamily: "system-ui, sans-serif",
    lineHeight: "1.5",
    maxWidth: "min(100%, 480px)",
    padding: "24px",
    width: "100%",
  })

  const title = documentObject.createElement("h1")
  title.id = "newsflux-chunk-recovery-title"
  title.textContent = "NewsFlux needs to reconnect to its current version"
  Object.assign(title.style, { fontSize: "1.25rem", margin: "0 0 12px" })

  const description = documentObject.createElement("p")
  description.id = "newsflux-chunk-recovery-description"
  description.textContent =
    "This session's files no longer match the version being served. Reload NewsFlux to recover. Your saved preferences and account data will be kept."
  Object.assign(description.style, { margin: "0 0 20px" })

  const status = getDialogText(documentObject)
  status.textContent = ""

  const actions = documentObject.createElement("div")
  Object.assign(actions.style, { display: "flex", flexWrap: "wrap", gap: "12px" })

  const recoverButton = documentObject.createElement("button")
  recoverButton.type = "button"
  recoverButton.textContent = "Reload NewsFlux"
  Object.assign(recoverButton.style, {
    background: "#d9e7ff",
    border: "0",
    borderRadius: "6px",
    color: "#111820",
    cursor: "pointer",
    font: "inherit",
    fontWeight: "600",
    outline: "2px solid #9bc2ff",
    outlineOffset: "3px",
    padding: "10px 16px",
  })

  const retryButton = documentObject.createElement("button")
  retryButton.type = "button"
  retryButton.textContent = "Try again"
  retryButton.hidden = true
  Object.assign(retryButton.style, {
    background: "transparent",
    border: "1px solid rgba(255, 255, 255, 0.42)",
    borderRadius: "6px",
    color: "inherit",
    cursor: "pointer",
    font: "inherit",
    outline: "2px solid #9bc2ff",
    outlineOffset: "3px",
    padding: "10px 16px",
  })

  actions.append(recoverButton, retryButton)
  dialog.append(title, description, status, actions)
  overlay.append(dialog)

  const host = documentObject.body || documentObject.documentElement
  host.append(overlay)
  const restoreBackground = setRecoveryBackgroundInert(host, overlay)
  recoverButton.focus({ preventScroll: true })

  return { overlay, dialog, recoverButton, retryButton, status, restoreBackground }
}

export const installPwaChunkRecovery = ({
  windowObject,
  documentObject,
  navigatorObject,
  cacheStorage,
  fetchImpl,
  basePath,
}) => {
  let surface
  let recoveryInProgress = false
  let recoveryNavigated = false
  let lastFocusedAction
  const scopeUrl = getNewsFluxScopeUrl(windowObject.location.origin, basePath)

  const currentUrl = new URL(windowObject.location.href)
  if (currentUrl.searchParams.has("__newsflux_recovery") && windowObject.history?.replaceState) {
    currentUrl.searchParams.delete("__newsflux_recovery")
    windowObject.history.replaceState(
      windowObject.history.state,
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    )
  }

  const setBusy = (busy) => {
    if (!surface) {
      return
    }
    surface.recoverButton.disabled = busy
    surface.retryButton.disabled = busy
    surface.recoverButton.setAttribute("aria-busy", String(busy))
  }

  const recover = async () => {
    if (recoveryInProgress || recoveryNavigated) {
      return
    }
    recoveryInProgress = true
    setBusy(true)
    surface.status.textContent = "Checking the current NewsFlux version…"
    surface.retryButton.hidden = true

    try {
      if (!(await preflightCurrentServer({ fetchImpl, scopeUrl, windowObject }))) {
        throw new Error("The current NewsFlux version could not be reached.")
      }

      const cleanupPlan = await prepareNewsFluxCacheCleanup({ cacheStorage, scopeUrl })
      if (!cleanupPlan) {
        throw new Error("NewsFlux could not safely inspect its application caches.")
      }

      if (
        !(await unregisterNewsFluxWorkers({
          navigatorObject,
          origin: windowObject.location.origin,
          basePath,
        }))
      ) {
        throw new Error("NewsFlux could not safely disconnect its previous version.")
      }

      if (!(await clearNewsFluxCaches({ cacheStorage, cleanupPlan }))) {
        throw new Error("NewsFlux could not safely clear its cached application files.")
      }

      const targetUrl = new URL(windowObject.location.href)
      targetUrl.searchParams.set(
        "__newsflux_recovery",
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      recoveryNavigated = true
      windowObject.location.replace(targetUrl.href)
    } catch {
      recoveryInProgress = false
      setBusy(false)
      surface.status.textContent =
        "NewsFlux could not reach or safely prepare the current version. Your saved data was not cleared. Check your connection and try again."
      surface.retryButton.hidden = false
    }
  }

  const handlePreloadError = (event) => {
    event.preventDefault()
    if (!surface) {
      surface = createRecoverySurface(documentObject)
      lastFocusedAction = surface.recoverButton
      surface.recoverButton.addEventListener("click", recover)
      surface.retryButton.addEventListener("click", recover)
      documentObject.addEventListener("focusin", containRecoveryFocus, true)
      documentObject.addEventListener("keydown", handleRecoveryKeydown, true)
    }
  }

  const getAvailableActions = () =>
    [surface?.recoverButton, surface?.retryButton].filter(
      (button) => button && !button.hidden && !button.disabled,
    )

  const focusRecoveryAction = (button = lastFocusedAction) => {
    const availableActions = getAvailableActions()
    const target = availableActions.includes(button) ? button : availableActions[0]
    target?.focus({ preventScroll: true })
    return target
  }

  function containRecoveryFocus(event) {
    if (!surface || surface.dialog.contains(event.target)) {
      if (surface && event.target === surface.recoverButton) {
        lastFocusedAction = surface.recoverButton
      } else if (surface && event.target === surface.retryButton) {
        lastFocusedAction = surface.retryButton
      }
      return
    }

    focusRecoveryAction()
  }

  function handleRecoveryKeydown(event) {
    if (!surface) {
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      event.stopImmediatePropagation?.()
      return
    }

    if (event.key !== "Tab") {
      return
    }

    event.preventDefault()
    const actions = getAvailableActions()
    if (actions.length === 0) {
      surface.dialog.focus({ preventScroll: true })
      return
    }

    const currentIndex = actions.indexOf(documentObject.activeElement)
    const step = event.shiftKey ? -1 : 1
    const nextIndex =
      currentIndex === -1
        ? event.shiftKey
          ? actions.length - 1
          : 0
        : (currentIndex + step + actions.length) % actions.length
    focusRecoveryAction(actions[nextIndex])
  }

  windowObject.addEventListener("vite:preloadError", handlePreloadError)

  return {
    dispose() {
      windowObject.removeEventListener?.("vite:preloadError", handlePreloadError)
      documentObject.removeEventListener?.("focusin", containRecoveryFocus, true)
      documentObject.removeEventListener?.("keydown", handleRecoveryKeydown, true)
      surface?.restoreBackground()
      surface?.overlay.remove?.()
    },
  }
}
