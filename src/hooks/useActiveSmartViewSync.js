import { useStore } from "@nanostores/react"
import { useEffect } from "react"

import { contentState } from "@/store/contentState"
import { dataState } from "@/store/dataState"
import { settingsState } from "@/store/settingsState"
import { reconcileActiveSmartView } from "@/store/smartViewActions"
import {
  activeSmartViewState,
  pendingSmartViewState,
  smartViewsState,
} from "@/store/smartViewsState"

// Keeps the active view honest: it ends as soon as the list stops matching its predicates.
const useActiveSmartViewSync = () => {
  const active = useStore(activeSmartViewState)
  const pending = useStore(pendingSmartViewState)
  const storage = useStore(smartViewsState)
  const content = useStore(contentState, {
    keys: ["filterDate", "filterString", "infoFrom", "infoId"],
  })
  const settings = useStore(settingsState, { keys: ["orderBy", "orderDirection", "showStatus"] })
  const { sessionRevision } = useStore(dataState, { keys: ["sessionRevision"] })

  useEffect(() => {
    reconcileActiveSmartView()
  }, [active, pending, storage, content, settings, sessionRevision])
}

export default useActiveSmartViewSync
