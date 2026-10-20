export const MAX_DRAWER_FOCUS_RETRIES = 5

/**
 * Checks whether an element can legally receive keyboard focus according to DOM connectivity,
 * disabled status, layout visibility, and absence of inert or aria-hidden ancestors.
 *
 * @param {Element | null | undefined} element
 * @returns {boolean}
 */
export const canElementReceiveFocus = (element) => {
  if (!element || !element.isConnected || element.disabled) {
    return false
  }

  // Check if hidden via layout (getClientRects)
  if (typeof element.getClientRects === "function") {
    const rects = element.getClientRects()
    if (rects.length === 0) {
      return false
    }
  }

  // Must not be inside inert or aria-hidden container
  if (typeof element.closest === "function" && element.closest('[inert], [aria-hidden="true"]')) {
    return false
  }

  return true
}

/**
 * Resolves the appropriate focus target element for drawer closure based on the recorded invoker,
 * with ordered candidate fallbacks if a breakpoint change unmounted the original invoker.
 *
 * @param {string | null | undefined} invoker
 * @param {{ headerTriggerRef?: { current: Element | null }, documentRef?: Document }} [options]
 * @returns {Element | null}
 */
export const resolveCurrentDrawerFocusTarget = (invoker, options = {}) => {
  const { headerTriggerRef, documentRef = globalThis.document } = options
  if (!documentRef || typeof documentRef.querySelector !== "function") {
    return null
  }

  const getCompactSources = () =>
    documentRef.querySelector('[data-nav-key="sources"], [data-testid="compact-nav-sources"]')

  const getHeaderTrigger = () =>
    (headerTriggerRef?.current?.isConnected ? headerTriggerRef.current : null) ||
    documentRef.querySelector(".brand .trigger, .brand .desktop-sidebar-reopen")

  const candidateResolvers =
    invoker === "compact-sources"
      ? [getCompactSources, getHeaderTrigger]
      : [getHeaderTrigger, getCompactSources]

  for (const resolver of candidateResolvers) {
    const candidate = resolver()
    if (canElementReceiveFocus(candidate)) {
      return candidate
    }
  }

  return null
}

/**
 * Restores focus to the invoker element across a bounded number of animation frames.
 * Target is re-resolved on each attempt to allow transient animations or aria-hidden/inert
 * cleanup from Drawer removal to complete.
 *
 * @param {object} options
 * @param {string | null | undefined} options.invoker
 * @param {{ current: Element | null }} [options.headerTriggerRef]
 * @param {number} [options.maxRetries=5]
 * @param {Document} [options.documentRef=globalThis.document]
 * @param {Function} [options.onFocusSuccess]
 * @param {Function} [options.onFocusFallback]
 * @param {Function} [options.requestFrame]
 * @param {Function} [options.cancelFrame]
 * @returns {() => void} Cleanup function to cancel pending retries
 */
export const restoreDrawerFocus = ({
  invoker,
  headerTriggerRef,
  maxRetries = MAX_DRAWER_FOCUS_RETRIES,
  documentRef = globalThis.document,
  onFocusSuccess,
  onFocusFallback,
  requestFrame = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame
    : (cb) => globalThis.setTimeout(cb, 16),
  cancelFrame = typeof globalThis.cancelAnimationFrame === "function"
    ? globalThis.cancelAnimationFrame
    : globalThis.clearTimeout,
} = {}) => {
  let retryCount = 0
  let isCancelled = false
  let pendingHandle = null

  const attempt = () => {
    if (isCancelled) {
      return
    }

    const targetElement = resolveCurrentDrawerFocusTarget(invoker, {
      headerTriggerRef,
      documentRef,
    })

    if (targetElement) {
      targetElement.focus({ preventScroll: true })
      const doc = documentRef || globalThis.document
      if (doc?.activeElement === targetElement) {
        onFocusSuccess?.(targetElement)
        return
      }
    }

    retryCount += 1
    if (retryCount <= maxRetries) {
      pendingHandle = requestFrame(attempt)
    } else {
      onFocusFallback?.()
    }
  }

  pendingHandle = requestFrame(attempt)

  return () => {
    isCancelled = true
    if (pendingHandle !== null) {
      cancelFrame(pendingHandle)
      pendingHandle = null
    }
  }
}
