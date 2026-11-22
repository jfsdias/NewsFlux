import { expect, test } from "./support/fixtures.js"

test("saved view survives reload and restores query, source and status without mutations", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/all" })
  await page.getByRole("button", { name: "Search" }).first().click()
  await page.getByLabel("Search article titles and content").fill('"Notícia 4"')
  await page.getByLabel("View name").fill("My search")
  await page.getByRole("button", { name: "Save this search" }).click()
  await expect(page.getByText("View saved on this browser.")).toBeVisible()
  await page.getByRole("button", { name: "Cancel" }).click()
  await page.goto("/starred")
  await page.getByRole("button", { name: "Search" }).first().click()
  const request = page.waitForRequest(
    (r) =>
      r.url().includes("/v1/entries") &&
      new URL(r.url()).searchParams.get("search") === '"Notícia 4"',
  )
  await page.getByRole("button", { name: "Open", exact: true }).click()
  await expect(page).toHaveURL(/\/all$/)
  await request
  await page.reload()
  await page.getByRole("button", { name: "Search" }).first().click()
  await expect(page.getByText("My search")).toBeVisible()
  expect(await mock.mutations()).toEqual([])
})
