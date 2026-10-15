import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import test from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (
        !/[.][a-z0-9]+$/i.test(specifier) &&
        (specifier.startsWith(".") || specifier.includes("/"))
      ) {
        let resolutionError = error
        for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
          try {
            return nextResolve(candidate, context)
          } catch (candidateError) {
            resolutionError = candidateError
          }
        }
        throw resolutionError
      }
      throw error
    }
  },
})

const { default: ArcoNotification } = await import(
  new URL("../../node_modules/@arco-design/web-react/es/Notification/index.js", import.meta.url)
)
const {
  createTimedOneShotActionStore,
  MARK_ALL_READ_UNDO_DURATION_MS,
  getMarkAllReadUndoNotificationId,
} = await import(new URL("mark-all-read-undo.js", import.meta.url))

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const createFakeClock = () => {
  let currentTime = 0
  let nextTimerId = 0
  const timers = new Map()

  return {
    advance(milliseconds) {
      const targetTime = currentTime + milliseconds
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.expiresAt <= targetTime)
          .toSorted(([, left], [, right]) => left.expiresAt - right.expiresAt)[0]
        if (!next) {
          break
        }
        const [timerId, timer] = next
        timers.delete(timerId)
        currentTime = timer.expiresAt
        timer.callback()
      }
      currentTime = targetTime
    },
    clearTimer(timerId) {
      timers.delete(timerId)
    },
    now: () => currentTime,
    setTimer(callback, milliseconds) {
      const timerId = ++nextTimerId
      timers.set(timerId, { callback, expiresAt: currentTime + milliseconds })
      return timerId
    },
  }
}

const createArcoClassAdapter = () => {
  const instance = new ArcoNotification({})
  instance.state = { notices: [], position: "topRight" }
  instance.setState = (nextState, callback) => {
    const update =
      typeof nextState === "function" ? nextState(instance.state, instance.props) : nextState
    instance.state = { ...instance.state, ...update }
    callback?.()
  }
  let staticInstanceCreated = false

  return {
    add(notice) {
      staticInstanceCreated = true
      instance.add(notice)
    },
    has(id) {
      return instance.state.notices.some((notice) => notice.id === id)
    },
    ids() {
      return instance.state.notices.map((notice) => notice.id)
    },
    notices() {
      return instance.state.notices
    },
    remove(id) {
      // Arco's static API has no instance on the first call, then delegates to
      // this real Notification instance for all later calls in the page.
      if (staticInstanceCreated) {
        instance.remove(id)
      }
    },
  }
}

test("first, second, and third Undo notices each survive the full 8-second lifetime", async () => {
  const clock = createFakeClock()
  const actions = createTimedOneShotActionStore(clock)
  const arco = createArcoClassAdapter()
  let activeToken = null

  const currentGenerationFlow = (title) => {
    const previousToken = actions.getCurrentToken()
    actions.clear()
    activeToken = null
    if (previousToken !== null) {
      arco.remove(getMarkAllReadUndoNotificationId(previousToken))
    }
    let token
    token = actions.replace(
      { title },
      {
        durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
        onExpire: () => {
          activeToken = null
          arco.remove(getMarkAllReadUndoNotificationId(token))
        },
      },
    )
    activeToken = token
    const notice = {
      id: getMarkAllReadUndoNotificationId(token),
      onClose: () => {
        actions.clear(token)
        if (activeToken === token) {
          activeToken = null
        }
      },
      title,
    }
    arco.add(notice)
    return { notice, token }
  }

  for (const cycle of [1, 2, 3]) {
    const current = currentGenerationFlow(`cycle ${cycle}`)
    clock.advance(MARK_ALL_READ_UNDO_DURATION_MS - 1)
    assert.equal(
      activeToken,
      current.token,
      `cycle ${cycle} action token stays active before expiry`,
    )
    assert.equal(
      arco.has(current.notice.id),
      true,
      `cycle ${cycle} notice stays visible before expiry`,
    )

    clock.advance(1)
    await wait(550) // Arco's 200 ms removal plus its 300 ms exit transition.
    current.notice.onClose() // The render path calls this from TransitionGroup.onExited.
    assert.equal(arco.has(current.notice.id), false, `cycle ${cycle} notice closes at expiry`)
    assert.equal(activeToken, null, `cycle ${cycle} action token expires`)
  }
})

test("a previous generation's delayed remove and close cannot affect the new generation", async () => {
  const clock = createFakeClock()
  const actions = createTimedOneShotActionStore(clock)
  const arco = createArcoClassAdapter()
  const firstToken = actions.replace({ title: "old" })
  const firstId = getMarkAllReadUndoNotificationId(firstToken)
  const oldNotice = {
    id: firstId,
    onClose: () => actions.clear(firstToken),
    title: "old",
  }
  arco.add(oldNotice)

  const previousToken = actions.getCurrentToken()
  actions.clear()
  arco.remove(getMarkAllReadUndoNotificationId(previousToken))
  const currentToken = actions.replace({ title: "new" })
  const currentId = getMarkAllReadUndoNotificationId(currentToken)
  const currentNotice = { id: currentId, onClose: () => actions.clear(currentToken), title: "new" }
  arco.add(currentNotice)

  assert.notEqual(firstId, currentId)
  assert.equal(
    arco.ids().length,
    2,
    "the old notice is only present while its opacity-zero exit settles",
  )
  assert.equal(arco.ids().includes(firstId), true)
  assert.equal(arco.ids().includes(currentId), true)
  assert.equal(arco.notices().find((notice) => notice.id === firstId).style.opacity, 0)
  assert.equal(actions.getCurrentToken(), currentToken, "only the new action remains active")

  await wait(250)
  assert.deepEqual(arco.ids(), [currentId], "the old delayed remove only targets the old ID")
  await wait(300)
  oldNotice.onClose()
  assert.equal(
    actions.getCurrentToken(),
    currentToken,
    "the old onClose callback cannot clear the new token",
  )
  assert.equal(arco.has(currentId), true, "the old transition cannot hide the new notice")
})

test("Arco control cases isolate ID reuse from delayed-removal timing", async () => {
  const sameId = createArcoClassAdapter()
  sameId.add({ id: "X", title: "old" })
  sameId.remove("X")
  sameId.add({ id: "X", title: "replacement" })
  await wait(250)
  assert.equal(sameId.has("X"), false, "same ID is removed by the pending Arco callback")

  const uniqueId = createArcoClassAdapter()
  uniqueId.add({ id: "X1", title: "old" })
  uniqueId.remove("X1")
  uniqueId.add({ id: "X2", title: "replacement" })
  await wait(250)
  assert.equal(uniqueId.has("X2"), true, "a unique generation ID survives the old remove")

  const settledId = createArcoClassAdapter()
  settledId.add({ id: "X", title: "old" })
  settledId.remove("X")
  await wait(550)
  settledId.add({ id: "X", title: "replacement" })
  await wait(250)
  assert.equal(settledId.has("X"), true, "same ID works after the old removal has settled")
})
