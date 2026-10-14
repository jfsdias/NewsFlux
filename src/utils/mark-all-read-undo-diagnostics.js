const RUN_QUERY_PARAMETER = "__newsflux_markall_probe"
const REPORT_QUERY_PARAMETER = "__newsflux_markall_probe_report"
const TRACE_STORAGE_KEY = "newsflux.bulk01.undoProbeR2"
const NOTIFICATION_SELECTOR = ".arco-notification-wrapper .arco-notification"
const MAX_TRACE_EVENTS = 500

let probeActive = false
let probeInitialized = false
let probeStartedAt = 0
let sequence = 0
let undoTokenPresent = false
let events = []
let flushQueued = false
let notificationObserver = null
let notificationObservation = null

const getNow = () => globalThis.performance?.now?.() ?? Date.now()

const getRouteKind = (pathname = globalThis.window?.location?.pathname || "") => {
  if (/\/entry\/[^/]+\/?$/.test(pathname)) {
    return "entry"
  }
  if (/\/feed\/[^/]+\/?$/.test(pathname)) {
    return "feed"
  }
  if (/\/category\/[^/]+\/?$/.test(pathname)) {
    return "category"
  }
  if (/\/login\/?$/.test(pathname)) {
    return "login"
  }
  if (pathname === "/" || pathname === "") {
    return "home"
  }
  return "other"
}

const getDocumentVisibility = () => globalThis.document?.visibilityState || "unknown"

const getSessionStorage = () => {
  try {
    return globalThis.sessionStorage || null
  } catch {
    return null
  }
}

const changeTokenPresenceForEvent = (eventName) => {
  if (eventName === "UNDO_TOKEN_CREATED") {
    undoTokenPresent = true
  } else if (eventName === "UNDO_TOKEN_CLEARED" || eventName === "UNDO_TOKEN_EXPIRED") {
    undoTokenPresent = false
  }
}

export const isMarkAllReadUndoReportMode = (search = globalThis.window?.location?.search || "") =>
  new URLSearchParams(search).get(REPORT_QUERY_PARAMETER) === "1"

export const recordMarkAllReadUndoProbeEvent = (eventName) => {
  if (!probeActive) {
    return
  }

  changeTokenPresenceForEvent(eventName)
  sequence += 1
  events.push({
    SEQ: sequence,
    T_PLUS_MS: Math.max(0, Math.round(getNow() - probeStartedAt)),
    EVENT: eventName,
    UNDO_TOKEN_PRESENT: undoTokenPresent,
    DOCUMENT_VISIBILITY: getDocumentVisibility(),
    ROUTE_KIND: getRouteKind(),
  })

  if (events.length > MAX_TRACE_EVENTS) {
    events.shift()
  }
}

export const getMarkAllReadUndoNotificationCount = () => {
  if (!probeActive || !globalThis.document) {
    return null
  }

  return globalThis.document.querySelectorAll(NOTIFICATION_SELECTOR).length
}

const flushTrace = () => {
  const storage = getSessionStorage()
  if (!probeActive || !storage) {
    return
  }

  try {
    storage.setItem(TRACE_STORAGE_KEY, JSON.stringify(events))
  } catch {
    // Storage can be unavailable in restricted browsing contexts.
  }
}

export const scheduleMarkAllReadUndoProbeFlush = () => {
  if (!probeActive || flushQueued) {
    return
  }

  flushQueued = true
  // Persist only after the current interaction/navigation stack has returned.
  queueMicrotask(() => {
    flushQueued = false
    flushTrace()
  })
}

const disconnectNotificationObserver = () => {
  notificationObserver?.disconnect()
  notificationObserver = null
  notificationObservation = null
}

const inspectNotificationCount = () => {
  if (!globalThis.document) {
    return 0
  }

  return globalThis.document.querySelectorAll(NOTIFICATION_SELECTOR).length
}

const scanNotificationLifetime = () => {
  if (!notificationObservation) {
    return
  }

  const count = inspectNotificationCount()
  const { appeared, baselineCount } = notificationObservation

  if (!appeared && count > baselineCount) {
    notificationObservation.appeared = true
    recordMarkAllReadUndoProbeEvent("UNDO_NOTIFICATION_DOM_APPEARED")
    scheduleMarkAllReadUndoProbeFlush()
    return
  }

  if (appeared && count <= baselineCount) {
    recordMarkAllReadUndoProbeEvent("UNDO_NOTIFICATION_DOM_DISAPPEARED")
    scheduleMarkAllReadUndoProbeFlush()
    disconnectNotificationObserver()
  }
}

export const scheduleMarkAllReadUndoNotificationObservation = (baselineCount) => {
  if (!probeActive || baselineCount === null || !globalThis.document?.body) {
    return
  }

  queueMicrotask(() => {
    disconnectNotificationObserver()
    notificationObservation = { appeared: false, baselineCount }
    const Observer = globalThis.MutationObserver
    if (!Observer) {
      disconnectNotificationObserver()
      return
    }
    notificationObserver = new Observer(scanNotificationLifetime)
    // Arco exposes a shared wrapper, not a stable per-notice DOM identifier.
    notificationObserver.observe(globalThis.document.body, { childList: true, subtree: true })
    scanNotificationLifetime()
  })
}

export const stopMarkAllReadUndoNotificationObservationAfterClose = () => {
  if (!probeActive || !notificationObserver) {
    return
  }

  queueMicrotask(() => {
    scanNotificationLifetime()
    disconnectNotificationObserver()
  })
}

export const readMarkAllReadUndoProbeTrace = () => {
  const storage = getSessionStorage()
  if (!storage) {
    return []
  }

  try {
    const storedTrace = storage.getItem(TRACE_STORAGE_KEY)
    const parsedTrace = storedTrace ? JSON.parse(storedTrace) : []
    return Array.isArray(parsedTrace) ? parsedTrace : []
  } catch {
    return []
  }
}

const recordLifecycleEvent = (eventName) => {
  recordMarkAllReadUndoProbeEvent(eventName)
  scheduleMarkAllReadUndoProbeFlush()
}

const onVisibilityChange = () => recordLifecycleEvent("DOCUMENT_VISIBILITY_CHANGE")
const onBlur = () => recordLifecycleEvent("WINDOW_BLUR")
const onFocus = () => recordLifecycleEvent("WINDOW_FOCUS")
const onPageHide = () => {
  recordLifecycleEvent("PAGEHIDE")
  disconnectNotificationObserver()
}
const onPageShow = () => recordLifecycleEvent("PAGESHOW")

export const startMarkAllReadUndoProbe = () => {
  const runMode =
    new URLSearchParams(globalThis.window?.location?.search || "").get(RUN_QUERY_PARAMETER) === "2"

  if (!runMode || !globalThis.window || !globalThis.document) {
    return () => {}
  }

  probeActive = true
  if (!probeInitialized) {
    probeInitialized = true
    probeStartedAt = getNow()
    sequence = 0
    undoTokenPresent = false
    events = []
    try {
      getSessionStorage()?.removeItem(TRACE_STORAGE_KEY)
    } catch {
      // Storage can be unavailable in restricted browsing contexts.
    }
  }

  globalThis.document.addEventListener("visibilitychange", onVisibilityChange, { passive: true })
  globalThis.window.addEventListener("blur", onBlur, { passive: true })
  globalThis.window.addEventListener("focus", onFocus, { passive: true })
  globalThis.window.addEventListener("pagehide", onPageHide, { passive: true })
  globalThis.window.addEventListener("pageshow", onPageShow, { passive: true })

  return () => {
    globalThis.document.removeEventListener("visibilitychange", onVisibilityChange)
    globalThis.window.removeEventListener("blur", onBlur)
    globalThis.window.removeEventListener("focus", onFocus)
    globalThis.window.removeEventListener("pagehide", onPageHide)
    globalThis.window.removeEventListener("pageshow", onPageShow)
    disconnectNotificationObserver()
  }
}
