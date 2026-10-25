export const READER_CHROME_VISIBILITY_STATES = {
  VISIBLE: "VISIBLE",
  HIDDEN_BY_SCROLL: "HIDDEN_BY_SCROLL",
  FORCED_VISIBLE_INTERACTION: "FORCED_VISIBLE_INTERACTION",
}

export const SHOW_TOP_THRESHOLD = 64
export const DOWN_THRESHOLD = 16
export const UP_THRESHOLD = 12
export const JITTER_THRESHOLD = 2

/**
 * Returns initial reader chrome visibility state snapshot.
 */
export function getInitialChromeVisibility() {
  return {
    state: READER_CHROME_VISIBILITY_STATES.VISIBLE,
    isVisible: true,
    accumulatedDelta: 0,
    lastScrollTop: 0,
  }
}

/**
 * Calculates next reader chrome visibility state and directional scroll accumulation.
 *
 * @param {object} params
 * @param {number} params.currentScrollTop - Current vertical scroll position of the reader container.
 * @param {number} params.lastScrollTop - Previous vertical scroll position.
 * @param {number} [params.accumulatedDelta=0] - Directional accumulated scroll delta.
 * @param {boolean} [params.isCurrentlyVisible=true] - Current visibility boolean.
 * @param {boolean} [params.isForcedVisible=false] - Whether interaction (focus, dropdown, TOC, lightbox) forces chrome visible.
 * @param {number} [params.showTopThreshold=SHOW_TOP_THRESHOLD] - Distance from top where chrome is always visible.
 * @param {number} [params.downThreshold=DOWN_THRESHOLD] - Downward scroll distance before hiding chrome.
 * @param {number} [params.upThreshold=UP_THRESHOLD] - Upward scroll distance before showing chrome.
 * @param {number} [params.jitterThreshold=JITTER_THRESHOLD] - Scroll movements below this delta are treated as jitter.
 * @returns {{ state: string, isVisible: boolean, accumulatedDelta: number, lastScrollTop: number }}
 */
export function calculateChromeVisibility({
  currentScrollTop,
  lastScrollTop,
  accumulatedDelta = 0,
  isCurrentlyVisible = true,
  isForcedVisible = false,
  showTopThreshold = SHOW_TOP_THRESHOLD,
  downThreshold = DOWN_THRESHOLD,
  upThreshold = UP_THRESHOLD,
  jitterThreshold = JITTER_THRESHOLD,
}) {
  const normalizedCurrent = Math.max(0, Number(currentScrollTop) || 0)
  const normalizedLast = Math.max(0, Number(lastScrollTop) || 0)

  // 1. Forced visible (keyboard focus within, menu/dropdown open, etc.)
  if (isForcedVisible) {
    return {
      state: READER_CHROME_VISIBILITY_STATES.FORCED_VISIBLE_INTERACTION,
      isVisible: true,
      accumulatedDelta: 0,
      lastScrollTop: normalizedCurrent,
    }
  }

  // 2. Top zone threshold: when within top zone, chrome is always visible
  if (normalizedCurrent <= showTopThreshold) {
    return {
      state: READER_CHROME_VISIBILITY_STATES.VISIBLE,
      isVisible: true,
      accumulatedDelta: 0,
      lastScrollTop: normalizedCurrent,
    }
  }

  const delta = normalizedCurrent - normalizedLast

  // 3. Jitter rejection: ignore sub-jitter delta and keep current state
  if (Math.abs(delta) < jitterThreshold) {
    return {
      state: isCurrentlyVisible
        ? READER_CHROME_VISIBILITY_STATES.VISIBLE
        : READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL,
      isVisible: isCurrentlyVisible,
      accumulatedDelta,
      lastScrollTop: normalizedLast,
    }
  }

  // 4. Downward scrolling (delta > 0)
  if (delta > 0) {
    // If direction changed from upward to downward, reset accumulation to current delta
    const nextAccumulated = accumulatedDelta < 0 ? delta : accumulatedDelta + delta
    if (nextAccumulated >= downThreshold) {
      return {
        state: READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL,
        isVisible: false,
        accumulatedDelta: Math.min(nextAccumulated, downThreshold * 2),
        lastScrollTop: normalizedCurrent,
      }
    }
    return {
      state: isCurrentlyVisible
        ? READER_CHROME_VISIBILITY_STATES.VISIBLE
        : READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL,
      isVisible: isCurrentlyVisible,
      accumulatedDelta: nextAccumulated,
      lastScrollTop: normalizedCurrent,
    }
  }

  // 5. Upward scrolling (delta < 0)
  // If direction changed from downward to upward, reset accumulation to current delta
  const nextAccumulated = accumulatedDelta > 0 ? delta : accumulatedDelta + delta
  if (Math.abs(nextAccumulated) >= upThreshold) {
    return {
      state: READER_CHROME_VISIBILITY_STATES.VISIBLE,
      isVisible: true,
      accumulatedDelta: Math.max(nextAccumulated, -upThreshold * 2),
      lastScrollTop: normalizedCurrent,
    }
  }

  return {
    state: isCurrentlyVisible
      ? READER_CHROME_VISIBILITY_STATES.VISIBLE
      : READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL,
    isVisible: isCurrentlyVisible,
    accumulatedDelta: nextAccumulated,
    lastScrollTop: normalizedCurrent,
  }
}
