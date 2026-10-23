import { installPwaChunkRecovery } from "/src/utils/pwa-chunk-recovery.js"

const backgroundFocusOrigin = document.querySelector("#background-focus-origin")
const backgroundRestorer = document.querySelector("#background-restorer")
const openRecovery = document.querySelector("#open-recovery")
const receipt = document.querySelector("#receipt")

let preloadEventPrevented = false
let primaryFocusedImmediately = false
let asyncFocusRestoreAttempted = false

const controller = installPwaChunkRecovery({
  windowObject: globalThis,
  documentObject: document,
  navigatorObject: { serviceWorker: { getRegistrations: async () => [] } },
  cacheStorage: { keys: async () => [] },
  fetchImpl: async () =>
    new Response("Unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    }),
  basePath: "/",
})

const getRecovery = () => {
  const overlay = document.querySelector("[data-newsflux-chunk-recovery]")
  const dialog = overlay?.querySelector('[role="alertdialog"]')
  const actions = [...(dialog?.querySelectorAll("button") ?? [])].filter(
    (button) => !button.hidden && !button.disabled,
  )

  return { overlay, dialog, actions }
}

const getState = () => {
  const { overlay, dialog, actions } = getRecovery()
  const { activeElement } = document

  return {
    preloadEventPrevented,
    backgroundFocusedBeforeTrigger: backgroundFocusOrigin.dataset.focusedBeforeTrigger === "true",
    primaryFocusedImmediately,
    asyncFocusRestoreAttempted,
    recoveryVisible: Boolean(overlay?.isConnected),
    activeElementId:
      activeElement?.id || activeElement?.textContent?.trim() || activeElement?.tagName,
    activeElementInsideRecovery: Boolean(dialog?.contains(activeElement)),
    primaryActionFocused: activeElement === actions[0],
    visibleActionLabels: actions.map((button) => button.textContent.trim()),
    retryVisible: Boolean(actions.some((button) => button.textContent.trim() === "Try again")),
    alertDialog: dialog?.getAttribute("role") === "alertdialog",
    ariaModal: dialog?.getAttribute("aria-modal") === "true",
    labelledBy: dialog?.getAttribute("aria-labelledby"),
    describedBy: dialog?.getAttribute("aria-describedby"),
    backgroundInert: document.querySelector("#background-controls").inert,
  }
}

const render = () => {
  receipt.textContent = JSON.stringify(getState(), null, 2)
}

openRecovery.addEventListener("click", () => {
  backgroundFocusOrigin.focus()
  backgroundFocusOrigin.dataset.focusedBeforeTrigger = String(
    document.activeElement === backgroundFocusOrigin,
  )

  const event = new Event("vite:preloadError", { cancelable: true })
  globalThis.dispatchEvent(event)
  preloadEventPrevented = event.defaultPrevented

  const { actions } = getRecovery()
  primaryFocusedImmediately = document.activeElement === actions[0]
  render()

  setTimeout(() => {
    asyncFocusRestoreAttempted = true
    backgroundRestorer.focus()
    render()
  }, 0)
})

document.addEventListener("focusin", render)
document.addEventListener("keydown", () => setTimeout(render, 0))

globalThis.__pwaRecoveryFocusHarness = {
  getState,
  async tryRecoveryAction(label = "Reload NewsFlux") {
    const { dialog } = getRecovery()
    const button = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (action) => action.textContent.trim() === label,
    )
    button?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    render()
    return getState()
  },
  focusBackground() {
    backgroundRestorer.focus()
    render()
    return getState()
  },
  dispose() {
    controller.dispose()
    render()
    return {
      overlayRemoved: !document.querySelector("[data-newsflux-chunk-recovery]"),
      backgroundInert: document.querySelector("#background-controls").inert,
    }
  },
}

render()
