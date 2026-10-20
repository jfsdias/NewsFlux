import { Button, Drawer } from "@arco-design/web-react"
import { IconClose } from "@arco-design/web-react/icon"
import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"
import { useLocation } from "react-router"

import Sidebar from "@/components/Sidebar/Sidebar"
import { polyglotState } from "@/hooks/useLanguage"
import useScreenWidth from "@/hooks/useScreenWidth"
import {
  mobileSidebarInvokerState,
  mobileSidebarVisibleState,
  setMobileSidebarInvoker,
  setMobileSidebarVisible,
} from "@/store/sidebarState"
import { restoreDrawerFocus } from "@/utils/drawer-focus"

export default function SidebarDrawerHost({ headerTriggerRef }) {
  const currentPath = useLocation().pathname
  const { isBelowLarge } = useScreenWidth()
  const sidebarVisible = useStore(mobileSidebarVisibleState)
  const { polyglot } = useStore(polyglotState)

  const closeButtonRef = useRef(null)
  const restoreFocusAfterCloseRef = useRef(false)
  const cancelPendingFocusRef = useRef(null)

  const closeSidebarLabel = polyglot?.t("actions.close_dialog", {
    name: polyglot?.t("sidebar.navigation_menu"),
  })

  const closeSidebar = () => {
    restoreFocusAfterCloseRef.current = true
    setMobileSidebarVisible(false)
  }

  const closeSidebarAfterNavigation = () => {
    restoreFocusAfterCloseRef.current = false
    setMobileSidebarVisible(false)
  }

  const handleAfterClose = () => {
    const shouldRestoreFocus = restoreFocusAfterCloseRef.current
    restoreFocusAfterCloseRef.current = false

    const invoker = mobileSidebarInvokerState.get()
    setMobileSidebarInvoker(null)

    if (cancelPendingFocusRef.current) {
      cancelPendingFocusRef.current()
      cancelPendingFocusRef.current = null
    }

    if (!shouldRestoreFocus) {
      return
    }

    cancelPendingFocusRef.current = restoreDrawerFocus({
      invoker,
      headerTriggerRef,
      onFocusSuccess: () => {
        cancelPendingFocusRef.current = null
      },
      onFocusFallback: () => {
        cancelPendingFocusRef.current = null
      },
    })
  }

  useEffect(() => {
    return () => {
      if (cancelPendingFocusRef.current) {
        cancelPendingFocusRef.current()
        cancelPendingFocusRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isBelowLarge) {
      restoreFocusAfterCloseRef.current = false
      setMobileSidebarVisible(false)
    }
  }, [isBelowLarge])

  useEffect(() => {
    if (currentPath) {
      restoreFocusAfterCloseRef.current = false
      setMobileSidebarVisible(false)
    }
  }, [currentPath])

  return (
    <Drawer
      focusLock
      afterClose={handleAfterClose}
      afterOpen={() => closeButtonRef.current?.focus({ preventScroll: true })}
      autoFocus={false}
      className="sidebar-drawer"
      closable={false}
      footer={null}
      id="mobile-sidebar-drawer"
      mountOnEnter={false}
      placement="left"
      title={null}
      visible={sidebarVisible}
      width="min(80vw, 360px)"
      onCancel={closeSidebar}
    >
      <Sidebar
        headerAction={
          <Button
            ref={closeButtonRef}
            aria-label={closeSidebarLabel}
            className="mobile-sidebar-close"
            icon={<IconClose aria-hidden="true" />}
            shape="circle"
            size="small"
            onClick={closeSidebar}
          />
        }
        onNavigate={closeSidebarAfterNavigation}
      />
    </Drawer>
  )
}
