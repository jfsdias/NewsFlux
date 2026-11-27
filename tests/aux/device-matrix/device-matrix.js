// Simulated device-matrix smoke for NewsFlux (Sprint 0 closeout evidence).
// Usage: node tests/aux/device-matrix/device-matrix.js <repoDirectory> <appPort> <apiPort> <outDirectory>
// Drives the production build served by e2e/support/start-app-server.js against the synthetic
// Miniflux mock. Emulation only: this is not a physical-device result.
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const [
  repoDirectory,
  appPort = "4683",
  apiPort = "8591",
  outDirectory = "test-results/device-matrix",
] = process.argv.slice(2)
const { chromium, webkit } = createRequire(path.join(repoDirectory, "package.json"))(
  "@playwright/test",
)

const IOS_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"
const ANDROID_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; SM-F9xx) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"

// iPhone Duo and Galaxy Z Fold 8 viewports are derived from published panel sizes with assumed
// device pixel ratios. 390x844 and 884x1104 are the project's reference sizes.
const DEVICES = [
  { id: "iphone-duo-closed", engine: "webkit", width: 466, height: 678, scale: 3 },
  { id: "iphone-duo-open", engine: "webkit", width: 626, height: 890, scale: 3 },
  { id: "zfold8-closed", engine: "chromium", width: 416, height: 657, scale: 3 },
  { id: "zfold8-open", engine: "chromium", width: 924, height: 1224, scale: 2 },
  { id: "ref-phone-390", engine: "webkit", width: 390, height: 844, scale: 3 },
  { id: "ref-fold-884", engine: "chromium", width: 884, height: 1104, scale: 2 },
]

const base = `http://localhost:${appPort}`
const engines = { chromium, webkit }

// Expected noise: the mock serves one deliberately broken image (broken=1), and request freshness
// aborts superseded /v1/entries requests. Every other error fails the run.
const isExpectedNoise = (message) =>
  message.includes("broken=1") ||
  (message.startsWith("console: Failed to load resource") && message.includes("404")) ||
  (message.startsWith("failed:") && message.includes("ERR_ABORTED")) ||
  (message.startsWith("failed:") && message.includes("cancelled"))

// Runs in the page: plain DOM measurements of the first screen.
/* eslint-disable unicorn/consistent-function-scoping -- the helpers must live inside page.evaluate */
const pageMetrics = (page) =>
  page.evaluate(() => {
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      )
    }
    const isFullyInFirstScreen = (element) => {
      const rect = element.getBoundingClientRect()
      return (
        rect.top >= 0 &&
        rect.bottom <= viewportHeight &&
        rect.left >= 0 &&
        rect.right <= viewportWidth + 1
      )
    }
    const stories = [...document.querySelectorAll("main a.article-entry")].filter((element) =>
      isVisible(element),
    )
    const smallTargets = [
      ...document.querySelectorAll("button, a[href], [role=button], input, select"),
    ]
      .filter((element) => isVisible(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.top < viewportHeight && rect.bottom > 0 && (rect.width < 44 || rect.height < 44)
      })
      .map(
        (element) =>
          element.getAttribute("aria-label") ||
          element.textContent.trim().slice(0, 30) ||
          element.tagName,
      )
    // Rendered text order matters here, which textContent does not reflect for hidden panels.
    // eslint-disable-next-line unicorn/prefer-dom-node-text-content
    const mainText = document.querySelector("main")?.innerText ?? ""
    const highlightsAt = mainText.indexOf("Highlights")
    return {
      viewportWidth,
      viewportHeight,
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth + 1,
      headlinesFullyInFirstScreen: stories.filter((element) => isFullyInFirstScreen(element))
        .length,
      firstStoryTop:
        stories.length > 0 ? Math.round(stories[0].getBoundingClientRect().top) : undefined,
      toolsBeforeHighlights:
        highlightsAt !== -1 &&
        ["Enable editorial tools", "Recommend sources"].some((label) => {
          const labelAt = mainText.indexOf(label)
          return labelAt !== -1 && labelAt < highlightsAt
        }),
      smallTargetsInFirstScreen: smallTargets.length,
      smallTargetSamples: [...new Set(smallTargets)].slice(0, 6),
    }
  })
/* eslint-enable unicorn/consistent-function-scoping */

const login = async (page) => {
  await page.goto(`${base}/login`)
  await page.getByPlaceholder("Please input server address").waitFor()
  const token = page.getByPlaceholder("Please input API token")
  if (!(await token.isVisible())) {
    await page.getByRole("button", { name: "API Token", exact: true }).click()
    await token.waitFor()
  }
  await page.getByPlaceholder("Please input server address").fill(`http://127.0.0.1:${apiPort}`)
  await token.fill("synthetic-token")
  const started = Date.now()
  await page.getByRole("button", { name: "Login", exact: true }).click()
  await page.waitForURL(`${base}/`)
  await page.locator("main a.article-entry").first().waitFor({ timeout: 15_000 })
  return Date.now() - started
}

const isReachable = (url) =>
  fetch(url).then(
    (response) => response.ok,
    () => false,
  )

// The harness owns its servers so parallel work cannot stop them mid-run.
const startServers = async () => {
  const environment = {
    ...process.env,
    E2E_APP_PORT: appPort,
    E2E_API_PORT: apiPort,
    E2E_BUILD_DIR: "build",
  }
  const children = ["e2e/support/start-mock-server.js", "e2e/support/start-app-server.js"].map(
    (script) =>
      spawn(process.execPath, [script], { cwd: repoDirectory, env: environment, stdio: "ignore" }),
  )
  for (let attempt = 0; attempt < 50; attempt++) {
    const ready = await Promise.all([
      isReachable(`http://127.0.0.1:${apiPort}/v1/version`),
      isReachable(`${base}/`),
    ])
    if (ready.every(Boolean)) {
      return children
    }
    await delay(200)
  }
  throw new Error("servers did not start")
}

const serviceWorkerState = (page) =>
  page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return "unsupported"
    }
    const registration = await navigator.serviceWorker.getRegistration()
    return registration ? "registered" : "none"
  })

const runJourney = async (page, tag, record) => {
  record.loginToHomeMs = await login(page)
  await page.waitForTimeout(600)
  record.steps.home = await pageMetrics(page)
  await page.screenshot({ path: path.join(outDirectory, `${tag}-home.png`) })
  await page.locator("main a.article-entry").first().click()
  await page.waitForURL(/\/entry\/\d+/)
  await page.waitForTimeout(600)
  record.steps.reader = await pageMetrics(page)
  await page.screenshot({ path: path.join(outDirectory, `${tag}-reader.png`) })
  await page.goBack()
  await page.waitForURL(`${base}/`)
  await page.goto(`${base}/all`)
  await page.locator("main a.article-entry").first().waitFor()
  await page.waitForTimeout(400)
  record.steps.all = await pageMetrics(page)
  await page.screenshot({ path: path.join(outDirectory, `${tag}-all.png`) })
  record.serviceWorker = await serviceWorkerState(page)
}

const runDevice = async (device, scheme) => {
  const browser = await engines[device.engine].launch()
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale,
    isMobile: device.engine === "chromium",
    hasTouch: true,
    userAgent: device.engine === "webkit" ? IOS_USER_AGENT : ANDROID_USER_AGENT,
    colorScheme: scheme,
  })
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`http ${response.status()}: ${response.url()}`)
    }
  })
  page.on("requestfailed", (request) =>
    errors.push(`failed: ${request.url()} ${request.failure()?.errorText}`),
  )
  const tag = `${device.id}-${scheme}`
  const record = { device: device.id, engine: device.engine, scheme, steps: {} }
  try {
    await runJourney(page, tag, record)
  } catch (error) {
    record.failure = String(error.message).split("\n", 1)[0]
    await page.screenshot({ path: path.join(outDirectory, `${tag}-failure.png`) }).catch(() => {})
  }
  record.ignored = errors.filter((message) => isExpectedNoise(message)).length
  record.errors = errors.filter((message) => !isExpectedNoise(message)).slice(0, 6)
  record.pass =
    !record.failure &&
    record.errors.length === 0 &&
    !Object.values(record.steps).some((step) => step.horizontalOverflow)
  await browser.close()
  console.log(
    `${record.pass ? "PASS" : "FAIL"} ${tag}${record.failure ? ` — ${record.failure}` : ""}`,
  )
  return record
}

mkdirSync(outDirectory, { recursive: true })
const servers = await startServers()
const results = []
try {
  for (const device of DEVICES) {
    for (const scheme of ["dark", "light"]) {
      results.push(await runDevice(device, scheme))
    }
  }
} finally {
  for (const child of servers) {
    child.kill()
  }
}
writeFileSync(path.join(outDirectory, "results.json"), JSON.stringify(results, undefined, 2))
const failed = results.filter((record) => !record.pass).length
console.log(`SMOKE ${results.length - failed}/${results.length} PASS`)
process.exitCode = failed === 0 ? 0 : 1
