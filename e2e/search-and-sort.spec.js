import { cards } from "./support/app.js"
import { expect, test } from "./support/fixtures.js"

test.describe("F07 Search", () => {
  test("F07-1: a matching term filters, a missing term shows an empty state", async ({
    openApp,
  }) => {
    const { page } = await openApp({ path: "/all" })
    await expect(cards(page).first()).toBeVisible()

    const search = async (term) => {
      await page.getByRole("button", { name: "Search" }).first().click()
      const input = page.locator("input[aria-label*='Search article']").first()
      await input.fill(term)
      await input.press("Enter")
    }

    await search("Notícia 4")
    await expect(page.getByText("(11)").first()).toBeVisible()

    await search("zzzzqqq")
    await expect(page.getByText("No matching articles")).toBeVisible()
  })
})

test.describe("F08 Sorting and persistence", () => {
  test("F08-1: toggling Newest/Oldest reverses the order and survives a reload", async ({
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
