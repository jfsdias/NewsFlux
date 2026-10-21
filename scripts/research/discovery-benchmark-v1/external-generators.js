import { normalizeExternalUrl } from "./benchmark.js"

export const EXTERNAL_GENERATOR_IDS = Object.freeze([
  "G3_GDELT",
  "G4_GENERAL_SEARCH",
  "G5_OPEN_FEED_INDEX",
])

export const EXTERNAL_GENERATOR_FIXTURES = Object.freeze({
  G3_GDELT: Object.freeze([
    Object.freeze({
      siteUrl: "https://science.example.org",
      feedUrl: "https://science.example.org/rss.xml",
    }),
  ]),
  G4_GENERAL_SEARCH: Object.freeze([
    Object.freeze({ siteUrl: "https://journal.example.net", feedUrl: null }),
  ]),
  G5_OPEN_FEED_INDEX: Object.freeze([
    Object.freeze({
      siteUrl: "https://engineering.example.com",
      feedUrl: "https://engineering.example.com/atom.xml",
    }),
  ]),
})

export function classifyExternalGeneratorOutcome({ executed, candidates, error } = {}) {
  if (!executed) {
    return { status: "NOT_EXECUTED", candidateCount: null }
  }
  if (error) {
    return { status: "FAILED", candidateCount: null }
  }
  if (!Array.isArray(candidates)) {
    return { status: "FAILED", candidateCount: null }
  }
  if (candidates.length === 0) {
    return { status: "EMPTY", candidateCount: 0 }
  }
  return { status: "SUCCEEDED", candidateCount: candidates.length }
}

const containsUrl = (value) => /(?:https?:\/\/|www\.)/i.test(String(value || ""))

/**
 * Prepare a manually approved public query set for an adapter. This creates
 * request envelopes only; it never calls a generator or transmits the queries.
 */
export function preparePublicQuerySet(queries, { approvedByUser = false } = {}) {
  if (!approvedByUser) {
    return { ready: false, reason: "USER_APPROVAL_REQUIRED", requests: [] }
  }
  if (!Array.isArray(queries) || queries.length === 0) {
    return { ready: false, reason: "PUBLIC_QUERY_SET_REQUIRED", requests: [] }
  }

  const safeQueries = []
  for (const query of queries) {
    const text = typeof query?.query === "string" ? query.query.trim() : ""
    const sourceOfTopic = typeof query?.sourceOfTopic === "string" ? query.sourceOfTopic.trim() : ""
    const whySafeToExport =
      typeof query?.whySafeToExport === "string" ? query.whySafeToExport.trim() : ""
    if (!text || !sourceOfTopic || !whySafeToExport || containsUrl(text)) {
      return { ready: false, reason: "QUERY_SET_REQUIRES_PUBLIC_TOPIC_PROVENANCE", requests: [] }
    }
    safeQueries.push({
      id: String(query.id || `PUBLIC_QUERY_${String(safeQueries.length + 1).padStart(2, "0")}`),
      query: text,
      sourceOfTopic,
      whySafeToExport,
    })
  }

  return {
    ready: true,
    executed: false,
    requests: EXTERNAL_GENERATOR_IDS.map((generator) => ({ generator, queries: safeQueries })),
  }
}

/** Normalize fixture/adapter output without fetching pages, URLs, or feed endpoints. */
export function normalizeExternalGeneratorCandidates(generator, candidates) {
  if (!EXTERNAL_GENERATOR_IDS.includes(generator)) {
    throw new Error(`Unknown external generator: ${generator}`)
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError("External generator candidates must be an array.")
  }

  const byHost = new Map()
  for (const candidate of candidates) {
    const site = normalizeExternalUrl(candidate?.siteUrl)
    if (!site.ok || site.redirectLike || site.noiseReason) {
      continue
    }

    const feed = candidate?.feedUrl ? normalizeExternalUrl(candidate.feedUrl) : null
    const safeFeedUrl = feed?.ok && !feed.redirectLike && !feed.noiseReason ? feed.url : null
    const current = byHost.get(site.hostname) || {
      domain: site.hostname,
      siteUrl: new URL(site.url).origin,
      candidateFeedUrls: new Set(),
      discoveryOrigins: new Set(),
      confidence: "LOW; EXTERNAL_RESULT_UNVERIFIED",
      valueLabel: "UNKNOWN",
    }
    if (safeFeedUrl) {
      current.candidateFeedUrls.add(safeFeedUrl)
    }
    current.discoveryOrigins.add(generator)
    byHost.set(site.hostname, current)
  }

  return {
    candidates: [...byHost.values()]
      .map((candidate) => ({
        ...candidate,
        candidateFeedUrls: [...candidate.candidateFeedUrls].toSorted(),
        discoveryOrigins: [...candidate.discoveryOrigins].toSorted(),
      }))
      .toSorted((a, b) => a.domain.localeCompare(b.domain)),
    remoteFetchPerformed: false,
  }
}
