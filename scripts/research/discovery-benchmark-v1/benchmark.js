import { createHash } from "node:crypto"
import { isIP } from "node:net"

const MAX_URL_LENGTH = 8192
export const DISCOVERY_BENCHMARK_VERSION = "1.0.0"
export const DISCOVERY_BENCHMARK_CONFIG = Object.freeze({
  articleWindowDays: 90,
  g1Contexts: Object.freeze(["EDITORIAL_BODY", "UNKNOWN"]),
  g2Contexts: Object.freeze(["BLOGROLL", "AUTHOR_LINK", "ALTERNATE_FEED"]),
  maxHeldOut: 40,
  reviewLimit: 50,
  externalGeneratorsEnabled: false,
})
const TRACKING_PARAM =
  /^(?:utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|yclid|gbraid|wbraid|ref_src|s_cid)$/i
const SENSITIVE_PARAM =
  /^(?:access[_-]?token|api[_-]?key|auth|authorization|code|key|password|passwd|secret|session|signature|sig|token|id_token)$/i
const REDIRECT_PARAM =
  /^(?:redirect(?:_url)?|url|target|destination|dest|next|continue|return(?:_to|url)?|callback|out)$/i

const MULTI_LABEL_SUFFIXES = new Set([
  "ac.uk",
  "co.in",
  "co.id",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.ar",
  "com.au",
  "com.br",
  "com.cn",
  "com.hk",
  "com.mx",
  "com.my",
  "com.ph",
  "com.pt",
  "com.sg",
  "com.tr",
  "com.tw",
  "edu.au",
  "gov.br",
  "gov.uk",
  "net.au",
  "net.br",
  "org.au",
  "org.br",
  "org.uk",
])
const COMMON_TLDS = new Set([
  "aero",
  "ai",
  "app",
  "biz",
  "cloud",
  "com",
  "coop",
  "dev",
  "edu",
  "fm",
  "gov",
  "info",
  "int",
  "io",
  "mil",
  "museum",
  "name",
  "net",
  "news",
  "online",
  "org",
  "pro",
  "shop",
  "site",
  "tech",
  "tv",
  "xyz",
])
const NOISE_DOMAINS = {
  SOCIAL: [
    "bsky.app",
    "discord.gg",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "mastodon.social",
    "reddit.com",
    "t.me",
    "telegram.org",
    "threads.net",
    "tiktok.com",
    "twitter.com",
    "x.com",
    "youtu.be",
    "youtube.com",
  ],
  CDN: ["akamaihd.net", "cdnjs.cloudflare.com", "cloudfront.net", "jsdelivr.net", "unpkg.com"],
  TRACKER: [
    "doubleclick.net",
    "google-analytics.com",
    "googletagmanager.com",
    "googlesyndication.com",
    "scorecardresearch.com",
  ],
  AFFILIATE: ["amzn.to", "awin1.com", "impact.com", "linksynergy.com", "shareasale.com"],
  PAYMENT: ["checkout.com", "checkout.stripe.com", "paypal.com", "stripe.com"],
}

function cleanHostname(hostname) {
  return String(hostname || "")
    .replaceAll(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "")
}

function isDomainOrSubdomain(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function isBlockedIpv4(hostname) {
  const parts = hostname.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true
  }
  const [a, b, c] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function isBlockedIpv6(hostname) {
  if (hostname === "::" || hostname === "::1") {
    return true
  }
  if (/^(?:fc|fd)/.test(hostname)) {
    return true
  }
  if (/^fe[89ab]/.test(hostname)) {
    return true
  }
  if (hostname.startsWith("ff")) {
    return true
  }
  if (hostname.startsWith("::ffff:")) {
    return true
  }
  if (/^2001:db8(?::|$)/.test(hostname)) {
    return true
  }
  return !/^[23]/.test(hostname)
}

export function isPrivateHost(hostname) {
  const host = cleanHostname(hostname)
  if (!host) {
    return true
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example")
  ) {
    return true
  }
  if (isIP(host) === 4) {
    return isBlockedIpv4(host)
  }
  if (isIP(host) === 6) {
    return isBlockedIpv6(host)
  }
  return !host.includes(".")
}

function noiseReasonForHost(hostname) {
  for (const [reason, domains] of Object.entries(NOISE_DOMAINS)) {
    if (domains.some((domain) => isDomainOrSubdomain(hostname, domain))) {
      return reason
    }
  }
  if (/^(?:ads?|adservice|pixel|tracking|tracker|analytics|metrics)\./i.test(hostname)) {
    return "TRACKER"
  }
  if (/^(?:accounts?|auth|login|sso)\./i.test(hostname)) {
    return "LOGIN"
  }
  return null
}

function stableQueryPairs(searchParams) {
  return [...searchParams.entries()]
    .map(([key, value], index) => ({ key, value, index }))
    .toSorted((a, b) => a.key.localeCompare(b.key) || a.index - b.index)
    .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")
}

export function registrableDomain(hostname) {
  const host = cleanHostname(hostname)
  if (!host || isIP(host)) {
    return null
  }
  const labels = host.split(".")
  if (labels.length < 2) {
    return null
  }
  const suffix2 = labels.slice(-2).join(".")
  const tld = labels.at(-1)
  const suffixLength = MULTI_LABEL_SUFFIXES.has(suffix2) ? 2 : 1
  if (suffixLength === 1 && !COMMON_TLDS.has(tld) && !/^[a-z]{2}$/.test(tld)) {
    return null
  }
  if (labels.length <= suffixLength) {
    return null
  }
  return labels.slice(-(suffixLength + 1)).join(".")
}

export function normalizeExternalUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    return { ok: false, reason: "invalid-url" }
  }
  const raw = input.trim()
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, reason: "url-too-long" }
  }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: "invalid-url" }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unsupported-scheme" }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials" }
  }

  const hostname = cleanHostname(parsed.hostname)
  if (isPrivateHost(hostname)) {
    return { ok: false, reason: "private-host" }
  }
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_PARAM.test(key)) {
      return { ok: false, reason: "sensitive-query" }
    }
  }

  const redirectLike = [...parsed.searchParams.keys()].some((key) => REDIRECT_PARAM.test(key))
  for (const key of new Set(parsed.searchParams.keys())) {
    if (TRACKING_PARAM.test(key)) {
      parsed.searchParams.delete(key)
    }
  }
  parsed.hash = ""
  parsed.hostname = hostname
  const url = parsed.toString()
  const query = stableQueryPairs(parsed.searchParams)
  const dedupeKey = parsed.origin + parsed.pathname + (query ? `?${query}` : "")

  return {
    ok: true,
    url,
    dedupeKey,
    hostname,
    registrableDomain: registrableDomain(hostname),
    redirectLike,
    noiseReason: noiseReasonForHost(hostname),
  }
}

function decodeHtmlAttribute(value) {
  return value.replaceAll(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = {
      "&amp;": "&",
      "&quot;": '"',
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
    }
    const lower = entity.toLowerCase()
    if (named[lower]) {
      return named[lower]
    }
    const hex = /^&#x([\da-f]+);$/i.exec(entity)
    const decimal = /^&#(\d+);$/.exec(entity)
    const codePoint = hex ? Number.parseInt(hex[1], 16) : Number(decimal?.[1])
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10_ff_ff) {
      return ""
    }
    try {
      return String.fromCodePoint(codePoint)
    } catch {
      return ""
    }
  })
}

function readTag(rawTag) {
  const match = /^<\s*(\/)?\s*([a-z][\w:-]*)/i.exec(rawTag)
  if (!match) {
    return null
  }
  const closing = Boolean(match[1])
  const name = match[2].toLowerCase()
  if (closing) {
    return { closing, name, attributes: {} }
  }

  const attributeText = rawTag.slice(match[0].length).replace(/\/?>\s*$/, "")
  const attributes = {}
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g
  for (const item of attributeText.matchAll(attributePattern)) {
    const key = item[1].toLowerCase()
    if (key !== "/") {
      attributes[key] = decodeHtmlAttribute(item[2] ?? item[3] ?? item[4] ?? "")
    }
  }
  return { closing, name, attributes, selfClosing: /\/\s*>$/.test(rawTag) }
}

function scanHtmlTags(html) {
  const tags = []
  let index = 0
  while (index < html.length) {
    const start = html.indexOf("<", index)
    if (start === -1) {
      break
    }
    if (html.startsWith("<!--", start)) {
      const endComment = html.indexOf("-->", start + 4)
      index = endComment === -1 ? html.length : endComment + 3
      continue
    }
    let quote = null
    let end = start + 1
    for (; end < html.length; end += 1) {
      const char = html[end]
      if (quote) {
        if (char === quote) {
          quote = null
        }
      } else if (char === '"' || char === "'") {
        quote = char
      } else if (char === ">") {
        break
      }
    }
    if (end >= html.length) {
      break
    }
    const tag = readTag(html.slice(start, end + 1))
    if (tag) {
      tags.push(tag)
    }
    index = end + 1
  }
  return tags
}

function contextForLink(stack, attributes, normalized) {
  const tokens = [
    ...stack.map(
      (item) => `${item.name} ${item.attributes.class || ""} ${item.attributes.id || ""}`,
    ),
    attributes.class || "",
    attributes.id || "",
  ]
    .join(" ")
    .toLowerCase()
  const rel = String(attributes.rel || "")
    .toLowerCase()
    .split(/\s+/)

  if (tokens.includes("social") || rel.some((item) => ["me", "social"].includes(item))) {
    return "SOCIAL"
  }
  if (normalized.noiseReason === "SOCIAL") {
    return "SOCIAL"
  }
  if (normalized.noiseReason === "TRACKER" || normalized.noiseReason === "CDN") {
    return "TRACKER"
  }
  if (normalized.noiseReason === "AFFILIATE") {
    return "AFFILIATE"
  }
  if (rel.includes("author") || /(?:author|byline)/.test(tokens)) {
    return "AUTHOR_LINK"
  }
  if (/(?:blogroll|related|recommended|friend-sites)/.test(tokens)) {
    return "BLOGROLL"
  }
  if (stack.some((item) => item.name === "footer")) {
    return "FOOTER"
  }
  if (/(?:affiliate|sponsor|partner-link)/.test(tokens)) {
    return "AFFILIATE"
  }
  if (/(?:article|main|entry-content|post-content|article-content)/.test(tokens)) {
    return "EDITORIAL_BODY"
  }
  return "UNKNOWN"
}

function inspectOutboundLinks(html) {
  if (typeof html !== "string" || !html) {
    return { links: [], invalidCount: 0, anchorCount: 0 }
  }
  const stack = []
  const links = []
  let invalidCount = 0
  let anchorCount = 0
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ])

  for (const tag of scanHtmlTags(html)) {
    if (tag.closing) {
      const matchIndex = stack.map((item) => item.name).lastIndexOf(tag.name)
      if (matchIndex !== -1) {
        stack.splice(matchIndex)
      }
      continue
    }

    const hidden = stack.some((item) =>
      ["script", "style", "template", "noscript"].includes(item.name),
    )
    const alternateFeed =
      tag.name === "link" &&
      String(tag.attributes.rel || "")
        .toLowerCase()
        .split(/\s+/)
        .includes("alternate") &&
      /(?:rss|atom|feed\+json)/i.test(tag.attributes.type || "")
    if ((tag.name === "a" || alternateFeed) && !hidden && typeof tag.attributes.href === "string") {
      anchorCount += 1
      const normalized = normalizeExternalUrl(tag.attributes.href)
      if (normalized.ok) {
        links.push({
          ...normalized,
          contextType: alternateFeed
            ? "ALTERNATE_FEED"
            : contextForLink(stack, tag.attributes, normalized),
          feedLike: alternateFeed,
        })
      } else {
        invalidCount += 1
      }
    }

    if (!voidTags.has(tag.name) && !tag.selfClosing) {
      stack.push({ name: tag.name, attributes: tag.attributes })
    }
  }
  return { links, invalidCount, anchorCount }
}

export function extractOutboundLinks(html) {
  return inspectOutboundLinks(html).links
}

function hostFromUrl(raw) {
  if (typeof raw !== "string" || !raw) {
    return null
  }
  try {
    return cleanHostname(new URL(raw).hostname)
  } catch {
    return null
  }
}

function sourceHosts(feed) {
  return new Set([hostFromUrl(feed.site_url), hostFromUrl(feed.feed_url)].filter(Boolean))
}

function isSelfLink(candidateHost, hosts) {
  return [...hosts].some(
    (sourceHost) =>
      sourceHost === candidateHost ||
      (sourceHost.startsWith("www.") && sourceHost.slice(4) === candidateHost) ||
      (candidateHost.startsWith("www.") && candidateHost.slice(4) === sourceHost),
  )
}

function looksLikeFeedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    return /(?:\.xml|\.rss|\.atom|\/feed(?:\/|$)|\/rss(?:\/|$)|\/atom(?:\/|$))/i.test(url.pathname)
  } catch {
    return false
  }
}

function feedSectionForUrl(rawUrl) {
  try {
    const segments = new URL(rawUrl).pathname.split("/").filter(Boolean)
    if (segments.length === 0) {
      return null
    }
    let section = segments.at(-1).replace(/\.(?:xml|rss|atom)$/i, "")
    if (/^(?:feed|rss|atom|index)$/i.test(section)) {
      section = segments.at(-2) || ""
    }
    return section && !/^(?:feed|rss|atom|index)$/i.test(section) ? section : null
  } catch {
    return null
  }
}

export function buildFollowedSourceGraph(feeds, articles, { contextTypes } = {}) {
  const feedMap = new Map(feeds.map((feed) => [String(feed.id), feed]))
  const candidates = new Map()
  let selfLinkCount = 0
  let excludedNoiseCount = 0
  let invalidLinkCount = 0
  let validHttpLinkCount = 0
  let probablePublisherLinkCount = 0
  let observedLinkCount = 0

  for (const article of articles) {
    const feed = feedMap.get(String(article.feed_id))
    if (!feed) {
      continue
    }
    const hosts = sourceHosts(feed)
    const seenInArticle = new Set()
    const extracted = inspectOutboundLinks(article.content)
    observedLinkCount += extracted.anchorCount
    invalidLinkCount += extracted.invalidCount
    for (const link of extracted.links) {
      if (contextTypes && !contextTypes.includes(link.contextType)) {
        continue
      }
      if (link.noiseReason) {
        excludedNoiseCount += 1
        continue
      }
      validHttpLinkCount += 1
      if (isSelfLink(link.hostname, hosts)) {
        selfLinkCount += 1
        continue
      }
      if (seenInArticle.has(link.dedupeKey)) {
        continue
      }
      seenInArticle.add(link.dedupeKey)

      let candidate = candidates.get(link.hostname)
      if (!candidate) {
        candidate = {
          domain: link.hostname,
          publisherKey: link.hostname,
          registrableDomain: link.registrableDomain,
          siteUrl: new URL(link.url).origin,
          candidateFeedUrls: new Set(),
          feedSections: new Set(),
          aliases: new Set(),
          confidence: "LOW",
          evidence: new Set(["observed-in-local-article-link"]),
          discoveryOrigins: new Set(),
          independentSources: new Set(),
          references: new Map(),
          contextTypes: new Set(),
          probablePublisherEvidenceCount: 0,
          lastObservedAt: null,
        }
        candidates.set(link.hostname, candidate)
      }

      const feedId = String(article.feed_id)
      const articleId = article.id
      const referenceKey = `${feedId}\u0000${String(articleId)}`
      candidate.independentSources.add(feedId)
      candidate.contextTypes.add(link.contextType)
      if (
        ["EDITORIAL_BODY", "AUTHOR_LINK", "BLOGROLL", "ALTERNATE_FEED"].includes(link.contextType)
      ) {
        candidate.probablePublisherEvidenceCount += 1
        probablePublisherLinkCount += 1
      }
      if (["BLOGROLL", "AUTHOR_LINK", "ALTERNATE_FEED"].includes(link.contextType)) {
        candidate.discoveryOrigins.add("G2_LOCAL_RELATED_LINK")
      } else if (["EDITORIAL_BODY", "UNKNOWN"].includes(link.contextType)) {
        candidate.discoveryOrigins.add("G1_LINK_GRAPH")
      }
      if (link.feedLike || looksLikeFeedUrl(link.url)) {
        candidate.candidateFeedUrls.add(link.url)
        const section = feedSectionForUrl(link.url)
        if (section) {
          candidate.feedSections.add(section)
        }
      }
      if (article.published_at) {
        const date = new Date(article.published_at)
        if (
          !Number.isNaN(date.valueOf()) &&
          (!candidate.lastObservedAt || date > candidate.lastObservedAt)
        ) {
          candidate.lastObservedAt = date
        }
      }
      candidate.references.set(referenceKey, {
        sourceFeedId: article.feed_id,
        articleLocalId: articleId,
        discoveryContextType: link.contextType,
        domain: link.hostname,
      })
    }
  }

  const outputCandidates = [...candidates.values()]
    .map((candidate) => ({
      domain: candidate.domain,
      publisherKey: candidate.publisherKey,
      registrableDomain: candidate.registrableDomain,
      siteUrl: candidate.siteUrl,
      candidateFeedUrls: [...candidate.candidateFeedUrls].toSorted(),
      feedSections: [...candidate.feedSections].toSorted(),
      aliases: [...candidate.aliases].toSorted(),
      confidence: candidate.confidence,
      evidence: [...candidate.evidence].toSorted(),
      discoveryOrigins: [...candidate.discoveryOrigins].toSorted(),
      independentSeedCount: candidate.independentSources.size,
      references: [...candidate.references.values()].toSorted(
        (a, b) =>
          String(a.sourceFeedId).localeCompare(String(b.sourceFeedId)) ||
          String(a.articleLocalId).localeCompare(String(b.articleLocalId)),
      ),
      contextTypes: [...candidate.contextTypes].toSorted(),
      probablePublisherEvidenceCount: candidate.probablePublisherEvidenceCount,
      lastObservedAt: candidate.lastObservedAt?.toISOString() || null,
    }))
    .toSorted((a, b) => a.domain.localeCompare(b.domain))

  return {
    candidates: outputCandidates,
    selfLinkCount,
    excludedNoiseCount,
    invalidLinkCount,
    validHttpLinkCount,
    probablePublisherLinkCount,
    observedLinkCount,
  }
}

function aliasesForFeed(feed) {
  return sourceHosts(feed)
}

function sourceDomainForFeed(feed) {
  return hostFromUrl(feed.site_url) || hostFromUrl(feed.feed_url)
}

function orderCandidatesForView(candidates, view) {
  if (view === "recency-of-evidence") {
    return [...candidates].toSorted(
      (a, b) =>
        String(b.lastObservedAt || "").localeCompare(String(a.lastObservedAt || "")) ||
        a.domain.localeCompare(b.domain),
    )
  }
  if (view === "round-robin-by-generator-origin") {
    const buckets = new Map()
    for (const candidate of candidates) {
      const origins =
        candidate.discoveryOrigins.length > 0 ? candidate.discoveryOrigins : ["OTHER_LINK_CONTEXT"]
      for (const origin of origins) {
        if (!buckets.has(origin)) {
          buckets.set(origin, [])
        }
        buckets.get(origin).push(candidate)
      }
    }
    for (const [origin, bucket] of buckets) {
      buckets.set(
        origin,
        bucket.toSorted((a, b) => a.domain.localeCompare(b.domain)),
      )
    }
    const originOrder = [
      "G1_LINK_GRAPH",
      "G2_LOCAL_RELATED_LINK",
      ...[...buckets.keys()]
        .filter((origin) => !["G1_LINK_GRAPH", "G2_LOCAL_RELATED_LINK"].includes(origin))
        .toSorted(),
    ]
    const ordered = []
    const seen = new Set()
    for (let index = 0; ; index += 1) {
      let added = false
      for (const origin of originOrder) {
        const candidate = buckets.get(origin)?.[index]
        if (candidate && !seen.has(candidate.domain)) {
          ordered.push(candidate)
          seen.add(candidate.domain)
          added = true
        }
      }
      if (!added) {
        break
      }
    }
    return ordered
  }
  return [...candidates].toSorted(
    (a, b) => b.independentSeedCount - a.independentSeedCount || a.domain.localeCompare(b.domain),
  )
}

const RANKING_VIEWS = [
  "independent-source-count",
  "recency-of-evidence",
  "round-robin-by-generator-origin",
]

export function evaluateLeaveOneSourceOut(feeds, articles, targetFeedId, { contextTypes } = {}) {
  const target = feeds.find((feed) => String(feed.id) === String(targetFeedId))
  if (!target) {
    throw new Error(`Unknown target feed ID: ${targetFeedId}`)
  }

  const targetAliases = aliasesForFeed(target)
  const heldOutFeedIds = new Set(
    feeds
      .filter((feed) => [...aliasesForFeed(feed)].some((host) => targetAliases.has(host)))
      .map((feed) => String(feed.id)),
  )
  const remainingFeeds = feeds.filter((feed) => !heldOutFeedIds.has(String(feed.id)))
  const remainingArticles = articles.filter(
    (article) => !heldOutFeedIds.has(String(article.feed_id)),
  )
  const graph = buildFollowedSourceGraph(remainingFeeds, remainingArticles, { contextTypes })
  const targetHosts = [...targetAliases]
  const match = graph.candidates.find((candidate) =>
    targetHosts.some((host) => isSelfLink(candidate.domain, new Set([host]))),
  )
  const leakageGate =
    remainingArticles.some((article) => heldOutFeedIds.has(String(article.feed_id))) ||
    graph.candidates.some((candidate) =>
      candidate.references.some((reference) => heldOutFeedIds.has(String(reference.sourceFeedId))),
    )
      ? "FAIL"
      : "PASS"

  const rankings = Object.fromEntries(
    RANKING_VIEWS.map((view) => {
      const ordered = orderCandidatesForView(graph.candidates, view)
      const rank = match
        ? ordered.findIndex((candidate) => candidate.domain === match.domain) + 1
        : null
      return [
        view,
        { rankIfAny: rank, candidateDomains: ordered.map((candidate) => candidate.domain) },
      ]
    }),
  )
  const defaultRank = rankings["independent-source-count"].rankIfAny

  return {
    targetDomain: sourceDomainForFeed(target),
    heldOutFeedIds: [...heldOutFeedIds].toSorted(),
    found: Boolean(match),
    rankIfAny: defaultRank,
    rankings,
    discoveryPath: match?.discoveryOrigins.join("+") || "NONE",
    independentSeeds: match?.independentSeedCount || 0,
    feedResolvable: "UNKNOWN",
    leakageGate,
    candidateDomains: rankings["independent-source-count"].candidateDomains,
  }
}

export function selectHeldOutSources(feeds, articles, { maxSources = 40, minArticles = 1 } = {}) {
  const feedMap = new Map(feeds.map((feed) => [String(feed.id), feed]))
  const groups = new Map()

  for (const feed of feeds) {
    const domain = sourceDomainForFeed(feed)
    if (!domain) {
      continue
    }
    let group = groups.get(domain)
    if (!group) {
      group = { targetDomain: domain, feedIds: new Set(), articleCount: 0 }
      groups.set(domain, group)
    }
    group.feedIds.add(String(feed.id))
  }

  for (const article of articles) {
    const feed = feedMap.get(String(article.feed_id))
    const domain = feed ? sourceDomainForFeed(feed) : null
    if (domain && groups.has(domain)) {
      groups.get(domain).articleCount += 1
    }
  }

  const limit = Math.max(0, Math.floor(maxSources))
  return [...groups.values()]
    .filter((group) => group.articleCount >= minArticles)
    .toSorted((a, b) => {
      const hashA = createHash("sha256").update(a.targetDomain).digest("hex")
      const hashB = createHash("sha256").update(b.targetDomain).digest("hex")
      return hashA.localeCompare(hashB)
    })
    .slice(0, limit)
    .map((group) => ({
      targetDomain: group.targetDomain,
      feedIds: [...group.feedIds].toSorted(),
      articleCount: group.articleCount,
      stratum: "UNCLASSIFIED",
      valueLabel: "UNKNOWN",
    }))
}

export function evaluateHeldOutSet(feeds, articles, heldOutSources, { contextTypes } = {}) {
  const results = heldOutSources.map((source) =>
    evaluateLeaveOneSourceOut(feeds, articles, source.feedIds[0], { contextTypes }),
  )
  const count = results.length
  const metricsByRanking = Object.fromEntries(
    RANKING_VIEWS.map((view) => {
      const ranks = results.map((result) => result.rankings[view].rankIfAny)
      const hitsAt5 = ranks.filter((rank) => rank && rank <= 5).length
      const hitsAt10 = ranks.filter((rank) => rank && rank <= 10).length
      const reciprocalRanks = ranks.map((rank) => (rank ? 1 / rank : 0))
      return [
        view,
        {
          exactSourceRecallAt5: ratio(hitsAt5, count),
          exactSourceRecallAt10: ratio(hitsAt10, count),
          meanReciprocalRank: ratio(
            reciprocalRanks.reduce((sum, value) => sum + value, 0),
            count,
          ),
        },
      ]
    }),
  )
  const coverage = results.filter((result) => result.found).length
  const defaultMetrics = metricsByRanking["independent-source-count"]

  return {
    results,
    exactSourceRecallAt5: defaultMetrics.exactSourceRecallAt5,
    exactSourceRecallAt10: defaultMetrics.exactSourceRecallAt10,
    meanReciprocalRank: defaultMetrics.meanReciprocalRank,
    metricsByRanking,
    generatorCoverage: ratio(coverage, count),
    leakageGate: results.every((result) => result.leakageGate === "PASS") ? "PASS" : "FAIL",
    rankingView: "metrics reported for each independent benchmark ordering",
    valueEvaluation: "HUMAN_VALUE_PENDING",
  }
}

export function buildNewSourceCandidates(feeds, graph) {
  const followedHosts = new Set()
  for (const feed of feeds) {
    for (const host of sourceHosts(feed)) {
      followedHosts.add(host)
    }
  }

  return graph.candidates
    .filter((candidate) => !isSelfLink(candidate.domain, followedHosts))
    .map((candidate) => {
      const identity = {
        domain: candidate.domain,
        publisherKey: candidate.publisherKey,
        siteUrl: candidate.siteUrl,
        candidateFeedUrls: candidate.candidateFeedUrls,
        feedSections: candidate.feedSections,
        aliases: candidate.aliases,
        confidence: candidate.confidence,
        evidence: candidate.evidence,
      }
      const contexts = candidate.contextTypes
      const origins = candidate.discoveryOrigins
      const originText = origins.join(", ")
      const contextText = contexts.join(", ")
      return {
        identity,
        discoveryOrigins: origins,
        independentSeedCount: candidate.independentSeedCount,
        sampleSize: candidate.references.length,
        observedLanguage: "UNKNOWN",
        observedCadence: "UNKNOWN",
        technicalViability: "PUBLIC_HTTP_LINK_SEEN; FEED_UNVERIFIED",
        topicEvidence: [],
        coverageEvidence: {
          followedFeedReferences: candidate.independentSeedCount,
          articleReferences: candidate.references.length,
          observedLinkContexts: contexts,
        },
        confidenceByFacet: {
          publisherIdentity: "LOW",
          feedResolution: "UNKNOWN",
          topicRelevance: "UNKNOWN",
          safety: "URL_SCREENED_NO_FETCH",
        },
        explanation: `Observed from ${candidate.independentSeedCount} followed feed(s) across ${
          candidate.references.length
        } article(s); origin(s): ${originText}; link context(s): ${
          contextText
        }. No public page or feed was fetched.`,
        valueLabel: "UNKNOWN",
        lastObservedAt: candidate.lastObservedAt,
      }
    })
}

export function buildHumanReviewSet(candidates, { limit = 50 } = {}) {
  const safeLimit = Math.min(50, Math.max(0, Math.floor(limit)))
  const buckets = new Map()
  for (const candidate of candidates) {
    for (const origin of candidate.discoveryOrigins.length > 0
      ? candidate.discoveryOrigins
      : ["G1_LINK_GRAPH"]) {
      if (!buckets.has(origin)) {
        buckets.set(origin, [])
      }
      buckets.get(origin).push(candidate)
    }
  }
  for (const [origin, bucket] of buckets) {
    buckets.set(
      origin,
      bucket.toSorted((a, b) => a.identity.domain.localeCompare(b.identity.domain)),
    )
  }

  const origins = [...buckets.keys()].toSorted()
  const selected = []
  const seen = new Set()
  let index = 0
  while (selected.length < safeLimit && seen.size < candidates.length) {
    let added = false
    for (const origin of origins) {
      const candidate = buckets.get(origin)[index]
      if (candidate && !seen.has(candidate.identity.domain)) {
        selected.push(candidate)
        seen.add(candidate.identity.domain)
        added = true
        if (selected.length >= safeLimit) {
          break
        }
      }
    }
    if (!added) {
      break
    }
    index += 1
  }

  return selected.map((candidate) => ({
    source: candidate.identity.domain,
    candidateFeedUrls: candidate.identity.candidateFeedUrls,
    whyDiscovered: candidate.explanation,
    discoveryOrigin: candidate.discoveryOrigins,
    referredByCount: candidate.independentSeedCount,
    language: candidate.observedLanguage,
    observedCadence: candidate.observedCadence,
    feedStatus: "NOT_CHECKED_NO_REMOTE_FETCH",
    recentTitles: [],
    knownAlready: "",
    wouldFollow: "",
    surprisinglyGood: "",
    notes: "No remote page/feed fetch was performed; recent-title sample is unavailable.",
  }))
}

export function runDiscoveryBenchmark(
  feeds,
  articles,
  {
    categories = [],
    now = new Date(),
    maxHeldOut = DISCOVERY_BENCHMARK_CONFIG.maxHeldOut,
    reviewLimit = DISCOVERY_BENCHMARK_CONFIG.reviewLimit,
  } = {},
) {
  const { g1Contexts } = DISCOVERY_BENCHMARK_CONFIG
  const { g2Contexts } = DISCOVERY_BENCHMARK_CONFIG
  const combinedContexts = [...g1Contexts, ...g2Contexts]
  const dataReceipt = summarizeCorpus(feeds, articles, { now, categories })
  const allLinksGraph = buildFollowedSourceGraph(feeds, articles)
  const g1Graph = buildFollowedSourceGraph(feeds, articles, { contextTypes: g1Contexts })
  const g2Graph = buildFollowedSourceGraph(feeds, articles, { contextTypes: g2Contexts })
  const combinedGraph = buildFollowedSourceGraph(feeds, articles, {
    contextTypes: combinedContexts,
  })
  const heldOutSources = selectHeldOutSources(feeds, articles, {
    maxSources: maxHeldOut,
  })
  const g1HeldOut = evaluateHeldOutSet(feeds, articles, heldOutSources, {
    contextTypes: g1Contexts,
  })
  const heldOut = evaluateHeldOutSet(feeds, articles, heldOutSources, {
    contextTypes: combinedContexts,
  })
  const g1Recovered = new Set(
    g1HeldOut.results.filter((result) => result.found).map((result) => result.targetDomain),
  )
  const combinedRecovered = new Set(
    heldOut.results.filter((result) => result.found).map((result) => result.targetDomain),
  )
  const incrementalG2Recoveries = [...combinedRecovered].filter(
    (domain) => !g1Recovered.has(domain),
  ).length
  const newCandidates = buildNewSourceCandidates(feeds, combinedGraph)
  const humanReview = buildHumanReviewSet(newCandidates, { limit: reviewLimit })

  const g1Domains = new Set(g1Graph.candidates.map((candidate) => candidate.domain))
  const g2Domains = new Set(g2Graph.candidates.map((candidate) => candidate.domain))
  const combinedDomains = new Set(combinedGraph.candidates.map((candidate) => candidate.domain))
  const generatorObservationCount = g1Domains.size + g2Domains.size
  const incrementalG2 = [...g2Domains].filter((domain) => !g1Domains.has(domain)).length
  const duplicateRate = generatorObservationCount
    ? (generatorObservationCount - combinedDomains.size) / generatorObservationCount
    : 0
  const generatorsWithResults = []
  if (g1Domains.size > 0) {
    generatorsWithResults.push("G1_FOLLOWED_SOURCE_LINK_GRAPH")
  }
  if (g2Domains.size > 0) {
    generatorsWithResults.push("G2_LOCAL_BLOGROLL_RELATED")
  }

  return {
    dataReceipt: {
      ...dataReceipt,
      minifluxCategoriesCount: categories.length || dataReceipt.categoriesCount,
      sourceIdentityMethod: "distinct source hostnames; publisher identity remains provisional",
      noPrivateContentExported: true,
    },
    g1: {
      candidateDomains: g1Domains.size,
      validLookingDomains: g1Graph.candidates.length,
      multiSourceReferenced: g1Graph.candidates.filter(
        (candidate) => candidate.independentSeedCount > 1,
      ).length,
      singleSourceReferenced: g1Graph.candidates.filter(
        (candidate) => candidate.independentSeedCount === 1,
      ).length,
      excludedNoise: g1Graph.excludedNoiseCount,
    },
    g2: {
      blogrollCandidates: g2Domains.size,
      remoteFetchRequiredForCandidateValidation: true,
      depth2CrawlPerformed: false,
    },
    heldOut: {
      targetCount: heldOutSources.length,
      strata: [...new Set(heldOutSources.map((source) => source.stratum))],
      valueLabels: [...new Set(heldOutSources.map((source) => source.valueLabel))],
      byGenerator: {
        G1: g1HeldOut,
        G1_PLUS_G2: heldOut,
      },
      incrementalG2Recoveries,
      ...heldOut,
    },
    newSources: {
      total: newCandidates.length,
      reviewSet: humanReview,
      humanPrecisionAtK: "PENDING_HUMAN_REVIEW",
      novelAcceptedSourceRate: "PENDING_HUMAN_REVIEW",
      unexpectedButGoodRate: "PENDING_HUMAN_REVIEW",
    },
    feedValidation: {
      minifluxDiscoverEndpointAvailable: "DOCUMENTED_NOT_PROBED",
      securityGate: "UNKNOWN_NOT_PROBED",
      controlledDiscoverExecuted: false,
      safeForControlledPublicUrls: "UNKNOWN",
    },
    externalGenerators: {
      adapterContractPrepared: true,
      fixturesAvailable: true,
      executionStatus: "NOT_EXECUTED",
      candidateCount: null,
      publicQuerySetApproved: false,
      g3GdeltExecuted: false,
      g4SearchExecuted: false,
      g5OpenFeedIndexExecuted: false,
      reasonNotExecuted: "No approved public query set was supplied.",
    },
    ensemble: {
      generatorsWithResults,
      g1CandidateDomains: g1Domains.size,
      g2CandidateDomains: g2Domains.size,
      combinedUniqueCandidates: combinedDomains.size,
      incrementalG2Candidates: incrementalG2,
      heldOutRecoveriesByGenerator: {
        G1: g1Recovered.size,
        G1_PLUS_G2: combinedRecovered.size,
      },
      incrementalHeldOutRecoveries: incrementalG2Recoveries,
      unverifiedFeedLikeCandidates: combinedGraph.candidates.filter(
        (candidate) => candidate.candidateFeedUrls.length > 0,
      ).length,
      duplicateRate,
      g5LocalExecuted: false,
      rankingViews: [
        "independent-source-count",
        "recency-of-evidence",
        "round-robin-by-generator-origin",
      ],
      bestForUser: "NOT_EVALUATED; HUMAN_VALUE_PENDING",
      allLinksGraphCandidates: allLinksGraph.candidates.length,
    },
    governance: {
      minifluxMutations: 0,
      productionChanged: false,
      homeChanged: false,
      allChanged: false,
      unreadChanged: false,
      readerChanged: false,
      navigationChanged: false,
      addFeedBehaviorChanged: false,
      newPersistentUserState: false,
    },
  }
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].toSorted((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(percentileValue * sorted.length) - 1)]
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0
}

function plainTextLength(content) {
  if (typeof content !== "string" || !content) {
    return 0
  }
  return decodeHtmlAttribute(
    content
      .replaceAll(/<!--[\s\S]*?-->/g, " ")
      .replaceAll(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replaceAll(/<[^>]*>/g, " "),
  )
    .replaceAll(/\s+/g, " ")
    .trim().length
}

function feedCategoryKey(feed) {
  return feed.category?.id ?? feed.category?.title ?? null
}

export function summarizeCorpus(feeds, articles, { now = new Date(), categories = [] } = {}) {
  const referenceTime = new Date(now).valueOf()
  const validArticles = Array.isArray(articles) ? articles : []
  const validFeeds = Array.isArray(feeds) ? feeds : []
  const feedById = new Map(validFeeds.map((feed) => [String(feed.id), feed]))
  const articleCounts = new Map(validFeeds.map((feed) => [String(feed.id), 0]))
  const sourceArticleCounts = new Map()
  const recent30ByFeed = new Map(validFeeds.map((feed) => [String(feed.id), 0]))
  const byFeedContentLengths = new Map(validFeeds.map((feed) => [String(feed.id), []]))

  let titleCount = 0
  let urlCount = 0
  let authorCount = 0
  let contentCount = 0
  let tagCount = 0
  let htmlUsableCount = 0
  let articles7d = 0
  let articles30d = 0
  let articles90d = 0
  let starredCount = 0
  let readCount = 0
  let knownStatusCount = 0
  let languageMetadataAvailable = false
  const languages = new Set()
  const externalLinksPerArticle = []
  let articlesWithOutboundHttpLinks = 0

  const dayMs = 24 * 60 * 60 * 1000
  const cutoff7 = referenceTime - 7 * dayMs
  const cutoff30 = referenceTime - 30 * dayMs
  const cutoff90 = referenceTime - 90 * dayMs

  for (const article of validArticles) {
    const feedId = String(article.feed_id)
    articleCounts.set(feedId, (articleCounts.get(feedId) || 0) + 1)
    const sourceKey = sourceDomainForFeed(feedById.get(feedId) || {}) || `unknown-feed:${feedId}`
    sourceArticleCounts.set(sourceKey, (sourceArticleCounts.get(sourceKey) || 0) + 1)
    const title = typeof article.title === "string" ? article.title.trim() : ""
    const articleUrl = typeof article.url === "string" ? article.url.trim() : ""
    const author = typeof article.author === "string" ? article.author.trim() : ""
    const content = typeof article.content === "string" ? article.content : ""
    const tags = Array.isArray(article.tags) ? article.tags : []
    if (title) {
      titleCount += 1
    }
    if (articleUrl) {
      urlCount += 1
    }
    if (author) {
      authorCount += 1
    }
    if (content.trim()) {
      contentCount += 1
    }
    if (tags.length > 0) {
      tagCount += 1
    }
    const textLength = plainTextLength(content)
    byFeedContentLengths.get(feedId)?.push(textLength)
    if (/<[a-z][^>]*>/i.test(content) && textLength >= 40) {
      htmlUsableCount += 1
    }

    const date = new Date(article.published_at || article.created_at)
    if (!Number.isNaN(date.valueOf())) {
      if (date.valueOf() >= cutoff7) {
        articles7d += 1
      }
      if (date.valueOf() >= cutoff30) {
        articles30d += 1
        recent30ByFeed.set(feedId, (recent30ByFeed.get(feedId) || 0) + 1)
      }
      if (date.valueOf() >= cutoff90) {
        articles90d += 1
      }
    }

    if (article.starred === true) {
      starredCount += 1
    }
    if (article.status === "read" || article.status === "unread") {
      knownStatusCount += 1
      if (article.status === "read") {
        readCount += 1
      }
    }

    const feed = feedById.get(feedId)
    const lang = article.language || article.lang || feed?.language || feed?.lang
    if (typeof lang === "string" && lang.trim()) {
      languageMetadataAvailable = true
      languages.add(lang.trim().toLowerCase())
    }

    const links = extractOutboundLinks(content)
    const hosts = feed ? sourceHosts(feed) : new Set()
    if (links.some((link) => !link.noiseReason && !isSelfLink(link.hostname, hosts))) {
      articlesWithOutboundHttpLinks += 1
    }
    const distinctExternal = new Set(
      links
        .filter((link) => !link.noiseReason && !isSelfLink(link.hostname, hosts))
        .map((link) => link.dedupeKey),
    )
    externalLinksPerArticle.push(distinctExternal.size)
  }

  const counts = [...articleCounts.values()]
  const graph = buildFollowedSourceGraph(validFeeds, validArticles)
  const feedHosts = new Set(validFeeds.map((feed) => sourceDomainForFeed(feed)).filter(Boolean))
  const categoryKeys = new Set(
    validFeeds
      .map((feed) => feedCategoryKey(feed))
      .filter((value) => value !== null && value !== undefined),
  )
  const excerptThreshold = 1200
  const richThreshold = 3000
  const feedsWithOnlyExcerptsCount = [...byFeedContentLengths.values()].filter(
    (lengths) => lengths.length > 0 && lengths.every((length) => length <= excerptThreshold),
  ).length
  const feedsWithRichContentCount = [...byFeedContentLengths.values()].filter((lengths) =>
    lengths.some((length) => length >= richThreshold),
  ).length
  const enabledFeeds = validFeeds.filter((feed) => !feed.disabled)
  const lowCadenceFeedsCount = enabledFeeds.filter(
    (feed) => (recent30ByFeed.get(String(feed.id)) || 0) <= 1,
  ).length
  const topShares = [...sourceArticleCounts.values()].toSorted((a, b) => b - a)
  const linkDenominator = graph.validHttpLinkCount + graph.selfLinkCount + graph.excludedNoiseCount

  return {
    feedsCount: validFeeds.length,
    uniquePublisherDomains: feedHosts.size,
    categoriesCount: categories.length > 0 ? categories.length : categoryKeys.size,
    articlesTotal: validArticles.length,
    articles7d,
    articles30d,
    articles90d,
    articlesPerFeedP50: percentile(counts, 0.5),
    articlesPerFeedP90: percentile(counts, 0.9),
    articlesPerFeedMax: counts.length > 0 ? Math.max(...counts) : 0,
    top1SourceShare: ratio(
      topShares.slice(0, 1).reduce((sum, count) => sum + count, 0),
      validArticles.length,
    ),
    top5SourceShare: ratio(
      topShares.slice(0, 5).reduce((sum, count) => sum + count, 0),
      validArticles.length,
    ),
    top10SourceShare: ratio(
      topShares.slice(0, 10).reduce((sum, count) => sum + count, 0),
      validArticles.length,
    ),
    titleCoverage: ratio(titleCount, validArticles.length),
    urlCoverage: ratio(urlCount, validArticles.length),
    authorCoverage: ratio(authorCount, validArticles.length),
    contentCoverage: ratio(contentCount, validArticles.length),
    tagCoverage: ratio(tagCount, validArticles.length),
    usableHtmlRate: ratio(htmlUsableCount, validArticles.length),
    articlesWithOutboundHttpLinksRate: ratio(articlesWithOutboundHttpLinks, validArticles.length),
    externalLinksPerArticleP50: percentile(externalLinksPerArticle, 0.5),
    externalLinksPerArticleP90: percentile(externalLinksPerArticle, 0.9),
    externalLinkCandidateDomains: graph.candidates.length,
    linksReferencedByMultipleFeeds: graph.candidates.filter(
      (candidate) => candidate.independentSeedCount > 1,
    ).length,
    linksReferencedByOneFeed: graph.candidates.filter(
      (candidate) => candidate.independentSeedCount === 1,
    ).length,
    selfLinkRate: ratio(graph.selfLinkCount, linkDenominator),
    noiseLinkRate: ratio(graph.excludedNoiseCount, linkDenominator),
    probablePublisherLinkRate: ratio(graph.probablePublisherLinkCount, graph.validHttpLinkCount),
    feedsWithOnlyExcerptsCount,
    feedsWithRichContentCount,
    starredRate: ratio(starredCount, validArticles.length),
    readRate: ratio(readCount, knownStatusCount),
    markAllReadProvenanceAvailable: false,
    individualReadProvenanceAvailable: false,
    languageMetadataAvailable,
    languageMetadataStatus: languageMetadataAvailable ? "AVAILABLE" : "UNKNOWN",
    detectedLanguageCount: languageMetadataAvailable ? languages.size : null,
    detectedLanguages: [...languages].toSorted(),
    lowCadenceFeedsCount,
    disabledFeedsCount: validFeeds.filter((feed) => feed.disabled === true).length,
    feedsWithErrorsCount: validFeeds.filter((feed) => Number(feed.parsing_error_count) > 0).length,
    excerptThresholdChars: excerptThreshold,
    richContentThresholdChars: richThreshold,
    lowCadenceDefinition: "at most 1 retained entry in the last 30 days among enabled feeds",
    linkGraph: {
      candidateDomains: graph.candidates.length,
      multiFeedDomains: graph.candidates.filter((candidate) => candidate.independentSeedCount > 1)
        .length,
      singleFeedDomains: graph.candidates.filter(
        (candidate) => candidate.independentSeedCount === 1,
      ).length,
      excludedNoiseLinks: graph.excludedNoiseCount,
      selfLinks: graph.selfLinkCount,
      invalidLinks: graph.invalidLinkCount,
    },
  }
}
