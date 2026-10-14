/* eslint-disable react-refresh/only-export-components -- This browser harness keeps fixture components together. */
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
import { commitCatalogData, commitIdentityData, resetData, setUnreadInfo } from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { expandedCategoriesState, setExpandedCategories } from "@/store/sidebarState"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/App.css"
import "@/theme.css"
import "@/components/Article/SidebarTrigger.css"
import "./nav02-unread-shortcut.css"

const generalCategory = { id: 1, title: "General", hide_globally: false }
const hiddenCategory = { id: 2, title: "Hidden category", hide_globally: true }
const emptyCategory = { id: 3, title: "Empty category", hide_globally: false }
const makeFeed = (id, title, category, hideGlobally = false) => ({
  id,
  title,
  icon: { icon_id: 0 },
  site_url: `https://example.invalid/${id}`,
  feed_url: `https://example.invalid/${id}/feed`,
  category,
  hide_globally: hideGlobally,
  disabled: false,
  crawler: false,
})
const fixtureFeeds = [
  makeFeed(2, "Zulu unread source with a deliberately long title", generalCategory),
  makeFeed(3, "Alpha unread source", generalCategory),
  makeFeed(4, "Read source", generalCategory),
  makeFeed(5, "Hidden feed", generalCategory, true),
  makeFeed(6, "Hidden category feed", hiddenCategory),
]
const fixtureCategories = [generalCategory, hiddenCategory, emptyCategory]
const defaultUnreadInfo = { 2: 1, 3: 99, 4: 0, 5: 7, 6: 8 }
const feedReadRequests = []
let countRefreshCalls = 0
let router

apiClient.put = async (url) => {
  feedReadRequests.push(url)
  return {}
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
feedIconsState.setKey(0, { height: 16, width: 16, url: "/default-feed-icon.png" })

const appData = {
  refreshFeedData: async () => {},
  refreshCounts: async () => {
    countRefreshCalls += 1
    return { error: null }
  },
}

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) {
      return
    }
    await settle()
  }
  throw new Error(message)
}
const activeSidebarRoot = () =>
  document.querySelector(".sidebar-drawer .sidebar-container") ??
  document.querySelector(".nav02-desktop-sidebar .sidebar-container")
const shortcutRows = () => [
  ...(activeSidebarRoot()?.querySelectorAll(".unread-feed-shortcut-item") ?? []),
]
const shortcutIds = () => shortcutRows().map((row) => row.dataset.feedEditId)
const categoryFeedRows = () =>
  [
    ...(activeSidebarRoot()?.querySelectorAll(".arco-collapse-item-content .feed-menu-item") ?? []),
  ].filter((row) => row.dataset.feedEditId)
const captureLayoutMetrics = () => {
  const sidebar =
    document.querySelector(".sidebar-drawer .sidebar-container") ??
    document.querySelector(".nav02-desktop-sidebar .sidebar-container")
  const scrollArea = sidebar?.querySelector(
    ".simplebar-content-wrapper, .adaptive-scroll-area-native",
  )
  const rows = [...(sidebar?.querySelectorAll(".unread-feed-shortcut-item") ?? [])]

  return {
    viewport: { width: innerWidth, height: innerHeight },
    theme: document.body.getAttribute("arco-theme") ?? "light",
    documentWidth: document.documentElement.scrollWidth,
    sidebarVisible: Boolean(sidebar && sidebar.getBoundingClientRect().width > 0),
    sidebarWidth: sidebar?.getBoundingClientRect().width ?? 0,
    sidebarScrollWidth: scrollArea?.scrollWidth ?? 0,
    shortcutRows: rows.map((row) => {
      const title = row.querySelector(".custom-menu-item > :first-child")
      const count = row.querySelector(".item-count")
      return {
        height: Math.round(row.getBoundingClientRect().height),
        titleWidth: Math.round(title?.getBoundingClientRect().width ?? 0),
        countWidth: Math.round(count?.getBoundingClientRect().width ?? 0),
      }
    }),
    selectedShortcutRows: rows.filter((row) => row.classList.contains("arco-menu-selected")).length,
  }
}

const resetFixture = async (path = "/") => {
  resetData()
  resetContent()
  authState.set({ server: "https://example.invalid", token: "fixture", username: "fixture" })
  settingsState.set({
    ...getDefaultSettings(),
    showFeedIcon: false,
    showHiddenFeeds: false,
    showUnreadFeedsOnly: false,
    themeMode: document.body.getAttribute("arco-theme") === "dark" ? "dark" : "light",
  })
  setExpandedCategories([])
  commitIdentityData({ id: 1, username: "fixture" })
  commitCatalogData({ feedsData: fixtureFeeds, categoriesData: fixtureCategories })
  setUnreadInfo(defaultUnreadInfo)
  feedReadRequests.length = 0
  countRefreshCalls = 0
  await router.navigate(path)
  await settle()
  if (innerWidth <= 992) {
    const trigger = document.querySelector(".trigger")
    if (trigger?.getAttribute("aria-expanded") !== "true") {
      trigger?.click()
      await waitFor(
        () => document.querySelector(".sidebar-drawer .sidebar-container"),
        "Mobile sidebar drawer did not open for the fixture",
      )
    }
  }
}

const RouteProbe = () => {
  const location = useLocation()
  return (
    <output aria-live="polite" data-testid="current-route">
      {location.pathname}
    </output>
  )
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
      <h1>NAV-02 Sidebar behavior harness</h1>
      <div className="nav02-controls">
        <label htmlFor="nav02-theme">Theme</label>
        <select
          id="nav02-theme"
          onChange={(event) => {
            if (event.target.value === "dark") {
              document.body.setAttribute("arco-theme", "dark")
            } else {
              document.body.removeAttribute("arco-theme")
            }
            settingsState.set({
              ...settingsState.get(),
              themeMode: event.target.value,
            })
          }}
        >
          <option value="light">Light</option>
          <option value="dark">Dark / OLED</option>
        </select>
        <Button data-testid="run-nav02-suite" onClick={() => void runScenarios()}>
          Run NAV-02 behavior gates
        </Button>
        <Button
          data-testid="capture-layout"
          onClick={() => {
            document.querySelector("[data-testid='layout-report']").textContent = JSON.stringify(
              captureLayoutMetrics(),
              null,
              2,
            )
          }}
        >
          Capture layout metrics
        </Button>
        <Button
          data-testid="hide-harness-controls"
          onClick={() => document.body.classList.add("nav02-hide-controls")}
        >
          Hide test controls
        </Button>
      </div>
      <p data-testid="suite-summary">Ready</p>
      <pre className="nav02-results" data-testid="suite-results" />
      <pre data-testid="layout-report" />
      <RouteProbe />
    </main>
  </div>
)

const scenarios = [
  [
    "UNREAD_FIRST_VISIBLE_AT_TOP_LEVEL",
    async () => {
      await resetFixture()
      assert(document.querySelector(".unread-source-title"), "Unread section heading missing")
      assert(
        shortcutIds().join(",") === "3,2",
        "Unread feeds are not visible above collapsed categories",
      )
      assert(expandedCategoriesState.get().length === 0, "Shortcut expanded a category")
    },
  ],
  [
    "ZERO_UNREAD_NOT_IN_PRIORITY_SURFACE",
    async () => {
      await resetFixture()
      assert(!shortcutIds().includes("4"), "Zero-unread feed appeared in the shortcut")
    },
  ],
  [
    "FULL_CATALOG_STILL_ACCESSIBLE",
    async () => {
      await resetFixture()
      setExpandedCategories([1])
      await waitFor(() => categoryFeedRows().length > 0, "Canonical category did not expand")
      assert(
        categoryFeedRows().some((row) => row.dataset.feedEditId === "4"),
        "Read feed disappeared from the catalog",
      )
      assert(
        shortcutIds().includes("2"),
        "Unread shortcut entry disappeared after catalog expansion",
      )
      assert(
        categoryFeedRows().some((row) => row.dataset.feedEditId === "2"),
        "Unread feed disappeared from its canonical category",
      )
    },
  ],
  [
    "UNREAD_COUNT_PRESERVED",
    async () => {
      await resetFixture()
      const countText = shortcutRows()
        .find((row) => row.dataset.feedEditId === "3")
        // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Typography.Ellipsis duplicates the count in textContent.
        ?.innerText.trim()
        .split("\n")
        .at(-1)
      assert(countText === "99", "Shortcut changed or omitted the existing unread count")
    },
  ],
  [
    "CURRENT_FEED_SELECTION_PRESERVED",
    async () => {
      await resetFixture("/feed/2")
      assert(
        shortcutRows()
          .find((row) => row.dataset.feedEditId === "2")
          ?.classList.contains("arco-menu-selected"),
        "Shortcut did not select the current feed route",
      )
      setExpandedCategories([1])
      await waitFor(() => categoryFeedRows().length > 0, "Canonical category did not expand")
      assert(
        categoryFeedRows()
          .find((row) => row.dataset.feedEditId === "2")
          ?.classList.contains("arco-menu-selected"),
        "Canonical feed selection was lost",
      )
    },
  ],
  [
    "DETERMINISTIC_ORDER_AND_NO_UNREAD_RANKING",
    async () => {
      await resetFixture()
      assert(
        shortcutIds().join(",") === "3,2",
        "Shortcut did not preserve catalog order (Alpha before Zulu despite lower unread count)",
      )
    },
  ],
  [
    "SHOW_UNREAD_ONLY_HIDES_SHORTCUT_AND_PRESERVES_HIERARCHY",
    async () => {
      await resetFixture()
      settingsState.set({ ...settingsState.get(), showUnreadFeedsOnly: true })
      setExpandedCategories([1])
      await settle()
      assert(
        !document.querySelector(".unread-source-title"),
        "Shortcut remained visible in unread-only mode",
      )
      assert(
        categoryFeedRows().some((row) => row.dataset.feedEditId === "2"),
        "Unread-only hierarchy lost an unread feed",
      )
      assert(
        categoryFeedRows().some((row) => row.dataset.feedEditId === "3"),
        "Unread-only hierarchy lost another unread feed",
      )
      assert(
        !categoryFeedRows().some((row) => row.dataset.feedEditId === "4"),
        "Unread-only hierarchy exposed a read feed",
      )
      assert(settingsState.get().showUnreadFeedsOnly, "Existing setting was changed")
    },
  ],
  [
    "SHORTCUT_USES_EXISTING_VISIBLE_FEEDS_ONLY",
    async () => {
      await resetFixture()
      assert(
        !shortcutIds().includes("5") && !shortcutIds().includes("6"),
        "Globally hidden feed appeared while hidden items are off",
      )
      settingsState.set({ ...settingsState.get(), showHiddenFeeds: true })
      await waitFor(
        () => shortcutIds().includes("6"),
        "Visible-feed selector did not react when hidden items were enabled",
      )
      assert(
        shortcutIds().includes("5"),
        "Hidden feed did not follow the existing show-hidden setting",
      )
    },
  ],
  [
    "COUNTS_REFRESH_REACTIVITY",
    async () => {
      await resetFixture()
      setUnreadInfo((previous) => ({ ...previous, 2: 5 }))
      await waitFor(
        () =>
          shortcutRows()
            .find((row) => row.dataset.feedEditId === "2")
            // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- Read the count users can see in the rendered row.
            ?.innerText.trim()
            .split("\n")
            .at(-1) === "5",
        "Shortcut count did not react to the existing unread-count store",
      )
    },
  ],
  [
    "NO_UNREAD_OMITS_SHORTCUT_SECTION",
    async () => {
      await resetFixture()
      setUnreadInfo({ 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 })
      await waitFor(
        () => !document.querySelector(".unread-source-title"),
        "Empty unread section was not omitted",
      )
      assert(shortcutRows().length === 0, "Shortcut rows remained with no unread feeds")
    },
  ],
  [
    "CURRENT_FEED_ZERO_UNREAD_NO_NAVIGATION_AND_MARK_ALL_READ_UNCHANGED",
    async () => {
      await resetFixture("/feed/2")
      const before = contentState.get()
      const row = shortcutRows().find((candidate) => candidate.dataset.feedEditId === "2")
      assert(row, "Current feed missing from shortcut before mark-all-read")
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
        () => feedReadRequests.length === 1 && countRefreshCalls === 1,
        "Existing mark-all-read mutation or count refresh did not run",
      )
      await waitFor(
        () => !shortcutRows().some((candidate) => candidate.dataset.feedEditId === "2"),
        "Read feed remained in the shortcut",
      )
      assert(
        router.state.location.pathname === "/feed/2",
        "Count reconciliation navigated away from the current feed",
      )
      assert(
        contentState.get().activeContent === before.activeContent &&
          contentState.get().entries === before.entries,
        "Shortcut reconciliation changed article content",
      )
      assert(
        expandedCategoriesState.get().length === 0,
        "Shortcut reconciliation changed category expansion",
      )
      assert(
        feedReadRequests[0] === "/v1/feeds/2/mark-all-as-read",
        "Existing mark-all-read endpoint changed",
      )
    },
  ],
  [
    "SHORTCUT_CLICK_USES_EXISTING_FEED_ROUTE",
    async () => {
      await resetFixture()
      shortcutRows()
        .find((row) => row.dataset.feedEditId === "2")
        ?.click()
      await waitFor(
        () => router.state.location.pathname === "/feed/2",
        "Shortcut did not navigate to the existing feed route",
      )
    },
  ],
  [
    "MOBILE_NAVIGATION_UNCHANGED",
    async () => {
      await resetFixture()
      if (innerWidth > 992) {
        return
      }
      const trigger = document.querySelector(".trigger")
      assert(
        trigger && getComputedStyle(trigger).display !== "none",
        "Mobile sidebar trigger is unavailable",
      )
      if (trigger.getAttribute("aria-expanded") !== "true") {
        trigger.click()
        await waitFor(
          () => document.querySelector(".sidebar-drawer .sidebar-container"),
          "Mobile sidebar drawer did not open",
        )
      }
      const row = document.querySelector(
        ".sidebar-drawer .unread-feed-shortcut-item[data-feed-edit-id='2']",
      )
      assert(row, "Unread shortcut is unavailable in the mobile sidebar")
      row.click()
      await waitFor(
        () => router.state.location.pathname === "/feed/2",
        "Mobile shortcut navigation did not preserve the feed route",
      )
      await waitFor(
        () => trigger.getAttribute("aria-expanded") === "false",
        "Mobile drawer did not close after navigation",
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
  globalThis.__nav02Results = results
}

router = createMemoryRouter([{ path: "*", element: <FixtureFrame /> }], {
  initialEntries: ["/"],
})

const root = createRoot(document.querySelector("#root"))
root.render(
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
setUnreadInfo(defaultUnreadInfo)
