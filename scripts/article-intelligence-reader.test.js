import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")

test("Reader summary is explicit, localized, and separate from the original article body", async () => {
  const component = await read("src/components/Article/ArticleDetail.jsx")
  const actionIndex = component.indexOf('className="article-intelligence-summary__action"')
  const articleBodyIndex = component.indexOf('className="article-body"', actionIndex)
  assert.ok(actionIndex !== -1)
  assert.ok(articleBodyIndex > actionIndex)
  assert.ok(component.includes("onClick={() => void articleSummary.summarize()}"))
  assert.match(component, /<ArticleSummaryResult/u)
  const result = await read("src/components/Article/ArticleSummaryResult.jsx")
  assert.match(result, /summary\.limitations\.map/u)
  assert.match(result, /section_not_supported/u)
  assert.match(result, /origin_original_miniflux/u)
  assert.doesNotMatch(component, /useEffect\([^)]*articleSummary\.summarize/su)
})

test("summary API keeps requests same-origin, bounded by server identity, and content-minimal", async () => {
  const api = await read("src/apis/article-intelligence.js")
  const utility = await read("src/utils/article-intelligence-summary.js")
  assert.ok(utility.includes("return `/api/ai/v1/entries/${numericId}/summary`"))
  assert.match(api, /mode: "same-origin"/u)
  assert.match(api, /credentials: "omit"/u)
  assert.match(api, /redirect: "error"/u)
  assert.match(api, /cache: "no-store"/u)
  assert.match(api, /X-Miniflux-API-Key/u)
  assert.match(api, /hasProvisionedApiKey/u)
  assert.match(api, /profile_id: "editorial-default"/u)
  assert.doesNotMatch(api, /activeContent\.content|\.content_html/u)
})

test("summary action copy and safe states exist in every shipped locale", async () => {
  for (const locale of ["de-DE", "en-US", "es-ES", "fr-FR", "ja-JP", "zh-CN"]) {
    const phrases = JSON.parse(await read(`src/locales/${locale}.json`))
    const text = phrases.article_intelligence
    for (const key of [
      "title",
      "action",
      "loading",
      "retry",
      "error",
      "summary",
      "key_points",
      "partial_content",
      "limitations",
      "insufficient",
      "unavailable",
      "transfer_notice",
      "model_unavailable_error",
      "provenance_line",
      "section_not_supported",
      "settings_section",
      "model_label",
      "length_label",
      "focus_label",
      "sections_label",
      "language_label",
    ]) {
      assert.equal(typeof text?.[key], "string", `${locale} is missing ${key}`)
      assert.ok(text[key].trim(), `${locale} has empty ${key}`)
    }
  }
})

test("AI Reader browser tests remain outside the frozen 46-scenario product inventory", async () => {
  const config = await read("playwright.article-intelligence.config.js")
  const spec = await read("reader-ai-e2e/article-intelligence.spec.js")
  assert.match(config, /testDir: "\.\/reader-ai-e2e"/u)
  assert.doesNotMatch(config, /testDir: "\.\/e2e"/u)
  assert.match(spec, /late summary is discarded after navigating/u)
  assert.match(spec, /recoverable/u)
})

test("AI Reader browser suite separates the default-off and explicitly enabled runs", async () => {
  const workflow = await read(".github/workflows/e2e.yaml")
  const config = await read("playwright.article-intelligence.config.js")
  const availability = await read("reader-ai-e2e/article-intelligence-availability.spec.js")
  const enabledScenarios = await read("reader-ai-e2e/article-intelligence.spec.js")
  const recoveryIntegration = await read(
    "reader-ai-e2e/article-intelligence-recovery-integration.spec.js",
  )

  assert.match(workflow, /Run Article Intelligence Reader scenarios/u)
  assert.match(workflow, /Build Reader with AI disabled by default[\s\S]*?pnpm build/u)
  assert.match(
    workflow,
    /Build Reader with explicit AI enablement[\s\S]*?VITE_ARTICLE_INTELLIGENCE_ENABLED: "1"[\s\S]*?pnpm build/u,
  )
  assert.match(
    workflow,
    /Build Reader with AI disabled by default[\s\S]*?pnpm build[\s\S]*?Run Article Intelligence Reader scenarios/u,
  )
  assert.match(
    workflow,
    /Run AI-enabled Reader scenarios[\s\S]*?VITE_ARTICLE_INTELLIGENCE_ENABLED: "1"/u,
  )
  assert.match(
    workflow,
    /VITE_ARTICLE_INTELLIGENCE_ENABLED: "1"[\s\S]*?pnpm exec playwright test --config=playwright\.article-intelligence\.config\.js/u,
  )
  assert.doesNotMatch(workflow, /--grep "ARTICLE_INTELLIGENCE_COMPONENT"/u)
  assert.match(availability, /process\.env\.VITE_ARTICLE_INTELLIGENCE_ENABLED === "1"/u)
  assert.match(enabledScenarios, /process\.env\.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1"/u)
  assert.match(
    recoveryIntegration,
    /process\.env\.VITE_ARTICLE_INTELLIGENCE_ENABLED !== "1"\s*\|\|\s*!process\.env\.VITE_CONTENT_FALLBACK_READER_BASE_PATH/u,
  )
  assert.match(
    config,
    /command: `pnpm exec vite --host 127\.0\.0\.1 --port \$\{appPort\} --strictPort`/u,
  )
  assert.match(config, /url: `http:\/\/127\.0\.0\.1:\$\{appPort\}\//u)
})

test("synthetic authenticated Reader fixture can provision an isolated API-key identity", async () => {
  const fixtures = await read("e2e/support/fixtures.js")
  assert.match(fixtures, /provisionedApiKey = false/u)
  assert.match(fixtures, /const seedAuth = \(\{ server, apiKeyId = null \}\)/u)
  assert.match(
    fixtures,
    /context\.addInitScript\(seedAuth, \{\s*server: mock\.url,\s*apiKeyId: provisionedApiKey \? 9 : null,?\s*\}\)/u,
  )
})

test("combined session test emits the established auth storage change before checking cancellation", async () => {
  const recoveryIntegration = await read(
    "reader-ai-e2e/article-intelligence-recovery-integration.spec.js",
  )
  assert.match(
    recoveryIntegration,
    /await recoveryRequest\s*await page\.getByRole\("button", \{ name: "Summarize with AI" \}\)\.click\(\)\s*await summaryRequest/u,
  )
  assert.match(
    recoveryIntegration,
    /localStorage\.setItem\(\s*"auth",\s*value,?\s*\)\s*globalThis\.dispatchEvent\(new StorageEvent\(\s*"storage",\s*\{ key: "auth", newValue: value \}/u,
  )
})
