import { bodyText, bodyTextLength, cards, entryIds } from "./support/app.js"
import { requirementPending } from "./support/classification.js"
import { expect, test } from "./support/fixtures.js"

test.describe("F13 PWA", () => {
  test("F13-1: the service worker controls the page and the shell opens offline", async ({
    openApp,
  }) => {
    const { context, page } = await openApp({
      path: "/",
      width: 402,
      height: 874,
      touch: true,
      serviceWorkers: "allow",
      deviceScaleFactor: 3,
    })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
        timeout: 20_000,
      })
      .toBe(true)
    // Going offline before the runtime asset cache holds every asset the page loaded is a different
    // scenario (the app shows its "reconnect to its current version" recovery dialog), so wait.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const loaded = performance
              .getEntriesByType("resource")
              .map((entry) => entry.name)
              .filter((url) => /\/assets\/.*\.(?:css|js)$/.test(url))
            const cached = await Promise.all(loaded.map((url) => caches.match(url)))
            return loaded.length > 0 && cached.every(Boolean)
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    await context.setOffline(true)
    await page.reload({ waitUntil: "domcontentloaded" })

    // Offline the shell loads but, by design, content is not cached: the version gate is shown.
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()
  })
})

test.describe("F14 Fold and unfold", () => {
  test("F14-1: resizing 475 to 704 to 475 keeps the article and keeps an open menu inside the viewport", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all/entry/20", width: 475, height: 687, touch: true })
    await page.getByRole("button", { name: "More actions" }).first().tap()
    const menu = page.locator("[role=menu], .arco-dropdown, .arco-trigger-popup").first()
    await expect(menu).toBeVisible()

    const insideViewport = () =>
      page.evaluate(() => {
        const popup = [
          ...document.querySelectorAll("[role=menu], .arco-dropdown, .arco-trigger-popup"),
        ].find((element) => element.getBoundingClientRect().width > 0)
        const box = popup?.getBoundingClientRect()
        return (
          Boolean(box) &&
          box.left >= -1 &&
          box.right <= innerWidth + 1 &&
          box.top >= -1 &&
          box.bottom <= innerHeight + 1
        )
      })

    expect(await insideViewport()).toBe(true)
    await page.setViewportSize({ width: 704, height: 869 })
    await expect(page).toHaveURL(/\/all\/entry\/20$/)
    expect(await insideViewport()).toBe(true)
    await page.setViewportSize({ width: 475, height: 687 })
    await expect(page).toHaveURL(/\/all\/entry\/20$/)
    expect(await insideViewport()).toBe(true)
  })
})

test.describe("F15 Deep links and reopening", () => {
  test("F15-1: direct links open an article and a category list", async ({ openApp }) => {
    const { page } = await openApp({ path: "/feed/3/entry/30" })
    await expect(page.getByText("Notícia 30").first()).toBeVisible()

    await page.goto("/category/2")

    await expect(cards(page).first()).toBeVisible()
  })

  test("F15-2: a missing entry and an unknown route render some text and no raw error (content not specified)", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all/entry/999999" })
    await expect.poll(() => bodyTextLength(page)).toBeGreaterThan(40)
    expect(await bodyText(page)).not.toMatch(/Cannot read properties|TypeError/)

    await page.goto("/does-not-exist")

    await expect.poll(() => bodyTextLength(page)).toBeGreaterThan(20)
  })

  test("F15-3: reopening the app with saved storage keeps the session and the route", async ({
    openApp,
  }) => {
    const { context, page } = await openApp({ path: "/all/entry/20" })
    await expect(page.getByText("Notícia 20").first()).toBeVisible()
    const storageState = await context.storageState()

    const reopened = await openApp({
      path: "/all/entry/20",
      authenticated: false,
      storageState,
    })

    await expect(reopened.page).not.toHaveURL(/\/login$/)
    await expect(reopened.page.getByText("Notícia 20").first()).toBeVisible()
  })

  test("F15-4: an unexpected server payload shows a safe message (proposed behavior)", async ({
    openApp,
    mock,
  }) => {
    await mock.fault("entry", "emptyobject")
    const { page } = await openApp({ path: "/all/entry/5" })
    await expect(page.getByRole("button", { name: "Back to Home" })).toBeVisible()

    await requirementPending("QA-004", /QA-004/, async () => {
      expect(
        await bodyText(page),
        "QA-004: unexpected payloads should not surface raw technical text",
      ).not.toMatch(/Cannot read properties|TypeError/)
    })
  })
})

test.describe("F16 Long feed", () => {
  test("F16-1: scrolling to the end loads the next page and reaches the last entry", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()
    const seen = new Set()

    await expect
      .poll(
        async () => {
          await page.evaluate(() => {
            let element = document.querySelector("a.article-entry")
            while (element && element !== document.body) {
              const { overflowY } = getComputedStyle(element)
              if (
                element.scrollHeight > element.clientHeight + 20 &&
                /(auto|scroll)/.test(overflowY)
              ) {
                element.scrollTop = element.scrollHeight
                break
              }
              element = element.parentElement
            }
          })
          for (const id of await entryIds(page)) {
            seen.add(id)
          }
          return seen.has(150)
        },
        { timeout: 40_000, intervals: [250] },
      )
      .toBe(true)
  })
})
