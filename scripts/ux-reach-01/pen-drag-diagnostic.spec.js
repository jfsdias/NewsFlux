/* eslint-disable import/no-relative-parent-imports -- this file is copied to a temporary root folder to run. */
import { expect, test } from "#e2e/support/fixtures.js"

const dragHandleSelector = '[data-testid="mark-all-read-drag-handle"]'

test("R8-D4D PEN DIAGNOSTIC: fine-pointer drag records pen events and settles at the moved position", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 1440, height: 900 })
  const handle = page.locator(dragHandleSelector)
  const floating = page.locator(".mark-all-read-floating")
  const action = page.getByRole("button", { name: "Mark all as read" })

  await expect(action).toBeVisible()
  await expect(handle).toBeVisible()

  await page.evaluate((selector) => {
    const events = []
    const eventNames = [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ]

    const snapshot = (phase, event, target) => {
      const root = document.querySelector(".mark-all-read-floating")
      const bounds = root?.getBoundingClientRect()
      return {
        phase,
        type: event.type,
        pointerType: event.pointerType,
        pointerId: event.pointerId,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
        clientX: event.clientX,
        clientY: event.clientY,
        targetTestId:
          event.target instanceof Element
            ? (event.target.closest("[data-testid]")?.dataset.testid ?? null)
            : null,
        handleHasPointerCapture: target.hasPointerCapture(event.pointerId),
        floatingX: bounds?.x ?? null,
        floatingY: bounds?.y ?? null,
        timeStamp: event.timeStamp,
      }
    }

    const target = document.querySelector(selector)
    if (!target) {
      throw new Error("Pen diagnostic drag handle is missing")
    }

    globalThis.__newsFluxPenDiagnosticEvents = events
    for (const name of eventNames) {
      globalThis.addEventListener(
        name,
        (event) => {
          events.push(snapshot("capture", event, target))
          queueMicrotask(() => events.push(snapshot("after-handler-microtask", event, target)))
        },
        true,
      )
    }
  }, dragHandleSelector)

  const mouseGrip = await handle.boundingBox()
  await page.mouse.move(mouseGrip.x + mouseGrip.width / 2, mouseGrip.y + mouseGrip.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    mouseGrip.x + mouseGrip.width / 2 + 72,
    mouseGrip.y + mouseGrip.height / 2 - 48,
    {
      steps: 6,
    },
  )
  await page.mouse.up()

  await expect(floating).toHaveCSS("position", "fixed")
  const afterMouseDrag = await floating.boundingBox()
  const penGrip = await handle.boundingBox()
  const penX = penGrip.x + penGrip.width / 2
  const penY = penGrip.y + penGrip.height / 2
  const client = await page.context().newCDPSession(page)
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: penX,
    y: penY,
    pointerType: "pen",
  })
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    x: penX,
    y: penY,
    pointerType: "pen",
  })
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    buttons: 1,
    x: penX + 56,
    y: penY + 24,
    pointerType: "pen",
  })
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    x: penX + 56,
    y: penY + 24,
    pointerType: "pen",
  })

  const sampleStartedAt = Date.now()
  const positionSamples = []
  const capturePosition = async (phase) => {
    const bounds = await floating.boundingBox()
    positionSamples.push({
      phase,
      elapsedMs: Date.now() - sampleStartedAt,
      x: bounds?.x ?? null,
      y: bounds?.y ?? null,
    })
  }

  await capturePosition("immediate-after-dispatch")
  const afterDispatchImmediate = await floating.boundingBox()
  const immediateScreenshot = await page.screenshot()
  await test.info().attach("pen-drag-after-immediate-dispatch.png", {
    body: immediateScreenshot,
    contentType: "image/png",
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await capturePosition("after-two-animation-frames")
  const afterTwoAnimationFrames = await floating.boundingBox()
  const settleDeadline = Date.now() + 1000
  while (
    Date.now() < settleDeadline &&
    (positionSamples.at(-1)?.x ?? -Infinity) <= afterMouseDrag.x + 24
  ) {
    await page.waitForTimeout(16)
    await capturePosition("settling-sample")
  }
  const afterSettled = await floating.boundingBox()
  const settledSample = positionSamples.find((sample) => sample.x > afterMouseDrag.x + 24)
  const settledScreenshot = await page.screenshot()
  await test.info().attach("pen-drag-after-settle-window.png", {
    body: settledScreenshot,
    contentType: "image/png",
  })
  const events = await page.evaluate(() => globalThis.__newsFluxPenDiagnosticEvents)
  const penEvents = events.filter((event) => event.pointerType === "pen")
  const viewportMetadata = await page.evaluate(() => {
    const viewport = globalThis.visualViewport
    return {
      devicePixelRatio: globalThis.devicePixelRatio,
      visualViewport: viewport
        ? {
            width: viewport.width,
            height: viewport.height,
            offsetLeft: viewport.offsetLeft,
            offsetTop: viewport.offsetTop,
            pageLeft: viewport.pageLeft,
            pageTop: viewport.pageTop,
            scale: viewport.scale,
          }
        : null,
    }
  })
  const penDown = penEvents.filter(
    (event) => event.type === "pointerdown" && event.phase === "capture",
  )
  const penMoves = penEvents.filter(
    (event) => event.type === "pointermove" && event.phase === "capture",
  )
  const penUp = penEvents.filter((event) => event.type === "pointerup" && event.phase === "capture")
  const result = {
    viewport: { ...page.viewportSize(), ...viewportMetadata },
    userAgent: await page.evaluate(() => navigator.userAgent),
    browserVersion: page.context().browser().version(),
    initialPenPoint: { x: penX, y: penY },
    afterMouseDrag: { x: afterMouseDrag.x, y: afterMouseDrag.y },
    afterDispatchImmediate: { x: afterDispatchImmediate.x, y: afterDispatchImmediate.y },
    afterTwoAnimationFrames: { x: afterTwoAnimationFrames.x, y: afterTwoAnimationFrames.y },
    afterSettled: { x: afterSettled.x, y: afterSettled.y },
    settleDelayMs: settledSample?.elapsedMs ?? null,
    positionSamples,
    penDownCount: penDown.length,
    penMoveCount: penMoves.length,
    penUpCount: penUp.length,
    penPointerIds: [...new Set(penEvents.map((event) => event.pointerId))],
    penMoveCaptureObserved: penMoves.some((event) => event.handleHasPointerCapture),
    events,
    mutations: await mock.mutations(),
  }

  await test.info().attach("pen-pointer-event-diagnostic.json", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  })
  console.log(`R8D4D_PEN_DIAGNOSTIC=${JSON.stringify(result)}`)
  await client.detach()

  expect(penDown).toHaveLength(1)
  expect(penMoves.length).toBeGreaterThan(0)
  expect(penUp).toHaveLength(1)
  expect(new Set(penEvents.map((event) => event.pointerId)).size).toBe(1)
  expect(result.penMoveCaptureObserved).toBe(true)
  expect(result.afterSettled.x).toBeGreaterThan(afterMouseDrag.x + 24)
  expect(result.mutations).toHaveLength(0)
})
