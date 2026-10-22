/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React from "react"
import { createRoot } from "react-dom/client"

import AppNotifications from "@/AppNotifications"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import pwaUpdateState from "@/store/pwaUpdateState"
import createPwaUpdateController from "@/utils/pwa-update"

import "@/index.css"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

// A stand-in service worker: it records what the app asks for and fires the events the browser would.
const calls = { reload: 0, updateServiceWorker: 0 }
const noop = () => {}
const wait = (milliseconds) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))
const resolveWithWaitingWorker = () => Promise.resolve({ waiting: {} })
const requestActivation = () => {
  calls.updateServiceWorker += 1
  return Promise.resolve()
}

let registerOptions = null
const controllerChangeListeners = new Set()
const fakeServiceWorker = {
  addEventListener: (type, listener) => {
    if (type === "controllerchange") {
      controllerChangeListeners.add(listener)
    }
  },
  removeEventListener: noop,
  getRegistration: resolveWithWaitingWorker,
}

createPwaUpdateController({
  registerSW: (options) => {
    registerOptions = options
    return requestActivation
  },
  reload: () => {
    calls.reload += 1
  },
  serviceWorker: fakeServiceWorker,
  state: pwaUpdateState,
})

const readerControlId = "reader-control"

const Harness = () => (
  <>
    <main>
      <h1>PWA-03A1 update notice browser gate</h1>
      <button id={readerControlId} type="button">
        Reader control
      </button>
    </main>
    <AppNotifications />
    <div aria-live="polite" data-testid="pwa-update-notice-summary" id="pwa-update-notice-summary">
      RUNNING
    </div>
  </>
)

createRoot(document.querySelector("#root")).render(<Harness />)

const visibleNotices = () =>
  [...document.querySelectorAll('.arco-notification-wrapper [role="alert"]')].filter((notice) => {
    const style = globalThis.getComputedStyle(notice)
    return (
      notice.getBoundingClientRect().width > 0 && style.display !== "none" && style.opacity !== "0"
    )
  })

const waitFor = async (predicate, timeoutMs = 2500) => {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await wait(50)
  }
  return predicate()
}

const findButton = (label) =>
  [...document.querySelectorAll(".arco-notification button")].find(
    (button) => button.textContent.trim() === label,
  )

const PASS = "PASS"
const FAIL = "FAIL"
const verdict = (condition) => (condition ? PASS : FAIL)

const run = async () => {
  const gates = {}
  await wait(300)
  const readerControl = document.querySelector(`#${readerControlId}`)

  gates.PWA_CURRENT_BUILD_FIRST_LOAD = verdict(
    visibleNotices().length === 0 && calls.reload === 0 && calls.updateServiceWorker === 0,
  )

  // A new worker is waiting: a notice appears, and nothing else happens.
  readerControl.focus()
  registerOptions.onNeedRefresh()
  const appeared = await waitFor(() => visibleNotices().length === 1)
  const notice = visibleNotices()[0]
  gates.PWA_UPDATE_PROMPT_VISIBLE = verdict(
    appeared &&
      notice.textContent.includes(phrases.app.update_ready_title) &&
      Boolean(findButton(phrases.actions.update_now)) &&
      Boolean(findButton(phrases.actions.dismiss)),
  )
  gates.PWA_UPDATE_NO_AUTOMATIC_RELOAD = verdict(
    calls.reload === 0 && calls.updateServiceWorker === 0,
  )
  gates.PWA_UPDATE_A11Y_NO_FOCUS_STEAL = verdict(
    document.activeElement === readerControl &&
      !document.querySelector('[aria-modal="true"], .arco-modal'),
  )
  const buttons = [...document.querySelectorAll(".arco-notification button")]
  gates.PWA_UPDATE_A11Y_KEYBOARD_OPERABLE = verdict(
    buttons.length === 2 &&
      buttons.every(
        (button) =>
          !button.disabled && button.tabIndex >= 0 && button.getBoundingClientRect().height >= 44,
      ),
  )
  const wrapperPosition = document
    .querySelector(".arco-notification-wrapper")
    ?.className.match(/arco-notification-wrapper-(\w+)/)?.[1]
  // At or below 768 px index.css places notices under the mobile controls; above it they sit at the
  // bottom so the reader and list toolbars stay uncovered.
  gates.PWA_UPDATE_NOTICE_POSITION = verdict(
    wrapperPosition === (globalThis.innerWidth <= 768 ? "topRight" : "bottomRight"),
  )

  // Repeated signals for the same update keep one notice.
  registerOptions.onNeedRefresh()
  registerOptions.onNeedRefresh()
  registerOptions.onNeedRefresh()
  await wait(500)
  gates.PWA_UPDATE_NO_DUPLICATE_NOTICE = verdict(visibleNotices().length === 1)

  // Dismiss: the notice goes, and nothing is activated or reloaded.
  findButton(phrases.actions.dismiss).click()
  const dismissed = await waitFor(() => visibleNotices().length === 0)
  gates.PWA_UPDATE_DISMISS_OR_DEFER = verdict(
    dismissed && calls.reload === 0 && calls.updateServiceWorker === 0,
  )

  // Another update arrives later: the notice returns.
  registerOptions.onNeedRefresh()
  const returned = await waitFor(() => visibleNotices().length === 1)

  // Accept: the worker is asked to activate, and the page reloads only once it takes control.
  findButton(phrases.actions.update_now).click()
  await wait(300)
  const activationRequested = calls.updateServiceWorker === 1 && calls.reload === 0
  for (const listener of controllerChangeListeners) {
    listener()
  }
  gates.PWA_UPDATE_USER_ACCEPT_ACTIVATES = verdict(
    returned && activationRequested && calls.reload === 1,
  )

  const summary = document.querySelector("#pwa-update-notice-summary")
  for (const [name, result] of Object.entries(gates)) {
    const gate = document.createElement("output")
    gate.dataset.testid = name.toLowerCase().replaceAll("_", "-")
    gate.textContent = `${name}=${result}`
    summary.append(gate)
  }
  summary.firstChild.textContent = Object.values(gates).every((result) => result === PASS)
    ? PASS
    : FAIL
  globalThis.__pwaUpdateNoticeReport = { gates, wrapperPosition, width: globalThis.innerWidth }
}

try {
  await run()
} catch (error) {
  document.querySelector("#pwa-update-notice-summary").firstChild.textContent = `FAIL ${error}`
}
