import { expect, test } from "@playwright/test"

const entryPath = "/api/ai/v1/entries/501/summary"
const validRequest = {
  schema_version: "1",
  request_id: "11111111-1111-4111-8111-111111111111",
  profile_id: "editorial-default",
}
const validHeaders = {
  "Content-Type": "application/json",
  "X-Miniflux-API-Key": "synthetic-user-api-key",
  "X-NewsFlux-Miniflux-Server": "https://miniflux.example",
  Origin: "https://newsflux.example",
}

test("the candidate Reader image serves its built application shell", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle("NewsFlux")
  await expect(page.locator("#root")).toBeVisible()
})

test("the HTTPS edge overwrites a client-supplied forwarded protocol", async ({
  page,
  request,
}) => {
  await request.post("/__pilot/mode/success")
  await page.setExtraHTTPHeaders({ "X-Forwarded-Proto": "http" })
  await page.goto(
    "/pilot-test/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect(page.getByText("Synthetic pilot summary.")).toBeVisible()
  const metricsResponse = await request.get("/__pilot/metrics")
  const metrics = await metricsResponse.json()
  expect(metrics.gateway_checks).toEqual([{ authorized: true, model_valid: true }])
})

test("TLS proxy rejects wrong Host and Origin and blocks an untrusted proxy source", async ({
  request,
}) => {
  await request.post("/__pilot/mode/success")

  const wrongHost = await request.post(entryPath, {
    headers: { ...validHeaders, Host: "attacker.example" },
    data: validRequest,
  })
  expect(wrongHost.status()).toBeGreaterThanOrEqual(400)

  const wrongOrigin = await request.post(entryPath, {
    headers: { ...validHeaders, Origin: "https://attacker.example" },
    data: validRequest,
  })
  expect(wrongOrigin.status()).toBe(403)

  const untrustedProxy = await request.post(`http://pilot-reader:2000${entryPath}`, {
    headers: { ...validHeaders, "X-Forwarded-Proto": "https" },
    data: validRequest,
  })
  expect(untrustedProxy.status()).toBe(403)

  const metricsResponse = await request.get("/__pilot/metrics")
  const metrics = await metricsResponse.json()
  expect(metrics.miniflux_methods).toEqual([])
  expect(metrics.inference_calls).toBe(0)
})

test("internal provider credentials never reach browser requests or rendered content", async ({
  page,
  request,
}) => {
  const observedHeaders = []
  page.on("request", (event) => observedHeaders.push(event.allHeaders()))
  await request.post("/__pilot/mode/success")
  await page.goto(
    "/pilot-test/scripts/tests/content-fallback-reader.html?mode=disabled&article_summary=pilot-http",
  )
  await expect(page.getByTestId("reader-recovery-report")).toHaveAttribute("data-status", "pass")
  await page.getByRole("button", { name: "Summarize with AI" }).click()
  await expect(page.getByText("Synthetic pilot summary.")).toBeVisible()

  const headers = await Promise.all(observedHeaders)
  expect(JSON.stringify(headers)).not.toContain("synthetic-virtual-key")
  const bodyText = await page.locator("body").textContent()
  expect(bodyText).not.toContain("synthetic-virtual-key")
  const metricsResponse = await request.get("/__pilot/metrics")
  const metrics = await metricsResponse.json()
  expect(metrics.gateway_checks).toEqual([{ authorized: true, model_valid: true }])
  expect(metrics.miniflux_methods.every((method) => method === "GET")).toBe(true)
})

test("administrative and documentation routes stay unavailable", async ({ request }) => {
  const adminResponse = await request.get("/api/ai/admin")
  const docsResponse = await request.get("http://summary-api:8788/docs")
  const openApiResponse = await request.get("http://summary-api:8788/openapi.json")
  expect(adminResponse.status()).toBe(403)
  expect(docsResponse.status()).toBe(404)
  expect(openApiResponse.status()).toBe(404)
})
