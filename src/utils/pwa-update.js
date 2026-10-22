// User-controlled service worker updates (PWA-03A1, decision D6: USER_CONTROLLED_UPDATE_PROMPT).
//
// A new worker waits; the page only learns that an update is ready. Activation and the reload that
// follows happen after accept(), never on their own, so a reading session keeps its scroll position
// and transient state until the user chooses to switch builds.
const resolveImmediately = () => Promise.resolve()

const createPwaUpdateController = ({ registerSW, reload, serviceWorker, state }) => {
  let updateServiceWorker = resolveImmediately
  let isAccepted = false
  let hasReloaded = false

  const setAvailable = (available) => {
    if (state.get().available !== available) {
      state.set({ ...state.get(), available })
    }
  }

  const reloadOnce = () => {
    if (!hasReloaded) {
      hasReloaded = true
      reload()
    }
  }

  const accept = async () => {
    if (isAccepted) {
      return
    }
    isAccepted = true

    // The register code reports a takeover as an update only when the page was already controlled at
    // load, which a first-visit page never is. The browser's own signal is what the reload waits for.
    serviceWorker?.addEventListener("controllerchange", reloadOnce, { once: true })

    const registration = await serviceWorker?.getRegistration().catch(() => null)

    // Another window already activated the worker, so there is nothing left to activate here.
    if (registration && !registration.waiting) {
      reloadOnce()
      return
    }

    updateServiceWorker(true)
  }

  const dismiss = () => setAvailable(false)

  state.set({ available: false, accept, dismiss })

  updateServiceWorker = registerSW({
    immediate: false,
    onNeedRefresh: () => setAvailable(true),
    // Fired when a new worker takes control. Without this handler the generated register code
    // reloads the page by itself.
    onNeedReload: () => {
      if (isAccepted) {
        reloadOnce()
        return
      }

      setAvailable(true)
    },
  })
}

export default createPwaUpdateController
