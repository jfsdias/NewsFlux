import { useStore } from "@nanostores/react"
import { ofetch } from "ofetch"
import { useCallback, useEffect, useState } from "react"

import { dataState } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import { PRODUCT_GITHUB_REPO_PATH, UPDATE_NOTIFICATION_KEY } from "@/utils/constants"
import { checkIsInLast24Hours, getTimestamp } from "@/utils/date"
import { shouldNotifyProductUpdate } from "@/utils/update-check"
import buildInfo from "@/version-info.json"

function useVersionCheck() {
  const isServerInfoReady = useStore(dataState, {
    keys: ["loadState"],
  }).loadState.serverInfo.hasSnapshot
  const { checkForUpdates } = useStore(settingsState, { keys: ["checkForUpdates"] })

  const [hasUpdate, setHasUpdate] = useState(false)

  const dismissUpdate = useCallback(() => {
    localStorage.setItem(UPDATE_NOTIFICATION_KEY, getTimestamp().toString())
    setHasUpdate(false)
  }, [])

  useEffect(() => {
    const buildCommit = buildInfo.gitFullHash || buildInfo.gitHash

    if (
      !isServerInfoReady ||
      import.meta.env.DEV ||
      !checkForUpdates ||
      !buildCommit ||
      buildCommit === "unknown"
    ) {
      return
    }

    const checkUpdate = async () => {
      try {
        const lastDismissed = localStorage.getItem(UPDATE_NOTIFICATION_KEY)
        if (lastDismissed && checkIsInLast24Hours(lastDismissed)) {
          return
        }

        const data = await ofetch(
          `https://api.github.com/repos/${PRODUCT_GITHUB_REPO_PATH}/compare/${buildCommit}...main`,
        )

        setHasUpdate(shouldNotifyProductUpdate(data))
      } catch (error) {
        console.error("Check update failed", error)
      }
    }

    checkUpdate()
  }, [checkForUpdates, isServerInfoReady])

  // When checkForUpdates is off, never report an update regardless of internal state
  const effectiveHasUpdate = checkForUpdates && hasUpdate

  return { hasUpdate: effectiveHasUpdate, dismissUpdate }
}

export default useVersionCheck
