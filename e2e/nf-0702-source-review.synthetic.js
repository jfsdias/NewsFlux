import { expect, test } from "./support/fixtures.js"

test("source review uses the loaded sample independently of focus without mutations", async ({
  openApp,
  mock,
}) => {
  const { context, page, errors } = await openApp({
    path: null,
    settings: { markReadBy: "manually" },
  })
  const writes = []
  let observeRequests = false
  const requests = []
  context.on("request", (request) => {
    if (observeRequests && new URL(request.url()).pathname.startsWith("/v1/")) {
      requests.push(request.method())
    }
    if (
      new URL(request.url()).pathname.startsWith("/v1/") &&
      !["GET", "OPTIONS"].includes(request.method())
    ) {
      writes.push(request.method())
    }
  })
  await context.route("**/v1/entries?*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== "GET" || url.searchParams.has("starred")) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const data = await response.json()
    const first = data.entries[0]
    const second = data.entries.find((entry) => entry.feed_id !== first?.feed_id)
    if (!first || !second) {
      throw new Error("Synthetic fixture needs two sources")
    }
    const date = new Date().toISOString()
    const entries = [
      { ...first, title: "Major climate agreement reaches global summit", published_at: date },
      {
        ...second,
        title: "Global summit reaches major climate agreement today",
        published_at: date,
      },
    ]
    await route.fulfill({ response, json: { ...data, total: entries.length, entries } })
  })
  await page.goto("/")
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await expect(panel.getByText("Review sources in this sample")).toHaveCount(0)
  await page.waitForLoadState("networkidle")
  observeRequests = true
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  const review = panel
    .locator("details")
    .filter({ has: page.getByText("Review sources in this sample") })
  await expect(review).not.toHaveAttribute("open", "")
  await review.locator("summary").click()
  await expect(review.getByText(/These counts are not reading history/)).toBeVisible()
  const rows = review.locator("li")
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText("1 entries in sample; 1 in possible related coverage")
  await expect(rows.nth(1)).toContainText("1 entries in sample; 1 in possible related coverage")
  const source = await panel
    .getByLabel("Focus on source")
    .locator("option")
    .nth(1)
    .getAttribute("value")
  await panel.getByLabel("Focus on source").selectOption(source)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText("1 entries in sample; 1 in possible related coverage")
  expect(requests).toEqual([])
  expect(writes).toEqual([])
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})
