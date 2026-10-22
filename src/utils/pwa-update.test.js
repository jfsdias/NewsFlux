import assert from "node:assert/strict"
import test from "node:test"

import { atom } from "nanostores"

// eslint-disable-next-line import/extensions -- Node's native ESM test runner requires explicit extensions.
import createPwaUpdateController from "./pwa-update.js"

// Stand-ins for virtual:pwa-register and navigator.serviceWorker. They record what the app asks for
// and let a test fire the events the browser and vite-plugin-pwa would fire. Nothing reloads by itself.
const createHarness = ({ hasWaitingWorker = true } = {}) => {
  const calls = { register: 0, updateServiceWorker: [], reload: 0 }
  let options = null
  const controllerChangeListeners = new Set()

  const registerSW = (registerOptions) => {
    calls.register += 1
    options = registerOptions
    return (...args) => {
      calls.updateServiceWorker.push(args)
      return Promise.resolve()
    }
  }
  const registration = { waiting: hasWaitingWorker ? {} : null }
  const serviceWorker = {
    addEventListener: (type, listener) => {
      if (type === "controllerchange") {
        controllerChangeListeners.add(listener)
      }
    },
    removeEventListener: (type, listener) => {
      if (type === "controllerchange") {
        controllerChangeListeners.delete(listener)
      }
    },
    getRegistration: () => Promise.resolve(registration),
  }
  const state = atom({ available: false })
  const reload = () => {
    calls.reload += 1
  }
  createPwaUpdateController({ registerSW, reload, serviceWorker, state })

  return {
    calls,
    state,
    accept: () => state.get().accept(),
    dismiss: () => state.get().dismiss(),
    fireControllerChange: () => {
      for (const listener of controllerChangeListeners) {
        listener()
      }
    },
    fireNeedRefresh: () => options.onNeedRefresh(),
    fireNeedReload: () => options.onNeedReload(),
    options: () => options,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test("PWA_CURRENT_BUILD_FIRST_LOAD registers without a notice or a reload", () => {
  const harness = createHarness()

  assert.equal(harness.calls.register, 1)
  assert.equal(harness.state.get().available, false)
  assert.equal(harness.calls.reload, 0)
  assert.equal(harness.calls.updateServiceWorker.length, 0)
})

test("PWA_CURRENT_BUILD_FIRST_LOAD the first worker claiming the page is not an update", () => {
  const harness = createHarness()

  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 0)
  assert.equal(harness.state.get().available, false)
})

test("PWA_UPDATE_NO_AUTOMATIC_RELOAD a waiting worker only raises the notice", () => {
  const harness = createHarness()

  harness.fireNeedRefresh()

  assert.equal(harness.state.get().available, true)
  assert.equal(harness.calls.reload, 0)
  assert.equal(harness.calls.updateServiceWorker.length, 0, "the worker must not be activated yet")
})

test("PWA_UPDATE_NO_AUTOMATIC_RELOAD registration hands the reload decision to the app", () => {
  const { options } = createHarness()

  assert.equal(typeof options().onNeedRefresh, "function")
  assert.equal(
    typeof options().onNeedReload,
    "function",
    "without onNeedReload the generated register code reloads the page on its own",
  )
})

test("PWA_UPDATE_NO_DUPLICATE_NOTICE repeated signals for one update keep a single pending update", () => {
  const harness = createHarness()
  let notifications = 0
  harness.state.listen(() => {
    notifications += 1
  })

  harness.fireNeedRefresh()
  harness.fireNeedRefresh()
  harness.fireNeedRefresh()

  assert.equal(harness.state.get().available, true)
  assert.equal(notifications, 1, "subscribers hear about the pending update once")
})

test("PWA_UPDATE_USER_ACCEPT_ACTIVATES accepting asks the worker to activate and reloads only after it takes control", async () => {
  const harness = createHarness()
  harness.fireNeedRefresh()

  await harness.accept()

  assert.equal(harness.calls.updateServiceWorker.length, 1)
  assert.equal(harness.calls.reload, 0, "no reload before the new worker controls the page")

  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 1)
})

test("PWA_UPDATE_USER_ACCEPT_ACTIVATES the reload does not depend on the register code reporting the takeover", async () => {
  // workbox-window only reports a takeover as an update when the page was already controlled at load.
  // A page opened on the very first visit never is, so the controller must watch the browser itself.
  const harness = createHarness()
  harness.fireNeedRefresh()

  await harness.accept()
  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 1)
})

test("PWA_UPDATE_USER_ACCEPT_ACTIVATES both takeover signals reload the page once", async () => {
  const harness = createHarness()
  harness.fireNeedRefresh()
  await harness.accept()

  harness.fireControllerChange()
  harness.fireNeedReload()
  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 1)
})

test("PWA_UPDATE_USER_ACCEPT_ACTIVATES a second click does not activate twice", async () => {
  const harness = createHarness()
  harness.fireNeedRefresh()

  await harness.accept()
  await harness.accept()

  assert.equal(harness.calls.updateServiceWorker.length, 1)
})

test("PWA_UPDATE_DISMISS_OR_DEFER dismissing hides the notice and never activates or reloads", async () => {
  const harness = createHarness()
  harness.fireNeedRefresh()

  harness.dismiss()
  await flush()

  assert.equal(harness.state.get().available, false)
  assert.equal(harness.calls.reload, 0)
  assert.equal(harness.calls.updateServiceWorker.length, 0)
})

test("PWA_UPDATE_DISMISS_OR_DEFER a takeover after a dismissal still does not reload the page", () => {
  const harness = createHarness()
  harness.fireNeedRefresh()
  harness.dismiss()

  harness.fireNeedReload()
  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 0)
})

test("PWA_UPDATE_DISMISS_OR_DEFER a newer update after a dismissal raises the notice again", () => {
  const harness = createHarness()
  harness.fireNeedRefresh()
  harness.dismiss()

  harness.fireNeedRefresh()

  assert.equal(harness.state.get().available, true)
  assert.equal(harness.calls.reload, 0)
})

test("PWA_UPDATE_NO_AUTOMATIC_RELOAD a worker that took control without this page asking does not reload it", () => {
  const harness = createHarness()
  harness.fireNeedRefresh()

  // Another window accepted the update; this page keeps running the old build.
  harness.fireNeedReload()
  harness.fireControllerChange()

  assert.equal(harness.calls.reload, 0)
  assert.equal(harness.state.get().available, true, "the user is told this page is out of date")
})

test("PWA_UPDATE_USER_ACCEPT_ACTIVATES with no worker left waiting, accepting reloads straight away", async () => {
  // Another window already activated the worker, so there is nothing to activate here.
  const harness = createHarness({ hasWaitingWorker: false })
  harness.fireNeedRefresh()

  await harness.accept()

  assert.equal(harness.calls.reload, 1)
  assert.equal(harness.calls.updateServiceWorker.length, 0)
})
