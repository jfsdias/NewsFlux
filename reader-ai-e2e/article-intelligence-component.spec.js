import process from "node:process"

/* eslint import/extensions: off -- Shared E2E fixture is a native Node ESM module. */
/* eslint import/no-relative-parent-imports: off -- Keep AI scenarios outside the frozen product inventory while reusing its synthetic fixtures. */
import { expect, test } from "../e2e/support/fixtures.js"

test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1",
  "requires explicit build-time AI UI enablement",
)

test("ARTICLE_INTELLIGENCE_COMPONENT: explicit keyboard action summarizes without replacing original content", async ({
  openApp,
  mock,
}) => {
  const { page } = await openApp({
    path: "/all/entry/1",
    provisionedApiKey: true,
    settings: { markReadBy: "manually" },
  })
  await expect(page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
  let summaryRequestCount = 0
  await page.route("**/api/ai/v1/entries/1/summary", async (route) => {
    summaryRequestCount += 1
    const request = JSON.parse(route.request().postData() ?? "{}")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "1",
        request_id: request.request_id,
        entry_id: 1,
        status: "partial",
        content_scope: "unknown",
        summary: "Synthetic component summary.",
        summary_paragraph_ids: ["p1"],
        key_points: [{ text: "Synthetic supported point.", paragraph_ids: ["p1"] }],
        action_points: [],
        limitations: ["Synthetic source may be partial."],
        provenance: {
          content_origin: "miniflux",
          content_fingerprint: "a".repeat(64),
          provider_id: "litellm",
          deployment_id: "synthetic",
          effective_model_id: "synthetic-model",
          prompt_version: "synthetic-v1",
        },
      }),
    })
  })

  const before = await mock.state()
  const summaryButton = page.getByRole("button", { name: "Summarize with AI" })
  await expect(summaryButton).toBeVisible()
  expect(summaryRequestCount).toBe(0)
  await summaryButton.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Synthetic component summary.")).toBeVisible()
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  expect(summaryRequestCount).toBe(1)
  expect(await mock.state()).toMatchObject({ read: before.read, starred: before.starred })
  expect(await mock.mutations()).toEqual([])
})
