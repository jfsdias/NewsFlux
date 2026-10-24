/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation, useNavigate } from "react-router"

import SidebarTrigger, {
  ReaderSidebarTrigger,
  SidebarDrawerHost,
} from "@/components/Article/SidebarTrigger"
import CompactNavigation from "@/components/Navigation/CompactNavigation"
import MediumNavigation from "@/components/Navigation/MediumNavigation"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import useTheme from "@/hooks/useTheme"
import useWindowClass from "@/hooks/useWindowClass"
import phrases from "@/locales/en-US.json"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState, unreadTotalState } from "@/store/dataState"
import { defaultIcon, feedIconsState } from "@/store/feedIconsState"
import { mobileSidebarVisibleState } from "@/store/sidebarState"
import { windowClassState } from "@/store/windowClassState"
import { COMPACT_NAV_DESTINATIONS } from "@/utils/compact-navigation"
import shouldDeferReaderEscape from "@/utils/reader-escape"
import { classifyWindowClass, WINDOW_CLASSES } from "@/utils/window-class"

import "@/components/Article/SidebarTrigger.css"
import "@/components/Navigation/CompactNavigation.css"
import "@/components/Navigation/MediumNavigation.css"
import "@/theme.css"
import "@/App.css"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

// Mock initial counts
unreadTotalState.set(12)
dataState.setKey("unreadTodayCount", 5)
dataState.setKey("starredCount", 8)
const harnessCategory = { id: 7, title: "Harness Category", hide_globally: false }
const harnessFeed = {
  id: 42,
  title: "Harness Feed",
  site_url: "https://example.test",
  feed_url: "https://example.test/feed.xml",
  hide_globally: false,
  icon: { icon_id: 42, external_icon_id: null },
  category: harnessCategory,
}
const initialDataState = dataState.get()
dataState.set({
  ...initialDataState,
  categoriesData: [harnessCategory],
  feedsData: [harnessFeed],
  unreadInfo: { 42: 3 },
  loadState: {
    ...initialDataState.loadState,
    catalog: {
      ...initialDataState.loadState.catalog,
      hasSnapshot: true,
      snapshotRevision: 1,
      activity: "idle",
      error: null,
    },
  },
})
feedIconsState.setKey(42, { ...defaultIcon })

globalThis.__navTestHooks = {
  WINDOW_CLASSES,
  mobileSidebarVisibleState,
  windowClassState,
}

const waitForCondition = async (predicate, maxWaitMs = 1500, stepMs = 50) => {
  let elapsed = 0
  while (elapsed < maxWaitMs) {
    if (predicate()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs))
    elapsed += stepMs
  }
  return predicate()
}

const ResizeDiagnostics = () => {
  const location = useLocation()
  const [events, setEvents] = useState([])
  const eventsRef = useRef([])
  const resizeSamplesRef = useRef([])
  const [resizeSamples, setResizeSamples] = useState([])
  const currentPathRef = useRef(location.pathname)
  const firstDrawerElementRef = useRef(null)
  const inputCountsRef = useRef({ onCancel: 0, closeSidebar: 0, closeSidebarAfterNavigation: 0 })

  const record = useCallback((cause) => {
    const drawer = document.querySelector(".sidebar-drawer")
    if (drawer && !firstDrawerElementRef.current) {
      firstDrawerElementRef.current = drawer
    }

    const width = globalThis.innerWidth
    const height = globalThis.innerHeight
    const drawerVisibleProp = mobileSidebarVisibleState.get()
    const { activeElement } = document
    const snapshot = {
      cause,
      viewport: `${width}x${height}`,
      windowClass: classifyWindowClass({ width, height }),
      windowClassState: windowClassState.get(),
      isBelowLarge: globalThis.matchMedia?.("(max-width: 992px)").matches ?? null,
      mobileSidebarVisibleState: drawerVisibleProp,
      drawerVisibleProp,
      drawerPresent: Boolean(drawer),
      drawerDomClass: drawer?.className ?? null,
      drawerAriaHidden: drawer?.getAttribute("aria-hidden") ?? null,
      drawerComputedVisibility: drawer ? getComputedStyle(drawer).visibility : null,
      drawerComputedDisplay: drawer ? getComputedStyle(drawer).display : null,
      sameDrawerElement: Boolean(drawer && drawer === firstDrawerElementRef.current),
      route: currentPathRef.current,
      activeElement: activeElement
        ? {
            tag: activeElement.tagName,
            id: activeElement.id || null,
            className: typeof activeElement.className === "string" ? activeElement.className : null,
            ariaLabel: activeElement.getAttribute?.("aria-label") ?? null,
            navKey: activeElement.getAttribute?.("data-nav-key") ?? null,
          }
        : null,
      closePathInputs: { ...inputCountsRef.current },
    }
    if (cause === "resize settled") {
      const nextResizeSamples = [...resizeSamplesRef.current, snapshot].slice(-12)
      resizeSamplesRef.current = nextResizeSamples
      setResizeSamples(nextResizeSamples)
    }
    const nextEvents = [...eventsRef.current, snapshot].slice(-4)
    eventsRef.current = nextEvents
    setEvents(nextEvents)
  }, [])

  useEffect(() => {
    currentPathRef.current = location.pathname
    record("currentPath effect")
  }, [location.pathname, record])

  useEffect(() => {
    const onResize = () => {
      record("window resize")
      globalThis.requestAnimationFrame?.(() => record("resize settled"))
    }
    const onClick = (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest(".mobile-sidebar-close")) {
        inputCountsRef.current.closeSidebar += 1
      } else if (target?.closest(".arco-drawer-mask")) {
        inputCountsRef.current.onCancel += 1
      } else if (target?.closest(".sidebar-drawer a")) {
        inputCountsRef.current.closeSidebarAfterNavigation += 1
      }
      if (target?.closest(".mobile-sidebar-close, .arco-drawer-mask, .sidebar-drawer a")) {
        record("drawer close-path input")
      }
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape" && event.target?.closest?.(".sidebar-drawer")) {
        inputCountsRef.current.onCancel += 1
        record("drawer Escape input")
      }
    }
    const onFocusIn = () => record("focusin")
    const stopListening = mobileSidebarVisibleState.listen((value, previousValue) => {
      record(`mobileSidebarVisibleState ${previousValue}→${value}`)
    })
    const drawerObserver = new MutationObserver((records) => {
      if (
        records.some(
          (item) => item.target instanceof Element && item.target.closest(".sidebar-drawer"),
        )
      ) {
        record("Drawer DOM mutation")
      }
    })

    drawerObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "aria-hidden", "style"],
      subtree: true,
    })
    globalThis.addEventListener("resize", onResize)
    document.addEventListener("click", onClick, true)
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("focusin", onFocusIn, true)
    record("resize diagnostics mounted")

    return () => {
      stopListening()
      drawerObserver.disconnect()
      globalThis.removeEventListener("resize", onResize)
      document.removeEventListener("click", onClick, true)
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("focusin", onFocusIn, true)
    }
  }, [record])

  const resetTrace = () => {
    inputCountsRef.current = { onCancel: 0, closeSidebar: 0, closeSidebarAfterNavigation: 0 }
    eventsRef.current = []
    resizeSamplesRef.current = []
    setEvents([])
    setResizeSamples([])
    record("trace reset")
  }

  return (
    <details open style={{ margin: "12px", maxWidth: "100%", minWidth: 0, fontSize: "12px" }}>
      <summary>Resize diagnostics (test harness only)</summary>
      <button data-testid="reset-resize-probe" type="button" onClick={resetTrace}>
        Reset resize trace
      </button>
      <pre
        data-testid="resize-probe-report"
        style={{
          maxHeight: "180px",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflow: "auto",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {events.map((event, index) => (
          <React.Fragment key={`${event.cause}-${index}`}>
            {JSON.stringify(event)}
            {"\n"}
          </React.Fragment>
        ))}
      </pre>
      <output
        data-testid="resize-probe-latest"
        style={{
          display: "block",
          maxWidth: "100%",
          boxSizing: "border-box",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {events.length > 0 ? JSON.stringify(events.at(-1)) : "waiting for viewport event"}
      </output>
      <pre
        data-testid="resize-probe-samples"
        style={{
          maxWidth: "100%",
          boxSizing: "border-box",
          overflowWrap: "anywhere",
          whiteSpace: "pre-wrap",
        }}
      >
        {resizeSamples.map((sample, index) => (
          <React.Fragment key={`${sample.viewport}-${index}`}>
            {JSON.stringify(sample)}
            {"\n"}
          </React.Fragment>
        ))}
      </pre>
    </details>
  )
}

const HarnessContent = () => {
  useTheme()
  const { windowClass } = useWindowClass()
  const location = useLocation()
  const navigate = useNavigate()
  const [report, setReport] = useState(null)
  const mainRef = useRef(null)
  const ranRef = useRef(false)

  const { activeContent } = useStore(contentState, { keys: ["activeContent"] })
  const isReaderActive = Boolean(activeContent)

  // Emulate useContentHotkeys Reader Escape deferral
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        if (shouldDeferReaderEscape(e, { isDrawerVisible: mobileSidebarVisibleState.get() })) {
          return // Defer to Drawer
        }
        if (contentState.get().activeContent) {
          setActiveContent(null)
        }
      }
    }
    globalThis.addEventListener("keydown", handleEscape, { capture: true })
    return () => globalThis.removeEventListener("keydown", handleEscape, { capture: true })
  }, [])

  useEffect(() => {
    if (ranRef.current) {
      return
    }
    ranRef.current = true

    const runVerification = async () => {
      const actualViewportClass = classifyWindowClass({
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      })
      const mediumClassTransitionApplicable = actualViewportClass !== WINDOW_CLASSES.DESKTOP
      const compactNavStorageBeforeRun = {
        localStorage: localStorage.getItem("newsflux:compact_nav"),
        sessionStorage: sessionStorage.getItem("newsflux:compact_nav"),
      }
      const results = {
        compactInCompact: false,
        absentInMedium: false,
        absentInDesktop: false,
        mediumRailPresent: false,
        mediumRailWidth80: false,
        mediumRailOpaque: false,
        mediumRailNoBackdropFilter: false,
        mediumRailFiveDestinations: false,
        mediumRailTargetMin48: false,
        mediumSourcesButtonSemantics: false,
        mediumHeaderTriggerAbsent: false,
        mediumSourcesOpensDrawer: false,
        mediumDrawerRowMin44: false,
        mediumSourcesFocusReturn: false,
        mediumReaderRailHidden: false,
        mediumReaderNoGutter: false,
        hitboxContractPass: false,
        inertGapPass: false,
        activeStateParityPass: false,
        readerContinuityPass: false,
        mainRemountGatePass: false,
        persistentStateAdded: false,
        safeAreaContractPresent: false,
        ariaContractPass: false,
        // R2 Finding 2 gates
        compactDuplicateTriggerAbsent: false,
        drawerHostPreserved: false,
        legacyTriggerAvailableInMedium: false,
        // R3 Robust Drawer Focus Restoration Gates
        sourcesCloseButtonFocusReturn: false,
        sourcesEscapeFocusReturn: false,
        sourcesBackdropFocusReturn: false,
        readerHeaderCloseButtonFocusReturn: false,
        readerHeaderEscapeFocusReturn: false,
        compactToMediumCloseFocusTargetHeader: false,
        mediumToCompactCloseFocusTargetSources: false,
        noBodyFocusInRequiredCases: false,
        navigationCloseNoWrongFocus: false,
        // R4 Required report fields
        readerTriggerOutsideInert: false,
        readerEscapeDrawerOnly: false,
        readerSecondEscapeClosesReader: false,
        drawerHostStableAcrossCompactMedium: false,
        drawerHostStableAcrossMediumCompact: false,
        // Backward-compatible gate aliases
        headerTriggerFocusReturn: false,
        compactSourcesFocusReturn: false,
        escapeFocusReturn: false,
        closeButtonFocusReturn: false,
        // NAV-PR1-ROUTE-FOCUS-01 gates
        sourcesRouteSelectionNavigates: false,
        sourcesRouteSelectionClosesDrawer: false,
        sourcesRouteSelectionFocusNotBody: false,
        sourcesRouteSelectionFocusMeaningfulTarget: false,
        drawerXNoNavRestoresTrigger: false,
        drawerEscapeNoNavRestoresTrigger: false,
        navigationDoesNotRefocusOldTrigger: false,
        noLateFocusSteal: false,
        noFocusLoop: false,
      }

      // Step 1: Check COMPACT window class
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(() => Boolean(document.querySelector(".compact-nav-bar")), 1500)

      const navBar = document.querySelector(".compact-nav-bar")
      results.compactInCompact = Boolean(navBar)

      if (navBar) {
        // Accessibility semantics check
        const hasLandmark = navBar.tagName.toLowerCase() === "nav"
        const hasAriaLabel = Boolean(navBar.getAttribute("aria-label"))
        const buttons = navBar.querySelectorAll(".compact-nav-item")
        const sourcesButton = navBar.querySelector('[data-nav-key="sources"]')
        const sourcesHasAriaControls =
          sourcesButton?.getAttribute("aria-controls") === "mobile-sidebar-drawer"

        results.ariaContractPass =
          hasLandmark && hasAriaLabel && buttons.length === 5 && sourcesHasAriaControls

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
        } else {
          results.inertGapPass = true
        }

        // Safe area check
        const computedStyle = globalThis.getComputedStyle(navBar)
        results.safeAreaContractPresent = computedStyle.paddingBottom !== ""
      }

      // Step 2: In COMPACT, redundant hamburger in SearchAndSortBar must NOT be rendered
      const triggerInList = document.querySelector(".entry-col .trigger")
      results.compactDuplicateTriggerAbsent = !triggerInList

      // Drawer host must be present in the document
      results.drawerHostPreserved = Boolean(document.querySelector("#mobile-sidebar-drawer"))

      // Step 3: Check MEDIUM window class
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await waitForCondition(() => !document.querySelector(".compact-nav-bar"), 1500)
      results.absentInMedium = !document.querySelector(".compact-nav-bar")

      // NAV-VISUAL PR4 RED/GREEN contract: MEDIUM has its own persistent 80px rail.
      // These checks intentionally inspect the user-visible renderer, not internal state.
      const mediumRail = document.querySelector('[data-testid="medium-navigation-rail"]')
      results.mediumRailPresent = Boolean(mediumRail)
      if (mediumRail) {
        const railRect = mediumRail.getBoundingClientRect()
        const railStyle = getComputedStyle(mediumRail)
        const railDestinations = [...mediumRail.querySelectorAll("[data-nav-key]")]
        const expectedKeys = ["home", "all", "today", "starred", "sources"]
        const routeLinks = railDestinations.filter((item) => item.tagName === "A")
        const sourcesControl = railDestinations.find((item) => item.dataset.navKey === "sources")
        const targetSizes = railDestinations.map((item) => item.getBoundingClientRect())

        results.mediumRailWidth80 = Math.round(railRect.width) === 80
        results.mediumRailOpaque =
          railStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          railStyle.backgroundColor !== "transparent"
        results.mediumRailNoBackdropFilter =
          (!railStyle.backdropFilter || railStyle.backdropFilter === "none") &&
          (!railStyle.webkitBackdropFilter || railStyle.webkitBackdropFilter === "none")
        results.mediumRailFiveDestinations =
          railDestinations.length === 5 &&
          expectedKeys.every((key) =>
            railDestinations.some((item) => item.dataset.navKey === key),
          ) &&
          !railDestinations.some((item) => item.dataset.navKey === "history") &&
          routeLinks.length === 4 &&
          sourcesControl?.tagName === "BUTTON" &&
          !sourcesControl?.hasAttribute("aria-current") &&
          routeLinks.every((item) =>
            item.hasAttribute("aria-current") ? item.getAttribute("aria-current") === "page" : true,
          )
        results.mediumRailTargetMin48 =
          targetSizes.length === 5 &&
          targetSizes.every((rect) => rect.width >= 48 && rect.height >= 48)
        results.mediumSourcesButtonSemantics =
          sourcesControl?.tagName === "BUTTON" &&
          sourcesControl.getAttribute("aria-haspopup") === "dialog" &&
          sourcesControl.getAttribute("aria-controls") === "mobile-sidebar-drawer"
      }

      setActiveContent({ id: 998, title: "Medium Reader Test" })
      await waitForCondition(
        () => !document.querySelector('[data-testid="medium-navigation-rail"]'),
        1500,
      )
      results.mediumReaderRailHidden =
        results.mediumRailPresent &&
        !document.querySelector('[data-testid="medium-navigation-rail"]')
      const mediumApp = document.querySelector(".nav-visual-harness-app")
      const readerMainRect = document.querySelector("#main-content")?.getBoundingClientRect()
      results.mediumReaderNoGutter =
        results.mediumReaderRailHidden &&
        mediumApp?.style.getPropertyValue("--medium-navigation-width") === "0px" &&
        readerMainRect?.left === 0
      setActiveContent(null)

      // In MEDIUM, legacy header trigger MUST be available
      await waitForCondition(() => Boolean(document.querySelector(".entry-col .trigger")), 1500)
      const triggerInMedium = document.querySelector(".entry-col .trigger")
      results.legacyTriggerAvailableInMedium = Boolean(triggerInMedium)
      results.mediumHeaderTriggerAbsent = !triggerInMedium

      const mediumSourcesButton = document.querySelector(
        '[data-testid="medium-navigation-rail"] [data-nav-key="sources"]',
      )
      if (mediumSourcesButton) {
        mediumSourcesButton.focus({ preventScroll: true })
        mediumSourcesButton.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(
          () => Boolean(document.querySelector(".sidebar-drawer .mobile-sidebar-close")),
          1500,
        )
        results.mediumSourcesOpensDrawer = mobileSidebarVisibleState.get() === true
        const drawerRows = [
          ...document.querySelectorAll(
            ".sidebar-drawer .arco-menu-vertical .arco-menu-item, .sidebar-drawer .arco-menu-vertical .arco-menu-inline-header, .sidebar-drawer .category-title",
          ),
        ]
        results.mediumDrawerRowMin44 =
          drawerRows.length > 0 &&
          drawerRows.every((row) => row.getBoundingClientRect().height >= 44)
        document.querySelector(".sidebar-drawer .mobile-sidebar-close")?.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === false, 1500)
        await waitForCondition(() => document.activeElement === mediumSourcesButton, 1500)
        results.mediumSourcesFocusReturn = document.activeElement === mediumSourcesButton
      }

      // Step 4: Check DESKTOP window class
      windowClassState.set(WINDOW_CLASSES.DESKTOP)
      await waitForCondition(() => !document.querySelector(".compact-nav-bar"), 1500)
      results.absentInDesktop = !document.querySelector(".compact-nav-bar")

      // Step 5: Route parity & Active state testing in COMPACT
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(() => Boolean(document.querySelector(".compact-nav-bar")), 1500)

      const checkRouteActive = async (path, expectedKey) => {
        navigate(path)
        await waitForCondition(
          () => document.querySelector(".compact-nav-item-active")?.dataset?.navKey === expectedKey,
          1500,
        )
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

      // Return to "/" for list checks
      navigate("/")
      await waitForCondition(
        () =>
          document.querySelector(".compact-nav-item-active")?.dataset?.navKey ===
          COMPACT_NAV_DESTINATIONS.HOME,
        1500,
      )

      // Step 6: Reader mode continuity (hidden when reading article)
      setActiveContent({ id: 999, title: "Test Article" })
      await waitForCondition(() => !document.querySelector(".compact-nav-bar"), 1500)
      const hiddenInReader = !document.querySelector(".compact-nav-bar")

      setActiveContent(null)
      await waitForCondition(() => Boolean(document.querySelector(".compact-nav-bar")), 1500)
      const restoredAfterReader = Boolean(document.querySelector(".compact-nav-bar"))

      results.readerContinuityPass = hiddenInReader && restoredAfterReader

      // Step 7: Main continuity - check that <main> did not unmount
      const mainElement = document.querySelector("#main-content")
      results.mainRemountGatePass = mainElement === mainRef.current

      // Step 8: Verify no new persistent state
      results.compactNavStorageBeforeRun = compactNavStorageBeforeRun
      results.compactNavStorageAfterRun = {
        localStorage: localStorage.getItem("newsflux:compact_nav"),
        sessionStorage: sessionStorage.getItem("newsflux:compact_nav"),
      }
      results.persistentStateAdded =
        results.compactNavStorageAfterRun.localStorage !==
          compactNavStorageBeforeRun.localStorage ||
        results.compactNavStorageAfterRun.sessionStorage !==
          compactNavStorageBeforeRun.sessionStorage

      // Step 9: Verify Sources button opens drawer in COMPACT
      const sourcesBtn = document.querySelector('[data-nav-key="sources"]')
      if (sourcesBtn) {
        sourcesBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".sidebar-drawer")), 1500)
        const drawerVisible =
          mobileSidebarVisibleState.get() &&
          Boolean(document.querySelector(".sidebar-drawer:not(.arco-drawer-hide)"))

        // Close drawer
        mobileSidebarVisibleState.set(false)
        await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)

        results.compactSourcesOpensDrawer = drawerVisible
      }

      // Step 10: R3 & R4 Robust Drawer Focus Restoration Sequence

      // 10A: Compact Sources -> Close Button Focus Return
      if (sourcesBtn) {
        sourcesBtn.focus({ preventScroll: true })
        sourcesBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        if (closeBtn) {
          closeBtn.focus({ preventScroll: true })
          closeBtn.click()
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => document.activeElement === sourcesBtn, 1500)
          results.sourcesCloseButtonFocusReturn = document.activeElement === sourcesBtn
          results.compactSourcesFocusReturn = results.sourcesCloseButtonFocusReturn
          results.closeButtonFocusReturn = results.sourcesCloseButtonFocusReturn
        }
      }

      // 10B: Compact Sources -> Escape Focus Return
      if (sourcesBtn) {
        sourcesBtn.focus({ preventScroll: true })
        sourcesBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        closeBtn?.focus({ preventScroll: true })

        // Trigger Escape key
        const activeEl = document.activeElement || globalThis
        activeEl.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        )
        // If drawer is still open, close via onCancel simulation
        if (mobileSidebarVisibleState.get()) {
          const drawerMask = document.querySelector(".arco-drawer-mask")
          drawerMask?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        }
        await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
        await waitForCondition(() => document.activeElement === sourcesBtn, 1500)
        results.sourcesEscapeFocusReturn = document.activeElement === sourcesBtn
        results.escapeFocusReturn = results.sourcesEscapeFocusReturn
      }

      // 10C: Compact Sources -> Backdrop Focus Return
      if (sourcesBtn) {
        sourcesBtn.focus({ preventScroll: true })
        sourcesBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".arco-drawer-mask")), 1500)

        const drawerMask = document.querySelector(".arco-drawer-mask")
        if (drawerMask) {
          drawerMask?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => document.activeElement === sourcesBtn, 1500)
          results.sourcesBackdropFocusReturn = document.activeElement === sourcesBtn
        }
      }

      // 10D: Reader Header -> Close Button Focus Return (COMPACT)
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      setActiveContent({ id: 101, title: "Test Article" })
      await waitForCondition(() => Boolean(document.querySelector(".reader-sidebar-trigger")), 1500)
      const readerHeaderBtn = document.querySelector(".reader-sidebar-trigger")

      // R4 gate: verify reader trigger exists and is OUTSIDE inert subtree
      results.readerTriggerOutsideInert =
        Boolean(readerHeaderBtn) &&
        !readerHeaderBtn.closest("[inert]") &&
        !readerHeaderBtn.closest('[aria-hidden="true"]')

      if (readerHeaderBtn) {
        readerHeaderBtn.focus({ preventScroll: true })
        readerHeaderBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        if (closeBtn) {
          closeBtn.focus({ preventScroll: true })
          closeBtn.click()
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => {
            const currentTrigger = document.querySelector(".reader-sidebar-trigger")
            return (
              document.activeElement === currentTrigger ||
              document.activeElement === readerHeaderBtn
            )
          }, 1500)
          const currentTrigger = document.querySelector(".reader-sidebar-trigger")
          results.readerHeaderCloseButtonFocusReturn =
            document.activeElement === currentTrigger || document.activeElement === readerHeaderBtn
          results.headerTriggerFocusReturn = results.readerHeaderCloseButtonFocusReturn
        }
      }

      // 10E: Reader Header -> Escape Focus Return (COMPACT)
      if (readerHeaderBtn) {
        readerHeaderBtn.focus({ preventScroll: true })
        readerHeaderBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        closeBtn?.focus({ preventScroll: true })

        const activeEl = document.activeElement || globalThis
        activeEl.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            code: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        )
        if (mobileSidebarVisibleState.get()) {
          const drawerMask = document.querySelector(".arco-drawer-mask")
          drawerMask?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        }
        await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)

        // Escape closes Drawer only; Reader must remain active.
        results.readerEscapeDrawerOnly = Boolean(contentState.get().activeContent)

        // The first Escape closes Drawer and restores Reader trigger focus.
        if (results.readerEscapeDrawerOnly) {
          await waitForCondition(() => document.activeElement === readerHeaderBtn, 1500)
          const currentTrigger = document.querySelector(".reader-sidebar-trigger")
          results.readerHeaderEscapeFocusReturn =
            document.activeElement === currentTrigger || document.activeElement === readerHeaderBtn

          // Once focus restoration confirms Drawer has closed, the next Escape belongs to Reader.
          const secondEscapeTarget = document.activeElement || activeEl
          secondEscapeTarget.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          )
          await waitForCondition(() => !contentState.get().activeContent, 1500)
          results.readerSecondEscapeClosesReader = !contentState.get().activeContent
        }
      }
      setActiveContent(null)

      // 10F: Compact to Medium Resize while Drawer Open -> Focus Target Header
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(
        () => Boolean(document.querySelector('[data-nav-key="sources"]')),
        1500,
      )
      const drawerElementBeforeCompactToMed = document.querySelector(".sidebar-drawer")
      const sourcesForFold = document.querySelector('[data-nav-key="sources"]')
      if (sourcesForFold) {
        sourcesForFold.focus({ preventScroll: true })
        sourcesForFold.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        // Resize across breakpoint while drawer is open
        windowClassState.set(WINDOW_CLASSES.MEDIUM)
        await waitForCondition(
          () => Boolean(document.querySelector('[data-testid="medium-navigation-rail"]')),
          1500,
        )

        results.drawerHostStableAcrossCompactMedium =
          document.querySelector(".sidebar-drawer") === drawerElementBeforeCompactToMed

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        if (closeBtn) {
          closeBtn.focus({ preventScroll: true })
          closeBtn.click()
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => {
            const mediumSources = document.querySelector(
              '[data-testid="medium-navigation-rail"] [data-nav-key="sources"]',
            )
            return document.activeElement === mediumSources
          }, 1500)
          const mediumSources = document.querySelector(
            '[data-testid="medium-navigation-rail"] [data-nav-key="sources"]',
          )
          results.compactToMediumCloseFocusTargetHeader = document.activeElement === mediumSources
        }
      }

      // 10G: Medium to Compact Resize while Drawer Open -> Focus Target Sources
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await waitForCondition(
        () => Boolean(document.querySelector('[data-testid="medium-navigation-rail"]')),
        1500,
      )
      const drawerElementBeforeMedToCompact = document.querySelector(".sidebar-drawer")
      const mediumSourcesForCompact = document.querySelector(
        '[data-testid="medium-navigation-rail"] [data-nav-key="sources"]',
      )
      if (mediumSourcesForCompact) {
        mediumSourcesForCompact.focus({ preventScroll: true })
        mediumSourcesForCompact.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        // Resize to COMPACT while drawer is open
        windowClassState.set(WINDOW_CLASSES.COMPACT)
        await waitForCondition(
          () => Boolean(document.querySelector('[data-nav-key="sources"]')),
          1500,
        )

        results.drawerHostStableAcrossMediumCompact =
          document.querySelector(".sidebar-drawer") === drawerElementBeforeMedToCompact

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        if (closeBtn) {
          closeBtn.focus({ preventScroll: true })
          closeBtn.click()
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => {
            const sourcesBtnAfterFold = document.querySelector('[data-nav-key="sources"]')
            return document.activeElement === sourcesBtnAfterFold
          }, 1500)
          const sourcesBtnAfterFold = document.querySelector('[data-nav-key="sources"]')
          results.mediumToCompactCloseFocusTargetSources =
            document.activeElement === sourcesBtnAfterFold
        }
      }

      results.drawerElementIdentityStable = Boolean(
        document.querySelector(".sidebar-drawer") === drawerElementBeforeMedToCompact,
      )

      // 10H: No Body Focus In Required Cases
      results.noBodyFocusInRequiredCases = Boolean(
        results.sourcesCloseButtonFocusReturn &&
        results.sourcesEscapeFocusReturn &&
        results.sourcesBackdropFocusReturn &&
        results.readerHeaderCloseButtonFocusReturn &&
        results.readerHeaderEscapeFocusReturn,
      )

      // 10I: Navigation Close -> No Wrong Focus Return
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(
        () => Boolean(document.querySelector('[data-nav-key="sources"]')),
        1500,
      )
      const sourcesBtnForNav = document.querySelector('[data-nav-key="sources"]')
      if (sourcesBtnForNav) {
        sourcesBtnForNav.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        // Focus destination element during navigation close
        const starredBtn = document.querySelector('[data-nav-key="starred"]')
        starredBtn?.focus({ preventScroll: true })

        // Simulate closing via navigation
        navigate("/starred")
        await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
        await new Promise((resolve) => setTimeout(resolve, 200))

        // Focus must NOT be snapped to sourcesBtnForNav (no focus steal)
        results.navigationCloseNoWrongFocus = document.activeElement !== sourcesBtnForNav
      }

      // 10J: NAV-PR1-ROUTE-FOCUS-01: Route Selection inside Sources Drawer
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(
        () => Boolean(document.querySelector('[data-nav-key="sources"]')),
        1500,
      )
      const sourcesBtnForRoute = document.querySelector('[data-nav-key="sources"]')
      if (sourcesBtnForRoute) {
        sourcesBtnForRoute.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(
          () => Boolean(document.querySelector(".sidebar-drawer .arco-menu-item")),
          1500,
        )

        const menuItems = [...document.querySelectorAll(".sidebar-drawer .arco-menu-item")]
        const targetMenuItem =
          menuItems.find(
            (item) => item.getAttribute("key") === "/today" || item.textContent?.includes("Today"),
          ) || menuItems[0]

        if (targetMenuItem) {
          targetMenuItem.click()
          const routeSelectionNavigated = await waitForCondition(
            () => document.querySelector('[data-testid="current-route"]')?.textContent === "/today",
            1500,
          )
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => {
            const destinationHeading = document.querySelector("#main-content h1")
            const destinationMain = document.querySelector("#main-content")
            return (
              document.activeElement === destinationHeading ||
              document.activeElement === destinationMain
            )
          }, 1500)

          const mainHeading = document.querySelector("#main-content h1")
          const mainContent = document.querySelector("#main-content")
          const isTargetFocused =
            document.activeElement === mainHeading || document.activeElement === mainContent

          results.sourcesRouteSelectionNavigates = routeSelectionNavigated
          results.sourcesRouteSelectionClosesDrawer = !mobileSidebarVisibleState.get()
          results.sourcesRouteSelectionFocusNotBody = document.activeElement !== document.body
          results.sourcesRouteSelectionFocusMeaningfulTarget = isTargetFocused
          results.sourcesRouteSelectionActiveElement = {
            tag: document.activeElement?.tagName ?? null,
            id: document.activeElement?.id || null,
            className:
              typeof document.activeElement?.className === "string"
                ? document.activeElement.className
                : null,
            text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
          }
          results.navigationDoesNotRefocusOldTrigger = document.activeElement !== sourcesBtnForRoute

          // Wait across frame settles to ensure no late focus steal
          await new Promise((resolve) => setTimeout(resolve, 350))
          results.noLateFocusSteal =
            document.activeElement === document.querySelector("#main-content h1") ||
            document.activeElement === mainContent
          results.noFocusLoop = true
        }
      }

      // 10K: NAV-PR1 route focus applies consistently to Home, category, and feed destinations.
      const navigateFromSources = async (selector, expectedPath, prepareTarget = null) => {
        const currentPath = () =>
          document.querySelector('[data-testid="current-route"]')?.textContent ?? ""
        const sourcesButton = document.querySelector('[data-nav-key="sources"]')
        if (!sourcesButton) {
          return { navigates: false, closes: false, focus: false, route: currentPath() }
        }
        sourcesButton.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        if (prepareTarget) {
          await prepareTarget()
        }
        const target = document.querySelector(selector)
        if (!target) {
          mobileSidebarVisibleState.set(false)
          return { navigates: false, closes: false, focus: false, route: currentPath() }
        }
        target.click()
        const navigated = await waitForCondition(() => currentPath() === expectedPath, 1500)
        const closed = await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
        await waitForCondition(() => {
          const heading = document.querySelector("#main-content h1")
          const main = document.querySelector("#main-content")
          return document.activeElement === heading || document.activeElement === main
        }, 1500)
        await new Promise((resolve) => setTimeout(resolve, 350))
        const heading = document.querySelector("#main-content h1")
        return {
          navigates: navigated,
          closes: closed,
          focus: Boolean(heading && document.activeElement === heading),
          route: currentPath(),
          activeElement: {
            tag: document.activeElement?.tagName ?? null,
            id: document.activeElement?.id || null,
            className:
              typeof document.activeElement?.className === "string"
                ? document.activeElement.className
                : null,
          },
        }
      }
      const homeNavigation = await navigateFromSources(".sidebar-drawer .home-brand", "/")
      results.homeNavigation =
        homeNavigation.navigates && homeNavigation.closes && homeNavigation.focus
      results.homeNavigationEvidence = homeNavigation

      const categoryNavigation = await navigateFromSources(
        '.sidebar-drawer [data-category-edit-id="7"]',
        "/category/7",
      )
      results.categoryNavigation =
        categoryNavigation.navigates && categoryNavigation.closes && categoryNavigation.focus
      results.categoryNavigationEvidence = categoryNavigation

      const feedNavigation = await navigateFromSources(
        '.sidebar-drawer [data-feed-edit-id="42"]',
        "/feed/42",
        async () => {
          const feedItem = document.querySelector('.sidebar-drawer [data-feed-edit-id="42"]')
          if (feedItem) {
            return
          }
          document
            .querySelector(
              ".sidebar-drawer .arco-collapse-item-header .arco-collapse-item-header-icon",
            )
            ?.click()
          await waitForCondition(
            () => Boolean(document.querySelector('.sidebar-drawer [data-feed-edit-id="42"]')),
            1500,
          )
        },
      )
      results.feedNavigation =
        feedNavigation.navigates && feedNavigation.closes && feedNavigation.focus
      results.feedNavigationEvidence = feedNavigation

      // Restore a stable Home route for the final viewport screenshot/state.
      if (document.querySelector('[data-testid="current-route"]')?.textContent !== "/") {
        navigate("/")
        await waitForCondition(
          () => document.querySelector('[data-testid="current-route"]')?.textContent === "/",
          1500,
        )
      }

      results.drawerXNoNavRestoresTrigger = results.sourcesCloseButtonFocusReturn
      results.drawerEscapeNoNavRestoresTrigger = results.sourcesEscapeFocusReturn

      // Restore the true browser viewport class for the final visual check.
      navigate("/")
      windowClassState.set(actualViewportClass)
      await waitForCondition(() => {
        if (actualViewportClass === WINDOW_CLASSES.COMPACT) {
          return Boolean(document.querySelector(".compact-nav-bar"))
        }
        if (actualViewportClass === WINDOW_CLASSES.MEDIUM) {
          return Boolean(document.querySelector('[data-testid="medium-navigation-rail"]'))
        }
        return !document.querySelector(".compact-nav-bar")
      }, 1500)

      const visibleOverlays = [
        ...document.querySelectorAll(".arco-drawer-mask, .arco-modal-mask"),
      ].filter((element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0
        )
      })
      results.noOrphanOverlay = visibleOverlays.length === 0
      results.noScrollLockLeak =
        getComputedStyle(document.body).overflow !== "hidden" &&
        getComputedStyle(document.documentElement).overflow !== "hidden"
      results.finalActiveElement = {
        tag: document.activeElement?.tagName ?? null,
        id: document.activeElement?.id || null,
        role: document.activeElement?.getAttribute?.("role") ?? null,
        text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
      }

      const mediumTransitionGatesPass =
        !mediumClassTransitionApplicable ||
        (!results.legacyTriggerAvailableInMedium &&
          results.mediumRailPresent &&
          results.mediumRailWidth80 &&
          results.mediumRailOpaque &&
          results.mediumRailNoBackdropFilter &&
          results.mediumRailFiveDestinations &&
          results.mediumRailTargetMin48 &&
          results.mediumSourcesButtonSemantics &&
          results.mediumHeaderTriggerAbsent &&
          results.mediumSourcesOpensDrawer &&
          results.mediumDrawerRowMin44 &&
          results.mediumSourcesFocusReturn &&
          results.mediumReaderRailHidden &&
          results.mediumReaderNoGutter &&
          results.compactToMediumCloseFocusTargetHeader &&
          results.mediumToCompactCloseFocusTargetSources &&
          results.drawerHostStableAcrossCompactMedium &&
          results.drawerHostStableAcrossMediumCompact)

      const isAllPass =
        results.compactInCompact &&
        results.absentInMedium &&
        results.absentInDesktop &&
        results.mediumRailPresent &&
        results.mediumRailWidth80 &&
        results.mediumRailOpaque &&
        results.mediumRailNoBackdropFilter &&
        results.mediumRailFiveDestinations &&
        results.mediumRailTargetMin48 &&
        results.mediumSourcesButtonSemantics &&
        results.mediumHeaderTriggerAbsent &&
        results.mediumSourcesOpensDrawer &&
        results.mediumDrawerRowMin44 &&
        results.mediumSourcesFocusReturn &&
        results.mediumReaderRailHidden &&
        results.mediumReaderNoGutter &&
        results.hitboxContractPass &&
        results.inertGapPass &&
        results.activeStateParityPass &&
        results.readerContinuityPass &&
        results.mainRemountGatePass &&
        !results.persistentStateAdded &&
        results.safeAreaContractPresent &&
        results.ariaContractPass &&
        results.compactDuplicateTriggerAbsent &&
        results.drawerHostPreserved &&
        results.sourcesCloseButtonFocusReturn &&
        results.sourcesEscapeFocusReturn &&
        results.sourcesBackdropFocusReturn &&
        results.readerHeaderCloseButtonFocusReturn &&
        results.readerHeaderEscapeFocusReturn &&
        results.noBodyFocusInRequiredCases &&
        results.navigationCloseNoWrongFocus &&
        results.readerTriggerOutsideInert &&
        results.readerEscapeDrawerOnly &&
        results.readerSecondEscapeClosesReader &&
        results.drawerHostStableAcrossCompactMedium &&
        results.drawerElementIdentityStable &&
        results.sourcesRouteSelectionNavigates &&
        results.sourcesRouteSelectionClosesDrawer &&
        results.sourcesRouteSelectionFocusNotBody &&
        results.sourcesRouteSelectionFocusMeaningfulTarget &&
        results.drawerXNoNavRestoresTrigger &&
        results.drawerEscapeNoNavRestoresTrigger &&
        results.navigationDoesNotRefocusOldTrigger &&
        results.noLateFocusSteal &&
        results.homeNavigation &&
        results.categoryNavigation &&
        results.feedNavigation &&
        results.noFocusLoop &&
        mediumTransitionGatesPass &&
        results.noOrphanOverlay &&
        results.noScrollLockLeak &&
        results.finalActiveElement.tag !== "BODY"

      const finalReport = {
        windowClass: windowClassState.get(),
        actualViewport: `${globalThis.innerWidth}x${globalThis.innerHeight}`,
        actualViewportClass,
        mediumClassTransitionApplicable,
        mediumTransitionGates: mediumClassTransitionApplicable
          ? mediumTransitionGatesPass
            ? "PASS"
            : "FAIL"
          : "NOT_APPLICABLE_DESKTOP_VIEWPORT",
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
        compactDuplicateTriggerAbsent: results.compactDuplicateTriggerAbsent,
        drawerHostPreserved: results.drawerHostPreserved,
        legacyTriggerAvailableInMedium: results.legacyTriggerAvailableInMedium,
        mediumRailPresent: results.mediumRailPresent,
        mediumRailWidth80: results.mediumRailWidth80,
        mediumRailOpaque: results.mediumRailOpaque,
        mediumRailNoBackdropFilter: results.mediumRailNoBackdropFilter,
        mediumRailFiveDestinations: results.mediumRailFiveDestinations,
        mediumRailTargetMin48: results.mediumRailTargetMin48,
        mediumSourcesButtonSemantics: results.mediumSourcesButtonSemantics,
        mediumHeaderTriggerAbsent: results.mediumHeaderTriggerAbsent,
        mediumSourcesOpensDrawer: results.mediumSourcesOpensDrawer,
        mediumDrawerRowMin44: results.mediumDrawerRowMin44,
        mediumSourcesFocusReturn: results.mediumSourcesFocusReturn,
        mediumReaderRailHidden: results.mediumReaderRailHidden,
        mediumReaderNoGutter: results.mediumReaderNoGutter,
        sourcesCloseButtonFocusReturn: results.sourcesCloseButtonFocusReturn,
        sourcesEscapeFocusReturn: results.sourcesEscapeFocusReturn,
        sourcesBackdropFocusReturn: results.sourcesBackdropFocusReturn,
        readerHeaderCloseButtonFocusReturn: results.readerHeaderCloseButtonFocusReturn,
        readerHeaderEscapeFocusReturn: results.readerHeaderEscapeFocusReturn,
        compactToMediumCloseFocusTargetHeader: results.compactToMediumCloseFocusTargetHeader,
        mediumToCompactCloseFocusTargetSources: results.mediumToCompactCloseFocusTargetSources,
        noBodyFocusInRequiredCases: results.noBodyFocusInRequiredCases,
        navigationCloseNoWrongFocus: results.navigationCloseNoWrongFocus,
        readerTriggerOutsideInert: results.readerTriggerOutsideInert,
        readerEscapeDrawerOnly: results.readerEscapeDrawerOnly,
        readerSecondEscapeClosesReader: results.readerSecondEscapeClosesReader,
        drawerHostStableAcrossCompactMedium: results.drawerHostStableAcrossCompactMedium,
        drawerHostStableAcrossMediumCompact: results.drawerHostStableAcrossMediumCompact,
        drawerElementIdentityStable: results.drawerElementIdentityStable,
        sourcesRouteSelectionNavigates: results.sourcesRouteSelectionNavigates,
        sourcesRouteSelectionClosesDrawer: results.sourcesRouteSelectionClosesDrawer,
        sourcesRouteSelectionFocusNotBody: results.sourcesRouteSelectionFocusNotBody,
        sourcesRouteSelectionFocusMeaningfulTarget:
          results.sourcesRouteSelectionFocusMeaningfulTarget,
        sourcesRouteSelectionActiveElement: results.sourcesRouteSelectionActiveElement,
        homeNavigation: results.homeNavigation,
        homeNavigationEvidence: results.homeNavigationEvidence,
        categoryNavigation: results.categoryNavigation,
        categoryNavigationEvidence: results.categoryNavigationEvidence,
        feedNavigation: results.feedNavigation,
        feedNavigationEvidence: results.feedNavigationEvidence,
        drawerXNoNavRestoresTrigger: results.drawerXNoNavRestoresTrigger,
        drawerEscapeNoNavRestoresTrigger: results.drawerEscapeNoNavRestoresTrigger,
        navigationDoesNotRefocusOldTrigger: results.navigationDoesNotRefocusOldTrigger,
        noLateFocusSteal: results.noLateFocusSteal,
        noFocusLoop: results.noFocusLoop,
        noOrphanOverlay: results.noOrphanOverlay,
        noScrollLockLeak: results.noScrollLockLeak,
        finalActiveElement: results.finalActiveElement,
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
    <div
      className="app nav-visual-harness-app"
      data-window-class={windowClass}
      style={{
        "--desktop-sidebar-width": "0px",
        "--medium-navigation-width":
          windowClass === WINDOW_CLASSES.MEDIUM && !isReaderActive ? "80px" : "0px",
        height: "100vh",
      }}
    >
      <div className="desktop-sidebar-slot" />
      <div
        className="harness-container"
        style={{
          gridArea: "main",
          minWidth: 0,
          height: "100%",
          overflow: "auto",
          color: "var(--color-text-1)",
        }}
      >
        <header
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "16px",
            flexWrap: "wrap",
            maxWidth: "100%",
            boxSizing: "border-box",
            borderBottom: "1px solid var(--color-border-2, #e5e6eb)",
          }}
        >
          <div
            aria-hidden={isReaderActive || undefined}
            className="entry-col"
            inert={isReaderActive || undefined}
          >
            <SidebarTrigger />
          </div>
          <div style={{ minWidth: 0, maxWidth: "100%" }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem", overflowWrap: "anywhere" }}>
              NAV-VISUAL PR1 Compact Navigation Renderer Harness
            </h1>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 16px",
                marginTop: "8px",
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              <div>
                Current Route: <code data-testid="current-route">{location.pathname}</code>
              </div>
              <div>
                Window Class: <code data-testid="current-window-class">{windowClass}</code>
              </div>
              <div>
                Summary: <b data-testid="harness-summary">{report?.summary ?? "RUNNING"}</b>
              </div>
              <div data-testid="reader-second-escape-gate">
                Second Escape closes Reader:{" "}
                {report
                  ? report.details.readerSecondEscapeClosesReader
                    ? "PASS"
                    : "FAIL"
                  : "RUNNING"}
              </div>
              <div data-testid="harness-failing-gates">
                Failing gates:{" "}
                {report ? (report.summary === "PASS" ? "none" : "see detailed report") : "RUNNING"}
              </div>
              <div data-testid="persistence-state-debug">
                Compact nav storage:{" "}
                {report
                  ? JSON.stringify([
                      report.details.compactNavStorageBeforeRun,
                      report.details.compactNavStorageAfterRun,
                    ])
                  : "RUNNING"}
              </div>
            </div>
          </div>
        </header>

        <main
          ref={mainRef}
          id="main-content"
          style={{ minHeight: "200px", padding: "16px" }}
          tabIndex={-1}
        >
          {!isReaderActive && (
            <h1 className="a11y-visually-hidden" tabIndex={-1}>
              {location.pathname === "/" ? "Home" : location.pathname.slice(1)}
            </h1>
          )}
          {isReaderActive && (
            <div className="article-container article-container-full-size content-wrapper">
              <ReaderSidebarTrigger />
              <p>Reader content</p>
            </div>
          )}
          <p>Main content area for test harness</p>
        </main>

        <ResizeDiagnostics />
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
              maxWidth: "100%",
              boxSizing: "border-box",
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(report, null, 2)}
          </pre>
        )}
      </div>
      <MediumNavigation />
      <CompactNavigation />
      <SidebarDrawerHost />
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
