import process from "node:process"

import { expect, test } from "@playwright/test"

test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)

const openReader = async (page, mode, viewport) => {
  await page.setViewportSize(viewport)
  await page.goto(
    `/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=${mode}`,
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await expect(page.getByTestId("article-intelligence-summary")).toBeVisible()
}

const summaryButton = (page) => page.getByTestId("article-intelligence-summary").getByRole("button")

test("explicit summary action renders grounded output without changing the article", async ({
  page,
}) => {
  await openReader(page, "success", { width: 390, height: 844 })
  await expect(page.getByText("Original Miniflux body stays visible on failure.")).toBeVisible()
  await expect(summaryButton(page)).toBeVisible()
  await expect(page.getByTestId("reader-recovery-report")).toContainText(
    '"NO_SUMMARY_BEFORE_ACTIVATION":true',
  )

  const actionReceivesPointer = await summaryButton(page).evaluate((button) => {
    const rect = button.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return hit === button || button.contains(hit)
  })
  expect(actionReceivesPointer).toBe(true)

  await summaryButton(page).click()
  await expect(page.getByText("Synthetic AI summary for the current article.")).toBeVisible()
  await expect(page.getByText("Synthetic grounded key point.")).toBeVisible()
  await expect(page.getByText("Synthetic grounded action.")).toBeVisible()
  await expect(page.getByText("Only the available Miniflux text was summarized.")).toBeVisible()
  await expect(page.getByText("This summary may cover only part of the article.")).toBeVisible()
  await expect(page.getByText("Original Miniflux body stays visible on failure.")).toBeVisible()

  const report = await page.evaluate(() => globalThis.__contentFallbackReaderReport)
  expect(report.minifluxWrites).toBe(0)
  expect(report.articleSummaryRequests).toHaveLength(1)
  expect(report.articleSummaryRequests[0].path).toBe("/api/ai/v1/entries/501/summary")
  expect(report.articleSummaryRequests[0].method).toBe("POST")
  expect(report.articleSummaryRequests[0].headerNames).toEqual([
    "Content-Type",
    "X-Miniflux-API-Key",
    "X-NewsFlux-Miniflux-Server",
  ])
  expect(report.articleSummaryRequests[0].bodyKeys).toEqual([
    "profile_id",
    "request_id",
    "schema_version",
  ])

  await page.setViewportSize({ width: 884, height: 1104 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const box = await page.getByTestId("article-intelligence-summary").boundingBox()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(885)
})

test("loading is announced; a safe error remains recoverable with the original body visible", async ({
  page,
}) => {
  await openReader(page, "loading", { width: 884, height: 1104 })
  await summaryButton(page).click()
  await expect(summaryButton(page)).toBeDisabled()
  await expect(page.getByRole("status").filter({ hasText: "Generating summary" })).toBeVisible()
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.resolvePendingSummary())
  await expect(page.getByText("Synthetic AI summary for the current article.")).toBeVisible()

  await openReader(page, "retry", { width: 884, height: 1104 })
  await summaryButton(page).click()
  await expect(
    page.getByText("The summary could not be created. The original article is unchanged."),
  ).toBeVisible()
  await expect(summaryButton(page)).toBeEnabled()
  await summaryButton(page).click()
  await expect(page.getByText("Synthetic AI summary for the current article.")).toBeVisible()
  await expect(page.getByText("Original Miniflux body stays visible on failure.")).toBeVisible()

  const report = await page.evaluate(() => globalThis.__contentFallbackReaderReport)
  expect(report.articleSummaryRequests).toHaveLength(2)
  expect(report.minifluxWrites).toBe(0)
})

test("a late summary is discarded after navigating to another article", async ({ page }) => {
  await openReader(page, "stale", { width: 884, height: 1104 })
  await summaryButton(page).click()
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.__articleIntelligenceHarness.summaryRequests().length),
    )
    .toBe(1)

  await page.evaluate(() => globalThis.__articleIntelligenceHarness.navigateToOther())
  await expect(page.getByText("Original body for entry 502.")).toBeVisible()
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.resolvePendingSummary())
  await expect(page.getByText("Synthetic AI summary for the current article.")).toHaveCount(0)
  await expect(page.getByText("Original body for entry 502.")).toBeVisible()

  const report = await page.evaluate(() => globalThis.__contentFallbackReaderReport)
  expect(report.articleSummaryRequests).toHaveLength(1)
  expect(report.minifluxWrites).toBe(0)
})

test("a late summary is discarded after the Miniflux account session changes", async ({ page }) => {
  await openReader(page, "stale", { width: 884, height: 1104 })
  await summaryButton(page).click()
  await expect
    .poll(() =>
      page.evaluate(() => globalThis.__articleIntelligenceHarness.summaryRequests().length),
    )
    .toBe(1)

  await page.evaluate(() => globalThis.__articleIntelligenceHarness.changeSession())
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.resolvePendingSummary())
  await expect(page.getByText("Synthetic AI summary for the current article.")).toHaveCount(0)
  await expect(page.getByText("Original Miniflux body stays visible on failure.")).toBeVisible()

  const report = await page.evaluate(() => globalThis.__contentFallbackReaderReport)
  expect(report.articleSummaryRequests).toHaveLength(1)
  expect(report.minifluxWrites).toBe(0)
})
