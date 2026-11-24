import { expect, test } from "./support/fixtures.js"

for (const width of [466, 884]) {
  test(`recommendations are opt-in and read-only at ${width}`, async ({ openApp }) => {
    const { context, page } = await openApp({
      path: null,
      width,
      height: 1104,
      settings: { markReadBy: "manually" },
    })
    const writes = []
    const external = []
    context.on("request", (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith("/v1/") && !["GET", "OPTIONS"].includes(request.method())) {
        writes.push(request.method())
      }
      if (["www.cnet.com", "www.nature.com"].includes(url.hostname)) {
        external.push(url.hostname)
      }
    })
    await context.route("**/v1/entries?*", async (route) => {
      const response = await route.fetch()
      const data = await response.json()
      if (Array.isArray(data.entries)) {
        data.entries = data.entries.map((entry) => ({
          ...entry,
          published_at: new Date().toISOString(),
          content: '<a href="https://www.nature.com/news">link</a>',
          feed: {
            ...entry.feed,
            site_url: "https://example.org",
            category: { ...entry.feed?.category, title: "Technology" },
          },
        }))
      }
      await route.fulfill({ response, json: data })
    })
    await page.goto("/")
    const panel = page.getByRole("region", { name: "Recommend sources" })
    const toggle = panel.getByRole("button", { name: "Recommend sources" })
    await expect(toggle).toHaveAttribute("aria-pressed", "false")
    await toggle.click()
    await expect(panel.getByText(/Uses up to 200 currently loaded entries/)).toBeVisible()
    await expect(panel.getByText(/Category: tech/).first()).toBeVisible()
    await expect(panel.getByText(/Linked in .* loaded articles/).first()).toBeVisible()
    await expect(panel.getByLabel("Feed URL (select and copy):").first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(writes).toEqual([])
    expect(external).toEqual([])
    await panel.getByRole("button", { name: "Turn off recommendations" }).click()
    await expect(panel.getByText(/Uses up to 200 currently loaded entries/)).toHaveCount(0)
    await page.reload()
    await expect(panel.getByRole("button", { name: "Recommend sources" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
  })
}
