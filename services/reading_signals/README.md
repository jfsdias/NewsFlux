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

`ops/deploy/reading-signals/compose.yaml` runs the image only under the `reading-signals` profile. It is not part of release governance; enabling it is a separate owner decision.

## Production wiring

- **Route.** The pilot Caddyfile (`ops/deploy/article-intel-pilot/Caddyfile`) forwards only the five routes above, under `/api/reading-signals/`, from the trusted TLS edge with `X-Forwarded-Proto: https`, to `reading-signals:8791`; every other `/api/reading-signals/*` request gets 403. It ships with `ai-functional-release.sh update-caddy` and rolls back with `rollback-caddy`. If the sidecar is not running, the route fails and the client keeps learning off.
- **Networks.** The sidecar joins the existing private network that the Reader Caddy shares with the Summary API, under the alias `reading-signals`, and one egress network with a route to Miniflux (the one the Summary API uses for key checks).
- **Trust.** The only trusted proxy is the Reader Caddy's fixed IP on that private network; `deploy.sh` reads it from the running Reader and refuses to continue if the address is not IPAM-fixed.
- **Apply and rollback.** `ops/deploy/reading-signals/deploy.sh apply` (run by the owner as root) clones the approved commit, builds the image from it, writes a 0600 env file without secrets, starts the profile and waits for a healthy container. `rollback` stops and removes the container and keeps the data volume. `status` prints state, health, image and revision.

## Tests

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/reading_signals/tests -p 'test_*.py' -v
```

`tests/test_deploy_script.py` runs `deploy.sh` against a fake `docker` and a local git origin.
