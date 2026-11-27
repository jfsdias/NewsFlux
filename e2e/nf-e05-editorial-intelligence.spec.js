import { expect, test } from "./support/fixtures.js"

test("NF-E05-1: Home editorial controls are opt-in, reversible and local to the session", async ({
  openApp,
  mock,
}) => {
  const { page, errors } = await openApp({ path: "/", settings: { markReadBy: "manually" } })
  await page.getByRole("button", { name: "Home tools" }).click()
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("heading", { name: "Briefing: recent coverage" })).toHaveCount(0)
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  await expect(
    panel.getByText(
      "Uses up to 250 entries already loaded on Home. Editorial tools are optional and do not change your subscriptions.",
    ),
  ).toBeVisible()
  await panel.getByText("How the editorial tools work").click()
  await expect(panel.getByText(/Based only on up to the first 250 entries/)).toBeVisible()
  const sources = panel.getByLabel("Focus on source")
  await expect.poll(() => sources.locator("option").count()).toBeGreaterThan(1)
  const source = await sources.locator("option").nth(1).getAttribute("value")
  await sources.selectOption(source)
  await panel.getByRole("button", { name: "More from this source" }).click()
  await expect(panel.getByText(/Preference: 1/)).toBeVisible()
  await panel.getByRole("button", { name: "Undo last change" }).click()
  await expect(panel.getByText(/Preference: 0/)).toBeVisible()
  await sources.selectOption("")
  const categories = panel.getByLabel("Category preference")
  await expect.poll(() => categories.locator("option").count()).toBeGreaterThan(1)
  const category = await categories.locator("option").nth(1).getAttribute("value")
  await categories.selectOption(category)
  await panel.getByRole("button", { name: "Less from this category" }).click()
  await expect(panel.getByText(/Preference: -1/)).toBeVisible()
  await panel.getByRole("button", { name: "Reset preferences" }).click()
  await expect(panel.getByText(/Preference: 0/)).toBeVisible()
  expect(await mock.mutations()).toEqual([])
  await page.reload()
  await expect(page.getByRole("button", { name: "Home tools" })).toHaveAttribute(
    "aria-expanded",
    "false",
  )
  await expect(panel).toHaveCount(0)
  await page.getByRole("button", { name: "Home tools" }).click()
  await expect(panel.getByRole("button", { name: "Enable editorial tools" })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Enable editorial tools" })).toHaveAttribute(
    "aria-pressed",
    "false",
  )
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})

test("NF-E05-2: editorial entries use the normal explicit article link", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({ path: "/", settings: { markReadBy: "manually" } })
  await page.getByRole("button", { name: "Home tools" }).click()
  const panel = page.getByRole("region", { name: "Editorial tools" })
  await panel.getByRole("button", { name: "Enable editorial tools" }).click()
  const link = panel.locator("ol a").first()
  await expect(link).toBeVisible()
  const href = await link.getAttribute("href")
  expect(href).toMatch(/\/entry\/\d+/)
  expect(await mock.mutations()).toEqual([])
  await link.click()
  await expect(page).toHaveURL(/\/entry\/\d+/)
  expect(await mock.mutations()).toEqual([])
})

test("NF-E05-3: Home tools are one collapsed, keyboard-operable entry that reaches both tools in two interactions", async ({
  openApp,
  mock,
}) => {
  const { page, errors } = await openApp({ path: "/", settings: { markReadBy: "manually" } })
  const trigger = page.getByRole("button", { name: "Home tools" })
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  const controls = await trigger.getAttribute("aria-controls")
  expect(controls).toBeTruthy()
  await expect(page.locator(`#${controls}`)).toBeHidden()
  await expect(page.getByRole("region", { name: "Editorial tools" })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Recommend sources" })).toHaveCount(0)
  // Stories come first: no tool control is rendered before the first Highlights story.
  await expect(page.getByRole("heading", { name: "Highlights", level: 2 })).toBeVisible()
  const box = await trigger.boundingBox()
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await page.waitForLoadState("networkidle")
  const requestsBefore = await mock.requests()

  // Interaction 1: keyboard open. Interaction 2: enable editorial tools.
  await trigger.focus()
  await page.keyboard.press("Enter")
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  const editorial = page.getByRole("region", { name: "Editorial tools" })
  await expect(editorial.getByRole("heading", { name: "Editorial tools", level: 3 })).toBeVisible()
  await editorial.getByRole("button", { name: "Enable editorial tools" }).click()
  await expect(editorial.getByRole("button", { name: "Disable editorial tools" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  // Sections inside the panel keep heading order (h2 Highlights, h3 tool, h4 content).
  await expect(editorial.getByRole("heading", { name: /Briefing/, level: 4 })).toBeVisible()

  // Same two interactions for source recommendations.
  const recommendations = page.getByRole("region", { name: "Recommend sources" })
  await recommendations.getByRole("button", { name: "Recommend sources" }).click()
  await expect(
    recommendations.getByRole("button", { name: "Turn off recommendations" }),
  ).toBeVisible()

  // Escape closes the panel, returns focus to the trigger, and keeps opt-in state.
  await editorial.getByRole("button", { name: "Disable editorial tools" }).focus()
  await page.keyboard.press("Escape")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(trigger).toBeFocused()
  await expect(editorial).toHaveCount(0)
  await trigger.click()
  await expect(editorial.getByRole("button", { name: "Disable editorial tools" })).toBeVisible()

  expect(await mock.requests()).toEqual(requestsBefore)
  expect(await mock.mutations()).toEqual([])
  expect(errors).toEqual([])
})

for (const viewport of [
  { id: "NF-E05-4", name: "390", width: 390, height: 844, touch: true },
  { id: "NF-E05-5", name: "884", width: 884, height: 1104, touch: false },
]) {
  test(`${viewport.id}: at ${viewport.name}px, at least two Highlights headlines are visible on the first screen with a reserved lead cover`, async ({
    openApp,
  }) => {
    const { page, errors } = await openApp({
      path: "/",
      width: viewport.width,
      height: viewport.height,
      touch: viewport.touch,
      settings: { markReadBy: "manually" },
    })
    const titles = page.locator(".home-highlight-slot .grid-card-title")
    await expect(titles.nth(1)).toBeVisible()
    // Reserve for the compact bottom navigation (about 56px) and the viewport edge.
    const limit = viewport.height - (viewport.width < 600 ? 64 : 0)
    for (const index of [0, 1]) {
      const rect = await titles.nth(index).boundingBox()
      expect(rect.y).toBeGreaterThan(0)
      expect(rect.y + rect.height).toBeLessThanOrEqual(limit)
    }
    const media = page.locator(".home-highlight-primary .grid-card-media").first()
    await expect(media).toBeVisible()
    const before = await media.boundingBox()
    expect(before.height).toBeLessThanOrEqual(viewport.height * 0.24 + 1)
    await page.waitForLoadState("networkidle")
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".home-highlight-primary .grid-card-media img")].every(
        (image) => image.complete,
      ),
    )
    const after = await media.boundingBox()
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5)
    expect(errors).toEqual([])
  })
}
