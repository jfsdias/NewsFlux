import { expect, test } from "./support/fixtures.js"

test("NF-E05-1: Home editorial controls are opt-in, reversible and local to the session", async ({
  openApp,
  mock,
}) => {
  const { page, errors } = await openApp({ path: "/", settings: { markReadBy: "manually" } })
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("heading", { name: "Briefing: recent coverage" })).toHaveCount(0)
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  await expect(panel.getByText(/Based only on up to the first 250 entries/)).toBeVisible()
  const sources = panel.getByLabel("Focus on source")
  await expect.poll(() => sources.locator("option").count()).toBeGreaterThan(1)
  const source = await sources.locator("option").nth(1).getAttribute("value")
  await sources.selectOption(source)
  await panel.getByRole("button", { name: "More from this source" }).click()
  await expect(panel.getByText(/Preference: 1/)).toBeVisible()
  await panel.getByRole("button", { name: "Undo last change" }).click()
  await expect(panel.getByText(/Preference: 0/)).toBeVisible()
  await sources.selectOption("")
  const categories = panel.getByLabel("Category preference")
  await expect.poll(() => categories.locator("option").count()).toBeGreaterThan(1)
  const category = await categories.locator("option").nth(1).getAttribute("value")
  await categories.selectOption(category)
  await panel.getByRole("button", { name: "Less from this category" }).click()
  await expect(panel.getByText(/Preference: -1/)).toBeVisible()
  await panel.getByRole("button", { name: "Reset preferences" }).click()
  await expect(panel.getByText(/Preference: 0/)).toBeVisible()
  expect(await mock.mutations()).toEqual([])
  await page.reload()
  await expect(panel.getByRole("button", { name: "Enable editorial tools" })).toBeVisible()
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})

test("NF-E05-2: editorial entries use the normal explicit article link", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/", settings: { markReadBy: "manually" } })
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  const link = panel.locator("ol a").first()
  await expect(link).toBeVisible()
  const href = await link.getAttribute("href")
  expect(href).toMatch(/\/entry\/\d+/)
  expect(await mock.mutations()).toEqual([])
  await link.click()
  await expect(page).toHaveURL(/\/entry\/\d+/)
  expect(await mock.mutations()).toEqual([])
})
