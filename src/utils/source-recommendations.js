import { Parser } from "htmlparser2"

import { getFeedSuggestions } from "./feed-suggestions.js" // eslint-disable-line import/extensions -- Node ESM tests require the explicit extension.

const TOPICS = {
  tecnologia: "tech",
  technology: "tech",
  tech: "tech",
  ciência: "science",
  ciencia: "science",
  science: "science",
  economia: "economy",
  economy: "economy",
  brasil: "brazil",
  brazil: "brazil",
}
const TOPIC_ORDER = ["tech", "science", "economy", "brazil"]
const WINDOW = 30 * 24 * 60 * 60 * 1000

export const recommendSources = ({ entries, subscribedFeeds, hiddenFeedIds, now }) => {
  const counts = new Map()
  const seen = new Set()
  const references = new Map()
  const catalog = TOPIC_ORDER.flatMap((topic) => getFeedSuggestions(topic, "any", subscribedFeeds))
  const hosts = new Map(catalog.map((item) => [new URL(item.url).hostname, item.url]))
  for (const entry of entries.slice(0, 200)) {
    const { id } = entry
    const feedId = entry.feed_id ?? entry.feed?.id
    if (
      id == null ||
      seen.has(String(id)) ||
      hiddenFeedIds.has(feedId) ||
      hiddenFeedIds.has(String(feedId))
    ) {
      continue
    }
    seen.add(String(id))
    const date = Date.parse(entry.published_at)
    const topic = TOPICS[entry.feed?.category?.title?.trim().toLowerCase()]
    if (!Number.isFinite(date) || date > now || date < now - WINDOW) {
      continue
    }
    const ownHosts = new Set()
    for (const address of [entry.feed?.site_url, entry.feed?.feed_url]) {
      try {
        const url = new URL(address)
        if (["http:", "https:"].includes(url.protocol)) {
          ownHosts.add(url.hostname)
        }
      } catch {
        // Unknown host contributes no self-reference evidence.
      }
    }
    if (ownHosts.size > 0 && typeof entry.content === "string") {
      const linked = new Set()
      let inertDepth = 0
      const parser = new Parser({
        onopentag(name, attributes) {
          if (name === "template" || name === "noscript") {
            inertDepth += 1
            return
          }
          if (inertDepth > 0 || name !== "a" || !attributes.href) {
            return
          }
          try {
            const url = new URL(attributes.href)
            if (
              url.protocol === "https:" &&
              !url.username &&
              !url.password &&
              !ownHosts.has(url.hostname) &&
              hosts.has(url.hostname)
            ) {
              linked.add(hosts.get(url.hostname))
            }
          } catch {
            /* Ignore invalid and relative links. */
          }
        },
        onclosetag(name) {
          if ((name === "template" || name === "noscript") && inertDepth > 0) {
            inertDepth -= 1
          }
        },
      })
      parser.end(entry.content.slice(0, 65_536))
      for (const url of linked) {
        references.set(url, (references.get(url) ?? 0) + 1)
      }
    }
    if (!topic) {
      continue
    }
    const evidence = counts.get(topic) ?? { entries: 0, read: 0, starred: 0 }
    evidence.entries += 1
    if (entry.status === "read") {
      evidence.read += 1
    }
    if (entry.starred === true) {
      evidence.starred += 1
    }
    counts.set(topic, evidence)
  }
  const candidates = catalog.flatMap((item) => {
    const evidence = counts.get(item.topic) ?? { entries: 0, read: 0, starred: 0 }
    const linkedEntries = references.get(item.url) ?? 0
    if (!evidence.entries && !linkedEntries) {
      return []
    }
    return [
      {
        ...item,
        evidence,
        linkedEntries,
        score: evidence.entries + evidence.read + 2 * evidence.starred + linkedEntries,
      },
    ]
  })
  const result = []
  while (candidates.length > 0) {
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        (result.at(-1)?.topic === a.topic ? 1 : 0) - (result.at(-1)?.topic === b.topic ? 1 : 0) ||
        TOPIC_ORDER.indexOf(a.topic) - TOPIC_ORDER.indexOf(b.topic) ||
        a.title.localeCompare(b.title, "en"),
    )
    result.push(candidates.shift())
  }
  return result
}
