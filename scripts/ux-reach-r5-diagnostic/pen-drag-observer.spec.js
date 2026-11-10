import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

/* eslint-disable import/no-relative-parent-imports -- This file is copied into ux-reach-e2e at runtime. */
import { expect, test } from "#e2e/support/fixtures.js"

const ACTION_NAME = "Mark all as read"
const getAction = (page) => page.getByRole("button", { name: ACTION_NAME })
const getDragHandle = (page) => page.getByTestId("mark-all-read-drag-handle")
const getMutationRequests = async (mock) => {
  const requests = await mock.requests()
  return requests.filter((request) => request.startsWith("PUT /v1/entries"))
}

const delayFramePair = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
  )

test("UX-REACH-R5-DIAGNOSTIC: fine-pointer desktop records CDP pen drag events and geometry", async ({
  openApp,
  mock,
  browser,
}, testInfo) => {
  const candidate = process.env.UX_REACH_R5_CANDIDATE ?? "unknown"
  const outputRoot = process.env.UX_REACH_R5_DIAGNOSTIC_OUTPUT
  assert.ok(outputRoot)
  await mkdir(outputRoot, { recursive: true })

  const { page, errors } = await openApp({ path: "/all", width: 1440, height: 900, touch: false })
  const telemetry = {
    candidate,
    repeatEachIndex: testInfo.repeatEachIndex,
    node: process.version,
    playwright: "1.63.0 (pinned package)",
    chromium: browser.version(),
    viewport: await page.evaluate(() => ({
      innerWidth,
      innerHeight,
      visualViewportWidth: visualViewport?.width,
      visualViewportHeight: visualViewport?.height,
      screenWidth: screen.width,
      screenHeight: screen.height,
      devicePixelRatio,
      anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches,
      pointerFine: matchMedia("(pointer: fine)").matches,
    })),
    cdpCommands: [],
    domEvents: [],
    geometry: [],
    consoleErrors: [],
    pageErrors: errors,
    assertion: {
      source: "unchanged UX-REACH-01 scenario 11 threshold",
      expression: "afterPenDrag.x > afterMouseDrag.x + 24",
    },
  }

  page.on("console", (message) => {
    if (message.type() === "error") {
      telemetry.consoleErrors.push(message.text())
    }
  })
  page.on("pageerror", (error) => telemetry.pageErrors.push(error.message))

  const snapshot = async (label) => {
    const data = await page.evaluate((name) => {
      const describe = (element) => {
        if (!element) {
          return
        }
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          tag: element.tagName,
          id: element.id || undefined,
          className: typeof element.className === "string" ? element.className : undefined,
          role: element.getAttribute("role"),
          testId: element.dataset.testid,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          position: style.position,
          display: style.display,
          pointerEvents: style.pointerEvents,
          zIndex: style.zIndex,
        }
      }
      const root = document.querySelector(".mark-all-read-floating")
      const handle = document.querySelector('[data-testid="mark-all-read-drag-handle"]')
      const trigger = document.querySelector('button[aria-label="Mark all as read"]')
      const rootRect = root?.getBoundingClientRect()
      return {
        label: name,
        viewport: {
          innerWidth,
          innerHeight,
          visualViewportWidth: visualViewport?.width,
          visualViewportHeight: visualViewport?.height,
          devicePixelRatio,
          scrollX,
          scrollY,
        },
        root: describe(root),
        handle: describe(handle),
        trigger: describe(trigger),
        bounds: rootRect
          ? {
              minX: 0,
              maxX: innerWidth - rootRect.width,
              minY: 0,
              maxY: innerHeight - rootRect.height,
            }
          : undefined,
        animations: document.getAnimations().map((animation) => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          targetClass:
            animation.effect?.target instanceof Element
              ? String(animation.effect.target.className)
              : undefined,
        })),
      }
    }, label)
    telemetry.geometry.push(data)
    return data
  }

  await expect(getAction(page)).toBeVisible()
  await expect(page.locator(".mark-all-read-floating")).toHaveCSS("position", "relative")
  await expect(page.locator(".mark-all-read-floating")).not.toHaveClass(
    /mark-all-read-floating--active/,
  )
  await expect(getDragHandle(page)).toBeVisible()
  const floating = page.locator(".mark-all-read-floating")
  const action = getAction(page)
  const handle = getDragHandle(page)
  const initialPosition = await floating.boundingBox()
  const initialHandle = await handle.boundingBox()
  telemetry.initialPosition = initialPosition
  telemetry.initialHandle = initialHandle
  await snapshot("before-mouse")

  try {
    await page.mouse.move(
      initialHandle.x + initialHandle.width / 2,
      initialHandle.y + initialHandle.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      initialHandle.x + initialHandle.width / 2 + 72,
      initialHandle.y + initialHandle.height / 2 - 48,
      { steps: 6 },
    )
    telemetry.mouseEnd = { ...(await action.boundingBox()) }
    await page.mouse.up()
    await expect(floating).toHaveCSS("position", "fixed")
    await expect(floating).toHaveClass(/mark-all-read-floating--active/)
    const afterMouseDrag = await floating.boundingBox()
    telemetry.afterMouseDrag = afterMouseDrag
    await snapshot("after-mouse-drag")

    const penGrip = await handle.boundingBox()
    const penX = penGrip.x + penGrip.width / 2
    const penY = penGrip.y + penGrip.height / 2
    telemetry.gestureStart = { x: penX, y: penY }
    telemetry.gestureEnd = { x: penX + 56, y: penY + 24 }
    const client = await page.context().newCDPSession(page)
    const dispatch = async (payload) => {
      const before = await snapshot(`before-cdp-${payload.type}`)
      const sentAt = Date.now()
      await client.send("Input.dispatchMouseEvent", payload)
      const afterImmediate = await snapshot(`after-immediate-cdp-${payload.type}`)
      await delayFramePair(page)
      const afterFrames = await snapshot(`after-two-frames-cdp-${payload.type}`)
      telemetry.cdpCommands.push({
        sentAt,
        payload,
        resolvedAt: Date.now(),
        beforeGeometryIndex: telemetry.geometry.indexOf(before),
        immediateGeometryIndex: telemetry.geometry.indexOf(afterImmediate),
        frameGeometryIndex: telemetry.geometry.indexOf(afterFrames),
      })
    }

    await page.evaluate(() => {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- This callback runs in the browser document.
      const summarize = (target) => {
        if (!(target instanceof Element)) {
          return
        }
        return {
          tag: target.tagName,
          id: target.id || undefined,
          className: typeof target.className === "string" ? target.className : undefined,
          role: target.getAttribute("role"),
          testId: target.dataset.testid,
        }
      }
      const record = (event, phase) => {
        const target = event.target instanceof Element ? event.target : undefined
        const path = event
          .composedPath()
          .slice(0, 8)
          .map((element) => summarize(element))
        const point =
          typeof event.clientX === "number" && typeof event.clientY === "number"
            ? document.elementFromPoint(event.clientX, event.clientY)
            : undefined
        const capture =
          target &&
          typeof event.pointerId === "number" &&
          typeof target.hasPointerCapture === "function"
            ? target.hasPointerCapture(event.pointerId)
            : undefined
        globalThis.__uxReachR5Events.push({
          wallClockTime: Date.now(),
          time: performance.now(),
          type: event.type,
          phase,
          pointerType: event.pointerType,
          pointerId: event.pointerId,
          button: event.button,
          buttons: event.buttons,
          isPrimary: event.isPrimary,
          clientX: event.clientX,
          clientY: event.clientY,
          target: summarize(target),
          composedPath: path,
          elementFromPoint: summarize(point),
          hasPointerCapture: capture,
          defaultPrevented: event.defaultPrevented,
          cancelable: event.cancelable,
        })
      }
      globalThis.__uxReachR5Events = []
      const types = [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
        "gotpointercapture",
        "lostpointercapture",
        "mousedown",
        "mousemove",
        "mouseup",
        "click",
      ]
      for (const type of types) {
        document.addEventListener(type, (event) => record(event, "capture"), true)
        document.addEventListener(type, (event) => record(event, "bubble"), false)
      }
    })
    await snapshot("before-pen")
    await dispatch({ type: "mouseMoved", x: penX, y: penY, pointerType: "pen" })
    await dispatch({
      type: "mousePressed",
      button: "left",
      buttons: 1,
      x: penX,
      y: penY,
      pointerType: "pen",
    })
    await dispatch({
      type: "mouseMoved",
      buttons: 1,
      x: penX + 56,
      y: penY + 24,
      pointerType: "pen",
    })
    await dispatch({
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      x: penX + 56,
      y: penY + 24,
      pointerType: "pen",
    })
    const afterPenDrag = await floating.boundingBox()
    telemetry.afterPenDrag = afterPenDrag
    telemetry.assertion.actual = afterPenDrag?.x
    telemetry.assertion.expectedGreaterThan = (afterMouseDrag?.x ?? 0) + 24
    telemetry.assertion.passed =
      telemetry.assertion.actual > telemetry.assertion.expectedGreaterThan
    await snapshot("after-pen-immediate")
    await delayFramePair(page)
    telemetry.afterPenTwoFrames = await floating.boundingBox()
    await snapshot("after-pen-two-frames")
    telemetry.domEvents = await page.evaluate(() => globalThis.__uxReachR5Events)
    await client.detach()

    expect(afterPenDrag.x).toBeGreaterThan(afterMouseDrag.x + 24)
    expect(await getMutationRequests(mock)).toHaveLength(0)
    await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  } finally {
    telemetry.mutationRequests = await getMutationRequests(mock)
    await writeFile(
      testInfo.outputPath("telemetry.json"),
      `${JSON.stringify(telemetry, null, 2)}\n`,
    )
    await testInfo.attach("pen-drag-telemetry", {
      path: testInfo.outputPath("telemetry.json"),
      contentType: "application/json",
    })
  }
})
