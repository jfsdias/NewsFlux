import process from "node:process"

import { expect, test } from "@playwright/test"

test.skip(process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1", "requires AI enablement")

test("delayed article mount does not publish a false failure", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__readerMountGate = new Promise((resolve) => {
      globalThis.__releaseReaderMount = resolve
    })
  })
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=success",
  )
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("reader-fixture-mounted").length))
    .toBe(1)
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("reader-checks-started").length))
    .toBe(1)
  await expect(page.getByTestId("reader-recovery-report")).not.toHaveAttribute(
    "data-status",
    "fail",
  )
  await page.evaluate(() => globalThis.__releaseReaderMount())
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
})

test("a permanently missing article remains a failure", async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__readerMountGate = new Promise(() => {})
  })
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=success",
  )
  const report = page.getByTestId("reader-recovery-report")
  await expect(report).toHaveAttribute("data-status", "fail")
  await expect(report).toContainText('"ORIGINAL_CONTENT_VISIBLE":false')
  await expect(report).toContainText('"SUMMARY_ACTION_PRESENT":false')
  const result = await page.evaluate(() => globalThis.__contentFallbackReaderReport)
  expect(result.minifluxWrites).toBe(0)
})

test("a missing summary action remains a failure when original content is present", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      document.querySelector(".article-intelligence-summary__action")?.remove()
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=success",
  )
  const report = page.getByTestId("reader-recovery-report")
  await expect(report).toHaveAttribute("data-status", "fail")
  await expect(report).toContainText('"ORIGINAL_CONTENT_VISIBLE":true')
  await expect(report).toContainText('"SUMMARY_ACTION_PRESENT":false')
})

test("missing original content remains a failure when the summary action is present", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      for (const paragraph of document.querySelectorAll("p")) {
        if (paragraph.textContent === "Original Miniflux body stays visible on failure.") {
          paragraph.remove()
        }
      }
    })
    observer.observe(document, { childList: true, subtree: true })
  })
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=success",
  )
  const report = page.getByTestId("reader-recovery-report")
  await expect(report).toHaveAttribute("data-status", "fail")
  await expect(report).toContainText('"ORIGINAL_CONTENT_VISIBLE":false')
  await expect(report).toContainText('"SUMMARY_ACTION_PRESENT":true')
})
