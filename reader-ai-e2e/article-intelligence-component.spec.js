import process from "node:process"

import { cards } from "../e2e/support/app.js"
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
    path: "/all",
    provisionedApiKey: true,
    settings: { markReadBy: "manually" },
  })
  await cards(page).first().click()
  await expect(page).toHaveURL(/\/all\/entry\/1$/)
  await expect(page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
  let summaryRequestCount = 0
  let catalogRequestCount = 0
  await page.route("**/api/ai/v1/models", async (route) => {
    catalogRequestCount += 1
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "1",
        default_model_id: "s5-free",
        profile_version: "summary-profile-v1",
        default_profile: {},
        models: [
          {
            id: "s5-free",
            label: "S5",
            provider: "LiteLLM",
            available: true,
            unavailable_reason: null,
            requires_paid_authorization: false,
            pricing: {
              status: "operator_declared_zero",
              input_usd_per_million: "0",
              output_usd_per_million: "0",
            },
            limits: {
              max_input_tokens: 4096,
              max_output_tokens: 2048,
              requests_per_minute: 5,
              timeout_seconds: 25,
            },
            notices: ["ARTICLE_SENT_TO_MODEL_PROVIDER", "PRICE_DECLARED_BY_OPERATOR"],
          },
        ],
      }),
    })
  })
  await page.route("**/api/ai/v1/entries/1/summary", async (route) => {
    summaryRequestCount += 1
    const request = JSON.parse(route.request().postData() ?? "{}")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "2",
        request_id: request.request_id,
        entry_id: 1,
        status: "partial",
        content_scope: "unknown",
        summary: "Synthetic component summary.",
        summary_paragraph_ids: ["p1"],
        key_points: [{ text: "Synthetic supported point.", paragraph_ids: ["p1"] }],
        facts: [],
        implications: [],
        action_points: [],
        open_questions: [],
        limitations: ["Synthetic source may be partial."],
        profile: request.profile,
        provenance: {
          content_origin: "ORIGINAL_MINIFLUX",
          content_fingerprint: "a".repeat(64),
          provider_id: "litellm",
          model_id: request.model_id,
          effective_model_id: "synthetic-model",
          prompt_version: "synthetic-v2",
          profile_version: "summary-profile-v1",
          fallback_used: false,
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
  expect(catalogRequestCount).toBe(1)
  // Requested section without evidence is explicitly marked instead of invented.
  await expect(page.getByText("Not available in the article text.")).toBeVisible()
  expect(await mock.state()).toMatchObject({ read: before.read, starred: before.starred })
  expect(await mock.mutations()).toEqual([])
})
