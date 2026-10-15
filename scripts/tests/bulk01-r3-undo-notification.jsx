import { Notification } from "@arco-design/web-react"
import React from "react"
import { createRoot } from "react-dom/client"
import "@arco-design/web-react/dist/css/arco.css"

import {
  createTimedOneShotActionStore,
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  MARK_ALL_READ_UNDO_NOTIFICATION_ID,
} from "@/utils/mark-all-read-undo"

const actions = createTimedOneShotActionStore()
const output = document.createElement("pre")
output.dataset.testid = "bulk01-r3-results"
output.style.cssText = "white-space:pre-wrap;font:14px ui-monospace,monospace;margin:24px"
document.body.append(output)

let running = false
const wait = (milliseconds) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

function log(line) {
  output.textContent += `${new Date().toISOString().slice(11, 23)} ${line}\n`
}

function visibleNotices() {
  return [...document.querySelectorAll('.arco-notification-wrapper [role="alert"]')]
    .filter((notice) => {
      const style = globalThis.getComputedStyle(notice)
      return (
        notice.getBoundingClientRect().width > 0 &&
        style.display !== "none" &&
        style.opacity !== "0"
      )
    })
    .map((notice) => notice.textContent.trim())
}

function beginNotice({ idForToken = () => MARK_ALL_READ_UNDO_NOTIFICATION_ID, title }) {
  let token
  let resolveClosed
  const closed = new Promise((resolve) => {
    resolveClosed = resolve
  })
  token = actions.replace(
    { title },
    {
      durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
      onExpire: () => Notification.remove(idForToken(token)),
    },
  )
  const id = idForToken(token)
  Notification.success({
    id,
    title,
    duration: MARK_ALL_READ_UNDO_DURATION_MS,
    onClose: () => {
      actions.clear(token)
      resolveClosed()
    },
  })
  return { closed, id, token }
}

async function withRun(run) {
  if (running) {
    return
  }
  running = true
  for (const button of document.querySelectorAll("button")) {
    button.disabled = true
  }
  output.textContent = ""
  try {
    await run()
  } catch (error) {
    log(`ERROR=${error?.stack || error}`)
  } finally {
    running = false
    for (const button of document.querySelectorAll("button")) {
      button.disabled = false
    }
  }
}

async function runFixedIdFailure() {
  const id = MARK_ALL_READ_UNDO_NOTIFICATION_ID
  const first = beginNotice({ idForToken: () => id, title: "same ID / cycle 1" })
  log("CYCLE_1=started with real Arco static Notification; wait for its natural 8-second expiry")
  await first.closed
  await wait(350)
  log(`CYCLE_1_CLOSED=${visibleNotices().length === 0}`)

  actions.clear()
  Notification.remove(id)
  const second = beginNotice({ idForToken: () => id, title: "same ID / cycle 2" })
  await wait(750)
  log(
    `SAME_ID_SECOND_VISUAL=${visibleNotices().some((text) => text.includes("cycle 2")) ? "FAIL_EARLY_CLOSE" : "MISSING"}`,
  )
  log(`SAME_ID_SECOND_TOKEN=${actions.getCurrentToken() === second.token ? "ACTIVE" : "CLEARED"}`)
}

async function runUniqueIdControl() {
  const firstId = MARK_ALL_READ_UNDO_NOTIFICATION_ID
  const first = beginNotice({ idForToken: () => firstId, title: "unique ID / cycle 1" })
  await first.closed
  await wait(350)

  actions.clear()
  Notification.remove(firstId)
  const secondId = `${MARK_ALL_READ_UNDO_NOTIFICATION_ID}-control-2`
  const second = beginNotice({ idForToken: () => secondId, title: "unique ID / cycle 2" })
  await wait(750)
  log(
    `UNIQUE_ID_SECOND_VISUAL=${visibleNotices().some((text) => text.includes("cycle 2")) ? "SURVIVES" : "FAIL"}`,
  )
  log(`UNIQUE_ID_SECOND_TOKEN=${actions.getCurrentToken() === second.token ? "ACTIVE" : "CLEARED"}`)
}

async function runSettledSameIdControl() {
  const id = MARK_ALL_READ_UNDO_NOTIFICATION_ID
  const first = beginNotice({ idForToken: () => id, title: "settled ID / cycle 1" })
  await first.closed
  await wait(350)

  actions.clear()
  Notification.remove(id)
  await wait(550)
  const second = beginNotice({ idForToken: () => id, title: "settled ID / cycle 2" })
  await wait(750)
  log(
    `SAME_ID_AFTER_SETTLE_VISUAL=${visibleNotices().some((text) => text.includes("cycle 2")) ? "SURVIVES" : "FAIL"}`,
  )
  log(
    `SAME_ID_AFTER_SETTLE_TOKEN=${actions.getCurrentToken() === second.token ? "ACTIVE" : "CLEARED"}`,
  )
}

async function runGenerationScopedFlow() {
  for (const cycle of [1, 2, 3]) {
    const previousToken = actions.getCurrentToken()
    actions.clear()
    if (previousToken !== null) {
      Notification.remove(getMarkAllReadUndoNotificationId(previousToken))
    }

    const title = `generation / cycle ${cycle}`
    const notice = beginNotice({ idForToken: getMarkAllReadUndoNotificationId, title })
    await wait(MARK_ALL_READ_UNDO_DURATION_MS - 100)
    const visible = visibleNotices().some((text) => text.includes(`cycle ${cycle}`))
    const tokenActive = actions.getCurrentToken() === notice.token
    log(`CYCLE_${cycle}_VISUAL_AT_7_9S=${visible ? "PASS" : "FAIL"}`)
    log(`CYCLE_${cycle}_TOKEN_AT_7_9S=${tokenActive ? "PASS" : "FAIL"}`)
    await notice.closed
    await wait(350)
  }
}

function App() {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1>BULK-01 R3 — Arco static Notification lifecycle</h1>
      <p>
        Manual regression page using the installed Arco 2.66.16 Notification API. Reload before each
        control so cycle 1 starts on a fresh page.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <button data-testid="run-fixed-id" onClick={() => void withRun(runFixedIdFailure)}>
          Run same-ID failure control
        </button>
        <button data-testid="run-unique-id" onClick={() => void withRun(runUniqueIdControl)}>
          Run unique-ID control
        </button>
        <button data-testid="run-settled-id" onClick={() => void withRun(runSettledSameIdControl)}>
          Run same-ID-after-settle control
        </button>
        <button
          data-testid="run-generation-flow"
          onClick={() => void withRun(runGenerationScopedFlow)}
        >
          Run generation-scoped 3-cycle flow
        </button>
      </div>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<App />)
