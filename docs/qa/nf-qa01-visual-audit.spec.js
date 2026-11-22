import path from "node:path"
import { pathToFileURL } from "node:url"

// Run from the exact NewsFlux checkout so the audited fixture comes from that source SHA.
const repoRoot = process.cwd()
const fixtureUrl = pathToFileURL(path.join(repoRoot, "e2e/support/fixtures.js")).href
const { test, expect } = await import(fixtureUrl)

const viewports = [
  { name: "phone-390x844", width: 390, height: 844, touch: true },
  { name: "critical-884x1104", width: 884, height: 1104, touch: true },
  { name: "desktop-1440x900", width: 1440, height: 900, touch: false },
]

const themes = ["light", "dark"]
const output = (surface, viewport, theme, state = "default") =>
  `${surface}--${viewport}--${theme}--${state}.png`

const settle = async (page) => {
  await page.evaluate(() => document.fonts.ready)
}

const assertNoOverflow = async (page, label) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  )
  expect(overflow, `${label}: unexpected horizontal overflow`).toBe(false)
}

const openAppearanceSettings = async (page, viewport) => {
  await expect(page.locator("a.article-entry").first()).toBeVisible()
  if (viewport.width <= 992) {
    const sources = page.getByTestId(viewport.width <= 768 ? "compact-nav-sources" : "medium-nav-sources")
    await expect(sources).toBeVisible()
    await sources.click()
    await expect(page.locator(".sidebar-drawer .mobile-sidebar-close")).toBeVisible()
    await page.locator(".sidebar-drawer .sidebar-profile-trigger").click()
  } else {
    await page.locator(".sidebar-profile-trigger:visible").first().click()
  }
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.locator('[data-settings-tab-key="appearance"]')).toBeVisible()
  await page.locator('[data-settings-tab-key="appearance"]').click()
  await expect(page.locator('[data-settings-panel-key="appearance"]')).toBeVisible()
}

test.describe("NF-QA01 ephemeral visual evidence", () => {
  for (const viewport of viewports) {
    for (const theme of themes) {
      test(`Home ${viewport.name} ${theme}`, async ({ openApp }, testInfo) => {
        const { page, errors } = await openApp({
          path: "/",
          width: viewport.width,
          height: viewport.height,
          touch: viewport.touch,
          settings: { themeMode: theme },
        })
        await settle(page)
        await expect(page.locator("a.article-entry").first()).toBeVisible()
        const panel = page.getByRole("region", { name: "Editorial tools" })
        await expect(panel).toBeVisible()
        await expect(panel.getByRole("button", { name: "Enable editorial tools" })).toBeVisible()
        await assertNoOverflow(page, "Home")
        expect(errors).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(output("home", viewport.name, theme, "baseline")),
          fullPage: true,
          animations: "disabled",
        })
        await panel.getByRole("button", { name: "Enable editorial tools" }).click()
        await expect(panel.getByText(/Based only on up to the first 250 entries/)).toBeVisible()
        await expect(panel.locator("ol a").first()).toBeVisible()
        await page.screenshot({
          path: testInfo.outputPath(output("home", viewport.name, theme, "editorial-enabled")),
          fullPage: true,
          animations: "disabled",
        })
      })

      test(`Smart Views ${viewport.name} ${theme}`, async ({ openApp }, testInfo) => {
        const { page, errors } = await openApp({
          path: "/all",
          width: viewport.width,
          height: viewport.height,
          touch: viewport.touch,
          settings: { themeMode: theme },
        })
        await settle(page)
        await expect(page.locator("a.article-entry").first()).toBeVisible()
        await page.getByRole("button", { name: /^Search(?::|$)/ }).first().click()
        await expect(page.getByRole("dialog")).toBeVisible()
        const query = page.getByLabel("Search article titles and content")
        await query.fill('"Notícia 4"')
        await page.getByLabel("View name").fill("NF-QA01 saved view")
        await page.getByRole("button", { name: "Save this search" }).click()
        await expect(page.getByText("View saved on this browser.")).toBeVisible()
        await expect(page.locator('[aria-label="Saved views"]')).toContainText("NF-QA01 saved view")
        await assertNoOverflow(page, "Smart Views dialog")
        expect(errors).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(output("smart-views", viewport.name, theme, "populated")),
          fullPage: true,
          animations: "disabled",
        })
      })

      test(`Reader ${viewport.name} ${theme}`, async ({ openApp }, testInfo) => {
        const { page, errors } = await openApp({
          path: "/all/entry/3",
          width: viewport.width,
          height: viewport.height,
          touch: viewport.touch,
          settings: { themeMode: theme },
        })
        await settle(page)
        await expect(page.locator(".article-body")).toBeVisible()
        await expect(page.locator(".article-body p").first()).toBeVisible()
        await expect(page.getByRole("button", { name: "Close article" })).toBeVisible()
        await assertNoOverflow(page, "Reader")
        expect(errors).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(output("reader", viewport.name, theme, "top")),
          fullPage: true,
          animations: "disabled",
        })
        await page.locator(".article-body").evaluate((element) =>
          element.scrollIntoView({ block: "end" }),
        )
        await page.waitForTimeout(250)
        await page.screenshot({
          path: testInfo.outputPath(output("reader", viewport.name, theme, "body")),
          fullPage: false,
          animations: "disabled",
        })
      })

      test(`Appearance settings ${viewport.name} ${theme}`, async ({ openApp }, testInfo) => {
        const { page, errors } = await openApp({
          path: "/all",
          width: viewport.width,
          height: viewport.height,
          touch: viewport.touch,
          settings: { themeMode: theme },
        })
        await settle(page)
        await openAppearanceSettings(page, viewport)
        await expect(page.locator('[data-settings-panel-key="appearance"]')).toBeVisible()
        await assertNoOverflow(page, "Appearance settings")
        expect(errors).toEqual([])
        await page.screenshot({
          path: testInfo.outputPath(output("settings-appearance", viewport.name, theme)),
          fullPage: true,
          animations: "disabled",
        })
      })
    }
  }
})
