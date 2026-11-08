# ADR 0001: Isolated, read-only content fallback

- Status: proposed in P0 draft PR
- Date: 2026-11-07
- Decision owners: NewsFlux maintainers

## Context

NewsFlux uses Miniflux as the source of truth for an article's identity, original URL, read state, and starred state. Some feeds provide only excerpts, while some publisher pages return paywall teasers. Recovery must preserve the same Miniflux entry and must not modify production entry data in P0.

## Options considered

### A. Native Miniflux configuration

Miniflux 2.3.5 has per-feed scraper rules and a `GET /v1/entries/{id}/fetch-content` endpoint. The endpoint returns scraped content without persisting it by default; `update_content=true` persists the new body. This path uses Miniflux's own scraper and configured feed rules, but does not select WallHop by publisher policy. URL rewrite rules are unsuitable because `RewriteEntryURL` changes the URL used for entry processing and can store that rewritten URL during refresh. A manual entry update sanitizes HTML, but it mutates stored content and a later feed refresh configured to update an existing entry can replace both its URL and content.

### B. Independent `content-fallback-service` sidecar

The sidecar accepts only a Miniflux entry ID, reads that entry through the public API, evaluates its stored content, applies an explicit domain/feed policy, and either requests the Miniflux native scraper or WallHop. Native scraping uses `GET /v1/entries/{id}/fetch-content?update_content=false`; the sidecar checks the feed's URL rewrite rules before and after scraping and rejects configured or changed rules. It returns a sanitized presentation payload and performs no Miniflux writes. Validated overlays persist in a bounded SQLite store keyed by entry ID and a fingerprint of the original entry fields; changes to the source URL or content invalidate the saved overlay. A changed entry snapshot during recovery discards the provider response. This adds an isolated service, secret, and volume, but keeps extraction and network controls outside NewsFlux and lets NewsFlux and Miniflux upgrade independently.

### C. Direct NewsFlux backend/proxy integration

An application proxy could recover content during article detail display. It would couple publisher fetching to the NewsFlux runtime and UI path, expand the browser-facing API surface, and combine SSRF-sensitive network work with the existing application. ArticleDetail integration is a follow-up PR after the service contract and source gates are reviewed.

## Decision

Choose **B**, using the Miniflux public API for read-only native extraction on explicitly enabled feeds and WallHop for allowlisted publisher domains. Keep all policies disabled unless deployment configuration explicitly enables them. Do not add a scheduler, preloading, 13ft, a production Compose change, or ArticleDetail integration in P0.

## Consequences

- Miniflux remains canonical for feeds and user state; recovered content is a response-only overlay.
- Recovered content persists for up to 30 days, with a limit of 512 entries and 64 MiB. The in-memory deduplication cache is short-lived and clears on restart.
- Content, identity, status, or star changes during a provider request cause the service to return the current Miniflux version.
- The Miniflux API token and the sidecar bearer token require separate secret handling. Deployment should keep the service on a private network.
- Source policies and full-text validation need real-article evidence before any domain is enabled. The initial live attempts were blocked by the managed workspace's outbound network policy.
