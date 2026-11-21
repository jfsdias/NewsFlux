// A view-only projection. Canonical entries and their order stay untouched.
export const projectDuplicates = (entries, option, expandedIds = new Set()) => {
  const groups = new Map()
  const counts = new Map()
  const hiddenIds = new Set()
  if (!["hash", "title", "url"].includes(option)) {
    return { entries, counts }
  }

  for (const entry of entries) {
    const value = entry[option]
    // Missing values cannot establish identity. Repeated page IDs are not duplicates.
    if (typeof value !== "string" || !value.trim()) continue
    const group = groups.get(value)
    if (group) {
      if (!group.ids.has(entry.id)) {
        group.ids.add(entry.id)
        group.entries.push(entry)
      }
    } else {
      groups.set(value, { entries: [entry], ids: new Set([entry.id]) })
    }
  }

  for (const group of groups.values()) {
    if (group.entries.length < 2) continue
    const first = group.entries[0]
    counts.set(first.id, group.entries.length)
    if (!expandedIds.has(first.id)) {
      for (const entry of group.entries.slice(1)) hiddenIds.add(entry.id)
    }
  }
  return { entries: entries.filter((entry) => !hiddenIds.has(entry.id)), counts }
}
