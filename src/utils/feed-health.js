export default function hasProviderReportedFeedError(feed) {
  return Number(feed?.parsing_error_count ?? 0) > 0 && feed?.disabled !== true
}

export function feedCheckTime(feed, now = Date.now()) {
  const value = feed?.checked_at
  if (typeof value !== "string") {
    return null
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      value,
    )
  if (!match) {
    return null
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    year <= 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null
  }
  if (
    zone.toUpperCase() !== "Z" &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)
  ) {
    return null
  }
  const time = Date.parse(value)
  return Number.isFinite(time) && time <= now ? time : null
}

export function feedCheckAge(feed, now = Date.now()) {
  const time = feedCheckTime(feed, now)
  if (time === null) {
    return "unknown"
  }
  return now - time <= 24 * 60 * 60 * 1000 ? "recent" : "old"
}

export function providerErrorStatus(feed) {
  const count = feed?.parsing_error_count
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    return "errorUnknown"
  }
  return count > 0 ? "errors" : "none"
}

export function summarizeFeedHealth(feeds, now = Date.now()) {
  const summary = {
    total: feeds.length,
    errors: 0,
    errorUnknown: 0,
    disabled: 0,
    recent: 0,
    old: 0,
    unknown: 0,
  }
  for (const feed of feeds) {
    const error = providerErrorStatus(feed)
    if (error !== "none") {
      summary[error] += 1
    }
    if (feed?.disabled === true) {
      summary.disabled += 1
    }
    summary[feedCheckAge(feed, now)] += 1
  }
  return summary
}
