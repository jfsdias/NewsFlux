import { createHash } from "node:crypto"

import { expect, test } from "./support/fixtures.js"

const RECOVERY_PATH = "/api/content-fallback/reader/v1/entries/1/recover"
const RECOVERED_HTML = Array.from(
  { length: 32 },
  (_, index) =>
    `<p>Synthetic recovered article body paragraph ${index + 1} with independently validated details. ${"Additional synthetic report text. ".repeat(12)}</p>`,
).join("")

const recoveryPayload = (entry, changes = {}) => ({
  status: "recovered",
  entry_id: entry.id,
  url_fingerprint: createHash("sha256").update(entry.url, "utf8").digest("hex"),
  content_html: RECOVERED_HTML,
  content_origin: "wallhop",
  validation: { state: "SUFFICIENT" },
  provenance: { provider: "wallhop.io", fetched_at: "2026-11-10T12:00:00+00:00" },
  ...changes,
})

const button = (page, name) => page.getByRole("button", { name })

test.describe("Reader content recovery", () => {
  test("READER-RECOVERY-R2-1: restores the original in place without another request or Miniflux mutation", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all/entry/1",
      width: 884,
      height: 1104,
      provisionedApiKey: true,
      settings: { markReadBy: "manually" },
    })
    const entry = await mock.json("/v1/entries/1")
    let recoveryRequests = 0
    let releaseRecovery
    let resolveRequestStarted
    const recoveryGate = new Promise((resolve) => {
      releaseRecovery = resolve
    })
    const requestStarted = new Promise((resolve) => {
      resolveRequestStarted = resolve
    })
    await page.route(`**${RECOVERY_PATH}`, async (route) => {
      recoveryRequests += 1
      expect(route.request().method()).toBe("POST")
      const headers = route.request().headers()
      expect(headers["x-miniflux-api-key"]).toBe("e2e-token")
      expect(headers["x-newsflux-miniflux-server"]).toBe(mock.url)
      resolveRequestStarted()
      await recoveryGate
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry)),
      })
    })

    const before = await mock.state()
    expect(await mock.mutations()).toEqual([])
    await expect(button(page, "Recover full text")).toBeVisible()
    await button(page, "Recover full text").focus()
    await page.keyboard.press("Enter")
    await requestStarted
    await expect(button(page, "Recovering full text…")).toBeDisabled()
    expect(recoveryRequests).toBe(1)
    const scrollArea = page
      .locator(
        ".scroll-container .simplebar-content-wrapper, .scroll-container.adaptive-scroll-area-native",
      )
      .first()
    const initialScrollTop = await scrollArea.evaluate((element) => {
      element.scrollTop = Math.min(600, element.scrollHeight - element.clientHeight)
      return element.scrollTop
    })
    expect(initialScrollTop).toBeGreaterThan(0)
    releaseRecovery()
    await expect(page.locator(".article-body")).toContainText("Synthetic recovered article body")
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop))
      .toBe(initialScrollTop)
    await expect(page.getByRole("status")).toContainText("Full text recovered from WallHop")
    await expect(button(page, "Show original text")).toBeVisible()
    await expect(button(page, "Show original text")).toBeFocused()

    await button(page, "Show original text").evaluate((element) => element.click())
    await expect(page.locator(".article-body")).toContainText("const x = 1")
    await expect(page.locator(".article-body")).not.toContainText(
      "Synthetic recovered article body",
    )
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop))
      .toBe(initialScrollTop)
    await expect(button(page, "Show recovered text")).toBeVisible()
    await button(page, "Show recovered text").evaluate((element) => element.click())
    await expect(page.locator(".article-body")).toContainText("Synthetic recovered article body")
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop))
      .toBe(initialScrollTop)

    expect(recoveryRequests).toBe(1)
    expect(await mock.state()).toMatchObject({ read: before.read, starred: before.starred })
    expect(await mock.mutations()).toEqual([])
  })

  test("READER-RECOVERY-R2-2: keeps original text and safe feedback for provider, identity, and content failures", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all/entry/1",
      provisionedApiKey: true,
      settings: { markReadBy: "manually" },
    })
    const entry = await mock.json("/v1/entries/1")
    let response = {
      status: 403,
      contentType: "application/json",
      body: '{"error":"private diagnostic marker"}',
    }
    await page.route(`**${RECOVERY_PATH}`, async (route) => {
      if (response.failure) {
        await route.abort("failed")
        return
      }
      await route.fulfill(response)
    })

    const cases = [
      { status: 429, contentType: "application/json", body: '{"error":"rate limited marker"}' },
      { status: 504, contentType: "application/json", body: '{"error":"timeout marker"}' },
      { status: 503, contentType: "application/json", body: '{"error":"upstream marker"}' },
      { failure: "failed" },
      { status: 200, contentType: "application/json", body: "{malformed json" },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry, { entry_id: 999 })),
      },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry, { url_fingerprint: "f".repeat(64) })),
      },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          recoveryPayload(entry, {
            content_html: "<p>Menu Home Ads Login</p>",
            validation: { state: "INSUFFICIENT" },
          }),
        ),
      },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry, { content_html: "<script>unsafe()</script>" })),
      },
      {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry, { content_html: "<p></p>" })),
      },
      { status: 200, contentType: "text/html", body: "provider diagnostic marker" },
    ]

    await expect(button(page, "Recover full text")).toBeVisible()
    for (const nextResponse of [response, ...cases]) {
      response = nextResponse
      await button(page, "Recover full text").click()
      await expect(page.locator(".reader-content-recovery__error")).toContainText(
        "Full text could not be recovered. The original content is still shown.",
      )
      await expect(button(page, "Recover full text")).toBeFocused()
      await expect(page.locator(".article-body")).toContainText("const x = 1")
      await expect(page.locator("body")).not.toContainText("diagnostic marker")
      await expect(page.locator("body")).not.toContainText("rate limited marker")
      await expect(page.locator("body")).not.toContainText("timeout marker")
      await expect(page.locator("body")).not.toContainText("upstream marker")
    }

    expect(await mock.mutations()).toEqual([])
  })

  test("READER-RECOVERY-R2-3: aborts an in-flight request when the Reader changes articles", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all", provisionedApiKey: true })
    const entry = await mock.json("/v1/entries/1")
    await expect(page.locator("a.article-entry").first()).toBeVisible()

    let releaseResponse
    let requestSeen
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve
    })
    const requestGate = new Promise((resolve) => {
      requestSeen = resolve
    })
    let interceptedRoute
    const requestFailed = new Promise((resolve) => {
      page.on("requestfailed", (request) => {
        if (request.url().includes("/api/content-fallback/reader/v1/entries/1/recover")) {
          resolve(request.failure()?.errorText ?? "failed")
        }
      })
    })
    await page.route(`**${RECOVERY_PATH}`, async (route) => {
      interceptedRoute = route
      requestSeen()
      await responseGate
      try {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(recoveryPayload(entry)),
        })
      } catch {
        // A browser-aborted request may no longer have a fulfillable route.
      }
    })

    await page.locator("a.article-entry").first().click()
    await expect(button(page, "Recover full text")).toBeVisible()
    await button(page, "Recover full text").click()
    await requestGate
    await button(page, "Close article").click()
    await expect(page.locator("a.article-entry").nth(1)).toBeVisible()
    await page.locator("a.article-entry").nth(1).click()
    await expect(page.locator(".article-title")).toContainText("Notícia 2")
    await expect.poll(() => requestFailed).toMatch(/abort|cancel|failed/i)
    await expect(page.locator(".article-body")).not.toContainText("Synthetic recovered")
    expect(interceptedRoute).toBeTruthy()
    releaseResponse()
    await page.waitForTimeout(100)
    await expect(page.locator(".article-body")).not.toContainText("Synthetic recovered")
  })

  test("READER-RECOVERY-R2-4: aborts a pending request when the authentication session changes", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all/entry/1",
      provisionedApiKey: true,
      settings: { markReadBy: "manually" },
    })
    let releaseResponse
    let resolveRequestStarted
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve
    })
    const requestStarted = new Promise((resolve) => {
      resolveRequestStarted = resolve
    })
    const requestFailed = new Promise((resolve) => {
      page.on("requestfailed", (request) => {
        if (request.url().includes(RECOVERY_PATH)) {
          resolve(request.failure()?.errorText ?? "failed")
        }
      })
    })
    await page.route(`**${RECOVERY_PATH}`, async (route) => {
      resolveRequestStarted()
      await responseGate
      try {
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
      } catch {
        // The synthetic response may be too late after the browser cancels the request.
      }
    })

    await button(page, "Recover full text").click()
    await requestStarted
    await page.evaluate((server) => {
      const updatedAuth = {
        server,
        token: "e2e-rotated-token",
        apiKeyId: 17,
        username: "",
        password: "",
      }
      const value = JSON.stringify(updatedAuth)
      localStorage.setItem("auth", value)
      globalThis.dispatchEvent(new StorageEvent("storage", { key: "auth", newValue: value }))
    }, mock.url)
    await expect(button(page, "Recover full text")).toBeVisible()
    await expect.poll(() => requestFailed).toMatch(/abort|cancel|failed/i)
    await expect(page.locator(".article-body")).toContainText("const x = 1")
    expect(await mock.mutations()).toEqual([])
    releaseResponse()
    await page.waitForTimeout(100)
    await expect(page.locator(".article-body")).not.toContainText("Synthetic recovered")
  })

  test("READER-RECOVERY-R2-5: keeps recovery controls usable by touch on a narrow reader", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all/entry/1",
      width: 390,
      height: 844,
      touch: true,
      provisionedApiKey: true,
      settings: { markReadBy: "manually" },
    })
    const entry = await mock.json("/v1/entries/1")
    let recoveryRequests = 0
    await page.route(`**${RECOVERY_PATH}`, async (route) => {
      recoveryRequests += 1
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry)),
      })
    })

    await button(page, "Recover full text").tap()
    await expect(page.locator(".article-body")).toContainText("Synthetic recovered article body")
    await button(page, "Show original text").tap()
    await expect(page.locator(".article-body")).toContainText("const x = 1")
    expect(recoveryRequests).toBe(1)
    expect(await mock.mutations()).toEqual([])
  })
})
