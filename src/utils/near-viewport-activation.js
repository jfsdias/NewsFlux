export const importWhileMounted = async (loadModule, isCancelled) => {
  const module = await loadModule()
  return isCancelled() ? null : module
}

export const findNearestScrollableAncestor = (element, getStyle = globalThis.getComputedStyle) => {
  let ancestor = element?.parentElement

  while (ancestor) {
    const overflowY = getStyle?.(ancestor)?.overflowY
    if (overflowY && /^(auto|scroll|overlay)$/.test(overflowY)) {
      return ancestor
    }
    ancestor = ancestor.parentElement
  }

  return null
}

const noop = () => {}

export const observeNearViewport = (
  element,
  onActivate,
  { Observer = globalThis.IntersectionObserver, root = null } = {},
) => {
  if (!element) {
    return noop
  }

  if (typeof Observer !== "function") {
    let isDisposed = false
    queueMicrotask(() => {
      if (!isDisposed) {
        onActivate()
      }
    })

    return () => {
      isDisposed = true
    }
  }

  let isDisposed = false
  let isActivated = false
  const observer = new Observer(
    (entries) => {
      if (
        isDisposed ||
        isActivated ||
        !entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)
      ) {
        return
      }

      isActivated = true
      observer.disconnect()
      onActivate()
    },
    {
      // Match DeferredCodeBlock's established prefetch distance so content is ready shortly before view.
      rootMargin: "400px 0px",
      root,
      threshold: 0,
    },
  )

  observer.observe(element)

  return () => {
    if (isDisposed) {
      return
    }

    isDisposed = true
    observer.disconnect()
  }
}

export default observeNearViewport
