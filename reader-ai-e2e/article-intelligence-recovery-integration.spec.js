import { createHash } from "node:crypto"
import process from "node:process"

/* eslint import/extensions: off -- Shared E2E fixture is a native Node ESM module. */
/* eslint import/no-relative-parent-imports: off -- Keep AI scenarios outside the frozen product inventory while reusing its synthetic fixtures. */
import { cards } from "../e2e/support/app.js"
import { expect, test } from "../e2e/support/fixtures.js"

test.skip(
  process.env.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1" ||
    !process.env.VITE_CONTENT_FALLBACK_READER_BASE_PATH,
  "requires explicitly enabled AI and Reader recovery UI",
)

const RECOVERY_HTML = Array.from(
  { length: 32 },
  (_, index) =>
    `<p>Synthetic recovered paragraph ${index + 1}. ${"Safe article text. ".repeat(10)}</p>`,
).join("")
const recoveryPath = (entryId) => `**/api/content-fallback/reader/v1/entries/${entryId}/recover`

const openSyntheticArticle = async (openApp, options = {}) => {
  const opened = await openApp({
    path: "/all",
    provisionedApiKey: true,
    settings: { markReadBy: "manually" },
    ...options,
  })
  await cards(opened.page).first().click()
  await expect(opened.page).toHaveURL(/\/all\/entry\/1$/)
  await expect(opened.page.getByRole("heading", { name: "Subtítulo" })).toBeVisible()
  return opened
}

const recoveryPayload = (entry) => ({
  status: "recovered",
  entry_id: entry.id,
  url_fingerprint: createHash("sha256").update(entry.url, "utf8").digest("hex"),
  content_html: RECOVERY_HTML,
  content_origin: "wallhop",
  validation: { state: "SUFFICIENT" },
  provenance: { provider: "wallhop.io", fetched_at: "2026-11-10T12:00:00+00:00" },
})

const summaryPayload = (requestId, entryId) => ({
  schema_version: "1",
  request_id: requestId,
  entry_id: entryId,
  status: "partial",
  content_scope: "unknown",
  summary: "Synthetic integrated Reader summary.",
  summary_paragraph_ids: ["p1"],
  key_points: [{ text: "Synthetic grounded point.", paragraph_ids: ["p1"] }],
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
})

const setSyntheticSummaryRoute = async (page, entryId, onRequest = () => {}) => {
  let requests = 0
  await page.route(`**/api/ai/v1/entries/${entryId}/summary`, async (route) => {
    requests += 1
    const request = JSON.parse(route.request().postData() ?? "{}")
    onRequest(request)
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(summaryPayload(request.request_id, entryId)),
    })
  })
  return () => requests
}

test("AI_RECOVERY_CROSS: recovered article remains intact while an explicit summary is requested", async ({
  openApp,
  mock,
}) => {
  const { page } = await openSyntheticArticle(openApp, {
    width: 884,
    height: 1104,
  })
  const entry = await mock.json("/v1/entries/1")
  const summaryRequests = []
  const before = await mock.state()
  await page.route(recoveryPath(1), async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(recoveryPayload(entry)),
    })
  })
  const summaryRequestCount = await setSyntheticSummaryRoute(page, 1, (request) => {
    summaryRequests.push(request)
  })

  await expect(page.getByRole("button", { name: "Recover full text" })).toBeVisible()
  await page.getByRole("button", { name: "Recover full text" }).click()
  await expect(page.locator(".article-body")).toContainText("Synthetic recovered paragraph 1")
  expect(summaryRequestCount()).toBe(0)
  await expect(
    page.getByText("The summary uses the original Miniflux text, not the recovered text."),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "Summarize with AI" })).toBeVisible()
  const summaryButton = page.getByRole("button", { name: "Summarize with AI" })
  await summaryButton.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByText("Synthetic integrated Reader summary.")).toBeVisible()
  await expect(page.locator(".article-body")).toContainText("Synthetic recovered paragraph 1")
  expect(summaryRequestCount()).toBe(1)
  expect(Object.keys(summaryRequests[0]).toSorted()).toEqual([
    "profile_id",
    "request_id",
    "schema_version",
  ])

  await page.getByRole("button", { name: "Show original text" }).click()
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  await page.getByRole("button", { name: "Show recovered text" }).click()
  await expect(page.locator(".article-body")).toContainText("Synthetic recovered paragraph 1")
  expect(await mock.state()).toMatchObject({ read: before.read, starred: before.starred })
  expect(await mock.mutations()).toEqual([])
})

test("AI_RECOVERY_CROSS: failed recovery preserves the original and does not block an explicit summary", async ({
  openApp,
  mock,
}) => {
  const { page } = await openSyntheticArticle(openApp)
  const before = await mock.state()
  await page.route(recoveryPath(1), (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  )
  const summaryRequestCount = await setSyntheticSummaryRoute(page, 1)

  await page.getByRole("button", { name: "Recover full text" }).click()
  await expect(page.locator(".reader-content-recovery__error")).toBeVisible()
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect(page.getByText("Synthetic integrated Reader summary.")).toBeVisible()
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  expect(summaryRequestCount()).toBe(1)
  expect(await mock.state()).toMatchObject({ read: before.read, starred: before.starred })
  expect(await mock.mutations()).toEqual([])
})

test("AI_RECOVERY_CROSS: session change cancels simultaneous recovery and summary requests", async ({
  openApp,
  mock,
}) => {
  const { page } = await openSyntheticArticle(openApp)
  const entry = await mock.json("/v1/entries/1")
  let releaseRecovery
  let releaseSummary
  let recoveryStarted
  let summaryStarted
  const recoveryGate = new Promise((resolve) => {
    releaseRecovery = resolve
  })
  const summaryGate = new Promise((resolve) => {
    releaseSummary = resolve
  })
  const recoveryRequest = new Promise((resolve) => {
    recoveryStarted = resolve
  })
  const summaryRequest = new Promise((resolve) => {
    summaryStarted = resolve
  })
  const abortedRequests = new Set()
  page.on("requestfailed", (request) => {
    if (request.url().includes("/recover") || request.url().includes("/summary")) {
      abortedRequests.add(new URL(request.url()).pathname)
    }
  })
  await page.route(recoveryPath(1), async (route) => {
    recoveryStarted()
    await recoveryGate
    try {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(recoveryPayload(entry)),
      })
    } catch {
      // The current session intentionally aborts both browser requests.
    }
  })
  await page.route("**/api/ai/v1/entries/1/summary", async (route) => {
    summaryStarted()
    await summaryGate
    try {
      const request = JSON.parse(route.request().postData() ?? "{}")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(summaryPayload(request.request_id, 1)),
      })
    } catch {
      // The current session intentionally aborts both browser requests.
    }
  })

  await page.getByRole("button", { name: "Recover full text" }).click()
  await recoveryRequest
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await summaryRequest

  await page.evaluate(() => {
    const auth = JSON.parse(localStorage.getItem("auth"))
    const value = JSON.stringify({ ...auth, token: "rotated-e2e-token", apiKeyId: 18 })
    localStorage.setItem("auth", value)
    globalThis.dispatchEvent(new StorageEvent("storage", { key: "auth", newValue: value }))
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  releaseRecovery()
  releaseSummary()
  await expect.poll(() => abortedRequests.size).toBe(2)
  await expect(page.locator(".article-body")).toContainText("const x = 1")
  await expect(page.locator(".article-body")).not.toContainText("Synthetic recovered paragraph")
  await expect(page.getByText("Synthetic integrated Reader summary.")).toHaveCount(0)
})
