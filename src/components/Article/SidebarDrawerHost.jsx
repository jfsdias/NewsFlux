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
import { handoffRouteFocus, restoreDrawerFocus } from "@/utils/drawer-focus"

export default function SidebarDrawerHost({ headerTriggerRef = null } = {}) {
  const currentPath = useLocation().pathname
  const { isBelowLarge } = useScreenWidth()
  const sidebarVisible = useStore(mobileSidebarVisibleState)
  const { polyglot } = useStore(polyglotState)

  const closeButtonRef = useRef(null)
  const restoreFocusAfterCloseRef = useRef(false)
  const focusDestinationAfterCloseRef = useRef(false)
  const cancelPendingFocusRef = useRef(null)

  const closeSidebarLabel = polyglot?.t("actions.close_dialog", {
    name: polyglot?.t("sidebar.navigation_menu"),
  })

  const closeSidebar = () => {
    restoreFocusAfterCloseRef.current = true
    focusDestinationAfterCloseRef.current = false
    setMobileSidebarVisible(false)
  }

  const closeSidebarAfterNavigation = () => {
    restoreFocusAfterCloseRef.current = false
    focusDestinationAfterCloseRef.current = true
    setMobileSidebarVisible(false)
  }

  const handleAfterClose = () => {
    const shouldRestoreFocus = restoreFocusAfterCloseRef.current
    const shouldFocusDestination = focusDestinationAfterCloseRef.current
    restoreFocusAfterCloseRef.current = false
    focusDestinationAfterCloseRef.current = false

    const invoker = mobileSidebarInvokerState.get()
    setMobileSidebarInvoker(null)

    if (cancelPendingFocusRef.current) {
      cancelPendingFocusRef.current()
      cancelPendingFocusRef.current = null
    }

    if (!shouldRestoreFocus) {
      if (shouldFocusDestination) {
        cancelPendingFocusRef.current = handoffRouteFocus({
          onFocusSuccess: () => {
            cancelPendingFocusRef.current = null
          },
          onFocusFallback: () => {
            cancelPendingFocusRef.current = null
          },
        })
      }
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
      const shouldFocusDestination = mobileSidebarVisibleState.get()
      restoreFocusAfterCloseRef.current = false
      focusDestinationAfterCloseRef.current = shouldFocusDestination
      setMobileSidebarVisible(false)
    }
  }, [isBelowLarge])

  useEffect(() => {
    if (currentPath && mobileSidebarVisibleState.get()) {
      restoreFocusAfterCloseRef.current = false
      focusDestinationAfterCloseRef.current = true
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
        isDrawer
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
