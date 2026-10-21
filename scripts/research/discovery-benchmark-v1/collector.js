import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import { isIP } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import tls from "node:tls"
import { fileURLToPath, pathToFileURL } from "node:url"

import {
  DISCOVERY_BENCHMARK_CONFIG,
  DISCOVERY_BENCHMARK_VERSION,
  isPrivateHost,
  runDiscoveryBenchmark,
} from "./benchmark.js"
import { classifyExternalGeneratorOutcome, EXTERNAL_GENERATOR_IDS } from "./external-generators.js"

const API_TIMEOUT_MS = 15_000
const PAGE_SIZE = 100
const MAX_PAGE_SIZE = 100
const ARTICLE_WINDOW_DAYS = DISCOVERY_BENCHMARK_CONFIG.articleWindowDays
const MAX_API_RESPONSE_BYTES = 64 * 1024 * 1024
const MINIFLUX_API_HEADER = "X-Auth-Token"
const NEWSFLUX_BASE_SHA = "b6b7246642aa5ff15f3f8e7015d2efbd83a47be5"
const HARNESS_CONTENT_FILES = [
  "README.md",
  "benchmark.js",
  "benchmark.test.js",
  "collector.js",
  "collector.test.js",
  "external-generators.js",
  "external-generators.test.js",
]

function sourceOrigin(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return ""
  }
  try {
    const url = new URL(raw)
    if (!["http:", "https:"].includes(url.protocol)) {
      return ""
    }
    return url.origin
  } catch {
    return ""
  }
}

function projectFeed(feed) {
  return {
    id: feed.id,
    site_url: sourceOrigin(feed.site_url),
    feed_url: sourceOrigin(feed.feed_url),
    category: feed.category?.id == null ? null : { id: feed.category.id },
    disabled: feed.disabled === true,
    parsing_error_count: Number(feed.parsing_error_count) || 0,
  }
}

function projectCategory(category) {
  if (
    String(category.title || "")
      .trim()
      .toLowerCase() === "all"
  ) {
    return null
  }
  return { id: category.id }
}

function projectArticle(article) {
  return {
    id: article.id,
    feed_id: article.feed_id,
    title: typeof article.title === "string" && article.title.trim() ? "present" : "",
    url: typeof article.url === "string" && article.url.trim() ? "present" : "",
    author: typeof article.author === "string" && article.author.trim() ? "present" : "",
    content: typeof article.content === "string" ? article.content : "",
    published_at: article.published_at || null,
    created_at: article.created_at || null,
    status: ["read", "unread"].includes(article.status) ? article.status : null,
    starred: article.starred === true,
    tags: Array.isArray(article.tags) && article.tags.length > 0 ? ["present"] : [],
    language: typeof article.language === "string" ? article.language : undefined,
    lang: typeof article.lang === "string" ? article.lang : undefined,
  }
}

export function isPrivateMinifluxBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return false
  }
  try {
    const url = new URL(baseUrl)
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      isPrivateHost(url.hostname)
    )
  } catch {
    return false
  }
}

async function assertPrivateDnsTarget(baseUrl, resolveHost) {
  const url = new URL(baseUrl)
  const hostname = url.hostname.replaceAll(/^\[|\]$/g, "")
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) }]
  }
  let addresses
  try {
    addresses = await resolveHost(hostname)
  } catch {
    throw new Error("Miniflux host did not resolve to a private address; no request was sent.")
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some((address) => !isPrivateHost(address.address))
  ) {
    throw new Error(
      "Miniflux host did not resolve exclusively to private addresses; no request was sent.",
    )
  }
  return addresses
}

function endpointUrl(baseUrl, endpoint) {
  const base = new URL(baseUrl)
  const normalizedBase = base.href.endsWith("/") ? base.href : `${base.href}/`
  return new URL(endpoint.replace(/^\//, ""), normalizedBase).href
}

function entryPagePath({ pageSize, publishedAfter, afterEntryId = null }) {
  const query = new URLSearchParams()
  query.append("status", "read")
  query.append("status", "unread")
  query.set("limit", String(pageSize))
  query.set("order", "id")
  query.set("direction", "asc")
  query.set("published_after", String(publishedAfter))
  if (afterEntryId !== null) {
    query.set("after_entry_id", String(afterEntryId))
  }
  return `/v1/entries?${query.toString()}`
}

export function isAllowedReadOnlyMinifluxRequest({ baseUrl, requestUrl, method }) {
  try {
    const base = new URL(baseUrl)
    const request = new URL(requestUrl)
    if (
      method !== "GET" ||
      request.origin !== base.origin ||
      request.hash ||
      request.username ||
      request.password
    ) {
      return false
    }
    if (["/v1/version", "/v1/feeds", "/v1/categories"].includes(request.pathname)) {
      return request.search === ""
    }
    if (request.pathname !== "/v1/entries") {
      return false
    }

    const allowedKeys = new Set([
      "status",
      "limit",
      "order",
      "direction",
      "published_after",
      "after_entry_id",
    ])
    if ([...request.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
      return false
    }
    const exactlyOne = (key) => request.searchParams.getAll(key).length === 1
    if (!["limit", "order", "direction", "published_after"].every((key) => exactlyOne(key))) {
      return false
    }
    if (request.searchParams.getAll("after_entry_id").length > 1) {
      return false
    }
    if (
      JSON.stringify(request.searchParams.getAll("status")) !== JSON.stringify(["read", "unread"])
    ) {
      return false
    }
    const limit = Number(request.searchParams.get("limit"))
    const publishedAfter = Number(request.searchParams.get("published_after"))
    const afterEntryId = request.searchParams.get("after_entry_id")
    return (
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= MAX_PAGE_SIZE &&
      request.searchParams.get("order") === "id" &&
      request.searchParams.get("direction") === "asc" &&
      Number.isSafeInteger(publishedAfter) &&
      publishedAfter > 0 &&
      (afterEntryId === null ||
        (Number.isSafeInteger(Number(afterEntryId)) && Number(afterEntryId) >= 0))
    )
  } catch {
    return false
  }
}

function createPinnedFetch(addresses) {
  const address = addresses[0]
  return (requestUrl, options = {}) =>
    new Promise((resolve, reject) => {
      const url = new URL(requestUrl)
      const tlsHostname = url.hostname.replaceAll(/^\[|\]$/g, "")
      const transport = url.protocol === "https:" ? https : http
      let responseBytes = 0
      const chunks = []
      let settled = false
      const fail = () => {
        if (settled) {
          return
        }
        settled = true
        reject(new Error("Pinned local Miniflux GET failed; response data was not logged."))
      }
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: address.address,
          port: url.port || undefined,
          path: url.pathname + url.search,
          method: options.method,
          headers: { ...options.headers, Host: url.host },
          servername: url.protocol === "https:" && !isIP(tlsHostname) ? tlsHostname : undefined,
          checkServerIdentity: (_hostname, certificate) =>
            tls.checkServerIdentity(tlsHostname, certificate),
          rejectUnauthorized: true,
        },
        (response) => {
          response.on("data", (chunk) => {
            responseBytes += chunk.length
            if (responseBytes > MAX_API_RESPONSE_BYTES) {
              response.destroy()
              request.destroy()
              fail()
              return
            }
            chunks.push(chunk)
          })
          response.on("end", () => {
            if (settled) {
              return
            }
            settled = true
            const body = Buffer.concat(chunks).toString("utf8")
            resolve({
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode || 0,
              json: async () => JSON.parse(body),
            })
          })
          response.on("error", fail)
        },
      )
      request.setTimeout(API_TIMEOUT_MS, () => request.destroy())
      const { signal } = options
      if (signal?.aborted) {
        request.destroy()
        fail()
        return
      }
      const onAbort = () => request.destroy()
      signal?.addEventListener("abort", onAbort, { once: true })
      request.on("close", () => signal?.removeEventListener("abort", onAbort))
      request.on("error", fail)
      request.end()
    })
}

async function harnessContentHash() {
  const root = path.dirname(fileURLToPath(import.meta.url))
  const digest = createHash("sha256")
  for (const fileName of [...HARNESS_CONTENT_FILES].toSorted()) {
    digest
      .update(fileName)
      .update("\0")
      .update(await readFile(path.join(root, fileName)))
      .update("\0")
  }
  return digest.digest("hex")
}

export async function collectMinifluxSnapshot({
  baseUrl,
  apiToken,
  fetchImpl = null,
  resolveHost = async (hostname) => lookup(hostname, { all: true, verbatim: true }),
  pageSize = PAGE_SIZE,
  now = new Date(),
} = {}) {
  if (!isPrivateMinifluxBaseUrl(baseUrl)) {
    throw new Error(
      "Set NEWSFLUX_MINIFLUX_URL to a local/private Miniflux URL without credentials or query parameters.",
    )
  }
  if (typeof apiToken !== "string" || !apiToken.trim()) {
    throw new Error("Set NEWSFLUX_MINIFLUX_API_KEY in the local execution environment.")
  }
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
  const base = new URL(baseUrl)
  const collectionStartedAt = new Date(now).toISOString()
  const articleWindowStart = new Date(
    Date.parse(collectionStartedAt) - ARTICLE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )
  const publishedAfter = Math.floor(articleWindowStart.valueOf() / 1000)
  if (!Number.isSafeInteger(publishedAfter) || publishedAfter <= 0) {
    throw new Error("Collection start time was invalid; no Miniflux request was sent.")
  }
  const pinnedAddresses = await assertPrivateDnsTarget(baseUrl, resolveHost)
  const requestTransport = fetchImpl || createPinnedFetch(pinnedAddresses)

  const getJson = async (endpoint) => {
    const requestUrl = endpointUrl(base.href, endpoint)
    const requestOptions = {
      method: "GET",
      headers: {
        Accept: "application/json",
        [MINIFLUX_API_HEADER]: apiToken,
      },
      signal: undefined,
    }
    if (
      !isAllowedReadOnlyMinifluxRequest({
        baseUrl: base.href,
        requestUrl,
        method: requestOptions.method,
      })
    ) {
      throw new Error(
        "Miniflux request rejected by the local GET-only allowlist; no request was sent.",
      )
    }
    let response
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
    timeout.unref?.()
    requestOptions.signal = controller.signal
    try {
      response = await requestTransport(requestUrl, requestOptions)
    } catch {
      throw new Error("A local Miniflux GET failed or redirected; response data was not logged.")
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      throw new Error(`Miniflux GET ${endpoint.split("?", 1)[0]} returned HTTP ${response.status}.`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error("Miniflux returned a non-JSON response; response data was not logged.")
    }
  }

  const versionRaw = await getJson("/v1/version")
  const feedsRaw = await getJson("/v1/feeds")
  const categoriesRaw = await getJson("/v1/categories")
  if (!Array.isArray(feedsRaw) || !Array.isArray(categoriesRaw)) {
    throw new TypeError("Miniflux returned an unexpected feeds or categories response shape.")
  }

  const feeds = feedsRaw.map((feed) => projectFeed(feed))
  const categories = categoriesRaw.map((category) => projectCategory(category)).filter(Boolean)
  feedsRaw.length = 0
  categoriesRaw.length = 0

  const firstPage = await getJson(entryPagePath({ pageSize: safePageSize, publishedAfter }))
  if (!Array.isArray(firstPage.entries) || !Number.isFinite(Number(firstPage.total))) {
    throw new TypeError("Miniflux returned an unexpected entries response shape.")
  }
  const totalAtStart = Number(firstPage.total)
  const articlesById = new Map()
  const addPage = (page, afterEntryId = null) => {
    let lastId = afterEntryId
    for (const rawArticle of page.entries) {
      const entryId = Number(rawArticle?.id)
      if (!Number.isSafeInteger(entryId) || entryId < 0 || (lastId !== null && entryId <= lastId)) {
        throw new Error(
          "Miniflux entry cursor did not advance strictly; snapshot collection stopped.",
        )
      }
      const projected = projectArticle(rawArticle)
      articlesById.set(String(projected.id), projected)
      lastId = entryId
    }
    page.entries.length = 0
    return lastId
  }
  let cursor = addPage(firstPage)

  while (articlesById.size < totalAtStart && cursor !== null) {
    const page = await getJson(
      entryPagePath({
        pageSize: safePageSize,
        publishedAfter,
        afterEntryId: cursor,
      }),
    )
    if (!Array.isArray(page.entries) || page.entries.length === 0) {
      break
    }
    const nextCursor = addPage(page, cursor)
    if (nextCursor <= cursor) {
      throw new Error(
        "Miniflux entry cursor did not advance strictly; snapshot collection stopped.",
      )
    }
    cursor = nextCursor
  }

  const collectionFinishedAt = new Date().toISOString()
  const version = {
    version: String(versionRaw.version || "UNKNOWN"),
    commit: String(versionRaw.commit || "UNKNOWN"),
    buildDate: String(versionRaw.build_date || "UNKNOWN"),
  }
  const metadata = {
    snapshotId: randomUUID(),
    benchmarkVersion: DISCOVERY_BENCHMARK_VERSION,
    newsFluxBaseSha: NEWSFLUX_BASE_SHA,
    harnessContentHash: await harnessContentHash(),
    minifluxVersion: version.version,
    collectionStartedAt,
    collectionFinishedAt,
    articleWindow: {
      type: "published_after",
      days: ARTICLE_WINDOW_DAYS,
      publishedAfterUnix: publishedAfter,
    },
    entryCount: articlesById.size,
    feedCount: feeds.length,
    categoryCount: categories.length,
    generatorConfigHash: createHash("sha256")
      .update(JSON.stringify(DISCOVERY_BENCHMARK_CONFIG))
      .digest("hex"),
  }

  return {
    metadata,
    snapshotStartedAt: collectionStartedAt,
    snapshotFinishedAt: collectionFinishedAt,
    snapshotConsistency:
      "NON_ATOMIC_API_PAGINATION; filtered to the 90-day published_at window; ordered by ascending entry ID with after_entry_id cursors",
    version,
    feeds,
    categories,
    articles: [...articlesById.values()],
    entriesTotalAtStart: totalAtStart,
  }
}

export function buildSanitizedHandoff(snapshot, benchmark) {
  return {
    baseline: NEWSFLUX_BASE_SHA,
    snapshot: {
      ...snapshot.metadata,
      snapshotConsistency: snapshot.snapshotConsistency,
      entriesTotalAtStart: snapshot.entriesTotalAtStart,
    },
    snapshotStartedAt: snapshot.snapshotStartedAt,
    snapshotFinishedAt: snapshot.snapshotFinishedAt,
    snapshotConsistency: snapshot.snapshotConsistency,
    minifluxVersion: snapshot.version.version,
    rssBridgeVersion: "UNKNOWN; Homarr integration not found and Docker inventory unavailable",
    data: {
      ...benchmark.dataReceipt,
      articlesTotal: snapshot.entriesTotalAtStart,
    },
    signalSafety: {
      readSafeAsPreference: "NO",
      starSafeAsStrongPreference: "NO",
      explicitInterestsAvailable: "UNKNOWN",
      newPersistenceAdded: "NO",
    },
    ...benchmark,
    rssBridge: {
      available: "UNKNOWN",
      roleConfirmed: "UNKNOWN",
      previewPossible: "UNKNOWN",
      discoveryCapability: "NOT_CHECKED",
      remoteFetchPerformed: false,
    },
    externalGenerators: {
      ...benchmark.externalGenerators,
      publicQuerySetApproved: false,
      whyNotExecuted: "No approved public query set was supplied.",
      results: Object.fromEntries(
        EXTERNAL_GENERATOR_IDS.map((generator) => [
          generator,
          classifyExternalGeneratorOutcome({ executed: false }),
        ]),
      ),
    },
    next: {
      recommendedHumanReview:
        snapshot.articles.length > 0 ? "OPEN_LOCAL_HUMAN_REVIEW_CSV" : "NO_CANDIDATES",
      readyForProductImplementation: false,
      merges: [],
      deploys: [],
    },
  }
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "")
  return `"${text.replaceAll('"', '""')}"`
}

export function formatHumanReviewCsv(rows) {
  const columns = [
    ["SOURCE", "source"],
    ["CANDIDATE_FEED_URLS", "candidateFeedUrls"],
    ["WHY_DISCOVERED", "whyDiscovered"],
    ["DISCOVERY_ORIGIN", "discoveryOrigin"],
    ["REFERRED_BY_COUNT", "referredByCount"],
    ["LANGUAGE", "language"],
    ["OBSERVED_CADENCE", "observedCadence"],
    ["FEED_STATUS", "feedStatus"],
    ["RECENT_TITLES", "recentTitles"],
    ["KNOWN_ALREADY", "knownAlready"],
    ["WOULD_FOLLOW", "wouldFollow"],
    ["SURPRISINGLY_GOOD", "surprisinglyGood"],
    ["NOTES", "notes"],
  ]
  return `${[
    columns.map(([header]) => csvCell(header)).join(","),
    ...rows.map((row) => columns.map(([, key]) => csvCell(row[key])).join(",")),
  ].join("\n")}\n`
}

export async function writeSanitizedReports(handoff, outputPath = null) {
  const directory = outputPath
    ? path.resolve(outputPath)
    : await mkdtemp(path.join(tmpdir(), "newsflux-discovery-benchmark-v1-"))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const summaryPath = path.join(directory, "summary.json")
  const reviewPath = path.join(directory, "human-review.csv")
  await writeFile(summaryPath, JSON.stringify(handoff, null, 2), { mode: 0o600 })
  await writeFile(reviewPath, formatHumanReviewCsv(handoff.newSources?.reviewSet || []), {
    mode: 0o600,
  })
  return { directory, summaryPath, reviewPath }
}

async function main() {
  const snapshot = await collectMinifluxSnapshot({
    baseUrl: process.env.NEWSFLUX_MINIFLUX_URL,
    apiToken: process.env.NEWSFLUX_MINIFLUX_API_KEY,
  })
  const benchmark = runDiscoveryBenchmark(snapshot.feeds, snapshot.articles, {
    categories: snapshot.categories,
    now: new Date(snapshot.snapshotStartedAt),
  })
  const handoff = buildSanitizedHandoff(snapshot, benchmark)
  const paths = await writeSanitizedReports(handoff)
  process.stdout.write(`Saved aggregate summary and human review file under ${paths.directory}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
