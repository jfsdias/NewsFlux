// Measures the JS and CSS bytes a cold Login, Home and first Reader open fetch.
// Usage: node tests/aux/device-matrix/load-profile.js <repoDirectory> <appPort> <apiPort>
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const [repoDirectory, appPort = "4693", apiPort = "8593"] = process.argv.slice(2)
const { chromium } = createRequire(path.join(repoDirectory, "package.json"))("@playwright/test")
const environment = {
  ...process.env,
  E2E_APP_PORT: appPort,
  E2E_API_PORT: apiPort,
  E2E_BUILD_DIR: "build",
}
const servers = ["e2e/support/start-mock-server.js", "e2e/support/start-app-server.js"].map(
  (script) =>
    spawn(process.execPath, [script], { cwd: repoDirectory, env: environment, stdio: "ignore" }),
)
const base = `http://localhost:${appPort}`

const bodyLength = async (response) => {
  const declared = response.headers()["content-length"]
  if (declared !== undefined) {
    return Number(declared)
  }
  const body = await response.body().catch(() => new Uint8Array())
  return body.length
}

try {
  await delay(2500)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const seen = new Map()
  let phase = "login"
  page.on("response", async (response) => {
    const { pathname } = new URL(response.url())
    if (/\.(js|css)$/.test(pathname) && !seen.has(pathname)) {
      seen.set(pathname, { phase, length: await bodyLength(response) })
    }
  })
  await page.goto(`${base}/login`)
  await page.getByPlaceholder("Please input server address").waitFor()
  const token = page.getByPlaceholder("Please input API token")
  if (!(await token.isVisible())) {
    await page.getByRole("button", { name: "API Token", exact: true }).click()
  }
  await page.getByPlaceholder("Please input server address").fill(`http://127.0.0.1:${apiPort}`)
  await token.fill("synthetic-token")
  phase = "home"
  await page.getByRole("button", { name: "Login", exact: true }).click()
  await page.locator("main a.article-entry").first().waitFor()
  await page.waitForTimeout(1500)
  phase = "reader"
  await page.locator("main a.article-entry").first().click()
  await page.waitForURL(/entry/)
  await page.waitForTimeout(1500)
  const totals = {}
  for (const [pathname, { phase: chunkPhase, length }] of seen) {
    totals[chunkPhase] = (totals[chunkPhase] ?? 0) + length
    console.log(chunkPhase.padEnd(7), String(length).padStart(8), path.basename(pathname))
  }
  console.log("TOTALS", JSON.stringify(totals))
  await browser.close()
} finally {
  for (const child of servers) {
    child.kill()
  }
}
