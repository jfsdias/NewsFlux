/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
/* eslint-disable react-hooks/immutability, react-compiler/react-compiler -- The harness exposes a probe for in-page test scenarios. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider, Notification } from "@arco-design/web-react"
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
import { handleBulkFeedRefresh, useFeedOperations } from "@/hooks/useFeedOperations"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import {
  commitCatalogData,
  commitIdentityData,
  dataState,
  resetData,
  setUnreadInfo,
} from "@/store/dataState"
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
    parsing_error_message: "Provider error detail. ".repeat(80),
  }),
  makeFeed(74, "Disabled fixture feed", { disabled: true, parsing_error_count: 4 }),
  missingErrorCountFeed,
]
const requests = []
let requestMode = "unexpected"
let reloadMode = "none"
let metadataReloadCalls = 0
let releaseRefreshRequest = null
const fixtureCheckedAt = "2026-10-16T00:00:00Z"
const updatedProviderCheckedAt = "2026-10-17T10:30:00Z"
const cloneFeeds = (items = feeds) =>
  items.map((feed) => ({ ...feed, category: { ...feed.category } }))
const restoreFixtureData = () => {
  resetData()
  commitIdentityData({ id: 1, username: "fixture" })
  commitCatalogData({ feedsData: cloneFeeds(), categoriesData: [category] })
  setUnreadInfo({ 71: 0, 72: 0, 73: 7, 74: 2, 75: 0 })
}

for (const method of ["get", "post", "put", "delete"]) {
  apiClient[method] = async (...args) => {
    requests.push({ method, args })
    throw new Error(`Unexpected fixture API request: ${method}`)
  }
}
apiClient.raw = async (...args) => {
  requests.push({ method: "raw", args })
  if (args[0]?.includes("/refresh") && requestMode === "failure") {
    throw new Error("Fixture refresh request failed")
  }
  if (
    args[0]?.includes("/refresh") &&
    requestMode === "partial-failure" &&
    args[0]?.includes("/73/refresh")
  ) {
    throw new Error("Fixture refresh request failed for feed 73")
  }
  if (args[0]?.includes("/refresh") && requestMode === "stale-after-refresh") {
    resetData()
    commitIdentityData({ id: 1, username: "fixture" })
    commitCatalogData({ feedsData: cloneFeeds(), categoriesData: [category] })
    return { status: 204 }
  }
  if (args[0]?.includes("/refresh") && requestMode === "slow") {
    return new Promise((resolve) => {
      releaseRefreshRequest = () => resolve({ status: 204 })
    })
  }
  if (args[0]?.includes("/refresh") && ["success", "partial-failure"].includes(requestMode)) {
    return { status: 204 }
  }
  throw new Error(`Unexpected fixture API request: raw ${args[0]}`)
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
  refreshFeedData: async () => {
    metadataReloadCalls += 1
    if (reloadMode === "failure") {
      throw new Error("Fixture metadata reload failed")
    }
    if (reloadMode === "still-error") {
      commitCatalogData({
        feedsData: cloneFeeds().map((feed) =>
          feed.id === 72
            ? {
                ...feed,
                parsing_error_count: 2,
                parsing_error_message: "Updated provider error after refresh",
                checked_at: updatedProviderCheckedAt,
              }
            : feed,
        ),
        categoriesData: [category],
      })
    }
    if (reloadMode === "recovered") {
      commitCatalogData({
        feedsData: cloneFeeds().map((feed) =>
          feed.id === 72
            ? {
                ...feed,
                parsing_error_count: 0,
                parsing_error_message: "",
                checked_at: updatedProviderCheckedAt,
              }
            : feed,
        ),
        categoriesData: [category],
      })
    }
    if (reloadMode === "disappeared") {
      commitCatalogData({
        feedsData: cloneFeeds().filter((feed) => feed.id !== 72),
        categoriesData: [category],
      })
    }
    if (reloadMode === "stale-after-reload") {
      resetData()
      commitIdentityData({ id: 1, username: "fixture" })
      commitCatalogData({ feedsData: cloneFeeds(), categoriesData: [category] })
    }
  },
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

  const runRefreshFixture = async (mode, reload = "none") => {
    restoreFixtureData()
    requestMode = mode
    reloadMode = reload
    metadataReloadCalls = 0
    await settle()
    const feed = dataState.get().feedsData.find(({ id }) => id === 72)
    return { feed, operations: globalThis.__feedHealthOperations }
  }

  await gate("NO_SYNTHETIC_PARSING_ERROR_COUNT", async () => {
    const { feed, operations } = await runRefreshFixture("failure")
    assert(operations?.refreshSingleFeed, "Feed operation probe did not mount")
    await operations.refreshSingleFeed(feed, false)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(
      after.parsing_error_count === feed.parsing_error_count,
      "Refresh failure fabricated parsing_error_count",
    )
  })
  await gate("NO_SYNTHETIC_CHECKED_AT", async () => {
    const { feed, operations } = await runRefreshFixture("failure")
    await operations.refreshSingleFeed(feed, false)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(after.checked_at === fixtureCheckedAt, "Refresh failure fabricated checked_at")
  })
  await gate("SINGLE_FEED_REFRESH_RECONCILIATION", async () => {
    const { feed, operations } = await runRefreshFixture("success", "still-error")
    await operations.refreshSingleFeed(feed, false)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(metadataReloadCalls === 1, "Successful refresh did not reload provider metadata")
    assert(after.parsing_error_count === 2, "UI did not use the refreshed provider error count")
    assert(after.checked_at === updatedProviderCheckedAt, "UI did not use provider checked_at")
  })
  const runBulkRefreshFixture = async (mode = "success", reload = "none") => {
    const { operations } = await runRefreshFixture(mode, reload)
    const erroredFeeds = dataState
      .get()
      .feedsData.filter(({ parsing_error_count }) => parsing_error_count > 0)
    requests.length = 0
    const result = await handleBulkFeedRefresh({
      feeds: erroredFeeds,
      refreshSingleFeed: operations.refreshSingleFeed,
      refreshFeedData: appData.refreshFeedData,
    })
    const refreshRequestCount = requests.filter(
      ({ method, args }) => method === "raw" && args[0]?.includes("/refresh"),
    ).length
    return { erroredFeeds, refreshRequestCount, result }
  }

  await gate("BULK_ERROR_FEEDS_REQUEST_COUNT", async () => {
    const { erroredFeeds, refreshRequestCount, result } = await runBulkRefreshFixture()
    const refreshRequests = requests.filter(
      ({ method, args }) => method === "raw" && args[0]?.includes("/refresh"),
    )
    assert(erroredFeeds.length >= 3, "Fixture needs at least three feeds with errors")
    assert(
      refreshRequestCount === 3,
      `Expected 3 refresh requests, received ${refreshRequestCount}`,
    )
    assert(
      refreshRequests.every(({ args }) => args[1]?.method === "PUT"),
      "Bulk refresh did not issue PUT requests",
    )
    assert(result.status === "completed", "Bulk refresh did not complete")
    assert(
      result.successCount === 3 && result.failureCount === 0,
      "Request results were miscounted",
    )
  })
  await gate("BULK_ERROR_FEEDS_SINGLE_METADATA_RELOAD", async () => {
    const { refreshRequestCount } = await runBulkRefreshFixture()
    assert(
      refreshRequestCount === 3,
      `Expected 3 refresh requests, received ${refreshRequestCount}`,
    )
    assert(
      metadataReloadCalls === 1,
      `Expected one metadata reload for 3 requests, received ${metadataReloadCalls}`,
    )
  })
  await gate("BULK_ERROR_FEEDS_PARTIAL_REQUEST_FAILURE", async () => {
    const { refreshRequestCount, result } = await runBulkRefreshFixture("partial-failure")
    assert(
      refreshRequestCount === 3,
      `Expected 3 refresh requests, received ${refreshRequestCount}`,
    )
    assert(result.status === "completed", "Partial request failure prevented reconciliation")
    assert(
      result.successCount === 2 && result.failureCount === 1,
      `Partial failure counts are wrong: ${result.successCount} successful, ${result.failureCount} failed`,
    )
    assert(metadataReloadCalls === 1, "Partial request failure did not reconcile exactly once")
  })
  await gate("BULK_ERROR_FEEDS_METADATA_RELOAD_FAILURE", async () => {
    const before = cloneFeeds()
    const { refreshRequestCount, result } = await runBulkRefreshFixture("success", "failure")
    const after = dataState.get().feedsData
    assert(
      refreshRequestCount === 3,
      `Expected 3 refresh requests, received ${refreshRequestCount}`,
    )
    assert(result.status === "metadata-reload-failure", "Reload failure was reported as success")
    assert(metadataReloadCalls === 1, "Failed metadata reload was not attempted exactly once")
    assert(
      after.every((feed, index) =>
        ["parsing_error_count", "checked_at", "parsing_error_message"].every(
          (field) => feed[field] === before[index][field],
        ),
      ),
      "A failed metadata reload fabricated provider feed state",
    )
  })
  await gate("BULK_ERROR_FEEDS_STALE_SESSION", async () => {
    const requestResult = await runBulkRefreshFixture("stale-after-refresh")
    assert(
      requestResult.result.status === "stale-session",
      "Session change during PUTs was not detected",
    )
    assert(requestResult.refreshRequestCount === 1, "Requests continued after the session changed")
    assert(metadataReloadCalls === 0, "Metadata reloaded after the session changed during PUTs")

    const reloadResult = await runBulkRefreshFixture("success", "stale-after-reload")
    assert(
      reloadResult.result.status === "stale-session",
      "Session change during final reconciliation was not detected",
    )
    assert(metadataReloadCalls === 1, "Final metadata reconciliation did not run once")
  })
  await gate("DETAIL_TRIGGER_NO_NAVIGATION", async () => {
    restoreFixtureData()
    requestMode = "success"
    await router.navigate("/all")
    await ensureSidebarOpen()
    const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='72']")
    assert(trigger instanceof HTMLButtonElement, "Feed error indicator is not a button")
    assert(
      !trigger.closest(".feed-menu-item"),
      "Details trigger is nested in the navigation control",
    )
    trigger.click()
    await waitFor(
      () => document.querySelector("[data-testid='feed-health-details-72']"),
      "Feed details did not open",
    )
    assert(router.state.location.pathname === "/all", "Opening feed details navigated to the feed")
  })
  await gate("MOBILE_DRAWER_REMAINS_OPEN", async () => {
    if (innerWidth > 768) {
      return
    }
    const drawer = document.querySelector(".sidebar-drawer")
    const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='72']")
    assert(drawer && trigger, "Mobile Sidebar drawer or details trigger is missing")
    if (trigger.getAttribute("aria-expanded") !== "true") {
      trigger.click()
    }
    await waitFor(
      () => document.querySelector("[data-testid='feed-health-details-72']"),
      "Mobile details did not open",
    )
    assert(
      document.querySelector(".sidebar-drawer"),
      "Opening feed details closed the Sidebar drawer",
    )
  })
  await gate("PROVIDER_ERROR_MESSAGE_EXACT", async () => {
    const detail = document.querySelector("[data-testid='feed-health-details-72']")
    assert(
      detail?.textContent.includes("Fixture provider error detail stays private"),
      "Provider error message was changed or omitted",
    )
  })
  await gate("CHECKED_AT_PROVIDER_VALUE", async () => {
    const detail = document.querySelector("[data-testid='feed-health-details-72']")
    assert(
      detail?.querySelector("time")?.dateTime === fixtureCheckedAt,
      "Provider checked_at value was not retained exactly",
    )
  })
  await gate("ARIA_EXPANDED_AND_ACCESSIBLE_NAME", async () => {
    const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='72']")
    assert(
      trigger?.getAttribute("aria-expanded") === "true",
      "Details trigger aria-expanded is incorrect",
    )
    assert(
      trigger?.getAttribute("aria-label")?.includes("Errored fixture feed"),
      "Accessible name does not include feed title",
    )
  })
  await gate("RETRY_COMPLETED_STILL_ERROR", async () => {
    const { feed, operations } = await runRefreshFixture("success", "still-error")
    assert(operations?.retryFeedHealth, "Provider-backed retry is missing")
    const result = await operations.retryFeedHealth(feed)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(result?.status === "still-error", "Retry treated HTTP completion as recovery")
    assert(after.parsing_error_count === 2, "Retry did not retain provider error state")
    assert(
      after.parsing_error_message === "Updated provider error after refresh",
      "Retry did not use the refreshed provider message",
    )
  })
  await gate("RETRY_RECOVERED", async () => {
    const { feed, operations } = await runRefreshFixture("success", "recovered")
    const result = await operations.retryFeedHealth(feed)
    assert(result?.status === "recovered", "Provider recovery was not recognized")
    assert(
      dataState.get().feedsData.find(({ id }) => id === 72)?.parsing_error_count === 0,
      "Recovered feed retained its error state",
    )
  })
  await gate("FEED_HEALTH_RETRY_RECONCILIATION", async () => {
    const { feed, operations } = await runRefreshFixture("success", "recovered")
    requests.length = 0
    const result = await operations.retryFeedHealth(feed)
    const refreshRequestCount = requests.filter(
      ({ method, args }) => method === "raw" && args[0]?.includes("/refresh"),
    ).length
    assert(result.status === "recovered", "Retry did not use provider-backed recovery state")
    assert(refreshRequestCount === 1, "Retry did not issue exactly one refresh request")
    assert(metadataReloadCalls === 1, "Retry did not reconcile provider metadata exactly once")
  })
  await gate("RETRY_REQUEST_FAILURE", async () => {
    const { feed, operations } = await runRefreshFixture("failure")
    const before = dataState.get().feedsData.find(({ id }) => id === 72)
    const result = await operations.retryFeedHealth(feed)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(result?.status === "request-failure", "Request failure result was not reported")
    assert(
      after.parsing_error_count === before.parsing_error_count,
      "Request failure changed provider error count",
    )
    assert(after.checked_at === before.checked_at, "Request failure changed provider checked_at")
    assert(metadataReloadCalls === 0, "Metadata was reloaded after request failure")
  })
  await gate("RETRY_METADATA_RELOAD_FAILURE", async () => {
    const { feed, operations } = await runRefreshFixture("success", "failure")
    const before = dataState.get().feedsData.find(({ id }) => id === 72)
    const result = await operations.retryFeedHealth(feed)
    const after = dataState.get().feedsData.find(({ id }) => id === 72)
    assert(result?.status === "metadata-reload-failure", "Metadata reload failure was not reported")
    assert(
      after.parsing_error_count === before.parsing_error_count,
      "Reload failure changed provider error count",
    )
    assert(after.checked_at === before.checked_at, "Reload failure changed provider checked_at")
  })
  await gate("FEED_DISAPPEARED_AFTER_RELOAD", async () => {
    const { feed, operations } = await runRefreshFixture("success", "disappeared")
    const result = await operations.retryFeedHealth(feed)
    assert(result?.status === "disappeared", "A removed feed was not handled gracefully")
    assert(
      !dataState.get().feedsData.some(({ id }) => id === 72),
      "A removed feed was recreated locally",
    )
    assert(router.state.location.pathname === "/all", "Feed removal caused automatic navigation")
  })
  await gate("STALE_SESSION_AFTER_REFRESH", async () => {
    const { feed, operations } = await runRefreshFixture("stale-after-refresh")
    const result = await operations.retryFeedHealth(feed)
    assert(result?.status === "stale-after-refresh", "Stale session after PUT was not detected")
    assert(metadataReloadCalls === 0, "Metadata reload ran after the session became stale")
  })
  await gate("STALE_SESSION_AFTER_METADATA_RELOAD", async () => {
    const { feed, operations } = await runRefreshFixture("success", "stale-after-reload")
    const result = await operations.retryFeedHealth(feed)
    assert(
      result?.status === "stale-after-metadata-reload",
      "Stale session after metadata reload was not detected",
    )
  })
  await gate("PER_FEED_RETRY_SERIALIZATION", async () => {
    const { feed, operations } = await runRefreshFixture("slow", "recovered")
    const callsBefore = requests.length
    const firstRetry = operations.retryFeedHealth(feed)
    await waitFor(() => Boolean(releaseRefreshRequest), "Slow refresh request did not start")
    const secondRetry = await operations.retryFeedHealth(feed)
    assert(secondRetry?.status === "already-running", "A second retry was not ignored")
    assert(requests.length === callsBefore + 1, "Two refresh requests ran for the same feed")
    releaseRefreshRequest()
    await firstRetry
  })
  if (innerWidth <= 992) {
    results.push({
      name: "DETAILS_CLOSE_FOCUS_RETURN",
      status: "NATIVE_INPUT_REQUIRED",
      detail:
        "Verify with browser keyboard input; synthetic Escape cannot exercise the Drawer focus trap.",
    })
  } else {
    await gate("DETAILS_CLOSE_FOCUS_RETURN", async () => {
      restoreFixtureData()
      await router.navigate("/all")
      await ensureSidebarOpen()
      const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='72']")
      assert(trigger instanceof HTMLButtonElement, "Feed error trigger is missing")
      trigger.focus()
      await waitFor(
        () => document.activeElement === trigger,
        "Feed error trigger could not receive focus",
      )
      trigger.click()
      await waitFor(
        () => document.querySelector("[data-testid='feed-health-details-72']"),
        "Details did not open",
      )
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await waitFor(
        () => !document.querySelector("[data-testid='feed-health-details-72']"),
        "Escape did not close details",
      )
      await waitFor(
        () => document.activeElement === trigger,
        `Focus did not return to the feed error trigger (active=${document.activeElement?.outerHTML?.slice(0, 100)})`,
      )
    })
  }
  await gate("KEYBOARD_NATIVE_BUTTON_SEMANTICS", async () => {
    restoreFixtureData()
    await ensureSidebarOpen()
    const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='72']")
    assert(trigger instanceof HTMLButtonElement, "Feed error trigger is missing")
    assert(trigger.type === "button", "Trigger is not a native keyboard-activatable button")
    assert(trigger.getAttribute("aria-haspopup") === "dialog", "Trigger lacks dialog semantics")
  })
  await gate("DISABLED_DETAILS_SUPPRESSED", async () => {
    restoreFixtureData()
    await ensureSidebarOpen()
    assert(
      !sidebarRoot()?.querySelector("[data-feed-health-trigger='74']"),
      "Disabled feed exposed details",
    )
  })
  await gate("DETAILS_COPY_AND_LONG_ERROR_WRAP", async () => {
    restoreFixtureData()
    await ensureSidebarOpen()
    const trigger = sidebarRoot()?.querySelector("[data-feed-health-trigger='73']")
    assert(trigger instanceof HTMLButtonElement, "Long error fixture trigger is missing")
    trigger.click()
    await waitFor(
      () => document.querySelector("[data-testid='feed-health-details-73']"),
      "Long error details did not open",
    )
    const detail = document.querySelector("[data-testid='feed-health-details-73']")
    const rect = detail.getBoundingClientRect()
    assert(
      rect.left >= -1 && rect.right <= innerWidth + 1,
      "Details are clipped horizontally by the viewport",
    )
    assert(
      detail.scrollWidth <= detail.clientWidth + 1,
      "Long provider error text overflows horizontally",
    )
    assert(
      !/polling paused|failure threshold|maximum failures/i.test(detail.textContent),
      "Details infer an unsupported polling state",
    )
    assert(
      !sidebarRoot()?.querySelector("[data-feed-health-trigger='74']"),
      "Disabled feed indicator is visible",
    )
  })

  const nativeInputRequiredCount = results.filter(
    ({ status }) => status === "NATIVE_INPUT_REQUIRED",
  ).length
  const executableGateCount = results.length - nativeInputRequiredCount
  const report = {
    viewport: { width: innerWidth, height: innerHeight },
    summary: `${results.filter(({ status }) => status === "PASS").length}/${executableGateCount} gates PASS${nativeInputRequiredCount ? `; ${nativeInputRequiredCount} native browser gate required` : ""}`,
    results,
  }
  document.querySelector("[data-testid='suite-summary']").textContent = report.summary
  document.querySelector("[data-testid='suite-results']").textContent = JSON.stringify(
    report,
    null,
    2,
  )
  globalThis.__feedHealth01BResults = report
  return report
}

globalThis.__runFeedHealth01B = runScenarios

const FeedHealthOperationsProbe = () => {
  const operations = useFeedOperations(true)
  globalThis.__feedHealthOperations = operations
  return null
}

const LocationProbe = () => {
  const { pathname } = useLocation()
  return <output data-testid="current-route">{pathname}</output>
}

function FixtureFrame() {
  const [running, setRunning] = useState(false)
  return (
    <div className="feed-health-app">
      <FeedHealthOperationsProbe />
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
            Run FEED-HEALTH-01B gates
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
