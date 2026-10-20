import { atom, onMount } from "nanostores"

import { classifyWindowClass } from "@/utils/window-class"

export const getWindowDimensions = () => {
  if (globalThis.window === undefined) {
    return { width: 1024, height: 768 }
  }
  return {
    width: globalThis.innerWidth ?? 0,
    height: globalThis.innerHeight ?? 0,
  }
}

export const getInitialWindowClass = () => {
  return classifyWindowClass(getWindowDimensions())
}

export const windowClassState = atom(getInitialWindowClass())

const updateWindowClassState = () => {
  const nextClass = classifyWindowClass(getWindowDimensions())
  if (windowClassState.get() !== nextClass) {
    windowClassState.set(nextClass)
  }
}

onMount(windowClassState, () => {
  if (globalThis.window === undefined) {
    return
  }

  // Synchronize immediately on listener attachment
  updateWindowClassState()

  globalThis.addEventListener("resize", updateWindowClassState)
  return () => {
    globalThis.removeEventListener("resize", updateWindowClassState)
  }
})

export { WINDOW_CLASSES } from "@/utils/window-class"
