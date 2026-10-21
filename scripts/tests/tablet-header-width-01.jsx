/* eslint-disable react-refresh/only-export-components -- Browser regression harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"

import Content from "@/components/Content/Content"
import { ContextProvider } from "@/components/Content/ContentContext"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import phrases from "@/locales/en-US.json"
import { getDefaultSettings, settingsState } from "@/store/settingsState"

settingsState.set({ ...getDefaultSettings(), articleListLayout: "column" })
polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

const Harness = () => {
  const [report, setReport] = useState({ status: "WAITING" })
  const getEntries = useCallback(async () => ({ entries: [], total: 0 }), [])
  const desktopSidebar = {
    detailCloseButtonRef: { current: null },
    expandDesktopSidebar: () => {},
    isDesktopSidebarCollapsed: false,
    reopenButtonRef: { current: null },
  }

  useEffect(() => {
    let active = true
    const measure = () => {
      const header = document.querySelector(".search-and-sort-bar")
      const content = document.querySelector(".entry-col")
      if (!header || !content) {
        return false
      }
      const headerRect = header.getBoundingClientRect()
      const contentRect = content.getBoundingClientRect()
      const measured = {
        viewport: `${innerWidth}x${innerHeight}`,
        headerWidth: headerRect.width,
        contentWidth: contentRect.width,
        headerLeft: headerRect.left,
        contentLeft: contentRect.left,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        status:
          headerRect.width >= contentRect.width - 1 &&
          document.documentElement.scrollWidth <= document.documentElement.clientWidth
            ? "PASS"
            : "FAIL",
      }
      if (active) {
        setReport(measured)
      }
      return true
    }
    const frame = requestAnimationFrame(() => {
      if (!measure()) {
        globalThis.setTimeout(measure, 100)
      }
    })
    return () => {
      active = false
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <AppDataContext.Provider
      value={{ refreshCounts: async () => ({}), refreshFeedData: async () => ({}) }}
    >
      <MemoryRouter initialEntries={["/all"]}>
        <DesktopSidebarContext.Provider value={desktopSidebar}>
          <ContextProvider>
            <div style={{ width: "100%", height: "100%", display: "flex" }}>
              <Content getEntries={getEntries} info={{ from: "all", id: "" }} />
            </div>
          </ContextProvider>
        </DesktopSidebarContext.Provider>
      </MemoryRouter>
      <output data-testid="header-width-report">{JSON.stringify(report)}</output>
    </AppDataContext.Provider>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
