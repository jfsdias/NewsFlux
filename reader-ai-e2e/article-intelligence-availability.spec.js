import process from "node:process"

import { cards } from "../e2e/support/app.js"
/* eslint import/extensions: off -- Shared E2E fixture is a native Node ESM module. */
/* eslint import/no-relative-parent-imports: off -- Keep AI scenarios outside the frozen product inventory while reusing its synthetic fixtures. */
import { expect, test } from "../e2e/support/fixtures.js"

test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED === "1",
  "validates that the default build keeps the Reader action unavailable",
)

test("summary action stays hidden by default even with a provisioned Miniflux key", async ({
  openApp,
}) => {
  const { page } = await openApp({
    path: "/all",
    provisionedApiKey: true,
    settings: { markReadBy: "manually" },
  })

  await cards(page).first().click()
  await expect(page).toHaveURL(/\/all\/entry\/1$/)
  await expect(page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  await expect(page.getByTestId("article-intelligence-summary")).toHaveCount(0)
})
