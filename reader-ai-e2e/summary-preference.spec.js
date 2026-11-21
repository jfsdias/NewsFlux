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
// Each picker is a searchable combobox; its options are listed only while it is open.
const primaryPicker = (page) => page.getByRole("combobox", { name: "AI model" })
const fallbackPicker = (page) => page.getByRole("combobox", { name: "Fallback model" })
const openOptions = async (picker, name) => {
  if ((await picker.getAttribute("aria-expanded")) !== "true") {
    await picker.click()
  }
  return picker.page().getByRole("listbox", { name })
}
const primaryGroup = (page) => openOptions(primaryPicker(page), "AI model")
const fallbackGroup = (page) => openOptions(fallbackPicker(page), "Fallback model")
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
  const primaryOptions = await primaryGroup(page)
  const mistral = primaryOptions.getByRole("option", { name: /^Mistral Small/ })
  await expect(mistral).toBeEnabled()
  await expect(mistral).toHaveAccessibleName(/Disabled/)
  await mistral.click()
  await expect(primaryPicker(page)).toHaveValue("Mistral Small")
  const reopened = await primaryGroup(page)
  await expect(reopened.getByRole("option", { name: /^Mistral Small/ })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  await page.keyboard.press("Escape")
  await expect(page.getByText(/Your saved model is not available now/)).toBeVisible()
  await expect(page.getByText(/stays saved but does not run/).first()).toBeVisible()
  // The fallback list never offers the primary; another model can be saved as fallback.
  const fallbackOptions = await fallbackGroup(page)
  await expect(fallbackOptions.getByRole("option", { name: /^Mistral Small/ })).toHaveCount(0)
  const s5 = fallbackOptions.getByRole("option", { name: /^S5/ })
  await expect(s5).toBeEnabled()
  await s5.click()
  await expect(fallbackPicker(page)).toHaveValue("S5")
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
  await expect(primaryPicker(page)).toHaveValue("s5-legacy-removed (saved, no longer offered)")
  const primaryOptions = await primaryGroup(page)
  const removed = primaryOptions.getByRole("option", {
    name: "s5-legacy-removed (saved, no longer offered)",
  })
  await expect(removed).toHaveAttribute("aria-selected", "true")
  await expect(removed).toBeDisabled()
  // A disabled option cannot be chosen, by pointer or keyboard; nothing else replaces it.
  await removed.click({ force: true })
  await expect(removed).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByText(/Your saved model is not available now/)).toBeVisible()
  await expect(fallbackPicker(page)).toHaveValue(
    "mistral-legacy-removed (saved, no longer offered)",
  )
  const fallbackOptions = await fallbackGroup(page)
  const removedFallback = fallbackOptions.getByRole("option", {
    name: "mistral-legacy-removed (saved, no longer offered)",
  })
  await expect(removedFallback).toHaveAttribute("aria-selected", "true")
  await expect(removedFallback).toBeDisabled()
  await page.keyboard.press("Escape")
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
  const fallbackOptions = await fallbackGroup(page)
  await expect(fallbackOptions.getByRole("option", { name: /^Mistral Small/ })).toHaveCount(0)
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

// NEWSFLUX-AI-MODEL-PICKER: with D1 key authority (~17 models) each picker is one compact,
// searchable combobox; only the chosen model's details are shown; every model is listed once.
test("MODEL_PICKER D1: keyboard, search, each model once, details for the chosen model only", async ({
  page,
}) => {
  await page.goto(`${HARNESS}?catalog=d1&primary=auto`)
  const primary = primaryPicker(page)
  await expect(primary).toHaveValue("Automatic — operator default (gpt-4o-mini)")
  await expect(primary).toHaveAttribute("aria-expanded", "false")
  // Closed pickers: no option rows on the page, one details block for the chosen model.
  await expect(page.getByRole("option")).toHaveCount(0)
  await expect(page.locator(".ai-model-option__details")).toHaveCount(1)
  await expect(
    page.getByText("Limits: 16000 input / 4096 output tokens, 30 requests/min"),
  ).toHaveCount(1)

  // Keyboard: ↓ opens on the selected option, typing filters, Enter chooses.
  await primary.focus()
  await page.keyboard.press("ArrowDown")
  await expect(primary).toHaveAttribute("aria-expanded", "true")
  const list = page.getByRole("listbox", { name: "AI model" })
  await expect(list.getByRole("option")).toHaveCount(18)
  const activeId = await primary.getAttribute("aria-activedescendant")
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute("aria-selected", "true")
  await page.keyboard.type("NEMO")
  await expect(list.getByRole("option")).toHaveText([
    "Automatic — operator default (gpt-4o-mini)",
    /^nvidia\/nemotron-3-ultra-550b-a55b:free/,
  ])
  await page.keyboard.press("Enter")
  await expect(primary).toHaveValue("nvidia/nemotron-3-ultra-550b-a55b:free")
  await expect(primary).toHaveAttribute("aria-expanded", "false")
  await expect.poll(() => savedSettings(page)).toContain("gw-d1000000002")

  // No match: announced, nothing chosen; Escape closes the list but not the settings dialog.
  await page.keyboard.press("ArrowDown")
  await page.keyboard.type("no-such-model")
  await expect(
    page.getByRole("status").filter({ hasText: "No models match your search." }),
  ).toHaveCount(1)
  await page.keyboard.press("Escape")
  await expect(primary).toHaveAttribute("aria-expanded", "false")
  await expect(primary).toHaveValue("nvidia/nemotron-3-ultra-550b-a55b:free")
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible()

  // Fallback: every model except the primary, each exactly once; unavailable ones say why.
  await page.getByRole("switch", { name: "Fallback model" }).click()
  const fallback = fallbackPicker(page)
  await expect(fallback).toHaveValue("No fallback")
  await fallback.click()
  const options = page.getByRole("listbox", { name: "Fallback model" }).getByRole("option")
  const names = await options.allInnerTexts()
  const titles = names.map((name) => name.split("\n", 1)[0])
  expect(titles).toHaveLength(17)
  expect(new Set(titles).size).toBe(titles.length)
  expect(titles).not.toContain("nvidia/nemotron-3-ultra-550b-a55b:free")
  await expect(
    page.getByRole("option", { name: /^kimi-k2 moonshot · Compatibility not verified/ }),
  ).toBeEnabled()
  await page.getByRole("option", { name: /^gpt-4o-mini/ }).click()
  await expect(fallback).toHaveValue("gpt-4o-mini")
  await expect(page.locator(".ai-model-option__details")).toHaveCount(2)
  // The cross-provider consent is unchanged: explicit and off.
  const cross = page.getByRole("checkbox", { name: /Allow a fallback from another provider/ })
  await expect(cross).not.toBeChecked()
  await expect(page.getByText(/another provider \(openrouter → openai\)/)).toBeVisible()
  expect(await aiRequests(page)).toEqual(["/api/ai/v1/models"])
})

for (const viewport of [
  { width: 390, height: 844, name: "phone-390" },
  { width: 884, height: 1104, name: "fold-884" },
]) {
  test(`MODEL_PICKER layout ${viewport.name}: the open list fits the screen`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.goto(`${HARNESS}?catalog=d1&primary=auto&fallback=gw-d1000000002`)
    const fallback = fallbackPicker(page)
    await fallback.scrollIntoViewIfNeeded()
    await expect(fallback).toHaveValue("nvidia/nemotron-3-ultra-550b-a55b:free")
    await fallback.click()
    const list = page.getByRole("listbox", { name: "Fallback model" })
    await list.scrollIntoViewIfNeeded()
    await expect(list).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await list.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    // Compact: the list scrolls on its own instead of growing the page.
    expect(box.height).toBeLessThanOrEqual(Math.min(320, viewport.height / 2) + 2)
    await page.screenshot({ path: testInfo.outputPath(`model-picker-${viewport.name}.png`) })
  })
}
