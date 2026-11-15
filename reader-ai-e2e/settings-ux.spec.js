import process from "node:process"

import { expect, test } from "@playwright/test"

// Settings → Reading → Article intelligence inside the real settings modal. Visual/UX gate for
// the Summary language select and the setting descriptions (Track D). Emulated viewports only:
// this is not a physical-device verification.
test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)

const HARNESS = "/scripts/tests/settings-ai-ux.html"
const VIEWPORTS = [
  { width: 360, height: 780, name: "phone-360" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 820, height: 1180, name: "tablet-820" },
  { width: 884, height: 1104, name: "fold-884" },
  { width: 1440, height: 900, name: "desktop-1440" },
]

const languageRow = (page) => page.locator(".setting-row", { hasText: "Summary language" })

const optionsAreReallyVisible = (popup) =>
  popup.evaluate((element) =>
    [...element.querySelectorAll(".arco-select-option")].map((option) => {
      const box = option.getBoundingClientRect()
      const x = box.left + box.width / 2
      const y = box.top + box.height / 2
      const top = document.elementFromPoint(x, y)
      return Boolean(top && (top === option || option.contains(top))) && y > 0 && y < innerHeight
    }),
  )

for (const viewport of VIEWPORTS) {
  test(`SETTINGS_UX_LANGUAGE_SELECT ${viewport.name}: value fits, list is not clipped, descriptions keep words whole`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(HARNESS)
    await expect(page.getByText("Summary language", { exact: true })).toBeVisible()

    const value = languageRow(page).locator(".arco-select-view-value")
    await value.scrollIntoViewIfNeeded()
    expect(await value.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

    const brokenWords = await page.locator(".setting-row-header .arco-typography").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element)
          return style.wordBreak === "break-all" || style.overflowWrap === "anywhere"
        }).length,
    )
    expect(brokenWords).toBe(0)

    await languageRow(page).locator(".arco-select-view").click()
    const popup = page.locator(".arco-select-popup").last()
    await expect(popup).toBeVisible()
    // Mounted outside the modal so the modal's overflow cannot cut the list.
    expect(await popup.evaluate((element) => element.closest(".arco-modal") === null)).toBe(true)
    await expect.poll(() => optionsAreReallyVisible(popup)).toEqual([true, true])
    await page.screenshot({ path: testInfo.outputPath(`settings-language-${viewport.name}.png`) })
  })
}

test("SETTINGS_UX_LANGUAGE_SELECT keyboard: open, choose and close without losing focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 884, height: 1104 })
  await page.goto(HARNESS)
  const combobox = languageRow(page).getByRole("combobox")
  await combobox.focus()
  await page.keyboard.press("Enter")
  const popup = page.locator(".arco-select-popup").last()
  await expect(popup).toBeVisible()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(languageRow(page).locator(".arco-select-view-value")).toHaveText(
    "Article's original language (when identifiable)",
  )
  await expect(popup).toBeHidden()
  await expect(combobox).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(popup).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(popup).toBeHidden()
  // Escape closes the list only; the settings modal stays open.
  await expect(page.getByText("Summary language", { exact: true })).toBeVisible()
})

test("SETTINGS_UX_LANGUAGE_SELECT touch: tap selects an option on a phone", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await page.goto(HARNESS)
  await languageRow(page).locator(".arco-select-view").scrollIntoViewIfNeeded()
  await languageRow(page).locator(".arco-select-view").tap()
  const popup = page.locator(".arco-select-popup").last()
  await expect(popup).toBeVisible()
  await popup.getByText("Article's original language (when identifiable)").tap()
  await expect(languageRow(page).locator(".arco-select-view-value")).toHaveText(
    "Article's original language (when identifiable)",
  )
  await context.close()
})

test("SETTINGS_UX_LANGUAGE_SELECT dark theme: popup readable over the modal", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 884, height: 1104 })
  await page.goto(`${HARNESS}?theme=dark`)
  await languageRow(page).locator(".arco-select-view").click()
  const popup = page.locator(".arco-select-popup").last()
  await expect(popup).toBeVisible()
  await expect.poll(() => optionsAreReallyVisible(popup)).toEqual([true, true])
  await page.screenshot({ path: testInfo.outputPath("settings-language-fold-dark.png") })
})
