import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { runDiscoveryBenchmark } from "./benchmark.js"
import {
  buildSanitizedHandoff,
  collectMinifluxSnapshot,
  isAllowedReadOnlyMinifluxRequest,
  isPrivateMinifluxBaseUrl,
  writeSanitizedReports,
} from "./collector.js"
import { classifyExternalGeneratorOutcome } from "./external-generators.js"

test("accepts only a private/local Miniflux base URL", () => {
  assert.equal(isPrivateMinifluxBaseUrl("https://miniflux.home"), true)
  assert.equal(isPrivateMinifluxBaseUrl("http://10.0.0.4:8080"), true)
  assert.equal(isPrivateMinifluxBaseUrl("https://feeds.example.org"), false)
  assert.equal(isPrivateMinifluxBaseUrl("https://user:secret@miniflux.home"), false)
  assert.equal(isPrivateMinifluxBaseUrl("https://miniflux.home/?token=x"), false)
})

test("allows only the exact local Miniflux GET endpoints before transport", () => {
  const baseUrl = "https://miniflux.home"
  const allowed = [
    "/v1/version",
    "/v1/feeds",
    "/v1/categories",
    "/v1/entries?status=read&status=unread&limit=100&order=id&direction=asc&published_after=1792152000",
    "/v1/entries?status=read&status=unread&limit=100&order=id&direction=asc&published_after=1792152000&after_entry_id=101",
  ]
  for (const path of allowed) {
    assert.equal(
      isAllowedReadOnlyMinifluxRequest({
        baseUrl,
        requestUrl: new URL(path, baseUrl).href,
        method: "GET",
      }),
      true,
      path,
    )
  }

  const denied = [
    { requestUrl: "https://miniflux.home/v1/discover", method: "POST" },
    { requestUrl: "https://miniflux.home/v1/entries", method: "PUT" },
    { requestUrl: "https://miniflux.home/v1/entries?offset=100", method: "GET" },
    {
      requestUrl:
        "https://miniflux.home/v1/entries?status=read&status=unread&limit=100&limit=1&order=id&direction=asc&published_after=1792152000",
      method: "GET",
    },
    {
      requestUrl:
        "https://miniflux.home/v1/entries?status=read&status=unread&limit=100&order=id&direction=asc&published_after=1792152000&after_entry_id=100&after_entry_id=200",
      method: "GET",
    },
    { requestUrl: "https://public.example/v1/feeds", method: "GET" },
    { requestUrl: "https://miniflux.home/v1/feeds/7/refresh", method: "GET" },
  ]
  for (const request of denied) {
    assert.equal(
      isAllowedReadOnlyMinifluxRequest({ baseUrl, ...request }),
      false,
      request.requestUrl,
    )
  }
})

test("keeps generator failure, empty success, and not-executed outcomes distinct", () => {
  const failed = classifyExternalGeneratorOutcome({
    executed: true,
    error: new Error("private detail"),
  })
  const empty = classifyExternalGeneratorOutcome({ executed: true, candidates: [] })
  const notExecuted = classifyExternalGeneratorOutcome({ executed: false })

  assert.deepEqual(failed, { status: "FAILED", candidateCount: null })
  assert.deepEqual(empty, { status: "EMPTY", candidateCount: 0 })
  assert.deepEqual(notExecuted, { status: "NOT_EXECUTED", candidateCount: null })
  assert.equal(JSON.stringify(failed).includes("private detail"), false)
})

test("uses read-only local API pages, strips private feed metadata, and produces sanitized output", async () => {
  const requests = []
  const payloads = {
    "/v1/version": {
      version: "2.3.4",
      commit: "local",
      build_date: "2026-10-19T00:00:00Z",
    },
    "/v1/feeds": [
      {
        id: 7,
        title: "private feed title",
        site_url: "https://alpha.example.com/private",
        feed_url: "https://feeduser:feedsecret@alpha.example.com/private/rss",
        username: "feeduser",
        password: "feedsecret",
        category: { id: 3, title: "private category" },
        disabled: false,
        parsing_error_count: 0,
      },
    ],
    "/v1/categories": [{ id: 3, title: "private category" }],
  }
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url)
    requests.push({ url: parsed, init })
    if (parsed.pathname === "/v1/entries") {
      const afterEntryId = parsed.searchParams.get("after_entry_id")
      if (afterEntryId === null) {
        return jsonResponse({
          total: 2,
          entries: [
            {
              id: 101,
              feed_id: 7,
              title: "private article title",
              url: "https://alpha.example.com/private/article",
              author: "private author",
              content:
                '<article><a href="https://candidate.org/feed.xml">Public lead</a><p>private article body do-not-print-this-token</p></article>',
              published_at: "2026-10-20T12:00:00Z",
              status: "unread",
              starred: true,
              tags: ["private tag"],
              feed: {
                title: "private feed title",
                feed_url: "https://feeduser:feedsecret@alpha.example.com/private/rss",
              },
            },
          ],
        })
      }
      return jsonResponse({
        total: 2,
        entries: [
          {
            id: 102,
            feed_id: 7,
            title: "",
            url: "",
            author: "",
            content: "",
            published_at: "2026-09-01T12:00:00Z",
            status: "read",
            starred: false,
            tags: [],
          },
        ],
      })
    }
    const payload = payloads[parsed.pathname]
    if (!payload) {
      return jsonResponse({}, 404)
    }
    return jsonResponse(payload)
  }

  const snapshot = await collectMinifluxSnapshot({
    baseUrl: "https://miniflux.home",
    apiToken: "do-not-print-this-token",
    fetchImpl,
    resolveHost: async () => [{ address: "127.0.0.1" }],
    pageSize: 1,
  })

  assert.equal(snapshot.version.version, "2.3.4")
  assert.equal(snapshot.categories.length, 1)
  assert.equal(snapshot.articles.length, 2)
  assert.equal(snapshot.articles[0].title, "present")
  assert.equal(snapshot.articles[0].url, "present")
  assert.equal(snapshot.articles[0].author, "present")
  assert.equal(snapshot.articles[0].tags.length, 1)
  assert.equal(snapshot.feeds[0].site_url, "https://alpha.example.com")
  assert.equal(snapshot.feeds[0].feed_url, "https://alpha.example.com")
  assert.ok(requests.every(({ init }) => init.method === "GET"))
  assert.ok(requests.every(({ url }) => url.origin === "https://miniflux.home"))
  const entryRequests = requests.filter(({ url }) => url.pathname === "/v1/entries")
  assert.deepEqual(
    entryRequests.map(({ url }) => url.searchParams.get("after_entry_id")),
    [null, "101"],
  )
  assert.ok(entryRequests.every(({ url }) => !url.searchParams.has("offset")))
  assert.equal(
    requests.some(({ url }) => url.pathname.includes("/discover")),
    false,
  )
  assert.ok(
    requests.every(({ init }) => init.headers["X-Auth-Token"] === "do-not-print-this-token"),
  )

  assert.match(snapshot.metadata.snapshotId, /^[0-9a-f-]{36}$/)
  assert.equal(snapshot.metadata.newsFluxBaseSha, "b6b7246642aa5ff15f3f8e7015d2efbd83a47be5")
  assert.match(snapshot.metadata.harnessContentHash, /^[0-9a-f]{64}$/)
  assert.ok(
    Date.parse(snapshot.metadata.collectionStartedAt) <=
      Date.parse(snapshot.metadata.collectionFinishedAt),
  )
  assert.equal(snapshot.metadata.entryCount, 2)
  assert.equal(snapshot.metadata.feedCount, 1)
  assert.equal(snapshot.metadata.categoryCount, 1)
  assert.equal(snapshot.metadata.articleWindow.days, 90)
  assert.match(snapshot.metadata.generatorConfigHash, /^[0-9a-f]{64}$/)

  const benchmark = runDiscoveryBenchmark(snapshot.feeds, snapshot.articles, {
    categories: snapshot.categories,
    now: new Date("2026-10-21T12:00:00Z"),
  })
  const handoff = buildSanitizedHandoff(snapshot, benchmark)
  const serialized = JSON.stringify(handoff)
  for (const secret of [
    "do-not-print-this-token",
    "feedsecret",
    "feeduser",
    "private feed title",
    "private category",
    "private article title",
    "private article body",
    "private author",
    "private tag",
    "https://alpha.example.com/private/rss",
    "https://alpha.example.com/private/article",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
  assert.equal(handoff.governance.minifluxMutations, 0)
  assert.equal(handoff.data.articlesTotal, 2)
  assert.equal(handoff.data.languageMetadataStatus, "UNKNOWN")
  assert.equal(handoff.data.detectedLanguageCount, null)
  assert.deepEqual(handoff.externalGenerators.results.G3_GDELT, {
    status: "NOT_EXECUTED",
    candidateCount: null,
  })

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "newsflux-discovery-redaction-"))
  try {
    const paths = await writeSanitizedReports(handoff, path.join(tempRoot, "reports"))
    const jsonArtifact = await readFile(paths.summaryPath, "utf8")
    const csvArtifact = await readFile(paths.reviewPath, "utf8")
    for (const secret of [
      "do-not-print-this-token",
      "private article body",
      "private article title",
    ]) {
      assert.equal(jsonArtifact.includes(secret), false)
      assert.equal(csvArtifact.includes(secret), false)
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test("default collector transport pins a local resolution and sends only guarded GETs", async () => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ method: request.method, host: request.headers.host, path: request.url })
    response.setHeader("Content-Type", "application/json")
    switch (request.url) {
      case "/v1/version": {
        response.end(JSON.stringify({ version: "2.3.3" }))
        break
      }
      case "/v1/feeds": {
        response.end("[]")
        break
      }
      case "/v1/categories": {
        response.end("[]")
        break
      }
      default: {
        if (request.url.startsWith("/v1/entries?")) {
          response.end(JSON.stringify({ entries: [], total: 0 }))
        } else {
          response.statusCode = 404
          response.end("{}")
        }
      }
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  const baseUrl = `http://miniflux.home:${address.port}`
  try {
    const snapshot = await collectMinifluxSnapshot({
      baseUrl,
      apiToken: "synthetic-local-transport-token",
      resolveHost: async (hostname) => {
        assert.equal(hostname, "miniflux.home")
        return [{ address: "127.0.0.1", family: 4 }]
      },
    })
    assert.equal(snapshot.version.version, "2.3.3")
    assert.deepEqual(
      requests.map(({ method }) => method),
      ["GET", "GET", "GET", "GET"],
    )
    assert.ok(requests.every(({ host }) => host === `miniflux.home:${address.port}`))
    assert.deepEqual(
      requests.map(({ path }) => path.split("?", 1)[0]),
      ["/v1/version", "/v1/feeds", "/v1/categories", "/v1/entries"],
    )
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test("redacts transport failures from error message and stack when the API key is environment-only", async () => {
  const secret = "synthetic-canary-secret-not-for-output"
  let observedError
  try {
    await collectMinifluxSnapshot({
      baseUrl: "https://miniflux.home",
      apiToken: secret,
      fetchImpl: async () => {
        throw new Error(`transport detail contains ${secret}`)
      },
      resolveHost: async () => [{ address: "127.0.0.1", family: 4 }],
    })
  } catch (error) {
    observedError = error
  }

  assert.ok(observedError instanceof Error)
  assert.equal(observedError.message.includes(secret), false)
  assert.equal(observedError.stack.includes(secret), false)
  assert.equal(process.argv.includes(secret), false)

  const childSource = `
    import { collectMinifluxSnapshot } from ${JSON.stringify(fileURLToPath(new URL("collector.js", import.meta.url)))};
    const secret = process.env.NEWSFLUX_TEST_CANARY;
    try {
      await collectMinifluxSnapshot({
        baseUrl: 'https://miniflux.home',
        apiToken: secret,
        fetchImpl: async () => { throw new Error('transport detail ' + secret); },
        resolveHost: async () => [{ address: '127.0.0.1', family: 4 }],
      });
    } catch (error) {
      process.stdout.write(JSON.stringify({ argvContainsSecret: process.argv.includes(secret), message: error.message }));
      process.stderr.write(error.stack || '');
    }
  `
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", childSource], {
    encoding: "utf8",
    env: { ...process.env, NEWSFLUX_TEST_CANARY: secret },
  })
  assert.equal(child.status, 0)
  assert.equal(child.stdout.includes(secret), false)
  assert.equal(child.stderr.includes(secret), false)
  assert.equal(JSON.parse(child.stdout).argvContainsSecret, false)
})

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}
