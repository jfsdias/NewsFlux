import { cards, entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

/*
 * NF-0903 reading signals — synthetic E2E contract (ADR 0002)
 *
 * Learning is opt-in. While off, the app makes no request to the reading-signals service. When
 * on, it sends only per-feed daily counters, never entry IDs, titles or URLs, and it never changes
 * list order. The service is mocked with page.route; Miniflux is the synthetic mock.
 */

const SIGNALS = "**/api/reading-signals/**"
const ROW_KEYS = ["day", "feed_id", "impressions", "opens", "read_to_end", "stars"]
const FOLDABLE = { width: 884, height: 1104 }

const watchSignalRequests = (page) => {
  const requests = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/reading-signals")) {
      requests.push(request)
    }
  })
  return requests
}

const mockHealthyService = async (page) => {
  const batches = []
  const resets = []
  await page.route(SIGNALS, async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    if (pathname.endsWith("/healthz")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"ok"}' })
    } else if (pathname.endsWith("/v1/signals/reset")) {
      resets.push(request.headers())
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"deleted":3}' })
    } else if (pathname.endsWith("/v1/signals")) {
      const body = request.postDataJSON()
      batches.push({ body, headers: request.headers() })
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accepted: body.rows.length }),
      })
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    }
  })
  return { batches, resets }
}

// The app flushes pending counters when the page is hidden; this simulates that lifecycle event.
const hidePage = (page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" })
    document.dispatchEvent(new Event("visibilitychange"))
  })

const openReadingSettings = async (page) => {
  await page.getByRole("button", { name: "User menu" }).click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await page.getByRole("tab", { name: "Reading", exact: true }).click()
  return page.getByRole("switch", { name: "Learn from my reading" })
}

const storedSettings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("settings")))

test.describe("NF-0903 reading signals", () => {
  test("NF-0903-1: learning is off by default and makes no request while browsing, reading and starring", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", ...FOLDABLE })
    const requests = watchSignalRequests(page)
    await expect(cards(page).first()).toBeVisible()
    await page.waitForTimeout(1500)
    await cards(page).first().click()
    await expect(page).toHaveURL(/\/all\/entry\/\d+$/)
    await page.keyboard.press("f")
    await hidePage(page)
    await page.waitForTimeout(500)
    expect(requests.map((request) => request.url())).toEqual([])
    expect(await page.evaluate(() => localStorage.getItem("reading-signals-v1"))).toBeNull()
  })

  test("NF-0903-2: turning learning on keeps it off when the service is unavailable", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all", width: 1440, height: 900 })
    const requests = watchSignalRequests(page)
    const toggle = await openReadingSettings(page)
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(page.getByText("The reading-signals service is not available")).toBeVisible()
    await expect(toggle).not.toBeChecked()
    const settings = await storedSettings(page)
    expect(settings.learnFromReading).not.toBe(true)
    expect(requests.map((request) => new URL(request.url()).pathname)).toEqual([
      "/api/reading-signals/healthz",
    ])
  })

  test("NF-0903-3: with learning on, only per-feed daily counters are sent with the Miniflux key", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      ...FOLDABLE,
      provisionedApiKey: true,
      settings: { learnFromReading: true },
    })
    const { batches } = await mockHealthyService(page)
    await expect(cards(page).first()).toBeVisible()
    await page.waitForTimeout(1600)
    const firstId = Number(await cards(page).first().getAttribute("data-entry-id"))
    const entry = await mock.json(`/v1/entries/${firstId}`)
    await cards(page).first().click()
    await expect(page).toHaveURL(new RegExp(`/all/entry/${firstId}$`))
    await page.keyboard.press("f")
    await expect
      .poll(async () => {
        const state = await mock.state()
        return state.starred
      })
      .toContain(firstId)
    // An open is counted once the article body has loaded, which can finish after the star.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const stored = JSON.parse(localStorage.getItem("reading-signals-v1") ?? "{}")
          return Object.values(stored.rows ?? {}).some((row) => row.opens > 0)
        }),
      )
      .toBe(true)
    await hidePage(page)
    await expect.poll(() => batches.length).toBeGreaterThan(0)

    const rows = batches.flatMap(({ body }) => body.rows)
    for (const { body, headers } of batches) {
      expect(Object.keys(body).toSorted()).toEqual(["rows", "schema"])
      expect(body.schema).toBe(1)
      expect(headers["x-miniflux-api-key"]).toBe("e2e-token")
      expect(headers["x-newsflux-miniflux-server"]).toBe(mock.url)
    }
    for (const row of rows) {
      expect(Object.keys(row).toSorted()).toEqual(ROW_KEYS)
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(entry.title)
    expect(serialized).not.toContain(entry.url)
    const sum = (kind) => rows.reduce((total, row) => total + row[kind], 0)
    expect(sum("impressions")).toBeGreaterThan(0)
    const feedRow = rows.find((row) => row.feed_id === entry.feed.id && row.opens > 0)
    expect(feedRow).toBeTruthy()
    expect(rows.some((row) => row.feed_id === entry.feed.id && row.stars > 0)).toBe(true)
  })

  test("NF-0903-4: learning never changes list order on foldable and wide layouts", async ({
    openApp,
  }) => {
    for (const viewport of [FOLDABLE, { width: 1440, height: 900 }]) {
      const off = await openApp({ path: "/all", ...viewport, settings: { showStatus: "all" } })
      await expect(cards(off.page).first()).toBeVisible()
      const baseline = await entryIds(off.page)

      const on = await openApp({
        path: "/all",
        ...viewport,
        provisionedApiKey: true,
        settings: { showStatus: "all", learnFromReading: true },
      })
      await mockHealthyService(on.page)
      await expect(cards(on.page).first()).toBeVisible()
      await on.page.waitForTimeout(1200)
      expect(await entryIds(on.page)).toEqual(baseline)
    }
  })

  test("NF-0903-5: reset deletes the account's totals on the server and on this browser", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({
      path: "/all",
      width: 1440,
      height: 900,
      provisionedApiKey: true,
      settings: { learnFromReading: true },
    })
    const { resets } = await mockHealthyService(page)
    await expect(cards(page).first()).toBeVisible()
    await page.waitForTimeout(1500)
    await openReadingSettings(page)
    await page.getByRole("button", { name: "Reset learning" }).click()
    await page.locator(".app-confirm-modal").getByRole("button", { name: "Reset learning" }).click()
    await expect(page.getByText("Learning was reset.")).toBeVisible()
    expect(resets).toHaveLength(1)
    expect(resets[0]["x-miniflux-api-key"]).toBe("e2e-token")
    expect(resets[0]["x-newsflux-miniflux-server"]).toBe(mock.url)
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("reading-signals-v1")))
    expect(stored.rows).toEqual({})
  })
})
