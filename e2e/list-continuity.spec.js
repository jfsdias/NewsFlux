import { expect, test } from "./support/fixtures.js"

test("NF-E03-2: list resume remains scoped and does not mark entries read", async ({
  openApp,
  mock,
}) => {
  await mock.inject(60)
  const { page } = await openApp({
    path: "/all",
    settings: { markReadOnScroll: true, markReadBy: "manually", showStatus: "all" },
  })
  const list = page.locator(
    ".entry-list.adaptive-scroll-area-native, .entry-list .simplebar-content-wrapper",
  )
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem("settings")).markReadOnScroll),
  ).toBe(true)
  await expect(page.locator("[data-entry-id]").first()).toBeVisible()
  await list.hover()
  await page.mouse.wheel(0, 800)
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("reading-continuity-v1") || "{}").records?.length || 0,
      ),
    )
    .toBeGreaterThan(0)
  await page.reload()
  const resume = page.getByRole("button", { name: "Resume list position" })
  await expect(resume).toBeVisible()
  const before = await mock.mutations()
  await resume.click()
  await expect(resume).toBeHidden()
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(100)
  await page.waitForTimeout(300)
  expect(await mock.mutations()).toEqual(before)
  // Natural scrolling after the programmatic restoration must still mark entries read.
  await list.hover()
  await page.mouse.wheel(0, 800)
  await page.mouse.wheel(0, 800)
  await expect
    .poll(async () => {
      const mutations = await mock.mutations()
      return mutations.length
    })
    .toBeGreaterThan(before.length)
  await page.goto("/starred")
  await expect(page.getByRole("button", { name: "Resume list position" })).toHaveCount(0)
})
