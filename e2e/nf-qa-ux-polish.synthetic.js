import { expect, test } from "./support/fixtures.js"

for (const path of ["/all", "/history"]) {
  test(`list preview bounds ${path}`, async ({ openApp }, testInfo) => {
    const { page, context, errors } = await openApp({ path: null, width: 1440, height: 900 })
    if (path === "/history") {
      await context.route("**/v1/entries?*", async (route) => {
        const url = new URL(route.request().url())
        if (url.searchParams.get("status") !== "read") {
          return route.continue()
        }
        url.searchParams.set("status", "unread")
        const response = await route.fetch({ url: url.toString() })
        const data = await response.json()
        await route.fulfill({
          response,
          json: { ...data, entries: data.entries.map((entry) => ({ ...entry, status: "read" })) },
        })
      })
    }
    await page.goto(path)
    const covers = page.locator(".card-image-wide")
    await expect(covers.first()).toBeVisible()
    for (const cover of await covers.all()) {
      const box = await cover.boundingBox()
      expect(box.height).toBeLessThanOrEqual(184)
      expect(box.width).toBeLessThanOrEqual(1440)
    }
    await page.screenshot({ path: testInfo.outputPath(`list-${path.slice(1)}.png`) })
    expect(errors).toEqual([])
  })
}

test("editorial review exposes methodology and labelled counts", async ({ openApp }, testInfo) => {
  const { page, errors } = await openApp({ path: "/", width: 1440, height: 900 })
  await page.getByRole("button", { name: "Home tools" }).click()
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  await expect(panel.getByText(/Uses up to 250 entries already loaded on Home/)).toBeVisible()
  await panel.getByText("How the editorial tools work").click()
  await expect(panel.getByText(/Based only on up to the first 250 entries/)).toBeVisible()
  await panel.getByText("Review sources in this sample").click()
  const row = panel.locator(".source-review-list li").first()
  await expect(row).toContainText("Entries in sample:")
  await expect(row).toContainText("Possible related coverage:")
  const cells = await row
    .locator(":scope > span")
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x))
  expect(cells[0]).toBeLessThan(cells[1])
  expect(cells[1]).toBeLessThan(cells[2])
  await row.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("editorial-review.png") })
  expect(errors).toEqual([])
})

test("desktop feed rows wrap titles, categories and check age", async ({ openApp }, testInfo) => {
  const { page, context, errors } = await openApp({ path: null, width: 1440, height: 900 })
  await context.route("**/v1/feeds", async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue()
    }
    const response = await route.fetch()
    const feeds = await response.json()
    feeds[0].title =
      "A very long synthetic feed title that should remain fully readable in the table"
    feeds[0].category.title = "A long synthetic category name for wrapping"
    feeds[0].checked_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    await route.fulfill({ response, json: feeds })
  })
  await page.goto("/all")
  await page.locator(".sidebar-profile-trigger:visible").first().click()
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await page.locator('[data-settings-tab-key="feeds"]').click()
  const row = page
    .locator(".feed-table tbody tr")
    .filter({ hasText: "A very long synthetic feed title" })
  await expect(row).toContainText("A long synthetic category name for wrapping")
  await expect(row).toContainText("Checked over 24 hours ago")
  for (const cell of await row.locator("td").all()) {
    const style = await cell.evaluate((element) => ({
      wordBreak: getComputedStyle(element).wordBreak,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      text: element.textContent,
      column: element.cellIndex,
      columnName: element.closest("table")?.querySelectorAll("thead th")[element.cellIndex]
        ?.textContent,
    }))
    const description = `Column ${style.column} (${style.columnName}), text ${JSON.stringify(style.text)}, widths ${style.scrollWidth}/${style.clientWidth}`
    expect(style.wordBreak, description).not.toBe("break-all")
    expect(style.scrollWidth, description).toBeLessThanOrEqual(style.clientWidth + 1)
  }
  await page.screenshot({ path: testInfo.outputPath("feeds.png") })
  expect(errors).toEqual([])
})
