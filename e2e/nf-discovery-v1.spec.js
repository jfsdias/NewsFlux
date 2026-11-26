import { expect, test } from "./support/fixtures.js"

const expectFooterInViewport = async (dialog) => {
  const footer = dialog.locator(".arco-modal-footer")
  await expect(footer).toBeVisible()
  expect(
    await footer.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top >= 0 && rect.bottom <= window.innerHeight
    }),
  ).toBe(true)
}

const openAddFeed = async (page, width) => {
  if (width <= 992) {
    await page.getByTestId(width <= 768 ? "compact-nav-sources" : "medium-nav-sources").click()
  }
  await page.getByRole("button", { name: "Add a feed" }).first().click()
  return page.getByRole("dialog", { name: "Add Feed" })
}

test("NF-DISCOVERY-3-1: explicit confirmation", async ({ openApp }) => {
  const { page, context } = await openApp({ path: null, width: 1440, height: 600 })
  const posts = []
  let feedGets = 0
  const discoveries = []
  const externalRequests = []
  await context.route("**/v1/feeds", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON())
      return route.fulfill({
        status: 200,
        headers: { "access-control-allow-origin": "*" },
        json: { feed_id: 900 },
      })
    }
    if (route.request().method() !== "GET") {
      return route.continue()
    }
    feedGets += 1
    const response = await route.fetch()
    const feeds = await response.json()
    feeds.push({ ...feeds[0], id: 901, feed_url: "https://www.cnet.com/rss/news" })
    for (const [id, feed_url] of [
      [902, "https://www.sciencedaily.com/rss/all.xml"],
      [903, "https://www.nature.com/nature.rss"],
      [904, "https://phys.org/rss-feed/"],
      [905, "https://www.popsci.com/arcio/rss/"],
    ]) {
      feeds.push({ ...feeds[0], id, feed_url })
    }
    return route.fulfill({ response, json: feeds })
  })
  context.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname === "/v1/discover") {
      discoveries.push(request.method())
    }
    if (["github.com", "www.cnet.com", "news.ycombinator.com"].includes(url.hostname)) {
      externalRequests.push(url.hostname)
    }
  })
  await page.goto("/all")
  await expect(page.locator("a.article-entry").first()).toBeVisible()
  let dialog = await openAddFeed(page, 1440)
  const initialFeedGets = feedGets
  const toggle = dialog.getByRole("button", { name: "Browse suggested feeds" })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(dialog.getByRole("button", { name: "Hacker News" })).toHaveCount(0)
  await dialog.getByLabel("Topic").selectOption("tech")
  await dialog.getByLabel("Language").selectOption("pt")
  await expect(dialog.getByRole("status")).toContainText("No suggestions match")
  await expect(dialog.locator(".feed-suggestions-list")).toHaveCount(0)
  await dialog.getByLabel("Topic").selectOption("science")
  await dialog.getByLabel("Language").selectOption("en")
  await expect(dialog.getByRole("status")).toContainText("No suggestions match")
  await dialog.getByLabel("Topic").selectOption("tech")
  await expect(dialog.getByRole("button", { name: "CNET", exact: true })).toHaveCount(0)
  await expect(dialog.getByRole("status")).toContainText("Topic: Technology · Language: English")
  await expect(dialog.getByRole("button", { name: "The Verge", exact: true })).toBeVisible()
  await expect(dialog.getByRole("button", { name: /Engadget/ })).toBeVisible()
  await expectFooterInViewport(dialog)
  expect(
    await dialog
      .locator(".arco-modal-content")
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true)
  await dialog.getByRole("button", { name: "Hacker News" }).click()
  const input = dialog.getByPlaceholder("Enter a website or feed URL")
  await expect(input).toHaveValue("https://news.ycombinator.com/rss")
  expect(posts).toEqual([])
  expect(discoveries).toEqual([])
  expect(externalRequests).toEqual([])
  expect(feedGets).toBe(initialFeedGets)
  await dialog.locator(".arco-modal-footer .arco-btn-primary").click()
  await expect(dialog.locator(".arco-form-message")).toBeVisible()
  expect(posts).toEqual([])
  await dialog.getByRole("button", { name: /close/i }).click()
  dialog = await openAddFeed(page, 1440)
  await expect(dialog.getByPlaceholder("Enter a website or feed URL")).toHaveValue("")
  await expect(dialog.getByRole("button", { name: "Browse suggested feeds" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await dialog.getByRole("button", { name: "Browse suggested feeds" }).click()
  await expect(dialog.getByLabel("Topic")).toHaveValue("")
  await expect(dialog.getByLabel("Language")).toHaveValue("")
  await dialog.getByLabel("Topic").selectOption("tech")
  await dialog.getByLabel("Language").selectOption("en")
  await dialog.getByRole("button", { name: "Hacker News" }).click()
  await dialog.locator(".arco-select").click()
  await page.getByText("Tecnologia", { exact: true }).last().click()
  await dialog.locator(".arco-modal-footer .arco-btn-primary").click()
  await expect.poll(() => posts.length).toBe(1)
  expect(posts).toEqual([
    { feed_url: "https://news.ycombinator.com/rss", category_id: 1, crawler: false },
  ])
  expect(discoveries).toEqual([])
  expect(externalRequests).toEqual([])
})

for (const width of [466, 884]) {
  for (const theme of ["light", "dark"]) {
    test(`NF-DISCOVERY-3-${width}-${theme}: responsive fit`, async ({ openApp }, testInfo) => {
      const { page } = await openApp({
        path: "/all",
        width,
        height: 650,
        touch: true,
        settings: { themeMode: theme },
      })
      await expect(page.locator("a.article-entry").first()).toBeVisible()
      const dialog = await openAddFeed(page, width)
      await dialog.getByRole("button", { name: "Browse suggested feeds" }).click()
      await dialog.getByLabel("Topic").selectOption("brazil")
      await dialog.getByLabel("Language").selectOption("pt")
      await expectFooterInViewport(dialog)
      const overflow = await dialog
        .locator(".feed-suggestions")
        .evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(overflow).toBe(false)
      await page.screenshot({
        path: testInfo.outputPath(`suggestions-${width}-${theme}.png`),
        fullPage: true,
      })
    })
  }
}
