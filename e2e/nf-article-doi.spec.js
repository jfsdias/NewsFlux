import { expect, test } from "./support/fixtures.js"

test("NF-DOI-1: explicit DOI identity preserves source and article", async ({ openApp, mock }) => {
  const { page, context, errors } = await openApp({
    path: null,
    width: 320,
    settings: { markReadBy: "manually" },
  })
  const entry = await mock.json("/v1/entries/1")
  const url = `https://doi.org/10.1234/${"longidentifier".repeat(8)}`
  const externalRequests = []
  context.on("request", (request) => {
    if (new URL(request.url()).hostname === "doi.org") {
      externalRequests.push(request.url())
    }
  })
  await context.route(`${mock.url}/v1/entries/1`, (route) =>
    route.fulfill({ json: { ...entry, url, content: "<p>Visible academic excerpt.</p>" } }),
  )
  await page.goto("/all/entry/1")
  await expect(page.locator(".article-doi")).toHaveText(`DOI: ${url}`)
  await expect(page.locator(".article-doi a")).toHaveAttribute("href", url)
  const doiOverflows = await page
    .locator(".article-doi")
    .evaluate((element) => element.scrollWidth > element.clientWidth)
  expect(doiOverflows).toBe(false)
  await expect(page.locator(".article-title a")).toHaveAttribute("href", url)
  await expect(page.getByText("Visible academic excerpt.", { exact: true })).toBeVisible()
  expect(externalRequests).toEqual([])
  await page.goto("/all/entry/2")
  await expect(page.locator(".article-body p").first()).toBeVisible()
  await expect(page.locator(".article-doi")).toHaveCount(0)
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})
