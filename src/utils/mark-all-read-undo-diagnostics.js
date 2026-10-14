const PROBE_QUERY_PARAMETER = "__newsflux_markall_probe"
const PROBE_STORAGE_KEY = "newsflux.bulk01.undoProbe"
const PROBE_TRACE_EVENT = "newsflux:bulk01-undo-probe-event"
const VALID_ROUTE_KINDS = new Set(["feed", "category", "other"])
const CLEAR_TRIGGERS = new Set([
  "clear",
  "mark_all_completed",
  "notification_on_close",
  "replaced",
  "undo_consumed",
])
const NOTIFICATION_METHODS = ["success", "info", "warning", "error", "remove", "clear"]

const hasProbeQuery = () => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get(PROBE_QUERY_PARAMETER) === "1"
  } catch {
    return false
  }
}

// Latch opt-in at startup because SPA route navigation may remove the query string.
const probeEnabled = hasProbeQuery()
let notificationExpected = false
let undoTokenPresenceReader = () => null
let traceEvents = []
let traceLoaded = false
let traceStart = null
let notificationPatch = null

if (probeEnabled) {
  try {
    globalThis.sessionStorage?.removeItem(PROBE_STORAGE_KEY)
  } catch {
    // In-memory diagnostics remain available if sessionStorage is unavailable.
  }
}

const normalizeRouteKind = (routeKind) => (VALID_ROUTE_KINDS.has(routeKind) ? routeKind : "other")

const readStoredTrace = () => {
  try {
    const stored = globalThis.sessionStorage?.getItem(PROBE_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (event) =>
        event &&
        Number.isInteger(event.SEQ) &&
        Number.isFinite(event.T_PLUS_MS) &&
        typeof event.EVENT === "string" &&
        ["YES", "NO", "NA"].includes(event.UNDO_TOKEN_PRESENT) &&
        ["YES", "NO", "NA"].includes(event.NOTIFICATION_EXPECTED) &&
        ["feed", "category", "other", "NA"].includes(event.ROUTE_KIND),
    )
  } catch {
    return []
  }
}

const ensureTraceLoaded = () => {
  if (traceLoaded) {
    return
  }

  traceLoaded = true
  traceEvents = readStoredTrace()
  traceStart = globalThis.performance?.now?.() ?? Date.now()
}

const asYesNoNa = (value) => (value === true ? "YES" : value === false ? "NO" : "NA")

const getUndoTokenPresent = () => {
  try {
    const present = undoTokenPresenceReader()
    return typeof present === "boolean" ? present : null
  } catch {
    return null
  }
}

const formatEvent = (event) => {
  const fields = [
    `SEQ=${event.SEQ}`,
    `T_PLUS_MS=${event.T_PLUS_MS}`,
    `EVENT=${event.EVENT}`,
    `UNDO_TOKEN_PRESENT=${event.UNDO_TOKEN_PRESENT}`,
    `NOTIFICATION_EXPECTED=${event.NOTIFICATION_EXPECTED}`,
    `ROUTE_KIND=${event.ROUTE_KIND}`,
  ]

  if (event.CLEAR_TRIGGER) {
    fields.push(`CLEAR_TRIGGER=${event.CLEAR_TRIGGER}`)
  }

  return fields.join(" ")
}

export const isMarkAllReadUndoProbeEnabled = () => probeEnabled

export const logMarkAllReadUndoDiagnostic = (
  eventName,
  { undoTokenPresent, notificationExpected: expected, routeKind, clearTrigger } = {},
) => {
  if (!probeEnabled) {
    return
  }

  ensureTraceLoaded()
  const now = globalThis.performance?.now?.() ?? Date.now()
  const event = {
    SEQ: (traceEvents.at(-1)?.SEQ ?? 0) + 1,
    T_PLUS_MS: Math.max(0, Math.round(now - traceStart)),
    EVENT: eventName,
    UNDO_TOKEN_PRESENT: asYesNoNa(
      typeof undoTokenPresent === "boolean" ? undoTokenPresent : getUndoTokenPresent(),
    ),
    NOTIFICATION_EXPECTED: asYesNoNa(
      typeof expected === "boolean" ? expected : notificationExpected,
    ),
    ROUTE_KIND: routeKind ? normalizeRouteKind(routeKind) : "NA",
  }

  if (CLEAR_TRIGGERS.has(clearTrigger)) {
    event.CLEAR_TRIGGER = clearTrigger
  }

  traceEvents.push(event)

  try {
    globalThis.sessionStorage?.setItem(PROBE_STORAGE_KEY, JSON.stringify(traceEvents))
  } catch {
    // Keep the in-memory trace available if sessionStorage is unavailable.
  }

  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") {
    globalThis.dispatchEvent(new Event(PROBE_TRACE_EVENT))
  }
}

export const setMarkAllReadUndoNotificationExpected = (expected) => {
  if (probeEnabled && typeof expected === "boolean") {
    notificationExpected = expected
  }
}

export const setMarkAllReadUndoTokenPresenceReader = (reader) => {
  undoTokenPresenceReader = typeof reader === "function" ? reader : () => null
}

export const getMarkAllReadUndoProbeTrace = () => {
  if (!probeEnabled) {
    return ""
  }

  ensureTraceLoaded()
  return traceEvents.map((event) => formatEvent(event)).join("\n")
}

export const subscribeToMarkAllReadUndoProbeTrace = (listener) => {
  if (!probeEnabled || typeof globalThis.addEventListener !== "function") {
    return () => {}
  }

  globalThis.addEventListener(PROBE_TRACE_EVENT, listener)
  return () => globalThis.removeEventListener(PROBE_TRACE_EVENT, listener)
}

export const installMarkAllReadNotificationProbe = (notificationApi, undoNotificationId) => {
  if (!probeEnabled || !notificationApi) {
    return () => {}
  }

  if (!notificationPatch) {
    const patchedMethods = new Map()

    for (const method of NOTIFICATION_METHODS) {
      const original = notificationApi[method]
      if (typeof original !== "function") {
        continue
      }

      const wrapped = (...args) => {
        const notificationId = method === "remove" ? args[0] : args[0]?.id
        const targetsUndoNotification = notificationId === undoNotificationId
        logMarkAllReadUndoDiagnostic(
          `NOTIFICATION_CALL_${method.toUpperCase()}_${targetsUndoNotification ? "UNDO" : "OTHER"}`,
        )
        return Reflect.apply(original, notificationApi, args)
      }

      try {
        if (Reflect.set(notificationApi, method, wrapped)) {
          patchedMethods.set(method, { original, wrapped })
        }
      } catch {
        // A non-writable method remains uninstrumented; notification behavior is untouched.
      }
    }

    notificationPatch = { api: notificationApi, count: 0, patchedMethods }
  }

  if (notificationPatch.api !== notificationApi) {
    return () => {}
  }

  notificationPatch.count += 1
  let released = false

  return () => {
    if (released || !notificationPatch) {
      return
    }

    released = true
    notificationPatch.count -= 1
    if (notificationPatch.count > 0) {
      return
    }

    for (const [method, { original, wrapped }] of notificationPatch.patchedMethods) {
      if (notificationPatch.api[method] === wrapped) {
        try {
          Reflect.set(notificationPatch.api, method, original)
        } catch {
          // Leave a wrapper in place only if the API has become non-writable meanwhile.
        }
      }
    }

    notificationPatch = null
  }
}

export const getDiagnosticRouteName = (pathname) => {
  if (pathname === "feed" || /^\/feed(?:\/|$)/.test(pathname)) {
    return "feed"
  }
  if (pathname === "category" || /^\/category(?:\/|$)/.test(pathname)) {
    return "category"
  }
  return "other"
}

export const logMarkAllReadRouteChanged = ({ fromRoute, toRoute }) => {
  const routeKind = normalizeRouteKind(toRoute)
  const undoTokenPresent = getUndoTokenPresent()
  logMarkAllReadUndoDiagnostic("ROUTE_CHANGED", { routeKind, undoTokenPresent })
  logMarkAllReadUndoDiagnostic("MARK_ALL_UNDO_TOKEN_PRESENT_AFTER_ROUTE", {
    routeKind,
    undoTokenPresent,
  })
}
