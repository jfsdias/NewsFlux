export default function hasProviderReportedFeedError(feed) {
  return Number(feed?.parsing_error_count ?? 0) > 0 && feed?.disabled !== true
}

export function feedCheckTime(feed, now = Date.now()) {
  const value = feed?.checked_at
  const time = typeof value === "string" && !value.startsWith("0001-") ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) && time <= now ? time : null
}

export function feedCheckAge(feed, now = Date.now()) {
  const time = feedCheckTime(feed, now)
  if (time === null) {return "unknown"}
  return now - time <= 24 * 60 * 60 * 1000 ? "recent" : "old"
}

export function providerErrorStatus(feed) {
  const count = feed?.parsing_error_count
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {return "errorUnknown"}
  return count > 0 ? "errors" : "none"
}

export function summarizeFeedHealth(feeds, now = Date.now()) {
  const summary = { total: feeds.length, errors: 0, errorUnknown: 0, disabled: 0, recent: 0, old: 0, unknown: 0 }
  for (const feed of feeds) {
    const error = providerErrorStatus(feed)
    if (error !== "none") {summary[error] += 1}
    if (feed?.disabled === true) {summary.disabled += 1}
    summary[feedCheckAge(feed, now)] += 1
  }
  return summary
}
