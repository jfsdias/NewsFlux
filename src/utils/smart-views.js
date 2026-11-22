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
