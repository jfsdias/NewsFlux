/* eslint-disable unicorn/no-await-expression-member -- Synthetic harness assertions. */
import { expect, test } from "@playwright/test"

// NEWSFLUX-AI-SETTINGS-01 synthetic gate: real Settings UI + real Summary admin API.
const REPLACEMENT_KEY = "sk-synthetic-replacement-newsflux-key-0002"
const WRONG_KEY = "sk-synthetic-wrong-key-not-accepted-0003"
const BOOTSTRAP_KEY = "sk-synthetic-bootstrap-newsflux-key-0001"
const page_ = (query = "") => `/scripts/tests/ai-settings-admin.html${query}`

const watchForLeaks = (page) => {
  const leaks = []
  page.on("request", (request) => {
    if ([REPLACEMENT_KEY, WRONG_KEY, BOOTSTRAP_KEY].some((key) => request.url().includes(key))) {
      leaks.push(request.url())
    }
    if (request.postData()?.includes(BOOTSTRAP_KEY)) {
      leaks.push("bootstrap key sent from browser")
    }
  })
  page.on("console", (message) => {
    if ([REPLACEMENT_KEY, WRONG_KEY].some((key) => message.text().includes(key))) {
      leaks.push("console")
    }
  })
  return leaks
}

const browserStorageDump = (page) =>
  page.evaluate(() =>
    JSON.stringify([
      Object.entries(globalThis.localStorage),
      Object.entries(globalThis.sessionStorage),
      document.cookie,
      globalThis.location.href,
    ]),
  )

const section = (page) => page.locator(".setting-section", { hasText: "LiteLLM integration" })

test.describe.configure({ mode: "serial" })

test("admin sees verified status, bootstrap key is never displayed", async ({ page, request }) => {
  await request.post("/__admin/gateway/ok")
  const leaks = watchForLeaks(page)
  await page.goto(page_())
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  await expect(page.getByText("Server-provisioned key")).toBeVisible()
  const input = page.getByLabel("LiteLLM virtual key")
  await expect(input).toHaveAttribute("type", "password")
  await expect(input).toHaveValue("")
  expect(await page.content()).not.toContain(BOOTSTRAP_KEY)
  expect(leaks).toEqual([])
})

test("rejected key is cleared, reported and never persisted", async ({ page, request }) => {
  const leaks = watchForLeaks(page)
  await page.goto(page_())
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  const input = page.getByLabel("LiteLLM virtual key")
  await input.fill(WRONG_KEY)
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText(/did not accept this key/)).toBeVisible()
  await expect(input).toHaveValue("")
  await expect(page.getByRole("button", { name: "Save key" })).toBeDisabled()
  const state = await (await request.get("/__admin/state")).json()
  expect(state.files).toEqual([])
  expect(state.bootstrap_unchanged).toBe(true)
  expect(await browserStorageDump(page)).not.toContain(WRONG_KEY)
  expect(leaks).toEqual([])
})

test("replacement key: test, save, managed 0600 record, field cleared, no browser copy", async ({
  page,
  request,
}) => {
  const leaks = watchForLeaks(page)
  await page.goto(page_())
  const input = page.getByLabel("LiteLLM virtual key")
  await input.fill(REPLACEMENT_KEY)
  const save = page.getByRole("button", { name: "Save key" })
  await expect(save).toBeDisabled() // saving requires a successful test first
  await page.getByRole("button", { name: "Test connection" }).click()
  await expect(page.getByText("Connection verified")).toBeVisible()
  await save.click()
  await expect(page.getByText("Key saved")).toBeVisible()
  await expect(page.getByText("Managed by NewsFlux")).toBeVisible()
  await expect(input).toHaveValue("")
  const state = await (await request.get("/__admin/state")).json()
  expect(state.stores_replacement).toBe(true)
  expect(state.bootstrap_unchanged).toBe(true)
  expect(state.dir_mode).toBe("0o700")
  expect(state.modes["settings.json"]).toBe("0o600")
  expect(state.modes["previous.json"]).toBe("0o600")
  expect(state.modes.activated).toBe("0o600")
  const dump = await browserStorageDump(page)
  expect(dump).not.toContain(REPLACEMENT_KEY)
  expect(await page.content()).not.toContain(REPLACEMENT_KEY)
  expect(leaks).toEqual([])
  // Readback after reload: status only, never the value.
  await page.reload()
  await expect(page.getByText("Managed by NewsFlux")).toBeVisible()
  await expect(page.getByLabel("LiteLLM virtual key")).toHaveValue("")
})

const chooseGatewayModel = async (page, alias) => {
  await section(page).locator(".arco-select").click()
  await page.locator(".arco-select-option", { hasText: alias }).first().click()
}

test("model approval gates: local, external free, paid, unpriced and non-chat", async ({
  page,
}) => {
  await page.goto(page_())
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  // Unpriced external: approval impossible even with every consent.
  await chooseGatewayModel(page, "unpriced-synthetic")
  await expect(page.getByText(/Price unknown: external models/)).toBeVisible()
  await page.getByText("I authorize this external provider").click()
  await expect(page.getByRole("button", { name: "Approve model" })).toBeDisabled()
  // Paid external: requires both consents.
  await chooseGatewayModel(page, "mistral-small-synthetic")
  const approve = page.getByRole("button", { name: "Approve model" })
  await expect(approve).toBeDisabled()
  await page.getByText("I authorize this external provider").click()
  await expect(approve).toBeDisabled()
  await page.getByText("I authorize paid model use").click()
  await expect(approve).toBeEnabled()
  // Local Ollama: no external or paid consent shown.
  await chooseGatewayModel(page, "llama3.2:3b")
  await expect(page.getByText("I authorize this external provider")).toHaveCount(0)
  await expect(page.getByText("I authorize paid model use")).toHaveCount(0)
  await approve.click()
  await expect(page.getByText("Model approved")).toBeVisible()
  // The user-facing primary selector now lists it, still subject to inference flags.
  const primary = page.getByRole("radiogroup", { name: "AI model" })
  const llama = primary.getByRole("radio", { name: /^llama3\.2:3b/ })
  // Approved by policy, but inference flags remain OFF: it can be saved as an inert
  // preference, is reported as not running, and nothing else is used instead.
  await expect(llama).toHaveAccessibleName(/Disabled/)
  await expect(llama).not.toHaveAccessibleName(/Not approved by the operator/)
  await expect(llama).toBeEnabled()
})

test("revocation returns the model to not-approved in the user catalog without code change", async ({
  page,
}) => {
  await page.goto(page_())
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  await chooseGatewayModel(page, "llama3.2:3b")
  await page.getByRole("button", { name: "Remove approval" }).click()
  await expect(page.getByText("Model approval removed")).toBeVisible()
  const primary = page.getByRole("radiogroup", { name: "AI model" })
  await expect(primary.getByRole("radio", { name: /^llama3\.2:3b/ })).toHaveAccessibleName(
    /Not approved by the operator/,
  )
})

test("gateway outage shows validation failed and keeps the saved key", async ({
  page,
  request,
}) => {
  await request.post("/__admin/gateway/down")
  await page.goto(page_())
  await expect(page.getByText("Validation failed")).toBeVisible()
  const state = await (await request.get("/__admin/state")).json()
  expect(state.stores_replacement).toBe(true)
  await request.post("/__admin/gateway/ok")
  await page.getByRole("button", { name: "Refresh catalog" }).click()
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
})

test("non-admin reader never sees the integration and cannot call the API", async ({
  page,
  request,
}) => {
  await page.goto(page_("?role=reader"))
  await expect(page.getByRole("radiogroup", { name: "AI model" })).toBeVisible()
  await expect(page.getByText("LiteLLM integration")).toHaveCount(0)
  await expect(page.getByLabel("LiteLLM virtual key")).toHaveCount(0)
  const denied = await request.post("/api/ai/v1/admin/litellm/save-key", {
    headers: {
      "X-Miniflux-API-Key": "synthetic-reader-miniflux-key",
      "X-NewsFlux-Miniflux-Server": "https://miniflux.example",
      "Content-Type": "application/json",
    },
    data: { key: WRONG_KEY, expected_revision: "bootstrap" },
  })
  expect(denied.status()).toBe(403)
  expect(await denied.text()).not.toContain(WRONG_KEY)
})

test("keyboard: key field, test and cancel are reachable and operable", async ({ page }) => {
  await page.goto(page_())
  await expect(page.getByText("Connected", { exact: true })).toBeVisible()
  const input = page.getByLabel("LiteLLM virtual key")
  await input.focus()
  await page.keyboard.type("sk-keyboard-synthetic-0004")
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Test connection" })).toBeFocused()
  // "Save key" stays disabled (not focusable) until a successful test.
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(input).toHaveValue("")
})

for (const viewport of [
  { name: "phone-360", width: 360, height: 780 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "fold-884x1104", width: 884, height: 1104 },
  { name: "desktop-1440", width: 1440, height: 900 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`layout ${viewport.name} ${theme}: no horizontal overflow, controls visible`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(page_(theme === "dark" ? "?theme=dark" : ""))
      await expect(page.getByText("Connected", { exact: true })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      for (const name of ["Test connection", "Refresh catalog"]) {
        const box = await page.getByRole("button", { name }).boundingBox()
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
        expect(box.height).toBeGreaterThanOrEqual(24)
      }
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-${theme}.png`),
        fullPage: true,
      })
    })
  }
}

for (const [locale, title] of [
  ["de-DE", "de-DE"],
  ["es-ES", "es-ES"],
  ["fr-FR", "fr-FR"],
  ["ja-JP", "ja-JP"],
  ["zh-CN", "zh-CN"],
]) {
  test(`locale ${locale} renders translated admin strings`, async ({ page }) => {
    await page.goto(page_(`?locale=${title}`))
    await expect(page.getByLabel(/./).first()).toBeVisible()
    const text = await page.locator("main").textContent()
    expect(text).not.toContain("LiteLLM integration")
    expect(text).not.toMatch(/article_intelligence\.litellm_/)
    expect(text).toContain("LiteLLM")
  })
}

// NEWSFLUX-AI-CATALOG-READONLY-01: with administrative writes OFF the administrator can still
// search and inspect every discovered gateway model; nothing is approved, persisted or posted.
const writeRequests = (page) => {
  const writes = []
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/ai/")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    }
  })
  return writes
}

const catalogSelect = (page) => section(page).locator(".arco-select").first()

const inspectAlias = async (page, alias) => {
  await catalogSelect(page).click()
  // Replace any previous search text, as a keyboard user would.
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.type(alias)
  await page.locator(".arco-select-option", { hasText: alias }).first().click()
  await expect(page.getByRole("region", { name: "Model details" })).toContainText(alias)
}

const details = (page) => page.getByRole("region", { name: "Model details" })

test.describe("read-only catalog with writes OFF", () => {
  test.beforeEach(async ({ request }) => {
    await request.post("/__admin/gateway/ok")
    await request.post("/__admin/catalog/large")
    await request.post("/__admin/writes/off")
  })

  test.afterAll(async ({ playwright }) => {
    const context = await playwright.request.newContext({ baseURL: "http://127.0.0.1:14191" })
    await context.post("/__admin/catalog/default")
    await context.post("/__admin/writes/on")
    await context.dispose()
  })

  test("admin searches and inspects the 26-model catalog without any write request", async ({
    page,
  }) => {
    const writes = writeRequests(page)
    const leaks = watchForLeaks(page)
    await page.goto(page_())
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await expect(page.getByText(/Browse only/)).toBeVisible()
    await expect(
      page.getByText("26 discovered · 14 chat · 0 approved · 13 verified identity · 7 known price"),
    ).toBeVisible()
    await expect(page.getByLabel("LiteLLM virtual key")).toBeDisabled()
    await expect(page.getByRole("button", { name: "Test connection" })).toBeDisabled()
    await expect(catalogSelect(page)).not.toHaveClass(/arco-select-disabled/)
    await catalogSelect(page).click()
    await page.keyboard.type("chat-04")
    await expect(page.locator(".arco-select-option")).toHaveCount(1)
    await page.locator(".arco-select-option", { hasText: "catalog-chat-04" }).click()
    const panel = details(page)
    await expect(panel).toContainText("Discovered by the gateway")
    await expect(panel).toContainText("Chat (compatible)")
    await expect(panel).toContainText("Verified")
    await expect(panel).toContainText("Free")
    await expect(panel).toContainText("External provider")
    await expect(panel).toContainText("Not approved")
    await expect(panel).toContainText("Not available: not approved by an administrator")
    await expect(panel).toContainText("Needs consent for an external provider")
    await expect(panel).toContainText("Changes are disabled on this server")
    await expect(page.getByText(/only shows its details/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Approve model" })).toBeDisabled()
    await expect(page.getByText("I authorize this external provider")).toHaveCount(0)
    expect(writes).toEqual([])
    expect(leaks).toEqual([])
    const dump = await browserStorageDump(page)
    expect(dump).not.toContain(BOOTSTRAP_KEY)
    expect(dump).not.toContain(REPLACEMENT_KEY)
  })

  test("paid, unpriced, unverified, non-chat and unreported mode are explained and never approvable", async ({
    page,
  }) => {
    const writes = writeRequests(page)
    await page.goto(page_())
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await inspectAlias(page, "catalog-chat-00")
    await expect(details(page)).toContainText("Paid")
    await expect(details(page)).toContainText("Needs consent for paid use")
    await expect(page.getByRole("button", { name: "Approve model" })).toBeDisabled()
    await inspectAlias(page, "catalog-chat-01")
    await expect(details(page)).toContainText("Not verified")
    await expect(details(page)).toContainText("Not proven")
    await expect(details(page)).toContainText("Price unknown")
    await expect(details(page)).toContainText("Provider identity not verified")
    await inspectAlias(page, "catalog-other-14")
    await expect(details(page)).toContainText("Not chat (incompatible)")
    await expect(details(page)).toContainText("Not a chat model")
    await inspectAlias(page, "catalog-other-17")
    await expect(details(page)).toContainText("Mode not reported")
    await expect(page.getByRole("button", { name: "Approve model" })).toBeDisabled()
    expect(writes).toEqual([])
  })

  test("keyboard: search, choose with Enter and read the details", async ({ page }) => {
    await page.goto(page_())
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await catalogSelect(page).locator("input").focus()
    await page.keyboard.type("other-20")
    await page.keyboard.press("Enter")
    await expect(details(page)).toContainText("catalog-other-20")
  })

  test("discovery failure keeps the catalog closed and refresh recovers it", async ({
    page,
    request,
  }) => {
    await request.post("/__admin/gateway/down")
    await page.goto(page_())
    await expect(page.getByText("Validation failed")).toBeVisible()
    await expect(catalogSelect(page)).toHaveClass(/arco-select-disabled/)
    await request.post("/__admin/gateway/ok")
    await page.getByRole("button", { name: "Refresh catalog" }).click()
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await expect(catalogSelect(page)).not.toHaveClass(/arco-select-disabled/)
  })

  test("the inspected model is ephemeral: not stored and gone after reload", async ({ page }) => {
    await page.goto(page_())
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await inspectAlias(page, "catalog-chat-06")
    expect(await browserStorageDump(page)).not.toContain("catalog-chat-06")
    await page.reload()
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await expect(details(page)).toHaveCount(0)
  })

  test("non-admin never sees the catalog and the discovery API refuses it", async ({
    page,
    request,
  }) => {
    await page.goto(page_("?role=reader"))
    await expect(page.getByRole("radiogroup", { name: "AI model" })).toBeVisible()
    await expect(page.getByText("LiteLLM integration")).toHaveCount(0)
    await expect(page.getByText(/Browse only/)).toHaveCount(0)
    const denied = await request.get("/api/ai/v1/admin/litellm/models", {
      headers: {
        "X-Miniflux-API-Key": "synthetic-reader-miniflux-key",
        "X-NewsFlux-Miniflux-Server": "https://miniflux.example",
      },
    })
    expect(denied.status()).toBe(403)
    expect(await denied.text()).not.toContain("catalog-chat")
  })

  test("writes ON: browsing works and approval keeps the same consent gates", async ({
    page,
    request,
  }) => {
    await request.post("/__admin/writes/on")
    await page.goto(page_())
    await expect(page.getByText("Connected", { exact: true })).toBeVisible()
    await expect(page.getByText(/Browse only/)).toHaveCount(0)
    await inspectAlias(page, "catalog-chat-04")
    const approve = page.getByRole("button", { name: "Approve model" })
    await expect(approve).toBeDisabled()
    await page.getByText("I authorize this external provider").click()
    await expect(approve).toBeEnabled()
  })

  for (const viewport of [
    { name: "phone-360", width: 360, height: 780 },
    { name: "phone-390", width: 390, height: 844 },
    { name: "tablet-820", width: 820, height: 1180 },
    { name: "fold-884x1104", width: 884, height: 1104 },
    { name: "desktop-1440", width: 1440, height: 900 },
  ]) {
    test(`read-only inspection layout ${viewport.name}: no overflow, details inside the viewport`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      await page.goto(page_())
      await expect(page.getByText("Connected", { exact: true })).toBeVisible()
      await inspectAlias(page, "catalog-chat-00")
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const box = await details(page).boundingBox()
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
      await page.screenshot({
        path: testInfo.outputPath(`readonly-${viewport.name}.png`),
        fullPage: true,
      })
    })
  }
})
