// Browser-local descriptors only. This module never stores article text or credentials.
export const CONTINUITY_VERSION = 1
export const MAX_CONTINUITY_RECORDS = 200
const MAX_OFFSET = 10_000_000

const validKey = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
const validId = (value) => Number.isSafeInteger(value) && value > 0
const validOffset = (value) => Number.isFinite(value) && value >= 0 && value <= MAX_OFFSET

export const sanitizeContinuityStorage = (value) => {
  if (!value || value.version !== CONTINUITY_VERSION || !Array.isArray(value.records)) {
    return { version: CONTINUITY_VERSION, records: [] }
  }
  const seen = new Set()
  const records = []
  for (const record of value.records) {
    if (
      !validKey(record?.account) ||
      !validKey(record?.scope) ||
      !validId(record.entryId) ||
      !validOffset(record.offset) ||
      !["reader", "list"].includes(record.kind)
    ) {
      continue
    }
    const key = JSON.stringify([
      record.account,
      record.kind,
      record.scope,
      record.kind === "reader" ? record.entryId : null,
    ])
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    records.push({
      account: record.account,
      kind: record.kind,
      scope: record.scope,
      entryId: record.entryId,
      offset: record.offset,
    })
    if (records.length === MAX_CONTINUITY_RECORDS) {
      break
    }
  }
  return { version: CONTINUITY_VERSION, records }
}

export const upsertContinuity = (storage, record) => {
  const sanitized = sanitizeContinuityStorage({ version: CONTINUITY_VERSION, records: [record] })
    .records[0]
  if (!sanitized) {
    return sanitizeContinuityStorage(storage)
  }
  const prior = sanitizeContinuityStorage(storage).records.filter(
    (item) =>
      !(
        item.account === sanitized.account &&
        item.kind === sanitized.kind &&
        item.scope === sanitized.scope &&
        (item.kind === "list" || item.entryId === sanitized.entryId)
      ),
  )
  return sanitizeContinuityStorage({ version: CONTINUITY_VERSION, records: [sanitized, ...prior] })
}

export const clearContinuityAccount = (storage, account) => ({
  version: CONTINUITY_VERSION,
  records: sanitizeContinuityStorage(storage).records.filter(
    (record) => record.account !== account,
  ),
})
