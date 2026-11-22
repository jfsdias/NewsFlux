// Local, view-only calculations over the entries already loaded on Home.
export const getEditorialTitle = (entry, fallback) =>
  typeof entry?.title === "string" && entry.title.trim() ? entry.title : fallback
const tokens = (title) =>
  new Set(
    String(title ?? "")
      .toLocaleLowerCase("en-US")
      .normalize("NFKD")
      .replaceAll(/\p{M}/gu, "")
      .match(/[\p{L}\p{N}]{4,}/gu),
  )
const sourceId = (entry) => entry.feed_id ?? entry.feed?.id
const duplicate = (a, b) =>
  ["hash", "url", "title"].some(
    (key) => typeof a[key] === "string" && a[key].trim() && a[key] === b[key],
  )
const related = (a, b) => {
  if (
    duplicate(a, b) ||
    sourceId(a) == null ||
    sourceId(b) == null ||
    sourceId(a) === sourceId(b)
  ) {
    return false
  }
  const aTime = Date.parse(a.published_at)
  const bTime = Date.parse(b.published_at)
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime) || Math.abs(aTime - bTime) > 86_400_000) {
    return false
  }
  const left = tokens(a.title)
  const right = tokens(b.title)
  const common = [...left].filter((word) => right.has(word))
  return common.length >= 3 && common.length / Math.max(left.size, right.size) >= 0.6
}

// Every member must directly match every other member; no transitive chaining.
export const groupHomeStories = (entries) => {
  const groups = []
  for (const entry of entries) {
    if (
      entry?.id == null ||
      groups.some((group) => group.entries.some((item) => item.id === entry.id))
    ) {
      continue
    }
    const match = groups.find((group) => group.entries.every((item) => related(item, entry)))
    if (match) {
      match.entries.push(entry)
    } else {
      groups.push({ entries: [entry] })
    }
  }
  return groups.filter((group) => group.entries.length > 1)
}

export const projectFocus = (entries, feedId) =>
  feedId === "" ? entries : entries.filter((entry) => String(sourceId(entry)) === feedId)
export const buildBriefing = (
  entries,
  { now = Date.now(), preferences = {}, categoryPreferences = {} } = {},
) => {
  const recent = entries.filter((entry) => {
    const time = Date.parse(entry.published_at)
    return Number.isFinite(time) && time <= now && now - time <= 86_400_000
  })
  const sourceFrequency = new Map()
  for (const entry of recent) {
    const source = sourceId(entry)
    if (source != null) {
      sourceFrequency.set(String(source), (sourceFrequency.get(String(source)) ?? 0) + 1)
    }
  }
  const ranked = recent
    .map((entry, index) => ({
      entry,
      index,
      frequency: sourceFrequency.get(String(sourceId(entry))) ?? Number.POSITIVE_INFINITY,
      score:
        (preferences[String(sourceId(entry))] ?? 0) +
        (categoryPreferences[String(entry.feed?.category?.id)] ?? 0),
    }))
    .toSorted((a, b) => b.score - a.score || a.frequency - b.frequency || a.index - b.index)
  const chosen = []
  const usedSources = new Set()
  const usedCategories = new Set()
  const stories = groupHomeStories(recent)
  const storyById = new Map(
    stories.flatMap((group, index) => group.entries.map((entry) => [entry.id, index])),
  )
  const usedStories = new Set()
  for (const requireNewCategory of [true, false]) {
    for (const item of ranked) {
      const source = sourceId(item.entry)
      const category = item.entry.feed?.category?.id
      const story = storyById.get(item.entry.id)
      if (
        chosen.includes(item.entry) ||
        chosen.some((existing) => duplicate(existing, item.entry)) ||
        (source != null && usedSources.has(source)) ||
        (story != null && usedStories.has(story)) ||
        (requireNewCategory && category != null && usedCategories.has(category))
      ) {
        continue
      }
      chosen.push(item.entry)
      if (source != null) {
        usedSources.add(source)
      }
      if (category != null) {
        usedCategories.add(category)
      }
      if (story != null) {
        usedStories.add(story)
      }
      if (chosen.length === 5) {
        break
      }
    }
    if (chosen.length === 5) {
      break
    }
  }
  return {
    entries: chosen,
    recentCount: recent.length,
    sourceCount: new Set(entries.map((entry) => sourceId(entry)).filter((id) => id != null)).size,
    unreadCount: entries.filter((entry) => entry.status === "unread").length,
  }
}
