/* eslint-disable unicorn/no-await-expression-member -- Synthetic harness assertions. */
import { expect, test } from "@playwright/test"

// NEWSFLUX-AI-POLICY-FALLBACK-01 P0: explicit LEGACY -> MANAGED migration against the real
// Summary admin API and store (scripts/pilot-e2e/admin_backend.py). Synthetic data only.
const BOOTSTRAP_KEY = "sk-synthetic-bootstrap-newsflux-key-0001"
const page_ = (query = "") => `/scripts/tests/ai-settings-admin.html${query}`
const panel = (page) => page.locator(".setting-section", { hasText: "Model policy migration" })
const admin = (page) => page.locator(".setting-section", { hasText: "LiteLLM integration" })

const watchRequests = (page) => {
  const seen = { migrate: 0, writes: 0, leaks: [] }
  page.on("request", (request) => {
    const url = request.url()
    if (url.includes("/admin/litellm/migrate-policy")) {
      seen.migrate += 1
    }
    if (request.method() === "POST" && url.includes("/admin/litellm/")) {
      seen.writes += 1
    }
    if (url.includes(BOOTSTRAP_KEY) || request.postData()?.includes(BOOTSTRAP_KEY)) {
      seen.leaks.push(url)
    }
  })
  page.on("console", (message) => {
    if (message.text().includes(BOOTSTRAP_KEY)) {
      seen.leaks.push("console")
    }
  })
  return seen
}

const storageDump = (page) =>
  page.evaluate(() =>
    JSON.stringify([
      Object.entries(globalThis.localStorage),
      Object.entries(globalThis.sessionStorage),
      document.cookie,
      globalThis.location.href,
    ]),
  )

const managedFiles = async (request) => (await (await request.get("/__admin/state")).json()).files

test.describe.configure({ mode: "serial" })

test.afterAll(async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: "http://127.0.0.1:14191" })
  await context.post("/__admin/legacy/off")
  await context.post("/__admin/gateway/ok")
  await context.dispose()
})

test("legacy server: implicit first approval is refused and nothing is written", async ({
  page,
  request,
}) => {
  await request.post("/__admin/legacy/on")
  await page.goto(page_())
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByText(/approves no model/)).toBeVisible()
  await expect(admin(page).getByText("Connected", { exact: true })).toBeVisible()
  await admin(page).locator(".arco-select").click()
  await page.locator(".arco-select-option", { hasText: "llama3.2:3b" }).first().click()
  await admin(page).getByRole("button", { name: "Approve model" }).click()
  await expect(page.getByText(/still uses the legacy model settings/)).toBeVisible()
  expect(await managedFiles(request)).toEqual([])
})

test("preview is read-only and verifies each legacy model on the gateway", async ({
  page,
  request,
}) => {
  const seen = watchRequests(page)
  await page.goto(page_())
  await panel(page).getByRole("button", { name: "Preview migration" }).click()
  const preview = panel(page).getByRole("region", { name: "Migration preview" })
  await expect(preview.getByText("Gateway checked with the current key.")).toBeVisible()
  const s5 = preview.locator(".ai-litellm-migration__model", { hasText: "S5" })
  await expect(s5).toContainText("llama3.2:3b")
  await expect(s5).toContainText("Found")
  await expect(s5).toContainText("Local")
  await expect(s5).toContainText("Not approved (stops running)")
  const mistral = preview.locator(".ai-litellm-migration__model", { hasText: "Mistral Small" })
  await expect(mistral).toContainText("External")
  await expect(mistral).toContainText("matches the legacy setting")
  await expect(mistral).toContainText(/consent to send articles to an external provider/)
  await expect(mistral).toContainText(/consent to paid use/)
  const migrate = panel(page).getByRole("button", { name: "Migrate to managed policy" })
  await expect(migrate).toBeDisabled()
  expect(seen.migrate).toBe(0)
  expect(seen.writes).toBe(0)
  expect(await managedFiles(request)).toEqual([])
  expect(await page.content()).not.toContain(BOOTSTRAP_KEY)
  expect(await storageDump(page)).not.toContain("preview_token")
  expect(seen.leaks).toEqual([])
})

test("a gateway failure after preview refuses the migration and keeps legacy", async ({
  page,
  request,
}) => {
  await page.goto(page_())
  await panel(page).getByRole("button", { name: "Preview migration" }).click()
  await panel(page)
    .getByText(/I understand: legacy models stop running/)
    .click()
  const migrate = panel(page).getByRole("button", { name: "Migrate to managed policy" })
  await expect(migrate).toBeEnabled()
  await request.post("/__admin/gateway/down")
  await migrate.click()
  await expect(
    page.getByText(/did not accept this key|could not be verified|Gateway/i).first(),
  ).toBeVisible()
  // The preview is discarded: a new one is required before any retry.
  await expect(panel(page).getByRole("region", { name: "Migration preview" })).toHaveCount(0)
  expect(await managedFiles(request)).toEqual([])
  await request.post("/__admin/gateway/ok")
})

test("gateway down at preview time: shown, confirmation and migration blocked", async ({
  page,
  request,
}) => {
  await request.post("/__admin/gateway/down")
  await page.goto(page_())
  await panel(page).getByRole("button", { name: "Preview migration" }).click()
  await expect(panel(page).getByText(/gateway could not be checked/)).toBeVisible()
  await expect(panel(page).getByRole("checkbox")).toBeDisabled()
  await expect(
    panel(page).getByRole("button", { name: "Migrate to managed policy" }),
  ).toBeDisabled()
  await request.post("/__admin/gateway/ok")
})

test("writes OFF: preview allowed, migration impossible and no write request", async ({
  page,
  request,
}) => {
  await request.post("/__admin/legacy/readonly")
  const seen = watchRequests(page)
  await page.goto(page_())
  await expect(panel(page).getByText(/You can still preview/)).toBeVisible()
  await panel(page).getByRole("button", { name: "Preview migration" }).click()
  await expect(panel(page).getByText("Gateway checked with the current key.")).toBeVisible()
  await expect(panel(page).getByRole("checkbox")).toBeDisabled()
  await expect(
    panel(page).getByRole("button", { name: "Migrate to managed policy" }),
  ).toBeDisabled()
  await expect(
    panel(page)
      .getByText(/Changes are disabled on the server/)
      .first(),
  ).toBeVisible()
  expect(seen.writes).toBe(0)
  expect(await managedFiles(request)).toEqual([])
})

test("non-admin reader: no migration panel and the API refuses", async ({ page, request }) => {
  await request.post("/__admin/legacy/on")
  await page.goto(page_("?role=reader"))
  await expect(page.getByRole("radiogroup", { name: "AI model" })).toBeVisible()
  await expect(page.getByText("Model policy migration")).toHaveCount(0)
  const headers = {
    "X-Miniflux-API-Key": "synthetic-reader-miniflux-key",
    "X-NewsFlux-Miniflux-Server": "https://miniflux.example",
  }
  const preview = await request.get("/api/ai/v1/admin/litellm/migration-preview", { headers })
  expect(preview.status()).toBe(403)
  const migrate = await request.post("/api/ai/v1/admin/litellm/migrate-policy", {
    headers: { ...headers, "Content-Type": "application/json" },
    data: {
      expected_revision: "bootstrap",
      preview_token: "0".repeat(64),
      confirm: "MIGRATE-LEGACY-POLICY",
    },
  })
  expect(migrate.status()).toBe(403)
  expect(await managedFiles(request)).toEqual([])
})

for (const viewport of [
  { width: 360, height: 780, name: "phone-360" },
  { width: 390, height: 844, name: "phone-390" },
  { width: 820, height: 1180, name: "tablet-820" },
  { width: 884, height: 1104, name: "fold-884" },
  { width: 1440, height: 900, name: "desktop-1440" },
]) {
  test(`preview layout ${viewport.name}: no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto(page_())
    await panel(page).getByRole("button", { name: "Preview migration" }).click()
    const card = panel(page).locator(".ai-litellm-migration__model").first()
    await expect(card).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await card.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  })
}

test("keyboard: preview, confirm and migrate; key kept, nothing approved", async ({
  page,
  request,
}) => {
  const seen = watchRequests(page)
  await page.goto(page_())
  const previewButton = panel(page).getByRole("button", { name: "Preview migration" })
  await previewButton.focus()
  await page.keyboard.press("Enter")
  const confirm = panel(page).getByRole("checkbox")
  await expect(confirm).toBeEnabled()
  await confirm.focus()
  await page.keyboard.press("Space")
  await expect(confirm).toBeChecked()
  const migrate = panel(page).getByRole("button", { name: "Migrate to managed policy" })
  await expect(migrate).toBeEnabled()
  await migrate.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Migrated. No model is approved yet.")).toBeVisible()
  await expect(page.getByText("Model policy migration")).toHaveCount(0)
  await expect(admin(page).getByText("Managed by NewsFlux")).toBeVisible()
  expect(seen.migrate).toBe(1)
  const state = await (await request.get("/__admin/state")).json()
  expect(state.files).toEqual([
    "activated",
    "migration.json",
    "previous.json",
    "settings.json",
    "write.lock",
  ])
  expect(state.modes["migration.json"]).toBe("0o600")
  expect(state.bootstrap_unchanged).toBe(true)
  expect(state.stores_replacement).toBe(false)
  // Legacy models are now candidates only: approval goes through the per-model consent flow.
  await admin(page).locator(".arco-select").click()
  await expect(
    page.locator(".arco-select-option", { hasText: "llama3.2:3b" }).first(),
  ).not.toContainText("✓")
  await page.keyboard.press("Escape")
  expect(await storageDump(page)).not.toContain(BOOTSTRAP_KEY)
  expect(seen.leaks).toEqual([])
  // Reload: the migration does not come back and the key stays managed.
  await page.reload()
  await expect(admin(page).getByText("Managed by NewsFlux")).toBeVisible()
  await expect(page.getByText("Model policy migration")).toHaveCount(0)
})
