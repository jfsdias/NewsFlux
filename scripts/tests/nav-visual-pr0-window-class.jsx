/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router"

import Main from "@/components/Main/Main"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import useWindowClass from "@/hooks/useWindowClass"
import phrases from "@/locales/en-US.json"
import { windowClassState } from "@/store/windowClassState"
import { classifyWindowClass, WINDOW_CLASSES } from "@/utils/window-class"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

const BOUNDARY_MATRIX = [
  { width: 599, height: 480, expected: WINDOW_CLASSES.COMPACT },
  { width: 599, height: 479, expected: WINDOW_CLASSES.MEDIUM },
  { width: 600, height: 480, expected: WINDOW_CLASSES.MEDIUM },
  { width: 992, height: 1104, expected: WINDOW_CLASSES.MEDIUM },
  { width: 993, height: 1104, expected: WINDOW_CLASSES.DESKTOP },
  { width: 884, height: 1104, expected: WINDOW_CLASSES.MEDIUM },
  { width: 390, height: 844, expected: WINDOW_CLASSES.COMPACT },
  { width: 390, height: 400, expected: WINDOW_CLASSES.MEDIUM },
  { width: 768, height: 1024, expected: WINDOW_CLASSES.MEDIUM },
  { width: 900, height: 900, expected: WINDOW_CLASSES.MEDIUM },
  { width: 1280, height: 800, expected: WINDOW_CLASSES.DESKTOP },
]

const RemountProbe = ({ onMountCount }) => {
  useEffect(() => {
    onMountCount()
  }, [onMountCount])
  return <div data-testid="remount-probe" />
}

const Harness = () => {
  const { windowClass } = useWindowClass()
  const [mountCount, setMountCount] = useState(0)
  const [report, setReport] = useState(null)
  const mainRef = useRef(null)

  const handleMountCount = React.useCallback(() => {
    setMountCount((previous) => previous + 1)
  }, [])

  useEffect(() => {
    // Run automated verification suite
    const runVerification = async () => {
      // 1. Classification boundary gates
      const classificationResults = BOUNDARY_MATRIX.map(({ width, height, expected }) => {
        const actual = classifyWindowClass({ width, height })
        return {
          case: `${width}x${height}`,
          expected,
          actual,
          pass: actual === expected,
        }
      })
      const classificationAllPass = classificationResults.every((item) => item.pass)

      // 2. Main remount gate: Verify transitioning windowClass does NOT remount Main
      const mainElementBefore = document.querySelector("#main-content")

      // Transition through all classes
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await new Promise((resolve) => setTimeout(resolve, 50))
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await new Promise((resolve) => setTimeout(resolve, 50))
      windowClassState.set(WINDOW_CLASSES.DESKTOP)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const mainElementAfter = document.querySelector("#main-content")
      const mainRemounted = mainElementBefore !== mainElementAfter

      // 3. No visible nav renderers introduced
      const hasBottomBar = Boolean(
        document.querySelector(".nav-bottom-bar, .compact-bottom-bar, [data-testid='bottom-bar']"),
      )
      const hasMediumRail = Boolean(
        document.querySelector(".nav-rail, .medium-rail, [data-testid='medium-rail']"),
      )

      // 4. No persistent state added in storage
      const hasStorageKey = Object.keys(localStorage).some((key) =>
        key.toLowerCase().includes("window-class"),
      )

      const finalReport = {
        classificationAllPass,
        classificationResults,
        mainRemounted,
        mainRemountGatePass: !mainRemounted,
        hasBottomBar,
        hasMediumRail,
        visibleNavChange: hasBottomBar || hasMediumRail,
        persistentStateAdded: hasStorageKey,
        summary:
          classificationAllPass && !mainRemounted && !hasBottomBar && !hasMediumRail
            ? "PASS"
            : "FAIL",
      }

      setReport(finalReport)
      globalThis.__pr0Report = finalReport
    }

    const timer = setTimeout(runVerification, 100)
    return () => clearTimeout(timer)
  }, [])

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
        <div className="harness-container">
          <header>
            <h1>NAV-VISUAL PR0 Window Class Foundation Harness</h1>
            <output data-testid="current-window-class">{windowClass}</output>
            <output data-testid="harness-summary">{report?.summary ?? "RUNNING"}</output>
          </header>
          <div ref={mainRef}>
            <RemountProbe onMountCount={handleMountCount} />
            <Main />
          </div>
          {report && <pre data-testid="harness-report">{JSON.stringify(report, null, 2)}</pre>}
        </div>
      </DesktopSidebarContext.Provider>
    </AppDataContext.Provider>
  )
}

const root = createRoot(document.querySelector("#root"))
root.render(
  <MemoryRouter initialEntries={["/"]}>
    <Routes>
      <Route element={<Harness />} path="/*" />
    </Routes>
  </MemoryRouter>,
)
