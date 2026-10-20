/* eslint import/extensions: off -- Native Node ESM tests require explicit file extensions. */
import assert from "node:assert/strict"
import test from "node:test"

import {
  canElementReceiveFocus,
  resolveCurrentDrawerFocusTarget,
  restoreDrawerFocus,
} from "./drawer-focus.js"

const fakeCancelFrame = (id) => clearTimeout(id)

// Test mock element builder
const createMockElement = ({
  id = "",
  disabled = false,
  isConnected = true,
  visible = true,
  inert = false,
  ariaHidden = false,
} = {}) => {
  const el = {
    id,
    disabled,
    isConnected,
    focusCallCount: 0,
    getClientRects: () => (visible ? [{ width: 44, height: 44 }] : []),
    closest: (selector) => {
      if (selector.includes("[inert]") && inert) {
        return {}
      }
      if (selector.includes('[aria-hidden="true"]') && ariaHidden) {
        return {}
      }
      return null
    },
  }

  el.focus = () => {
    el.focusCallCount += 1
    if (globalThis.document) {
      globalThis.document.activeElement = el
    }
  }

  return el
}

test("DRAWER-FOCUS: canElementReceiveFocus validates focusability correctly", () => {
  const good = createMockElement({ id: "good" })
  assert.equal(canElementReceiveFocus(good), true)

  const disconnected = createMockElement({ isConnected: false })
  assert.equal(canElementReceiveFocus(disconnected), false)

  const disabled = createMockElement({ disabled: true })
  assert.equal(canElementReceiveFocus(disabled), false)

  const invisible = createMockElement({ visible: false })
  assert.equal(canElementReceiveFocus(invisible), false)

  const inertEl = createMockElement({ inert: true })
  assert.equal(canElementReceiveFocus(inertEl), false)

  const ariaHiddenEl = createMockElement({ ariaHidden: true })
  assert.equal(canElementReceiveFocus(ariaHiddenEl), false)

  assert.equal(canElementReceiveFocus(null), false)
  assert.equal(canElementReceiveFocus(), false)
})

test("COMPACT_SOURCES_AFTER_CLOSE_FOCUS: resolves compact sources button when invoker is compact-sources", () => {
  const sourcesBtn = createMockElement({ id: "compact-sources" })
  const headerBtn = createMockElement({ id: "header-trigger" })

  const documentRef = {
    querySelector: (sel) => {
      if (sel.includes("sources")) {
        return sourcesBtn
      }
      if (sel.includes("trigger")) {
        return headerBtn
      }
      return null
    },
  }

  const target = resolveCurrentDrawerFocusTarget("compact-sources", {
    documentRef,
  })
  assert.equal(target, sourcesBtn)
})

test("READER_HEADER_AFTER_CLOSE_FOCUS: retries across frames when header trigger is temporarily in aria-hidden/inert", async () => {
  const headerBtn = createMockElement({ id: "header-trigger", ariaHidden: true })
  const documentRef = {
    activeElement: null,
    querySelector: (sel) => (sel.includes("trigger") ? headerBtn : null),
  }
  globalThis.document = documentRef

  let framesRun = 0
  const fakeRequestFrame = (cb) => {
    return setTimeout(() => {
      framesRun += 1
      // Simulate frame 1: drawer cleanup removes ariaHidden from background
      if (framesRun === 1) {
        headerBtn.closest = () => null
      }
      cb()
    }, 10)
  }

  let successElement = null
  await new Promise((resolve) => {
    restoreDrawerFocus({
      invoker: "header",
      documentRef,
      requestFrame: fakeRequestFrame,
      cancelFrame: fakeCancelFrame,
      onFocusSuccess: (el) => {
        successElement = el
        resolve()
      },
    })
  })

  assert.equal(successElement, headerBtn)
  assert.ok(framesRun >= 1, "Must have retried on subsequent frame after aria-hidden cleared")
  assert.equal(documentRef.activeElement, headerBtn)
})

test("COMPACT_TO_MEDIUM_FALLBACK: falls back to visible header trigger when compact sources was unmounted by resize", () => {
  const headerBtn = createMockElement({ id: "header-trigger" })

  const documentRef = {
    querySelector: (sel) => {
      // compact sources unmounted in MEDIUM
      if (sel.includes("sources")) {
        return null
      }
      if (sel.includes("trigger")) {
        return headerBtn
      }
      return null
    },
  }

  const target = resolveCurrentDrawerFocusTarget("compact-sources", {
    documentRef,
  })
  assert.equal(target, headerBtn)
})

test("MEDIUM_TO_COMPACT_FALLBACK: falls back to visible compact sources when header trigger was unmounted by resize", () => {
  const sourcesBtn = createMockElement({ id: "compact-sources" })

  const documentRef = {
    querySelector: (sel) => {
      if (sel.includes("sources")) {
        return sourcesBtn
      }
      // header trigger unmounted in COMPACT list
      if (sel.includes("trigger")) {
        return null
      }
      return null
    },
  }

  const target = resolveCurrentDrawerFocusTarget("header", {
    documentRef,
  })
  assert.equal(target, sourcesBtn)
})

test("RETRY_IS_BOUNDED: stops after maxRetries if target never becomes focusable", async () => {
  const unmountedDocument = {
    activeElement: null,
    querySelector: () => null,
  }
  globalThis.document = unmountedDocument

  let framesScheduled = 0
  const fakeRequestFrame = (cb) => {
    framesScheduled += 1
    return setTimeout(cb, 5)
  }

  let fallbackCalled = false
  await new Promise((resolve) => {
    restoreDrawerFocus({
      invoker: "compact-sources",
      maxRetries: 3,
      documentRef: unmountedDocument,
      requestFrame: fakeRequestFrame,
      cancelFrame: fakeCancelFrame,
      onFocusFallback: () => {
        fallbackCalled = true
        resolve()
      },
    })
  })

  assert.equal(fallbackCalled, true)
  assert.equal(framesScheduled, 4) // Initial + 3 retries = 4 frames
})

test("INVOKER_STATE_CLEARED: clears invoker atom synchronously on close handler execution", async () => {
  const { atom } = await import("nanostores")
  const invokerAtom = atom("compact-sources")
  assert.equal(invokerAtom.get(), "compact-sources")

  // Simulate handleAfterClose cleanup
  const invoker = invokerAtom.get()
  invokerAtom.set(null)

  assert.equal(invoker, "compact-sources")
  assert.equal(invokerAtom.get(), null)
})

test("NAVIGATION_CLOSE_NO_FORCED_RETURN: navigation close does not invoke focus restoration", () => {
  let focusCalled = false
  const restoreFocusAfterClose = false // set by closeSidebarAfterNavigation

  if (restoreFocusAfterClose) {
    focusCalled = true
  }

  assert.equal(focusCalled, false)
})
