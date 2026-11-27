import { createServer } from "node:http"

import { expect, test } from "./support/fixtures.js"

const SECOND_BUILD_MARKER = "\n// NF-PWA-FOREGROUND-1 second worker build\n"

test("NF-PWA-FOREGROUND-1: a foreground check finds a new worker without reloading", async ({
  openApp,
  baseURL,
}) => {
  let secondBuildEnabled = false
  let workerScriptPath = null
  let updateScriptRequests = 0
  const proxyServer = createServer(async (request, response) => {
    try {
      const upstreamUrl = new URL(request.url ?? "/", baseURL)
      const upstream = await fetch(upstreamUrl, {
        headers: {
          accept: request.headers.accept ?? "*/*",
          "accept-encoding": "identity",
        },
      })
      let body = Buffer.from(await upstream.arrayBuffer())
      if (secondBuildEnabled && upstreamUrl.pathname === workerScriptPath) {
        updateScriptRequests += 1
        body = Buffer.concat([body, Buffer.from(SECOND_BUILD_MARKER)])
      }

      const headers = Object.fromEntries(upstream.headers.entries())
      const hopByHopHeaders = [
        "connection",
        "content-encoding",
        "content-length",
        "transfer-encoding",
      ]
      for (const name of hopByHopHeaders) {
        delete headers[name]
      }
      headers["content-length"] = String(body.length)
      if (secondBuildEnabled && upstreamUrl.pathname === workerScriptPath) {
        headers["cache-control"] = "no-store"
      }
      response.writeHead(upstream.status, headers)
      response.end(body)
    } catch (error) {
      response.writeHead(502, { "content-type": "text/plain" })
      response.end(`Synthetic app proxy failed: ${error.message}`)
    }
  })

  await new Promise((resolve, reject) => {
    proxyServer.once("error", reject)
    proxyServer.listen(0, "127.0.0.1", resolve)
  })
  const address = proxyServer.address()
  if (!address || typeof address === "string") {
    throw new Error("Synthetic app proxy did not bind to a TCP port")
  }
  const proxyOrigin = `http://127.0.0.1:${address.port}`

  try {
    const { context, page, errors } = await openApp({
      path: null,
      width: 402,
      height: 874,
      touch: true,
      serviceWorkers: "allow",
      settings: { markReadBy: "manually" },
    })
    await page.goto(new URL("/all/entry/1", proxyOrigin).href)
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
    workerScriptPath = new URL(scriptUrl).pathname
    secondBuildEnabled = true

    const navigations = []
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        navigations.push(frame.url())
      }
    })
    const originalUrl = page.url()
    await page.evaluate(() => {
      const setVisibilityState = (value) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value })
      }
      setVisibilityState("hidden")
      document.dispatchEvent(new Event("visibilitychange"))
      setVisibilityState("visible")
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await expect.poll(() => updateScriptRequests, { timeout: 15_000 }).toBeGreaterThan(0)

    const updateNotice = page
      .locator('.arco-notification-wrapper [role="alert"]')
      .filter({ hasText: "Update ready" })
    await expect(updateNotice).toContainText("Update ready")
    await expect(updateNotice.getByRole("button", { name: "Update now" })).toBeVisible()
    await expect(updateNotice.getByRole("button", { name: "Dismiss" })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration()
          return Boolean(registration?.waiting)
        }),
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

    const reload = page.waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
    })
    await updateNotice.getByRole("button", { name: "Update now" }).click()
    await reload
    await expect(page.locator(".article-body p").first()).toBeVisible()
    await expect.poll(() => navigations.length).toBe(1)
    expect(errors).toEqual([])
    await context.close()
  } finally {
    await new Promise((resolve) => proxyServer.close(resolve))
  }
})
