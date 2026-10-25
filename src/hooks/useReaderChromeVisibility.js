import { useEffect, useRef, useState } from "react"

import useScreenWidth from "@/hooks/useScreenWidth"
import {
  calculateChromeVisibility,
  getInitialChromeVisibility,
  READER_CHROME_VISIBILITY_STATES,
} from "@/utils/reader-chrome-visibility"

/**
 * Resolves the scrollable element from either the forwarded ref or DOM hierarchy.
 */
export function resolveScrollElement(scrollContainerRef, fallbackRef) {
  if (scrollContainerRef?.current?.getScrollElement) {
    const el = scrollContainerRef.current.getScrollElement()
    if (el?.isConnected) {
      return el
    }
  }
  if (
    scrollContainerRef?.current instanceof HTMLElement &&
    scrollContainerRef.current.isConnected
  ) {
    return scrollContainerRef.current
  }
  const fallbackNode = fallbackRef?.current
  if (fallbackNode?.isConnected) {
    const simplebarWrapper = fallbackNode.closest(".simplebar-content-wrapper")
    if (simplebarWrapper) {
      return simplebarWrapper
    }
    const nativeScroll = fallbackNode.closest(".adaptive-scroll-area-native")
    if (nativeScroll) {
      return nativeScroll
    }
    const container = fallbackNode.closest(".scroll-container")
    if (container) {
      return (
        container.querySelector(".simplebar-content-wrapper") ||
        container.querySelector(".adaptive-scroll-area-native") ||
        container
      )
    }
  }
  return null
}

/**
 * Hook to manage interaction-aware reader chrome auto-hide and immediate return.
 *
 * @param {object} params
 * @param {import("react").RefObject} params.actionButtonsRef - Ref to the .action-buttons element.
 * @param {string|number} [params.articleId] - ID of current article to trigger reset.
 * @param {boolean} [params.isForcedVisible=false] - Whether menus, dropdowns, or lightbox force visibility.
 * @param {import("react").RefObject} [params.scrollContainerRef] - Ref to AdaptiveScrollArea.
 * @returns {{ isVisible: boolean, visibilityState: string }}
 */
export default function useReaderChromeVisibility({
  actionButtonsRef,
  articleId,
  isForcedVisible = false,
  scrollContainerRef,
}) {
  const { isBelowMedium } = useScreenWidth()
  const [isVisible, setIsVisible] = useState(true)
  const [visibilityState, setVisibilityState] = useState(READER_CHROME_VISIBILITY_STATES.VISIBLE)
  const [isFocusedWithin, setIsFocusedWithin] = useState(false)
  const [prevArticleId, setPrevArticleId] = useState(articleId)

  // Adjust state during render when article changes (React 19 recommendation)
  if (articleId !== prevArticleId) {
    setPrevArticleId(articleId)
    setIsVisible(true)
    setVisibilityState(READER_CHROME_VISIBILITY_STATES.VISIBLE)
  }

  const scrollStateRef = useRef(getInitialChromeVisibility())
  const isFocusedWithinRef = useRef(isFocusedWithin)
  useEffect(() => {
    isFocusedWithinRef.current = isFocusedWithin
  }, [isFocusedWithin])

  const isForcedVisibleRef = useRef(isForcedVisible)
  useEffect(() => {
    isForcedVisibleRef.current = isForcedVisible
    if (isForcedVisible) {
      scrollStateRef.current.accumulatedDelta = 0
      scrollStateRef.current.isCurrentlyVisible = true
    }
  }, [isForcedVisible])

  const rAFRef = useRef(null)

  // Reset scroll accumulation when article changes
  useEffect(() => {
    scrollStateRef.current = getInitialChromeVisibility()
  }, [articleId])

  // Track keyboard focus within action-buttons container
  useEffect(() => {
    const handleFocusIn = (event) => {
      const node = actionButtonsRef?.current
      if (node?.contains(event.target)) {
        isFocusedWithinRef.current = true
        setIsFocusedWithin(true)
        scrollStateRef.current.accumulatedDelta = 0
        scrollStateRef.current.isCurrentlyVisible = true
      } else if (isFocusedWithinRef.current) {
        isFocusedWithinRef.current = false
        setIsFocusedWithin(false)
      }
    }

    document.addEventListener("focusin", handleFocusIn)

    return () => {
      document.removeEventListener("focusin", handleFocusIn)
    }
  }, [actionButtonsRef])

  // Manage passive scroll listener with rAF batching
  useEffect(() => {
    const scrollElement = resolveScrollElement(scrollContainerRef, actionButtonsRef)
    if (!scrollElement) {
      return
    }

    // Sync initial scroll position
    scrollStateRef.current.lastScrollTop = scrollElement.scrollTop

    const handleScroll = () => {
      rAFRef.current = null
      const currentScrollTop = scrollElement.scrollTop
      const effectiveForcedVisible = isForcedVisibleRef.current || isFocusedWithinRef.current

      const result = calculateChromeVisibility({
        accumulatedDelta: scrollStateRef.current.accumulatedDelta,
        currentScrollTop,
        isCurrentlyVisible: scrollStateRef.current.isCurrentlyVisible,
        isForcedVisible: effectiveForcedVisible,
        lastScrollTop: scrollStateRef.current.lastScrollTop,
      })

      scrollStateRef.current = {
        accumulatedDelta: result.accumulatedDelta,
        isCurrentlyVisible: result.isVisible,
        lastScrollTop: result.lastScrollTop,
        state: result.state,
      }

      setIsVisible((prev) => (prev === result.isVisible ? prev : result.isVisible))
      setVisibilityState((prev) => (prev === result.state ? prev : result.state))
    }

    const onScroll = () => {
      if (rAFRef.current !== null) {
        return
      }
      rAFRef.current = globalThis.requestAnimationFrame(handleScroll)
    }

    scrollElement.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      scrollElement.removeEventListener("scroll", onScroll)
      if (rAFRef.current !== null) {
        globalThis.cancelAnimationFrame(rAFRef.current)
        rAFRef.current = null
      }
    }
  }, [actionButtonsRef, articleId, isBelowMedium, scrollContainerRef])

  const effectiveIsVisible = isForcedVisible || isFocusedWithin || isVisible
  const effectiveState =
    isForcedVisible || isFocusedWithin
      ? READER_CHROME_VISIBILITY_STATES.FORCED_VISIBLE_INTERACTION
      : visibilityState

  return { isVisible: effectiveIsVisible, visibilityState: effectiveState }
}
