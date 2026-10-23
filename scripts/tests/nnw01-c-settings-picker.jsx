/* eslint-disable react-refresh/only-export-components -- This file is a browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import { Button, ConfigProvider } from "@arco-design/web-react"
import enUS from "@arco-design/web-react/es/locale/en-US"
import Polyglot from "node-polyglot"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import apiClient from "@/apis/ofetch"
import HomePagePicker from "@/components/Settings/HomePagePicker"
import AppDataContext from "@/contexts/app-data-context"
import { polyglotState } from "@/hooks/useLanguage"
import englishPhrases from "@/locales/en-US.json"
import { authState } from "@/store/authState"
import { commitCatalogData, commitIdentityData, resetData, setUnreadInfo } from "@/store/dataState"
import { feedIconsState } from "@/store/feedIconsState"
import { getCurrentHomeTarget, setCurrentHomeTarget } from "@/store/homePageState"
import { getDefaultSettings, settingsState } from "@/store/settingsState"
import { createEntityHomeTarget } from "@/utils/home-page"
import "@arco-design/web-react/dist/css/arco.css"
import "@/index.css"
import "@/theme.css"
import "./nnw01-c-settings-picker.css"

const category = { id: 971, title: "Source Identity Fixtures", hide_globally: false }
const makeFeed = (id, title, iconId, options = {}) => ({
  id,
  title,
  category,
  icon: { icon_id: iconId },
  site_url: `https://source-${id}.example.test/`,
  feed_url: `https://source-${id}.example.test/rss`,
  hide_globally: false,
  ...options,
})

const feeds = [
  makeFeed(971, "Provider Square", 1971),
  makeFeed(972, "Provider Wide", 1972),
  makeFeed(973, "Monogram Source", 0),
  makeFeed(974, "", 0, { site_url: "not a URL", feed_url: "javascript:invalid" }),
  makeFeed(975, "Hidden Current Source", 1975, { hide_globally: true }),
]
const imageData = (width, height, color) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`)}`

const iconRequests = []
const providerWrites = []
apiClient.get = async (...args) => {
  iconRequests.push(args)
  throw new Error("Unexpected API request in Settings selector fixture")
}
for (const method of ["post", "put", "raw", "delete"]) {
  apiClient[method] = async (...args) => {
    providerWrites.push({ method, args })
    throw new Error(`Unexpected ${method.toUpperCase()} in Settings selector fixture`)
  }
}

authState.set({ server: "http://127.0.0.1:4174", token: "fixture", username: "fixture" })
polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
settingsState.set({ ...getDefaultSettings(), showFeedIcon: true })
resetData()
commitIdentityData({ id: 1, username: "fixture" })
commitCatalogData({ feedsData: feeds, categoriesData: [category] })
setUnreadInfo({ 971: 0, 972: 0, 973: 0, 974: 0, 975: 0 })
feedIconsState.set({
  0: { url: null, width: null, height: null },
  1971: { url: imageData(64, 64, "#111111"), width: 64, height: 64 },
  1972: { url: imageData(64, 24, "#ffffff"), width: 64, height: 24 },
  1975: { url: imageData(64, 64, "#335577"), width: 64, height: 64 },
})
setCurrentHomeTarget(createEntityHomeTarget("feed", 975))

const appData = {
  refreshCounts: async () => ({ error: null }),
  refreshFeedData: async () => {},
}

const wait = (duration = 50) => new Promise((resolve) => setTimeout(resolve, duration))
const waitFor = async (predicate, timeoutMs = 4000) => {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (predicate()) {
      return true
    }
    await wait()
  }
  return predicate()
}

const makeResult = (name, pass, detail = "") => ({
  name,
  result: pass ? "PASS" : "FAIL",
  detail,
})

const runGates = async () => {
  const results = []
  const gate = (name, pass, detail = "") => results.push(makeResult(name, pass, detail))
  const modalEntered = await waitFor(() =>
    document.querySelector(".home-page-picker-modal")?.classList.contains("zoomModal-enter-done"),
  )
  gate("MODAL_ENTERED", modalEntered)
  const categoryToggle = document.querySelector(
    '.home-page-picker-modal [aria-controls="home-page-category-971-feeds"]',
  )
  if (categoryToggle?.getAttribute("aria-expanded") !== "true") {
    categoryToggle?.click()
  }
  await waitFor(() => document.querySelector('[data-home-target="feed:971"] .source-mark'))

  const row = (id) => document.querySelector(`[data-home-target="feed:${CSS.escape(String(id))}"]`)
  const mark = (id) => row(id)?.querySelector(".source-mark")
  const sourceImg = (id) => mark(id)?.querySelector("img")
  const providerLoaded = await waitFor(() => sourceImg(971)?.complete && sourceImg(972)?.complete)
  await waitFor(() => mark(971)?.dataset.sourceMarkPlate !== "neutral")

  gate("PROVIDER_ICON", providerLoaded && mark(971)?.dataset.sourceMarkFallback === "provider")
  gate(
    "NON_SQUARE_PROVIDER",
    sourceImg(972)?.naturalWidth === 64 &&
      sourceImg(972)?.naturalHeight === 24 &&
      getComputedStyle(sourceImg(972)).objectFit === "contain",
  )
  gate("MONOGRAM", mark(973)?.dataset.sourceMarkFallback === "monogram")
  gate("RSS_FALLBACK", mark(974)?.dataset.sourceMarkFallback === "rss")
  gate(
    "SOURCE_MARK_SIZE",
    [...document.querySelectorAll(".source-mark")].every(
      (element) => element.style.getPropertyValue("--source-mark-size") === "16px",
    ),
  )
  gate(
    "SOURCE_MARK_DECORATIVE",
    [...document.querySelectorAll(".source-mark")].every(
      (element) => element.getAttribute("aria-hidden") === "true",
    ),
  )

  const targetRow = row(975)
  const check = targetRow?.querySelector(".home-page-target-check")
  const hiddenBadge = targetRow?.querySelector(".home-page-hidden-tag")
  const checkRect = check?.getBoundingClientRect()
  const badgeRect = hiddenBadge?.getBoundingClientRect()
  gate(
    "TARGET_CHECK_NO_COLLISION",
    Boolean(checkRect && badgeRect && checkRect.left >= badgeRect.right),
  )
  gate(
    "HIDDEN_BADGE_VISIBLE",
    Boolean(hiddenBadge && getComputedStyle(hiddenBadge).visibility !== "hidden"),
  )

  const feedList = document.querySelector(".home-page-feed-list")
  const categoryButton = document.querySelector('[data-home-target="category:971"]')
  const feedListRect = feedList?.getBoundingClientRect()
  const categoryRect = categoryButton?.getBoundingClientRect()
  const feedListStyle = feedList ? getComputedStyle(feedList) : null
  gate(
    "CATEGORY_INDENTATION",
    Boolean(
      feedListRect &&
      categoryRect &&
      feedListRect.left > categoryRect.left &&
      feedListStyle?.marginLeft === "24px" &&
      feedListStyle?.paddingLeft === "8px",
    ),
  )

  const buttons = [...document.querySelectorAll(".home-page-picker-modal .home-page-target")]
  const rowHeights = buttons.map((button) => button.getBoundingClientRect().height)
  const minRowHeight = innerWidth <= 768 ? 44 : 38
  gate(
    "ROW_HEIGHT",
    rowHeights.length > 0 && rowHeights.every((height) => height >= minRowHeight - 0.5),
    `minimum=${Math.min(...rowHeights).toFixed(2)}px; expected>=${minRowHeight}px`,
  )
  const modalRect = document.querySelector(".home-page-picker-modal")?.getBoundingClientRect()
  gate(
    "MODAL_FITS_VIEWPORT",
    Boolean(
      modalRect &&
      modalRect.left >= -0.5 &&
      modalRect.right <= innerWidth + 0.5 &&
      modalRect.top >= -0.5 &&
      modalRect.bottom <= innerHeight + 0.5,
    ),
    modalRect
      ? `x=${modalRect.left.toFixed(2)}..${modalRect.right.toFixed(2)}; y=${modalRect.top.toFixed(2)}..${modalRect.bottom.toFixed(2)}; viewport=${innerWidth}x${innerHeight}`
      : "modal not mounted",
  )
  gate(
    "NO_CLIPPING_OR_HORIZONTAL_OVERFLOW",
    [...document.querySelectorAll(".home-page-picker-modal .home-page-target")].every((button) => {
      const buttonRect = button.getBoundingClientRect()
      return buttonRect.width > 0 && button.scrollWidth <= button.clientWidth
    }) && document.documentElement.scrollWidth <= innerWidth,
  )

  const focusTarget = row(972)
  focusTarget?.focus()
  const focusStyle = focusTarget ? getComputedStyle(focusTarget) : null
  gate(
    "KEYBOARD_FOCUS_VISIBLE",
    Boolean(
      focusTarget === document.activeElement &&
      focusStyle &&
      focusStyle.outlineStyle !== "none" &&
      focusStyle.outlineWidth !== "0px",
    ),
  )

  const requestCountBeforeOff = iconRequests.length
  settingsState.set({ ...settingsState.get(), showFeedIcon: false })
  await wait()
  gate(
    "SHOW_FEED_ICON_OFF_GENERIC_RSS",
    [...document.querySelectorAll('.home-page-picker-modal [data-home-target^="feed:"]')].every(
      (button) =>
        !button.querySelector(".source-mark") && button.querySelector("svg.home-page-target-icon"),
    ),
  )
  gate("SHOW_FEED_ICON_OFF_NO_PROVIDER_REQUEST", iconRequests.length === requestCountBeforeOff)
  const offHeights = [
    ...document.querySelectorAll(".home-page-picker-modal .home-page-target"),
  ].map((button) => button.getBoundingClientRect().height)
  gate(
    "ICON_TOGGLE_ROW_HEIGHT_STABLE",
    offHeights.length === rowHeights.length &&
      offHeights.every((height, index) => Math.abs(height - rowHeights[index]) < 0.5),
    `maxDelta=${Math.max(...offHeights.map((height, index) => Math.abs(height - rowHeights[index]))).toFixed(2)}px`,
  )

  gate("NO_PROVIDER_WRITES", providerWrites.length === 0)
  gate(
    "NO_THIRD_PARTY_FAVICON_REQUESTS",
    performance
      .getEntriesByType("resource")
      .every(({ name }) => !/duckduckgo|faviconkit|google.*favicon|iconhorse/i.test(name)),
  )
  gate(
    "NO_WRONG_FEED_ID_ICON_REQUESTS",
    iconRequests.every((args) => ![971, 972, 973, 974, 975].includes(args[0])),
  )

  globalThis.__nnw01cSettingsResults = results
  document.querySelector("#nnw01-c-settings-picker-report").textContent = JSON.stringify(
    results,
    null,
    2,
  )
  return results
}

const SettingsPickerHarness = () => {
  const [visible, setVisible] = useState(true)
  const [theme, setTheme] = useState("light")
  const [selectionResult, setSelectionResult] = useState("NOT_RUN")
  const setThemeMode = (value) => {
    setTheme(value)
    document.body.setAttribute("arco-theme", value)
    document.documentElement.dataset.theme = value
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("autorun") !== "1") {
      return
    }
    void runGates().catch((error) => {
      const failure = [
        { name: "SETTINGS_SELECTOR_BROWSER_GATE", result: "FAIL", detail: error.message },
      ]
      globalThis.__nnw01cSettingsResults = failure
      document.querySelector("#nnw01-c-settings-picker-report").textContent = JSON.stringify(
        failure,
        null,
        2,
      )
    })
  }, [])

  return (
    <ConfigProvider locale={enUS}>
      <AppDataContext.Provider value={appData}>
        <main id="nnw01-c-settings-picker">
          <div className="nnw01-c-settings-picker-controls">
            <Button onClick={() => setVisible(true)}>Open selector</Button>
            <Button onClick={() => setThemeMode(theme === "light" ? "dark" : "light")}>
              Toggle theme
            </Button>
          </div>
          <pre className="nnw01-c-settings-picker-report" id="nnw01-c-settings-picker-report" />
          <output data-testid="source-selection-result">{selectionResult}</output>
          <HomePagePicker
            visible={visible}
            onClose={() => {
              setVisible(false)
              const target = getCurrentHomeTarget()
              if (target.type === "feed" && target.id === 971) {
                setSelectionResult("PASS")
              }
            }}
          />
        </main>
      </AppDataContext.Provider>
    </ConfigProvider>
  )
}

setThemeFromUrl()
function setThemeFromUrl() {
  const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"
  document.body.setAttribute("arco-theme", theme)
  document.documentElement.dataset.theme = theme
}

globalThis.__nnw01cSettings = { runGates }
createRoot(document.querySelector("#root")).render(<SettingsPickerHarness />)
