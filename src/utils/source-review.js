// View-only counts from the bounded Home sample and its existing related-story groups.
export const buildSourceReview = (entries, groups) => {
  const sources = new Map()
  const seen = new Set()
  for (const entry of entries) {
    const source = entry?.feed_id ?? entry?.feed?.id
    if (source == null || entry?.id == null || seen.has(entry.id)) continue
    seen.add(entry.id)
    const id = String(source)
    if (!sources.has(id)) {
      sources.set(id, {
        id,
        name: entry.feed?.title || id,
        entryCount: 0,
        relatedCount: 0,
      })
    }
    sources.get(id).entryCount += 1
  }
  const relatedIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.id)))
  const counted = new Set()
  for (const entry of entries) {
    const source = entry?.feed_id ?? entry?.feed?.id
    if (source == null || !relatedIds.has(entry?.id) || counted.has(entry.id)) continue
    counted.add(entry.id)
    const summary = sources.get(String(source))
    if (summary) summary.relatedCount += 1
  }
  return [...sources.values()]
}
