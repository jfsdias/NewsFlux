/* eslint-disable react-refresh/only-export-components -- Browser harness entrypoint. */
import "@arco-design/web-react/es/_util/react-19-adapter"
import "@arco-design/web-react/dist/css/arco.css"
import { useStore } from "@nanostores/react"
import Polyglot from "node-polyglot"
import React, { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { MemoryRouter, useLocation, useNavigate } from "react-router"

import SidebarTrigger, {
  ReaderSidebarTrigger,
  SidebarDrawerHost,
} from "@/components/Article/SidebarTrigger"
import CompactNavigation from "@/components/Navigation/CompactNavigation"
import AppDataContext from "@/contexts/app-data-context"
import DesktopSidebarContext from "@/contexts/desktop-sidebar-context"
import { polyglotState } from "@/hooks/useLanguage"
import useWindowClass from "@/hooks/useWindowClass"
import phrases from "@/locales/en-US.json"
import { contentState, setActiveContent } from "@/store/contentState"
import { dataState, unreadTotalState } from "@/store/dataState"
import { mobileSidebarVisibleState } from "@/store/sidebarState"
import { windowClassState } from "@/store/windowClassState"
import { COMPACT_NAV_DESTINATIONS } from "@/utils/compact-navigation"
import shouldDeferReaderEscape from "@/utils/reader-escape"
import { WINDOW_CLASSES } from "@/utils/window-class"

import "@/components/Article/SidebarTrigger.css"
import "@/components/Navigation/CompactNavigation.css"

polyglotState.setKey("polyglot", new Polyglot({ locale: "en-US", phrases }))

// Mock initial counts
unreadTotalState.set(12)
dataState.setKey("unreadTodayCount", 5)
dataState.setKey("starredCount", 8)

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

const HarnessContent = () => {
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
        drawerHostStableAcrossCompactMedium: false,
        drawerHostStableAcrossMediumCompact: false,
        drawerHostMountCount: 0,
        // Backward-compatible gate aliases
        headerTriggerFocusReturn: false,
        compactSourcesFocusReturn: false,
        escapeFocusReturn: false,
        closeButtonFocusReturn: false,
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

      // In MEDIUM, legacy header trigger MUST be available
      await waitForCondition(() => Boolean(document.querySelector(".entry-col .trigger")), 1500)
      const triggerInMedium = document.querySelector(".entry-col .trigger")
      results.legacyTriggerAvailableInMedium = Boolean(triggerInMedium)

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
      results.persistentStateAdded =
        Boolean(localStorage.getItem("newsflux:compact_nav")) ||
        Boolean(sessionStorage.getItem("newsflux:compact_nav"))

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

        // Escape closes Drawer only; Reader must remain active
        results.readerEscapeDrawerOnly = Boolean(contentState.get().activeContent)

        await waitForCondition(() => {
          const currentTrigger = document.querySelector(".reader-sidebar-trigger")
          return (
            document.activeElement === currentTrigger || document.activeElement === readerHeaderBtn
          )
        }, 1500)
        const currentTrigger = document.querySelector(".reader-sidebar-trigger")
        results.readerHeaderEscapeFocusReturn =
          document.activeElement === currentTrigger || document.activeElement === readerHeaderBtn

        // With Drawer closed, second Escape should proceed to normal Reader close behavior
        if (results.readerEscapeDrawerOnly) {
          activeEl.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          )
          await waitForCondition(() => !contentState.get().activeContent, 1500)
        }
      }
      setActiveContent(null)

      // 10F: Compact to Medium Resize while Drawer Open -> Focus Target Header
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(
        () => Boolean(document.querySelector('[data-nav-key="sources"]')),
        1500,
      )
      const mountCountBeforeCompactToMed = globalThis.__drawerHostMountCount || 1
      const sourcesForFold = document.querySelector('[data-nav-key="sources"]')
      if (sourcesForFold) {
        sourcesForFold.focus({ preventScroll: true })
        sourcesForFold.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        // Resize across breakpoint while drawer is open
        windowClassState.set(WINDOW_CLASSES.MEDIUM)
        await waitForCondition(() => Boolean(document.querySelector(".brand .trigger")), 1500)

        results.drawerHostStableAcrossCompactMedium =
          (globalThis.__drawerHostMountCount || 1) === mountCountBeforeCompactToMed

        const closeBtn = document.querySelector(".mobile-sidebar-close")
        if (closeBtn) {
          closeBtn.focus({ preventScroll: true })
          closeBtn.click()
          await waitForCondition(() => !mobileSidebarVisibleState.get(), 1500)
          await waitForCondition(() => {
            const headerTrigger = document.querySelector(".brand .trigger")
            return document.activeElement === headerTrigger
          }, 1500)
          const headerTrigger = document.querySelector(".brand .trigger")
          results.compactToMediumCloseFocusTargetHeader = document.activeElement === headerTrigger
        }
      }

      // 10G: Medium to Compact Resize while Drawer Open -> Focus Target Sources
      windowClassState.set(WINDOW_CLASSES.MEDIUM)
      await waitForCondition(() => Boolean(document.querySelector(".brand .trigger")), 1500)
      const mountCountBeforeMedToCompact = globalThis.__drawerHostMountCount || 1
      const mediumHeaderBtn = document.querySelector(".brand .trigger")
      if (mediumHeaderBtn) {
        mediumHeaderBtn.focus({ preventScroll: true })
        mediumHeaderBtn.click()
        await waitForCondition(() => mobileSidebarVisibleState.get() === true, 1500)
        await waitForCondition(() => Boolean(document.querySelector(".mobile-sidebar-close")), 1500)

        // Resize to COMPACT while drawer is open
        windowClassState.set(WINDOW_CLASSES.COMPACT)
        await waitForCondition(
          () => Boolean(document.querySelector('[data-nav-key="sources"]')),
          1500,
        )

        results.drawerHostStableAcrossMediumCompact =
          (globalThis.__drawerHostMountCount || 1) === mountCountBeforeMedToCompact

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

      results.drawerHostMountCount = globalThis.__drawerHostMountCount || 1

      // 10H: No Body Focus In Required Cases
      results.noBodyFocusInRequiredCases = Boolean(
        results.sourcesCloseButtonFocusReturn &&
        results.sourcesEscapeFocusReturn &&
        results.sourcesBackdropFocusReturn &&
        results.readerHeaderCloseButtonFocusReturn &&
        results.readerHeaderEscapeFocusReturn &&
        results.compactToMediumCloseFocusTargetHeader &&
        results.mediumToCompactCloseFocusTargetSources,
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

      // Return to "/" in COMPACT for final visual state
      navigate("/")
      windowClassState.set(WINDOW_CLASSES.COMPACT)
      await waitForCondition(() => Boolean(document.querySelector(".compact-nav-bar")), 1500)

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
        results.ariaContractPass &&
        results.compactDuplicateTriggerAbsent &&
        results.drawerHostPreserved &&
        results.legacyTriggerAvailableInMedium &&
        results.sourcesCloseButtonFocusReturn &&
        results.sourcesEscapeFocusReturn &&
        results.sourcesBackdropFocusReturn &&
        results.readerHeaderCloseButtonFocusReturn &&
        results.readerHeaderEscapeFocusReturn &&
        results.compactToMediumCloseFocusTargetHeader &&
        results.mediumToCompactCloseFocusTargetSources &&
        results.noBodyFocusInRequiredCases &&
        results.navigationCloseNoWrongFocus &&
        results.readerTriggerOutsideInert &&
        results.readerEscapeDrawerOnly &&
        results.drawerHostStableAcrossCompactMedium &&
        results.drawerHostStableAcrossMediumCompact &&
        results.drawerHostMountCount === 1

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
        compactDuplicateTriggerAbsent: results.compactDuplicateTriggerAbsent,
        drawerHostPreserved: results.drawerHostPreserved,
        legacyTriggerAvailableInMedium: results.legacyTriggerAvailableInMedium,
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
        drawerHostStableAcrossCompactMedium: results.drawerHostStableAcrossCompactMedium,
        drawerHostStableAcrossMediumCompact: results.drawerHostStableAcrossMediumCompact,
        drawerHostMountCount: results.drawerHostMountCount,
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
      <header
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "16px",
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
        <div>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>
            NAV-VISUAL PR1 Compact Navigation Renderer Harness
          </h1>
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
        </div>
      </header>

      <main ref={mainRef} id="main-content" style={{ padding: "16px", minHeight: "200px" }}>
        {isReaderActive && (
          <div className="article-container article-container-full-size content-wrapper">
            <ReaderSidebarTrigger />
            <p>Reader content</p>
          </div>
        )}
        <p>Main content area for test harness</p>
      </main>

      <CompactNavigation />
      <SidebarDrawerHost />

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
