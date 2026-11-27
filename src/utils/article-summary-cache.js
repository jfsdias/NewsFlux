// In-memory cache of finished article summaries for this browser tab.
// Nothing is written to storage: a reload, sign-out or session change starts empty.
// The key binds the auth session, the entry, its Miniflux version and every setting
// that shapes the summary, so a changed article or changed preferences never reuse
// an old result.

const MAX_ENTRIES = 50
const CACHEABLE_STATUSES = new Set(["complete", "partial"])
const cache = new Map()

export const SUMMARY_SETTING_KEYS = [
  "aiSummaryModel",
  "aiSummaryFallbackEnabled",
  "aiSummaryFallbackModel",
  "aiSummaryFallbackAllowPaid",
  "aiSummaryFallbackAllowCrossProvider",
  "aiSummaryLength",
  "aiSummaryFocus",
  "aiSummarySections",
  "aiSummaryLanguage",
]

export const summaryCacheKey = ({
  authSessionKey,
  sessionRevision,
  entryId,
  entryVersion,
  settings,
}) => {
  if (
    !authSessionKey ||
    !Number.isSafeInteger(sessionRevision) ||
    !Number.isSafeInteger(entryId) ||
    entryId <= 0
  ) {
    return null
  }
  const shaping = SUMMARY_SETTING_KEYS.map((name) => settings?.[name] ?? null)
  return JSON.stringify([authSessionKey, sessionRevision, entryId, entryVersion ?? "", shaping])
}

export const readCachedSummary = (key) => {
  if (!key || !cache.has(key)) {
    return null
  }
  const value = cache.get(key)
  cache.delete(key) // refresh recency
  cache.set(key, value)
  return value
}

// Read without touching recency (safe during render).
export const peekCachedSummary = (key) => (key ? (cache.get(key) ?? null) : null)

export const storeCachedSummary = (key, value) => {
  if (!key || !CACHEABLE_STATUSES.has(value?.summary?.status)) {
    return
  }
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value)
  }
}

export const clearSummaryCache = () => cache.clear()
