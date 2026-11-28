# NewsFlux reading-signals sidecar

NF-0902 of [NF-E08 Learned source affinity](../../docs/NF-E08_LEARNED_SOURCE_AFFINITY.md), as decided in [ADR 0002](../../docs/adr/0002-reading-signals-service.md).

The service stores **per-source daily counters only** (impressions, opens, read to end, stars) and computes a per-source affinity on request. It never stores entry IDs, titles, URLs, content, finer timestamps, device identifiers or credentials, and it never calls a Miniflux write endpoint. Miniflux is used only to validate the caller's existing API key (`services/article_intel_auth`).

## API

All `/v1` routes require the NewsFlux headers `X-Miniflux-API-Key` and `X-NewsFlux-Miniflux-Server`, an allowed `Origin` when present, and HTTPS (direct TLS, or `X-Forwarded-Proto: https` from a trusted proxy IP). The account is the SHA-256 of the configured Miniflux base URL and the authenticated user ID.

| Route                              | Purpose                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                     | Liveness, no authentication                                                                                                                                                                                                           |
| `POST /v1/signals`                 | Add `{"schema": 1, "rows": [{"feed_id", "day", "impressions", "opens", "read_to_end", "stars"}]}`; at most 200 rows, days from 7 days ago to tomorrow (UTC), counts 0 to 100000. Any other field is rejected                          |
| `GET /v1/affinity[?feeds=1,2,...]` | Per-source decayed counts, affinity, state (`learning`, `neutral`, `preferred`, `rarely_opened`), Home weight within 0.7 to 1.3, and the reason text. When `feeds` is given, rows for other feed IDs are deleted (unsubscribed feeds) |
| `GET /v1/export`                   | All daily rows of the account as JSON (`schema: 1`)                                                                                                                                                                                   |
| `POST /v1/signals/reset`           | Deletes every row of the account                                                                                                                                                                                                      |

Rows older than 180 days are pruned. Affinity uses a 30-day half-life, a prior of 20 pseudo-impressions at the account-wide open rate, and stays neutral below 30 decayed impressions.

## Configuration

| Variable                                                                  | Requirement                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `READING_SIGNALS_ENABLED`                                                 | Must be `true`; otherwise the process exits at start                           |
| `READING_SIGNALS_TRUSTED_PROXY_IPS`                                       | Comma-separated reverse-proxy IPs allowed to assert `X-Forwarded-Proto: https` |
| `NEWSFLUX_AI_MINIFLUX_BASE_URL`                                           | The one HTTPS Miniflux API base                                                |
| `NEWSFLUX_AI_ALLOWED_WEB_ORIGINS`                                         | Exact HTTPS NewsFlux origins                                                   |
| `READING_SIGNALS_HOST`, `READING_SIGNALS_PORT`, `READING_SIGNALS_DB_PATH` | Defaults `0.0.0.0`, `8791`, `/data/reading-signals.sqlite3`                    |

`ops/deploy/reading-signals/compose.yaml` runs the image only under the `reading-signals` profile. It is not part of release governance; enabling it is a separate owner decision, needed only once NF-0903 sends data.

## Tests

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/reading_signals/tests -p 'test_*.py' -v
```
