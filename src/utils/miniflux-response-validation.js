const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0

const assertTextOrNull = (record, field, label) => {
  if (
    !Object.hasOwn(record, field) ||
    (record[field] !== null && typeof record[field] !== "string")
  ) {
    throw new TypeError(`Invalid ${label} response`)
  }
}

const validateFeed = (feed) => {
  if (!isRecord(feed) || !isPositiveInteger(feed.id)) {
    throw new TypeError("Invalid feed response")
  }

  if (
    feed.category !== undefined &&
    feed.category !== null &&
    (!isRecord(feed.category) ||
      !isPositiveInteger(feed.category.id) ||
      (feed.category.title !== null && typeof feed.category.title !== "string"))
  ) {
    throw new TypeError("Invalid category response")
  }
}

export const validateMinifluxEntry = (entry, expectedId) => {
  if (!isRecord(entry) || !isPositiveInteger(entry.id)) {
    throw new TypeError("Invalid entry response")
  }
  if (
    expectedId !== undefined &&
    (!isPositiveInteger(Number(expectedId)) || entry.id !== Number(expectedId))
  ) {
    throw new TypeError("Mismatched entry response")
  }

  assertTextOrNull(entry, "title", "entry")
  assertTextOrNull(entry, "content", "entry")
  validateFeed(entry.feed)

  return entry
}

export const validateMinifluxEntryList = (response) => {
  if (
    !isRecord(response) ||
    !Number.isSafeInteger(response.total) ||
    response.total < 0 ||
    !Array.isArray(response.entries)
  ) {
    throw new TypeError("Invalid entries response")
  }

  for (const entry of response.entries) {
    validateMinifluxEntry(entry)
  }

  return response
}

export default validateMinifluxEntryList
