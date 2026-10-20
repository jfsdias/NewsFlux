import { Button } from "@arco-design/web-react"
import { IconMenuUnfold } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useRef } from "react"

import SidebarDrawerHost from "./SidebarDrawerHost"

import CustomTooltip from "@/components/ui/CustomTooltip"
import useDesktopSidebar from "@/hooks/useDesktopSidebar"
import { polyglotState } from "@/hooks/useLanguage"
import useScreenWidth from "@/hooks/useScreenWidth"
import useWindowClass from "@/hooks/useWindowClass"
import { contentState } from "@/store/contentState"
import {
  mobileSidebarVisibleState,
  setMobileSidebarInvoker,
  setMobileSidebarVisible,
} from "@/store/sidebarState"
import "./SidebarTrigger.css"

export default function SidebarTrigger() {
  const { isBelowLarge } = useScreenWidth()
  const { isCompact } = useWindowClass()
  const { activeContent } = useStore(contentState, { keys: ["activeContent"] })
  const isReaderActive = Boolean(activeContent)

  const sidebarVisible = useStore(mobileSidebarVisibleState)
  const { polyglot } = useStore(polyglotState)
  const { expandDesktopSidebar, isDesktopSidebarCollapsed, reopenButtonRef } = useDesktopSidebar()

  const triggerButtonRef = useRef(null)

  const sidebarTriggerLabel = polyglot?.t(isBelowLarge ? "sidebar.open" : "sidebar.expand")

  if (!isBelowLarge) {
    if (!isDesktopSidebarCollapsed) {
      return null
    }

    return (
      <div className="brand">
        <CustomTooltip mini content={sidebarTriggerLabel}>
          <Button
            ref={reopenButtonRef}
            aria-controls="desktop-sidebar-navigation"
            aria-expanded={false}
            aria-label={sidebarTriggerLabel}
            className="desktop-sidebar-reopen"
            icon={<IconMenuUnfold aria-hidden="true" />}
            shape="circle"
            size="small"
            type="secondary"
            onClick={expandDesktopSidebar}
          />
        </CustomTooltip>
      </div>
    )
  }

  // In COMPACT + LIST/HOME, CompactNavigation has Sources as the primary drawer trigger.
  // Suppress the redundant visible hamburger in the header while keeping Drawer host mounted.
  // In MEDIUM, DESKTOP, or COMPACT reader mode, legacy trigger remains available where required.
  const showLegacyTrigger = !(isCompact && !isReaderActive)

  return (
    <>
      {showLegacyTrigger && (
        <div className="brand">
          <CustomTooltip mini content={sidebarTriggerLabel}>
            <Button
              ref={triggerButtonRef}
              aria-controls="mobile-sidebar-drawer"
              aria-expanded={sidebarVisible}
              aria-haspopup="dialog"
              aria-label={sidebarTriggerLabel}
              className="trigger"
              icon={<IconMenuUnfold aria-hidden="true" />}
              shape="circle"
              size="small"
              onClick={() => {
                const nextVisible = !mobileSidebarVisibleState.get()
                if (nextVisible) {
                  setMobileSidebarInvoker("header")
                }
                setMobileSidebarVisible(nextVisible)
              }}
            />
          </CustomTooltip>
        </div>
      )}
      <SidebarDrawerHost headerTriggerRef={triggerButtonRef} />
    </>
  )
}

export { default as SidebarDrawerHost } from "./SidebarDrawerHost"
