import { Button } from "@arco-design/web-react"
import { IconMenuUnfold } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useRef } from "react"

import CustomTooltip from "@/components/ui/CustomTooltip"
import useDesktopSidebar from "@/hooks/useDesktopSidebar"
import { polyglotState } from "@/hooks/useLanguage"
import useScreenWidth from "@/hooks/useScreenWidth"
import useWindowClass from "@/hooks/useWindowClass"
import {
  mobileSidebarVisibleState,
  setMobileSidebarInvoker,
  setMobileSidebarVisible,
} from "@/store/sidebarState"
import "./SidebarTrigger.css"

export default function SidebarTrigger() {
  const { isBelowLarge } = useScreenWidth()
  const { isCompact } = useWindowClass()

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

  // In COMPACT, the list header suppresses the redundant hamburger because CompactNavigation
  // owns the Sources trigger, and Reader uses ReaderSidebarTrigger outside .entry-col.
  if (isCompact) {
    return null
  }

  // In MEDIUM, show the legacy header trigger.
  return (
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
  )
}

export function ReaderSidebarTrigger() {
  const { isCompact } = useWindowClass()
  const sidebarVisible = useStore(mobileSidebarVisibleState)
  const { polyglot } = useStore(polyglotState)
  const sidebarTriggerLabel = polyglot?.t("sidebar.open")

  if (!isCompact) {
    return null
  }

  return (
    <div className="brand reader-sidebar-trigger-wrapper">
      <CustomTooltip mini content={sidebarTriggerLabel}>
        <Button
          aria-controls="mobile-sidebar-drawer"
          aria-expanded={sidebarVisible}
          aria-haspopup="dialog"
          aria-label={sidebarTriggerLabel}
          className="reader-sidebar-trigger trigger"
          icon={<IconMenuUnfold aria-hidden="true" />}
          shape="circle"
          size="small"
          type="secondary"
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
  )
}

export { default as SidebarDrawerHost } from "./SidebarDrawerHost"
