// NF-0903 reading signals (ADR 0002): per-feed, per-UTC-day counters only. Pure and storage-safe.
// The current day's entry IDs are kept only to count each entry once per day, and are dropped at
// the next day change. Titles, URLs and content are never accepted.

export const READING_SIGNALS_BASE_PATH = "/api/reading-signals"
const SIGNAL_KINDS = Object.freeze(["impressions", "opens", "read_to_end", "stars"])
export const MAX_SEEN_PER_KIND = 5000
export const MAX_BATCH_ROWS = 200 // server limit per POST
const MAX_PENDING_DAYS = 7 // server accepts today − 7 … today + 1
const MAX_COUNT = 100_000
const DAY_MS = 86_400_000
const ROW_KEY = /^([1-9]\d{0,15})\|(\d{4}-\d{2}-\d{2})$/u
const DAY = /^\d{4}-\d{2}-\d{2}$/u
const ACCOUNT = /^[a-f0-9]{64}$/u

const READ_TO_END_PROGRESS = 0.85
const MIN_DWELL_MS = 5000
const MAX_DWELL_MS = 120_000
const DWELL_SHARE_OF_READING_TIME = 0.3

const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0
const isCount = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const emptySeen = () => Object.fromEntries(SIGNAL_KINDS.map((kind) => [kind, []]))
const emptyCounts = () => Object.fromEntries(SIGNAL_KINDS.map((kind) => [kind, 0]))

export const createSignalStorage = (account) => ({
  version: 1,
  account,
  day: null,
  seen: emptySeen(),
  rows: {},
})

export const sanitizeSignalStorage = (value, account) => {
  if (
    !ACCOUNT.test(account ?? "") ||
    !value ||
    typeof value !== "object" ||
    value.version !== 1 ||
    value.account !== account
  ) {
    return createSignalStorage(account)
  }
  const day = typeof value.day === "string" && DAY.test(value.day) ? value.day : null
  const seen = emptySeen()
  if (day) {
    for (const kind of SIGNAL_KINDS) {
      const ids = Array.isArray(value.seen?.[kind]) ? value.seen[kind] : []
      seen[kind] = [...new Set(ids.filter((id) => isPositiveId(id)))].slice(0, MAX_SEEN_PER_KIND)
    }
  }
  const rows = {}
  for (const [key, counts] of Object.entries(value.rows ?? {})) {
    if (ROW_KEY.test(key) && counts && typeof counts === "object") {
      const clean = emptyCounts()
      for (const kind of SIGNAL_KINDS) {
        clean[kind] = isCount(counts[kind]) ? counts[kind] : 0
      }
      rows[key] = clean
    }
  }
  return { version: 1, account, day, seen, rows }
}

export const recordSignal = (storage, { account, kind, entryId, feedId, nowMs }) => {
  if (
    !SIGNAL_KINDS.includes(kind) ||
    !isPositiveId(entryId) ||
    !isPositiveId(feedId) ||
    !Number.isFinite(nowMs)
  ) {
    return storage
  }
  const base = storage?.account === account ? storage : createSignalStorage(account)
  const day = utcDay(nowMs)
  const seen = base.day === day ? base.seen : emptySeen()
  if (seen[kind].includes(entryId) || seen[kind].length >= MAX_SEEN_PER_KIND) {
    return base
  }
  const key = `${feedId}|${day}`
  const counts = { ...(base.rows[key] ?? emptyCounts()) }
  counts[kind] = Math.min(MAX_COUNT, counts[kind] + 1)
  return {
    ...base,
    day,
    seen: { ...seen, [kind]: [...seen[kind], entryId] },
    rows: { ...base.rows, [key]: counts },
  }
}

export const buildSignalBatches = (storage, nowMs) => {
  const oldest = utcDay(nowMs - MAX_PENDING_DAYS * DAY_MS)
  const rows = Object.entries(storage?.rows ?? {})
    .map(([key, counts]) => {
      const [, feedId, day] = ROW_KEY.exec(key) ?? []
      return feedId ? { feed_id: Number(feedId), day, ...counts } : null
    })
    .filter((row) => row && row.day >= oldest && SIGNAL_KINDS.some((kind) => row[kind] > 0))
    .toSorted((a, b) => a.day.localeCompare(b.day) || a.feed_id - b.feed_id)
  const batches = []
  for (let index = 0; index < rows.length; index += MAX_BATCH_ROWS) {
    batches.push({ schema: 1, rows: rows.slice(index, index + MAX_BATCH_ROWS) })
  }
  return batches
}

export const removeSentRows = (storage, sentRows) => {
  const rows = { ...storage.rows }
  for (const sent of sentRows) {
    const key = `${sent.feed_id}|${sent.day}`
    if (!rows[key]) {
      continue
    }
    const remaining = emptyCounts()
    for (const kind of SIGNAL_KINDS) {
      remaining[kind] = Math.max(0, rows[key][kind] - sent[kind])
    }
    if (SIGNAL_KINDS.some((kind) => remaining[kind] > 0)) {
      rows[key] = remaining
    } else {
      delete rows[key]
    }
  }
  return { ...storage, rows }
}

export const dropExpiredRows = (storage, nowMs) => {
  const oldest = utcDay(nowMs - MAX_PENDING_DAYS * DAY_MS)
  const rows = Object.fromEntries(
    Object.entries(storage.rows).filter(([key]) => (ROW_KEY.exec(key)?.[2] ?? "") >= oldest),
  )
  return { ...storage, rows }
}

export const getReadToEndDwellMs = (readingTimeMinutes) => {
  const minutes =
    Number.isFinite(readingTimeMinutes) && readingTimeMinutes > 0 ? readingTimeMinutes : 0
  return Math.min(
    MAX_DWELL_MS,
    Math.max(MIN_DWELL_MS, minutes * 60_000 * DWELL_SHARE_OF_READING_TIME),
  )
}

export const isReadToEnd = ({ progress, dwellMs, readingTimeMinutes }) =>
  progress >= READ_TO_END_PROGRESS && dwellMs >= getReadToEndDwellMs(readingTimeMinutes)
