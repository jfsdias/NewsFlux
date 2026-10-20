/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import Polyglot from "node-polyglot"
import React, { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter } from "react-router"

import ActionButtons from "@/components/Article/ActionButtons"
import SearchAndSortBar from "@/components/Article/SearchAndSortBar"
import { ContentContext } from "@/components/Content/ContentContext"
import FooterPanel from "@/components/Content/FooterPanel"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import ReaderCommandsContext from "@/contexts/reader-commands-context"
import { polyglotState } from "@/hooks/useLanguage"
import "@/App.css"
import englishPhrases from "@/locales/en-US.json"
import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { getDefaultSettings, replaceSettings } from "@/store/settingsState"
import "@/theme.css"
import "@/liquid-glass.css"

const category = { id: 1, title: "Fixture category", hide_globally: false }
const feed = {
  id: 1,
  title: "Touch target fixture feed",
  category,
  hide_globally: false,
  site_url: "https://example.invalid/feed",
}
const activeEntry = {
  id: 1,
  title: "Touch target reader fixture",
  content: '<h2 id="fixture-heading">Fixture section</h2><p>Fixture content.</p>',
  headings: [{ id: "fixture-heading", level: 2, text: "Fixture section" }],
  comments_url: "",
  feed,
  status: "unread",
  starred: false,
}

polyglotState.setKey("polyglot", new Polyglot({ phrases: englishPhrases, locale: "en-US" }))
replaceSettings({ ...getDefaultSettings(), showStatus: "unread", enableSwipeGesture: true })
dataState.set({
  ...dataState.get(),
  feedsData: [feed],
  categoriesData: [category],
  hasIntegrations: true,
  unreadInfo: { 1: 1 },
  loadState: {
    ...dataState.get().loadState,
    catalog: { ...dataState.get().loadState.catalog, hasSnapshot: true },
  },
})
contentState.set({
  ...contentState.get(),
  activeContent: activeEntry,
  entries: [activeEntry],
  infoFrom: "feed",
  infoId: 1,
  isArticleListReady: true,
  total: 1,
})

const getRect = (element) => {
  if (!element) {
    return null
  }
  const { height, left, top, width } = element.getBoundingClientRect()
  const isRadio = element.matches(".arco-radio-button")
  const pseudoHost = isRadio ? element.querySelector(".arco-radio-button-inner") : element
  const pseudoStyle = getComputedStyle(pseudoHost, isRadio ? "::before" : "::after")
  const pseudoHostStyle = getComputedStyle(pseudoHost)
  const pseudoIsActive = pseudoStyle.position === "absolute" && pseudoStyle.content !== "none"
  const pseudoInsets = pseudoIsActive
    ? {
        bottom: Number.parseFloat(pseudoStyle.bottom) || 0,
        left: Number.parseFloat(pseudoStyle.left) || 0,
        right: Number.parseFloat(pseudoStyle.right) || 0,
        top: Number.parseFloat(pseudoStyle.top) || 0,
      }
    : { bottom: 0, left: 0, right: 0, top: 0 }
  const pseudoHostRect = pseudoHost.getBoundingClientRect()
  const borderLeft = Number.parseFloat(pseudoHostStyle.borderLeftWidth) || 0
  const borderTop = Number.parseFloat(pseudoHostStyle.borderTopWidth) || 0
  const pseudoWidth = Number.parseFloat(pseudoStyle.width)
  const pseudoHeight = Number.parseFloat(pseudoStyle.height)
  const hitArea = pseudoIsActive
    ? {
        height: Number.isFinite(pseudoHeight)
          ? pseudoHeight
          : pseudoHostRect.height -
            borderTop -
            (Number.parseFloat(pseudoHostStyle.borderBottomWidth) || 0) -
            pseudoInsets.top -
            pseudoInsets.bottom,
        left: pseudoHostRect.left + borderLeft + pseudoInsets.left,
        top: pseudoHostRect.top + borderTop + pseudoInsets.top,
        width: Number.isFinite(pseudoWidth)
          ? pseudoWidth
          : pseudoHostRect.width -
            borderLeft -
            (Number.parseFloat(pseudoHostStyle.borderRightWidth) || 0) -
            pseudoInsets.left -
            pseudoInsets.right,
      }
    : { height, left, top, width }
  const samplePoints = [
    [hitArea.left + 1, hitArea.top + 1],
    [hitArea.left + hitArea.width / 2, hitArea.top + 1],
    [hitArea.left + hitArea.width - 1, hitArea.top + 1],
    [hitArea.left + 1, hitArea.top + hitArea.height / 2],
    [hitArea.left + hitArea.width / 2, hitArea.top + hitArea.height / 2],
    [hitArea.left + hitArea.width - 1, hitArea.top + hitArea.height / 2],
    [hitArea.left + 1, hitArea.top + hitArea.height - 1],
    [hitArea.left + hitArea.width / 2, hitArea.top + hitArea.height - 1],
    [hitArea.left + hitArea.width - 1, hitArea.top + hitArea.height - 1],
  ]
  // Native controls can have rounded corners; rectangular pseudo hit areas must pass every corner.
  const nativeVisualTarget = !pseudoIsActive
  const samplePointIndexes = nativeVisualTarget ? [1, 3, 4, 5, 7] : samplePoints.map((_, i) => i)
  const sampleHitTests = samplePointIndexes.map((sampleIndex) => {
    const [probeX, probeY] = samplePoints[sampleIndex]
    const hit = document.elementFromPoint(probeX, probeY)
    return (
      hit === element || element.contains(hit) || hit?.closest(".arco-radio-button") === element
    )
  })
  const extensionHitTest = sampleHitTests.every(Boolean)

  return {
    extensionHitTest,
    height,
    hitArea,
    left,
    pseudoIsActive,
    sampleHitTests,
    top,
    width,
  }
}

const readTargets = () => {
  const selectors = {
    listSidebar: '.search-and-sort-bar button[aria-controls="mobile-sidebar-drawer"]',
    listSelect: ".search-and-sort-bar .article-selection-trigger",
    listSearch: '.search-and-sort-bar button[aria-label="Search"]',
    listDate: '.search-and-sort-bar button[aria-label="Select date"]',
    listSort: '.search-and-sort-bar button[aria-label="Newest first"]',
    footerMarkAll: '.entry-panel button[aria-label="Mark all as read"]',
    footerMarkOlder: ".entry-panel .mark-older-read-trigger",
    footerRefresh: '.entry-panel button[aria-label="Refresh"]',
    readerClose: '.action-buttons button[aria-label="Close article"]',
    readerPrevious: '.action-buttons button[aria-label="Previous article"]',
    readerNext: '.action-buttons button[aria-label="Next article"]',
    readerStatus: '.action-buttons button[aria-label="Mark as read"]',
    readerStar: '.action-buttons button[aria-label="Star"]',
    readerFetch: '.action-buttons button[aria-label="Fetch original content"]',
    readerToc: '.action-buttons button[aria-label="Table of Contents"]',
    readerSave: '.action-buttons button[aria-label="Save to third-party services"]',
    readerMore: '.action-buttons button[aria-label="More actions"]',
  }

  const targets = Object.fromEntries(
    Object.entries(selectors).map(([name, selector]) => [
      name,
      getRect(document.querySelector(selector)),
    ]),
  )
  targets.footerFilters = [...document.querySelectorAll(".entry-panel .arco-radio-button")].map(
    (element) => getRect(element),
  )
  targets.listSelectionButtons = [
    ...document.querySelectorAll(".search-and-sort-bar .article-selection-controls > .arco-btn"),
  ].map((element) => getRect(element))
  targets.viewport = {
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    width: innerWidth,
    height: innerHeight,
  }
  return targets
}

const hasNoOverlappingTargets = (rects) => {
  const visibleRects = rects.filter(Boolean)
  return visibleRects.every((rect, index) =>
    visibleRects.slice(index + 1).every((other) => {
      const area = rect.hitArea || rect
      const otherArea = other.hitArea || other
      const horizontalOverlap =
        Math.min(area.left + area.width, otherArea.left + otherArea.width) -
        Math.max(area.left, otherArea.left)
      const verticalOverlap =
        Math.min(area.top + area.height, otherArea.top + otherArea.height) -
        Math.max(area.top, otherArea.top)
      return horizontalOverlap <= 0.5 || verticalOverlap <= 0.5
    }),
  )
}

const meetsTouchTarget = (rect) =>
  rect && rect.hitArea.width >= 44 && rect.hitArea.height >= 44 && rect.extensionHitTest

const hasAccessibleName = (element) =>
  element.getAttribute("aria-label") ||
  element.getAttribute("title") ||
  element.textContent?.trim() ||
  element.getAttribute("aria-labelledby") ||
  ""

const evaluateGates = (targets, selectionMode) => {
  const viewWidth = targets.viewport.width
  const listControlNames = selectionMode ? [] : ["listSelect", "listSearch", "listDate", "listSort"]
  const readerControlNames =
    viewWidth <= 768
      ? ["readerClose", "readerStatus", "readerStar", "readerToc", "readerMore"]
      : [
          "readerClose",
          "readerPrevious",
          "readerNext",
          "readerStatus",
          "readerStar",
          "readerFetch",
          "readerToc",
          "readerSave",
          "readerMore",
        ]
  const requiredTargetNames = [
    ...(viewWidth <= 992 ? ["listSidebar"] : []),
    ...listControlNames,
    "footerMarkAll",
    "footerMarkOlder",
    "footerRefresh",
    ...readerControlNames,
  ]
  const expectedSelectionControlCount = selectionMode ? 2 : 0
  const requiredControlsPresent =
    requiredTargetNames.every((name) => targets[name] !== null) &&
    targets.footerFilters.length === 3 &&
    targets.listSelectionButtons.length === expectedSelectionControlCount
  const list = [
    ...(viewWidth <= 992 ? [targets.listSidebar] : []),
    ...listControlNames.map((name) => targets[name]),
    ...targets.listSelectionButtons,
  ]
  const footer = [
    targets.footerMarkAll,
    targets.footerMarkOlder,
    targets.footerRefresh,
    ...targets.footerFilters,
  ]
  const reader = readerControlNames.map((name) => targets[name])
  const allTargets = [...list, ...footer, ...reader]
  const desktopExpected = {
    listSelect: [72.625, 36],
    listSearch: [28, 28],
    listDate: [28, 28],
    listSort: [28, 28],
    footerMarkAll: [32, 32],
    footerMarkOlder: [28, 28],
    footerRefresh: [32, 32],
    readerClose: [32, 32],
    readerPrevious: [32, 32],
    readerNext: [32, 32],
    readerStatus: [32, 32],
    readerStar: [32, 32],
    readerFetch: [32, 32],
    readerToc: [32, 32],
    readerSave: [32, 32],
    readerMore: [32, 32],
  }
  const desktopDimensionsMatch = Object.entries(desktopExpected).every(
    ([name, [width, height]]) => {
      const rect = targets[name]
      return rect && Math.abs(rect.width - width) < 0.5 && Math.abs(rect.height - height) < 0.5
    },
  )
  const visualSize = (name, width, height) => {
    const rect = targets[name]
    return rect && Math.abs(rect.width - width) < 0.5 && Math.abs(rect.height - height) < 0.5
  }
  const compactVisualDimensionsMatch =
    (!targets.listSidebar || visualSize("listSidebar", 44, 44)) &&
    (selectionMode
      ? targets.listSelectionButtons.length === 2
      : visualSize("listSelect", 72.625, 36) &&
        ["listSearch", "listDate", "listSort"].every((name) => visualSize(name, 44, 44))) &&
    ["footerMarkAll", "footerMarkOlder", "footerRefresh"].every((name) =>
      visualSize(name, 48, 48),
    ) &&
    targets.footerFilters.every(
      (rect, index) =>
        Math.abs(rect.width - (index === 1 ? 88.109375 : 48)) < 0.5 &&
        Math.abs(rect.height - 48) < 0.5,
    ) &&
    readerControlNames.every((name) => visualSize(name, 48, 48))
  const mediumVisualDimensionsMatch =
    (!targets.listSidebar || visualSize("listSidebar", 28, 28)) &&
    visualSize("listSelect", 72.625, 36) &&
    ["listSearch", "listDate", "listSort"].every((name) => visualSize(name, 28, 28)) &&
    visualSize("footerMarkAll", 32, 32) &&
    visualSize("footerMarkOlder", 28, 28) &&
    visualSize("footerRefresh", 32, 32) &&
    targets.footerFilters.every(
      (rect, index) =>
        Math.abs(rect.width - (index === 1 ? 90.109375 : 38)) < 0.5 &&
        Math.abs(rect.height - 26) < 0.5,
    ) &&
    readerControlNames.every((name) => visualSize(name, 32, 32))
  const requiresTouchTargets = viewWidth <= 992
  const namedTargets = [
    ...document.querySelectorAll(
      ".search-and-sort-bar button, .entry-panel button, .entry-panel .arco-radio-button, .action-buttons button",
    ),
  ]
  return {
    REQUIRED_CONTROLS_PRESENT: requiredControlsPresent,
    TOUCH_LIST_HEADER: requiresTouchTargets
      ? requiredControlsPresent && list.every((rect) => meetsTouchTarget(rect))
      : null,
    TOUCH_FOOTERPANEL: requiresTouchTargets
      ? requiredControlsPresent && footer.every((rect) => meetsTouchTarget(rect))
      : null,
    TOUCH_READER: requiresTouchTargets
      ? requiredControlsPresent && reader.every((rect) => meetsTouchTarget(rect))
      : null,
    NO_OVERLAP: requiredControlsPresent && hasNoOverlappingTargets(allTargets),
    NO_HORIZONTAL_OVERFLOW: targets.viewport.scrollWidth <= targets.viewport.clientWidth,
    NO_UNINTENDED_LAYOUT_SHIFT: selectionMode
      ? null
      : viewWidth <= 768
        ? compactVisualDimensionsMatch
        : viewWidth <= 992
          ? mediumVisualDimensionsMatch
          : viewWidth !== 1280 || desktopDimensionsMatch,
    DESKTOP_DENSITY_PRESERVED:
      viewWidth !== 1280 || (desktopDimensionsMatch && targets.viewport.scrollWidth === 1280),
    EXTENDED_HIT_AREAS_PASS: requiresTouchTargets
      ? requiredControlsPresent && allTargets.every((rect) => rect.extensionHitTest)
      : null,
    ARIA_SEMANTICS:
      namedTargets.length > 0 && namedTargets.every((element) => hasAccessibleName(element)),
  }
}

const Harness = () => {
  const [report, setReport] = useState("WAITING")
  const [focusReport, setFocusReport] = useState("NOT_TESTED")
  const [selectionMode, setSelectionMode] = useState(false)

  useEffect(() => {
    const update = () => {
      const targets = readTargets()
      setReport(JSON.stringify({ targets, gates: evaluateGates(targets, selectionMode) }))
    }
    const timer = setTimeout(update, 350)
    return () => clearTimeout(timer)
  }, [selectionMode])

  useEffect(() => {
    const updateFocus = () => {
      const active = document.activeElement
      setFocusReport(
        JSON.stringify({
          ariaLabel: active?.getAttribute("aria-label") || "",
          className: active?.className?.toString?.() || "",
          focusVisible: active?.matches?.(":focus-visible") || false,
          role: active?.getAttribute("role") || "",
          tagName: active?.tagName || "",
          text: active?.textContent?.trim?.().slice(0, 80) || "",
        }),
      )
    }
    document.addEventListener("focusin", updateFocus)
    globalThis.addEventListener("keydown", updateFocus)
    return () => {
      document.removeEventListener("focusin", updateFocus)
      globalThis.removeEventListener("keydown", updateFocus)
    }
  }, [])

  const desktopSidebar = {
    detailCloseButtonRef: { current: null },
    expandDesktopSidebar: () => {},
    isDesktopSidebarCollapsed: false,
    reopenButtonRef: { current: null },
  }
  const readerCommands = {
    canNavigateNext: false,
    canNavigatePrevious: false,
    exitDetailView: () => {},
    isResolving: false,
    navigateToNextArticle: () => {},
    navigateToPreviousArticle: () => {},
  }
  const contentContext = {
    closeActiveContent: () => {},
    entryListRef: { current: null },
  }

  return (
    <main className="touch-target-harness">
      <output
        aria-hidden="true"
        data-testid="touch-target-report"
        style={{
          clipPath: "inset(50%)",
          height: 1,
          overflow: "hidden",
          position: "fixed",
          whiteSpace: "nowrap",
          width: 1,
        }}
      >
        {report}
      </output>
      <output
        aria-hidden="true"
        data-testid="touch-target-focus-report"
        style={{ display: "none" }}
      >
        {focusReport}
      </output>
      <DesktopSidebarContext.Provider value={desktopSidebar}>
        <ReaderCommandsContext.Provider value={readerCommands}>
          <ContentContext.Provider value={contentContext}>
            <AppDataContext.Provider value={{ refreshCounts: async () => ({}) }}>
              <MemoryRouter initialEntries={["/feed/1"]}>
                <section aria-label="List header surface">
                  <SearchAndSortBar
                    fullWidth
                    selectionAvailable
                    selectedCount={1}
                    selectionMode={selectionMode}
                    onCancelSelection={() => setSelectionMode(false)}
                    onEnterSelectionMode={() => setSelectionMode(true)}
                    onMarkSelectedRead={() => {}}
                  />
                </section>
                <section aria-label="Footer panel surface">
                  <FooterPanel
                    getEntries={async () => ({ entries: [] })}
                    info={{ from: "feed", id: 1 }}
                    refreshArticleList={async () => {}}
                  />
                </section>
                <section aria-label="Reader action surface">
                  <div className="article-container article-container-full-size">
                    <ActionButtons />
                  </div>
                </section>
              </MemoryRouter>
            </AppDataContext.Provider>
          </ContentContext.Provider>
        </ReaderCommandsContext.Provider>
      </DesktopSidebarContext.Provider>
    </main>
  )
}

createRoot(document.querySelector("#root")).render(<Harness />)
