import process from "node:process"

import { expect, test } from "@playwright/test"

test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)

const openReader = async (page, auto) => {
  await page.goto(
    `/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=deferred-catalog${auto ? "&auto_summary=1" : ""}`,
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await expect(page.getByTestId("article-intelligence-summary")).toBeVisible()
}
const pending = (page) =>
  page.evaluate(() => globalThis.__articleIntelligenceHarness.catalogPending())
const requests = (page) =>
  page.evaluate(() => globalThis.__articleIntelligenceHarness.summaryRequests())
const release = (page) =>
  page.evaluate(() => globalThis.__articleIntelligenceHarness.resolvePendingCatalog())
const result = (page) => page.getByText("Synthetic AI summary for the current article.")

test("revoking automatic consent during catalog lookup prevents article POST", async ({ page }) => {
  await openReader(page, true)
  // This is the real hook's request after the automatic dwell, held at the catalog response.
  await expect.poll(() => pending(page)).toBe(true)
  expect(await requests(page)).toHaveLength(0)
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.revokeAutomaticSummary())
  await release(page)
  await expect.poll(() =>
    page.evaluate(() => globalThis.__articleIntelligenceHarness.catalogReleased()),
  ).toBe(true)
  // Let the released response and React updates settle before checking absence.
  await page.waitForTimeout(500)
  expect(await requests(page)).toHaveLength(0)
  await expect(result(page)).toHaveCount(0)
})

test("retained automatic consent sends one synthetic article request", async ({ page }) => {
  await openReader(page, true)
  await expect.poll(() => pending(page)).toBe(true)
  expect(await requests(page)).toHaveLength(0)
  await release(page)
  await expect(result(page)).toBeVisible()
  const ledger = await requests(page)
  expect(ledger).toHaveLength(1)
  expect(ledger[0].method).toBe("POST")
})

test("manual summary works with automatic consent off", async ({ page }) => {
  await openReader(page, false)
  await page.getByTestId("article-intelligence-summary").getByRole("button").click()
  await expect.poll(() => pending(page)).toBe(true)
  expect(await requests(page)).toHaveLength(0)
  await release(page)
  await expect(result(page)).toBeVisible()
  const ledger = await requests(page)
  expect(ledger).toHaveLength(1)
  expect(ledger[0].method).toBe("POST")
})
