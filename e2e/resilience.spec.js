import { cards, entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

const authToken = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("auth")
    return raw ? (JSON.parse(raw).token ?? "") : ""
  })

const isArticleEntriesRequest = (url) =>
  url.pathname === "/v1/entries" && url.searchParams.has("limit")

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

      await expect(page.getByText("Failed to load articles").first()).toBeVisible()
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
    const { page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()
    await mock.fault("entries", "401")

    await page.getByRole("button", { name: "Refresh" }).first().click()

    await expect(page).toHaveURL(/\/login$/)
    await expect(cards(page)).toHaveCount(0)
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
    const loadedIds = await entryIds(page)

    // Only the Miniflux origin becomes unreachable; the application's own files keep loading, so
    // the scenario does not depend on which lazy chunks were fetched before the outage.
    await context.route(`${mock.url}/**`, (route) => route.abort("connectionfailed"))
    await page.getByRole("button", { name: "Refresh" }).first().click()
    await expect(page.getByRole("status")).toContainText(
      "Could not refresh. Showing the articles already loaded.",
    )
    expect(await entryIds(page)).toEqual(loadedIds)
    expect(await page.getByRole("alert").count()).toBe(0)

    await context.unroute(`${mock.url}/**`)
    await page.getByRole("button", { name: "Retry" }).click()
    await expect(cards(page).first()).toBeVisible()
  })

  test("F12-10b: a failed Refresh keeps the already loaded list and offers accessible Retry", async ({
    openApp,
    mock,
  }) => {
    const { context, page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()
    const loadedIds = await entryIds(page)
    const loadedCount = await cards(page).count()
    const mutationsBefore = await mock.mutations()
    const mutationCount = mutationsBefore.length
    const refreshButton = page.getByRole("button", { name: "Refresh" }).first()
    let releaseRefresh
    let markRefreshStarted
    const refreshStarted = new Promise((resolve) => {
      markRefreshStarted = resolve
    })
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve
    })

    await context.route(isArticleEntriesRequest, async (route) => {
      markRefreshStarted()
      await refreshGate
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error_message: "synthetic refresh failure" }),
      })
    })

    await refreshButton.focus()
    await refreshButton.press("Enter")
    await refreshStarted

    expect(await entryIds(page), "the committed list remains visible while refreshing").toEqual(
      loadedIds,
    )
    await expect(page.getByRole("button", { name: "Refresh" }).first()).toBeFocused()

    releaseRefresh()
    await expect(page.getByRole("status")).toContainText(
      "Could not refresh. Showing the articles already loaded.",
    )
    expect(await cards(page).count()).toBe(loadedCount)
    expect(await entryIds(page)).toEqual(loadedIds)
    const mutationsAfterRefresh = await mock.mutations()
    expect(mutationsAfterRefresh.length).toBe(mutationCount)
    await expect(page.getByRole("alert")).toHaveCount(0)

    await context.unroute(isArticleEntriesRequest)
    const staleCard = cards(page).first()
    const staleEntryId = Number(await staleCard.getAttribute("data-entry-id"))
    await mock.fault("status-mutation", "500")
    await staleCard.click({ button: "right" })
    await page.getByText("Mark as read", { exact: true }).click()
    await expect
      .poll(() => mock.mutations())
      .toContainEqual({
        entryIds: [staleEntryId],
        status: "read",
        outcome: "rejected",
      })
    await expect(page.locator(`a.article-entry[data-entry-id="${staleEntryId}"]`)).toHaveClass(
      /unread/,
    )
    await mock.fault("status-mutation", "ok")

    await context.unrouteAll()
    await mock.inject(1)
    const retryButton = page.getByRole("status").getByRole("button", { name: "Retry" })
    await retryButton.focus()
    await retryButton.press("Enter")
    await expect(cards(page).first()).toHaveAttribute("data-entry-id", /1\d{3}/)
    await expect(page.getByRole("status")).toHaveCount(0)
    const mutationsAfterRetry = await mock.mutations()
    expect(mutationsAfterRetry.length).toBe(mutationCount + 1)
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
