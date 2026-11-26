import { expect, test } from "./support/fixtures.js"

test("NF-PWA-FOREGROUND-1: real registration checks without reload", async ({ openApp }) => {
  const { page, errors } = await openApp({
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

  const navigations = []
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      navigations.push(frame.url())
    }
  })
  const originalUrl = page.url()
  await page.evaluate(() => {
    const counters = { started: 0, settled: 0 }
    globalThis.nfForegroundTest = counters
    const prototype = globalThis.ServiceWorkerRegistration.prototype
    const originalUpdate = prototype.update
    Object.defineProperty(prototype, "update", {
      configurable: true,
      writable: true,
      value: async function () {
        counters.started += 1
        try {
          return await originalUpdate.call(this)
        } finally {
          counters.settled += 1
        }
      },
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect
    .poll(() => page.evaluate(() => globalThis.nfForegroundTest.settled))
    .toBe(1)
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"))
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect.poll(() => page.evaluate(() => globalThis.nfForegroundTest.started)).toBe(1)
  await expect(page).toHaveURL(originalUrl)
  await expect(page.locator(".article-body p").first()).toBeVisible()
  expect(navigations).toEqual([])
  expect(errors).toEqual([])
})
