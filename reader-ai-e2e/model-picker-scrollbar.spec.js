import process from "node:process"

import { expect, test } from "@playwright/test"

// NEWSFLUX-AI-MODEL-PICKER: with a classic (non-overlay) scrollbar, as on Windows/Linux desktops,
// pressing or dragging the open model list's scrollbar must not close the list. The default
// headless launch hides scrollbars, so this file launches Chromium with them shown.
test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } })

const HARNESS = "/scripts/tests/settings-ai-ux.html"
const primaryPicker = (page) => page.getByRole("combobox", { name: "AI model" })

test("MODEL_PICKER pressing the list's scrollbar or padding keeps it open", async ({ page }) => {
  await page.goto(`${HARNESS}?catalog=d1&primary=auto`)
  const primary = primaryPicker(page)
  await primary.click()
  const list = page.getByRole("listbox", { name: "AI model" })
  const { scrollbar, top } = await list.evaluate((element) => ({
    scrollbar: element.offsetWidth - element.clientWidth,
    top: element.scrollTop,
  }))
  expect(scrollbar).toBeGreaterThan(4)
  await list.scrollIntoViewIfNeeded()
  const box = await list.boundingBox()
  // Top padding (not an option), then the scrollbar track near its bottom end.
  await page.mouse.click(box.x + box.width / 2, box.y + 2)
  await page.mouse.click(box.x + box.width - scrollbar / 2, box.y + box.height - 30)
  await expect(primary).toHaveAttribute("aria-expanded", "true")
  await expect(primary).toBeFocused()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(top)
})
