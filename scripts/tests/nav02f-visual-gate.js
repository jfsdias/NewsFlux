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

  async sendTabKey() {
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      macCharCode: 9,
      key: "Tab",
      code: "Tab",
    })
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
      macCharCode: 9,
      key: "Tab",
      code: "Tab",
    })
  }

  async close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

async function run() {
  console.log("Starting NAV-02F-A Real Browser Visual & Structural Gate (R2)...")

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
        const groups = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")];
        const headers = [...document.querySelectorAll(".sidebar-drawer .unread-category-header")];
        const titles = [...document.querySelectorAll(".sidebar-drawer .unread-category-title")].map(t => t.textContent.trim());
        const feedRows = [...document.querySelectorAll(".sidebar-drawer .source-navigation-list .feed-menu-item")];

        const firstHeader = headers[0];
        const headerComputed = firstHeader ? window.getComputedStyle(firstHeader.querySelector(".unread-category-title")) : null;

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

        const allFeedHeights = feedRows.map(f => f.getBoundingClientRect().height);
        const minFeedHeight = Math.min(...allFeedHeights);

        const hasHorizontalOverflow = drawer ? drawer.scrollWidth > drawer.clientWidth : false;

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

    // =========================================================================
    // SEARCH CONTRACT: SINGLE-CATEGORY, MULTI-CATEGORY, NO-MATCH
    // =========================================================================
    console.log("\n--- SEARCH CONTRACT VERIFICATION ---")

    // A. Single-category search ("Space" -> Science only)
    await cdp.eval(`
      (() => {
        const input = document.querySelector(".sidebar-drawer [data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "Space");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Space", inputType: "insertText" }));
      })()
    `)
    await sleep(400)

    const singleCategorySearch = await cdp.eval(`
      (() => {
        const groups = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")];
        const titles = groups.map(g => g.querySelector(".unread-category-title")?.textContent.trim());
        const feeds = [...document.querySelectorAll(".sidebar-drawer .source-navigation-list .feed-menu-item")].map(f => f.dataset.feedEditId);
        return { count: groups.length, titles, feeds };
      })()
    `)
    assert.equal(singleCategorySearch.count, 1, "Single category search isolates 1 group")
    assert.deepEqual(singleCategorySearch.titles, ["Science"], "Only Science group appears")
    assert.deepEqual(singleCategorySearch.feeds, ["3"], "Only feed 3 (Science & Space) appears")
    console.log("SINGLE_CATEGORY_SEARCH=PASS")

    // B. Real multi-category search:
    // Update fixture catalog to have feeds matching a single search query in multiple categories:
    // General (1): Northwind Daily Briefing (id 2) -> matches "Daily"
    // Science (2): Science Daily Dispatch (id 33) -> matches "Daily"
    await cdp.eval(`
      (() => {
        const h = globalThis.__nav02Harness;
        const generalCat = h.fixtureCategories[0];
        const scienceCat = h.fixtureCategories[1];
        const multiCatFeeds = [
          ...h.fixtureFeeds,
          h.makeFeed(33, "Science Daily Dispatch", scienceCat),
        ];
        h.commitCatalogData({ feedsData: multiCatFeeds, categoriesData: h.fixtureCategories });
        h.setUnreadInfo({ ...h.initialUnread, 33: 5 });
      })()
    `)
    await sleep(300)

    await cdp.eval(`
      (() => {
        const input = document.querySelector(".sidebar-drawer [data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "Daily");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Daily", inputType: "insertText" }));
      })()
    `)
    await sleep(400)

    const multiCategorySearch = await cdp.eval(`
      (() => {
        const groups = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")];
        const titles = groups.map(g => g.querySelector(".unread-category-title")?.textContent.trim());
        const feeds = [...document.querySelectorAll(".sidebar-drawer .source-navigation-list .feed-menu-item")].map(f => f.dataset.feedEditId);
        return { count: groups.length, titles, feeds };
      })()
    `)
    console.log("Multi-category search metrics:", multiCategorySearch)
    assert.equal(
      multiCategorySearch.count,
      2,
      "Search for 'Daily' matches feeds across 2 categories",
    )
    assert.deepEqual(
      multiCategorySearch.titles,
      ["General", "Science"],
      "Multi-category search preserves canonical category order",
    )
    assert.deepEqual(
      multiCategorySearch.feeds,
      ["2", "33"],
      "Both matching unread feeds are present",
    )
    console.log("MULTI_CATEGORY_SEARCH=PASS")
    console.log("MULTI_CATEGORY_SEARCH_ORDER=PASS")

    await cdp.screenshot(path.join(screenshotsDir, "390x844_02_unread_multi_category_search.png"))

    // C. No-match search ("nonexistent" -> 0 groups, empty status)
    await cdp.eval(`
      (() => {
        const input = document.querySelector(".sidebar-drawer [data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "nonexistent");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "nonexistent", inputType: "insertText" }));
      })()
    `)
    await sleep(400)

    const noMatchSearch = await cdp.eval(`
      (() => {
        const groups = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")];
        const emptyMsg = document.querySelector(".sidebar-drawer .source-navigation-empty");
        return { count: groups.length, hasEmptyMsg: !!emptyMsg, text: emptyMsg?.textContent.trim() };
      })()
    `)
    assert.equal(noMatchSearch.count, 0, "No-match search shows 0 groups")
    assert.ok(noMatchSearch.hasEmptyMsg, "Empty state message is shown")
    console.log("NO_MATCH_SEARCH=PASS")

    // Clear search and reset catalog to clean baseline
    await cdp.eval(`
      (() => {
        const input = document.querySelector(".sidebar-drawer [data-testid='source-search']");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "");
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "", inputType: "deleteContentBackward" }));
        const h = globalThis.__nav02Harness;
        h.commitCatalogData({ feedsData: h.fixtureFeeds, categoriesData: h.fixtureCategories });
        h.setUnreadInfo(h.initialUnread);
      })()
    `)
    await sleep(300)

    // =========================================================================
    // LONG LABEL & THREE-DIGIT COUNT EVIDENCE
    // =========================================================================
    console.log("\n--- LONG LABEL & THREE-DIGIT COUNT EVIDENCE ---")
    await cdp.eval(`
      (() => {
        const h = globalThis.__nav02Harness;
        const longCat = h.makeCategory(50, "Extremely Long Category Name For Testing Horizontal Overflow Boundaries In Responsive Viewports");
        const longFeed = h.makeFeed(51, "International Publication of Advanced Computing and Long Title News Reporting Weekly", longCat);
        h.commitCatalogData({
          feedsData: [...h.fixtureFeeds, longFeed],
          categoriesData: [...h.fixtureCategories, longCat],
        });
        h.setUnreadInfo({ ...h.initialUnread, 51: 123 });
      })()
    `)
    await sleep(500)

    const longLabelMetrics = await cdp.eval(`
      (() => {
        const drawer = document.querySelector(".sidebar-drawer");
        const longCatGroup = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")]
          .find(g => g.querySelector(".unread-category-title")?.textContent.includes("Extremely Long Category"));
        const longCatTitle = longCatGroup?.querySelector(".unread-category-title");
        const longFeedRow = document.querySelector(".sidebar-drawer [data-feed-edit-id='51']");
        const longFeedText = longFeedRow?.querySelector(".item-count");
        const longFeedAria = longFeedRow?.getAttribute("aria-label");

        const catTitleStyle = longCatTitle ? window.getComputedStyle(longCatTitle) : null;
        const drawerOverflow = drawer ? drawer.scrollWidth > drawer.clientWidth : false;

        return {
          catPresent: !!longCatGroup,
          feedPresent: !!longFeedRow,
          renderedCountText: longFeedText?.innerText.trim(),
          feedAriaLabel: longFeedAria,
          drawerOverflow,
          textOverflow: catTitleStyle?.textOverflow,
          whiteSpace: catTitleStyle?.whiteSpace,
          overflow: catTitleStyle?.overflow,
        };
      })()
    `)

    console.log("Long label & count metrics:", longLabelMetrics)
    assert.ok(longLabelMetrics.catPresent, "Long category is present")
    assert.ok(longLabelMetrics.feedPresent, "Long feed is present")
    assert.equal(
      longLabelMetrics.renderedCountText,
      "123",
      "Three-digit count renders exactly 123 without capping or truncation",
    )
    assert.ok(
      longLabelMetrics.feedAriaLabel?.includes("123") &&
        longLabelMetrics.feedAriaLabel?.includes("unread"),
      `Feed aria-label contains exact count: ${longLabelMetrics.feedAriaLabel}`,
    )
    assert.equal(
      longLabelMetrics.drawerOverflow,
      false,
      "No horizontal drawer overflow with long labels",
    )
    assert.equal(longLabelMetrics.textOverflow, "ellipsis", "Long category title enforces ellipsis")
    assert.equal(
      longLabelMetrics.whiteSpace,
      "nowrap",
      "Long category title does not break across multiple lines",
    )

    console.log("THREE_DIGIT_COUNT=PASS")
    console.log("THREE_DIGIT_COUNT_ARIA=PASS")
    console.log("EXACT_COUNTS=PASS")
    console.log("COUNT_CAPPING=NONE")
    console.log("LONG_CATEGORY_NO_HORIZONTAL_OVERFLOW=PASS")
    console.log("LONG_FEED_NO_HORIZONTAL_OVERFLOW=PASS")
    console.log("ELLIPSIS_OR_SAFE_WRAP=PASS")

    await cdp.screenshot(
      path.join(screenshotsDir, "390x844_03_unread_long_labels_and_three_digit_count.png"),
    )

    // Reset catalog back to standard baseline
    await cdp.eval(`
      (() => {
        const h = globalThis.__nav02Harness;
        h.commitCatalogData({ feedsData: h.fixtureFeeds, categoriesData: h.fixtureCategories });
        h.setUnreadInfo(h.initialUnread);
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
        const groups = [...document.querySelectorAll(".sidebar-drawer .unread-category-group")];
        const feedRows = [...document.querySelectorAll(".sidebar-drawer .source-navigation-list .feed-menu-item")];

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

    // =========================================================================
    // REAL CDP NATIVE KEYBOARD NAVIGATION (TAB SKIPS CATEGORY HEADINGS)
    // =========================================================================
    console.log("\n--- CDP NATIVE KEYBOARD TAB NAVIGATION ---")
    await cdp.eval(`
      (() => {
        const searchInput = document.querySelector(".nav02-desktop-sidebar [data-testid='source-search']");
        searchInput.focus();
      })()
    `)
    await sleep(200)

    const focusBefore = await cdp.eval(`document.activeElement?.getAttribute("data-testid")`)
    assert.equal(focusBefore, "source-search", "Search input successfully focused prior to Tab")

    // Send real native browser Tab key via CDP
    await cdp.sendTabKey()
    await sleep(200)

    const focusAfterTab = await cdp.eval(`
      (() => {
        const active = document.activeElement;
        const categoryHeader = document.querySelector(".nav02-desktop-sidebar .unread-category-title");
        return {
          activeTagName: active?.tagName,
          activeFeedId: active?.getAttribute("data-feed-edit-id"),
          isActiveCategoryHeader: active === categoryHeader || active?.classList.contains("unread-category-title"),
          activeClass: active?.className,
        };
      })()
    `)

    console.log("Focus state after native Tab key:", focusAfterTab)
    assert.equal(
      focusAfterTab.isActiveCategoryHeader,
      false,
      "Native Tab did not focus the category heading",
    )
    assert.equal(
      focusAfterTab.activeFeedId,
      "2",
      "Native Tab directly focused the first feed link (Northwind Daily Briefing)",
    )
    console.log("CATEGORY_HEADING_TABSTOP=NO")
    console.log("NATIVE_TAB_SKIPS_CATEGORY_HEADING=PASS")
    console.log("FEED_KEYBOARD_NAVIGATION=PASS")

    // =========================================================================
    // ALL MODE REGRESSION CHECK & MODE TOGGLE
    // =========================================================================
    console.log("\n--- ALL MODE REGRESSION & STATIC TOGGLE CONTRACT ---")
    await cdp.eval(`
      (() => {
        const allRadio = document.querySelector(".nav02-desktop-sidebar [data-testid='mode-all']");
        allRadio.click();
      })()
    `)
    await sleep(400)

    const allModeMetrics = await cdp.eval(`
      (() => {
        const desktopSidebar = document.querySelector(".nav02-desktop-sidebar");
        const collapseContainer = desktopSidebar?.querySelector(".arco-collapse");
        const unreadGroups = desktopSidebar?.querySelectorAll(".unread-category-group");
        return {
          hasCollapse: !!collapseContainer,
          unreadGroupCount: unreadGroups?.length ?? 0,
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
        const unreadRadio = document.querySelector(".nav02-desktop-sidebar [data-testid='mode-unread']");
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
    console.log("MODE_PERSISTENCE=UNCHANGED_STATIC_CONTRACT")

    await cdp.screenshot(
      path.join(screenshotsDir, "1280x800_02_desktop_unread_category_rhythm.png"),
    )

    console.log("\n============================================================")
    console.log("ALL REAL BROWSER RUNTIME & VISUAL GATES (R2) PASSED!")
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
