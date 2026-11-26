import { expect, test } from "./support/fixtures.js"

test("NF-PWA-FOREGROUND-1: a foreground check finds a new worker without reloading", async ({
  openApp,
}) => {
  const { context, page, errors } = await openApp({
    path: "/all/entry/1",
    width: 402,
    height: 874,
    touch: true,
    serviceWorkers: "allow",
    settings: { markReadBy: "manually" },
  })
  await expect(page.locator(".article-body p").first()).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 20_000,
    })
    .toBe(true)

  const scriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.active?.scriptURL ?? null
  })
  expect(scriptUrl).toBeTruthy()
  let updateScriptRequests = 0
  await context.route(scriptUrl, async (route) => {
    updateScriptRequests += 1
    const response = await route.fetch()
    const source = await response.text()
    await route.fulfill({
      response,
      body: `${source}\n// NF-PWA-FOREGROUND-1 second worker build\n`,
    })
  })

  const navigations = []
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url())
    }
  })
  const originalUrl = page.url()
  await page.evaluate(() => {
    globalThis.nfForegroundTrigger = window.setInterval(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    }, 100)
  })
  await expect.poll(() => updateScriptRequests).toBeGreaterThan(0)
  await page.evaluate(() => window.clearInterval(globalThis.nfForegroundTrigger))

  const updateNotice = page
    .locator('.arco-notification-wrapper [role="alert"]')
    .filter({ hasText: "Update ready" })
  await expect(updateNotice).toContainText("Update ready")
  await expect(updateNotice.getByRole("button", { name: "Update now" })).toBeVisible()
  await expect(updateNotice.getByRole("button", { name: "Dismiss" })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)),
    )
    .toBe(true)

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(page).toHaveURL(originalUrl)
  await expect(page.locator(".article-body p").first()).toBeVisible()
  expect(updateScriptRequests).toBe(1)
  expect(navigations).toEqual([])
  expect(errors).toEqual([])
})
