/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useState } from "react"
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
import { commitCatalogData, commitIdentityData, resetData, setUnreadInfo } from "@/store/dataState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { setExpandedCategories } from "@/store/sidebarState"
import "@arco-design/web-react/dist/css/arco.css"
import "simplebar-react/dist/simplebar.min.css"
import "@/index.css"
import "@/App.css"
import "@/theme.css"
import "@/components/Article/SidebarTrigger.css"
import "./feed-health-01a-sidebar.css"

const category = { id: 71, title: "FEED-HEALTH fixture", hide_globally: false }
const makeFeed = (id, title, options = {}) => ({
  id,
  title,
  category,
  icon: { icon_id: 0 },
  site_url: `https://example.invalid/${id}`,
  feed_url: `https://example.invalid/${id}/feed`,
  hide_globally: false,
  disabled: false,
  parsing_error_count: 0,
  parsing_error_message: "",
  checked_at: "2026-10-16T00:00:00Z",
  next_check_at: "2026-10-16T01:00:00Z",
  ...options,
})
const missingErrorCountFeed = makeFeed(75, "Missing error count fixture feed")
delete missingErrorCountFeed.parsing_error_count
const feeds = [
  makeFeed(71, "Healthy fixture feed"),
  makeFeed(72, "Errored fixture feed", {
    parsing_error_count: 1,
    parsing_error_message: "Fixture provider error detail stays private",
  }),
  makeFeed(73, "Unread errored fixture feed", {
    parsing_error_count: 3,
    unreadCount: 7,
    parsing_error_message: "Fixture provider error detail stays private",
  }),
  makeFeed(74, "Disabled fixture feed", { disabled: true, parsing_error_count: 4 }),
  missingErrorCountFeed,
]
const requests = []

for (const method of ["get", "post", "put", "raw", "delete"]) {
  apiClient[method] = async (...args) => {
    requests.push({ method, args })
    throw new Error(`Unexpected fixture API request: ${method}`)
  }
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
authState.set({ server: "https://example.invalid", token: "fixture", username: "fixture" })
settingsState.set({ ...getDefaultSettings(), showFeedIcon: false, showUnreadFeedsOnly: false })
resetData()
setExpandedCategories(["/category/71"])
commitIdentityData({ id: 1, username: "fixture" })
commitCatalogData({ feedsData: feeds, categoriesData: [category] })
setUnreadInfo({ 71: 0, 72: 0, 73: 7, 74: 2, 75: 0 })

const appData = {
  refreshCounts: async () => ({ error: null }),
  refreshFeedData: async () => {},
}
const desktopSidebar = {
  isDesktopSidebarCollapsed: false,
  collapseButtonRef: { current: null },
  detailCloseButtonRef: { current: null },
  reopenButtonRef: { current: null },
  collapseDesktopSidebar: () => {},
  expandDesktopSidebar: () => {},
}
const router = createMemoryRouter([{ path: "*", element: <FixtureFrame /> }], {
  initialEntries: ["/all"],
})

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message)
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) {
      return
    }
    await settle()
  }
  throw new Error(message)
}
const sidebarRoot = () =>
  document.querySelector(".sidebar-drawer .sidebar-container") ??
  document.querySelector(".feed-health-desktop-sidebar .sidebar-container")
const feedRow = (id) =>
  sidebarRoot()?.querySelector(`[data-feed-edit-id='${CSS.escape(String(id))}']`)
const ensureSidebarOpen = async () => {
  if (innerWidth > 992) {
    await waitFor(() => sidebarRoot(), "Desktop Sidebar did not render")
    return
  }
  const trigger = document.querySelector(".trigger")
  if (trigger?.getAttribute("aria-expanded") !== "true") {
    trigger?.click()
  }
  await waitFor(
    () => document.querySelector(".sidebar-drawer .sidebar-container"),
    "Sidebar drawer did not open",
  )
  await waitFor(() => feedRow(71), "Feed fixture rows did not render")
}

const runScenarios = async () => {
  const results = []
  const gate = async (name, check) => {
    try {
      await check()
      results.push({ name, status: "PASS" })
    } catch (error) {
      results.push({ name, status: "FAIL", detail: error.message })
    }
  }

  await ensureSidebarOpen()
  const healthy = feedRow(71)
  const errored = feedRow(72)
  const unreadErrored = feedRow(73)
  const disabled = feedRow(74)
  const missingErrorCount = feedRow(75)
  const initialCategoryContent = healthy?.closest(".arco-collapse-item-content")
  const healthyRect = healthy?.getBoundingClientRect()
  const erroredRect = errored?.getBoundingClientRect()

  await gate("HEALTHY_FEED_NO_INDICATOR", () =>
    assert(
      healthy && !healthy.querySelector(".feed-health-indicator"),
      "Healthy feed gained a health indicator",
    ),
  )
  await gate("SUCCESS_RESET_ZERO_HIDES_INDICATOR", () =>
    assert(
      healthy && !healthy.querySelector(".feed-health-indicator"),
      "A reset error count of zero still shows the indicator",
    ),
  )
  await gate("ERROR_FEED_INDICATOR_VISIBLE", () =>
    assert(errored?.querySelector(".feed-health-indicator"), "Provider error indicator is missing"),
  )
  await gate("ONE_FAILURE_SHOWS_INDICATOR", () =>
    assert(
      errored?.querySelector(".feed-health-indicator"),
      "A single provider-reported failure did not show the indicator",
    ),
  )
  await gate("ERROR_FEED_NON_COLOR_SIGNAL", () => {
    const trigger = errored?.parentElement?.querySelector(".feed-health-trigger")
    assert(trigger instanceof HTMLButtonElement, "Indicator is not an interactive control")
    assert(trigger.getAttribute("aria-label"), "Indicator has no non-color accessible text")
  })
  await gate("ERROR_FEED_ACCESSIBLE_NAME", () =>
    assert(
      errored?.parentElement?.querySelector(
        ".feed-health-trigger[aria-label*='Errored fixture feed']",
      ),
      "Indicator accessible name is missing or not localized",
    ),
  )
  await gate("UNREAD_COUNT_PRESERVED", () =>
    assert(
      unreadErrored?.querySelector(".item-count .arco-ellipsis-content")?.textContent.trim() ===
        "7",
      "Unread count changed or disappeared",
    ),
  )
  await gate("ROW_GEOMETRY_STABLE", () =>
    assert(
      healthyRect && erroredRect && Math.abs(healthyRect.height - erroredRect.height) <= 1,
      "Health indicator changed feed row height",
    ),
  )
  await gate("CATEGORY_STRUCTURE_PRESERVED", () => {
    assert(initialCategoryContent, "Feed row is no longer inside its category group")
    assert(
      initialCategoryContent.querySelectorAll(".feed-menu-item[data-feed-edit-id]").length === 5,
      "Category feed list structure changed",
    )
  })
  await gate("DISABLED_FEED_NO_REGRESSION", () =>
    assert(
      disabled && !disabled.querySelector(".feed-health-indicator"),
      "Healthy disabled feed presentation changed",
    ),
  )
  await gate("DISABLED_WITH_ERROR_COUNT_SUPPRESSES_ERROR_INDICATOR", () =>
    assert(
      disabled && !disabled.querySelector(".feed-health-indicator"),
      "A disabled feed with stale provider error data shows the indicator",
    ),
  )
  await gate("MISSING_ERROR_COUNT_SHOWS_NOTHING", () =>
    assert(
      missingErrorCount && !missingErrorCount.querySelector(".feed-health-indicator"),
      "A feed without parsing_error_count shows a synthesized indicator",
    ),
  )
  await gate("NO_NEW_API_CALLS", () =>
    assert(requests.length === 0, `Sidebar made ${requests.length} unexpected API calls`),
  )
  await gate("NO_HORIZONTAL_OVERFLOW", () => {
    const root = sidebarRoot()
    assert(
      root && root.scrollWidth <= root.clientWidth + 1,
      "Sidebar content overflows horizontally",
    )
    assert(document.documentElement.scrollWidth <= innerWidth + 1, "Page overflows horizontally")
  })
  await gate("ROW_NAVIGATION_PRESERVED", async () => {
    await router.navigate("/all")
    await ensureSidebarOpen()
    feedRow(72)?.click()
    await waitFor(
      () => router.state.location.pathname === "/feed/72",
      "Feed row no longer opens its source",
    )
  })
  await gate("CATEGORY_NAVIGATION_PRESERVED", async () => {
    await router.navigate("/all")
    await ensureSidebarOpen()
    sidebarRoot()?.querySelector("[data-category-edit-id='71']")?.click()
    await waitFor(
      () => router.state.location.pathname === "/category/71",
      "Category navigation changed",
    )
  })

  const report = {
    viewport: { width: innerWidth, height: innerHeight },
    summary: `${results.filter(({ status }) => status === "PASS").length}/${results.length} gates PASS`,
    results,
  }
  document.querySelector("[data-testid='suite-summary']").textContent = report.summary
  document.querySelector("[data-testid='suite-results']").textContent = JSON.stringify(
    report,
    null,
    2,
  )
  globalThis.__feedHealth01AResults = report
  return report
}

globalThis.__runFeedHealth01A = runScenarios

const LocationProbe = () => {
  const { pathname } = useLocation()
  return <output data-testid="current-route">{pathname}</output>
}

function FixtureFrame() {
  const [running, setRunning] = useState(false)
  return (
    <div className="feed-health-app">
      <aside className="sidebar sidebar-expanded feed-health-desktop-sidebar">
        <div className="desktop-sidebar-content" id="desktop-sidebar-navigation">
          <Sidebar />
        </div>
      </aside>
      <main className="feed-health-main">
        <SidebarTrigger />
        <div className="feed-health-controls">
          <Button
            data-testid="run-feed-health-suite"
            loading={running}
            onClick={async () => {
              setRunning(true)
              try {
                await runScenarios()
              } finally {
                setRunning(false)
              }
            }}
          >
            Run FEED-HEALTH-01A gates
          </Button>
        </div>
        <p data-testid="suite-summary">Ready</p>
        <pre className="feed-health-results" data-testid="suite-results" />
        <LocationProbe />
      </main>
    </div>
  )
}

createRoot(document.querySelector("#root")).render(
  <AppDataContext.Provider value={appData}>
    <DesktopSidebarContext.Provider value={desktopSidebar}>
      <ConfigProvider locale={enUS}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </DesktopSidebarContext.Provider>
  </AppDataContext.Provider>,
)
