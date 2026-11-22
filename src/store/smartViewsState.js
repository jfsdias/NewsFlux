import { persistentAtom } from "@nanostores/persistent"
import { atom } from "nanostores"

import { getSmartViews, sanitizeSmartViewStorage, setSmartViews } from "@/utils/smart-views"

const empty = { version: 1, accounts: [] }
export const smartViewsState = persistentAtom("smart-views-v1", empty, {
  encode: (value) => JSON.stringify(sanitizeSmartViewStorage(value)),
  decode: (value) => {
    try {
      return sanitizeSmartViewStorage(JSON.parse(value))
    } catch {
      return empty
    }
  },
})
export const pendingSmartViewState = atom(null)
export const updateSmartViews = (key, update) => {
  const current = smartViewsState.get()
  smartViewsState.set(setSmartViews(current, key, update(getSmartViews(current, key))))
}
