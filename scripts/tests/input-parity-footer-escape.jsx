/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"

import FooterPanel from "@/components/Content/FooterPanel"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings } from "@/store/settingsState"

const category = { id: 1, title: "Fixture category", hide_globally: false }
const feed = {
  id: 1,
  title: "Keyboard fixture feed",
  category,
  hide_globally: false,
  site_url: "https://example.invalid/feed",
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
replaceSettings({ ...getDefaultSettings(), showStatus: "unread" })
dataState.set({
  ...dataState.get(),
  feedsData: [feed],
  categoriesData: [category],
  unreadInfo: { 1: 1 },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})
contentState.set({
  ...contentState.get(),
  entries: [{ id: 1, feed, status: "unread", starred: false }],
  infoFrom: "feed",
  infoId: 1,
  isArticleListReady: true,
})

const waitFor = (predicate, description) =>
  new Promise((resolve, reject) => {
    if (predicate()) {
      resolve()
      return
    }

    const observer = new MutationObserver(() => {
      if (!predicate()) {
        return
      }

      globalThis.clearTimeout(timeoutId)
      observer.disconnect()
      resolve()
    })
    observer.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
    })

    const timeoutId = globalThis.setTimeout(() => {
      observer.disconnect()
      reject(new Error(`Timed out waiting for ${description}`))
    }, 5000)
  })

const pressEscape = (target) => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "Escape",
      key: "Escape",
      keyCode: 27,
      which: 27,
    }),
  )
}

const Harness = () => {
  const [summary, setSummary] = useState("RUNNING")
  const [detail, setDetail] = useState("Waiting for the FooterPanel menu")

  useEffect(() => {
    const run = async () => {
      try {
        const trigger = document.querySelector(
          'button[aria-haspopup="menu"][aria-label="Mark older articles as read"]',
        )
        if (!trigger) {
          throw new Error("Mark older articles trigger was not mounted")
        }

        const isMenuOpen = () => trigger.getAttribute("aria-expanded") === "true"

        trigger.focus()
        trigger.click()
        await waitFor(isMenuOpen, "Mark older articles menu to open")

        trigger.blur()
        if (document.activeElement === trigger) {
          throw new Error("Harness setup failed to move focus away from the trigger")
        }

        pressEscape(document.activeElement || document.body)
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

        const expanded = isMenuOpen()
        const focused = document.activeElement === trigger
        if (expanded || !focused) {
          throw new Error(
            `Escape should close the menu and return focus after focus moved away (expanded=${expanded}, focused=${focused})`,
          )
        }

        setDetail("Escape closed the menu and restored focus to the trigger")
        setSummary("PASS")
      } catch (error) {
        setDetail(error.message)
        setSummary("FAIL")
      }
    }

    run()
  }, [])

  return (
    <main>
      <output data-testid="suite-summary">{summary}</output>
      <output data-testid="suite-results">{detail}</output>
      <AppDataContext.Provider value={{ refreshCounts: async () => ({}) }}>
        <MemoryRouter initialEntries={["/feed/1"]}>
          <FooterPanel
            getEntries={async () => ({ entries: [] })}
            info={{ from: "feed", id: 1 }}
            refreshArticleList={async () => {}}
          />
        </MemoryRouter>
      </AppDataContext.Provider>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
