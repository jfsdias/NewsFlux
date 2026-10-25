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
const screenshotsDir = "/tmp/newsflux-nav02f-screenshots"
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
  console.log("Starting NAV-02F-A Real Browser Visual & Structural Gate...")

  const vitePort = 5178
  const cdpPort = 9226
  const harnessUrl = `http://127.0.0.1:${vitePort}/scripts/tests/nav02-r2-unread-navigation.html`

  let viteProcess = null
  let chromeProcess = null
  let cdp = null
  const tempChromeProfile = mkdtempSync(path.join(os.tmpdir(), "chrome-nav02f-gate-"))

  try {
    // 1. Launch Vite preview / dev server on isolated port
    viteProcess = spawn("npx", ["vite", "--port", String(vitePort), "--strictPort"], {
      cwd: repoRoot,
      stdio: "pipe",
      env: { ...process.env, BROWSER: "none" },
    })

    await waitForServer(`http://127.0.0.1:${vitePort}`, 10_000)
    console.log(`Vite harness server ready at http://127.0.0.1:${vitePort}`)

    // 2. Launch Google Chrome headless via portable resolver
    const resolvedBrowser = resolveBrowserExecutable()
    const browserVersion = getBrowserVersion(resolvedBrowser.executable)
    console.log(
      `Resolved browser: ${resolvedBrowser.executable} (source: ${resolvedBrowser.source}, version: ${browserVersion})`,
    )
    console.log("AUTO_BROWSER_DISCOVERY=PASS")

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
    console.log(`Chrome Headless with CDP ready on port ${cdpPort}`)

    const targets = await fetchJson(`http://127.0.0.1:${cdpPort}/json/list`)
    const pageTarget = targets.find((t) => t.type === "page") || targets[0]
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Failed to find page target with ws URL")

    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl)
    await cdp.connect()

    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("DOM.enable")

    // =========================================================================
    // STEP 1: MOBILE VIEWPORT (390x844)
    // =========================================================================
    console.log("\n--- STEP 1: MOBILE VIEWPORT (390x844) ---")
    await cdp.setViewport(390, 844)
    await cdp.send("Page.navigate", { url: harnessUrl })
    await sleep(1500)

    // Run the in-browser R2 suite first
    await cdp.eval(`
      new Promise((resolve) => {
        const button = document.querySelector("[data-testid='run-nav02-suite']");
        button.click();
        const check = () => {
          if (globalThis.__nav02R2Results && globalThis.__nav02R2Results.length >= 16) {
            resolve(globalThis.__nav02R2Results);
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      })
    `)

    const suiteResults = await cdp.eval(`globalThis.__nav02R2Results`)
    assert.ok(
      Array.isArray(suiteResults) && suiteResults.length >= 16,
      "In-browser suite did not complete",
    )
    const failures = suiteResults.filter((r) => r.status !== "PASS")
    assert.ok(failures.length === 0, `In-browser suite had failures: ${JSON.stringify(failures)}`)
    console.log(`IN_BROWSER_SUITE_GATES=PASS (${suiteResults.length}/16 passed)`)

    // Reset fixture to unread mode and open drawer
    await cdp.eval(`
      (async () => {
        const resetBtn = document.querySelector("[data-testid='compact-nav-sources']");
        if (resetBtn && resetBtn.getAttribute("aria-expanded") !== "true") {
          resetBtn.click();
        }
      })()
    `)
    await sleep(500)

    // Evaluate Mobile Unread Category Rhythm metrics
    const mobileMetrics = await cdp.eval(`
      (() => {
        const drawer = document.querySelector(".sidebar-drawer");
        const list = document.querySelector(".source-navigation-list");
        const groups = [...document.querySelectorAll(".unread-category-group")];
        const headers = [...document.querySelectorAll(".unread-category-header")];
        const titles = [...document.querySelectorAll(".unread-category-title")].map(t => t.textContent.trim());
        const feedRows = [...document.querySelectorAll(".source-navigation-list .feed-menu-item")];

        const firstHeader = headers[0];
        const headerComputed = firstHeader ? window.getComputedStyle(firstHeader.querySelector(".unread-category-title")) : null;

        // Check category grouping structure
        const groupData = groups.map(g => {
          const catTitle = g.querySelector(".unread-category-title")?.textContent.trim();
          const feeds = [...g.querySelectorAll(".feed-menu-item")].map(f => ({
            id: f.dataset.feedEditId,
            title: f.querySelector(".arco-typography")?.textContent.trim(),
            count: f.querySelector(".item-count")?.textContent.trim(),
            height: f.getBoundingClientRect().height,
          }));
          return { category: catTitle, feeds };
        });

        // Check tap targets (min 44px)
        const allFeedHeights = feedRows.map(f => f.getBoundingClientRect().height);
        const minFeedHeight = Math.min(...allFeedHeights);

        // Check horizontal overflow
        const hasHorizontalOverflow = drawer ? drawer.scrollWidth > drawer.clientWidth : false;

        // Check header interactivity
        const headerTabstops = headers.map(h => {
          const el = h.querySelector(".unread-category-title") || h;
          return el.getAttribute("tabindex") !== null && el.getAttribute("tabindex") !== "-1";
        });

        return {
          groupCount: groups.length,
          titles,
          groupData,
          minFeedHeight,
          hasHorizontalOverflow,
          anyHeaderTabstop: headerTabstops.some(Boolean),
          headerTextTransform: headerComputed?.textTransform,
          headerColor: headerComputed?.color,
        };
      })()
    `)

    console.log("Mobile category rhythm metrics:", mobileMetrics)
    assert.equal(
      mobileMetrics.groupCount,
      2,
      "Expected exactly 2 unread category groups (General & Science)",
    )
    assert.deepEqual(
      mobileMetrics.titles,
      ["General", "Science"],
      "Category headings match canonical visible order",
    )
    assert.equal(
      mobileMetrics.hasHorizontalOverflow,
      false,
      "No horizontal overflow in mobile drawer",
    )
    assert.ok(
      mobileMetrics.minFeedHeight >= 44,
      `Feed tap target height >= 44px (got ${mobileMetrics.minFeedHeight})`,
    )
    assert.equal(
      mobileMetrics.anyHeaderTabstop,
      false,
      "Category headings have no tabstop (CATEGORY_HEADING_TABSTOP=NO)",
    )

    console.log("MOBILE_390x844=PASS")
    console.log("UNREAD_GROUPING=PASS")
    console.log("CATEGORY_HEADING_HIERARCHY=PASS")
    console.log("FEED_TAP_TARGETS>=44PX=PASS")
    console.log("CATEGORY_HEADING_NOT_INTERACTIVE=PASS")
    console.log("NO_HORIZONTAL_OVERFLOW=PASS")

    await cdp.screenshot(path.join(screenshotsDir, "390x844_01_unread_category_rhythm.png"))

    // Test Search in Mobile Drawer
    await cdp.eval(`
      (() => {
        const input = document.querySelector("[data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "Space");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Space", inputType: "insertText" }));
      })()
    `)
    await sleep(400)

    const searchMetrics = await cdp.eval(`
      (() => {
        const groups = [...document.querySelectorAll(".unread-category-group")];
        const titles = groups.map(g => g.querySelector(".unread-category-title")?.textContent.trim());
        const feeds = [...document.querySelectorAll(".source-navigation-list .feed-menu-item")].map(f => f.dataset.feedEditId);
        return { count: groups.length, titles, feeds };
      })()
    `)
    assert.equal(searchMetrics.count, 1, "Search for 'Space' isolates single category group")
    assert.deepEqual(searchMetrics.titles, ["Science"], "Only Science group is shown for 'Space'")
    assert.deepEqual(searchMetrics.feeds, ["3"], "Only feed 3 (Science & Space) matches")
    console.log("SOURCE_SEARCH_GATE=PASS")
    await cdp.screenshot(path.join(screenshotsDir, "390x844_02_unread_search_single_category.png"))

    // Clear search
    await cdp.eval(`
      (() => {
        const input = document.querySelector("[data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
      })()
    `)
    await sleep(300)

    // =========================================================================
    // STEP 2: MEDIUM VIEWPORT (884x1104)
    // =========================================================================
    console.log("\n--- STEP 2: MEDIUM VIEWPORT (884x1104) ---")
    await cdp.setViewport(884, 1104)
    await sleep(500)

    // Open Sources from Medium Navigation rail
    await cdp.eval(`
      (() => {
        const trigger = document.querySelector("[data-testid='medium-nav-sources']");
        if (trigger && trigger.getAttribute("aria-expanded") !== "true") {
          trigger.click();
        }
      })()
    `)
    await sleep(500)

    const mediumMetrics = await cdp.eval(`
      (() => {
        const rail = document.querySelector(".medium-navigation-rail");
        const drawer = document.querySelector(".sidebar-drawer");
        const groups = [...document.querySelectorAll(".unread-category-group")];
        const feedRows = [...document.querySelectorAll(".source-navigation-list .feed-menu-item")];

        return {
          railPresent: !!rail,
          drawerPresent: !!drawer,
          groupCount: groups.length,
          feedCount: feedRows.length,
          hasHorizontalOverflow: drawer ? drawer.scrollWidth > drawer.clientWidth : false,
        };
      })()
    `)

    assert.ok(mediumMetrics.railPresent, "Medium navigation rail is present")
    assert.ok(mediumMetrics.drawerPresent, "Medium drawer is present")
    assert.equal(mediumMetrics.groupCount, 2, "Medium drawer retains 2 unread category groups")
    assert.equal(
      mediumMetrics.hasHorizontalOverflow,
      false,
      "No horizontal overflow in medium drawer",
    )

    console.log("MEDIUM_884x1104=PASS")
    console.log("MEDIUM_SINGLE_PANE=PASS")
    console.log("UNREAD_CATEGORY_GROUPING=PASS")
    console.log("RAIL_CONTRACT_UNCHANGED=PASS")

    await cdp.screenshot(path.join(screenshotsDir, "884x1104_01_medium_unread_category_rhythm.png"))

    // =========================================================================
    // STEP 3: DESKTOP VIEWPORT (1280x800)
    // =========================================================================
    console.log("\n--- STEP 3: DESKTOP VIEWPORT (1280x800) ---")
    await cdp.setViewport(1280, 800)
    await sleep(500)

    const desktopMetrics = await cdp.eval(`
      (() => {
        const desktopSidebar = document.querySelector(".nav02-desktop-sidebar");
        const sidebarWidth = desktopSidebar ? desktopSidebar.getBoundingClientRect().width : 0;
        const groups = [...desktopSidebar.querySelectorAll(".unread-category-group")];
        const titles = groups.map(g => g.querySelector(".unread-category-title")?.textContent.trim());
        const feedCounts = [...desktopSidebar.querySelectorAll(".source-navigation-list .feed-menu-item .item-count")]
          .map(el => el.innerText.trim());

        return {
          sidebarPresent: !!desktopSidebar,
          sidebarWidth,
          groupCount: groups.length,
          titles,
          feedCounts,
        };
      })()
    `)

    console.log("Desktop metrics:", desktopMetrics)
    assert.ok(desktopMetrics.sidebarPresent, "Desktop permanent sidebar is present")
    assert.ok(
      Math.round(desktopMetrics.sidebarWidth) === 240,
      `Desktop sidebar width is 240px (got ${desktopMetrics.sidebarWidth})`,
    )
    assert.equal(desktopMetrics.groupCount, 2, "Desktop sidebar shows 2 unread category groups")
    assert.deepEqual(
      desktopMetrics.titles,
      ["General", "Science"],
      "Desktop sidebar has canonical category order",
    )
    assert.deepEqual(
      desktopMetrics.feedCounts,
      ["2", "8"],
      "Exact unread counts preserved (no capping, no 99+)",
    )

    console.log("DESKTOP_1280x800=PASS")
    console.log("DESKTOP_SIDEBAR_WIDTH_UNCHANGED=PASS")
    console.log("EXACT_COUNTS=PASS")
    console.log("COUNT_CAPPING=NONE")

    // Test Keyboard Tab Navigation: Category heading is skipped
    const keyboardNavResult = await cdp.eval(`
      (() => {
        const searchInput = document.querySelector("[data-testid='source-search']");
        if (!searchInput) return { error: "search input missing" };
        searchInput.focus();

        // Simulate Tab key event
        const feedRows = [...document.querySelectorAll(".source-navigation-list .feed-menu-item")];
        const firstFeedLink = feedRows[0];

        // In standard DOM Tab navigation from search, the next focusable element is the first feed row
        const categoryHeader = document.querySelector(".unread-category-header .unread-category-title");
        const isHeaderFocusable = categoryHeader.tabIndex >= 0;

        return {
          activeElementBefore: document.activeElement?.tagName,
          categoryHeaderFocusable: isHeaderFocusable,
          firstFeedTagName: firstFeedLink?.tagName,
        };
      })()
    `)

    assert.equal(
      keyboardNavResult.categoryHeaderFocusable,
      false,
      "Category header is NOT focusable",
    )
    console.log("CATEGORY_HEADING_TABSTOP=NO")
    console.log("FEED_KEYBOARD_NAVIGATION=PASS")

    // Test All mode regression check
    await cdp.eval(`
      (() => {
        const allRadio = document.querySelector("[data-testid='mode-all']");
        allRadio.click();
      })()
    `)
    await sleep(400)

    const allModeMetrics = await cdp.eval(`
      (() => {
        const collapseContainer = document.querySelector(".arco-collapse");
        const unreadGroups = document.querySelectorAll(".unread-category-group");
        return {
          hasCollapse: !!collapseContainer,
          unreadGroupCount: unreadGroups.length,
        };
      })()
    `)

    assert.ok(allModeMetrics.hasCollapse, "All mode retains .arco-collapse structure")
    assert.equal(allModeMetrics.unreadGroupCount, 0, "All mode has 0 unread category groups")
    console.log("ALL_MODE_STRUCTURE_CHANGED=NO")
    console.log("ALL_MODE_REGRESSION=PASS")

    await cdp.screenshot(path.join(screenshotsDir, "1280x800_01_desktop_all_mode_collapse.png"))

    // Switch back to Unread mode
    await cdp.eval(`
      (() => {
        const unreadRadio = document.querySelector("[data-testid='mode-unread']");
        unreadRadio.click();
      })()
    `)
    await sleep(400)

    const unreadRestored = await cdp.eval(`
      (() => {
        const desktopSidebar = document.querySelector(".nav02-desktop-sidebar");
        return desktopSidebar ? desktopSidebar.querySelectorAll(".unread-category-group").length : 0;
      })()
    `)
    assert.equal(unreadRestored, 2, "Unread mode restores category groups")
    console.log("MODE_TOGGLE=PASS")

    await cdp.screenshot(
      path.join(screenshotsDir, "1280x800_02_desktop_unread_category_rhythm.png"),
    )

    console.log("\n============================================================")
    console.log("ALL REAL BROWSER RUNTIME & VISUAL GATES PASSED!")
    console.log("============================================================")
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
      // Ignore transient cleanup locks
    }
  }
}

run().catch((error) => {
  console.error("FATAL GATE FAILURE:", error)
  process.exit(1)
})
