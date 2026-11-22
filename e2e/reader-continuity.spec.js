import { expect, test } from "./support/fixtures.js"

const longBody = (version) =>
  Array.from(
    { length: 60 },
    (_, index) =>
      `<p>${version} paragraph ${index + 1}: ${"Synthetic article content for continuity. ".repeat(12)}</p>`,
  ).join("")

test("NF-E03-1: reader reload restores matching content without mutations and changed content starts at top", async ({
  openApp,
  mock,
}) => {
  const { page, context } = await openApp({ path: null, settings: { markReadBy: "manually" } })
  const entry = await mock.json("/v1/entries/1")
  let version = "Original"
  await context.route(`${mock.url}/v1/entries/1`, (route) =>
    route.fulfill({ json: { ...entry, content: longBody(version) } }),
  )
  await page.goto("/all/entry/1")
  await expect(page.getByText("Original paragraph 1:", { exact: false })).toBeVisible()
  const scrollArea = page
    .locator(
      ".scroll-container .simplebar-content-wrapper, .scroll-container.adaptive-scroll-area-native",
    )
    .first()
  await expect
    .poll(() => scrollArea.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeGreaterThan(1000)
  // Wait until the asynchronous fingerprint and restoration setup is complete.
  await page.waitForTimeout(500)
  await scrollArea.hover()
  await page.mouse.wheel(0, 800)
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const stored = JSON.parse(localStorage.getItem("reading-continuity-v1") || "null")
        return (
          stored?.records?.find((record) => record.kind === "reader" && record.entryId === 1)
            ?.offset ?? 0
        )
      }),
    )
    .toBeGreaterThan(500)
  const beforeReload = await scrollArea.evaluate((node) => node.scrollTop)
  await page.reload()
  await expect(page.getByText("Original paragraph 1:", { exact: false })).toBeVisible()
  await expect
    .poll(() => scrollArea.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(beforeReload - 50)
  expect(await mock.mutations()).toEqual([])

  version = "Changed"
  await page.reload()
  await expect(page.getByText("Changed paragraph 1:", { exact: false })).toBeVisible()
  await page.waitForTimeout(500)
  expect(await scrollArea.evaluate((node) => node.scrollTop)).toBeLessThan(20)
  expect(await mock.mutations()).toEqual([])
})
