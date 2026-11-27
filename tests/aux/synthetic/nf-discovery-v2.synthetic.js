import { expect, test } from "#e2e/support/fixtures.js"

for (const width of [466, 884]) {
  for (const theme of ["light", "dark"]) {
    test(`recommendations: ${width}px ${theme}, explicit add and reset`, async ({
      openApp,
    }, testInfo) => {
      const { context, page } = await openApp({
        path: null,
        width,
        height: 1104,
        touch: true,
        settings: { themeMode: theme, markReadBy: "manually" },
      })
      const posts = []
      const requests = []
      let observe = false
      context.on("request", (request) => {
        if (observe) {
          requests.push({ url: request.url(), method: request.method() })
        }
      })
      await context.route("**/v1/feeds", async (route) => {
        if (route.request().method() === "POST") {
          posts.push(route.request().postDataJSON())
          return route.fulfill({
            status: 200,
            headers: { "access-control-allow-origin": "*" },
            json: { feed_id: 900 },
          })
        }
        const response = await route.fetch()
        const feeds = await response.json()
        feeds.push({ ...feeds[0], id: 901, feed_url: "https://www.cnet.com/rss/news/" })
        return route.fulfill({ response, json: feeds })
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
      await page.getByRole("button", { name: "Home tools" }).click()
      const panel = page.getByRole("region", { name: "Recommend sources" })
      const toggle = panel.getByRole("button", { name: "Recommend sources" })
      await expect(toggle).toHaveAttribute("aria-pressed", "false")
      await page.waitForLoadState("networkidle")
      observe = true
      await toggle.click()
      await expect(panel.getByText(/Suggestions use your recently loaded articles/)).toBeVisible()
      const details = panel.getByText("How suggestions work")
      await expect(panel.getByText(/Uses up to 200 currently loaded entries/)).toBeHidden()
      await details.focus()
      await page.keyboard.press("Enter")
      await expect(panel.getByText(/Uses up to 200 currently loaded entries/)).toBeVisible()
      await expect(
        panel.getByText(/current read and starred marks, not when those marks occurred/),
      ).toBeVisible()
      await expect(panel.getByText(/Category: tech/).first()).toBeVisible()
      await expect(panel.getByText(/Linked in .* loaded articles/).first()).toBeVisible()
      await expect(panel.getByText("CNET", { exact: true })).toHaveCount(0)
      const urlField = panel.getByLabel("Feed URL (select and copy):").first()
      await expect(urlField).toBeVisible()
      await urlField.focus()
      const selected = await urlField.evaluate((element) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      )
      expect(selected).toMatch(/^https:\/\//u)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      )
      await page.screenshot({
        path: testInfo.outputPath(`discovery-${width}-${theme}.png`),
        fullPage: true,
      })
      expect(requests.filter(({ url }) => new URL(url).pathname.startsWith("/v1/"))).toEqual([])
      expect(
        requests.filter(({ url }) =>
          ["www.cnet.com", "www.nature.com", "news.ycombinator.com"].includes(
            new URL(url).hostname,
          ),
        ),
      ).toEqual([])
      expect(posts).toEqual([])
      await panel.getByRole("button", { name: "Turn off recommendations" }).click()
      await expect(panel.getByText(/Uses up to 200 currently loaded entries/)).toHaveCount(0)
      await panel.getByRole("button", { name: "Recommend sources" }).click()
      await panel.getByRole("button", { name: "Open Add Feed" }).first().click()
      const dialog = page.getByRole("dialog", { name: "Add Feed" })
      await expect(dialog.getByPlaceholder("Enter a website or feed URL")).toHaveValue("")
      await dialog.getByPlaceholder("Enter a website or feed URL").fill(selected)
      expect(posts).toEqual([])
      expect(requests.filter(({ url }) => new URL(url).pathname === "/v1/discover")).toEqual([])
      await dialog.locator(".arco-modal-footer .arco-btn-primary").click()
      await expect(dialog.locator(".arco-form-message")).toBeVisible()
      expect(posts).toEqual([])
      await dialog.locator(".arco-select").click()
      await page.getByText("Tecnologia", { exact: true }).last().click()
      expect(posts).toEqual([])
      await dialog.locator(".arco-modal-footer .arco-btn-primary").click()
      await expect.poll(() => posts.length).toBe(1)
      expect(posts[0]).toEqual({ feed_url: selected, category_id: 1, crawler: false })
      expect(requests.filter(({ url }) => new URL(url).pathname === "/v1/discover")).toEqual([])
      await page.reload()
      await expect(panel.getByRole("button", { name: "Recommend sources" })).toHaveAttribute(
        "aria-pressed",
        "false",
      )
    })
  }
}

test("recommendations stay unavailable when the feed catalog fails", async ({ openApp }) => {
  const { context, page } = await openApp({ path: null, settings: { markReadBy: "manually" } })
  await context.route("**/v1/feeds", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 503,
        headers: { "access-control-allow-origin": "*" },
        json: { error: "unavailable" },
      })
    }
    return route.continue()
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Home tools" }).click()
  const panel = page.getByRole("region", { name: "Recommend sources" })
  await panel.getByRole("button", { name: "Recommend sources" }).click()
  await expect(panel.getByRole("status")).toContainText(
    "unavailable until your feed catalog loads successfully",
  )
  await expect(panel.getByLabel("Feed URL (select and copy):")).toHaveCount(0)
})

test("empty recommendations offer Add Feed without a request or subscription", async ({
  openApp,
}) => {
  const { context, page } = await openApp({ path: null, settings: { markReadBy: "manually" } })
  const mutations = []
  context.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/v1\/(feeds|discover)$/u.test(new URL(request.url()).pathname)
    ) {
      mutations.push(request.url())
    }
  })
  await context.route("**/v1/entries?*", async (route) => {
    const response = await route.fetch()
    const data = await response.json()
    if (Array.isArray(data.entries)) {
      data.entries = data.entries.map((entry) => ({
        ...entry,
        feed: { ...entry.feed, category: { ...entry.feed?.category, title: "Unmatched category" } },
      }))
    }
    await route.fulfill({ response, json: data })
  })
  await page.goto("/")
  await page.getByRole("button", { name: "Home tools" }).click()
  const panel = page.getByRole("region", { name: "Recommend sources" })
  await panel.getByRole("button", { name: "Recommend sources" }).click()
  await expect(panel.getByText(/No suggestions match/)).toBeVisible()
  await panel.getByRole("button", { name: "Open Add Feed" }).click()
  await expect(page.getByRole("dialog", { name: "Add Feed" })).toBeVisible()
  expect(mutations).toEqual([])
})
