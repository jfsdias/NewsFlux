import { persistentAtom } from "@nanostores/persistent"

import { resetReadingSignalsOnServer, sendReadingSignals } from "@/apis/reading-signals"
import { homeIdentityState } from "@/store/homePageState"
import { settingsState, updateSettings } from "@/store/settingsState"
import { continuityFingerprint } from "@/utils/continuity-fingerprint"
import { getHomeIdentityKey } from "@/utils/home-page"
import { selectStore } from "@/utils/nanostores"
import {
  buildSignalBatches,
  createSignalStorage,
  dropExpiredRows,
  recordSignal,
  removeSentRows,
  sanitizeSignalStorage,
} from "@/utils/reading-signals"

// NF-0903 (ADR 0002): opt-in, off by default. While off, nothing is recorded and no request is made.
const FLUSH_DELAY_MS = 30_000
const EMPTY = createSignalStorage(null)

const readingSignalsStorage = persistentAtom("reading-signals-v1", EMPTY, {
  encode: (value) => JSON.stringify(value),
  decode: (value) => {
    try {
      return JSON.parse(value)
    } catch {
      return EMPTY
    }
  },
})

export const learnFromReadingState = selectStore(
  settingsState,
  ({ learnFromReading }) => learnFromReading === true,
)

let cachedAccount = { key: "", digest: null }
let flushTimer = null
let flushing = false
let lifecycleInstalled = false

const isEnabled = () => settingsState.get().learnFromReading === true

const resolveAccount = async () => {
  const key = getHomeIdentityKey(homeIdentityState.get())
  if (!key) {
    return null
  }
  if (cachedAccount.key !== key) {
    cachedAccount = { key, digest: await continuityFingerprint(key) }
  }
  return cachedAccount.key === key ? cachedAccount.digest : null
}

const clearFlushTimer = () => {
  if (flushTimer !== null) {
    globalThis.clearTimeout(flushTimer)
    flushTimer = null
  }
}

const flushReadingSignals = async ({ keepalive = false } = {}) => {
  clearFlushTimer()
  if (flushing || !isEnabled()) {
    return
  }
  const account = await resolveAccount()
  if (!account) {
    return
  }
  flushing = true
  try {
    let storage = dropExpiredRows(
      sanitizeSignalStorage(readingSignalsStorage.get(), account),
      Date.now(),
    )
    readingSignalsStorage.set(storage)
    for (const batch of buildSignalBatches(storage, Date.now())) {
      if (!isEnabled()) {
        return
      }
      await sendReadingSignals(batch, { keepalive })
      storage = removeSentRows(
        sanitizeSignalStorage(readingSignalsStorage.get(), account),
        batch.rows,
      )
      readingSignalsStorage.set(storage)
    }
  } catch {
    // Kept locally for a later attempt (at most seven days); learning never blocks reading.
  } finally {
    flushing = false
  }
}

const scheduleFlush = () => {
  if (flushTimer === null) {
    flushTimer = globalThis.setTimeout(() => void flushReadingSignals(), FLUSH_DELAY_MS)
  }
}

const installLifecycleFlush = () => {
  if (lifecycleInstalled || typeof document === "undefined") {
    return
  }
  lifecycleInstalled = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void flushReadingSignals({ keepalive: true })
    }
  })
}

const entryIds = (entry) => ({
  entryId: Number(entry?.id),
  feedId: Number(entry?.feed?.id ?? entry?.feed_id),
})

export const recordReadingSignal = async (kind, entry) => {
  if (!isEnabled()) {
    return
  }
  const { entryId, feedId } = entryIds(entry)
  const account = await resolveAccount()
  if (!account || !isEnabled()) {
    return
  }
  const current = sanitizeSignalStorage(readingSignalsStorage.get(), account)
  const next = recordSignal(current, { account, kind, entryId, feedId, nowMs: Date.now() })
  if (next !== current) {
    readingSignalsStorage.set(next)
    installLifecycleFlush()
    scheduleFlush()
  }
}

const clearLocalReadingSignals = () => {
  clearFlushTimer()
  readingSignalsStorage.set(EMPTY)
}

// Turning learning on starts from a clean local state; turning it off discards unsent counters.
export const setLearnFromReading = (enabled) => {
  clearLocalReadingSignals()
  updateSettings({ learnFromReading: enabled === true })
}

export const resetReadingSignals = async () => {
  clearLocalReadingSignals()
  return resetReadingSignalsOnServer()
}
