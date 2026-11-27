import { expect, test } from "#e2e/support/fixtures.js"

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
    const query = url.searchParams
    const isInitialHomeSample =
      request.method() === "GET" &&
      query.get("status") === "unread" &&
      query.get("order") === "published_at" &&
      query.get("direction") === "desc" &&
      Number(query.get("limit")) > 1 &&
      !["starred", "published_before", "published_after", "before_entry_id", "offset"].some((key) =>
        query.has(key),
      )
    if (!isInitialHomeSample) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const data = await response.json()
    const first = data.entries[0]
    const second = data.entries.find((entry) => entry.feed_id !== first?.feed_id)
    if (!first || !second) {
      await route.fulfill({ response })
      return
    }
    const now = Date.now()
    const entries = [
      {
        ...first,
        title: "Major climate agreement reaches global summit",
        published_at: new Date(now).toISOString(),
      },
      {
        ...second,
        title: "Global summit reaches major climate agreement today",
        published_at: new Date(now - 60_000).toISOString(),
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
  await expect(panel.getByText(/Uses up to 250 entries already loaded on Home/)).toBeVisible()
  await expect(panel.getByText("How the editorial tools work")).toBeVisible()
  const review = panel
    .locator("details")
    .filter({ has: page.getByText("Review sources in this sample") })
  await expect(review).not.toHaveAttribute("open", "")
  await review.locator("summary").click()
  await expect(review.getByText(/These counts are not reading history/)).toBeVisible()
  await expect(
    review.locator(".source-review-heading").getByText("Entries in sample"),
  ).toBeVisible()
  await expect(
    review.locator(".source-review-heading").getByText("Possible related coverage"),
  ).toBeVisible()
  const rows = review.locator("li")
  await expect(rows).toHaveCount(2)
  const columns = await rows
    .first()
    .locator(":scope > span")
    .evaluateAll((cells) =>
      cells.map((cell) => ({
        x: cell.getBoundingClientRect().x,
        width: cell.getBoundingClientRect().width,
      })),
    )
  expect(columns).toHaveLength(3)
  expect(columns.every((cell) => cell.width > 0)).toBe(true)
  expect(columns[0].x).toBeLessThan(columns[1].x)
  expect(columns[1].x).toBeLessThan(columns[2].x)
  for (const row of await rows.all()) {
    await expect(row).toContainText("Entries in sample: 1")
    await expect(row).toContainText("Possible related coverage: 1")
  }
  const source = await panel
    .getByLabel("Focus on source")
    .locator("option")
    .nth(1)
    .getAttribute("value")
  await panel.getByLabel("Focus on source").selectOption(source)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText("Entries in sample: 1")
  await expect(rows.nth(1)).toContainText("Possible related coverage: 1")
  expect(requests).toEqual([])
  expect(writes).toEqual([])
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})
