import assert from "node:assert/strict"
import test from "node:test"

const visibilityModule = await import(new URL("reader-chrome-visibility.js", import.meta.url))
const {
  calculateChromeVisibility,
  DOWN_THRESHOLD,
  getInitialChromeVisibility,
  JITTER_THRESHOLD,
  READER_CHROME_VISIBILITY_STATES,
  SHOW_TOP_THRESHOLD,
  UP_THRESHOLD,
} = visibilityModule

test("getInitialChromeVisibility returns visible state at top of document", () => {
  const initial = getInitialChromeVisibility()
  assert.equal(initial.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(initial.isVisible, true)
  assert.equal(initial.accumulatedDelta, 0)
  assert.equal(initial.lastScrollTop, 0)
})

test("chrome remains visible within top zone threshold (<= 64px)", () => {
  const atZero = calculateChromeVisibility({
    accumulatedDelta: 0,
    currentScrollTop: 0,
    isCurrentlyVisible: true,
    lastScrollTop: 0,
  })
  assert.equal(atZero.isVisible, true)
  assert.equal(atZero.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)

  const atBoundary = calculateChromeVisibility({
    accumulatedDelta: 0,
    currentScrollTop: SHOW_TOP_THRESHOLD,
    isCurrentlyVisible: true,
    lastScrollTop: 30,
  })
  assert.equal(atBoundary.isVisible, true)
  assert.equal(atBoundary.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(atBoundary.accumulatedDelta, 0)
})

test("downward scroll past top zone below downThreshold keeps chrome visible", () => {
  const step = calculateChromeVisibility({
    accumulatedDelta: 0,
    currentScrollTop: 74,
    isCurrentlyVisible: true,
    lastScrollTop: 64,
  })
  // delta is 10px, DOWN_THRESHOLD is 16px
  assert.equal(step.isVisible, true)
  assert.equal(step.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(step.accumulatedDelta, 10)
  assert.equal(step.lastScrollTop, 74)
})

test("downward scroll accumulating >= downThreshold hides chrome", () => {
  const step1 = calculateChromeVisibility({
    accumulatedDelta: 0,
    currentScrollTop: 74,
    isCurrentlyVisible: true,
    lastScrollTop: 64,
  })
  assert.equal(step1.isVisible, true)

  const step2 = calculateChromeVisibility({
    accumulatedDelta: step1.accumulatedDelta,
    currentScrollTop: 82,
    isCurrentlyVisible: step1.isVisible,
    lastScrollTop: step1.lastScrollTop,
  })
  // total accumulated delta is 10 + 8 = 18px >= 16px
  assert.equal(step2.isVisible, false)
  assert.equal(step2.state, READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL)
  assert.equal(step2.accumulatedDelta, 18)
  assert.equal(step2.lastScrollTop, 82)
})

test("sub-jitter scroll movement (< 2px) preserves state and delta", () => {
  const jitterDown = calculateChromeVisibility({
    accumulatedDelta: 10,
    currentScrollTop: 80.5,
    isCurrentlyVisible: true,
    lastScrollTop: 80,
  })
  // delta is 0.5px < 2px
  assert.equal(jitterDown.isVisible, true)
  assert.equal(jitterDown.accumulatedDelta, 10)
  assert.equal(jitterDown.lastScrollTop, 80)

  const jitterUp = calculateChromeVisibility({
    accumulatedDelta: -5,
    currentScrollTop: 149.2,
    isCurrentlyVisible: false,
    lastScrollTop: 150,
  })
  // delta is -0.8px < 2px
  assert.equal(jitterUp.isVisible, false)
  assert.equal(jitterUp.state, READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL)
  assert.equal(jitterUp.accumulatedDelta, -5)
  assert.equal(jitterUp.lastScrollTop, 150)
})

test("upward scroll >= upThreshold (12px) promptly reveals chrome", () => {
  // Start hidden at scrollTop 500
  const stepUp = calculateChromeVisibility({
    accumulatedDelta: 16,
    currentScrollTop: 486,
    isCurrentlyVisible: false,
    lastScrollTop: 500,
  })
  // delta is -14px, direction reversed so newAccumulated is -14px, abs >= 12px
  assert.equal(stepUp.isVisible, true)
  assert.equal(stepUp.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(stepUp.accumulatedDelta, -14)
  assert.equal(stepUp.lastScrollTop, 486)
})

test("upward scroll < upThreshold keeps chrome hidden until threshold is reached", () => {
  // Start hidden at 500, scroll up 5px
  const step1 = calculateChromeVisibility({
    accumulatedDelta: 16,
    currentScrollTop: 495,
    isCurrentlyVisible: false,
    lastScrollTop: 500,
  })
  assert.equal(step1.isVisible, false)
  assert.equal(step1.state, READER_CHROME_VISIBILITY_STATES.HIDDEN_BY_SCROLL)
  assert.equal(step1.accumulatedDelta, -5)

  // Scroll up another 8px (total -13px >= 12px)
  const step2 = calculateChromeVisibility({
    accumulatedDelta: step1.accumulatedDelta,
    currentScrollTop: 487,
    isCurrentlyVisible: step1.isVisible,
    lastScrollTop: step1.lastScrollTop,
  })
  assert.equal(step2.isVisible, true)
  assert.equal(step2.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(step2.accumulatedDelta, -13)
})

test("returning to top zone (<= 64px) immediately restores visible chrome", () => {
  const returnedToTop = calculateChromeVisibility({
    accumulatedDelta: 20,
    currentScrollTop: 50,
    isCurrentlyVisible: false,
    lastScrollTop: 300,
  })
  assert.equal(returnedToTop.isVisible, true)
  assert.equal(returnedToTop.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(returnedToTop.accumulatedDelta, 0)
  assert.equal(returnedToTop.lastScrollTop, 50)
})

test("forced visible interaction (focus, dropdown, TOC, lightbox) overrides scroll hiding", () => {
  // Even while scrolling down deep in article with delta > 50px
  const forced = calculateChromeVisibility({
    accumulatedDelta: 50,
    currentScrollTop: 600,
    isCurrentlyVisible: false,
    isForcedVisible: true,
    lastScrollTop: 550,
  })
  assert.equal(forced.isVisible, true)
  assert.equal(forced.state, READER_CHROME_VISIBILITY_STATES.FORCED_VISIBLE_INTERACTION)
  assert.equal(forced.accumulatedDelta, 0)
  assert.equal(forced.lastScrollTop, 600)
})

test("rubber-band / negative scrollTop is clamped to 0", () => {
  const overscroll = calculateChromeVisibility({
    accumulatedDelta: 0,
    currentScrollTop: -25,
    isCurrentlyVisible: true,
    lastScrollTop: 0,
  })
  assert.equal(overscroll.isVisible, true)
  assert.equal(overscroll.state, READER_CHROME_VISIBILITY_STATES.VISIBLE)
  assert.equal(overscroll.lastScrollTop, 0)
})
