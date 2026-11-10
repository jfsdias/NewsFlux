import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

/* eslint-disable import/no-relative-parent-imports -- This file is copied into ux-reach-e2e at runtime. */
import { expect, test } from "#e2e/support/fixtures.js"

const ACTION_NAME = "Mark all as read"
const VIEWPORTS = [
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

test("UX-REACH-ROOT-CAUSE-DIAGNOSTIC: capture hit target and real tap at every coarse viewport", async ({
  openApp,
}) => {
  const candidate = process.env.UX_REACH_ROOT_CAUSE_CANDIDATE ?? "unknown"
  const outputRoot = process.env.UX_REACH_ROOT_CAUSE_OUTPUT
  assert.ok(outputRoot)
  await mkdir(outputRoot, { recursive: true })

  const measurements = []
  let targetTap
  for (const viewport of VIEWPORTS) {
    const { page } = await openApp({ path: "/all", ...viewport, touch: true })
    await expect(page.getByRole("button", { name: ACTION_NAME })).toBeVisible()
    await expect(page.locator(".article-entry").first()).toBeVisible()
    const floatingBounds = await page.locator(".mark-all-read-floating").boundingBox()
    const measurement = await page.evaluate((floating) => {
      // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback is serialized into the browser context.
      const describeElement = (element) => {
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
          ariaLabel: element.getAttribute("aria-label"),
          href: element.getAttribute("href"),
          entryId: element.dataset.entryId,
          text: (element.textContent || "").trim().slice(0, 100),
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          pointerEvents: style.pointerEvents,
          position: style.position,
          zIndex: style.zIndex,
          closestArticleId: element.closest(".article-entry")?.dataset.entryId,
          closestArticleHref: element.closest("a.article-entry")?.getAttribute("href") || undefined,
        }
      }

      const viewport = {
        innerWidth,
        innerHeight,
        visualViewportWidth: visualViewport?.width,
        visualViewportHeight: visualViewport?.height,
        devicePixelRatio,
        userAgent: navigator.userAgent,
        anyPointerCoarse: matchMedia("(any-pointer: coarse)").matches,
        primaryPointerCoarse: matchMedia("(pointer: coarse)").matches,
        scrollX,
        scrollY,
      }
      const articles = [...document.querySelectorAll(".article-entry")]
      const firstEligible = articles.find((article) => {
        const rect = article.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const overlapsFloating =
          x >= floating.x &&
          x <= floating.x + floating.width &&
          y >= floating.y &&
          y <= floating.y + floating.height
        return rect.width > 0 && rect.height > 0 && !overlapsFloating
      })
      const summarize = (article) => {
        if (!article) {
          return
        }
        const rect = article.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const hit = document.elementFromPoint(x, y)
        return {
          articleId: article.dataset.entryId,
          href: article.getAttribute("href"),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          center: { x, y },
          centerInsideViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
          pointWithinFloating: Boolean(
            x >= floating.x &&
            x <= floating.x + floating.width &&
            y >= floating.y &&
            y <= floating.y + floating.height,
          ),
          originalPredicate: Boolean(hit?.closest(".article-entry")),
          hitStack: document
            .elementsFromPoint(x, y)
            .slice(0, 8)
            .map((element) => describeElement(element)),
        }
      }
      const target = summarize(firstEligible)
      const visibleLinkCenters = articles.slice(0, 8).map((article) => {
        const rect = article.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const hit = document.elementFromPoint(x, y)
        return {
          articleId: article.dataset.entryId,
          href: article.getAttribute("href"),
          inViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
          topHitArticleId: hit?.closest(".article-entry")?.dataset.entryId,
        }
      })
      return {
        viewport,
        articleCount: articles.length,
        floating: describeElement(document.querySelector(".mark-all-read-floating")),
        target,
        visibleLinkCenters,
      }
    }, floatingBounds)

    measurements.push(measurement)
    if (viewport.width === 993 && viewport.height === 1200) {
      const screenshotPath = path.join(outputRoot, "root-cause-observer-993x1200.png")
      await page.screenshot({ path: screenshotPath, animations: "disabled" })
      if (measurement.target?.centerInsideViewport) {
        const pointerEvents = []
        await page.exposeFunction("__uxReachRecordPointerEvent", (event) => {
          pointerEvents.push(event)
        })
        await page.evaluate(() => {
          // eslint-disable-next-line unicorn/consistent-function-scoping -- The callback runs in the browser document.
          const summarize = (event) => {
            const element = event.target instanceof Element ? event.target : undefined
            void globalThis.__uxReachRecordPointerEvent({
              type: event.type,
              target: element
                ? {
                    tag: element.tagName,
                    className:
                      typeof element.className === "string" ? element.className : undefined,
                    ariaLabel: element.getAttribute("aria-label"),
                    closestArticleId: element.closest(".article-entry")?.dataset.entryId,
                    closestArticleHref:
                      element.closest("a.article-entry")?.getAttribute("href") || undefined,
                  }
                : undefined,
            })
          }
          document.addEventListener("touchstart", summarize, true)
          document.addEventListener("touchend", summarize, true)
          document.addEventListener("click", summarize, true)
        })
        const { x, y } = measurement.target.center
        const beforeUrl = page.url()
        let tapError
        const navigations = []
        page.on("framenavigated", (frame) => {
          if (frame === page.mainFrame()) {
            navigations.push(frame.url())
          }
        })
        try {
          await page.touchscreen.tap(x, y)
          await page.waitForTimeout(500)
        } catch (error) {
          tapError = String(error?.message ?? error)
        }
        targetTap = {
          beforeUrl,
          afterUrl: page.url(),
          navigated: new URL(page.url()).pathname !== new URL(beforeUrl).pathname,
          tapError,
          navigations,
          events: pointerEvents,
        }
      }
      break
    }
  }

  await writeFile(
    path.join(outputRoot, "root-cause-observer.json"),
    JSON.stringify(
      {
        candidate,
        playwrightVersion: "1.63.0 (from pinned repository dependency)",
        retries: 0,
        contextsOpened: measurements.length,
        targetTap,
        measurements,
      },
      null,
      2,
    ),
  )
})
