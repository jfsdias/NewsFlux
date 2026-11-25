import { expect, test } from "./support/fixtures.js"

test("visible article figure caption preserves editorial line breaks", async ({ openApp, mock }) => {
  const { page, context, errors } = await openApp({
    path: null,
    settings: { markReadBy: "manually" },
  })
  const entry = await mock.json("/v1/entries/1")
  const body = '<p>Article lead.</p><figure><img alt="Synthetic image" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII="><figcaption>First caption line<br>Second caption line</figcaption></figure><p>Article conclusion.</p>'
  await context.route(`${mock.url}/v1/entries/1`, (route) =>
    route.fulfill({ json: { ...entry, content: body } }),
  )
  await page.goto("/all/entry/1")
  await expect(page.getByText("Article lead.", { exact: true })).toBeVisible()
  const caption = page.locator(".article-content figure figcaption")
  await expect(caption).toHaveCount(1)
  await expect(caption).toContainText("First caption line")
  await expect(caption).toContainText("Second caption line")
  await expect(caption.locator("br")).toHaveCount(1)
  await expect(page.getByText("Article conclusion.", { exact: true })).toBeVisible()
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})
