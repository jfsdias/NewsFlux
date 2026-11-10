/* eslint import/extensions: off -- Shared E2E fixture is a native Node ESM module. */
/* eslint import/no-relative-parent-imports: off -- Keep AI scenarios outside the frozen product inventory while reusing its synthetic fixtures. */
import { expect, test } from "../e2e/support/fixtures.js"

test("summary action stays hidden by default even with a provisioned Miniflux key", async ({
  openApp,
}) => {
  const { page } = await openApp({
    path: "/all/entry/1",
    provisionedApiKey: true,
  })

  await expect(page.locator(".article-body")).toContainText("const x = 1")
  await expect(page.getByTestId("article-intelligence-summary")).toHaveCount(0)
})
