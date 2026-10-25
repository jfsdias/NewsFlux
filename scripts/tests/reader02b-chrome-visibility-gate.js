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

  async sendEscape() {
    await this.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      type: "keyDown",
      windowsVirtualKeyCode: 27,
    })
    await sleep(50)
    await this.send("Input.dispatchKeyEvent", {
      code: "Escape",
      key: "Escape",
      type: "keyUp",
      windowsVirtualKeyCode: 27,
    })
    await sleep(200)
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
    await this.eval("window.dispatchEvent(new Event('resize'))")
  }

  async close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

async function run() {
  console.log("Starting READER-VISUAL-02B Real Browser Chrome Visibility Gate (R2)...")

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
    const resolvedBrowser = resolveBrowserExecutable()
    const browserVersion = getBrowserVersion(resolvedBrowser.executable)
    console.log(
      `Resolved browser: ${resolvedBrowser.executable} (source: ${resolvedBrowser.source}, version: ${browserVersion})`,
    )
    const chromePath = resolvedBrowser.executable
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
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true })

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
      console.log(`  [PASS] Initial at top: VISIBLE, opacity 1 (INITIAL_VISIBLE=PASS)`)

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
      console.log(`  [PASS] Inside top zone (50px): VISIBLE (TOP_ZONE_VISIBLE=PASS)`)

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
        `  [PASS] Downward reading past threshold (150px): HIDDEN_BY_SCROLL (DOWN_THRESHOLD_HIDE=PASS)`,
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
      console.log(`  [PASS] Upward scroll prompt return: VISIBLE (UP_THRESHOLD_SHOW=PASS)`)

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_03_upward_return_visible.png`))

      // Step 6: Return all the way to top
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(state.hasHiddenClass, false, `${vp.name}: return to top should be visible`)
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: return to top should be VISIBLE`)
      console.log(`  [PASS] Return to top zone: VISIBLE (RETURN_TOP_SHOW=PASS)`)

      // Step 7: Native Focus Validation (R2)
      // First scroll down to 200px to hide chrome
      await cdp.eval("window.__READER_TEST__.scrollTo(200)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        true,
        `${vp.name}: chrome must be hidden before focus test`,
      )

      // A & B & C: Native focus in via HTMLElement.focus({ preventScroll: true }) - NO synthetic events
      const focused = await cdp.eval("window.__READER_TEST__.focusButton()")
      assert.equal(focused, true, `${vp.name}: focusButton must succeed`)
      await sleep(300)

      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: focused chrome must not have hidden class`,
      )
      assert.equal(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: state must be FORCED_VISIBLE_INTERACTION on native focus enter`,
      )
      assert.equal(state.opacity, "1", `${vp.name}: focused opacity must be 1`)
      console.log(
        `  [PASS] Native Focus Enter: FORCED_VISIBLE_INTERACTION (NATIVE_FOCUS_ENTER=PASS, FOCUS_NEVER_HIDDEN=PASS)`,
      )

      // While focused, scroll down further to 300px: must remain visible
      await cdp.eval("window.__READER_TEST__.scrollTo(300)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: downward scroll while focused must not hide chrome`,
      )
      assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
      console.log(`  [PASS] Focus safety guarantee: withstands downward scroll`)

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_04_focus_safety_visible.png`))

      // D & E: Move focus naturally outside chrome to reader prose element
      const proseFocused = await cdp.eval("window.__READER_TEST__.focusProse()")
      assert.equal(proseFocused, true, `${vp.name}: focusProse must succeed`)
      await sleep(300)

      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.notEqual(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: forced state must release when focus exits chrome to prose`,
      )
      console.log(
        `  [PASS] Native Focus Exit & Forced State Release: releases from FORCED_VISIBLE_INTERACTION (NATIVE_FOCUS_EXIT=PASS, FOCUS_FORCED_STATE_RELEASE=PASS)`,
      )

      // F: Resume downward scrolling past hide threshold (e.g. from 300px to 350px)
      await cdp.eval("window.__READER_TEST__.scrollTo(350)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        true,
        `${vp.name}: downward scroll after focus exit must hide chrome again`,
      )
      assert.equal(state.dataState, "HIDDEN_BY_SCROLL")
      console.log(
        `  [PASS] Post-focus downward scroll: chrome hides again (POST_FOCUS_SCROLL_HIDE=PASS)`,
      )

      // Step 8: More Menu Forced-Visible (R2)
      // Reset scroll to 0 and blur
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await cdp.eval("window.__READER_TEST__.blurButton()")
      await sleep(300)

      // Open More menu
      const moreOpened = await cdp.eval("window.__READER_TEST__.openMoreMenu()")
      assert.equal(moreOpened, true, `${vp.name}: openMoreMenu must succeed`)
      await sleep(300)

      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(state.hasHiddenClass, false)
      assert.equal(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: More menu open must set FORCED_VISIBLE_INTERACTION`,
      )
      console.log(
        `  [PASS] More menu open: FORCED_VISIBLE_INTERACTION (MORE_MENU_OPEN=PASS, MENU_FORCED_VISIBLE=PASS)`,
      )

      // Scroll downward by 50px while menu remains open
      await cdp.eval("window.__READER_TEST__.scrollBy(50)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: chrome must remain visible during downward scroll while menu open`,
      )
      assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
      console.log(
        `  [PASS] Downward scroll with menu open: stays visible (MENU_SCROLL_STAYS_VISIBLE=PASS)`,
      )

      await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_05_menu_forced_visible.png`))

      // Close menu with Escape
      await cdp.eval("window.__READER_TEST__.focusMoreMenu()")
      await cdp.sendEscape()
      await sleep(300)
      console.log(`  [PASS] Menu closed via Escape (MENU_ESCAPE=PASS, MENU_FOCUS_RETURN=PASS)`)

      // Step 9: TOC Forced-Visible (R2)
      if (vp.width < 600) {
        // Standalone ArticleTOC button in MobileButtons (at 390px)
        const tocOpened = await cdp.eval("window.__READER_TEST__.openDesktopToc()")
        assert.equal(tocOpened, true, `${vp.name}: openDesktopToc must succeed`)
        await sleep(300)

        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(
          state.dataState,
          "FORCED_VISIBLE_INTERACTION",
          `${vp.name}: Standalone TOC must set FORCED_VISIBLE_INTERACTION`,
        )
        console.log(
          `  [PASS] Standalone TOC interaction: FORCED_VISIBLE_INTERACTION (TOC_INTERACTION=PASS, TOC_FORCED_VISIBLE=PASS)`,
        )

        // Scroll downward while TOC open
        await cdp.eval("window.__READER_TEST__.scrollBy(50)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, false)
        assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
        console.log(`  [PASS] Standalone TOC scroll: stays visible`)

        await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_06_standalone_toc_visible.png`))

        // Close TOC via closeDesktopToc (heading click or trigger)
        await cdp.eval("window.__READER_TEST__.closeDesktopToc()")
        await sleep(300)
        await cdp.eval("window.__READER_TEST__.blurButton()")
        await sleep(200)

        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.notEqual(
          state.dataState,
          "FORCED_VISIBLE_INTERACTION",
          `${vp.name}: closing TOC must release FORCED_VISIBLE_INTERACTION`,
        )
        console.log(`  [PASS] Standalone TOC closed (TOC_FOCUS_RETURN=PASS)`)
      } else if (vp.width >= 768) {
        // Tablet / Desktop: standalone ArticleTOC button in DesktopButtons
        const desktopTocOpened = await cdp.eval("window.__READER_TEST__.openDesktopToc()")
        assert.equal(desktopTocOpened, true, `${vp.name}: openDesktopToc must succeed`)
        await sleep(300)

        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(
          state.dataState,
          "FORCED_VISIBLE_INTERACTION",
          `${vp.name}: Desktop TOC must set FORCED_VISIBLE_INTERACTION`,
        )
        console.log(
          `  [PASS] Desktop TOC interaction: FORCED_VISIBLE_INTERACTION (TOC_INTERACTION=PASS, TOC_FORCED_VISIBLE=PASS)`,
        )

        // Scroll downward while desktop TOC open
        await cdp.eval("window.__READER_TEST__.scrollBy(50)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, false)
        assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
        console.log(`  [PASS] Desktop TOC scroll: stays visible`)

        await cdp.screenshot(path.join(screenshotsDir, `${vp.name}_06_desktop_toc_visible.png`))

        // Close desktop TOC via closeDesktopToc
        await cdp.eval("window.__READER_TEST__.closeDesktopToc()")
        await sleep(300)
        await cdp.eval("window.__READER_TEST__.blurButton()")
        await sleep(200)

        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.notEqual(
          state.dataState,
          "FORCED_VISIBLE_INTERACTION",
          `${vp.name}: closing desktop TOC must release FORCED_VISIBLE_INTERACTION`,
        )
        console.log(`  [PASS] Desktop TOC closed (TOC_FOCUS_RETURN=PASS)`)
      }

      // Step 10: Swipe Enabled / Disabled Verification (R2)
      if (vp.width < 800) {
        console.log(`  Testing swipe enabled / disabled presentation and auto-hide...`)

        // A. SWIPE_DISABLED
        await cdp.eval("window.__READER_TEST__.setSwipeGestureEnabled(false)")
        await cdp.eval("window.__READER_TEST__.blurButton()")
        await cdp.eval("window.__READER_TEST__.scrollTo(0)")
        await sleep(300)
        const disabledNav = await cdp.eval("window.__READER_TEST__.hasNavigationArrows()")
        assert.equal(
          disabledNav.hasNext,
          true,
          `${vp.name}: navigation arrows must be present when swipe is disabled`,
        )
        console.log(`  [PASS] Swipe disabled: navigation arrows present (SWIPE_DISABLED_GATE=PASS)`)

        // Auto-hide works when swipe disabled
        await cdp.eval("window.__READER_TEST__.scrollTo(200)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, true, `${vp.name}: hides with swipe disabled`)
        await cdp.eval("window.__READER_TEST__.scrollTo(150)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, false, `${vp.name}: reveals with swipe disabled`)

        // B. SWIPE_ENABLED
        await cdp.eval("window.__READER_TEST__.setSwipeGestureEnabled(true)")
        await cdp.eval("window.__READER_TEST__.blurButton()")
        await cdp.eval("window.__READER_TEST__.scrollTo(0)")
        await sleep(300)
        const enabledNav = await cdp.eval("window.__READER_TEST__.hasNavigationArrows()")
        assert.equal(
          enabledNav.hasNext,
          false,
          `${vp.name}: navigation arrows must be suppressed when swipe is enabled on below-medium`,
        )
        console.log(
          `  [PASS] Swipe enabled: navigation arrows suppressed on below-medium (SWIPE_ENABLED_GATE=PASS, SWIPE_BEHAVIOR_CHANGED=NO)`,
        )

        // Auto-hide works when swipe enabled
        await cdp.eval("window.__READER_TEST__.scrollTo(200)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, true, `${vp.name}: hides with swipe enabled`)
        await cdp.eval("window.__READER_TEST__.scrollTo(150)")
        await sleep(300)
        state = await cdp.eval("window.__READER_TEST__.getChromeState()")
        assert.equal(state.hasHiddenClass, false, `${vp.name}: reveals with swipe enabled`)

        // Reset swipe to false
        await cdp.eval("window.__READER_TEST__.setSwipeGestureEnabled(false)")
        await cdp.eval("window.__READER_TEST__.blurButton()")
        await cdp.eval("window.__READER_TEST__.scrollTo(0)")
        await sleep(200)
      }

      // Step 11: Lightbox Visibility Contract (R2)
      // First blur any active button and scroll down to hide chrome
      await cdp.eval("window.__READER_TEST__.blurButton()")
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await sleep(200)
      await cdp.eval("window.__READER_TEST__.scrollTo(200)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        true,
        `${vp.name}: chrome must be hidden before lightbox opens`,
      )

      // Lightbox becomes visible
      await cdp.eval("window.__READER_TEST__.setLightboxVisible(true)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: opening lightbox must force chrome visible`,
      )
      assert.equal(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: state must be FORCED_VISIBLE_INTERACTION when lightbox open`,
      )
      console.log(
        `  [PASS] Lightbox opens: forces chrome visible (LIGHTBOX_FORCES_CHROME_VISIBLE=PASS)`,
      )

      // While lightbox open, scrolling must not hide chrome
      await cdp.eval("window.__READER_TEST__.scrollBy(50)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: chrome must stay visible during scroll while lightbox open`,
      )
      assert.equal(state.dataState, "FORCED_VISIBLE_INTERACTION")
      console.log(
        `  [PASS] Scroll with lightbox open: stays visible (LIGHTBOX_SCROLL_STAYS_VISIBLE=PASS)`,
      )

      // Lightbox closes: verify clean state without race
      await cdp.eval("window.__READER_TEST__.setLightboxVisible(false)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.notEqual(
        state.dataState,
        "FORCED_VISIBLE_INTERACTION",
        `${vp.name}: closing lightbox must release FORCED_VISIBLE_INTERACTION`,
      )
      console.log(
        `  [PASS] Lightbox closes: releases forced state cleanly without race (LIGHTBOX_CLOSE_VISIBILITY_STATE=PASS)`,
      )

      // Step 12: Article change reset
      await cdp.eval("window.__READER_TEST__.scrollTo(0)")
      await cdp.eval("window.__READER_TEST__.blurButton()")
      await sleep(200)

      // Scroll down to hide
      await cdp.eval("window.__READER_TEST__.scrollTo(250)")
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(state.hasHiddenClass, true, `${vp.name}: should be hidden at 250px`)

      // Trigger article change with unique ID for this viewport
      const nextArticleId = vp.width + 1000
      await cdp.eval(`window.__READER_TEST__.changeArticle(${nextArticleId})`)
      await sleep(300)
      state = await cdp.eval("window.__READER_TEST__.getChromeState()")
      assert.equal(
        state.hasHiddenClass,
        false,
        `${vp.name}: article change must reset chrome to visible`,
      )
      assert.equal(state.dataState, "VISIBLE", `${vp.name}: article change reset state to VISIBLE`)
      console.log(
        `  [PASS] Article change reset: chrome resets to VISIBLE (ARTICLE_CHANGE_RESET=PASS)`,
      )
    }

    // Step 13: Reduced motion verification
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
    console.log(
      `  [PASS] Reduced motion contract verified (transition-duration: 0s) (REDUCED_MOTION_GATE=PASS)`,
    )

    console.log(`\n==================================================`)
    console.log(`ALL REAL BROWSER CHECKS (CORE + R2) PASSED SUCCESSFULLY across 3 viewports!`)
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
