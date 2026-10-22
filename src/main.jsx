import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import ReactDOM from "react-dom/client"
import { RouterProvider } from "react-router/dom"
import { registerSW } from "virtual:pwa-register"

import "simplebar-react/dist/simplebar.min.css"

import "./index.css"
import router from "./routes"
import pwaUpdateState from "./store/pwaUpdateState"
import { installPwaChunkRecovery } from "./utils/pwa-chunk-recovery"
import createPwaUpdateController from "./utils/pwa-update"
import "./theme.css"
import "./liquid-glass.css"

installPwaChunkRecovery({
  windowObject: globalThis,
  documentObject: globalThis.document,
  navigatorObject: globalThis.navigator,
  cacheStorage: globalThis.caches,
  fetchImpl: globalThis.fetch.bind(globalThis),
  basePath: import.meta.env.BASE_URL,
})

const isInstalledIOSApp = globalThis.navigator.standalone === true

// Keep iOS standalone mode explicit because its default status bar can shrink innerHeight
// without changing the CSS initial containing block.
document.documentElement.classList.toggle("installed-pwa", isInstalledIOSApp)

if (isInstalledIOSApp) {
  const syncInstalledAppViewportHeight = () => {
    const viewportHeight = globalThis.innerHeight
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
      return
    }

    document.documentElement.style.setProperty(
      "--installed-app-viewport-height",
      `${Math.round(viewportHeight)}px`,
    )
  }

  syncInstalledAppViewportHeight()
  // Keyboard-only visual viewport changes should not collapse the entire app shell.
  globalThis.addEventListener("resize", syncInstalledAppViewportHeight)
}

ReactDOM.createRoot(document.querySelector("#root")).render(<RouterProvider router={router} />)

const RUNTIME_ASSET_PATTERN = /\/(?:assets\/.*\.(?:css|js)|fonts\/.*\.woff2)$/

const waitForServiceWorkerControl = () => {
  if (globalThis.navigator.serviceWorker.controller) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    let timeoutId
    const finish = (isControlled) => {
      globalThis.clearTimeout(timeoutId)
      globalThis.navigator.serviceWorker.removeEventListener("controllerchange", handleControl)
      resolve(isControlled)
    }
    const handleControl = () => finish(true)

    globalThis.navigator.serviceWorker.addEventListener("controllerchange", handleControl)
    timeoutId = globalThis.setTimeout(() => finish(false), 5000)
    if (globalThis.navigator.serviceWorker.controller) {
      finish(true)
    }
  })
}

const warmLoadedRuntimeAssets = async () => {
  if (!import.meta.env.PROD || !("serviceWorker" in globalThis.navigator)) {
    return
  }

  await globalThis.navigator.serviceWorker.ready
  if (!(await waitForServiceWorkerControl())) {
    return
  }

  const assetUrls = new Set(
    globalThis.performance
      .getEntriesByType("resource")
      .map(({ name }) => new URL(name, globalThis.location.href))
      .filter(
        (url) =>
          url.origin === globalThis.location.origin && RUNTIME_ASSET_PATTERN.test(url.pathname),
      )
      .map(({ href }) => href),
  )

  await Promise.allSettled(
    [...assetUrls].map((url) => globalThis.fetch(url, { cache: "force-cache" })),
  )
}

const register = () => {
  createPwaUpdateController({
    registerSW,
    reload: () => globalThis.location.reload(),
    serviceWorker: globalThis.navigator.serviceWorker,
    state: pwaUpdateState,
  })
  void warmLoadedRuntimeAssets().catch(() => null)
}

const registerServiceWorker = () => {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(register, { timeout: 2000 })
  } else {
    setTimeout(register, 1000)
  }
}

if (document.readyState === "complete") {
  registerServiceWorker()
} else {
  globalThis.addEventListener("load", registerServiceWorker, { once: true })
}
