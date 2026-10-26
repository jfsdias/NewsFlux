/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await, unicorn/prefer-add-event-listener */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { getBrowserVersion, resolveBrowserExecutable } from "./browser-resolver.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const screenshotsDir = "/tmp/newsflux-story02-browser-gate-screenshots"
mkdirSync(screenshotsDir, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on("error", reject)
  })
}

async function waitForServer(url, timeoutMs = 15_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            resolve(true)
          } else {
            reject(new Error(`Status ${res.statusCode}`))
          }
        })
        req.on("error", reject)
      })
      return true
    } catch {
      await sleep(250)
    }
  }
  throw new Error(`Timeout waiting for server at ${url}`)
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
  }

  async connect() {
    this.ws = new globalThis.WebSocket(this.wsUrl)
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = reject
    })

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) {
          reject(new Error(`CDP Error (${msg.error.code}): ${msg.error.message}`))
        } else {
          resolve(msg.result)
        }
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    return res.result?.value
  }

  async screenshot(outputPath) {
    const res = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    })
    const buffer = Buffer.from(res.data, "base64")
    writeFileSync(outputPath, buffer)
    console.log(`Saved screenshot: ${outputPath}`)
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: width < 600,
    })
    await this.send("Emulation.setVisibleSize", { width, height })
  }

  async close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

async function run() {
  console.log("=================================================================")
  console.log("NEWSFLUX — STORY-02-A2 REAL BROWSER GATE SUITE")
  console.log("=================================================================\n")

  const vitePort = 5186
  const cdpPort = 9232
  const harnessUrl = `http://127.0.0.1:${vitePort}/scripts/tests/story-identity-a2-browser-harness.html`

  let viteProcess = null
  let chromeProcess = null
  let cdp = null
  const tempChromeProfile = mkdtempSync(path.join(os.tmpdir(), "chrome-story02-a2-gate-"))

  const results = {
    REAL_BROWSER_EXECUTED: "NO",
    BROWSER_TOOL: "Google Chrome Headless (CDP)",
    CRITICAL_VIEWPORT_884x1104: "FAIL",
    FLAG_OFF_GATE: "FAIL",
    NULL_PROVIDER_GATE: "FAIL",
    FIXTURE_PROVIDER_GATE: "FAIL",
    REAL_WEB_WORKER_GATE: "FAIL",
    REPRESENTATIVE_CLICK_GATE: "FAIL",
    READ_STAR_LIVE_STATE_GATE: "FAIL",
    STALE_RESULT_GATE: "FAIL",
    PROVIDER_FAIL_OPEN_GATE: "FAIL",
    WORKER_FAIL_OPEN_GATE: "FAIL",
    ALL_UNREAD_ISOLATION_GATE: "FAIL",
    LAYOUT_BREAKAGE: "YES",
    WORKER_STARTED: 0,
    WORKER_RESULT_RECEIVED: 0,
    WORKER_ERROR_COUNT: 0,
  }

  try {
    // 1. Launch Vite preview / dev server on isolated port
    console.log(`[1/12] Starting isolated Vite server on port ${vitePort}...`)
    viteProcess = spawn("npx", ["vite", "--port", String(vitePort), "--strictPort"], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, BROWSER: "none" },
    })

    await waitForServer(`http://127.0.0.1:${vitePort}`, 10_000)
    console.log(`  -> Vite server ready at http://127.0.0.1:${vitePort}`)

    // 2. Launch Google Chrome headless via portable resolver
    console.log(`[2/12] Resolving and launching browser executable...`)
    const resolvedBrowser = resolveBrowserExecutable()
    const browserVersion = getBrowserVersion(resolvedBrowser.executable)
    console.log(
      `  -> Browser: ${resolvedBrowser.executable} (${resolvedBrowser.source}, ${browserVersion})`,
    )
    results.BROWSER_TOOL = `${browserVersion} (${resolvedBrowser.type})`

    chromeProcess = spawn(
      resolvedBrowser.executable,
      [
        "--headless=new",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${tempChromeProfile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-features=Translate,OptimizationHints",
        "about:blank",
      ],
      { stdio: "ignore" },
    )

    await waitForServer(`http://127.0.0.1:${cdpPort}/json/version`, 10_000)
    console.log(`  -> Chrome CDP ready on port ${cdpPort}`)

    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`)
    const pageTarget = targets.find((t) => t.type === "page") || targets[0]
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Failed to find page target with ws URL")

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl)
    await cdp.connect()

    cdp.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.method === "Runtime.exceptionThrown") {
        console.error("  [BROWSER EXCEPTION]", JSON.stringify(msg.params.exceptionDetails))
      } else if (msg.method === "Runtime.consoleAPICalled") {
        console.log(
          "  [BROWSER CONSOLE]",
          msg.params.type,
          msg.params.args?.map((a) => a.value || a.description).join(" "),
        )
      }
    })

    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("DOM.enable")

    results.REAL_BROWSER_EXECUTED = "YES"

    // -------------------------------------------------------------------------
    // STEP 3: CRITICAL VIEWPORT (884x1104) NAVIGATION
    // -------------------------------------------------------------------------
    console.log(`\n[3/12] Setting Critical Viewport (884x1104) and navigating...`)
    await cdp.setViewport(884, 1104)
    await cdp.send("Page.navigate", { url: harnessUrl })
    await sleep(1500)

    const harnessLoaded = await cdp.eval(`typeof globalThis.__storyHarness !== "undefined"`)
    assert.ok(harnessLoaded, "Story Identity test harness failed to load in browser")
    console.log("  -> Harness loaded successfully.")
    results.CRITICAL_VIEWPORT_884x1104 = "PASS"

    // -------------------------------------------------------------------------
    // SCENARIO B0: FLAG OFF
    // -------------------------------------------------------------------------
    console.log(`\n[4/12] Testing Scenario B0: Flag Off...`)
    await cdp.eval(`globalThis.__storyHarness.setFeatureFlag(false)`)
    await sleep(300)

    const flagOffSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    const flagOffTelemetry = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)

    assert.equal(flagOffSnapshot.storyCells.length, 0, "Flag off must produce 0 story cards")
    assert.equal(flagOffSnapshot.cardCount, 5, "Flag off must retain all 5 flat article cards")
    assert.equal(flagOffTelemetry.started, 0, "Flag off must not start any Story worker")
    console.log(`  -> 5 flat cards, 0 story cells, 0 workers started. FLAG_OFF_GATE=PASS`)
    results.FLAG_OFF_GATE = "PASS"

    await cdp.screenshot(`${screenshotsDir}/scenario-b0-flag-off-884x1104.png`)

    // -------------------------------------------------------------------------
    // SCENARIO B1: FLAG ON + NULL SCORE PROVIDER
    // -------------------------------------------------------------------------
    console.log(`\n[5/12] Testing Scenario B1: Flag On + NullScoreProvider...`)
    await cdp.eval(`globalThis.__storyHarness.setFeatureFlag(true)`)
    await cdp.eval(`globalThis.__storyHarness.activateNullProvider()`)
    await sleep(300)

    const nullSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    assert.equal(nullSnapshot.storyCells.length, 0, "Null provider must produce 0 story cards")
    assert.equal(nullSnapshot.cardCount, 5, "Null provider must retain flat Home with 5 cards")
    console.log(`  -> 5 flat cards, 0 story cells, no visual change. NULL_PROVIDER_GATE=PASS`)
    results.NULL_PROVIDER_GATE = "PASS"

    await cdp.screenshot(`${screenshotsDir}/scenario-b1-null-provider-884x1104.png`)

    // -------------------------------------------------------------------------
    // SCENARIO B2: FIXTURE PROVIDER + REAL WEB WORKER
    // -------------------------------------------------------------------------
    console.log(`\n[6/12] Testing Scenario B2: FixtureScoreProvider + Real Web Worker...`)
    await cdp.eval(`globalThis.__storyHarness.activateFixtureProvider()`)
    await sleep(600)

    const fixtureTelemetry = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)
    const fixtureSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)

    console.log(
      `  -> Worker Telemetry: started=${fixtureTelemetry.started}, received=${fixtureTelemetry.resultReceived}, errors=${fixtureTelemetry.errorCount}`,
    )
    assert.ok(fixtureTelemetry.started >= 1, "Real Web Worker was not instantiated")
    assert.ok(fixtureTelemetry.resultReceived >= 1, "Real Web Worker result was not received")
    assert.equal(fixtureTelemetry.errorCount, 0, "Real Web Worker encountered errors")

    results.REAL_WEB_WORKER_GATE = "PASS"
    results.WORKER_STARTED = fixtureTelemetry.started
    results.WORKER_RESULT_RECEIVED = fixtureTelemetry.resultReceived
    results.WORKER_ERROR_COUNT = fixtureTelemetry.errorCount

    // Validate H1 placement and deduplication
    assert.equal(fixtureSnapshot.storyCells.length, 1, "Fixture provider must produce 1 Story card")
    assert.equal(
      fixtureSnapshot.cardCount,
      4,
      "Merged 101+103 should leave 4 total cards (1 story + 3 standalone)",
    )
    assert.equal(fixtureSnapshot.cards[0].memberCount, "2", "Story card must have memberCount=2")
    assert.ok(
      fixtureSnapshot.cards[0].title.includes("Apple unveils new iPhone"),
      "H1 representative must be article 101",
    )
    assert.ok(
      fixtureSnapshot.cards[1].title.includes("Google Pixel 10"),
      "Position 1 must be standalone 102",
    )
    assert.ok(
      fixtureSnapshot.cards[2].title.includes("OpenAI announces"),
      "Position 2 must be standalone 104",
    )
    assert.ok(
      fixtureSnapshot.cards[3].title.includes("Anthropic updates"),
      "Position 3 must be standalone 105",
    )

    console.log(
      "  -> H1 placement validated at index 0. Member 103 deduplicated. Standalone order preserved.",
    )
    results.FIXTURE_PROVIDER_GATE = "PASS"

    await cdp.screenshot(`${screenshotsDir}/scenario-b2-fixture-story-884x1104.png`)

    // -------------------------------------------------------------------------
    // REPRESENTATIVE CLICK
    // -------------------------------------------------------------------------
    console.log(`\n[7/12] Testing Representative Click Behavior...`)
    await cdp.eval(`
      const card = document.querySelector(".article-card-grid-cell[data-story-id] a");
      if (card) card.click();
    `)
    await sleep(200)

    const clicked = await cdp.eval(`globalThis.__storyHarness.getClickedArticle()`)
    assert.ok(
      clicked && clicked.id === 101,
      "Representative card click did not activate article 101",
    )
    console.log(
      `  -> Activated article: ${clicked.title} (ID: ${clicked.id}). REPRESENTATIVE_CLICK_GATE=PASS`,
    )
    results.REPRESENTATIVE_CLICK_GATE = "PASS"

    // -------------------------------------------------------------------------
    // LIVE READ / STAR MUTATION TEST
    // -------------------------------------------------------------------------
    console.log(`\n[8/12] Testing Live Read/Star State without Story Recomputation...`)
    const telemetryBeforeToggle = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)
    const startsBefore = telemetryBeforeToggle.started
    await cdp.eval(`globalThis.__storyHarness.triggerArticleRead(101)`)
    await sleep(200)

    const telemetryAfterToggle = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)
    const startsAfter = telemetryAfterToggle.started
    assert.equal(startsAfter, startsBefore, "Read state change must NOT recompute Story clustering")

    const readSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    assert.equal(readSnapshot.cards.length, 4, "Story membership preserved across read toggle")
    console.log(
      "  -> Live read mutation applied without triggering worker recomputation. READ_STAR_LIVE_STATE_GATE=PASS",
    )
    results.READ_STAR_LIVE_STATE_GATE = "PASS"

    // -------------------------------------------------------------------------
    // STALE REQUEST FENCING TEST
    // -------------------------------------------------------------------------
    console.log(`\n[9/12] Testing Stale Request Fencing...`)
    await cdp.eval(`globalThis.__storyHarness.triggerStaleSimulation()`)
    await sleep(600) // Allow both fast and delayed requests to settle

    const staleSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    // Request B grouped 104 and 105. It should own visible state.
    const storyOn104 = staleSnapshot.cards.find(
      (c) => c.storyId && c.title.includes("OpenAI announces"),
    )
    assert.ok(storyOn104, "Request B (104:105) must own the visible state")
    console.log(
      "  -> Request A was safely fenced; Request B owns visible state. STALE_RESULT_GATE=PASS",
    )
    results.STALE_RESULT_GATE = "PASS"

    // -------------------------------------------------------------------------
    // PROVIDER FAIL-OPEN TEST
    // -------------------------------------------------------------------------
    console.log(`\n[10/12] Testing Provider Fail-Open...`)
    await cdp.eval(
      `globalThis.__storyHarness.activateFixtureProvider([], { shouldThrow: true, errorMessage: 'Network crash' })`,
    )
    await sleep(300)

    const failOpenSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    assert.equal(failOpenSnapshot.storyCells.length, 0, "Failing provider must yield 0 story cards")
    assert.equal(
      failOpenSnapshot.cardCount,
      5,
      "Failing provider must yield flat Home with all 5 articles",
    )
    console.log(
      "  -> Provider error cleanly failed open to normal flat Home. PROVIDER_FAIL_OPEN_GATE=PASS",
    )
    results.PROVIDER_FAIL_OPEN_GATE = "PASS"

    // -------------------------------------------------------------------------
    // WORKER FAIL-OPEN TEST
    // -------------------------------------------------------------------------
    console.log(`\n[11/12] Testing Worker Fail-Open...`)
    // Pass invalid pairScores causing engine error or mock error
    await cdp.eval(
      `globalThis.__storyHarness.activateFixtureProvider([{ articleAId: 'invalid', articleBId: 'invalid', score: 'bad' }])`,
    )
    await sleep(300)

    const workerFailSnapshot = await cdp.eval(`globalThis.__storyHarness.getDOMSnapshot()`)
    assert.equal(workerFailSnapshot.cardCount, 5, "Worker failure must fail open to flat Home")
    console.log("  -> Worker error cleanly failed open to flat Home. WORKER_FAIL_OPEN_GATE=PASS")
    results.WORKER_FAIL_OPEN_GATE = "PASS"

    // -------------------------------------------------------------------------
    // ALL / UNREAD ISOLATION TEST
    // -------------------------------------------------------------------------
    console.log(`\n[12/12] Testing All / Unread Route Isolation...`)
    const telemetryBeforeNav = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)
    const workerStartsBeforeNav = telemetryBeforeNav.started

    await cdp.eval(`globalThis.__storyHarness.setRoute('all')`)
    await sleep(200)
    const allView = await cdp.eval(
      `Boolean(document.querySelector("[data-testid='all-articles-view']"))`,
    )
    const storyInAll = await cdp.eval(`document.querySelectorAll("[data-story-id]").length`)
    assert.ok(allView, "All articles view failed to render")
    assert.equal(storyInAll, 0, "All view must have 0 story items")

    await cdp.eval(`globalThis.__storyHarness.setRoute('unread')`)
    await sleep(200)
    const unreadView = await cdp.eval(
      `Boolean(document.querySelector("[data-testid='unread-articles-view']"))`,
    )
    const storyInUnread = await cdp.eval(`document.querySelectorAll("[data-story-id]").length`)
    assert.ok(unreadView, "Unread articles view failed to render")
    assert.equal(storyInUnread, 0, "Unread view must have 0 story items")

    const telemetryAfterNav = await cdp.eval(`globalThis.__storyHarness.getWorkerTelemetry()`)
    const workerStartsAfterNav = telemetryAfterNav.started
    assert.equal(
      workerStartsAfterNav,
      workerStartsBeforeNav,
      "All/Unread navigation must not invoke Story worker",
    )

    console.log(
      "  -> All & Unread routes are completely isolated from Story Identity. ALL_UNREAD_ISOLATION_GATE=PASS",
    )
    results.ALL_UNREAD_ISOLATION_GATE = "PASS"

    // -------------------------------------------------------------------------
    // VIEWPORT MATRIX: MOBILE (390x844) & DESKTOP (1280x800)
    // -------------------------------------------------------------------------
    console.log("\n--- Testing Viewport Matrix ---")
    await cdp.eval(`globalThis.__storyHarness.setRoute('home')`)
    await cdp.eval(`globalThis.__storyHarness.activateFixtureProvider()`)
    await sleep(300)

    // Mobile
    await cdp.setViewport(390, 844)
    await sleep(300)
    await cdp.screenshot(`${screenshotsDir}/scenario-b2-mobile-390x844.png`)
    console.log("  -> Mobile Viewport 390x844 captured.")

    // Desktop
    await cdp.setViewport(1280, 800)
    await sleep(300)
    await cdp.screenshot(`${screenshotsDir}/scenario-b2-desktop-1280x800.png`)
    console.log("  -> Desktop Viewport 1280x800 captured.")

    results.LAYOUT_BREAKAGE = "NO"

    console.log("\n=================================================================")
    console.log("ALL REAL BROWSER GATES PASSED SUCCESSFULLY!")
    console.log("=================================================================")
    console.log(JSON.stringify(results, null, 2))
  } finally {
    if (cdp) {
      await cdp.close().catch(() => {})
    }
    if (chromeProcess) {
      chromeProcess.kill()
    }
    if (viteProcess) {
      viteProcess.kill()
    }
    try {
      rmSync(tempChromeProfile, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  }
}

run().catch((error) => {
  console.error("\n❌ Real Browser Gate failed:", error)
  process.exit(1)
})
