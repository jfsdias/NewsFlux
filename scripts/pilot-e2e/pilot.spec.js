/* eslint-disable unicorn/no-await-expression-member -- Playwright API responses are evaluated only in this synthetic test. */
import { expect, test } from "@playwright/test"

test("opening and navigating articles never starts inference", async ({ page, request }) => {
  await request.post("/__pilot/mode/success")
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.navigateToOther())
  await expect(page.getByText("Original body for entry 502.")).toBeVisible()
  const metrics = await (await request.get("/__pilot/metrics")).json()
  expect(metrics.inference_calls).toBe(0)
  expect(metrics.miniflux_methods).toEqual([])
})

test("explicit Reader action reaches the real Summary API and synthetic gateway once", async ({
  page,
  request,
}) => {
  await request.post("/__pilot/mode/success")
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  expect((await (await request.get("/__pilot/metrics")).json()).inference_calls).toBe(0)
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect(page.getByText("Synthetic pilot summary.")).toBeVisible()
  await expect(page.getByText("Synthetic pilot key point.")).toBeVisible()
  await expect(page.getByText("Synthetic pilot action.")).toBeVisible()
  await expect(page.getByText(/Miniflux does not establish/)).toBeVisible()
  const metrics = await (await request.get("/__pilot/metrics")).json()
  expect(metrics.inference_calls).toBe(1)
  expect(metrics.miniflux_methods).toEqual(["GET", "GET", "GET", "GET"])
})

for (const scenario of [
  {
    mode: "short",
    expected: "There is not enough article text to create a reliable summary.",
    calls: 0,
  },
  { mode: "failure", expected: "A summary is not available right now.", calls: 1 },
  {
    mode: "denied",
    expected: "The summary could not be created. The original article is unchanged.",
    calls: 0,
  },
]) {
  test(`explicit request handles ${scenario.mode} without prefetch`, async ({ page, request }) => {
    await request.post(`/__pilot/mode/${scenario.mode}`)
    await page.goto(
      "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
    )
    await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
    const before = await (await request.get("/__pilot/metrics")).json()
    expect(before.inference_calls).toBe(0)
    await page.getByRole("button", { name: "Summarize with AI" }).click()
    await expect(page.getByText(scenario.expected)).toBeVisible()
    const after = await (await request.get("/__pilot/metrics")).json()
    expect(after.inference_calls).toBe(scenario.calls)
    expect(after.miniflux_methods.every((method) => method === "GET")).toBe(true)
  })
}

test("navigation discards a late real API response", async ({ page, request }) => {
  await request.post("/__pilot/mode/delayed")
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect
    .poll(async () => (await (await request.get("/__pilot/metrics")).json()).inference_calls)
    .toBe(1)
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.navigateToOther())
  await expect(page.getByText("Original body for entry 502.")).toBeVisible()
  await request.post("/__pilot/release")
  await expect
    .poll(async () => (await (await request.get("/__pilot/metrics")).json()).completed)
    .toBe(true)
  await expect(page.getByText("Synthetic pilot summary.")).toHaveCount(0)
  await expect(page.getByText("Original body for entry 502.")).toBeVisible()
})

test("session change discards a late real API response", async ({ page, request }) => {
  await request.post("/__pilot/mode/delayed")
  await page.goto(
    "/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect
    .poll(async () => (await (await request.get("/__pilot/metrics")).json()).inference_calls)
    .toBe(1)
  await page.evaluate(() => globalThis.__articleIntelligenceHarness.changeSession())
  await request.post("/__pilot/release")
  await expect
    .poll(async () => (await (await request.get("/__pilot/metrics")).json()).completed)
    .toBe(true)
  await expect(page.getByText("Synthetic pilot summary.")).toHaveCount(0)
  await expect(page.getByText("Original Miniflux body stays visible on failure.")).toBeVisible()
})
