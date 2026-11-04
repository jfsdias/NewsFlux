import { bodyText, cards, entryIds, FAILURE_FEEDBACK } from "./support/app.js"
import { requirementPending } from "./support/classification.js"
import { expect, test } from "./support/fixtures.js"

const authToken = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("auth")
    return raw ? (JSON.parse(raw).token ?? "") : ""
  })

const serverFailures = [
  ["F12-1", "500", "an HTTP 500 from /v1/entries"],
  ["F12-2", "badjson", "malformed JSON from /v1/entries"],
  ["F12-3", "html200", "an HTML page with status 200 (proxy or captive portal)"],
  ["F12-4", "missing", "a JSON body without the entries field"],
]

test.describe("F12 Miniflux failures", () => {
  for (const [id, kind, description] of serverFailures) {
    test(`${id}: ${description} shows feedback, stays usable and recovers`, async ({
      openApp,
      mock,
    }) => {
      const { page, errors } = await openApp({ path: "/" })
      await expect(page.getByText("Highlights").first()).toBeVisible()
      await mock.fault("entries", kind)

      await page.goto("/all")

      await expect.poll(async () => FAILURE_FEEDBACK.test(await bodyText(page))).toBe(true)
      expect(errors).toEqual([])
      await mock.reset()
      await page.getByRole("button", { name: "Retry" }).click()
      await expect(cards(page).first()).toBeVisible()
    })
  }

  test("F12-5: an empty list shows an explicit empty state", async ({ openApp, mock }) => {
    const { page } = await openApp({ path: "/" })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await mock.fault("entries", "empty")

    await page.goto("/all")

    await expect(page.getByText("No unread articles")).toBeVisible()
  })

  test("F12-6: a 401 clears the session and returns to the login form", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/" })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await mock.fault("entries", "401")

    await page.goto("/all")

    await expect(page).toHaveURL(/\/login$/)
    expect(await authToken(page)).toBe("")
  })

  test("F12-7: duplicated entries in a response do not produce duplicated cards", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/" })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await mock.fault("entries", "dup")

    await page.goto("/all")
    await expect(cards(page).first()).toBeVisible()

    const ids = await entryIds(page)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("F12-8: null titles and contents do not break the list", async ({ openApp, mock }) => {
    const { page, errors } = await openApp({ path: "/" })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await mock.fault("entries", "nullcontent")

    await page.goto("/all")

    await expect(cards(page).first()).toBeVisible()
    expect(await cards(page).count()).toBeGreaterThanOrEqual(3)
    expect(errors).toEqual([])
  })

  test("F12-9: a slow backend shows a loading state and then the content", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/" })
    await expect(page.getByText("Highlights").first()).toBeVisible()
    await mock.fault("entries", "slow")

    await page.goto("/all", { waitUntil: "commit" })

    await expect(
      page.locator("[class*=loading], [class*=skeleton], [aria-busy=true]").first(),
    ).toBeAttached()
    expect(await cards(page).count()).toBe(0)
    await expect(cards(page).first()).toBeVisible({ timeout: 20_000 })
  })

  test("F12-10: losing the connection to Miniflux while refreshing signals the error and recovers", async ({
    openApp,
    mock,
  }) => {
    const { context, page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()

    // Only the Miniflux origin becomes unreachable; the application's own files keep loading, so
    // the scenario does not depend on which lazy chunks were fetched before the outage.
    await context.route(`${mock.url}/**`, (route) => route.abort("connectionfailed"))
    await page.getByRole("button", { name: "Refresh" }).first().click()
    await expect.poll(async () => FAILURE_FEEDBACK.test(await bodyText(page))).toBe(true)

    await context.unroute(`${mock.url}/**`)
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(cards(page).first()).toBeVisible()
  })

  test("F12-10b: a failed Refresh keeps the already loaded list (proposed behavior)", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()
    const loaded = await cards(page).count()
    await mock.fault("entries", "500")

    await page.getByRole("button", { name: "Refresh" }).first().click()
    await expect(page.getByText("Failed to load articles")).toBeVisible()

    await requirementPending("QA-003", /QA-003/, async () => {
      expect(
        await cards(page).count(),
        "QA-003: a failed refresh should keep the loaded entries",
      ).toBe(loaded)
    })
  })

  test("F12-11: a 503 at startup shows a gate with Retry that recovers", async ({
    openApp,
    mock,
  }) => {
    await mock.mode("down")
    const { page } = await openApp({ path: "/" })
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible()

    await mock.mode("ok")
    await page.getByRole("button", { name: "Retry" }).click()

    await expect(page.getByText("Highlights").first()).toBeVisible()
  })
})
