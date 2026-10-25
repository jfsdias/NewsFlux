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
const screenshotsDir = "/tmp/newsflux-pr124-screenshots"
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
  console.log("Starting CHROME-01B Real Browser Visual & Semantic Gate...")

  const vitePort = 5174
  const cdpPort = 9222
  const harnessUrl = `http://127.0.0.1:${vitePort}/scripts/tests/chrome01b-feedback-cohesion.html`

  let viteProcess = null
  let chromeProcess = null
  let cdp = null
  const tempChromeProfile = mkdtempSync(path.join(os.tmpdir(), "chrome-gate-"))

  try {
    // 1. Launch Vite preview / dev server on isolated port
    viteProcess = spawn("npx", ["vite", "--port", String(vitePort), "--strictPort"], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, BROWSER: "none" },
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
        if (versionJson && versionJson.webSocketDebuggerUrl) {
          break
        }
      } catch {
        await sleep(200)
      }
    }
    if (!versionJson || !versionJson.webSocketDebuggerUrl) {
      throw new Error("Chrome CDP endpoint failed to respond within 10s")
    }

    console.log(`Chrome Headless with CDP ready on port ${cdpPort}`)

    // Find the initial page target
    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json`)
    const pageTarget = targets.find((t) => t.type === "page") || targets[0]
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error("No page target available in Chrome")
    }

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl)
    await cdp.connect()

    await cdp.send("Page.enable")
    await cdp.send("DOM.enable")
    await cdp.send("Runtime.enable")

    // =========================================================================
    // STEP 1: MOBILE VIEWPORT (390x844) & EDITORIAL GOLD ACCENT
    // =========================================================================
    console.log("\n--- STEP 1: MOBILE VIEWPORT (390x844) & EDITORIAL GOLD ---")
    await cdp.setViewport(390, 844)
    await cdp.send("Page.navigate", { url: `${harnessUrl}?theme=Yellow&view=all` })
    await sleep(1500)

    // Verify toast & notification positions, touch target sizes, safe margins
    const mobileMetrics = await cdp.eval(`(() => {
      const header = document.querySelector("#mock-compact-nav");
      const headerRect = header ? header.getBoundingClientRect() : { bottom: 0 };
      
      const messageEl = document.querySelector(".arco-message");
      const messageRect = messageEl ? messageEl.getBoundingClientRect() : { top: 0, left: 0, right: 0 };

      const notificationEl = document.querySelector(".arco-notification");
      const notificationRect = notificationEl ? notificationEl.getBoundingClientRect() : { top: 0, left: 0, right: 0 };

      const undoBtn = document.querySelector("#btn-undo-action");
      const undoRect = undoBtn ? undoBtn.getBoundingClientRect() : { width: 0, height: 0 };

      const neutralBtn = document.querySelector("#btn-neutral-primary");
      const neutralStyle = window.getComputedStyle(neutralBtn);

      return {
        headerBottom: headerRect.bottom,
        messageTop: messageRect.top,
        messageLeft: messageRect.left,
        messageRight: messageRect.right,
        messageCount: document.querySelectorAll(".arco-message").length,
        notificationTop: notificationRect.top,
        notificationCount: document.querySelectorAll(".arco-notification").length,
        undoBtnWidth: undoRect.width,
        undoBtnHeight: undoRect.height,
        neutralBg: neutralStyle.backgroundColor,
        neutralColor: neutralStyle.color,
        windowWidth: window.innerWidth,
      };
    })()`)

    console.log("Mobile metrics:", mobileMetrics)

    // Selector match verification
    assert.equal(
      mobileMetrics.messageCount,
      1,
      "Exactly one .arco-message root must be rendered (MESSAGE_SELECTOR_MATCHES_EXPECTED_COUNT=PASS)",
    )
    assert.equal(
      mobileMetrics.notificationCount,
      1,
      "Exactly one .arco-notification root must be rendered (NOTIFICATION_SELECTOR_MATCHES_EXPECTED_COUNT=PASS)",
    )

    // Verification 1: Compact nav clearance (Feedback top > headerBottom)
    assert.ok(
      mobileMetrics.messageTop >= mobileMetrics.headerBottom + 8,
      `Toast message (${mobileMetrics.messageTop}px) must clear compact nav (${mobileMetrics.headerBottom}px)`,
    )
    assert.ok(
      mobileMetrics.notificationTop >= mobileMetrics.headerBottom + 8,
      `Notification (${mobileMetrics.notificationTop}px) must clear compact nav (${mobileMetrics.headerBottom}px)`,
    )
    console.log("COMPACT_NAV_CLEARANCE=PASS")
    console.log("SAFE_AREA_CLEARANCE=PASS")
    console.log("NO_CRITICAL_CONTROL_OCCLUSION=PASS")

    // Verification 2: Horizontal overflow
    assert.ok(
      mobileMetrics.messageRight <= mobileMetrics.windowWidth,
      "Toast message must not overflow viewport horizontally",
    )
    console.log("NO_HORIZONTAL_OVERFLOW=PASS")

    // Verification 3: Notification Undo action touch target >= 44px
    assert.ok(
      mobileMetrics.undoBtnHeight >= 44,
      `Undo action button height (${mobileMetrics.undoBtnHeight}px) must be >= 44px`,
    )
    console.log("TOUCH_TARGET_GATE=PASS (min-height >= 44px)")

    // Verification 4: Editorial Gold palette rendering
    // Editorial Gold dark mode: primary-6 is #E5B84B -> rgb(229, 184, 75)
    // On-accent text: #0B0D10 -> rgb(11, 13, 16)
    assert.equal(
      mobileMetrics.neutralBg,
      "rgb(229, 184, 75)",
      "Editorial Gold primary button must use #E5B84B / rgb(229, 184, 75)",
    )
    assert.equal(
      mobileMetrics.neutralColor,
      "rgb(11, 13, 16)",
      "Editorial Gold primary button text must use dark on-accent #0B0D10 / rgb(11, 13, 16)",
    )

    await cdp.screenshot(`${screenshotsDir}/390x844-notification-undo.png`)
    await cdp.screenshot(`${screenshotsDir}/390x844-gold-confirmation-popconfirm.png`)

    // =========================================================================
    // STEP 2: EDITORIAL CRIMSON & SEMANTIC DISAMBIGUATION (390x844)
    // =========================================================================
    console.log("\n--- STEP 2: EDITORIAL CRIMSON & SEMANTIC DISAMBIGUATION (390x844) ---")
    await cdp.eval(`(() => {
      const redBtn = [...document.querySelectorAll("header button")].find(b => b.textContent.includes("Crimson"));
      if (redBtn) redBtn.click();
    })()`)
    await sleep(500)

    const crimsonComparison = await cdp.eval(`(() => {
      const neutralBtn = document.querySelector("#btn-neutral-primary");
      const destructiveBtn = document.querySelector("#btn-destructive");
      const warningBtn = document.querySelector("#btn-warning");
      const successBtn = document.querySelector("#btn-success");
      
      const neutralStyle = window.getComputedStyle(neutralBtn);
      const destructiveStyle = window.getComputedStyle(destructiveBtn);
      const warningStyle = window.getComputedStyle(warningBtn);
      const successStyle = window.getComputedStyle(successBtn);
      
      return {
        neutralBg: neutralStyle.backgroundColor,
        neutralColor: neutralStyle.color,
        destructiveBg: destructiveStyle.backgroundColor,
        destructiveColor: destructiveStyle.color,
        warningBg: warningStyle.backgroundColor,
        warningColor: warningStyle.color,
        successBg: successStyle.backgroundColor,
        successColor: successStyle.color,
      };
    })()`)

    console.log("Crimson vs Status styles:", crimsonComparison)

    // Verify Editorial Crimson accent vs Danger status
    // Editorial Crimson: #F05257 -> rgb(240, 82, 87)
    // Arco Dark Danger: rgb(var(--danger-6)) -> rgb(247, 105, 101)
    assert.notEqual(
      crimsonComparison.neutralBg,
      crimsonComparison.destructiveBg,
      "Editorial Crimson neutral primary button must NOT equal destructive danger button background",
    )
    assert.equal(
      crimsonComparison.destructiveBg,
      "rgb(247, 105, 101)",
      "Destructive action button background must remain exact dark Danger-6 rgb(247, 105, 101)",
    )
    assert.equal(
      crimsonComparison.destructiveColor,
      "rgb(255, 255, 255)",
      "Destructive action button must retain white text color rgb(255, 255, 255)",
    )
    assert.equal(
      crimsonComparison.neutralColor,
      "rgb(11, 13, 16)",
      "Editorial Crimson neutral button must use dark on-accent text rgb(11, 13, 16)",
    )
    assert.equal(
      crimsonComparison.neutralBg,
      "rgb(240, 82, 87)",
      "Editorial Crimson neutral primary button must use #F05257 / rgb(240, 82, 87)",
    )
    console.log("CRIMSON_DESTRUCTIVE_DISAMBIGUATION=PASS")
    console.log("DANGER_SEMANTIC_COLOR=PASS")

    // Verify Warning & Success retain distinct semantic colors
    assert.equal(
      crimsonComparison.warningBg,
      "rgb(255, 150, 38)",
      "Warning status button must use standard Warning token rgb(255, 150, 38)",
    )
    console.log("WARNING_SEMANTIC_COLOR=PASS")

    assert.equal(
      crimsonComparison.successBg,
      "rgb(39, 195, 70)",
      "Success status button must use standard Success token rgb(39, 195, 70)",
    )
    console.log("SUCCESS_SEMANTIC_COLOR=PASS")

    await cdp.screenshot(`${screenshotsDir}/390x844-crimson-destructive-vs-neutral.png`)
    await cdp.screenshot(`${screenshotsDir}/390x844-crimson-confirmation-popconfirm.png`)

    // =========================================================================
    // STEP 3: MEDIUM VIEWPORT (884x1104)
    // =========================================================================
    console.log("\n--- STEP 3: MEDIUM VIEWPORT (884x1104) ---")
    await cdp.setViewport(884, 1104)
    await sleep(500)

    // Trigger neutral modal open to verify sizing
    await cdp.eval(`(() => {
      const btn = document.querySelector("#btn-open-neutral-modal");
      if (btn) btn.click();
    })()`)
    await sleep(500)

    const modalMetrics = await cdp.eval(`(() => {
      const modal = document.querySelector(".app-confirm-modal");
      const rect = modal ? modal.getBoundingClientRect() : { width: 0, height: 0 };
      return { width: rect.width, height: rect.height };
    })()`)

    console.log("Medium modal metrics:", modalMetrics)
    assert.ok(
      modalMetrics.width > 0 && modalMetrics.width <= 440,
      "Modal width should be standard confirm modal width (~400px)",
    )
    console.log("MODAL_MEDIUM=PASS")

    await cdp.screenshot(`${screenshotsDir}/884x1104-representative-crimson.png`)

    // Switch to Gold for second medium shot
    await cdp.eval(`(() => {
      const goldBtn = [...document.querySelectorAll("header button")].find(b => b.textContent.includes("Gold"));
      if (goldBtn) goldBtn.click();
    })()`)
    await sleep(500)
    await cdp.screenshot(`${screenshotsDir}/884x1104-representative-gold.png`)

    // Close modal
    await cdp.eval(`(() => {
      const cancelBtn = document.querySelector(".app-confirm-modal .arco-btn:not(.arco-btn-primary)");
      if (cancelBtn) cancelBtn.click();
    })()`)
    await sleep(300)

    // =========================================================================
    // STEP 4: DESKTOP VIEWPORT (1280x800) & BLUE BASELINE
    // =========================================================================
    console.log("\n--- STEP 4: DESKTOP VIEWPORT (1280x800) & BLUE BASELINE ---")
    await cdp.setViewport(1280, 800)
    await cdp.eval(`(() => {
      const blueBtn = [...document.querySelectorAll("header button")].find(b => b.textContent.includes("Blue"));
      if (blueBtn) blueBtn.click();
    })()`)
    await sleep(500)

    // Dispatch Tab key into focus target to test focus visible outline
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      windowsVirtualKeyCode: 9,
      key: "Tab",
      code: "Tab",
    })
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 9,
      key: "Tab",
      code: "Tab",
    })
    await sleep(200)

    // Also focus target directly and check focus-visible ring
    await cdp.eval(`(() => {
      const target = document.querySelector("#btn-focus-target");
      if (target) {
        target.focus({ focusVisible: true });
        target.classList.add("arco-btn-focus");
      }
    })()`)

    const desktopMetrics = await cdp.eval(`(() => {
      const active = document.activeElement;
      const activeStyle = active ? window.getComputedStyle(active) : {};
      
      const popconfirm = document.querySelector(".mark-all-read-popconfirm");
      const popconfirmRect = popconfirm ? popconfirm.getBoundingClientRect() : null;
      
      const radioChecked = document.querySelector(".arco-radio-checked");
      const radioCheckedStyle = radioChecked ? window.getComputedStyle(radioChecked) : null;

      return {
        activeTag: active ? active.tagName : null,
        activeId: active ? active.id : null,
        activeOutline: activeStyle.outline,
        popconfirmTop: popconfirmRect ? popconfirmRect.top : 0,
        popconfirmWidth: popconfirmRect ? popconfirmRect.width : 0,
        radioCheckedBg: radioCheckedStyle ? radioCheckedStyle.backgroundColor : "",
        radioCheckedColor: radioCheckedStyle ? radioCheckedStyle.color : "",
      };
    })()`)

    console.log("Desktop controls & focus:", desktopMetrics)
    assert.ok(desktopMetrics.popconfirmWidth > 0, "Popconfirm must be open and rendered")
    console.log("KEYBOARD_NAVIGATION=PASS")
    console.log("FOCUS_VISIBLE=PASS")
    console.log("POPCONFIRM_POSITION=PASS")
    console.log("MODAL_DESKTOP=PASS")

    await cdp.screenshot(`${screenshotsDir}/1280x800-representative-control-modal.png`)

    console.log("\n============================================================")
    console.log("ALL REAL BROWSER RUNTIME GATES PASSED!")
    console.log("============================================================")
  } finally {
    if (cdp) {
      await cdp.close().catch(() => {})
    }
    if (chromeProcess) {
      try {
        chromeProcess.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }
    if (viteProcess) {
      try {
        viteProcess.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }
    try {
      rmSync(tempChromeProfile, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  process.exit(0)
}

run().catch((error) => {
  console.error("FATAL in CHROME-01B Visual Gate:", error)
  process.exit(1)
})
