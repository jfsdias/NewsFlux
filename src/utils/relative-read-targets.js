const DIRECTIONS = new Set(["above", "below"])

// Above/below follows the displayed array order only. Entry IDs and timestamps are identifiers,
// not list-position semantics, so they are deliberately never compared here.
export const getRelativeUnreadTargetIds = (displayedEntries, anchorId, direction) => {
  if (!DIRECTIONS.has(direction)) {
    throw new TypeError(`Unsupported relative read direction: ${direction}`)
  }

  const anchorIndex = displayedEntries.findIndex((entry) => entry.id === anchorId)
  if (anchorIndex === -1) {
    return []
  }

  const candidates =
    direction === "above"
      ? displayedEntries.slice(0, anchorIndex)
      : displayedEntries.slice(anchorIndex + 1)
  const targetIds = new Set()
  for (const entry of candidates) {
    if (entry.status === "unread" && entry.id !== anchorId) {
      targetIds.add(entry.id)
    }
  }

  return [...targetIds]
}

export default getRelativeUnreadTargetIds
