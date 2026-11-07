/* eslint-disable import/extensions, import/no-relative-parent-imports -- Resolve the shared fixture under Node ESM without joining its frozen scenario inventory. */
import { expect, test } from "#e2e/support/fixtures.js"

const ACTION_NAME = "Mark all as read"
const getAction = (page) => page.getByRole("button", { name: ACTION_NAME })
const getDragHandle = (page) => page.getByTestId("mark-all-read-drag-handle")
const getMutationRequests = async (mock) => {
  const requests = await mock.requests()
  return requests.filter((request) => request.startsWith("PUT /v1/entries"))
}

const COARSE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 449, height: 682 },
  { width: 466, height: 844 },
  { width: 597, height: 880 },
  { width: 704, height: 869 },
  { width: 768, height: 1024 },
  { width: 769, height: 1024 },
  { width: 884, height: 1104 },
  { width: 884, height: 1107 },
  { width: 939, height: 1271 },
  { width: 992, height: 1200 },
  { width: 993, height: 1200 },
  { width: 1024, height: 768 },
  { width: 1114, height: 720 },
  { width: 1119, height: 611 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
]

test("UX-REACH-01: coarse-pointer control stays reachable without blocking article hits or navigation", async ({
  openApp,
  mock,
}) => {
  for (const { width, height } of COARSE_VIEWPORTS) {
    const { page } = await openApp({ path: "/all", width, height, touch: true })
    const action = getAction(page)
    await expect(action).toBeVisible()
    await expect(page.locator('button[aria-label="Mark all as read"]')).toHaveCount(1)

    const pointerState = await page.evaluate(() => ({
      innerWidth: globalThis.innerWidth,
      innerHeight: globalThis.innerHeight,
      visualViewportWidth: globalThis.visualViewport?.width,
      visualViewportHeight: globalThis.visualViewport?.height,
      anyPointerCoarse: globalThis.matchMedia("(any-pointer: coarse)").matches,
      floatingMode: document
        .querySelector(".mark-all-read-floating")
        ?.classList.contains("mark-all-read-floating--active"),
    }))
    expect(pointerState.innerWidth).toBe(width)
    expect(pointerState.visualViewportWidth).toBe(width)
    expect(pointerState.anyPointerCoarse).toBe(true)
    expect(pointerState.floatingMode, `unused preference stays docked at ${width}x${height}`).toBe(
      false,
    )

    await expect(getDragHandle(page)).toBeVisible()

    const floating = page.locator(".mark-all-read-floating")
    await expect(floating).toHaveCSS("position", "relative")
    const bounds = await floating.boundingBox()
    const navBounds = await page
      .locator(".compact-nav-bar, .medium-navigation-rail, .desktop-sidebar-slot .sidebar")
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { bottom, left, right, top } = element.getBoundingClientRect()
          return { bottom, left, right, top, width: element.getBoundingClientRect().width }
        }),
      )

    expect(bounds).not.toBeNull()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height)
    expect(bounds.width).toBeGreaterThanOrEqual(48)
    expect(bounds.height).toBeGreaterThanOrEqual(48)

    const articleHitRemainsAvailable = await page.evaluate((floatingBounds) => {
      const articles = [...document.querySelectorAll(".article-entry")]
      const target = articles.find((article) => {
        const rect = article.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const overlapsFloating =
          x >= floatingBounds.x &&
          x <= floatingBounds.x + floatingBounds.width &&
          y >= floatingBounds.y &&
          y <= floatingBounds.y + floatingBounds.height
        return rect.width > 0 && rect.height > 0 && !overlapsFloating
      })
      if (!target) {
        return false
      }

      const rect = target.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(hit?.closest(".article-entry"))
    }, bounds)
    expect(articleHitRemainsAvailable).toBe(true)

    for (const nav of navBounds.filter(({ width }) => width > 0)) {
      const intersectsNavigation =
        bounds.x < nav.right &&
        bounds.x + bounds.width > nav.left &&
        bounds.y < nav.bottom &&
        bounds.y + bounds.height > nav.top
      expect(intersectsNavigation, `navigation overlap at ${width}x${height}`).toBe(false)
    }

    await page.locator(".entry-list").evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(action).toBeVisible()
  }

  const { page: wideTouchPage } = await openApp({
    path: "/all",
    width: 1280,
    height: 800,
    touch: true,
  })
  const wideTouchHandle = getDragHandle(wideTouchPage)
  const wideTouchControl = wideTouchPage.locator(".mark-all-read-floating")
  const wideTouchBefore = await wideTouchControl.boundingBox()
  const wideTouchGrip = await wideTouchHandle.boundingBox()
  const wideTouchClient = await wideTouchPage.context().newCDPSession(wideTouchPage)
  await wideTouchClient.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        id: 1,
        x: wideTouchGrip.x + wideTouchGrip.width / 2,
        y: wideTouchGrip.y + wideTouchGrip.height / 2,
      },
    ],
  })
  await wideTouchClient.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        id: 1,
        x: wideTouchGrip.x + wideTouchGrip.width / 2 + 64,
        y: wideTouchGrip.y + wideTouchGrip.height / 2 + 24,
      },
    ],
  })
  await wideTouchClient.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  const wideTouchAfter = await wideTouchControl.boundingBox()
  expect(wideTouchAfter.x).toBeGreaterThan(wideTouchBefore.x + 32)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(wideTouchPage.getByText("Mark all as read?", { exact: true })).toBeHidden()
  await wideTouchClient.detach()
})

test("UX-REACH-01: dragging moves the control but emits no bulk mutation or confirmation", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 466, height: 844, touch: true })
  const action = getAction(page)
  const handle = getDragHandle(page)
  await expect(action).toBeVisible()

  const before = await page.locator(".mark-all-read-floating").boundingBox()
  const grip = await handle.boundingBox()
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 72, start.y - 48, { steps: 6 })
  await page.mouse.up()

  const after = await page.locator(".mark-all-read-floating").boundingBox()
  expect(after.x).toBeGreaterThan(before.x + 32)
  expect(after.y).toBeLessThan(before.y - 16)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()

  const gripAfterDrag = await handle.boundingBox()
  const smallMovementStart = {
    x: gripAfterDrag.x + gripAfterDrag.width / 2,
    y: gripAfterDrag.y + gripAfterDrag.height / 2,
  }
  await page.mouse.move(smallMovementStart.x, smallMovementStart.y)
  await page.mouse.down()
  await page.mouse.move(smallMovementStart.x + 2, smallMovementStart.y + 2)
  await page.mouse.up()
  const restorePosition = page.getByRole("button", { name: "Restore position", exact: true })
  await expect(restorePosition).toBeVisible()
  await restorePosition.click()
  await expect(page.locator(".mark-all-read-floating")).not.toHaveClass(
    /mark-all-read-floating--active/,
  )
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("newsflux:ux-reach-01:mark-all-read-position")),
    )
    .toBeNull()
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  expect(await getMutationRequests(mock)).toHaveLength(0)
})

test("UX-REACH-01: a real touch drag on the grip never activates Mark All", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 466, height: 844, touch: true })
  const handle = getDragHandle(page)
  const floating = page.locator(".mark-all-read-floating")
  const before = await floating.boundingBox()
  const grip = await handle.boundingBox()
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  const client = await page.context().newCDPSession(page)

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 1, x: start.x, y: start.y }],
  })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 1, x: start.x + 64, y: start.y - 40 }],
  })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })

  const after = await floating.boundingBox()
  expect(after.x).toBeGreaterThan(before.x + 32)
  expect(after.y).toBeLessThan(before.y - 16)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()

  const gripAfterDrag = await handle.boundingBox()
  await handle.evaluate((element) => {
    element.addEventListener(
      "click",
      (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      { capture: true, once: true },
    )
  })
  await page.touchscreen.tap(
    gripAfterDrag.x + gripAfterDrag.width / 2,
    gripAfterDrag.y + gripAfterDrag.height / 2,
  )
  const restorePosition = page.getByRole("button", { name: "Restore position", exact: true })
  await expect(restorePosition).toBeVisible()
  await restorePosition.tap()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("newsflux:ux-reach-01:mark-all-read-position")),
    )
    .toBeNull()
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  await client.detach()
})

test("UX-REACH-01: pointer cancellation restores the origin and suppresses activation", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 466, height: 844, touch: true })
  const handle = getDragHandle(page)
  const floating = page.locator(".mark-all-read-floating")
  const before = await floating.boundingBox()
  const grip = await handle.boundingBox()
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }

  await handle.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) => {
        globalThis.__uxReachPointerId = event.pointerId
      },
      { once: true },
    )
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 60, start.y + 40, { steps: 4 })
  await handle.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        pointerId: globalThis.__uxReachPointerId,
      }),
    )
  })
  await page.mouse.up()

  const after = await floating.boundingBox()
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()

  await handle.evaluate((element) => {
    element.addEventListener(
      "pointerdown",
      (event) => {
        globalThis.__uxReachPointerId = event.pointerId
      },
      { once: true },
    )
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 56, start.y + 36, { steps: 4 })
  await handle.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent("lostpointercapture", {
        bubbles: true,
        pointerId: globalThis.__uxReachPointerId,
      }),
    )
  })
  await page.mouse.up()
  const afterCaptureLoss = await floating.boundingBox()
  expect(Math.abs(afterCaptureLoss.x - before.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(afterCaptureLoss.y - before.y)).toBeLessThanOrEqual(1)
  expect(await getMutationRequests(mock)).toHaveLength(0)
})

test("UX-REACH-01: ordinary scrolling and a touch tap preserve the existing confirmation flow", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 466, height: 844, touch: true })
  const action = getAction(page)

  await expect(action).toBeVisible()
  expect(await getMutationRequests(mock)).toHaveLength(0)

  const scrollArea = page.locator(".adaptive-scroll-area-native").first()
  const scrollBounds = await scrollArea.boundingBox()
  const initialScrollTop = await scrollArea.evaluate((element) => element.scrollTop)
  await page.mouse.move(scrollBounds.x + scrollBounds.width / 2, scrollBounds.y + 300)
  await page.mouse.wheel(0, 240)
  await expect
    .poll(() => scrollArea.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(initialScrollTop)
  expect(await getMutationRequests(mock)).toHaveLength(0)

  const bounds = await action.boundingBox()
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeVisible()
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await page.getByRole("button", { name: "Cancel" }).click()
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  expect(await getMutationRequests(mock)).toHaveLength(0)
})

test("UX-REACH-01: keyboard can reposition and reset without losing action activation", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 884, height: 1107, touch: true })
  const action = getAction(page)
  const floating = page.locator(".mark-all-read-floating")
  const initial = await floating.boundingBox()
  const normalLayoutOrigin = await page.evaluate(() => {
    const wrapper = document.querySelector(".mark-all-read-floating")
    const actionButton = wrapper.querySelector(".arco-btn-shape-circle")
    const hadFloatingClass = wrapper.classList.contains("mark-all-read-floating--active")
    const { left, top } = wrapper.style

    wrapper.classList.remove("mark-all-read-floating--active")
    wrapper.style.removeProperty("left")
    wrapper.style.removeProperty("top")
    const rect = actionButton.getBoundingClientRect()
    const origin = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }

    if (hadFloatingClass) {
      wrapper.classList.add("mark-all-read-floating--active")
    }
    wrapper.style.left = left
    wrapper.style.top = top
    return origin
  })
  expect(initial.x, "default position follows the live FooterPanel origin").toBeCloseTo(
    normalLayoutOrigin.x,
    0,
  )
  expect(initial.y, "default position follows the live FooterPanel origin").toBeCloseTo(
    normalLayoutOrigin.y,
    0,
  )
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)

  await action.focus()
  await page.keyboard.press("Shift+ArrowRight")
  expect(await action.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("2px")
  await expect(action).toHaveAttribute("aria-describedby", "mark-all-read-position-help")
  const moved = await floating.boundingBox()
  expect(moved.x).toBeGreaterThan(initial.x)
  expect(await getMutationRequests(mock)).toHaveLength(0)

  await page.keyboard.press("Shift+F10")
  const restorePosition = page.getByRole("button", { name: "Restore position", exact: true })
  await expect(restorePosition).toBeVisible()
  await expect(restorePosition).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
  await expect(floating).toHaveCSS("position", "relative")
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("newsflux:ux-reach-01:mark-all-read-position")),
    )
    .toBeNull()
  const reset = await action.boundingBox()
  expect(Math.abs(reset.x - normalLayoutOrigin.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(reset.y - normalLayoutOrigin.y)).toBeLessThanOrEqual(1)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()

  await page.reload()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
  await expect(floating).toHaveCSS("position", "relative")

  await action.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeVisible()
  const cancel = page.getByRole("button", { name: "Cancel" })
  await cancel.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  expect(await getMutationRequests(mock)).toHaveLength(0)
})

test("UX-REACH-01: skip-confirmation still executes once, and Undo restores the synthetic unread state", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 390, height: 844, touch: true })
  const action = getAction(page)

  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}")
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...settings, skipMarkAllReadConfirmation: true }),
    )
  })
  await page.reload()
  await expect(action).toBeVisible()
  await expect(action).not.toHaveAttribute("aria-expanded", "true")
  await action.click()
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  await expect.poll(() => getMutationRequests(mock)).toHaveLength(1)
  await expect
    .poll(async () => {
      const readIds = await mock.readIds()
      return readIds.length
    })
    .toBeGreaterThan(0)
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible()
  const floatingBounds = await page.locator(".mark-all-read-floating").boundingBox()
  const undoBounds = await page.getByRole("button", { name: "Undo" }).boundingBox()
  const toastOverlapsFloatingControl =
    floatingBounds.x < undoBounds.x + undoBounds.width &&
    floatingBounds.x + floatingBounds.width > undoBounds.x &&
    floatingBounds.y < undoBounds.y + undoBounds.height &&
    floatingBounds.y + floatingBounds.height > undoBounds.y
  expect(toastOverlapsFloatingControl).toBe(false)
  await page.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(async () => {
      const readIds = await mock.readIds()
      return readIds.length
    })
    .toBe(0)
  await expect.poll(() => getMutationRequests(mock)).toHaveLength(2)
})

test("UX-REACH-01: a failed bulk request leaves the list unchanged and the action retryable", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 390, height: 844, touch: true })
  const action = getAction(page)

  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}")
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...settings, skipMarkAllReadConfirmation: true }),
    )
  })
  await page.reload()
  await expect(action).toBeVisible()
  await expect(action).not.toHaveAttribute("aria-expanded", "true")

  let failedMutationRequests = 0
  await page.route("**/v1/entries**", async (route) => {
    if (route.request().method() === "PUT" && failedMutationRequests === 0) {
      failedMutationRequests += 1
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error_message: "synthetic mutation failure" }),
      })
      return
    }
    await route.continue()
  })

  await action.click()
  await expect(page.getByText("Failed to mark all as read")).toBeVisible()
  await expect(action).toBeEnabled()
  expect(await mock.readIds()).toHaveLength(0)
  await expect(page.getByRole("button", { name: "Undo" })).toBeHidden()
  expect(failedMutationRequests).toBe(1)
  expect(await getMutationRequests(mock)).toHaveLength(0)

  await action.click()
  await expect
    .poll(async () => {
      const readIds = await mock.readIds()
      return readIds.length
    })
    .toBeGreaterThan(0)
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible()
  expect(await getMutationRequests(mock)).toHaveLength(1)
})

test("UX-REACH-01: the floating action preserves its disabled and loading states", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 466, height: 844, touch: true })
  const action = getAction(page)

  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}")
    localStorage.setItem(
      "settings",
      JSON.stringify({ ...settings, skipMarkAllReadConfirmation: true }),
    )
  })
  await page.reload()
  await expect(action).toBeVisible()
  await expect(action).not.toHaveAttribute("aria-expanded", "true")

  let markRequestStarted
  let releaseMarkRequest
  const started = new Promise((resolve) => {
    markRequestStarted = resolve
  })
  const waitForRelease = new Promise((resolve) => {
    releaseMarkRequest = resolve
  })
  await page.route("**/v1/entries", async (route) => {
    if (route.request().method() === "PUT") {
      markRequestStarted()
      await waitForRelease
    }
    await route.continue()
  })

  await action.click()
  await started
  await expect(action).toBeDisabled()
  await expect(action).toHaveAttribute("aria-busy", "true")
  releaseMarkRequest()
  await expect.poll(() => getMutationRequests(mock)).toHaveLength(1)
})

test("UX-REACH-01: resize clamps and restores the local position; History keeps Mark All hidden", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all", width: 540, height: 720, touch: true })
  const action = getAction(page)
  const handle = getDragHandle(page)
  const floating = page.locator(".mark-all-read-floating")
  await expect(handle).toBeVisible()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)

  await page.evaluate(() => {
    localStorage.setItem("newsflux:ux-reach-01:mark-all-read-position", "not-json")
  })
  await page.reload()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)

  // Simulate a Duo closed → open → closed viewport transition without claiming physical-device coverage.
  await page.evaluate(() => {
    localStorage.setItem(
      "newsflux:ux-reach-01:mark-all-read-position",
      JSON.stringify({ version: 1, x: 0, y: 0.5 }),
    )
  })
  await page.setViewportSize({ width: 1119, height: 611 })
  await expect(handle).toBeVisible()
  const unfoldedFloating = floating
  const unfoldedBounds = await unfoldedFloating.boundingBox()
  const desktopSidebar = await page.locator(".desktop-sidebar-slot .sidebar").boundingBox()
  expect(unfoldedBounds).not.toBeNull()
  expect(desktopSidebar).not.toBeNull()
  expect(unfoldedBounds.x).toBeGreaterThanOrEqual(desktopSidebar.x + desktopSidebar.width)
  expect(unfoldedBounds.x + unfoldedBounds.width).toBeLessThanOrEqual(1119)

  const unfoldedGrip = await handle.boundingBox()
  const unfoldedBeforeDrag = await unfoldedFloating.boundingBox()
  const client = await page.context().newCDPSession(page)
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        id: 1,
        x: unfoldedGrip.x + unfoldedGrip.width / 2,
        y: unfoldedGrip.y + unfoldedGrip.height / 2,
      },
    ],
  })
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      {
        id: 1,
        x: unfoldedGrip.x + unfoldedGrip.width / 2 + 64,
        y: unfoldedGrip.y + unfoldedGrip.height / 2 + 24,
      },
    ],
  })
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  const unfoldedAfterDrag = await unfoldedFloating.boundingBox()
  expect(unfoldedAfterDrag.x).toBeGreaterThan(unfoldedBeforeDrag.x + 32)
  expect(await getMutationRequests(mock)).toHaveLength(0)
  await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
  await client.detach()

  await page.setViewportSize({ width: 540, height: 720 })
  await expect(handle).toBeVisible()
  const refoldedBounds = await unfoldedFloating.boundingBox()
  expect(refoldedBounds.x).toBeGreaterThanOrEqual(0)
  expect(refoldedBounds.x + refoldedBounds.width).toBeLessThanOrEqual(540)
  expect(await getMutationRequests(mock)).toHaveLength(0)

  const grip = await handle.boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(4000, 4000, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("newsflux:ux-reach-01:mark-all-read-position")),
    )
    .not.toBeNull()

  await page.setViewportSize({ width: 466, height: 500 })
  await expect
    .poll(async () => {
      const bounds = await floating.boundingBox()
      return Boolean(
        bounds &&
        bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 466 &&
        bounds.y + bounds.height <= 500,
      )
    })
    .toBe(true)
  const resized = await floating.boundingBox()
  expect(resized.x).toBeGreaterThanOrEqual(0)
  expect(resized.y).toBeGreaterThanOrEqual(0)
  expect(resized.x + resized.width).toBeLessThanOrEqual(466)
  expect(resized.y + resized.height).toBeLessThanOrEqual(500)

  await page.reload()
  await expect(action).toBeVisible()
  await expect(floating).toHaveClass(/mark-all-read-floating--active/)
  await handle.click()
  const restoredAfterReload = page.getByRole("button", { name: "Restore position", exact: true })
  await expect(restoredAfterReload).toBeVisible()
  await restoredAfterReload.click()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("newsflux:ux-reach-01:mark-all-read-position")),
    )
    .toBeNull()

  for (const viewport of [
    { width: 1119, height: 611 },
    { width: 540, height: 720 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
    const dockedOrigin = await page.evaluate(() => {
      const button = document.querySelector(".mark-all-read-floating .arco-btn-shape-circle")
      const root = document.querySelector(".mark-all-read-floating")
      const buttonRect = button.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      return { buttonX: buttonRect.x, buttonY: buttonRect.y, rootX: rootRect.x, rootY: rootRect.y }
    })
    expect(dockedOrigin.rootX).toBe(dockedOrigin.buttonX)
    expect(dockedOrigin.rootY).toBe(dockedOrigin.buttonY)
  }

  await page.reload()
  await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
  await page.goto("/feed/1")
  await expect(action).toBeVisible()
  await page.goto("/all/entry/1")
  await expect(action).toBeHidden()
  await page.goto("/history")
  await expect(action).toBeHidden()
})

test("UX-REACH-01: fine-pointer desktop retains the existing conventional FooterPanel control", async ({
  openApp,
  mock,
}) => {
  for (const { width, height, expectedControlSize } of [
    { width: 390, height: 844, expectedControlSize: 48 },
    { width: 1440, height: 900, expectedControlSize: 32 },
  ]) {
    const { page } = await openApp({ path: "/all", width, height })
    const action = getAction(page)
    const handle = getDragHandle(page)
    const floating = page.locator(".mark-all-read-floating")

    await expect(action).toBeVisible()
    await expect(floating).toHaveCSS("position", "relative")
    await expect(floating).not.toHaveClass(/mark-all-read-floating--active/)
    await expect(handle).toBeVisible()
    const bounds = await action.boundingBox()
    const initialPosition = await floating.boundingBox()
    expect(bounds.width).toBe(expectedControlSize)
    expect(bounds.height).toBe(expectedControlSize)
    expect(bounds.x).toBe(initialPosition.x)
    expect(bounds.y).toBe(initialPosition.y)

    const grip = await handle.boundingBox()
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2 + 72, grip.y + grip.height / 2 - 48, {
      steps: 6,
    })
    await page.mouse.up()

    await expect(floating).toHaveCSS("position", "fixed")
    await expect(floating).toHaveClass(/mark-all-read-floating--active/)
    const afterMouseDrag = await floating.boundingBox()
    expect(afterMouseDrag.x).toBeGreaterThan(initialPosition.x + 32)
    expect(afterMouseDrag.y).toBeLessThan(initialPosition.y - 16)
    expect(await getMutationRequests(mock)).toHaveLength(0)
    await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()

    if (width === 1440) {
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
      const afterPenDrag = await floating.boundingBox()
      expect(afterPenDrag.x).toBeGreaterThan(afterMouseDrag.x + 24)
      expect(await getMutationRequests(mock)).toHaveLength(0)
      await expect(page.getByText("Mark all as read?", { exact: true })).toBeHidden()
      await client.detach()
    }
  }
})
