const isWebUrl = (value) => {
  if (typeof value !== "string") {
    return false
  }

  try {
    const url = new URL(value)
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname)
  } catch {
    return false
  }
}

export const normalizeDiscoveredFeeds = (feeds) => {
  if (!Array.isArray(feeds)) {
    return []
  }

  const seenUrls = new Set()
  return feeds.filter((feed) => {
    if (!isWebUrl(feed?.url) || seenUrls.has(feed.url)) {
      return false
    }

    seenUrls.add(feed.url)
    return true
  })
}

export async function discoverAndSubscribeFeed({
  url,
  categoryId,
  isFullText,
  discover,
  resolveCandidate,
  subscribe,
}) {
  const candidates = normalizeDiscoveredFeeds(await discover(url))
  if (candidates.length === 0) {
    return { status: "empty" }
  }

  const resolvedCandidate = await resolveCandidate(candidates)
  const candidate = candidates.find(
    ({ url: candidateUrl }) => candidateUrl === resolvedCandidate?.url,
  )
  if (!candidate) {
    return { status: "cancelled" }
  }

  const response = await subscribe(candidate.url, categoryId, isFullText)
  return response
    ? { status: "subscribed", candidate, response }
    : { status: "subscribe-failed", candidate }
}
