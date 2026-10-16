/* eslint-disable react-refresh/only-export-components -- This browser harness keeps fixtures and probes together. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button } from "@arco-design/web-react"
import Polyglot from "node-polyglot"
import React from "react"
import { createRoot } from "react-dom/client"
import { createMemoryRouter, RouterProvider, useLocation } from "react-router"

import apiClient from "@/apis/ofetch"
import SidebarTrigger from "@/components/Article/SidebarTrigger"
import Sidebar from "@/components/Sidebar/Sidebar"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { contentState, resetContent } from "@/store/contentState"
import {
  commitCatalogData,
  commitIdentityData,
  dataState,
  resetData,
  setUnreadInfo,
} from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { expandedCategoriesState, setExpandedCategories } from "@/store/sidebarState"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/App.css"
import "@/theme.css"
import "@/components/Article/SidebarTrigger.css"
import "./nav02-r2-unread-navigation.css"

const makeCategory = (id, title, hide = false) => ({ id, title, hide_globally: hide })
const makeFeed = (id, title, category, hidden = false) => ({
  id,
  title,
  icon: { icon_id: 0 },
  site_url: `https://example.invalid/${id}`,
  feed_url: `https://example.invalid/${id}/feed`,
  category,
  hide_globally: hidden,
  disabled: false,
  crawler: false,
})
const general = makeCategory(1, "General")
const science = makeCategory(2, "Science")
const hiddenCategory = makeCategory(3, "Hidden category", true)
const fixtureFeeds = [
  makeFeed(2, "Northwind Daily Briefing", general),
  makeFeed(3, "Science & Space", science),
  makeFeed(4, "Northwind Local News", general),
  makeFeed(5, "Hidden feed", general, true),
  makeFeed(6, "Hidden category feed", hiddenCategory),
]
const fixtureCategories = [general, science, hiddenCategory, makeCategory(4, "Empty")]
const initialUnread = { 2: 2, 3: 8, 4: 0, 5: 7, 6: 6 }
const readRequests = []
const readBodies = []
const unreadPageUrls = []
let refreshCountCalls = 0
let unreadPageFetches = 0
let router

apiClient.put = async (url, body) => {
  readRequests.push(url)
  readBodies.push(body)
  return {}
}
apiClient.get = async (url) => {
  assert(url.startsWith("/v1/feeds/2/entries"), `Unexpected fixture GET: ${url}`)
  unreadPageUrls.push(url)
  unreadPageFetches += 1
  return { entries: unreadPageFetches === 1 ? [{ id: 21 }, { id: 22 }] : [] }
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
feedIconsState.setKey(0, { height: 16, width: 16, url: "/default-feed-icon.png" })
const appData = {
  refreshFeedData: async () => {},
  refreshCounts: async () => {
    refreshCountCalls += 1
    setUnreadInfo((previous) => ({ ...previous, 2: 0 }))
    return { error: null }
  },
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 90))
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return
    }
    await settle()
  }
  throw new Error(message)
}
const sidebarRoot = () =>
  document.querySelector(".sidebar-drawer .sidebar-container") ??
  document.querySelector(".nav02-desktop-sidebar .sidebar-container")
const sourceSearch = () => sidebarRoot()?.querySelector("[data-testid='source-search']")
const feedRows = (selector = ".source-navigation-list .feed-menu-item") => [
  ...(sidebarRoot()?.querySelectorAll(selector) ?? []),
]
const feedIds = (selector) => feedRows(selector).map((row) => row.dataset.feedEditId)
const setQuery = async (value) => {
  const input = sourceSearch()
  assert(input, "Source search input is missing")
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
  setter.call(input, value)
  input.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }),
  )
  await settle()
}
// eslint-disable-next-line unicorn/prefer-dom-node-text-content -- innerText verifies the count as rendered to the user.
const visibleFeedCountText = (row) => row?.innerText.trim().split("\n").at(-1)
const activeFeedRow = (feedId) =>
  sidebarRoot()?.querySelector(`[data-feed-edit-id='${CSS.escape(feedId)}']`)
const activeRoute = () => router.state.location.pathname
const ensureDrawerOpen = async () => {
  if (innerWidth > 992) {
    return
  }
  const trigger = document.querySelector(".trigger")
  if (trigger?.getAttribute("aria-expanded") !== "true") {
    trigger?.click()
  }
  await waitFor(
    () => document.querySelector(".sidebar-drawer .sidebar-container"),
    "Drawer did not open",
  )
}

const resetFixture = async (path = "/", options = {}) => {
  resetData()
  resetContent()
  authState.set({ server: "https://example.invalid", token: "fixture", username: "fixture" })
  settingsState.set({
    ...getDefaultSettings(),
    showFeedIcon: false,
    showHiddenFeeds: false,
    showUnreadFeedsOnly: options.unreadMode ?? false,
    themeMode: document.body.getAttribute("arco-theme") === "dark" ? "dark" : "light",
  })
  setExpandedCategories(options.expanded ?? [])
  commitIdentityData({ id: 1, username: "fixture" })
  commitCatalogData({ feedsData: fixtureFeeds, categoriesData: fixtureCategories })
  setUnreadInfo(options.counts ?? initialUnread)
  readRequests.length = 0
  refreshCountCalls = 0
  await router.navigate(path)
  await settle()
  await ensureDrawerOpen()
  const clear = sidebarRoot()?.querySelector("[data-testid='clear-source-search']")
  if (clear) {
    clear.click()
    await waitFor(() => sourceSearch()?.value === "", "Fixture reset could not clear source search")
  }
}

const setMode = async (mode) => {
  const input = sidebarRoot()?.querySelector(
    `[data-testid='mode-${CSS.escape(mode.toLowerCase())}']`,
  )
  assert(input, "Mode selector is missing")
  input.click()
  await settle()
}

const RouteProbe = () => {
  const location = useLocation()
  return <output data-testid="current-route">{location.pathname}</output>
}

const captureMetrics = () => {
  const root = sidebarRoot()
  const isOverlay = innerWidth <= 992
  const sidebar = isOverlay
    ? (document.querySelector(".sidebar-drawer .arco-drawer-content") ??
      document.querySelector(".sidebar-drawer"))
    : document.querySelector(".nav02-desktop-sidebar")
  const scrollArea = root?.querySelector(".simplebar-content-wrapper, .adaptive-scroll-area-native")
  const controls = root?.querySelector(".source-navigation-controls")
  const sidebarBounds = sidebar?.getBoundingClientRect()
  const controlsBounds = controls?.getBoundingClientRect()
  const visibleRows = [...(root?.querySelectorAll(".feed-menu-item") ?? [])]
  const rowBoundsStayInsideSidebar = visibleRows.every((row) => {
    const bounds = row.getBoundingClientRect()
    return bounds.left >= sidebarBounds.left - 1 && bounds.right <= sidebarBounds.right + 1
  })

  return {
    viewport: { width: innerWidth, height: innerHeight },
    theme: document.body.getAttribute("arco-theme") ?? "light",
    documentWidth: document.documentElement.scrollWidth,
    sidebarWidth: sidebarBounds?.width ?? 0,
    sidebarLeft: sidebarBounds?.left ?? 0,
    scrollWidth: scrollArea?.scrollWidth ?? 0,
    scrollClientWidth: scrollArea?.clientWidth ?? 0,
    modeControlHeight: controlsBounds?.height ?? 0,
    modeFilterSticky: controls ? getComputedStyle(controls).position === "sticky" : false,
    controlsVisible: Boolean(
      controlsBounds && controlsBounds.width > 0 && controlsBounds.height > 0,
    ),
    rowsInsideSidebar: rowBoundsStayInsideSidebar,
    targetHeights: [
      ...(controls?.querySelectorAll(
        ".source-mode-option, .source-filter-input, .source-filter-clear",
      ) ?? []),
    ].map((node) => Math.round(node.getBoundingClientRect().height)),
  }
}

const scenarios = [
  [
    "MODE_SELECTOR_RADIOGROUP_AND_SINGLE_TAB_STOP",
    async () => {
      await resetFixture()
      const group = sidebarRoot()?.querySelector("[role='radiogroup']")
      const radios = [...(group?.querySelectorAll("input[type='radio']") ?? [])]
      assert(group && radios.length === 2, "Mode selector is not a two-option radiogroup")
      assert(
        radios.filter((radio) => radio.tabIndex === 0).length === 1,
        "Mode selector has multiple Tab stops",
      )
    },
  ],
  [
    "MODE_SELECTOR_ARROW_KEYS",
    async () => {
      await resetFixture()
      const all = sidebarRoot()?.querySelector("[data-testid='mode-all']")
      all.focus()
      all.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      )
      await settle()
      assert(settingsState.get().showUnreadFeedsOnly, "Arrow key did not select Unread")
    },
  ],
  [
    "UNREAD_FLAT_LIST_STABLE_ORDER_COUNTS_AND_SELECTION",
    async () => {
      await resetFixture("/feed/2", { unreadMode: true })
      assert(feedIds().join(",") === "2,3", "Unread list is not flat in catalog order")
      assert(
        !sidebarRoot()?.querySelector(".arco-collapse"),
        "Unread mode rendered category nesting",
      )
      assert(!activeFeedRow(4), "Zero-unread feed appeared in Unread")
      assert(
        activeFeedRow(2)?.classList.contains("arco-menu-selected"),
        "Current feed lost selected semantics",
      )
      assert(visibleFeedCountText(activeFeedRow(2)) === "2", "Unread count was not preserved")
    },
  ],
  [
    "ALL_MODE_CANONICAL_HIERARCHY_AND_EMPTY_QUERY",
    async () => {
      await resetFixture("/", { expanded: ["/category/1"] })
      assert(sidebarRoot()?.querySelector(".arco-collapse"), "All mode lost the category hierarchy")
      assert(
        feedIds(".arco-collapse-item-content .feed-menu-item").includes("4"),
        "Read feed disappeared from canonical hierarchy",
      )
      assert(
        expandedCategoriesState.get().includes("/category/1"),
        "Empty-query expansion state changed",
      )
    },
  ],
  [
    "UNREAD_FILTER_AND_MODE_QUERY_LIFETIME",
    async () => {
      await resetFixture("/", { unreadMode: true })
      await setQuery("NORTHWIND")
      assert(feedIds().join(",") === "2", "Unread source filter is not case-insensitive")
      await setMode("all")
      assert(sourceSearch()?.value === "NORTHWIND", "Query reset while switching modes")
    },
  ],
  [
    "ALL_FILTER_REVEALS_COLLAPSED_MATCH_AND_RESTORES_EXPANSION",
    async () => {
      await resetFixture("/", { expanded: ["/category/2"] })
      await setQuery("northwind daily")
      assert(
        feedIds(".arco-collapse-item-content .feed-menu-item").join(",") === "2",
        "Collapsed category match was not revealed",
      )
      assert(
        expandedCategoriesState.get().join(",") === "/category/2",
        "Search changed saved category expansion",
      )
      await setQuery("")
      assert(
        expandedCategoriesState.get().join(",") === "/category/2",
        "Clearing search did not restore saved expansion",
      )
    },
  ],
  [
    "SEARCH_CLEAR_AND_ESCAPE_STOP_PROPAGATION",
    async () => {
      await resetFixture()
      await setQuery("space")
      const clear = sidebarRoot()?.querySelector("[data-testid='clear-source-search']")
      assert(clear && clear.getAttribute("aria-label"), "Clear action has no accessible name")
      clear.click()
      await waitFor(() => sourceSearch()?.value === "", "Clear action did not empty source query")
      await setQuery("space")
      let escaped = false
      const observer = () => {
        escaped = true
      }
      document.addEventListener("keydown", observer, { once: true })
      sourceSearch().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      )
      await settle()
      document.removeEventListener("keydown", observer)
      assert(sourceSearch()?.value === "", "Escape did not clear source query")
      assert(!escaped, "Escape propagated beyond the focused source search")
    },
  ],
  [
    "CURRENT_ZERO_UNREAD_CONTEXT_FILTER_INDEPENDENT_NO_NAVIGATION",
    async () => {
      await resetFixture("/feed/2", { unreadMode: true })
      assert(
        !activeFeedRow(2)?.closest(".current-source-section"),
        "An active source already at zero was incorrectly retained on initial route entry",
      )
      setUnreadInfo((previous) => ({ ...previous, 2: 0 }))
      await waitFor(
        () => activeFeedRow(2)?.closest(".current-source-section"),
        "Active feed did not enter Current source after its unread count reached zero",
      )
      assert(
        visibleFeedCountText(activeFeedRow(2)) === "0",
        "Current source does not show zero unread",
      )
      assert(!feedIds().includes("2"), "Current feed was counted in the unread list")
      await setQuery("no matching source")
      assert(activeFeedRow(2), "Current source disappeared under a nonmatching filter")
      assert(activeRoute() === "/feed/2", "Zero-unread reconciliation navigated away")
      await router.navigate("/feed/3")
      await waitFor(
        () => !activeFeedRow(2)?.closest(".current-source-section"),
        "Current source context remained after route change",
      )
      await router.navigate("/feed/2")
      assert(
        !activeFeedRow(2)?.closest(".current-source-section"),
        "A previously read feed was retained as Current source after re-entering its route",
      )
      setUnreadInfo((previous) => ({ ...previous, 2: 1 }))
      await waitFor(
        () => !activeFeedRow(2)?.closest(".current-source-section"),
        "Source was not removed from Current source after its unread count increased",
      )
      await setQuery("")
      await waitFor(
        () => feedIds().includes("2"),
        "Source did not return to the unread list after clearing the filter",
      )
    },
  ],
  [
    "HIDDEN_FEED_VISIBILITY_RULES_AND_COUNT_REACTIVITY",
    async () => {
      await resetFixture("/", { unreadMode: true })
      assert(
        !feedIds().includes("5") && !feedIds().includes("6"),
        "Hidden feeds appeared while hidden items are off",
      )
      settingsState.set({ ...settingsState.get(), showHiddenFeeds: true })
      await waitFor(
        () => feedIds().includes("5") && feedIds().includes("6"),
        "Existing hidden-feed setting did not apply",
      )
      setUnreadInfo((previous) => ({ ...previous, 2: 5 }))
      await waitFor(
        () => visibleFeedCountText(activeFeedRow(2)) === "5",
        "Unread count did not react to reconciliation",
      )
    },
  ],
  [
    "MARK_ALL_READ_AND_JUMP_BEHAVIOR_PRESERVED",
    async () => {
      await resetFixture("/feed/2", { unreadMode: true })
      settingsState.set({ ...settingsState.get(), skipMarkAllReadConfirmation: true })
      unreadPageFetches = 0
      readRequests.length = 0
      readBodies.length = 0
      unreadPageUrls.length = 0
      const contentBefore = contentState.get()
      const row = activeFeedRow(2)
      assert(row, "Current unread feed is missing before mark-all-read")
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
      await waitFor(
        () => document.querySelector(".mobile-action-menu"),
        "Feed action menu did not open",
      )
      const markAll = [...document.querySelectorAll(".mobile-action-menu [role='menuitem']")].find(
        (item) => item.textContent.includes("Mark All as Read"),
      )
      assert(markAll, "Existing mark-all-read action disappeared")
      markAll.click()
      await waitFor(
        () => readRequests.length === 1 && refreshCountCalls === 1,
        "Existing mark-all-read mutation or count refresh changed",
      )
      await waitFor(
        () => activeFeedRow(2)?.closest(".current-source-section"),
        "Current feed did not remain in context after count reconciliation",
      )
      assert(activeRoute() === "/feed/2", "Mark-all-read navigated to another source")
      assert(
        contentState.get().activeContent === contentBefore.activeContent &&
          contentState.get().entries === contentBefore.entries,
        "Mark-all-read reconciliation changed active article content",
      )
      assert(readRequests[0] === "/v1/entries", "Mark-all-read batch route changed")
      const [body] = readBodies
      assert(
        body?.status === "read" && [...(body.entry_ids ?? [])].toSorted().join(",") === "21,22",
        `Mark-all-read batch payload changed: ${JSON.stringify(body)}`,
      )
      assert(
        unreadPageUrls.length >= 2 &&
          unreadPageUrls.every((url) => url.includes("status=unread") && !/offset=[1-9]/.test(url)),
        `Mark-all-read did not page unread entries from offset zero until empty: ${unreadPageUrls.join(" | ")}`,
      )
      assert(
        dataState.get().unreadInfo[2] === 0 && dataState.get().unreadInfo[3] === 8,
        "Mark-all-read count refresh did not zero only the scoped feed",
      )
    },
  ],
  [
    "EMPTY_UNREAD_STATE_AND_MORE_MENU_NO_DUPLICATE_TOGGLE",
    async () => {
      await resetFixture("/", { unreadMode: true, counts: { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } })
      assert(
        sidebarRoot()?.textContent.includes("No unread sources"),
        "Compact empty unread message missing",
      )
      await setQuery("northwind")
      assert(
        sidebarRoot()?.textContent.includes("No unread sources"),
        "Empty unread state was replaced by a search-results message",
      )
      await setQuery("")
      sidebarRoot()?.querySelector("[aria-label='More feed options']")?.click()
      await settle()
      const menu = document.querySelector(".mobile-action-menu")
      assert(
        menu &&
          !menu.textContent.includes("Hide read feeds") &&
          !menu.textContent.includes("Show read feeds"),
        "Duplicate mode toggle remains in More",
      )
    },
  ],
  [
    "SEARCH_IS_EPHEMERAL_AND_SETTINGS_MODE_IS_REUSED",
    async () => {
      await resetFixture("/", { unreadMode: true })
      await setQuery("northwind")
      const settingKeys = Object.keys(settingsState.get()).toSorted().join(",")
      assert(
        settingsState.get().showUnreadFeedsOnly,
        "Existing showUnreadFeedsOnly setting was not reused",
      )
      assert(
        !Object.keys(localStorage).some((key) => key.toLowerCase().includes("sourcequery")),
        "A source-query persistence key was added",
      )
      assert(
        settingKeys === Object.keys(getDefaultSettings()).toSorted().join(","),
        "A persistent setting was added for navigation",
      )
    },
  ],
  [
    "TOUCH_TARGETS_AND_RESPONSIVE_LAYOUT",
    async () => {
      await resetFixture()
      const metrics = captureMetrics()
      assert(
        metrics.targetHeights.length > 0 && metrics.targetHeights.every((height) => height >= 44),
        "Mode/search touch target is below 44px",
      )
      assert(metrics.modeFilterSticky, "Mode and source filter controls are not sticky")
      assert(metrics.rowsInsideSidebar, "A source row is clipped by the Sidebar width")
      if (innerWidth <= 992) {
        assert(
          metrics.sidebarWidth <= 360 && metrics.sidebarWidth > 0,
          "Drawer width exceeds 360px cap",
        )
        if (innerWidth === 390) {
          assert(
            Math.abs(metrics.sidebarWidth - 312) <= 1,
            `390px drawer measured ${metrics.sidebarWidth}px instead of about 312px`,
          )
        }
        if (innerWidth === 768 || innerWidth === 884) {
          assert(
            metrics.sidebarWidth === 360,
            `${innerWidth}px drawer measured ${metrics.sidebarWidth}px instead of 360px`,
          )
        }
      } else {
        assert(metrics.sidebarWidth === 240, "Permanent desktop sidebar width changed")
        assert(metrics.sidebarLeft === 0, "Permanent desktop sidebar is not at the leading edge")
      }
      assert(metrics.documentWidth <= innerWidth, "Sidebar introduces horizontal overflow")
      assert(
        metrics.scrollWidth <= metrics.scrollClientWidth + 1,
        "Sidebar content has horizontal overflow",
      )
    },
  ],
  [
    "SYNTHETIC_CATALOG_SCALE",
    async () => {
      for (const count of [5, 20, 40, 100]) {
        await setQuery("")
        const categories = Array.from({ length: Math.max(2, Math.ceil(count / 5)) }, (_, index) =>
          makeCategory(100 + index, `Topic ${index + 1}`),
        )
        const feeds = Array.from({ length: count }, (_, index) =>
          makeFeed(
            1000 + index,
            `International Affairs Network Source ${String(index + 1).padStart(3, "0")}`,
            categories[index % categories.length],
          ),
        )
        commitCatalogData({ feedsData: feeds, categoriesData: categories })
        settingsState.set({ ...settingsState.get(), showUnreadFeedsOnly: true })
        setUnreadInfo(Object.fromEntries(feeds.map((feed) => [feed.id, 1])))
        await settle()
        assert(
          feedRows().length === count,
          `${count}-feed all-unread view rendered ${feedRows().length} rows instead of ${count}`,
        )

        const mixedCounts = Object.fromEntries(
          feeds.map((feed, index) => [feed.id, index % 2 === 0 ? 1 : 0]),
        )
        const currentZeroFeed = feeds[1]
        await router.navigate(`/feed/${currentZeroFeed.id}`)
        await settle()
        assert(
          !activeFeedRow(currentZeroFeed.id)?.closest(".current-source-section"),
          `${count}-feed catalog retained a zero source before it transitioned to zero`,
        )
        setUnreadInfo(mixedCounts)
        await settle()
        await waitFor(
          () => activeFeedRow(currentZeroFeed.id)?.closest(".current-source-section"),
          `${count}-feed catalog did not retain the active source after it reached zero`,
        )
        const expectedUnreadCount = Math.ceil(count / 2)
        assert(
          feedRows().length === expectedUnreadCount,
          `${count}-feed mixed view rendered ${feedRows().length} unread rows instead of ${expectedUnreadCount}`,
        )

        await setQuery("source 099")
        if (count === 100) {
          assert(
            feedRows().length === 1,
            "100-feed shared-prefix filter did not isolate the matching source",
          )
        } else {
          assert(feedRows().length === 0, `${count}-feed filter returned an absent source`)
        }
      }
    },
  ],
  [
    "MOBILE_FEED_SELECTION_CLOSES_DRAWER",
    async () => {
      await resetFixture("/", { unreadMode: true })
      if (innerWidth > 992) {
        return
      }
      const trigger = document.querySelector(".trigger")
      activeFeedRow(2)?.click()
      await waitFor(
        () => activeRoute() === "/feed/2",
        "Feed row did not navigate to the existing route",
      )
      await waitFor(
        () => trigger?.getAttribute("aria-expanded") === "false",
        "Drawer did not close after feed selection",
      )
    },
  ],
]

async function runScenarios() {
  const summary = document.querySelector("[data-testid='suite-summary']")
  const report = document.querySelector("[data-testid='suite-results']")
  const results = []
  summary.textContent = "RUNNING"
  for (const [name, scenario] of scenarios) {
    try {
      await scenario()
      results.push({ name, status: "PASS" })
    } catch (error) {
      results.push({ name, status: "FAIL", detail: error.message })
    }
    report.textContent = JSON.stringify(results, null, 2)
    summary.textContent = `${results.filter(({ status }) => status === "PASS").length}/${results.length} gates PASS`
  }
  globalThis.__nav02R2Results = results
}

const FixtureFrame = () => (
  <div className="nav02-app">
    <aside className="sidebar sidebar-expanded nav02-desktop-sidebar">
      <div className="desktop-sidebar-content" id="desktop-sidebar-navigation">
        <Sidebar />
      </div>
    </aside>
    <main className="nav02-main">
      <SidebarTrigger />
      <h1>NAV-02 R2 navigation harness</h1>
      <div className="nav02-controls">
        <label htmlFor="nav02-theme">Theme</label>
        <select
          defaultValue="light"
          id="nav02-theme"
          onChange={(event) => {
            const theme = event.target.value
            if (theme === "dark") {
              document.body.setAttribute("arco-theme", "dark")
            } else {
              document.body.removeAttribute("arco-theme")
            }
            settingsState.set({ ...settingsState.get(), themeMode: theme })
          }}
        >
          <option value="light">Light</option>
          <option value="dark">Dark / OLED</option>
        </select>
        <Button data-testid="run-nav02-suite" onClick={() => void runScenarios()}>
          Run R2 behavior gates
        </Button>
        <Button
          data-testid="capture-layout"
          onClick={() => {
            document.querySelector("[data-testid='layout-report']").textContent = JSON.stringify(
              captureMetrics(),
              null,
              2,
            )
          }}
        >
          Capture layout
        </Button>
        <Button
          data-testid="hide-harness-controls"
          onClick={() => document.body.classList.add("nav02-hide-controls")}
        >
          Hide controls
        </Button>
      </div>
      <p data-testid="suite-summary">Ready</p>
      <pre className="nav02-results" data-testid="suite-results" />
      <pre data-testid="layout-report" />
      <RouteProbe />
    </main>
  </div>
)

router = createMemoryRouter([{ path: "*", element: <FixtureFrame /> }], { initialEntries: ["/"] })
createRoot(document.querySelector("#root")).render(
  <AppDataContext.Provider value={appData}>
    <DesktopSidebarContext.Provider
      value={{
        isDesktopSidebarCollapsed: false,
        collapseButtonRef: { current: null },
        detailCloseButtonRef: { current: null },
        reopenButtonRef: { current: null },
        collapseDesktopSidebar: () => {},
        expandDesktopSidebar: () => {},
      }}
    >
      <RouterProvider router={router} />
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>,
)

settingsState.set({ ...getDefaultSettings(), showFeedIcon: false, themeMode: "light" })
authState.set({ server: "https://example.invalid", token: "fixture", username: "fixture" })
commitIdentityData({ id: 1, username: "fixture" })
commitCatalogData({ feedsData: fixtureFeeds, categoriesData: fixtureCategories })
setUnreadInfo(initialUnread)
