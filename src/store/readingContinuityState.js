import { persistentAtom } from "@nanostores/persistent"

import {
  clearContinuityAccount,
  sanitizeContinuityStorage,
  upsertContinuity,
} from "@/utils/reading-continuity"

const empty = { version: 1, records: [] }
export const readingContinuityState = persistentAtom("reading-continuity-v1", empty, {
  encode: (value) => JSON.stringify(sanitizeContinuityStorage(value)),
  decode: (value) => {
    try {
      return sanitizeContinuityStorage(JSON.parse(value))
    } catch {
      return empty
    }
  },
})
export const saveReadingContinuity = (record) =>
  readingContinuityState.set(upsertContinuity(readingContinuityState.get(), record))
let resetRevision = 0
export const getContinuityResetRevision = () => resetRevision
export const clearReadingContinuity = (account) => {
  resetRevision += 1
  readingContinuityState.set(clearContinuityAccount(readingContinuityState.get(), account))
}
