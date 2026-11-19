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

const FALLBACK_ON = `${HARNESS}?fallback=mistral-small`

const languageRow = (page) => page.locator(".setting-row", { hasText: "Summary language" })

// The nearest scrollable ancestor of the language row (the settings modal's scroll area).
const modalScrollTop = (page) =>
  languageRow(page).evaluate((element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const { overflowY } = getComputedStyle(node)
      if (["auto", "scroll"].includes(overflowY) && node.scrollHeight > node.clientHeight) {
        return node.scrollTop
      }
    }
    return null
  })

// The AI controls (#248 catalog, #249 primary/fallback) must be untouched by this visual PR.
const expectPrimaryControls = async (page) => {
  const primary = page.getByRole("radiogroup", { name: "AI model" })
  await expect(primary.getByRole("radio", { name: /^S5/ })).toBeChecked()
  await expect(primary.getByRole("radio", { name: /^S5/ })).toBeEnabled()
  await expect(primary.getByRole("radio", { name: /^Mistral Small/ })).toBeEnabled()
  // Not approved: it can be saved as an inert preference, but never runs.
  await expect(
    primary.getByRole("radio", { name: /^synthetic-long-model-name-from-gateway/ }),
  ).toHaveAccessibleName(/Not approved by the operator/)
  await expect(page.getByRole("switch", { name: "Fallback model" })).toBeVisible()
}

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
    // Fallback on: the longest Article intelligence page (primary + fallback + consents).
    await page.goto(FALLBACK_ON)
    await expect(page.getByText("Summary language", { exact: true })).toBeVisible()
    await expectPrimaryControls(page)

    // No setting row squeezes its title/description column or lets its control overflow
    // (the fallback consents are long sentences).
    const squeezed = await page.locator(".setting-row").evaluateAll((rows) =>
      rows
        .map((row) => {
          const rowBox = row.getBoundingClientRect()
          const header = row.querySelector(".setting-row-header").getBoundingClientRect()
          const control = row.querySelector(".setting-control").getBoundingClientRect()
          const ok = header.width >= 120 && control.right <= rowBox.right + 1
          return ok ? null : row.querySelector(".setting-row-header h6")?.textContent
        })
        .filter(Boolean),
    )
    expect(squeezed).toEqual([])

    // Nothing in the modal overflows sideways (long gateway model names, consent sentences).
    const sideways = await page
      .locator(".settings-modal .arco-modal-content")
      .evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(sideways).toBeLessThanOrEqual(0)

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

    const scrollBefore = await modalScrollTop(page)
    await languageRow(page).locator(".arco-select-view").click()
    const popup = page.locator(".arco-select-popup").last()
    await expect(popup).toBeVisible()
    // Opening the list does not scroll the modal away from the row.
    expect(await modalScrollTop(page)).toBe(scrollBefore)
    // Mounted outside the modal so the modal's overflow cannot cut the list.
    expect(await popup.evaluate((element) => element.closest(".arco-modal") === null)).toBe(true)
    await expect.poll(() => optionsAreReallyVisible(popup)).toEqual([true, true])
    // The whole list, borders and full option texts included, stays inside the screen.
    const fits = await popup.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const optionsFit = [...element.querySelectorAll(".arco-select-option")].every(
        (option) => option.scrollWidth <= option.clientWidth,
      )
      return box.left >= 0 && box.right <= document.documentElement.clientWidth && optionsFit
    })
    expect(fits).toBe(true)
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

test("AI_CONTROLS_PRESERVED fallback off: primary choice and the fallback switch stay available", async ({
  page,
}) => {
  await page.setViewportSize({ width: 884, height: 1104 })
  await page.goto(HARNESS)
  await expectPrimaryControls(page)
  await expect(page.getByRole("switch", { name: "Fallback model" })).not.toBeChecked()
  await expect(page.getByRole("radiogroup", { name: "Fallback model" })).toHaveCount(0)
  // Turning it on reveals the fallback list without the primary model.
  await page.getByRole("switch", { name: "Fallback model" }).click()
  const fallback = page.getByRole("radiogroup", { name: "Fallback model" })
  await expect(fallback.getByRole("radio", { name: "No fallback" })).toBeEnabled()
  await expect(fallback.getByText("No fallback", { exact: true })).toBeVisible()
  await expect(fallback.getByRole("radio", { name: /^S5/ })).toHaveCount(0)
  await expect(fallback.getByRole("radio", { name: /^Mistral Small/ })).toBeEnabled()
})

test("AI_CONTROLS_PRESERVED fallback on: paid and cross-provider consent stay explicit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 884, height: 1104 })
  await page.goto(FALLBACK_ON)
  await expectPrimaryControls(page)
  const fallback = page.getByRole("radiogroup", { name: "Fallback model" })
  await expect(fallback.getByRole("radio", { name: /^Mistral Small/ })).toBeChecked()
  const paid = page.getByRole("checkbox", { name: /Allow a paid fallback/ })
  const cross = page.getByRole("checkbox", { name: /Allow a fallback from another provider/ })
  await expect(paid).not.toBeChecked()
  await expect(cross).not.toBeChecked()
  // Arco hides the native input; the label carries the visible sentence.
  await expect(page.getByText(/another provider \(LiteLLM → Mistral\)/)).toBeVisible()
  await page.getByText(/Allow a paid fallback/).click()
  await expect(paid).toBeChecked()
  await expect(cross).not.toBeChecked() // consents are independent
  // The language select still works with the longer page.
  await languageRow(page).locator(".arco-select-view").click()
  await expect(page.locator(".arco-select-popup").last()).toBeVisible()
})
