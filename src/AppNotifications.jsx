import { Button, Notification } from "@arco-design/web-react"
import { useStore } from "@nanostores/react"
import { useEffect, useRef } from "react"

import { polyglotState } from "@/hooks/useLanguage"
import useModalToggle from "@/hooks/useModalToggle"
import useScreenWidth from "@/hooks/useScreenWidth"
import useVersionCheck from "@/hooks/useVersionCheck"
import { duplicateHotkeysState } from "@/store/hotkeysState"
import pwaUpdateState from "@/store/pwaUpdateState"
import { PRODUCT_GITHUB_REPO_PATH } from "@/utils/constants"
import { isSettingsTabAvailable, SETTINGS_TAB_KEYS } from "@/utils/settings-navigation"

import "./AppNotifications.css"

const NEW_VERSION_NOTIFICATION_ID = "new-version-available"
const DUPLICATE_HOTKEYS_NOTIFICATION_ID = "duplicate-hotkeys"
const PWA_UPDATE_NOTIFICATION_ID = "pwa-update-ready"

const NotificationActions = ({ polyglot, onCheck, onDismiss, checkLabelKey = "actions.check" }) => (
  <div className="notification-actions">
    <Button size="small" type="secondary" onClick={onDismiss}>
      {polyglot.t("actions.dismiss")}
    </Button>
    {onCheck && (
      <Button size="small" type="primary" onClick={onCheck}>
        {polyglot.t(checkLabelKey)}
      </Button>
    )}
  </div>
)

const AppNotifications = () => {
  const { polyglot } = useStore(polyglotState)
  const duplicateHotkeys = useStore(duplicateHotkeysState)
  const { hasUpdate, dismissUpdate } = useVersionCheck()
  const {
    available: hasPwaUpdate,
    accept: acceptPwaUpdate,
    dismiss: dismissPwaUpdate,
  } = useStore(pwaUpdateState)
  const { isBelowMedium } = useScreenWidth()
  const { setSettingsModalVisible, setSettingsTabsActiveTab } = useModalToggle()

  const previousDuplicateHotkeysSignatureRef = useRef(null)
  const isDuplicateHotkeysNotificationDismissedRef = useRef(false)

  const duplicateHotkeysSignature = JSON.stringify(duplicateHotkeys.toSorted())
  const hasDuplicateHotkeys = duplicateHotkeys.length > 0
  const canOpenHotkeysSettings = isSettingsTabAvailable(SETTINGS_TAB_KEYS.HOTKEYS, isBelowMedium)

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
            window.open(`https://github.com/${PRODUCT_GITHUB_REPO_PATH}/commits/main`, "_blank")
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

  // The installed build has a newer one waiting. The page keeps running until the user chooses.
  useEffect(() => {
    // Removing first keeps a single notice even if the position below changes while it is open.
    Notification.remove(PWA_UPDATE_NOTIFICATION_ID)
    if (!hasPwaUpdate) {
      return
    }

    Notification.info({
      id: PWA_UPDATE_NOTIFICATION_ID,
      title: polyglot.t("app.update_ready_title"),
      closable: false,
      content: polyglot.t("app.update_ready_description"),
      duration: 0,
      // Top-right sits over the reader and list toolbars from the medium breakpoint up. Below it,
      // index.css already places notifications under the mobile navigation controls.
      position: isBelowMedium ? "topRight" : "bottomRight",
      btn: (
        <NotificationActions
          checkLabelKey="actions.update_now"
          polyglot={polyglot}
          onCheck={acceptPwaUpdate}
          onDismiss={dismissPwaUpdate}
        />
      ),
    })
  }, [acceptPwaUpdate, dismissPwaUpdate, hasPwaUpdate, isBelowMedium, polyglot])

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
      Notification.remove(PWA_UPDATE_NOTIFICATION_ID)
    }
  }, [])

  return null
}

export default AppNotifications
