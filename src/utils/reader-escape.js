const READER_TRANSIENT_SELECTOR = ".article-content .arco-dropdown-popup-visible"
const DRAWER_ACTIVE_SELECTOR =
  ".sidebar-drawer:not(.arco-drawer-hide), #mobile-sidebar-drawer:not(.arco-drawer-hide)"

const shouldDeferReaderEscape = (event, context = globalThis.document) => {
  let isDrawerVisible = false
  let hasExplicitDrawerState = false
  let documentRef = globalThis.document

  if (context && typeof context.querySelector === "function") {
    documentRef = context
  } else if (context && typeof context === "object") {
    hasExplicitDrawerState = "isDrawerVisible" in context
    if (hasExplicitDrawerState) {
      isDrawerVisible = Boolean(context.isDrawerVisible)
    }
    if (context.documentRef) {
      documentRef = context.documentRef
    }
  }

  const drawerVisible = hasExplicitDrawerState
    ? isDrawerVisible
    : Boolean(documentRef?.querySelector?.(DRAWER_ACTIVE_SELECTOR))

  return Boolean(
    event?.defaultPrevented ||
    drawerVisible ||
    documentRef?.querySelector?.(READER_TRANSIENT_SELECTOR),
  )
}

export default shouldDeferReaderEscape
