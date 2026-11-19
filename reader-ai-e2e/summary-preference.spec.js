import process from "node:process"

import { expect, test } from "@playwright/test"

// NEWSFLUX-AI-POLICY-FALLBACK-01 P1: primary and fallback are inert preferences saved in the
// existing browser settings. Choosing one approves nothing, enables nothing, sends nothing and
// never swaps in another model; the Summary API stays the final authority. Emulated viewports.
test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)

const HARNESS = "/scripts/tests/settings-ai-ux.html"
const primaryGroup = (page) => page.getByRole("radiogroup", { name: "AI model" })
const fallbackGroup = (page) => page.getByRole("radiogroup", { name: "Fallback model" })
// Admin status reads (GET, 403 for readers) are not summary or write requests.
const aiRequests = (page) =>
  page.evaluate(() =>
    globalThis.__aiRequests.filter((url) => url !== "/api/ai/v1/admin/litellm/status"),
  )
const savedSettings = (page) =>
  page.evaluate(() =>
    Object.entries(globalThis.localStorage)
      .map(([, value]) => value)
      .join("\n"),
  )

test("SUMMARY_PREFERENCE inert catalog: primary and fallback can be saved, nothing runs", async ({
  page,
}) => {
  await page.goto(`${HARNESS}?catalog=inert&fallback=none`)
  const mistral = primaryGroup(page).getByRole("radio", { name: /^Mistral Small/ })
  await expect(mistral).toBeEnabled()
  await expect(mistral).toHaveAccessibleName(/Disabled/)
  await page.getByText("Mistral Small", { exact: true }).first().click()
  await expect(mistral).toBeChecked()
  await expect(page.getByText(/Your saved model is not available now/)).toBeVisible()
  await expect(page.getByText(/stays saved but does not run/).first()).toBeVisible()
  // The fallback list never offers the primary; another model can be saved as fallback.
  await expect(fallbackGroup(page).getByRole("radio", { name: /^Mistral Small/ })).toHaveCount(0)
  const s5 = fallbackGroup(page).getByRole("radio", { name: /^S5/ })
  await expect(s5).toBeEnabled()
  await fallbackGroup(page).getByText("S5", { exact: true }).click()
  await expect(s5).toBeChecked()
  await expect(page.getByText(/Your saved fallback model is not available now/)).toBeVisible()
  await expect(page.getByText(/does not approve a model, turn on summaries/)).toBeVisible()
  // Saved in the existing browser settings only, and nothing else was requested.
  await expect.poll(() => savedSettings(page)).toContain("mistral-small")
  expect(await aiRequests(page)).toEqual(["/api/ai/v1/models"])
})

test("SUMMARY_PREFERENCE a saved model no longer offered stays visible, checked and inert", async ({
  page,
}) => {
  await page.goto(`${HARNESS}?primary=s5-legacy-removed&fallback=mistral-legacy-removed`)
  const removed = primaryGroup(page).getByRole("radio", {
    name: "s5-legacy-removed (saved, no longer offered)",
  })
  await expect(removed).toBeChecked()
  await expect(removed).toBeDisabled()
  await expect(page.getByText(/Your saved model is not available now/)).toBeVisible()
  const removedFallback = fallbackGroup(page).getByRole("radio", {
    name: "mistral-legacy-removed (saved, no longer offered)",
  })
  await expect(removedFallback).toBeChecked()
  await expect(removedFallback).toBeDisabled()
  // No silent substitution: the stored values are unchanged.
  const saved = await savedSettings(page)
  expect(saved).toContain("s5-legacy-removed")
  expect(saved).toContain("mistral-legacy-removed")
  expect(await aiRequests(page)).toEqual(["/api/ai/v1/models"])
})

test("SUMMARY_PREFERENCE primary equal to the saved fallback: warned, never used twice", async ({
  page,
}) => {
  await page.goto(`${HARNESS}?primary=mistral-small&fallback=mistral-small`)
  await expect(page.getByText(/same as the main model, so it will not be used/)).toBeVisible()
  await expect(fallbackGroup(page).getByRole("radio", { name: /^Mistral Small/ })).toHaveCount(0)
})

test("SUMMARY_PREFERENCE available fallback behind an unavailable primary waits", async ({
  page,
}) => {
  await page.goto(`${HARNESS}?primary=gw-synthetic-long-model&fallback=mistral-small`)
  await expect(page.getByText(/only be used once the main model is available/)).toBeVisible()
  await expect(page.getByText(/Your saved model is not available now/)).toBeVisible()
  // Paid consent stays explicit and off; saving a preference never grants it.
  await expect(page.getByRole("checkbox", { name: /Allow a paid fallback/ })).not.toBeChecked()
})

for (const viewport of [
  { width: 360, height: 780, name: "phone-360" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 820, height: 1180, name: "tablet-820" },
  { width: 884, height: 1104, name: "fold-884" },
  { width: 1440, height: 900, name: "desktop-1440" },
]) {
  test(`SUMMARY_PREFERENCE layout ${viewport.name}: saved-but-missing rows fit`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto(`${HARNESS}?catalog=inert&primary=s5-legacy-removed&fallback=mistral-small`)
    const note = page.getByText(/does not approve a model, turn on summaries/)
    await note.scrollIntoViewIfNeeded()
    await expect(note).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await note.boundingBox()
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  })
}
