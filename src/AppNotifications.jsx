import { Button, Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef, useState } from "react"

import { polyglotState } from "@/hooks/useLanguage"
import useModalToggle from "@/hooks/useModalToggle"
import useScreenWidth from "@/hooks/useScreenWidth"
import useVersionCheck from "@/hooks/useVersionCheck"
import { duplicateHotkeysState } from "@/store/hotkeysState"
import { GITHUB_REPO_PATH } from "@/utils/constants"
import { MARK_ALL_READ_UNDO_NOTIFICATION_ID } from "@/utils/mark-all-read-undo"
import {
  getMarkAllReadUndoProbeTrace,
  installMarkAllReadNotificationProbe,
  isMarkAllReadUndoProbeEnabled,
  logMarkAllReadUndoDiagnostic,
  subscribeToMarkAllReadUndoProbeTrace,
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

const MarkAllReadUndoProbePanel = () => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [trace, setTrace] = useState(getMarkAllReadUndoProbeTrace)
  const [copyStatus, setCopyStatus] = useState("")

  useEffect(
    () =>
      subscribeToMarkAllReadUndoProbeTrace(() => {
        setTrace(getMarkAllReadUndoProbeTrace())
      }),
    [],
  )

  const copyTrace = async () => {
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (typeof clipboard?.writeText !== "function") {
        throw new TypeError("Clipboard is unavailable")
      }

      await clipboard.writeText(getMarkAllReadUndoProbeTrace())
      setCopyStatus("Trace copied")
    } catch {
      setIsExpanded(true)
      setCopyStatus("Clipboard unavailable. Select and copy the trace below.")
    }
  }

  return (
    <aside
      aria-label="Mark all read Undo diagnostic probe"
      className={`mark-all-read-undo-probe${isExpanded ? " mark-all-read-undo-probe-expanded" : ""}`}
    >
      <div className="mark-all-read-undo-probe-controls">
        <strong>Undo probe</strong>
        <Button size="small" type="secondary" onClick={() => void copyTrace()}>
          Copy trace
        </Button>
        <Button
          aria-expanded={isExpanded}
          size="small"
          type="secondary"
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? "Hide" : "Show"}
        </Button>
      </div>
      {copyStatus && (
        <div className="mark-all-read-undo-probe-status" role="status">
          {copyStatus}
        </div>
      )}
      {isExpanded && (
        <textarea
          readOnly
          aria-label="Sanitized Undo probe event trace"
          className="mark-all-read-undo-probe-trace"
          spellCheck={false}
          value={trace}
        />
      )}
    </aside>
  )
}

const AppNotifications = () => {
  const { polyglot } = useStore(polyglotState)
  const duplicateHotkeys = useStore(duplicateHotkeysState)
  const { hasUpdate, dismissUpdate } = useVersionCheck()
  const { isBelowMedium } = useScreenWidth()
  const { setSettingsModalVisible, setSettingsTabsActiveTab } = useModalToggle()

  const previousDuplicateHotkeysSignatureRef = useRef(null)
  const isDuplicateHotkeysNotificationDismissedRef = useRef(false)

  const duplicateHotkeysSignature = JSON.stringify(duplicateHotkeys.toSorted())
  const hasDuplicateHotkeys = duplicateHotkeys.length > 0
  const canOpenHotkeysSettings = isSettingsTabAvailable(SETTINGS_TAB_KEYS.HOTKEYS, isBelowMedium)

  useEffect(() => {
    logMarkAllReadUndoDiagnostic("APP_NOTIFICATIONS_MOUNTED")
    const uninstallNotificationProbe = installMarkAllReadNotificationProbe(
      Notification,
      MARK_ALL_READ_UNDO_NOTIFICATION_ID,
    )

    return () => {
      logMarkAllReadUndoDiagnostic("APP_NOTIFICATIONS_UNMOUNTED")
      uninstallNotificationProbe()
      Notification.remove(NEW_VERSION_NOTIFICATION_ID)
      Notification.remove(DUPLICATE_HOTKEYS_NOTIFICATION_ID)
    }
  }, [])

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

  return isMarkAllReadUndoProbeEnabled() ? <MarkAllReadUndoProbePanel /> : null
}

export default AppNotifications
