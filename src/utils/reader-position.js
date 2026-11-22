// A position is usable only for exactly the same article body.
export const findReaderPosition = (records, account, entryId, contentFingerprint) => {
  if (
    !Array.isArray(records) ||
    !account ||
    !contentFingerprint ||
    !Number.isSafeInteger(entryId) ||
    entryId <= 0
  ) {
    return null
  }
  const record = records.find(
    (item) =>
      item.account === account &&
      item.kind === "reader" &&
      item.entryId === entryId &&
      item.scope === contentFingerprint,
  )
  return record &&
    Number.isFinite(record.offset) &&
    record.offset >= 0 &&
    record.offset <= 10_000_000
    ? record.offset
    : null
}

export const clampReaderPosition = (offset, scrollHeight, clientHeight) =>
  Math.min(offset, Math.max(0, scrollHeight - clientHeight))

// Allow scroll momentum briefly after the last trusted gesture, unless continuity was reset.
export const canCaptureReaderScroll = (gesture, revision, now) =>
  gesture !== null && gesture.revision === revision && now >= gesture.at && now - gesture.at <= 1500
