import { center, elementAtCenter, inspectPointerAtCenter } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"
import { assertQa001CenterHit } from "./support/qa001-hit-test.js"

/**
 * QA-001: with a coarse pointer the "Open sidebar" button can cover "Close article" in the reader
 * header. Viewports are ESTIMATES derived from the official physical resolutions and assumed device
 * pixel ratios (see docs/qa/FINDINGS_REGISTER.md); they are not device measurements.
 *
 * The reader sidebar trigger and action bar must own separate hit regions at every breakpoint.
 * Foldable viewport values are estimates, not physical-device measurements.
 */
const VIEWPORTS = [
  { width: 466, height: 614, label: "Duo closed (DPR 3 estimate)" },
  { width: 597, height: 880, label: "Fold closed (DPR 2.09 estimate)" },
  { width: 704, height: 869, label: "Fold open (DPR 2.625 estimate)" },
  { width: 884, height: 1107, label: "Fold open / project critical viewport" },
  { width: 939, height: 1271, label: "Duo open (DPR 2 estimate)" },
  { width: 1024, height: 768, label: "tablet landscape" },
  { width: 1440, height: 900, label: "desktop with touch screen" },
]

const readerControlsOverlap = async (page) =>
  page.evaluate(() => {
    const close = document.querySelector('[aria-label="Close article"]')
    const sidebar = document.querySelector(".reader-sidebar-trigger")
    if (!close || !sidebar) {
      return false
    }

    // eslint-disable-next-line unicorn/consistent-function-scoping -- this helper must run in page.evaluate's browser context.
    const hitBounds = (element) => {
      const rect = element.getBoundingClientRect()
      const after = getComputedStyle(element, "::after")
      const hasPointerTarget = after.content !== "none" && after.display !== "none"
      const inset = (value) => (hasPointerTarget ? Number.parseFloat(value) || 0 : 0)
      return {
        left: rect.left + inset(after.left),
        top: rect.top + inset(after.top),
        right: rect.right - inset(after.right),
        bottom: rect.bottom - inset(after.bottom),
      }
    }

    const closeBounds = hitBounds(close)
    const sidebarBounds = hitBounds(sidebar)
    return (
      closeBounds.left < sidebarBounds.right &&
      closeBounds.right > sidebarBounds.left &&
      closeBounds.top < sidebarBounds.bottom &&
      closeBounds.bottom > sidebarBounds.top
    )
  })

// Diagnostic only: record the final 993 -> 884 transition without changing the input path.
const startFoldObservation = (page) =>
  page.evaluate(() => {
    const events = []
    const url = () => location.pathname.replace(/\d+/g, ":id")
    const describe = (element) => {
      if (!(element instanceof Element)) return null
      const button = element.closest("button")
      const label = button?.getAttribute("aria-label")
      return {
        tag: element.tagName,
        classes: [...element.classList].filter((name) =>
          /^(reader-|left-side|nf-glass|arco-drawer|mobile-sidebar)/.test(name),
        ),
        nearestButton:
          label === "Close article" || label === "Open sidebar" ? label : button ? "other" : null,
      }
    }
    const rect = (element) => {
      if (!element) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }
    const snapshot = () => {
      const close = document.querySelector('[aria-label="Close article"]')
      const sidebar = document.querySelector(".reader-sidebar-trigger")
      const drawer = document.querySelector(".sidebar-drawer, #mobile-sidebar-drawer")
      const drawerStyle = drawer ? getComputedStyle(drawer) : null
      return {
        viewport: { width: innerWidth, height: innerHeight },
        windowClass:
          document.querySelector("[data-window-class]")?.getAttribute("data-window-class") ?? null,
        closeRect: rect(close),
        sidebarRect: rect(sidebar),
        sidebarWrapperClass: sidebar?.parentElement?.className ?? null,
        drawer: drawer
          ? {
              classes: [...drawer.classList],
              display: drawerStyle.display,
              visibility: drawerStyle.visibility,
              ariaHidden: drawer.getAttribute("aria-hidden"),
            }
          : null,
        url: url(),
      }
    }
    const record = (type, details = {}) =>
      events.push({
        t: Math.round(performance.now() * 100) / 100,
        type,
        ...details,
        state: snapshot(),
      })
    window.__qa001FoldObservation = { events, record }
    addEventListener("resize", () => record("resize"), true)
    for (const query of [
      "(max-width: 359px)",
      "(max-width: 768px)",
      "(max-width: 992px)",
      "(pointer: coarse)",
    ]) {
      const media = matchMedia(query)
      media.addEventListener("change", (event) =>
        record("media-change", { query, matches: event.matches }),
      )
      record("media-initial", { query, matches: media.matches })
    }
    for (const type of [
      "pointerdown",
      "pointerup",
      "pointercancel",
      "touchstart",
      "touchend",
      "touchcancel",
      "click",
    ]) {
      document.addEventListener(
        type,
        (event) => {
          const point = event.changedTouches?.[0] ?? event
          record(type, {
            target: describe(event.target),
            point: { x: point.clientX ?? null, y: point.clientY ?? null },
            pointerType: event.pointerType ?? null,
            trusted: event.isTrusted,
          })
        },
        true,
      )
    }
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method]
      history[method] = function (...args) {
        const result = original.apply(this, args)
        record(method)
        return result
      }
    }
    addEventListener("popstate", () => record("popstate"))
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const target =
          mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
        if (
          target?.matches(".left-side.nf-glass-group") ||
          target?.closest(".left-side.nf-glass-group")
        ) {
          record("actionbar-mutation", {
            target: describe(target),
            added: [...mutation.addedNodes].map(describe),
            removed: [...mutation.removedNodes].map(describe),
          })
        }
      }
    }).observe(document.documentElement, { subtree: true, childList: true })
    record("before-final-resize")
  })

const finishFoldObservation = async (page, outcome) => {
  try {
    const data = await page.evaluate((result) => {
      const observation = window.__qa001FoldObservation
      observation.record("outcome", { result })
      return observation.events
    }, outcome)
    await test.info().attach("qa001-fold-observation.json", {
      body: Buffer.from(`${JSON.stringify(data, null, 2)}\n`),
      contentType: "application/json",
    })
    console.log(
      `QA001_FOLD_OBSERVATION ${JSON.stringify({ outcome, events: data.map(({ t, type, target, point, matches, query, state }) => ({ t, type, target, point, matches, query, width: state.viewport.width, windowClass: state.windowClass, url: state.url, drawer: state.drawer })) })}`,
    )
  } catch (error) {
    // Observation must never replace the original test outcome.
    console.log(`QA001_FOLD_OBSERVATION unavailable: ${error.message}`)
  }
}

test.describe("QA-001 Close article hit-testing with a coarse pointer", () => {
  for (const { width, height, label } of VIEWPORTS) {
    test(`QA-001-${width}: [touch] Close article receives the pointer at ${width}x${height} (${label})`, async ({
      openApp,
    }) => {
      const { page } = await openApp({ path: "/all/entry/3", width, height, touch: true })
      const close = page.getByRole("button", { name: "Close article" })
      await expect(close).toBeVisible()

      const diagnostics = await inspectPointerAtCenter(close, "touch")
      await test.info().attach("qa001-center-hit.json", {
        body: Buffer.from(`${JSON.stringify(diagnostics, null, 2)}\n`),
        contentType: "application/json",
      })
      assertQa001CenterHit(diagnostics)
      expect(await readerControlsOverlap(page), `Controls overlap at ${width}x${height}`).toBe(
        false,
      )

      if (width === 884) {
        const sidebar = page.locator(".reader-sidebar-trigger")
        const sidebarWrapper = sidebar.locator("xpath=..")

        await test.step("the sidebar trigger remains reachable by touch", async () => {
          expect(await elementAtCenter(sidebar)).toBe("Open sidebar")
          const sidebarCenter = await center(sidebar)
          await page.touchscreen.tap(sidebarCenter.x, sidebarCenter.y)

          const drawerClose = page.locator(".sidebar-drawer .mobile-sidebar-close")
          await expect(drawerClose).toBeVisible()
          await drawerClose.click()
          await expect(drawerClose).toBeHidden()
          await expect(page).toHaveURL(/\/all\/entry\/3$/)
        })

        await test.step("Close article remains keyboard reachable and activatable", async () => {
          let focusedLabel = ""
          for (let index = 0; index < 30 && focusedLabel !== "Close article"; index += 1) {
            await page.keyboard.press("Tab")
            focusedLabel = await page.evaluate(
              () => document.activeElement?.getAttribute("aria-label") ?? "",
            )
          }
          expect(focusedLabel).toBe("Close article")
          await page.keyboard.press("Enter")
          await expect(page).toHaveURL(/\/all$/)
          await page.goto("/all/entry/3")
          await expect(close).toBeVisible()
        })

        for (const boundaryWidth of [768, 769, 992, 993]) {
          await page.setViewportSize({ width: boundaryWidth, height })
          await expect(close).toBeVisible()
          if (boundaryWidth <= 992) {
            await expect(sidebar).toBeVisible()
            await expect(sidebarWrapper).toHaveClass(
              boundaryWidth <= 768
                ? /reader-sidebar-trigger-wrapper/
                : /reader-sidebar-trigger-actionbar/,
            )
            expect(await elementAtCenter(sidebar)).toBe("Open sidebar")
          } else {
            await expect(sidebar).toBeHidden()
          }

          const boundaryDiagnostics = await inspectPointerAtCenter(close, "touch")
          await test.info().attach(`qa001-resize-${boundaryWidth}.json`, {
            body: Buffer.from(`${JSON.stringify(boundaryDiagnostics, null, 2)}\n`),
            contentType: "application/json",
          })
          assertQa001CenterHit(boundaryDiagnostics)
          expect(
            await readerControlsOverlap(page),
            `Controls overlap at ${boundaryWidth}x${height}`,
          ).toBe(false)

          if (boundaryWidth === 769 || boundaryWidth === 992) {
            const boundaryCenter = await center(close)
            await page.touchscreen.tap(boundaryCenter.x, boundaryCenter.y)
            await expect(page).toHaveURL(/\/all$/)
            await page.goto("/all/entry/3")
            await expect(close).toBeVisible()
          }
        }

        await startFoldObservation(page)
      }

      let foldOutcome = "failed"
      try {
        if (width === 884) {
          await page.setViewportSize({ width, height })
          const restoredViewportDiagnostics = await inspectPointerAtCenter(close, "touch")
          await test.info().attach("qa001-restored-viewport-hit.json", {
            body: Buffer.from(`${JSON.stringify(restoredViewportDiagnostics, null, 2)}\n`),
            contentType: "application/json",
          })
          assertQa001CenterHit(restoredViewportDiagnostics)
        }

        const { x, y } = await center(close)
        await page.touchscreen.tap(x, y)
        await expect(page).toHaveURL(/\/all$/)
        await expect(close).toBeHidden()
        foldOutcome = "passed"
      } finally {
        if (width === 884) await finishFoldObservation(page, foldOutcome)
      }
    })
  }

  test("QA-001-mouse: [mouse] Close article receives the pointer at 884x1107", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all/entry/3", width: 884, height: 1107 })
    const close = page.getByRole("button", { name: "Close article" })
    await expect(close).toBeVisible()

    expect(await elementAtCenter(close)).toBe("Close article")
  })
})
