# NewsFlux discovery benchmark v1

This is an offline research harness based on `b6b7246642aa5ff15f3f8e7015d2efbd83a47be5`.
It does not add product behavior. The collector makes read-only requests to a local
Miniflux instance and performs link analysis in the same local Node process.

## Local run

Run this only on a host that already resolves and can reach the private Miniflux
instance. Keep the API key in that host's environment; do not paste it into the
terminal command, a file, or this conversation.

```sh
export NEWSFLUX_MINIFLUX_URL='http://miniflux.home'
export NEWSFLUX_MINIFLUX_API_KEY='(read from your local secret manager)'
node scripts/research/discovery-benchmark-v1/collector.js
```

The collector resolves the configured host and requires every resolved address
to be private, uses `GET` only, rejects redirects, and reads `/v1/version`,
`/v1/feeds`, `/v1/categories`, and paginated `/v1/entries`. It never calls
`/v1/discover`, validates candidates remotely, fetches RSS-Bridge, or contacts an
external generator. It does not mutate Miniflux.

Raw article content is held only in process memory while links and aggregates
are calculated. The default output is a newly created local temporary directory
with private permissions, containing `summary.json` and `human-review.csv`.
Those files contain derived source domains and candidate links, which can reveal
personal interests. Keep them on the local host and do not attach or publish
them. They contain no article bodies, titles, author names, followed-feed URLs,
credentials, or auth headers. The review CSV leaves human-value fields blank;
recent titles and candidate feed status remain unavailable because remote
candidate fetching is disabled.

## Measurement boundaries

- Source identity uses exact hostnames. The registrable-domain helper recognizes
  a conservative subset of common suffixes and is informational only; it never
  merges subdomains into a publisher identity. Unknown suffixes return
  `null`. Review identity confidence stays low until a human confirms it.
- G1 uses editorial-body and unknown-context links. G2 uses local blogroll,
  author, and declared alternate-feed links. Neither arm crawls the web.
- G1 and G1+G2 are evaluated separately on deterministic leave-one-source-out
  sets. The held-out subscription, article links, and matching feed aliases are
  removed before candidate generation. Source value stays `UNKNOWN` until human
  review.
- Candidate orderings are separate benchmark views: independent-source count,
  recency, and round-robin by origin. They are not product rankings.
- No external query set has been approved. The G3/G4/G5 helpers prepare a
  reviewed public query envelope and normalize fixture results, but they do not
  call an external service.
- Feed-like URLs are unverified candidates, not valid feeds. Miniflux discover
  and RSS-Bridge security/capability gates remain unknown, so no candidate
  fetches are made.
- `LOW_CADENCE` means at most one retained entry in the last 30 days for an
  enabled feed. “Excerpt only” uses at most 1,200 plain-text characters for
  every retained entry; “rich content” uses at least 3,000 characters for any
  retained entry. These are explicit corpus heuristics, not quality judgments.
- Miniflux pagination is ordered by entry ID but is not an atomic snapshot.
  Concurrent feed updates can change totals while the collector runs.

## Tests

Run the self-contained Node tests without installing project dependencies:

```sh
node --test scripts/research/discovery-benchmark-v1/*.test.js
```

The fixtures cover URL normalization and malicious targets, HTML link context,
provenance, source identity uncertainty, G1/G2 separation, held-out leakage,
determinism, privacy projection, and external-generator contracts. They do not
replace a real local-corpus run or human source review.
