import { Button, Dropdown, Menu, Notification, Popconfirm, Radio } from "@arco-design/web-react"
import {
  IconAlignLeft,
  IconCheck,
  IconClockCircle,
  IconDragDot,
  IconRecord,
  IconRefresh,
  IconStarFill,
} from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useNavigate } from "react-router"

import { markEntriesAsReadInBatches, updateEntriesStatusInBatches } from "@/apis"
import AccessibleModal from "@/components/ui/AccessibleModal"
import CustomTooltip from "@/components/ui/CustomTooltip"
import { polyglotState } from "@/hooks/useLanguage"
import useRefreshCounts from "@/hooks/useRefreshCounts"
import {
  contentState,
  invalidateArticleList,
  setActiveContent,
  setEntries,
  setTotal,
} from "@/store/contentState"
import {
  getDataSessionRevision,
  isEntryScopeFullyVisible,
  visibleCategoriesState,
  visibleFeedsState,
} from "@/store/dataState"
import { settingsState, updateSettings } from "@/store/settingsState"
import {
  AGE_BASED_READ_PRESETS,
  getAgeReadConfirmationBoundaries,
  markAgeBasedUnreadEntriesAsRead,
} from "@/utils/age-based-mark-read"
import { hasArticleListFilters } from "@/utils/article-list-filters"
import createArticleListRequestKey from "@/utils/article-list-request-key"
import { get24HoursAgoTimestamp } from "@/utils/date"
import { runEntryMutation } from "@/utils/entry-mutation-state"
import {
  clampFloatingPosition,
  createFloatingPositionBounds,
  denormalizeFloatingPosition,
  normalizeFloatingPosition,
  parseFloatingPositionPreference,
} from "@/utils/floating-mark-all-position"
import {
  getMarkAllReadUndoNotificationId,
  MARK_ALL_READ_UNDO_DURATION_MS,
  markAllReadOperationCoordinator,
  markAllReadUndoActions,
  performCoordinatedMarkAllReadUndo,
} from "@/utils/mark-all-read-undo"
import reconcileEntriesAfterMarkRead from "@/utils/reconcile-entries-after-mark-read"
import { getNextUnreadSource } from "@/utils/source-navigation"
import "./FooterPanel.css"

const updateEntriesAsRead = (entryIds) => {
  const { activeContent } = contentState.get()
  const { showStatus } = settingsState.get()
  const markedEntryIds = new Set(entryIds)
  if (activeContent && markedEntryIds.has(activeContent.id)) {
    setActiveContent({ ...activeContent, status: "read" })
  }
  setEntries((prev) => reconcileEntriesAfterMarkRead(prev, markedEntryIds, showStatus))
}

const handleFilterChange = (value) => {
  updateSettings({ showStatus: value })
}

const MARK_ALL_READ_POSITION_STORAGE_KEY = "newsflux:ux-reach-01:mark-all-read-position"
const FLOATING_MARK_ALL_MEDIA = "(any-pointer: coarse) and (max-width: 1114px)"
const FLOATING_DIAGNOSTIC_QUERY_PARAM = "ux_reach_02_diag"
const readPositionPreference = () => {
  try {
    return parseFloatingPositionPreference(
      globalThis.localStorage.getItem(MARK_ALL_READ_POSITION_STORAGE_KEY),
    )
  } catch {
    return null
  }
}
const stopDragHandleClick = (event) => {
  event.preventDefault()
  event.stopPropagation()
}

const MarkAllReadButton = ({ disabled, from, hidden = false, id, loading, onConfirm }) => {
  const { polyglot } = useStore(polyglotState)
  const { skipMarkAllReadConfirmation } = useStore(settingsState, {
    keys: ["skipMarkAllReadConfirmation"],
  })

  const isHidden = hidden || from === "history"
  const markAllReadLabel = polyglot.t("article_list.mark_all_as_read_tooltip")
  const positionHelp = polyglot.t("article_list.mark_all_as_read_position_help")
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [isFloating, setIsFloating] = useState(false)
  const [diagnosticsEnabled] = useState(
    () =>
      new URLSearchParams(globalThis.location?.search ?? "").get(
        FLOATING_DIAGNOSTIC_QUERY_PARAM,
      ) === "1",
  )
  const [diagnosticSnapshot, setDiagnosticSnapshot] = useState(null)
  const [position, setPosition] = useState(null)
  const triggerRef = useRef(null)
  const floatingControlRef = useRef(null)
  const floatingPositionRef = useRef(null)
  const defaultPositionRatiosRef = useRef(null)
  const isFloatingRef = useRef(false)
  const pointerDragRef = useRef(null)
  const diagnosticPointerEventsRef = useRef({ down: 0, move: 0, up: 0, cancel: 0, lostCapture: 0 })
  const suppressNextClickRef = useRef(false)
  const suppressClickTimerRef = useRef(null)
  const getScopedListIdentity = useCallback(
    () =>
      JSON.stringify([
        createArticleListRequestKey({
          content: contentState.get(),
          settings: settingsState.get(),
          info: { from, id },
        }),
        getDataSessionRevision(),
      ]),
    [from, id],
  )
  const scopedListIdentity = getScopedListIdentity()
  const [pendingFocusReturn, setPendingFocusReturn] = useState(null)

  const captureFloatingDiagnostics = useCallback(() => {
    const control = floatingControlRef.current
    const button = control?.querySelector(".arco-btn-shape-circle")
    const handle = control?.querySelector(".mark-all-read-drag-handle")
    const sidebar = globalThis.document.querySelector(".desktop-sidebar-slot .sidebar")
    const rect = (element) => {
      if (!element) {
        return null
      }
      const { bottom, height, left, right, top, width } = element.getBoundingClientRect()
      return { left, top, right, bottom, width, height }
    }
    const handleRect = rect(handle)
    const handleCenter =
      handleRect?.width > 0 &&
      handleRect.height > 0 &&
      globalThis.document.elementFromPoint(
        handleRect.left + handleRect.width / 2,
        handleRect.top + handleRect.height / 2,
      )
    const handleStyle = handle ? globalThis.getComputedStyle(handle) : null
    const topHit = handleCenter
      ? {
          tag: handleCenter.tagName.toLowerCase(),
          classes:
            typeof handleCenter.className === "string"
              ? handleCenter.className.trim().split(/\s+/).filter(Boolean).slice(0, 4)
              : [],
          insideHandle: Boolean(handle?.contains(handleCenter)),
        }
      : null
    const media = (query) => globalThis.matchMedia(query).matches

    setDiagnosticSnapshot({
      viewport: {
        innerWidth: globalThis.innerWidth,
        innerHeight: globalThis.innerHeight,
        visualViewportWidth: globalThis.visualViewport?.width ?? null,
        visualViewportHeight: globalThis.visualViewport?.height ?? null,
        devicePixelRatio: globalThis.devicePixelRatio,
        screenWidth: globalThis.screen.width,
        screenHeight: globalThis.screen.height,
      },
      pointerMedia: {
        anyPointerCoarse: media("(any-pointer: coarse)"),
        pointerCoarse: media("(pointer: coarse)"),
        anyPointerFine: media("(any-pointer: fine)"),
        maxWidth1024: media("(max-width: 1024px)"),
        maxWidth1114: media("(max-width: 1114px)"),
        activationQueryMatches: media(FLOATING_MARK_ALL_MEDIA),
      },
      floating: {
        reactStateActive: isFloating,
        classActive: Boolean(control?.classList.contains("mark-all-read-floating--active")),
        rootDisplay: control ? globalThis.getComputedStyle(control).display : "NOT_MOUNTED",
        handleDisplay: handleStyle?.display ?? "NOT_MOUNTED",
        handleRect,
        buttonRect: rect(button),
        sidebarRect: rect(sidebar),
        handleHitTestAvailable: Boolean(handleCenter),
        handleCenterHit: topHit,
        pointerEvents: { ...diagnosticPointerEventsRef.current },
      },
    })
  }, [isFloating])

  useEffect(() => {
    if (!diagnosticsEnabled) {
      return
    }

    let frame = null
    const scheduleCapture = () => {
      if (frame !== null) {
        globalThis.cancelAnimationFrame(frame)
      }
      frame = globalThis.requestAnimationFrame(() => {
        frame = null
        captureFloatingDiagnostics()
      })
    }
    const viewport = globalThis.visualViewport
    const mediaQueries = [
      globalThis.matchMedia("(any-pointer: coarse)"),
      globalThis.matchMedia("(pointer: coarse)"),
      globalThis.matchMedia("(any-pointer: fine)"),
      globalThis.matchMedia("(max-width: 1024px)"),
      globalThis.matchMedia("(max-width: 1114px)"),
      globalThis.matchMedia(FLOATING_MARK_ALL_MEDIA),
    ]
    const handle = floatingControlRef.current?.querySelector(".mark-all-read-drag-handle")
    const pointerEvents = diagnosticPointerEventsRef.current
    const eventTypes = [
      ["pointerdown", "down"],
      ["pointermove", "move"],
      ["pointerup", "up"],
      ["pointercancel", "cancel"],
      ["lostpointercapture", "lostCapture"],
    ]
    const listeners = eventTypes.map(([type, key]) => {
      const listener = () => {
        pointerEvents[key] += 1
        if (key !== "move") {
          scheduleCapture()
        }
      }
      handle?.addEventListener(type, listener, { capture: true, passive: true })
      return [type, listener]
    })
    const rootObserver = new MutationObserver(scheduleCapture)
    if (floatingControlRef.current) {
      rootObserver.observe(floatingControlRef.current, {
        attributes: true,
        attributeFilter: ["class"],
      })
    }
    const sizeObserver = new ResizeObserver(scheduleCapture)
    sizeObserver.observe(globalThis.document.documentElement)
    if (floatingControlRef.current) {
      sizeObserver.observe(floatingControlRef.current)
    }

    globalThis.addEventListener("resize", scheduleCapture)
    globalThis.addEventListener("orientationchange", scheduleCapture)
    viewport?.addEventListener("resize", scheduleCapture)
    viewport?.addEventListener("scroll", scheduleCapture)
    for (const query of mediaQueries) {
      query.addEventListener?.("change", scheduleCapture)
    }
    scheduleCapture()

    return () => {
      globalThis.removeEventListener("resize", scheduleCapture)
      globalThis.removeEventListener("orientationchange", scheduleCapture)
      viewport?.removeEventListener("resize", scheduleCapture)
      viewport?.removeEventListener("scroll", scheduleCapture)
      for (const query of mediaQueries) {
        query.removeEventListener?.("change", scheduleCapture)
      }
      for (const [type, listener] of listeners) {
        handle?.removeEventListener(type, listener, { capture: true })
      }
      rootObserver.disconnect()
      sizeObserver.disconnect()
      if (frame !== null) {
        globalThis.cancelAnimationFrame(frame)
      }
    }
  }, [captureFloatingDiagnostics, diagnosticsEnabled])

  const getFloatingBounds = useCallback(() => {
    const control = floatingControlRef.current
    if (!control) {
      return null
    }

    const actionButton = control.querySelector(".arco-btn-shape-circle")
    if (!actionButton) {
      return null
    }

    const rect = actionButton.getBoundingClientRect()
    const style = globalThis.getComputedStyle(control)
    const readSafeArea = (side) =>
      Number.parseFloat(style.getPropertyValue(`--mark-all-safe-${side}`)) || 0

    const mediumNavigation = globalThis.document.querySelector(".medium-navigation-rail")
    const compactNavigation = globalThis.document.querySelector(".compact-nav-bar")
    const desktopSidebar = globalThis.document.querySelector(".desktop-sidebar-slot .sidebar")
    const mediumNavigationRight = mediumNavigation?.getBoundingClientRect().right ?? 0
    const desktopSidebarRight = desktopSidebar?.getBoundingClientRect().right ?? 0
    const compactNavigationHeight = compactNavigation?.getBoundingClientRect().height ?? 0
    const safeBottom = readSafeArea("bottom")

    return createFloatingPositionBounds({
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      controlWidth: Math.max(48, rect.width),
      controlHeight: Math.max(48, rect.height),
      safeArea: {
        top: readSafeArea("top"),
        right: readSafeArea("right"),
        bottom: Math.max(safeBottom, compactNavigationHeight),
        left: Math.max(readSafeArea("left"), mediumNavigationRight, desktopSidebarRight),
      },
    })
  }, [])

  const applyFloatingPosition = useCallback((nextPosition) => {
    floatingPositionRef.current = nextPosition
    setPosition(nextPosition)
  }, [])

  const persistFloatingPosition = useCallback(
    (nextPosition) => {
      const bounds = getFloatingBounds()
      if (!bounds) {
        return
      }

      const normalized = normalizeFloatingPosition(nextPosition, bounds)
      try {
        globalThis.localStorage.setItem(
          MARK_ALL_READ_POSITION_STORAGE_KEY,
          JSON.stringify({ version: 1, ...normalized }),
        )
      } catch {
        // Local placement is optional; blocked storage must not affect Mark All.
      }
    },
    [getFloatingBounds],
  )

  const cancelPointerDrag = useCallback(
    (eventOrPointerId) => {
      const pointerId =
        typeof eventOrPointerId === "number" ? eventOrPointerId : eventOrPointerId.pointerId
      const drag = pointerDragRef.current
      if (!drag || drag.pointerId !== pointerId) {
        return
      }

      pointerDragRef.current = null
      applyFloatingPosition(drag.origin)
      suppressNextClickRef.current = true
      if (suppressClickTimerRef.current !== null) {
        globalThis.clearTimeout(suppressClickTimerRef.current)
      }
      suppressClickTimerRef.current = globalThis.setTimeout(() => {
        suppressNextClickRef.current = false
        suppressClickTimerRef.current = null
      }, 500)
    },
    [applyFloatingPosition],
  )

  useLayoutEffect(() => {
    const mediaQuery = globalThis.matchMedia(FLOATING_MARK_ALL_MEDIA)
    const activateFloatingControl = () => {
      const control = floatingControlRef.current
      const bounds = getFloatingBounds()
      if (!control || !bounds) {
        return
      }

      const actionButton = control.querySelector(".arco-btn-shape-circle")
      if (!actionButton) {
        return
      }

      const rect = actionButton.getBoundingClientRect()
      const defaultPosition = clampFloatingPosition({ x: rect.left, y: rect.top }, bounds)
      defaultPositionRatiosRef.current = normalizeFloatingPosition(defaultPosition, bounds)
      const storedPosition = readPositionPreference()
      const nextPosition = storedPosition
        ? denormalizeFloatingPosition(storedPosition, bounds)
        : defaultPosition

      isFloatingRef.current = true
      setIsFloating(true)
      applyFloatingPosition(nextPosition)
    }

    const reconcileModeAndPosition = () => {
      if (!mediaQuery.matches) {
        if (isFloatingRef.current) {
          isFloatingRef.current = false
          setIsFloating(false)
          setPosition(null)
          floatingPositionRef.current = null
        }
        return
      }

      if (!isFloatingRef.current) {
        activateFloatingControl()
        return
      }

      const activeDrag = pointerDragRef.current
      if (activeDrag) {
        cancelPointerDrag(activeDrag.pointerId)
      }

      const bounds = getFloatingBounds()
      if (!bounds) {
        return
      }

      const storedPosition = readPositionPreference()
      const defaultPosition = defaultPositionRatiosRef.current
        ? denormalizeFloatingPosition(defaultPositionRatiosRef.current, bounds)
        : floatingPositionRef.current
      const nextPosition = storedPosition
        ? denormalizeFloatingPosition(storedPosition, bounds)
        : clampFloatingPosition(defaultPosition, bounds)
      applyFloatingPosition(nextPosition)
    }

    let resizeFrame = null
    const handleResize = () => {
      reconcileModeAndPosition()
      if (resizeFrame !== null) {
        globalThis.cancelAnimationFrame(resizeFrame)
      }
      resizeFrame = globalThis.requestAnimationFrame(() => {
        resizeFrame = null
        reconcileModeAndPosition()
      })
    }

    reconcileModeAndPosition()
    globalThis.addEventListener("resize", handleResize)
    mediaQuery.addEventListener?.("change", reconcileModeAndPosition)
    return () => {
      globalThis.removeEventListener("resize", handleResize)
      mediaQuery.removeEventListener?.("change", reconcileModeAndPosition)
      if (resizeFrame !== null) {
        globalThis.cancelAnimationFrame(resizeFrame)
      }
      if (suppressClickTimerRef.current !== null) {
        globalThis.clearTimeout(suppressClickTimerRef.current)
      }
    }
  }, [applyFloatingPosition, cancelPointerDrag, getFloatingBounds])

  const handleDragPointerDown = (event) => {
    if (!isFloatingRef.current || disabled || loading || event.button !== 0) {
      return
    }

    const origin = floatingPositionRef.current
    if (!origin) {
      return
    }

    pointerDragRef.current = {
      pointerId: event.pointerId,
      origin,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      cancelPointerDrag(event.pointerId)
    }
  }

  const handleDragPointerMove = (event) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 6) {
      return
    }

    drag.moved = true
    const bounds = getFloatingBounds()
    if (bounds) {
      applyFloatingPosition(
        clampFloatingPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, bounds),
      )
    }
  }

  const finishPointerDrag = (event) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    pointerDragRef.current = null
    if (!drag.moved) {
      return
    }

    const nextPosition = floatingPositionRef.current
    persistFloatingPosition(nextPosition)
    suppressNextClickRef.current = true
    if (suppressClickTimerRef.current !== null) {
      globalThis.clearTimeout(suppressClickTimerRef.current)
    }
    suppressClickTimerRef.current = globalThis.setTimeout(() => {
      suppressNextClickRef.current = false
      suppressClickTimerRef.current = null
    }, 500)
  }

  const handleActionClick = (event) => {
    if (suppressNextClickRef.current && event.detail > 0) {
      suppressNextClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }

    if (skipMarkAllReadConfirmation) {
      onConfirm()
    }
  }

  const handleActionKeyDown = (event) => {
    if (!isFloatingRef.current) {
      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      event.stopPropagation()
      const bounds = getFloatingBounds()
      if (bounds && defaultPositionRatiosRef.current) {
        const resetPosition = denormalizeFloatingPosition(defaultPositionRatiosRef.current, bounds)
        applyFloatingPosition(resetPosition)
        try {
          globalThis.localStorage.removeItem(MARK_ALL_READ_POSITION_STORAGE_KEY)
        } catch {
          // The visible control remains reset even when storage is unavailable.
        }
      }
      return
    }

    if (!event.shiftKey || !event.key.startsWith("Arrow")) {
      return
    }

    const delta = {
      ArrowDown: { x: 0, y: 16 },
      ArrowLeft: { x: -16, y: 0 },
      ArrowRight: { x: 16, y: 0 },
      ArrowUp: { x: 0, y: -16 },
    }[event.key]
    const bounds = getFloatingBounds()
    if (!delta || !bounds || !floatingPositionRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const nextPosition = clampFloatingPosition(
      {
        x: floatingPositionRef.current.x + delta.x,
        y: floatingPositionRef.current.y + delta.y,
      },
      bounds,
    )
    applyFloatingPosition(nextPosition)
    persistFloatingPosition(nextPosition)
  }

  const handleVisibleChange = (visible) => {
    setConfirmVisible(visible)
  }

  const handleConfirm = async () => {
    const confirmedListIdentity = scopedListIdentity
    await onConfirm()
    setPendingFocusReturn(confirmedListIdentity)
  }

  // Wait for Arco to close and the async trigger to become enabled again.
  useEffect(() => {
    if (!pendingFocusReturn || confirmVisible || disabled || loading) {
      return
    }

    const frame = requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (
        trigger?.isConnected &&
        !trigger.disabled &&
        getScopedListIdentity() === pendingFocusReturn &&
        document.activeElement !== trigger
      ) {
        trigger.focus({ preventScroll: true })
      }
      setPendingFocusReturn(null)
    })

    return () => cancelAnimationFrame(frame)
  }, [
    confirmVisible,
    disabled,
    getScopedListIdentity,
    loading,
    pendingFocusReturn,
    scopedListIdentity,
  ])

  const positionKeyboardShortcuts = isFloating
    ? "Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Home"
    : undefined
  const button = (
    <CustomTooltip mini content={markAllReadLabel}>
      <Button
        ref={triggerRef}
        aria-busy={loading}
        aria-describedby={isFloating ? "mark-all-read-position-help" : undefined}
        aria-expanded={skipMarkAllReadConfirmation ? undefined : confirmVisible}
        aria-keyshortcuts={positionKeyboardShortcuts}
        aria-label={markAllReadLabel}
        className="nf-glass-control"
        disabled={disabled || loading}
        icon={<IconCheck aria-hidden="true" />}
        loading={loading}
        shape="circle"
        onClick={handleActionClick}
        onKeyDown={handleActionKeyDown}
      >
        <span
          aria-hidden="true"
          className="mark-all-read-drag-handle"
          data-testid="mark-all-read-drag-handle"
          onClick={stopDragHandleClick}
          onLostPointerCapture={cancelPointerDrag}
          onPointerCancel={cancelPointerDrag}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={finishPointerDrag}
        >
          <IconDragDot aria-hidden="true" />
        </span>
      </Button>
    </CustomTooltip>
  )

  const confirmationWrappedButton = skipMarkAllReadConfirmation ? (
    button
  ) : (
    <Popconfirm
      autoFocus
      focusLock
      cancelText={polyglot.t("search.cancel")}
      className="mark-all-read-popconfirm"
      okText={polyglot.t("sidebar.context_menu.mark_all_as_read")}
      popupVisible={confirmVisible}
      title={polyglot.t("article_list.mark_all_as_read_confirm")}
      triggerProps={{
        boundaryDistance: { bottom: 8, left: 8, right: 8, top: 8 },
      }}
      onOk={handleConfirm}
      onVisibleChange={handleVisibleChange}
    >
      {button}
    </Popconfirm>
  )

  return (
    <div
      ref={floatingControlRef}
      aria-hidden={isHidden || undefined}
      className={`mark-all-read-floating${isFloating ? " mark-all-read-floating--active" : ""}`}
      style={{
        ...(isFloating && position ? { left: `${position.x}px`, top: `${position.y}px` } : {}),
        visibility: isHidden ? "hidden" : undefined,
        pointerEvents: isHidden ? "none" : undefined,
      }}
    >
      {diagnosticsEnabled && (
        <pre
          aria-hidden="true"
          data-testid="ux-reach-02-diagnostic-panel"
          style={{
            position: "fixed",
            zIndex: 2_147_483_647,
            top: 8,
            left: 8,
            boxSizing: "border-box",
            width: "min(360px, calc(100vw - 16px))",
            maxHeight: "45vh",
            margin: 0,
            padding: 8,
            overflow: "hidden",
            border: "1px solid #8892a0",
            borderRadius: 6,
            background: "rgba(12, 16, 22, 0.94)",
            color: "#f4f6f8",
            font: "10px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            pointerEvents: "none",
          }}
        >
          {diagnosticSnapshot
            ? JSON.stringify(diagnosticSnapshot, null, 2)
            : "Collecting viewport diagnostics…"}
        </pre>
      )}
      {isFloating && (
        <span className="visually-hidden" id="mark-all-read-position-help">
          {positionHelp}
        </span>
      )}
      <span className="mark-all-read-floating-trigger">{confirmationWrappedButton}</span>
    </div>
  )
}

const FooterPanel = ({
  getEntries,
  info,
  refreshArticleList,
  bulkOperationsDisabled = false,
  onMarkAllReadJumpPendingChange,
}) => {
  const { from: source, id: sourceId } = info
  const { isArticleListReady } = useStore(contentState, { keys: ["isArticleListReady"] })
  const { activeContent } = useStore(contentState, { keys: ["activeContent"] })
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const markingAllReadRef = useRef(false)
  const [markingOlderRead, setMarkingOlderRead] = useState(false)
  const markingOlderReadRef = useRef(false)
  const [ageMenuVisible, setAgeMenuVisible] = useState(false)
  const ageMenuTriggerRef = useRef(null)
  const [agePresetDays, setAgePresetDays] = useState(null)
  const listScopeRef = useRef({ from: source, id: sourceId })

  useEffect(() => {
    if (!ageMenuVisible) {
      return
    }

    const handleAgeMenuEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return
      }

      event.preventDefault()
      setAgeMenuVisible(false)
      requestAnimationFrame(() => ageMenuTriggerRef.current?.focus({ preventScroll: true }))
    }

    document.addEventListener("keydown", handleAgeMenuEscape)
    return () => document.removeEventListener("keydown", handleAgeMenuEscape)
  }, [ageMenuVisible])

  useEffect(() => {
    if (
      listScopeRef.current.from !== source ||
      String(listScopeRef.current.id ?? "") !== String(sourceId ?? "")
    ) {
      onMarkAllReadJumpPendingChange?.(null)
    }
    listScopeRef.current = { from: source, id: sourceId }
  }, [onMarkAllReadJumpPendingChange, source, sourceId])
  const { markAllReadJumpToNext, showStatus } = useStore(settingsState, {
    keys: ["markAllReadJumpToNext", "showStatus"],
  })
  const { polyglot } = useStore(polyglotState)
  const categories = useStore(visibleCategoriesState)
  const feeds = useStore(visibleFeedsState)
  const refreshCounts = useRefreshCounts()
  const navigate = useNavigate()
  const refreshLabel = polyglot.t("article_list.refresh_tooltip")
  const getCurrentListIdentity = () => {
    const { from, id } = listScopeRef.current
    const content = { ...contentState.get(), infoFrom: from, infoId: id }
    return createArticleListRequestKey({
      content,
      settings: settingsState.get(),
      info: { from, id },
      sessionRevision: getDataSessionRevision(),
    })
  }

  const handleUndoMarkAllRead = async (token) => {
    await performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onConsume: (consumedToken) =>
        Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
      onError: () => {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
        })
      },
    })
  }

  const handleUndoOlderRead = async (token) => {
    await performCoordinatedMarkAllReadUndo({
      token,
      getCurrentSessionRevision: getDataSessionRevision,
      updateEntriesStatusInBatches,
      refreshCounts,
      invalidateArticleList,
      onConsume: (consumedToken) =>
        Notification.remove(getMarkAllReadUndoNotificationId(consumedToken)),
      onError: () => {
        Notification.error({
          title: polyglot.t("article_list.mark_older_as_read_error"),
        })
      },
    })
  }

  const jumpToNext = () => {
    const next = getNextUnreadSource({ type: source, id: sourceId }, categories, feeds)
    if (next) {
      navigate(`/${next.type}/${next.id}`)
      return true
    }
    return false
  }

  const handleMarkAllAsRead = async () => {
    if (
      markingAllReadRef.current ||
      !contentState.get().isArticleListReady ||
      source === "history"
    ) {
      return
    }

    const content = { ...contentState.get(), infoFrom: source, infoId: sourceId }
    const settings = settingsState.get()
    const sessionRevision = getDataSessionRevision()
    const markedEntryIds = new Set()
    const requestKey = getCurrentListIdentity()
    const filteredUnreadQuery = settings.showStatus === "unread" && hasArticleListFilters(content)
    let jumpedToNext = false
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentList = () => isCurrentSession() && requestKey === getCurrentListIdentity()
    const starred = ["feed", "category"].includes(source) && settings.showStatus === "starred"
    const scope = ["feed", "category"].includes(source) ? source : "global"
    const filterParams = {
      filterDate: source === "today" ? null : content.filterDate,
      globally_visible: !isEntryScopeFullyVisible(scope, sourceId),
      order: source === "starred" ? "changed_at" : settings.orderBy,
      direction: settings.orderDirection,
      ...(content.filterString && { search: content.filterString }),
      ...(source === "today" && { published_after: get24HoursAgoTimestamp() }),
    }

    const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
    if (operationLease === null) {
      return
    }

    markingAllReadRef.current = true
    setMarkingAllRead(true)
    if (
      markAllReadJumpToNext &&
      ["feed", "category"].includes(source) &&
      settings.showStatus === "unread" &&
      content.entries.length > 0
    ) {
      onMarkAllReadJumpPendingChange?.(getCurrentListIdentity())
    }
    try {
      await runEntryMutation(() => {
        return markEntriesAsReadInBatches(
          (status, options) => getEntries(status, starred, options),
          {
            filterParams,
            onBatchMarkedRead: (entryIds) => {
              const newlyAcknowledgedIds = new Set()
              for (const entryId of entryIds) {
                if (!markedEntryIds.has(entryId)) {
                  newlyAcknowledgedIds.add(entryId)
                }
                markedEntryIds.add(entryId)
              }
              if (isCurrentList()) {
                updateEntriesAsRead(entryIds)
                if (filteredUnreadQuery && newlyAcknowledgedIds.size > 0) {
                  setTotal((total) => Math.max(0, total - newlyAcknowledgedIds.size))
                }
              }
            },
          },
        )
      })

      if (!isCurrentSession()) {
        return
      }
      await refreshCounts({ force: true })
      if (!isCurrentSession()) {
        return
      }

      const previousUndoToken = markAllReadUndoActions.getCurrentToken()
      markAllReadUndoActions.clear()
      if (previousUndoToken !== null) {
        Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
      }
      const undoEntryIds = [...markedEntryIds]
      if (undoEntryIds.length > 0) {
        let token
        token = markAllReadUndoActions.replace(
          { entryIds: undoEntryIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
          },
        )
        Notification.success({
          id: getMarkAllReadUndoNotificationId(token),
          title: polyglot.t("article_list.mark_all_as_read_success"),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoMarkAllRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => markAllReadUndoActions.clear(token),
        })
      } else {
        Notification.success({
          title: polyglot.t("article_list.mark_all_as_read_success"),
        })
      }
      if (markAllReadJumpToNext && isCurrentList()) {
        jumpedToNext = jumpToNext()
      }
    } catch (error) {
      onMarkAllReadJumpPendingChange?.(null)
      if (!isCurrentSession()) {
        return
      }
      console.error("Failed to mark all as read:", error)
      if (isCurrentList()) {
        await refreshArticleList()
      }
      await refreshCounts({ force: true })
      if (isCurrentSession()) {
        Notification.error({
          title: polyglot.t("article_list.mark_all_as_read_error"),
        })
      }
    } finally {
      if (!jumpedToNext) {
        onMarkAllReadJumpPendingChange?.(null)
      }
      markAllReadOperationCoordinator.release(operationLease)
      markingAllReadRef.current = false
      setMarkingAllRead(false)
    }
  }

  const handleConfirmOlderRead = async () => {
    const ageDays = agePresetDays
    const { from: confirmedSource, id: confirmedSourceId } = listScopeRef.current
    if (
      !ageDays ||
      markingOlderReadRef.current ||
      markingAllReadRef.current ||
      !contentState.get().isArticleListReady ||
      confirmedSource === "history"
    ) {
      setAgePresetDays(null)
      return
    }

    const confirmedAtMs = Date.now()
    const { cutoff, publishedAfter } = getAgeReadConfirmationBoundaries(
      ageDays,
      confirmedSource,
      confirmedAtMs,
    )
    const content = { ...contentState.get(), infoFrom: confirmedSource, infoId: confirmedSourceId }
    const settings = settingsState.get()
    const sessionRevision = getDataSessionRevision()
    const requestKey = getCurrentListIdentity()
    const isCurrentSession = () => sessionRevision === getDataSessionRevision()
    const isCurrentList = () => isCurrentSession() && requestKey === getCurrentListIdentity()
    const starred =
      ["feed", "category"].includes(confirmedSource) && settings.showStatus === "starred"
    const scope = ["feed", "category"].includes(confirmedSource) ? confirmedSource : "global"
    const filterParams = {
      filterDate: confirmedSource === "today" ? null : content.filterDate,
      globally_visible: !isEntryScopeFullyVisible(scope, confirmedSourceId),
      order: confirmedSource === "starred" ? "changed_at" : settings.orderBy,
      direction: settings.orderDirection,
      ...(content.filterString && { search: content.filterString }),
      ...(confirmedSource === "today" && { published_after: publishedAfter }),
    }

    const operationLease = markAllReadOperationCoordinator.acquire(sessionRevision)
    if (operationLease === null) {
      setAgePresetDays(null)
      return
    }

    markingOlderReadRef.current = true
    setMarkingOlderRead(true)
    try {
      // Reuse the confirmation-time boundaries throughout discovery and mutation.
      const result = await runEntryMutation(() =>
        markAgeBasedUnreadEntriesAsRead({
          cutoff,
          fetchEntries: (status, options) => getEntries(status, starred, options),
          filterParams,
          getSessionRevision: getDataSessionRevision,
          isCurrentList,
          sessionRevision,
          updateEntriesStatusInBatches,
          onBatchAcknowledged: (entryIds) => {
            if (isCurrentList()) {
              updateEntriesAsRead(entryIds)
            }
          },
        }),
      )

      if (!isCurrentSession() || result.status === "stale") {
        return
      }
      if (result.status === "empty") {
        return
      }

      await refreshCounts({ force: true })
      if (!isCurrentSession()) {
        return
      }
      if (isCurrentList()) {
        invalidateArticleList()
      }

      if (result.status === "success" || result.status === "partial") {
        const previousUndoToken = markAllReadUndoActions.getCurrentToken()
        markAllReadUndoActions.clear()
        if (previousUndoToken !== null) {
          Notification.remove(getMarkAllReadUndoNotificationId(previousUndoToken))
        }

        let token
        token = markAllReadUndoActions.replace(
          { entryIds: result.acknowledgedIds, sessionRevision },
          {
            durationMs: MARK_ALL_READ_UNDO_DURATION_MS,
            onExpire: () => Notification.remove(getMarkAllReadUndoNotificationId(token)),
          },
        )
        const notification = {
          id: getMarkAllReadUndoNotificationId(token),
          duration: MARK_ALL_READ_UNDO_DURATION_MS,
          btn: (
            <Button size="small" onClick={() => void handleUndoOlderRead(token)}>
              {polyglot.t("actions.undo")}
            </Button>
          ),
          onClose: () => markAllReadUndoActions.clear(token),
        }

        if (result.status === "partial") {
          Notification.warning({
            ...notification,
            title: polyglot.t("article_list.mark_older_as_read_partial", {
              marked: result.acknowledgedIds.length,
              total: result.requestedCount,
            }),
          })
        } else {
          Notification.success({
            ...notification,
            title: polyglot.t("article_list.mark_older_as_read_success", {
              smart_count: result.acknowledgedIds.length,
            }),
          })
        }
      } else {
        console.error("Failed to mark older articles as read:", result.error)
        Notification.error({
          title: polyglot.t("article_list.mark_older_as_read_error"),
          content: result.error?.message,
        })
      }
    } finally {
      markAllReadOperationCoordinator.release(operationLease)
      markingOlderReadRef.current = false
      setMarkingOlderRead(false)
      setAgePresetDays(null)
    }
  }

  const getAgePresetLabel = (days) =>
    polyglot.t("article_list.mark_older_as_read_preset", {
      age: polyglot.t("date.days", days),
    })

  const markOlderReadLabel = polyglot.t("article_list.mark_older_as_read_tooltip")
  const agePresetTitle =
    agePresetDays === null ? markOlderReadLabel : getAgePresetLabel(agePresetDays)
  const agePresetMenu = (
    <Menu
      onClickMenuItem={(key) => {
        setAgeMenuVisible(false)
        setAgePresetDays(Number(key))
      }}
    >
      {AGE_BASED_READ_PRESETS.map((days) => (
        <Menu.Item key={days}>{getAgePresetLabel(days)}</Menu.Item>
      ))}
    </Menu>
  )

  const baseFilterOptions = [
    {
      label: polyglot.t("article_list.filter_status_unread"),
      value: "unread",
      icon: <IconRecord aria-hidden="true" />,
    },
    {
      label: polyglot.t("article_list.filter_status_all"),
      value: "all",
      icon: <IconAlignLeft aria-hidden="true" />,
    },
  ]

  const starredOption = {
    label: polyglot.t("article_list.filter_status_starred"),
    value: "starred",
    icon: <IconStarFill aria-hidden="true" />,
  }

  const filterOptions = ["category", "feed"].includes(source)
    ? [starredOption, ...baseFilterOptions]
    : baseFilterOptions

  const renderRadioButton = (option) => {
    const isSelected = showStatus === option.value
    return (
      <Radio key={option.value} value={option.value}>
        {option.icon}
        <span
          className={`entry-panel-filter-label${isSelected ? "" : " entry-panel-filter-label-hidden"}`}
        >
          {option.label}
        </span>
      </Radio>
    )
  }

  useEffect(() => {
    if (showStatus === "starred" && ["all", "today", "starred"].includes(source)) {
      updateSettings({ showStatus: "all" })
    }
  }, [source, showStatus])

  return (
    <div className="entry-panel">
      <MarkAllReadButton
        disabled={!isArticleListReady || bulkOperationsDisabled}
        from={source}
        hidden={Boolean(activeContent)}
        id={sourceId}
        loading={markingAllRead}
        onConfirm={handleMarkAllAsRead}
      />
      {source !== "history" && (
        <Dropdown
          droplist={agePresetMenu}
          popupVisible={ageMenuVisible}
          trigger="click"
          onVisibleChange={setAgeMenuVisible}
        >
          <CustomTooltip mini content={markOlderReadLabel}>
            <Button
              ref={ageMenuTriggerRef}
              aria-expanded={ageMenuVisible}
              aria-haspopup="menu"
              aria-label={markOlderReadLabel}
              className="nf-glass-control mark-older-read-trigger"
              icon={<IconClockCircle aria-hidden="true" />}
              loading={markingOlderRead}
              shape="circle"
              size="small"
              disabled={
                !isArticleListReady || markingAllRead || markingOlderRead || bulkOperationsDisabled
              }
            />
          </CustomTooltip>
        </Dropdown>
      )}
      <Radio.Group
        aria-hidden={source === "history" || undefined}
        aria-label={polyglot.t("article_list.filter_status_group_label")}
        className="nf-glass-group entry-panel-filter-group"
        style={{ visibility: source === "history" ? "hidden" : "visible" }}
        type="button"
        value={showStatus}
        onChange={handleFilterChange}
      >
        {filterOptions.map((option) => renderRadioButton(option))}
      </Radio.Group>
      <CustomTooltip mini content={refreshLabel}>
        <Button
          aria-label={refreshLabel}
          className="nf-glass-control"
          icon={<IconRefresh aria-hidden="true" />}
          loading={!isArticleListReady}
          shape="circle"
          onClick={refreshArticleList}
        />
      </CustomTooltip>
      <AccessibleModal
        className="mark-older-read-modal"
        closeLabel={polyglot.t("actions.close_dialog", { name: agePresetTitle })}
        confirmLoading={markingOlderRead}
        dialogLabel={agePresetTitle}
        fallbackFocusSelector=".mark-older-read-trigger"
        title={agePresetTitle}
        visible={agePresetDays !== null}
        onCancel={() => setAgePresetDays(null)}
        onOk={handleConfirmOlderRead}
      >
        <p>
          {agePresetDays === null
            ? markOlderReadLabel
            : polyglot.t("article_list.mark_older_as_read_confirm", {
                age: polyglot.t("date.days", agePresetDays),
              })}
        </p>
      </AccessibleModal>
    </div>
  )
}

export default FooterPanel
