import { useStore } from "@nanostores/react"

import { windowClassState } from "@/store/windowClassState"
import { isCompactClass, isDesktopClass, isMediumClass } from "@/utils/window-class"

const useWindowClass = () => {
  const windowClass = useStore(windowClassState)

  return {
    windowClass,
    isCompact: isCompactClass(windowClass),
    isMedium: isMediumClass(windowClass),
    isDesktop: isDesktopClass(windowClass),
  }
}

export default useWindowClass
