import { cards, entriesRequests, entryIds } from "./support/app.js"
import { knownDefect } from "./support/classification.js"
import { expect, test } from "./support/fixtures.js"

test.describe("F01 Startup", () => {
  test("F01-1: an authenticated cold start opens Home without page errors", async ({ openApp }) => {
    const { page, errors } = await openApp({ path: "/" })

    await expect(page.getByText("Highlights").first()).toBeVisible()
    expect(errors).toEqual([])
  })

  test("F01-2: without credentials the app redirects to the login form", async ({ openApp }) => {
    const { page } = await openApp({ path: "/all", authenticated: false })

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator("input")).toHaveCount(2)
  })

  test("F01-3: login with an invalid server URL shows an error and starts no session", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/login", authenticated: false })
    const inputs = page.locator("input")

    await inputs.nth(0).fill("localhost:8081")
    await inputs.nth(1).fill("token")
    await page.getByRole("button", { name: "Login", exact: true }).first().click()

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByText("Please check your server address and credentials")).toBeVisible()
    const auth = await page.evaluate(() => localStorage.getItem("auth"))
    expect(auth === null || JSON.parse(auth).token === "").toBe(true)
  })
})

test.describe("F02 Feed loading and refresh", () => {
  test("F02-1: the list loads and Refresh requests entries again keeping the list", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()
    const before = await entriesRequests(mock)

    await page.getByRole("button", { name: "Refresh" }).first().click()

    await expect.poll(() => entriesRequests(mock)).toBeGreaterThan(before)
    await expect(cards(page).first()).toBeVisible()
    expect(await cards(page).count()).toBeGreaterThanOrEqual(3)
  })

  test("F02-2: [touch] new entries while reading keep the article, and Close article is tappable", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all/entry/10", touch: true })
    await expect(page.getByRole("button", { name: "Close article" })).toBeVisible()
    await mock.inject(3)

    await knownDefect("QA-001", /intercepts pointer events/, async () => {
      await page.getByRole("button", { name: "Close article" }).click({ timeout: 3000 })
    })
  })

  test("F02-3: [mouse] new entries while reading keep the article and appear after Refresh", async ({
    openApp,
    mock,
  }) => {
    const { page } = await openApp({ path: "/all/entry/10" })
    await expect(page.getByRole("button", { name: "Close article" })).toBeVisible()
    await mock.inject(3)

    await expect(page).toHaveURL(/\/all\/entry\/10$/)
    await expect(page.getByText("Notícia 10").first()).toBeVisible()
    await page.getByRole("button", { name: "Close article" }).click()
    await expect(page).toHaveURL(/\/all$/)
    await page.getByRole("button", { name: "Refresh" }).first().click()
    await expect(page.getByText("NOVA").first()).toBeVisible()
  })
})

test.describe("F03 Categories and feeds", () => {
  test("F03-1: /category/1 lists only entries of that category", async ({ openApp, mock }) => {
    const { page } = await openApp({ path: "/category/1" })
    await expect(cards(page).first()).toBeVisible()

    const shown = await entryIds(page)
    const category = await mock.json("/v1/categories/1/entries?limit=500")
    const expected = new Set(category.entries.map(({ id }) => id))

    expect(shown.length).toBeGreaterThan(0)
    expect(shown.filter((id) => !expected.has(id))).toEqual([])
  })

  test("F03-2: /feed/2 lists only entries of that feed", async ({ openApp }) => {
    const { page } = await openApp({ path: "/feed/2" })
    await expect(cards(page).first()).toBeVisible()

    const labels = await cards(page).evaluateAll((links) =>
      links.map((link) => link.getAttribute("aria-label")),
    )

    expect(labels.length).toBeGreaterThan(0)
    expect(labels.filter((label) => !label.includes("Beta Mundo"))).toEqual([])
  })
})
