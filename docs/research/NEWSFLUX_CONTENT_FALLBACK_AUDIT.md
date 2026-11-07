# NewsFlux content fallback P0: implementation audit

Date: 2026-11-07

## Repository state checked before implementation

GitHub API and local checkouts were used because the MCP REA exploration tool was not available in this session.

| Repository | Current `main` | Reference checked | Open PRs checked |
|---|---|---|---|
| NewsFlux | `4c691bc549d48daf6fea7e090f1b41e9113841a7` | branch head before work | 7, all STORY-01B research drafts (#134–#140) |
| Audicle | `951821b06e15c542c0b7784037c08af84f9fa60f` | `951821b06e15c542c0b7784037c08af84f9fa60f`, identical to current `main` | 14, dependency updates; no content-fallback PR |
| Miniflux | `ba40f99f66ccd8362628d7140abb0ab8a82e9f5f` | installed release tag `v2.3.5`, source commit `faecfa2fac61a91f4f69550bb1afd506c4b51749` | 19; checked entry-content, feed refresh, and API-related PR titles |

No open NewsFlux PR overlapped this P0 service scope. Miniflux's open PRs do not change the 2.3.5 source facts below; implementation targets the installed tag.

## Audicle study

The inspected files were `backend/app/services/extraction.py`, `source_fallbacks.py`, `source_fallbacks_store.py`, `wallhop.py`, `direct_fetch.py`, `ssrf.py`, `proxy_template.py`, and the extraction/fallback/WallHop tests.

At the reference commit, Audicle runs a direct in-process or Firecrawl extraction, parses HTML to article text, and validates the result against a baseline word floor plus a higher per-host floor. JSON-LD `articleBody` can expose a body that is longer than the visible teaser. Gate markers trim signup furniture before validation; title-only, block, challenge, and insufficient-prose results do not count as successful extraction. A fallback rule matches exact host or subdomains and selects a specific provider/strategy. Candidate results pass through the same body/teaser checks; a WallHop HTTP 200 is not itself success.

The fallback cascade is ordered and feature-gated. It supports host-specific attempts and selected automatic escalations including FlareSolverr for hard blocks, a reader proxy, WallHop, and archives. WallHop wraps the original URL in `/raw/{url}` and sends returned HTML through the normal parser. Retry and timeout controls are centralized. `ssrf.py` resolves every address, rejects non-public IPs, pins connections, and revalidates each redirect; proxy templates reject missing or malformed placeholders. The tests use deterministic response fixtures and verify provider selection, pass/fail validation, disabled routes, redirects, and challenge handling.

P0 adopts these concepts—explicit host policy, JSON-LD signal, teaser/block checks, a shared validator, bounded attempts, and pinned outbound requests—without copying Audicle's extraction pipeline or its FlareSolverr, archive, audio, TTS, or AI components.

## Miniflux 2.3.5 findings

- `GET /v1/entries/{id}` returns the entry including ID, feed ID, title, URL, published timestamp, status, starred flag, and content.
- `GET /v1/entries/{id}/fetch-content` invokes Miniflux's per-feed scraper. It persists the scraped result only when the optional `update_content=true` query parameter is supplied; the default is response-only.
- The fetch-content handler runs `ProcessEntryWebPage`, which applies feed URL rewrite rules to the in-memory entry before scraping. P0 therefore reads `GET /v1/feeds/{feed_id}` before and after native extraction and refuses the result whenever `urlrewrite_rules` is non-empty or changes during the request. The fetcher checks resolved IP addresses at dial time and rejects private networks by default; `FETCHER_ALLOW_PRIVATE_NETWORKS` defaults to disabled in v2.3.5.
- `PUT /v1/entries/{id}` accepts only `title` and `content`. Miniflux sanitizes non-empty content and updates title/content plus reading-time/search-vector fields. The handler does not write read status or starred status.
- A feed refresh configured to update an existing entry writes title, URL, comments URL, content, author, reading time, tags, and language, while keeping the row selected by user/feed/hash. Thus a manual content write can later be replaced, and the URL may also change through feed processing.
- URL Rewrite Rules run in `RewriteEntryURL` during feed processing and return the rewritten URL used for the entry. They cannot safely provide a temporary WallHop presentation while preserving the original stored URL.

These behaviors rule out storing P0 recovery into Miniflux. The service uses its API for reads only and has no Miniflux write method.

## Architecture comparison

| Criterion | A. Miniflux configuration | B. Independent sidecar | C. NewsFlux integration |
|---|---|---|---|
| Simplicity | Lowest operational cost, but feed scraper rules cannot select WallHop by source policy. | Adds one small service and API token; provider and validation behavior stays in one place. | Adds app API, UI, provider, and network-security paths. |
| Security | Uses Miniflux's fetcher controls, but URL rewrite rules can change the request URL. | Explicit source policies, public-address checks, bounded redirects, sanitization, and read-only Miniflux calls. | Must reproduce the sidecar's SSRF and provider controls inside the app boundary. |
| Maintenance and upstream compatibility | Few components, but behavior follows Miniflux feed configuration and may change with upgrades. | Miniflux and NewsFlux can upgrade independently through public APIs; SQLite schema belongs to the sidecar. | Couples fallback work to NewsFlux backend and ArticleDetail changes. |
| Persistence | `update_content=true` mutates Miniflux; later feed refreshes can overwrite that content. | Sanitized overlay persists in bounded SQLite; Miniflux remains the source of truth. | Can persist in the app, but creates another content store inside the main product. |
| Mobile latency | One Miniflux scrape request when explicitly requested. | One app-to-sidecar call plus Miniflux/WallHop work; cache avoids repeated provider calls. | Can remove the sidecar hop, while still waiting for the provider. |
| Duplicate requests | No cross-client deduplication for separate API calls. | Per-entry in-flight dedup, 15-minute memory cache, and persistent result cache. | Can deduplicate in the app, but shares capacity with product requests. |
| Isolation | Fetching remains in the Miniflux runtime. | Provider logic and credentials are isolated in a private service. | Fetching shares the app runtime and deployment lifecycle. |
| Reliability after updates | Most exposed to Miniflux feed-rule and refresh behavior. | Depends on stable public Miniflux API fields; no Miniflux code or schema changes. | Depends on NewsFlux internal API and UI structure. |

Option A's native scraper is still used by B for explicitly configured public feeds, with `update_content=false` and URL-rewrite checks. The standalone A path is not sufficient for the full policy behavior. B is selected; C is deferred.

## P0 implementation and gates

The sidecar defaults to disabled policies and supports Miniflux native `ON_DEMAND` feed rules and WallHop `ON_DEMAND` publisher rules. The example file names NYT, Bloomberg, WSJ, and Folha as WallHop candidates, while Economist is disabled. The service preserves the original Miniflux response on disabled, partial, blocked, unavailable, unsafe, busy, or stale outcomes. Successful responses are a sanitized text overlay tagged with entry ID and URL fingerprint. Validated overlays persist in a bounded SQLite store by entry ID and an original-entry fingerprint; changed source identity/content invalidates the record.

Deterministic tests cover content classification, JSON-LD, WallHop full/partial/block/timeout/unavailable/unsafe-redirect cases, domain policy, Miniflux identity/read/star state, refresh races, read-only API calls, cache deduplication, global and per-host concurrency, API auth, persistent-store reuse/invalidation/retention, and the closed 13ft gate.

### Real-article WallHop check

One public article URL from each candidate publisher was requested once through the documented `https://wallhop.io/raw/{url}` path, without credentials or Miniflux access:

| Publisher | Public article checked | Workspace result | Full-text verdict |
|---|---|---|---|
| NYT | [Briefing: Stephen Miller and Trump](https://www.nytimes.com/2026/11/06/briefing/stephen-miller-trump.html) | HTTP 403, `That address isn't allowed.` | Not evaluated |
| Bloomberg | [Wall Street Sees Risks to AI Boom After the Democratic Sweep](https://www.bloomberg.com/news/articles/2026-11-04/wall-street-sees-risks-to-ai-boom-after-the-democratic-sweep) | HTTP 403, `That address isn't allowed.` | Not evaluated |
| WSJ | [U.S. Stocks Mixed After Jobs Data, Muted AI Rebound](https://www.wsj.com/finance/stocks/u-s-stocks-mixed-after-jobs-data-muted-ai-rebound-945344f6) | HTTP 403, `That address isn't allowed.` | Not evaluated |
| Folha | [Governo Lula lança plano de transição energética](https://www1.folha.uol.com.br/ambiente/2026/11/governo-lula-lanca-plano-de-transicao-energetica-e-diretrizes-para-reduzir-combustiveis-fosseis.shtml) | HTTP 403, `That address isn't allowed.` | Not evaluated |

The managed workspace denied access to `wallhop.io`; the response was not an article page. No result is counted as `OPEN_PASS` or `FULL_TEXT_PASS`. The domain-level live gate stays blocked until the same URLs can be checked from an authorized isolated deployment/test network. No Miniflux, production, Compose, or publisher-origin request was made by this live check.
