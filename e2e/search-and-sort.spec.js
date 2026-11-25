import { cards, entryIds } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

test.describe("F07 Search", () => {
  test("F07-1: a matching term filters, a missing term shows an empty state", async ({
    openApp,
    mock,
  }) => {
    const { context, page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()

    const search = async (term) => {
      await page.getByRole("button", { name: "Search" }).first().click()
      const input = page.locator("input[aria-label*='Search article']").first()
      await input.fill(term)
      await input.press("Enter")
    }

    await search("Notícia 4")
    await expect(page.getByText("(11)").first()).toBeVisible()

    let releaseStaleResponse
    let markStaleRequestStarted
    const staleResponseGate = new Promise((resolve) => {
      releaseStaleResponse = resolve
    })
    const staleRequestStarted = new Promise((resolve) => {
      markStaleRequestStarted = resolve
    })
    await context.route(
      (url) => url.pathname === "/v1/entries" && url.searchParams.get("search") === "zzzzqqq",
      async (route) => {
        markStaleRequestStarted()
        await staleResponseGate
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ entries: [], total: 0 }),
        })
      },
    )

    await search("zzzzqqq")
    await staleRequestStarted
    await expect(cards(page)).toHaveCount(0)
    await expect(page.locator("[class*=loading], [class*=skeleton]").first()).toBeAttached()

    // A unique title makes the expected result independent of virtual-list measurement.
    await search("Notícia 2:")
    await expect.poll(() => entryIds(page)).toEqual([2])

    const staleResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/entries" &&
        new URL(response.url()).searchParams.get("search") === "zzzzqqq",
    )
    releaseStaleResponse()
    const response = await staleResponse
    await response.finished()
    await expect.poll(() => entryIds(page)).toEqual([2])
    await expect(cards(page)).toHaveCount(1)
    await expect(page.getByText("No matching articles")).not.toBeVisible()
    await context.unrouteAll()

    expect(await mock.mutations()).toEqual([])
    await search("zzzzqqq")
    await expect(page.getByText("No matching articles")).toBeVisible()
  })
})

test.describe("F08 Sorting and persistence", () => {
  test("F08-1: toggling Newest/Oldest changes the first article and the choice survives a reload", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all" })
    const first = () => cards(page).first().getAttribute("href")
    await expect(cards(page).first()).toBeVisible()
    const initial = await first()

    await page
      .getByRole("button", { name: /Newest first|Oldest first/ })
      .first()
      .click()
    await expect.poll(first).not.toBe(initial)
    const reversed = await first()

    await page.reload()
    await expect(cards(page).first()).toBeVisible()
    expect(await first()).toBe(reversed)
  })
})
