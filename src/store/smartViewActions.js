import { contentState, reconcileArticleListFilters, setActiveContent } from "@/store/contentState"
import { getDataSessionRevision } from "@/store/dataState"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState, updateSettings } from "@/store/settingsState"
import {
  activeSmartViewState,
  pendingSmartViewState,
  smartViewsState,
} from "@/store/smartViewsState"
import { getHomeIdentityKey } from "@/utils/home-page"
import {
  getSmartViewAppliedPreferences,
  getSmartViews,
  hasSmartViewPreferencesChanged,
  isSmartViewSessionStale,
  SMART_VIEW_PREFERENCE_KEYS,
  smartViewPath,
} from "@/utils/smart-views"

// Registers the request to open a view; the list restores it once the route matches.
// Returns the path the caller must navigate to.
export const requestSmartViewOpen = ({ key, view, originPath }) => {
  const pending = {
    key,
    view,
    targetPath: smartViewPath(view),
    originPath,
    sessionRevision: getDataSessionRevision(),
  }
  pendingSmartViewState.set(pending)
  globalThis.setTimeout(() => {
    if (pendingSmartViewState.get() === pending) {
      pendingSmartViewState.set(null)
    }
  }, 10_000)
  setActiveContent(null)
  return pending.targetPath
}

// Applies the view's status/sort in memory and remembers the user's own values.
export const beginSmartViewSession = ({ key, view, sessionRevision }) => {
  const settings = settingsState.get()
  const baseline =
    activeSmartViewState.get()?.baseline ??
    Object.fromEntries(SMART_VIEW_PREFERENCE_KEYS.map((name) => [name, settings[name]]))
  // The baseline must be set first so storage never receives the view's values.
  activeSmartViewState.set({ key, view, sessionRevision, baseline })
  updateSettings(getSmartViewAppliedPreferences(view))
}

// Ends the session. The user's preferences return unless they changed them while the view was
// open; such an explicit change is kept (and persisted) because the user asked for it.
const endSmartViewSession = ({ clearFilters = false } = {}) => {
  const active = activeSmartViewState.get()
  if (!active) {
    return
  }
  if (hasSmartViewPreferencesChanged(active.view, settingsState.get())) {
    activeSmartViewState.set(null)
    updateSettings({})
  } else {
    updateSettings(active.baseline)
    activeSmartViewState.set(null)
  }
  if (clearFilters) {
    reconcileArticleListFilters({ filterDate: null, filterString: "" })
  }
}

export const leaveSmartView = () => endSmartViewSession({ clearFilters: true })

// Ends the session when the list no longer matches the view's predicates.
export const reconcileActiveSmartView = () => {
  const active = activeSmartViewState.get()
  if (!active || pendingSmartViewState.get()) {
    return
  }
  const key = getHomeIdentityKey(homeIdentityState.get())
  const stored = getSmartViews(smartViewsState.get(), key).find(
    (view) => view.id === active.view.id,
  )
  const stale = isSmartViewSessionStale({
    active,
    content: contentState.get(),
    stored,
    key,
    sessionRevision: getDataSessionRevision(),
  })
  if (stale || hasSmartViewPreferencesChanged(active.view, settingsState.get())) {
    endSmartViewSession()
  }
}
