/* eslint-disable unicorn/no-process-exit, unicorn/prefer-top-level-await, unicorn/prefer-add-event-listener */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const screenshotsDir = "/tmp/newsflux-pr125-screenshots"
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
      if (msg.method === "Runtime.consoleAPICalled") {
        console.log(
          "  [BROWSER CONSOLE]",
          msg.params.args.map((a) => a.value || a.description || JSON.stringify(a)).join(" "),
        )
      }
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
      captureBeyondViewport: false,
      format: "png",
    })
    const buffer = Buffer.from(res.data, "base64")
    writeFileSync(outputPath, buffer)
    console.log(`Saved screenshot: ${outputPath}`)
  }

  async setViewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      deviceScaleFactor: 2,
      height,
      mobile: width < 600,
      width,
    })
    await this.send("Emulation.setVisibleSize", { height, width })
  }

  async close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

async function run() {
  console.log("Starting READER-VISUAL-02B Real Browser Chrome Visibility Gate...")

  const vitePort = 5176
  const cdpPort = 9224
  const harnessUrl = `http://127.0.0.1:${vitePort}/scripts/tests/reader02b-chrome-visibility.html`

  let viteProcess = null
  let chromeProcess = null
  let cdp = null
  const tempChromeProfile = mkdtempSync(path.join(os.tmpdir(), "chrome-gate-pr125-"))

  try {
    // 1. Launch Vite dev server
    viteProcess = spawn("npx", ["vite", "--port", String(vitePort), "--strictPort"], {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
      stdio: "pipe",
    })

    await waitForServer(`http://127.0.0.1:${vitePort}`, 10_000)
    console.log(`Vite harness server ready at http://127.0.0.1:${vitePort}`)

    // 2. Launch Google Chrome headless
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    chromeProcess = spawn(
      chromePath,
      [
        "--headless=new",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${tempChromeProfile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-sync",
        "--hide-scrollbars",
        "about:blank",
      ],
      { stdio: "ignore" },
    )

    // Wait for Chrome CDP port to become available
    let versionJson = null
    const cdpStart = Date.now()
    while (Date.now() - cdpStart < 10_000) {
      try {
        versionJson = await fetchJson(`http://127.0.0.1:${cdpPort}/json/version`)
        if (versionJson?.webSocketDebuggerUrl) {
          break
        }
      } catch {
        await sleep(200)
      }
    }
    if (!versionJson?.webSocketDebuggerUrl) {
      throw new Error("Chrome CDP endpoint failed to respond within 10s")
    }

    console.log(`Chrome Headless with CDP ready on port ${cdpPort}`)

    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json`)
    const pageTarget = targets.find((t) => t.type === "page") || targets[0]
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error("No page target available in Chrome")
    }

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl)
    await cdp.connect()

    await cdp.send("Page.enable")
    await cdp.send("DOM.enable")
    await cdp.send("CSS.enable")
    await cdp.send("Runtime.enable")

    await cdp.send("Page.navigate", { url: harnessUrl })
    await sleep(2000)

    const viewports = [
      { height: 844, name: "mobile_390x844", width: 390 },
      { height: 1104, name: "tablet_884x1104", width: 884 },
      { height: 800, name: "desktop_1280x800", width: 1280 },
    ]

    for (const vp of viewports) {
      console.log(`\n==================================================`)
      console.log(`Testing Viewport: ${vp.name} (${vp.width}x${vp.height})`)
      console.log(`==================================================`)

      await cdp.setViewport(vp.width, vp.height)
      await sleep(500)

      // Step 1: Initial state at top (unfocused, top of scroll container)
      await cdp.eval("window.__READER_TEST__.blurButton()")
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await sleep(300)

      let state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: initial top should not have hidden class`,
      )
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: initial top state should be VISIBLE`)
      assert.equal(state.opacity, "1", `${vp.name}: initial top opacity should be 1`)
      console.log(`  [PASS] Initial at top: VISIBLE, opacity 1`)

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_01_top_visible.png`))

      // Step 2: Scroll inside top zone (<= 64px)
      await cdp.eval("window.__READER_TEST__.scrollTo(50)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: top zone (50px) should keep chrome visible`,
      )
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: top zone state should be VISIBLE`)
      console.log(`  [PASS] Inside top zone (50px): VISIBLE`)

      // Step 3: Scroll to 64px, then small sub-threshold delta (8px past 64px, e.g. 72px)
      await cdp.eval("window.__READER_TEST__.scrollTo(64)")
      await sleep(150)
      await cdp.eval("window.__READER_TEST__.scrollTo(72)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: sub-threshold scroll (8px past top zone) should keep chrome visible`,
      )
      console.log(`  [PASS] Sub-threshold downward scroll: VISIBLE`)

      // Step 4: Scroll down past downThreshold (accumulate >= 16px downward, e.g. 150px)
      await cdp.eval("window.__READER_TEST__.scrollTo(150)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      console.log(`  Step 4 state at 150px:`, state)
      assert.equal(
        state.hasHiddenClass,
        true,
        `${vp.name}: scroll down to 150px should hide chrome`,
      )
      assert.equal(
        state.dataState,
        "HIDDEN_BY_SCROLL",
        `${vp.name}: state should be HIDDEN_BY_SCROLL`,
      )
      assert.equal(state.opacity, "0", `${vp.name}: hidden chrome opacity should be 0`)
      assert.equal(
        state.pointerEvents,
        "none",
        `${vp.name}: hidden chrome pointerEvents should be none`,
      )
      console.log(
        `  [PASS] Downward reading past threshold (150px): HIDDEN_BY_SCROLL, opacity 0, pointer-events none`,
      )

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_02_hidden_by_scroll.png`))

      // Step 5: Upward scroll prompt return (scroll up by 15px >= 12px, e.g. to 135px)
      await cdp.eval("window.__READER_TEST__.scrollTo(135)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: upward scroll (15px) should reveal chrome`,
      )
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: revealed state should be VISIBLE`)
      assert.equal(state.opacity, "1", `${vp.name}: revealed opacity should be 1`)
      console.log(`  [PASS] Upward scroll prompt return: VISIBLE, opacity 1`)

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_03_upward_return_visible.png`))

      // Step 6: Return all the way to top
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(state.hasHiddenClass, false, `${vp.name}: return to top should be visible`)
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: return to top should be VISIBLE`)
      console.log(`  [PASS] Return to top zone: VISIBLE`)

      // Step 7: Focus safety prevents hide
      // First scroll down to hide chrome
      await cdp.eval("window.__READER_TEST__.scrollTo(200)")
      await sleep(300)
      const preFocusState = await cdp.eval("window.__READER_TEST__.getChromeState()")
      const currentScroll = await cdp.eval("window.__READER_TEST__.getScrollTop()")
      console.log(
        `  Pre-focus check at scrollTop ${currentScroll}: dataState=${preFocusState?.dataState}, hasHidden=${preFocusState?.hasHiddenClass}`,
      )

      // Focus a button inside chrome
      const focused = await cdp.eval("window.__READER_TEST__.focusButton()")
      console.log(`  focusButton result: ${focused}`)
      await sleep(300)
      const postFocusScroll = await cdp.eval("window.__READER_TEST__.getScrollTop()")
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      console.log(
        `  Post-focus state: scrollTop=${postFocusScroll}, dataState=${state?.dataState}, isFocusWithin=${state?.isFocusWithin}`,
      )
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: focused chrome must not have hidden class`,
      )
      assert.equal(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: state must be FORCED_VISIBLE_INTERACTION`,
      )
      assert.equal(state.opacity, "1", `${vp.name}: focused opacity must be 1`)

      // While focused, scroll down further to 300px
      await cdp.eval("window.__READER_TEST__.scrollTo(300)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: scrolling down while focused must NOT hide chrome`,
      )
      assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
      console.log(
        `  [PASS] Focus safety guarantee: forced visible while focused, withstands downward scroll`,
      )

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_04_focus_safety_visible.png`))

      // Step 8: Article change reset
      // Reset scroll to 0 and blur button
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await cdp.eval("window.__READER_TEST__.blurButton()")
      await sleep(200)

      // Scroll down to hide
      await cdp.eval("window.__READER_TEST__.scrollTo(250)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      console.log(`  Step 8 pre-change state at 250px:`, state)
      assert.equal(state.hasHiddenClass, true, `${vp.name}: should be hidden at 250px`)

      // Trigger article change with unique ID for this viewport
      const nextArticleId = vp.width + 1000
      await cdp.eval(`window.__READER_TEST__.changeArticle(${nextArticleId})`)
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      console.log(`  Step 8 post-change state:`, state)
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: article change must reset chrome to visible`,
      )
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: article change reset state to VISIBLE`)
      console.log(`  [PASS] Article change reset: chrome resets to VISIBLE`)
    }

    // Step 9: Reduced motion verification
    console.log(`\n==================================================`)
    console.log(`Testing prefers-reduced-motion contract`)
    console.log(`==================================================`)

    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      media: "screen",
    })
    await sleep(300)

    const reducedMotionTransition = await cdp.eval(
      `window.getComputedStyle(document.querySelector('.action-buttons')).transitionDuration`,
    )
    console.log(`  Reduced motion transition-duration: "${reducedMotionTransition}"`)
    assert.ok(
      reducedMotionTransition === "0s" || reducedMotionTransition === "",
      `Reduced motion must disable transition (expected 0s, got ${reducedMotionTransition})`,
    )
    console.log(`  [PASS] Reduced motion contract verified (transition-duration: 0s)`)

    console.log(`\n==================================================`)
    console.log(`ALL REAL BROWSER CHECKS PASSED SUCCESSFULLY across 3 viewports!`)
    console.log(`==================================================`)
  } finally {
    if (cdp) {
      await cdp.close()
    }
    if (chromeProcess) {
      chromeProcess.kill()
    }
    if (viteProcess) {
      viteProcess.kill()
    }
    try {
      rmSync(tempChromeProfile, { force: true, recursive: true })
    } catch {
      // ignore
    }
  }
}

run().catch((error) => {
  console.error("Gate failed:", error)
  process.exit(1)
})
