# ADR 0002: Reading-signals service for learned source affinity

- Status: proposed (NF-0901); needs owner acceptance before NF-0902
- Date: 2026-11-27
- Decision owners: NewsFlux maintainers; owner direction recorded on 2026-11-27 (server-side, on the owner's OMV host, own service)
- Epic: [NF-E08 Learned source affinity](../NF-E08_LEARNED_SOURCE_AFFINITY.md)

## Context

NF-E08 needs exposure, opens and reading depth per source. Miniflux stores read state and `changed_at` but not exposure, and the 2026-11-27 measurement showed that its timestamps alone cannot separate preference from navigation order or volume. The roadmap (§6) requires an architecture decision before any first-party persistent state, and §3.14 keeps `NEW_PERSISTENCE=NOT_AUTHORIZED` until then. This ADR answers the seven §6 questions for this state only.

## Options considered

### A. Browser-local storage only

Same pattern as Smart Views and reading continuity. No server, but learning is per browser: the owner reads on phone, foldable and desktop, so each device would learn a third of the behavior, and clearing site data would erase it.

### B. Miniflux as storage

Miniflux has no field for per-source behavioral data. Encoding it in feed titles, categories, rules or entry fields would mutate the source of truth and break the Miniflux-authority invariant. Rejected.

### C. Dedicated `reading_signals` sidecar on the owner's host (chosen)

A small stdlib Python service, in the same layout as `services/content_fallback` and `services/story_ranker`, with a SQLite volume. It reuses `services/article_intel_auth` to validate the user's existing Miniflux API key per request, so it adds no second login and stores no credential.

## Decision

Choose **C**. The service stores per-source daily aggregates only and computes affinity on request. It is disabled by default in release governance and in the client setting.

### Data stored

One table, primary key `(account_digest, feed_id, day)`:

| Column                                         | Type    | Note                                                               |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `account_digest`                               | text    | SHA-256 of normalized Miniflux server + user ID, as in Smart Views |
| `feed_id`                                      | integer | Miniflux feed ID                                                   |
| `day`                                          | date    | UTC day                                                            |
| `impressions`, `opens`, `read_to_end`, `stars` | integer | Bounded non-negative counters                                      |

Not accepted or stored: entry IDs, titles, URLs, content, search text, timestamps finer than a day, device identifiers, IP addresses in application logs.

### API

- `POST /v1/signals`: increments counters for up to 200 `(feed_id, day, counts)` rows; rejects any other field.
- `GET /v1/affinity`: per-source decayed counts, affinity, state and window.
- `GET /v1/export`: all aggregates for the account as JSON.
- `DELETE /v1/signals`: reset; deletes every row for the account.
- `GET /healthz`.

## Answers to the §6 questions

1. **Source of truth:** the sidecar is canonical for behavioral aggregates only. Miniflux stays canonical for feeds, categories, entries, read and starred state.
2. **Devices and conflicts:** multi-device by design. Clients send increments, which commute, so there are no write conflicts. Each device deduplicates impressions per entry per day locally, keeping the current day's entry IDs in browser storage only and discarding them at day change; the same entry seen on two devices counts twice, a bounded inflation documented in the epic.
3. **Privacy:** opt-in, off by default; aggregates per source per day only; runs on the owner's private network; no third parties, no remote model. Reset deletes server rows; export returns them.
4. **Referential identity:** keyed by account digest and Miniflux feed ID. On each affinity request the client sends the current feed ID set; rows for feed IDs no longer subscribed are purged. A different Miniflux server or user produces a different digest and starts empty.
5. **Export/portability:** `GET /v1/export` JSON with a schema version. Import is out of scope.
6. **Partial failure:** the client keeps unsent increments locally (bounded, at most 7 days) and retries; on rejection or timeout Home falls back to V1 personalization with no learned weight. Learning never blocks reading.
7. **Relationship to Miniflux:** read-only. The service never calls a Miniflux write endpoint; it uses Miniflux only to validate the API key. Learned output affects Home presentation only.

## Retention

Daily rows older than 180 days are deleted. Affinity uses a 30-day half-life decay, so older rows have negligible weight before deletion.

## Consequences

- One more service, volume and release-governance entry on the owner's host, following the existing sidecar pattern.
- Learning follows the owner across devices and survives browser data clears.
- Roadmap constraint `NEW_PERSISTENCE=NOT_AUTHORIZED` gains one scoped exception for this store when this ADR is accepted; `ALL_UNREAD_HIDDEN_RANKING=PROHIBITED` and `MINIFLUX_SOURCE_OF_TRUTH=PRESERVED` are unchanged.
- If the owner turns learning off, nothing is collected; existing rows stay until reset.
