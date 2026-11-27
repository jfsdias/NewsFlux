import { expect, test } from "#e2e/support/fixtures.js"

const viewports = [
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "critical", width: 884, height: 1104, touch: true },
  { name: "desktop", width: 1440, height: 900, touch: false },
]

for (const viewport of viewports) {
  for (const theme of ["light", "dark"]) {
    test(`${viewport.width <= 768 ? "phone Settings availability" : "feed health"} ${viewport.name} ${theme}`, async ({
      openApp,
      mock,
    }, testInfo) => {
      const { context, page, errors } = await openApp({
        path: null,
        ...viewport,
        settings: { themeMode: theme, markReadBy: "manually" },
      })
      let feedGets = 0
      const writes = []
      context.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith("/v1/feeds") &&
          !["GET", "OPTIONS"].includes(request.method())
        ) {
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
        }
      })
      await context.route("**/v1/feeds", async (route) => {
        if (route.request().method() !== "GET") {
          return route.continue()
        }
        feedGets += 1
        const response = await route.fetch()
        const feeds = await response.json()
        const recent = new Date().toISOString()
        const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
        for (const feed of feeds) {
          feed.checked_at = recent
        }
        Object.assign(feeds[0], { parsing_error_count: 2 })
        Object.assign(feeds[1], { parsing_error_count: 1, disabled: true })
        Object.assign(feeds[2], { parsing_error_count: null, checked_at: "0001-01-01T00:00:00Z" })
        Object.assign(feeds[3], { checked_at: old })
        await route.fulfill({ response, json: feeds })
      })
      await page.goto("/all")
      await expect(page.locator("a.article-entry").first()).toBeVisible()
      if (viewport.width <= 992) {
        await page
          .getByTestId(viewport.width <= 768 ? "compact-nav-sources" : "medium-nav-sources")
          .click()
        await page.locator(".sidebar-drawer .sidebar-profile-trigger").click()
      } else {
        await page.locator(".sidebar-profile-trigger:visible").first().click()
      }
      await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
      if (viewport.width <= 768) {
        await expect(page.getByRole("dialog")).toBeVisible()
        await expect(page.locator('[data-settings-tab-key="feeds"]')).toHaveCount(0)
        await expect(page.getByRole("region", { name: "Feed health" })).toHaveCount(0)
        await page.locator('[data-settings-tab-key="appearance"]').click()
        await expect(page.locator('[data-settings-panel-key="appearance"]')).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(`phone-settings-${theme}.png`),
          fullPage: true,
        })
        expect(writes).toEqual([])
        expect(await mock.mutations()).toEqual([])
        expect(errors).toEqual([])
        return
      }
      await page.locator('[data-settings-tab-key="feeds"]').click()
      const dashboard = page.getByRole("region", { name: "Feed health" })
      await expect(dashboard).toBeVisible()
      const expected = {
        Feeds: "8",
        "Provider-reported errors": "2",
        "Error status unknown": "1",
        Disabled: "1",
        "Checked within 24 hours": "6",
        "Checked over 24 hours ago": "1",
        "Check time unknown": "1",
      }
      for (const [label, count] of Object.entries(expected)) {
        await expect(
          dashboard
            .locator("div")
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator("dd"),
        ).toHaveText(count)
      }
      const getsBeforeSearch = feedGets
      const search = page
        .locator(".feed-table-action-bar")
        .getByRole("textbox", { name: "Search..." })
      await search.fill("Alfa Tech")
      await expect(
        page.locator(".feed-table tbody tr").filter({ hasText: "Alfa Tech" }),
      ).toBeVisible()
      await expect(
        page.locator(".feed-table tbody tr").filter({ hasText: "Beta Mundo" }),
      ).toHaveCount(0)
      await expect(dashboard.locator("dd")).toHaveText(Object.values(expected))
      expect(feedGets).toBe(getsBeforeSearch)
      await search.clear()
      await expect(
        page.locator(".feed-table tbody tr").filter({ hasText: "Beta Mundo" }),
      ).toContainText("Disabled")
      await page.screenshot({
        path: testInfo.outputPath(`feed-health-${viewport.name}-${theme}.png`),
        fullPage: true,
      })
      expect(writes).toEqual([])
      expect(await mock.mutations()).toEqual([])
      expect(errors).toEqual([])
    })
  }
}
