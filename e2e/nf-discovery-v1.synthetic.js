import { expect, test } from "./support/fixtures.js"

test("suggestions are opt-in, local, filtered and only fill the URL", async ({ openApp, mock }) => {
  const { page, context } = await openApp({ path: "/all", width: 1440, height: 900 })
  await page.getByRole("button", { name: "Add a feed" }).first().click()
  const dialog = page.getByRole("dialog", { name: "Add Feed" })
  const toggle = dialog.getByRole("button", { name: "Browse suggested feeds" })
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  const requests = []
  context.on("request", (request) => requests.push(request.url()))
  await toggle.click()
  await expect(dialog.getByText("CNET", { exact: true })).toHaveCount(0)
  await dialog.getByLabel("Topic").selectOption("tech")
  await dialog.getByLabel("Language").selectOption("en")
  await expect(dialog.getByRole("button", { name: "CNET", exact: true })).toBeVisible()
  await dialog.getByRole("button", { name: "CNET", exact: true }).click()
  await expect(dialog.getByPlaceholder("Enter a website or feed URL")).toHaveValue(
    "https://www.cnet.com/rss/news/",
  )
  expect(requests).toEqual([])
  expect(await mock.mutations()).toEqual([])
  await dialog.getByRole("button", { name: /close/i }).click()
  await page.getByRole("button", { name: "Add a feed" }).first().click()
  await expect(page.getByRole("button", { name: "Browse suggested feeds" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
})
