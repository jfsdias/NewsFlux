const HIGHER_OVERLAY_SELECTOR =
  'dialog[open], [role="dialog"][aria-modal="true"], [role="menu"], .arco-dropdown-popup-visible, .arco-picker-container'

const hasVisibleHigherOverlay = (documentRef) => {
  const overlays = documentRef?.querySelectorAll?.(HIGHER_OVERLAY_SELECTOR)
  if (!overlays) {
    return false
  }

  return [...overlays].some((overlay) => {
    if (overlay.getAttribute?.("aria-hidden") === "true") {
      return false
    }
    if (typeof documentRef.defaultView?.getComputedStyle === "function") {
      const style = documentRef.defaultView.getComputedStyle(overlay)
      if (style.display === "none" || style.visibility === "hidden") {
        return false
      }
    }
    return typeof overlay.getClientRects !== "function" || overlay.getClientRects().length > 0
  })
}

export const shouldExitArticleSelectionOnEscape = (
  event,
  { activeContent = null, documentRef = globalThis.document } = {},
) => {
  if (event?.key !== "Escape" || event.defaultPrevented || activeContent) {
    return false
  }

  if (event.target?.closest?.(HIGHER_OVERLAY_SELECTOR)) {
    return false
  }

  return !hasVisibleHigherOverlay(documentRef)
}

export default shouldExitArticleSelectionOnEscape
