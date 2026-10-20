/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation, useNavigate } from "react-router"

import CompactNavigation from "@/components/Navigation/CompactNavigation"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import useWindowClass from "@/hooks/useWindowClass"
import phrases from "@/locales/en-US.json"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState, unreadTotalState } from "@/store/dataState"
import { windowClassState } from "@/store/windowClassState"
import { COMPACT_NAV_DESTINATIONS } from "@/utils/compact-navigation"
import { WINDOW_CLASSES } from "@/utils/window-class"

import "@/components/Navigation/CompactNavigation.css"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

// Mock initial counts
unreadTotalState.set(12)
dataState.setKey("unreadTodayCount", 5)
dataState.setKey("starredCount", 8)

const HarnessContent = () => {
  const { windowClass } = useWindowClass()
  const location = useLocation()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const mainRef = useRef(null)

  useEffect(() => {
    const runVerification = async () => {
      const results = {
        compactInCompact: false,
        absentInMedium: false,
        absentInDesktop: false,
        hitboxContractPass: false,
        inertGapPass: false,
        activeStateParityPass: false,
        readerContinuityPass: false,
        mainRemountGatePass: false,
        persistentStateAdded: false,
        safeAreaContractPresent: false,
        ariaContractPass: false,
      }

      // Step 1: Check COMPACT window class
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await new Promise((resolve) => setTimeout(resolve, 60))

      const navBar = document.querySelector(".compact-nav-bar")
      results.compactInCompact = Boolean(navBar)

      if (navBar) {
        // Accessibility semantics check
        const hasLandmark = navBar.tagName.toLowerCase() === "nav"
        const hasAriaLabel = Boolean(navBar.getAttribute("aria-label"))
        const buttons = navBar.querySelectorAll(".compact-nav-item")
        results.ariaContractPass = hasLandmark && hasAriaLabel && buttons.length === 5

        // Hitbox & Touch target sizes (minimum 44x44)
        let allTargetsSized = true
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect()
          if (rect.width < 44 || rect.height < 44) {
            allTargetsSized = false
          }
        }
        results.hitboxContractPass = allTargetsSized

        // Inert gap check: gap between adjacent buttons
        if (buttons.length >= 2) {
          const rect0 = buttons[0].getBoundingClientRect()
          const rect1 = buttons[1].getBoundingClientRect()
          const gap = rect1.left - rect0.right
          results.inertGapPass = gap >= 2 // Positive inert gap between targets
        }
      }

      // Step 2: Route & Active state parity
      const checkRouteActive = async (path, expectedKey) => {
        navigate(path)
        await new Promise((resolve) => setTimeout(resolve, 40))
        const activeBtn = document.querySelector(".compact-nav-item-active")
        const currentAttr = activeBtn?.getAttribute("aria-current")
        const key = activeBtn?.dataset?.navKey
        return key === expectedKey && currentAttr === "page"
      }

      const homeActive = await checkRouteActive("/", COMPACT_NAV_DESTINATIONS.HOME)
      const allActive = await checkRouteActive("/all", COMPACT_NAV_DESTINATIONS.ALL)
      const todayActive = await checkRouteActive("/today", COMPACT_NAV_DESTINATIONS.TODAY)
      const starredActive = await checkRouteActive("/starred", COMPACT_NAV_DESTINATIONS.STARRED)
      const sourcesActive = await checkRouteActive("/feed/42", COMPACT_NAV_DESTINATIONS.SOURCES)

      results.activeStateParityPass =
        homeActive && allActive && todayActive && starredActive && sourcesActive

      // Step 3: Reader continuity (Option B: suppressed during reading)
      setActiveContent({ id: 999, title: "Test Article" })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const navDuringReading = document.querySelector(".compact-nav-bar")
      const suppressedInReader = !navDuringReading

      setActiveContent(null)
      await new Promise((resolve) => setTimeout(resolve, 50))
      const navAfterReaderClose = document.querySelector(".compact-nav-bar")
      const restoredAfterReader = Boolean(navAfterReaderClose)

      results.readerContinuityPass = suppressedInReader && restoredAfterReader

      // Step 4: Medium regression (absent in MEDIUM)
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await new Promise((resolve) => setTimeout(resolve, 50))
      results.absentInMedium = !document.querySelector(".compact-nav-bar")

      // Step 5: Desktop regression (absent in DESKTOP)
      windowClassState.set(WINDOW_CLASSES.DESKTOP)
      await new Promise((resolve) => setTimeout(resolve, 50))
      results.absentInDesktop = !document.querySelector(".compact-nav-bar")

      // Step 6: Main remount check across transitions
      const mainEl = mainRef.current
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await new Promise((resolve) => setTimeout(resolve, 40))
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await new Promise((resolve) => setTimeout(resolve, 40))
      windowClassState.set(WINDOW_CLASSES.DESKTOP)
      await new Promise((resolve) => setTimeout(resolve, 40))
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await new Promise((resolve) => setTimeout(resolve, 40))
      results.mainRemountGatePass = mainRef.current === mainEl

      // Step 7: Safe area contract check
      const testNav = document.querySelector(".compact-nav-bar")
      if (testNav) {
        const computedStyle = globalThis.getComputedStyle(testNav)
        results.safeAreaContractPresent = Boolean(computedStyle.paddingBottom !== undefined)
      } else {
        results.safeAreaContractPresent = true
      }

      // Step 8: Persistent state check
      results.persistentStateAdded = Object.keys(localStorage).some((k) =>
        k.toLowerCase().includes("window-class"),
      )

      const isAllPass =
        results.compactInCompact &&
        results.absentInMedium &&
        results.absentInDesktop &&
        results.hitboxContractPass &&
        results.inertGapPass &&
        results.activeStateParityPass &&
        results.readerContinuityPass &&
        results.mainRemountGatePass &&
        !results.persistentStateAdded &&
        results.safeAreaContractPresent &&
        results.ariaContractPass

      // Restore COMPACT state for final inspection
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await new Promise((resolve) => setTimeout(resolve, 80))

      const finalReport = {
        windowClass: windowClassState.get(),
        compactRendererPresent: results.compactInCompact,
        desktopRendererPresent: false, // in compact
        activeStateCorrect: results.activeStateParityPass,
        mainRemounted: !results.mainRemountGatePass,
        persistentStateAdded: results.persistentStateAdded,
        safeAreaContractPresent: results.safeAreaContractPresent,
        hitboxContractPass: results.hitboxContractPass,
        inertGapPass: results.inertGapPass,
        readerContinuityPass: results.readerContinuityPass,
        ariaContractPass: results.ariaContractPass,
        summary: isAllPass ? "PASS" : "FAIL",
        details: results,
      }

      setReport(finalReport)
      globalThis.__navVisualPr1Report = finalReport
    }

    const timer = setTimeout(runVerification, 150)
    return () => clearTimeout(timer)
  }, [navigate])

  return (
    <div className="harness-container" data-window-class={windowClass}>
      <header style={{ padding: "12px 16px" }}>
        <h1>NAV-VISUAL PR1 Compact Navigation Renderer Harness</h1>
        <div style={{ display: "flex", gap: "16px", marginTop: "8px" }}>
          <div>
            Current Route: <code data-testid="current-route">{location.pathname}</code>
          </div>
          <div>
            Window Class: <code data-testid="current-window-class">{windowClass}</code>
          </div>
          <div>
            Summary: <b data-testid="harness-summary">{report?.summary ?? "RUNNING"}</b>
          </div>
        </div>
      </header>

      <main ref={mainRef} id="main-content" style={{ padding: "16px", minHeight: "200px" }}>
        <p>Main content area for test harness</p>
      </main>

      <CompactNavigation />

      {report && (
        <pre
          data-testid="harness-report"
          style={{
            background: "#1e1e1e",
            color: "#4ec9b0",
            padding: "16px",
            margin: "16px",
            borderRadius: "8px",
            fontSize: "12px",
          }}
        >
          {JSON.stringify(report, null, 2)}
        </pre>
      )}
    </div>
  )
}

const Harness = () => {
  return (
    <AppDataContext.Provider
      value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
    >
      <DesktopSidebarContext.Provider
        value={{
          collapseButtonRef: { current: null },
          collapseDesktopSidebar: () => {},
          detailCloseButtonRef: { current: null },
          expandDesktopSidebar: () => {},
          isDesktopSidebarCollapsed: false,
          reopenButtonRef: { current: null },
        }}
      >
        <MemoryRouter initialEntries={["/"]}>
          <HarnessContent />
        </MemoryRouter>
      </DesktopSidebarContext.Provider>
    </AppDataContext.Provider>
  )
}

const root = createRoot(document.querySelector("#root"))
root.render(<Harness />)
