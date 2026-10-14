import { Button, Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"

import { polyglotState } from "@/hooks/useLanguage"
import useModalToggle from "@/hooks/useModalToggle"
import useScreenWidth from "@/hooks/useScreenWidth"
import useVersionCheck from "@/hooks/useVersionCheck"
import { duplicateHotkeysState } from "@/store/hotkeysState"
import { GITHUB_REPO_PATH } from "@/utils/constants"
import {
  isMarkAllReadUndoReportMode,
  readMarkAllReadUndoProbeTrace,
  startMarkAllReadUndoProbe,
} from "@/utils/mark-all-read-undo-diagnostics"
import { isSettingsTabAvailable, SETTINGS_TAB_KEYS } from "@/utils/settings-navigation"

import "./AppNotifications.css"

const NEW_VERSION_NOTIFICATION_ID = "new-version-available"
const DUPLICATE_HOTKEYS_NOTIFICATION_ID = "duplicate-hotkeys"

const NotificationActions = ({ polyglot, onCheck, onDismiss }) => (
  <div className="notification-actions">
    <Button size="small" type="secondary" onClick={onDismiss}>
      {polyglot.t("actions.dismiss")}
    </Button>
    {onCheck && (
      <Button size="small" type="primary" onClick={onCheck}>
        {polyglot.t("actions.check")}
      </Button>
    )}
  </div>
)

const AppNotifications = () => {
  const { search } = useLocation()
  const { polyglot } = useStore(polyglotState)
  const duplicateHotkeys = useStore(duplicateHotkeysState)
  const { hasUpdate, dismissUpdate } = useVersionCheck()
  const { isBelowMedium } = useScreenWidth()
  const { setSettingsModalVisible, setSettingsTabsActiveTab } = useModalToggle()

  const previousDuplicateHotkeysSignatureRef = useRef(null)
  const isDuplicateHotkeysNotificationDismissedRef = useRef(false)
  const reportMode = isMarkAllReadUndoReportMode(search)
  const reportTrace = reportMode ? readMarkAllReadUndoProbeTrace() : []
  const [copyTraceStatus, setCopyTraceStatus] = useState("")

  const duplicateHotkeysSignature = JSON.stringify(duplicateHotkeys.toSorted())
  const hasDuplicateHotkeys = duplicateHotkeys.length > 0
  const canOpenHotkeysSettings = isSettingsTabAvailable(SETTINGS_TAB_KEYS.HOTKEYS, isBelowMedium)

  useEffect(() => startMarkAllReadUndoProbe(), [])

  useEffect(() => {
    if (!hasUpdate) {
      Notification.remove(NEW_VERSION_NOTIFICATION_ID)
      return
    }

    Notification.info({
      id: NEW_VERSION_NOTIFICATION_ID,
      title: polyglot.t("app.new_version_available"),
      closable: false,
      content: polyglot.t("app.new_version_available_description"),
      duration: 0,
      btn: (
        <NotificationActions
          polyglot={polyglot}
          onCheck={() => {
            window.open(`https://github.com/${GITHUB_REPO_PATH}/commits/main`, "_blank")
            Notification.remove(NEW_VERSION_NOTIFICATION_ID)
          }}
          onDismiss={() => {
            dismissUpdate()
            Notification.remove(NEW_VERSION_NOTIFICATION_ID)
          }}
        />
      ),
    })
  }, [dismissUpdate, hasUpdate, polyglot])

  useEffect(() => {
    if (previousDuplicateHotkeysSignatureRef.current !== duplicateHotkeysSignature) {
      previousDuplicateHotkeysSignatureRef.current = duplicateHotkeysSignature
      isDuplicateHotkeysNotificationDismissedRef.current = false
    }

    if (!hasDuplicateHotkeys) {
      Notification.remove(DUPLICATE_HOTKEYS_NOTIFICATION_ID)
      return
    }

    if (isDuplicateHotkeysNotificationDismissedRef.current) {
      return
    }

    const dismissDuplicateHotkeysNotification = () => {
      isDuplicateHotkeysNotificationDismissedRef.current = true
      Notification.remove(DUPLICATE_HOTKEYS_NOTIFICATION_ID)
    }

    Notification.error({
      id: DUPLICATE_HOTKEYS_NOTIFICATION_ID,
      title: polyglot.t("settings.duplicate_hotkeys"),
      content: canOpenHotkeysSettings
        ? undefined
        : polyglot.t("settings.duplicate_hotkeys_desktop_description"),
      closable: false,
      duration: 0,
      btn: (
        <NotificationActions
          polyglot={polyglot}
          onDismiss={dismissDuplicateHotkeysNotification}
          onCheck={
            canOpenHotkeysSettings
              ? () => {
                  setSettingsTabsActiveTab(SETTINGS_TAB_KEYS.HOTKEYS)
                  setSettingsModalVisible(true)
                  dismissDuplicateHotkeysNotification()
                }
              : undefined
          }
        />
      ),
    })
  }, [
    canOpenHotkeysSettings,
    duplicateHotkeysSignature,
    hasDuplicateHotkeys,
    polyglot,
    setSettingsModalVisible,
    setSettingsTabsActiveTab,
  ])

  useEffect(() => {
    return () => {
      Notification.remove(NEW_VERSION_NOTIFICATION_ID)
      Notification.remove(DUPLICATE_HOTKEYS_NOTIFICATION_ID)
    }
  }, [])

  if (!reportMode) {
    return null
  }

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(reportTrace, null, 2))
      setCopyTraceStatus("Copied")
    } catch {
      setCopyTraceStatus("Clipboard unavailable")
    }
  }

  return (
    <div
      style={{
        bottom: 12,
        position: "fixed",
        right: 12,
        zIndex: 2000,
      }}
    >
      <Button aria-label="Copy trace" disabled={reportTrace.length === 0} onClick={copyTrace}>
        Copy trace
      </Button>
      {copyTraceStatus && <span aria-live="polite"> {copyTraceStatus}</span>}
    </div>
  )
}

export default AppNotifications
