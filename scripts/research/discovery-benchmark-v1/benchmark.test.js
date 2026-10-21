import assert from "node:assert/strict"
import test from "node:test"

import {
  buildFollowedSourceGraph,
  buildHumanReviewSet,
  buildNewSourceCandidates,
  evaluateHeldOutSet,
  evaluateLeaveOneSourceOut,
  extractOutboundLinks,
  normalizeExternalUrl,
  registrableDomain,
  runDiscoveryBenchmark,
  selectHeldOutSources,
  summarizeCorpus,
} from "./benchmark.js"

test("normalizes public HTTP URLs while preserving semantic query parameters", () => {
  const result = normalizeExternalUrl(
    "HTTPS://www.Example.co.uk:443/a/../story?utm_source=newsletter&lang=pt-BR&tag=research#intro",
  )

  assert.equal(result.ok, true)
  assert.equal(result.url, "https://www.example.co.uk/story?lang=pt-BR&tag=research")
  assert.equal(result.hostname, "www.example.co.uk")
  assert.equal(result.registrableDomain, "example.co.uk")
})

test("rejects non-web, relative, credentialed, private, and local URLs without fetching", () => {
  const cases = [
    ["javascript:alert(1)", "unsupported-scheme"],
    ["data:text/html,hello", "unsupported-scheme"],
    ["file:///etc/passwd", "unsupported-scheme"],
    ["/relative/path", "invalid-url"],
    ["https://user:password@example.org/path", "credentials"],
    ["http://localhost/admin", "private-host"],
    ["http://127.0.0.1/admin", "private-host"],
    ["http://10.0.0.8/admin", "private-host"],
    ["http://172.20.0.8/admin", "private-host"],
    ["http://192.168.1.2/admin", "private-host"],
    ["http://169.254.10.20/latest/meta-data", "private-host"],
    ["http://[::1]/admin", "private-host"],
    ["http://[fe80::1]/admin", "private-host"],
    ["http://[fc00::1]/admin", "private-host"],
    ["https://example.org/path?access_token=secret", "sensitive-query"],
    [`https://${"a".repeat(8200)}.org/path`, "url-too-long"],
  ]

  for (const [input, reason] of cases) {
    const result = normalizeExternalUrl(input)
    assert.equal(result.ok, false, input)
    assert.equal(result.reason, reason, input)
  }
})

test("canonicalizes Unicode hosts, tracking aliases, and redirect-like URLs safely", () => {
  const unicode = normalizeExternalUrl("https://münich.de/article")
  assert.equal(unicode.ok, true)
  assert.equal(unicode.hostname, "xn--mnich-kva.de")

  const first = normalizeExternalUrl("https://publisher.com/story?id=42&utm_campaign=spring#top")
  const alias = normalizeExternalUrl("https://publisher.com/story?utm_source=feed&id=42")
  assert.equal(first.url, alias.url)

  const redirect = normalizeExternalUrl(
    "https://publisher.com/out?url=https%3A%2F%2Fother.example%2Fstory",
  )
  assert.equal(redirect.ok, true)
  assert.equal(redirect.redirectLike, true)
  assert.equal(redirect.hostname, "publisher.com")
  assert.equal(redirect.url.includes("other.example"), true)
})

test("reports registrable-domain uncertainty without collapsing editorial subdomains", () => {
  assert.equal(registrableDomain("news.example.co.uk"), "example.co.uk")
  assert.equal(registrableDomain("tech.example.com"), "example.com")
  assert.equal(registrableDomain("localhost"), null)

  const graph = buildFollowedSourceGraph(
    [{ id: 1, site_url: "https://example.com", feed_url: "https://example.com/rss" }],
    [
      {
        id: 10,
        feed_id: 1,
        content: '<article><a href="https://tech.example.com/story">Story</a></article>',
      },
    ],
  )

  assert.deepEqual(
    graph.candidates.map((candidate) => candidate.domain),
    ["tech.example.com"],
  )
  assert.equal(graph.candidates[0].publisherKey, "tech.example.com")
})

test("extracts conservative link contexts and leaves unclassified links unknown", () => {
  const html = `
    <article class="entry-content">
      <p><a href="https://publisher.com/story">Story</a></p>
      <div class="byline"><a rel="author" href="https://author.org/">Author</a></div>
      <div class="blogroll"><a href="https://recommended.net/">Recommended</a></div>
      <link rel="alternate" type="application/atom+xml" href="https://feedpublisher.net/section" />
      <footer><a href="https://footer.info/">Footer</a></footer>
      <nav class="social"><a href="https://social.io/profile">Social</a></nav>
    </article>
    <a href="https://unknown.dev/path">Unknown</a>
    <script><a href="https://script.org/">ignore</a></script>
  `

  const links = extractOutboundLinks(html)
  const byHost = new Map(links.map((link) => [link.hostname, link.contextType]))

  assert.equal(byHost.get("publisher.com"), "EDITORIAL_BODY")
  assert.equal(byHost.get("author.org"), "AUTHOR_LINK")
  assert.equal(byHost.get("recommended.net"), "BLOGROLL")
  assert.equal(byHost.get("feedpublisher.net"), "ALTERNATE_FEED")
  assert.equal(byHost.get("footer.info"), "FOOTER")
  assert.equal(byHost.get("social.io"), "SOCIAL")
  assert.equal(byHost.get("unknown.dev"), "UNKNOWN")
  assert.equal(byHost.has("script.org"), false)
})

test("keeps alternate feed discovery local and treats it as G2 evidence", () => {
  const graph = buildFollowedSourceGraph(
    [{ id: 1, site_url: "https://seed.example.org", feed_url: "https://seed.example.org/rss" }],
    [
      {
        id: 10,
        feed_id: 1,
        content:
          '<link rel="alternate" type="application/rss+xml" href="https://candidate.example.net/feeds/tech">',
      },
    ],
    { contextTypes: ["ALTERNATE_FEED"] },
  )

  assert.equal(graph.candidates[0].discoveryOrigins.includes("G2_LOCAL_RELATED_LINK"), true)
  assert.deepEqual(graph.candidates[0].candidateFeedUrls, [
    "https://candidate.example.net/feeds/tech",
  ])
})

test("builds provenance-only G1 graph, filters exact self-links and known noise", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
    { id: 2, site_url: "https://gamma.example.org", feed_url: "https://gamma.example.org/feed" },
  ]
  const articles = [
    {
      id: 101,
      feed_id: 1,
      title: "must not be returned",
      content: `
        <article><a href="https://alpha.example.com/local">self</a>
        <a href="https://beta.example.net/story?id=7&utm_source=x">Candidate</a>
        <a href="https://beta.example.net/story?id=7&utm_medium=y">Alias</a></article>
        <footer><a href="https://www.instagram.com/news">Social</a><a href="javascript:alert(1)">Bad</a><a href="/relative">Relative</a></footer>
      `,
    },
    {
      id: 202,
      feed_id: 2,
      content: '<article><a href="https://beta.example.net/another">Candidate</a></article>',
    },
  ]

  const graph = buildFollowedSourceGraph(feeds, articles)
  const candidate = graph.candidates.find((item) => item.domain === "beta.example.net")

  assert.ok(candidate)
  assert.equal(candidate.independentSeedCount, 2)
  assert.equal(candidate.references.length, 2)
  assert.deepEqual(candidate.references[0], {
    sourceFeedId: 1,
    articleLocalId: 101,
    discoveryContextType: "EDITORIAL_BODY",
    domain: "beta.example.net",
  })
  assert.equal(graph.selfLinkCount, 1)
  assert.ok(graph.excludedNoiseCount >= 1)
  assert.equal(graph.invalidLinkCount, 2)
  assert.equal(JSON.stringify(graph).includes("must not be returned"), false)
  assert.equal(JSON.stringify(graph).includes("Candidate"), false)
})

test("leave-one-source-out removes the target feed and its outgoing links before candidate generation", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
    { id: 2, site_url: "https://beta.example.net", feed_url: "https://beta.example.net/feed" },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      content: '<article><a href="https://beta.example.net/about">Target link</a></article>',
    },
    {
      id: 22,
      feed_id: 2,
      content: '<article><a href="https://leak.example.org/">Leak only from target</a></article>',
    },
  ]

  const result = evaluateLeaveOneSourceOut(feeds, articles, 2)

  assert.equal(result.targetDomain, "beta.example.net")
  assert.equal(result.found, true)
  assert.equal(result.leakageGate, "PASS")
  assert.equal(result.independentSeeds, 1)
  assert.equal(result.candidateDomains.includes("leak.example.org"), false)
})

test("held-out identity removes canonical article URLs, declared subdomain feeds, and their origin edges", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
    {
      id: 2,
      site_url: "https://publisher.example.org",
      feed_url: "https://feeds.publisher.example.org/rss.xml",
    },
    {
      id: 3,
      site_url: "https://publisher.example.org",
      feed_url: "https://news.publisher.example.org/feed.xml",
    },
    { id: 4, site_url: "https://gamma.example.net", feed_url: "https://gamma.example.net/rss" },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      content:
        '<article><a href="https://publisher.example.org/canonical/story">Canonical mention</a></article>',
    },
    {
      id: 22,
      feed_id: 2,
      url: "https://publisher.example.org/canonical/story",
      content: [
        "<article>",
        '<a href="https://target-only-leak.example.com/story">Target-only edge</a>',
        '<a href="https://redirect.example.net/out?url=https%3A%2F%2Fredirect-only-leak.example.org">Redirect</a>',
        "</article>",
      ].join(""),
    },
    {
      id: 33,
      feed_id: 3,
      content:
        '<article><a href="https://subdomain-only-leak.example.net/story">Alias edge</a></article>',
    },
    {
      id: 44,
      feed_id: 4,
      content:
        '<article><a href="https://gamma-candidate.example.com/story">Independent edge</a></article>',
    },
  ]

  const result = evaluateLeaveOneSourceOut(feeds, articles, 2)

  assert.deepEqual(result.heldOutFeedIds, ["2", "3"])
  assert.equal(result.leakageGate, "PASS")
  assert.equal(result.candidateDomains.includes("target-only-leak.example.com"), false)
  assert.equal(result.candidateDomains.includes("redirect-only-leak.example.org"), false)
  assert.equal(result.candidateDomains.includes("subdomain-only-leak.example.net"), false)
  assert.ok(
    Object.values(result.rankings).every(
      ({ candidateDomains }) =>
        !candidateDomains.some((domain) =>
          /(?:target-only|redirect-only|subdomain-only)-leak/.test(domain),
        ),
    ),
  )
})

test("corpus summary is deterministic and contains no raw titles, bodies, or private feed URLs", () => {
  const feeds = [
    {
      id: 1,
      title: "private feed title",
      site_url: "https://alpha.example.com/private",
      feed_url: "https://user:secret@alpha.example.com/rss",
      category: { id: 5, title: "private category" },
      disabled: false,
      parsing_error_count: 0,
    },
    {
      id: 2,
      title: "second feed title",
      site_url: "https://beta.example.net",
      feed_url: "https://beta.example.net/feed",
      category: { id: 5, title: "private category" },
      disabled: true,
      parsing_error_count: 1,
    },
  ]
  const articles = [
    {
      id: 1,
      feed_id: 1,
      title: "secret title",
      url: "https://alpha.example.com/story",
      author: "private author",
      content: '<p>Short article</p><a href="https://external.org/story">external</a>',
      published_at: "2026-10-20T12:00:00Z",
      status: "unread",
      starred: true,
      tags: ["private-tag"],
    },
    {
      id: 2,
      feed_id: 1,
      title: "",
      url: "",
      author: "",
      content: "",
      published_at: "2026-09-01T12:00:00Z",
      status: "read",
      starred: false,
      tags: [],
    },
  ]

  const options = { now: new Date("2026-10-21T12:00:00Z") }
  const first = summarizeCorpus(feeds, articles, options)
  const second = summarizeCorpus(feeds, articles, options)

  assert.deepEqual(first, second)
  assert.equal(first.feedsCount, 2)
  assert.equal(first.categoriesCount, 1)
  assert.equal(first.articlesTotal, 2)
  assert.equal(first.articles7d, 1)
  assert.equal(first.articles30d, 1)
  assert.equal(first.disabledFeedsCount, 1)
  assert.equal(first.feedsWithErrorsCount, 1)
  assert.equal(first.markAllReadProvenanceAvailable, false)
  assert.equal(first.individualReadProvenanceAvailable, false)

  const serialized = JSON.stringify(first)
  for (const secret of [
    "private feed title",
    "private category",
    "secret title",
    "private author",
    "private-tag",
    "user:secret",
    "alpha.example.com",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test("source concentration shares aggregate feeds that share an exact source host", () => {
  const feeds = [
    {
      id: 1,
      site_url: "https://alpha.example.com",
      feed_url: "https://alpha.example.com/main.xml",
    },
    {
      id: 2,
      site_url: "https://alpha.example.com",
      feed_url: "https://alpha.example.com/tech.xml",
    },
    { id: 3, site_url: "https://beta.example.net", feed_url: "https://beta.example.net/rss" },
  ]
  const articles = [
    { id: 11, feed_id: 1 },
    { id: 12, feed_id: 1 },
    { id: 21, feed_id: 2 },
    { id: 31, feed_id: 3 },
  ]

  const summary = summarizeCorpus(feeds, articles, { now: new Date("2026-10-21T12:00:00Z") })

  assert.equal(summary.uniquePublisherDomains, 2)
  assert.equal(summary.top1SourceShare, 0.75)
})

test("held-out selection and evaluation are deterministic and do not label source value", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
    { id: 2, site_url: "https://beta.example.net", feed_url: "https://beta.example.net/feed" },
    { id: 3, site_url: "https://gamma.example.org", feed_url: "https://gamma.example.org/rss" },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      content:
        '<article><a href="https://beta.example.net/about">Target</a><a href="https://newsource.org/feed.xml">New source</a></article>',
      published_at: "2026-10-19T12:00:00Z",
    },
    {
      id: 22,
      feed_id: 2,
      content: '<article><a href="https://leak-only.org/">Leak</a></article>',
      published_at: "2026-10-20T12:00:00Z",
    },
    {
      id: 33,
      feed_id: 3,
      content: '<article><a href="https://newsource.org/another">New source</a></article>',
      published_at: "2026-10-21T12:00:00Z",
    },
  ]

  const selected = selectHeldOutSources(feeds, articles, { maxSources: 40 })
  assert.deepEqual(selected, selectHeldOutSources(feeds, articles, { maxSources: 40 }))
  assert.equal(selected.length, 3)
  assert.ok(selected.every((source) => source.valueLabel === "UNKNOWN"))
  assert.ok(selected.every((source) => source.stratum === "UNCLASSIFIED"))

  const evaluation = evaluateHeldOutSet(feeds, articles, selected)
  assert.equal(evaluation.leakageGate, "PASS")
  assert.equal(evaluation.results.length, 3)
  assert.equal(
    evaluation.results.find((item) => item.targetDomain === "beta.example.net").found,
    true,
  )
  assert.equal(
    evaluation.results.find((item) => item.targetDomain === "beta.example.net").leakageGate,
    "PASS",
  )
  assert.equal(evaluation.exactSourceRecallAt5 >= 0, true)
})

test("new-source review excludes followed domains and makes no human-value claims", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      title: "private story",
      content:
        '<article><a href="https://alpha.example.com/about">self</a><a href="https://newsource.org/feed.xml">New</a></article>',
    },
  ]
  const graph = buildFollowedSourceGraph(feeds, articles)
  const candidates = buildNewSourceCandidates(feeds, graph)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].identity.domain, "newsource.org")
  assert.equal(candidates[0].valueLabel, "UNKNOWN")
  assert.equal(candidates[0].confidenceByFacet.topicRelevance, "UNKNOWN")
  assert.equal(JSON.stringify(candidates).includes("private story"), false)
  assert.equal("score" in candidates[0], false)

  const review = buildHumanReviewSet(candidates)
  assert.equal(review.length, 1)
  assert.deepEqual(review[0].recentTitles, [])
  assert.equal(review[0].feedStatus, "NOT_CHECKED_NO_REMOTE_FETCH")
  assert.equal(review[0].knownAlready, "")
  assert.equal(review[0].wouldFollow, "")
  assert.equal(review[0].surprisinglyGood, "")
})

test("orchestrates G1 and local G2 separately without exporting raw article content", () => {
  const feeds = [
    {
      id: 1,
      site_url: "https://alpha.example.com",
      feed_url: "https://alpha.example.com/rss",
      category: { id: 3, title: "private category" },
    },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      title: "private article title",
      url: "https://alpha.example.com/story",
      author: "private author",
      content:
        '<article class="entry-content"><a href="https://editorialsource.org/story">Editorial</a><div class="blogroll"><a href="https://blogrollsource.net/">Blogroll</a></div></article>',
      published_at: "2026-10-20T12:00:00Z",
      status: "unread",
      starred: false,
      tags: [],
    },
  ]

  const result = runDiscoveryBenchmark(feeds, articles, {
    categories: [{ id: 3, title: "private category" }],
    now: new Date("2026-10-21T12:00:00Z"),
  })

  assert.equal(result.g1.candidateDomains, 1)
  assert.equal(result.g2.blogrollCandidates, 1)
  assert.equal(result.ensemble.combinedUniqueCandidates, 2)
  assert.equal(result.ensemble.incrementalG2Candidates, 1)
  assert.equal(result.governance.minifluxMutations, 0)
  assert.equal(result.feedValidation.securityGate, "UNKNOWN_NOT_PROBED")
  assert.equal(result.newSources.humanPrecisionAtK, "PENDING_HUMAN_REVIEW")

  const serialized = JSON.stringify(result)
  for (const secret of [
    "private article title",
    "private author",
    "private category",
    "https://alpha.example.com/rss",
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test("reports incremental held-out recoveries from G2 separately from G1", () => {
  const feeds = [
    { id: 1, site_url: "https://alpha.example.com", feed_url: "https://alpha.example.com/rss" },
    { id: 2, site_url: "https://target.example.net", feed_url: "https://target.example.net/feed" },
    { id: 3, site_url: "https://gamma.example.org", feed_url: "https://gamma.example.org/rss" },
  ]
  const articles = [
    {
      id: 11,
      feed_id: 1,
      content: '<article><a href="https://other.example.com/story">Other</a></article>',
    },
    { id: 22, feed_id: 2, content: "<article>Target has no outbound link.</article>" },
    {
      id: 33,
      feed_id: 3,
      content: '<div class="blogroll"><a href="https://target.example.net/">Target</a></div>',
    },
  ]

  const result = runDiscoveryBenchmark(feeds, articles, { maxHeldOut: 40 })
  const g1Target = result.heldOut.byGenerator.G1.results.find(
    (item) => item.targetDomain === "target.example.net",
  )
  const combinedTarget = result.heldOut.byGenerator.G1_PLUS_G2.results.find(
    (item) => item.targetDomain === "target.example.net",
  )

  assert.equal(g1Target.found, false)
  assert.equal(combinedTarget.found, true)
  assert.equal(result.heldOut.incrementalG2Recoveries, 1)
  assert.equal(result.ensemble.incrementalHeldOutRecoveries, 1)
})
