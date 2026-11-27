import dayjs from "dayjs"

// The date picker also emits Dayjs values (notably its Today shortcut).
// Persist the local calendar date rather than serializing it as a UTC instant.
export const normalizeSmartViewDate = (value) =>
  dayjs.isDayjs(value) && value.isValid() ? value.format("YYYY-MM-DD") : value

const ALLOWED_SOURCES = new Set(["all", "today", "starred", "history", "feed", "category"])

export const sanitizeSmartView = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 100 ||
    typeof value.query !== "string" ||
    !value.query.trim() ||
    value.query.length > 2000 ||
    !ALLOWED_SOURCES.has(value.source) ||
    !["unread", "all", "starred"].includes(value.showStatus) ||
    !["created_at", "published_at"].includes(value.orderBy) ||
    !["asc", "desc"].includes(value.orderDirection)
  ) {
    return null
  }
  const needsId = value.source === "feed" || value.source === "category"
  const sourceId = needsId ? Number(value.sourceId) : null
  if (needsId && (!Number.isSafeInteger(sourceId) || sourceId <= 0)) {
    return null
  }
  const filterDate = value.filterDate == null ? null : value.filterDate
  if (
    filterDate !== null &&
    (typeof filterDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(filterDate))
  ) {
    return null
  }
  if (value.source === "today" && filterDate !== null) {
    return null
  }
  return {
    id: value.id,
    name: value.name.trim(),
    query: value.query.trim(),
    source: value.source,
    sourceId,
    showStatus: value.showStatus,
    orderBy: value.orderBy,
    orderDirection: value.orderDirection,
    filterDate,
  }
}

export const sanitizeSmartViewStorage = (value) => {
  if (!value || value.version !== 1 || !Array.isArray(value.accounts)) {
    return { version: 1, accounts: [] }
  }
  const accounts = []
  const seen = new Set()
  for (const account of value.accounts) {
    if (
      typeof account?.key !== "string" ||
      !account.key ||
      seen.has(account.key) ||
      !Array.isArray(account.views)
    ) {
      continue
    }
    seen.add(account.key)
    const ids = new Set()
    const views = account.views
      .map((view) => sanitizeSmartView(view))
      .filter((view) => {
        if (!view || ids.has(view.id)) {
          return false
        }
        ids.add(view.id)
        return true
      })
    accounts.push({ key: account.key, views })
  }
  return { version: 1, accounts }
}

export const getSmartViews = (storage, key) =>
  key ? (storage.accounts.find((account) => account.key === key)?.views ?? []) : []
export const setSmartViews = (storage, key, views) => {
  if (!key) {
    return storage
  }
  return sanitizeSmartViewStorage({
    version: 1,
    accounts: [...storage.accounts.filter((account) => account.key !== key), { key, views }],
  })
}
export const moveSmartView = (views, id, direction) => {
  const index = views.findIndex((view) => view.id === id)
  const nextIndex = index + direction
  if (index < 0 || ![-1, 1].includes(direction) || nextIndex < 0 || nextIndex >= views.length) {
    return views
  }
  const next = [...views]
  ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
  return next
}
export const smartViewPath = (view) =>
  view.source === "feed" || view.source === "category"
    ? `/${view.source}/${view.sourceId}`
    : `/${view.source}`
export const canOpenSmartView = (view, feeds, categories) => {
  if (view.source === "feed") {
    return feeds.some((feed) => Number(feed.id) === view.sourceId)
  }
  if (view.source === "category") {
    return categories.some((category) => Number(category.id) === view.sourceId)
  }
  return true
}

export const getSmartViewRestoredStatus = (view) =>
  view.showStatus === "starred" && ["all", "today", "starred"].includes(view.source)
    ? "all"
    : view.showStatus

export const smartViewRestorationState = (
  pending,
  identityKey,
  sessionRevision,
  locationPath,
  source,
  sourceId,
) => {
  if (!pending) {
    return "none"
  }
  if (!identityKey || pending.key !== identityKey || pending.sessionRevision !== sessionRevision) {
    return "cancel"
  }
  if (locationPath !== pending.originPath && locationPath !== pending.targetPath) {
    return "cancel"
  }
  const { view } = pending
  return locationPath === pending.targetPath &&
    view.source === source &&
    String(view.sourceId ?? "") === String(sourceId ?? "")
    ? "restore"
    : "wait"
}

// These descriptions follow the current source adapters, which intentionally do
// not all consume the same status or sort arguments.
export const describeSmartView = (view, sourceName = null) => {
  let status
  if (view.source === "history") {
    status = "read"
  } else if (view.source === "starred") {
    status = view.showStatus === "unread" ? "unread starred" : "starred"
  } else if (["all", "today"].includes(view.source)) {
    status = view.showStatus === "unread" ? "unread" : "all statuses"
  } else {
    status =
      view.showStatus === "starred"
        ? "starred"
        : view.showStatus === "unread"
          ? "unread"
          : "all statuses"
  }
  const order = ["history", "starred"].includes(view.source) ? "changed_at" : view.orderBy
  const source = sourceName ?? `${view.source}${view.sourceId ? ` ${view.sourceId}` : ""}`
  return `${source}; ${status}; ${order} ${view.orderDirection}${view.filterDate ? `; date ${view.filterDate}` : ""}`
}

// Preferences a view applies while it is active. They are session-scoped overlays: the user's
// own preferences are captured before the view opens and restored when it ends.
export const SMART_VIEW_PREFERENCE_KEYS = ["showStatus", "orderBy", "orderDirection"]
export const getSmartViewAppliedPreferences = (view) => ({
  showStatus: getSmartViewRestoredStatus(view),
  orderBy: view.orderBy,
  orderDirection: view.orderDirection,
})

const SOURCE_LABELS = {
  all: "All articles",
  today: "Today",
  starred: "Starred",
  history: "History",
}
const getSmartViewSourceLabel = (view, sourceName = null) =>
  sourceName ?? SOURCE_LABELS[view.source] ?? `${view.source} ${view.sourceId ?? ""}`.trim()

const getStatusLabel = (view) => {
  if (view.source === "history") {
    return "Read"
  }
  if (view.source === "starred") {
    return view.showStatus === "unread" ? "Unread starred" : null
  }
  const status = getSmartViewRestoredStatus(view)
  return status === "unread" ? "Unread" : status === "starred" ? "Starred" : null
}

const getSortLabel = (view) => {
  const field =
    view.source === "history" || view.source === "starred"
      ? "changed"
      : view.orderBy === "created_at"
        ? "added"
        : "published"
  return `${view.orderDirection === "asc" ? "Oldest" : "Newest"} first · ${field}`
}

// Compact, readable predicates shown while a view is active.
export const getSmartViewChips = (view, sourceName = null) => {
  const chips = [{ id: "source", label: getSmartViewSourceLabel(view, sourceName) }]
  const status = getStatusLabel(view)
  chips.push({ id: "status", label: status ?? "All statuses" })
  if (view.filterDate) {
    chips.push({ id: "date", label: `Date ${view.filterDate}` })
  }
  chips.push(
    { id: "query", label: `\u201C${view.query}\u201D` },
    { id: "sort", label: getSortLabel(view) },
  )
  return chips
}

const SUGGESTED_NAME_LIMIT = 60
const truncate = (text, limit) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}\u2026` : text

// Proposes a readable default such as: Unread · Technology · "climate".
export const suggestSmartViewName = (view, sourceName = null, existingNames = []) => {
  const status = getStatusLabel(view)
  const source = getSmartViewSourceLabel(view, sourceName)
  const fixed = [status, source === status ? null : source, view.filterDate].filter(Boolean)
  const prefix = fixed.join(" \u00B7 ")
  const queryBudget = Math.max(12, SUGGESTED_NAME_LIMIT - prefix.length - 5)
  const query = `\u201C${truncate(view.query.replaceAll(/\s+/gu, " "), queryBudget)}\u201D`
  const base = truncate([...fixed, query].join(" \u00B7 "), SUGGESTED_NAME_LIMIT)
  const taken = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()))
  if (!taken.has(base.toLocaleLowerCase())) {
    return base
  }
  for (let sequence = 2; ; sequence += 1) {
    const suffix = ` (${sequence})`
    const candidate = `${truncate(base, SUGGESTED_NAME_LIMIT - suffix.length)}${suffix}`
    if (!taken.has(candidate.toLocaleLowerCase())) {
      return candidate
    }
  }
}

// Decides the stored name: user-provided names stay unchanged unless they duplicate another view.
export const resolveSmartViewName = (typedName, view, sourceName, existingNames) => {
  const name = typedName.trim()
  const taken = existingNames.some(
    (existing) => existing.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
  )
  return name && !taken
    ? { name, generated: false }
    : { name: suggestSmartViewName(view, sourceName, existingNames), generated: true }
}

export const isSmartViewSessionStale = ({ active, content, stored, key, sessionRevision }) => {
  const { view } = active
  if (
    !stored ||
    active.key !== key ||
    active.sessionRevision !== sessionRevision ||
    content.infoFrom !== view.source ||
    String(content.infoId ?? "") !== String(view.sourceId ?? "") ||
    content.filterString !== view.query ||
    (content.filterDate ?? null) !== (view.filterDate ?? null)
  ) {
    return true
  }
  return false
}

export const hasSmartViewPreferencesChanged = (view, settings) => {
  const applied = getSmartViewAppliedPreferences(view)
  return SMART_VIEW_PREFERENCE_KEYS.some((key) => settings[key] !== applied[key])
}
