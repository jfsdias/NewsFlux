# NewsFlux content fallback service

This isolated sidecar provides on-demand content recovery for a Miniflux entry. Miniflux remains authoritative for feed, category, entry ID, original URL, title, publication time, read state, and starred state. The service only uses Miniflux `GET` requests and never writes to an entry.

P0 supports Miniflux's native scraper for explicitly configured feeds and WallHop for explicitly configured publisher domains. Recovery is off by default and requires both a global enable flag and an explicit `ON_DEMAND` domain or feed policy. Unknown domains, disabled domains, complete content, sensitive source URLs, and content that fails validation keep the Miniflux version. `PRELOAD_RECENT` is recognized but returns `preload_not_available_in_p0`; no scheduler or automatic preloading is included. 13ft is rejected at configuration load until its SSRF and redirect audit has a separate approved gate.

## Runtime configuration

The container listens on port `8790`. It needs these environment variables:

- `MINIFLUX_BASE_URL`: trusted Miniflux API origin, such as `http://miniflux:8080`.
- `MINIFLUX_API_TOKEN`: a secret used only with Miniflux `GET` routes for entries, feed URL-rewrite checks, and response-only native scraping.
- `CONTENT_FALLBACK_API_TOKEN`: a separate bearer secret of at least 32 characters, required by the sidecar endpoint.
- `CONTENT_FALLBACK_POLICIES_JSON`: policy JSON. With the default `{}`, the feature is disabled.
- `CONTENT_FALLBACK_DB_PATH`: absolute persistent SQLite database path; defaults to `/data/content-fallback.sqlite3` in the container.
- `CONTENT_FALLBACK_HOST` and `CONTENT_FALLBACK_PORT`: default to `127.0.0.1:8790` outside the container image. The image binds to `0.0.0.0` for private container-network use; do not publish the port publicly.

`config.example.json` contains the candidate policy for NYT, Bloomberg, WSJ, and Folha. Its global `enabled` value is `false`; an operator must pass its JSON contents in `CONTENT_FALLBACK_POLICIES_JSON` to enable those policies. Economist remains disabled.

To use Miniflux's native scraper for a known public feed, add its ID to `feeds` with `"provider":"miniflux"`. The sidecar reads the feed's URL rewrite rules before scraping and again after; it skips or discards extraction if any rule is configured or the rules changed during the request. It calls `GET /v1/entries/{id}/fetch-content?update_content=false`. Keep Miniflux 2.3.5's `FETCHER_ALLOW_PRIVATE_NETWORKS` disabled. Its default is disabled; verify the deployed setting before enabling a feed policy.

Mount a private persistent volume at `/data` when running the image. The database contains only validated, sanitized overlays and compact provenance; it stores no original article URL, Miniflux token, or publisher HTML. The SQLite file is created with owner-only permissions. Rows expire after 30 days, are capped at 512 entries and 64 MiB total, and each stored overlay is capped at 2 MiB. A changed entry URL/title/feed/publication time/original-content fingerprint invalidates its saved overlay. Read/star changes do not invalidate article text.

## API contract

`GET /healthz` returns health and capability flags without making outbound requests.

`POST /v1/entries/{entry_id}/recover` requires `Authorization: Bearer <CONTENT_FALLBACK_API_TOKEN>` and an empty request body. It accepts an entry ID only; the caller cannot submit an arbitrary URL. The response includes:

- `entry_id` and `url_fingerprint` (SHA-256 of the Miniflux URL, never the URL itself);
- sanitized `content_html`, `content_origin` (`miniflux`, `miniflux_scraper`, or `wallhop`), and `status`;
- a compact content-validation summary and, on success, provider provenance.

Statuses include `original_sufficient`, `recovered`, `incomplete`, `disabled`, `skipped_security`, `provider_unavailable`, `verification_unavailable`, `stale`, and `busy`. On every non-success outcome, the response carries the sanitized Miniflux content. The future NewsFlux client must also check that the response `entry_id` and `url_fingerprint` still match the active article before displaying it.

The endpoint has no request body, and the client exposes no Miniflux write method. A short-lived in-memory cache deduplicates concurrent requests for 15 minutes and is capped at 256 entries. Validated results also persist in SQLite by Miniflux entry ID and content fingerprint. Concurrent WallHop requests are capped at four overall and two per source host. WallHop gets at most two attempts, an eight-second per-request timeout, a 4 MiB response limit, and at most three checked redirects.

### Optional Reader bridge (not enabled by this PR in any deployment)

The Reader integration in this candidate is disabled unless `VITE_CONTENT_FALLBACK_READER_BASE_PATH` is explicitly set to a same-origin relative path at frontend build time and the sidecar Reader bridge is separately enabled. The browser sends the user's existing Miniflux API key only to that same-origin route. It never receives or sends `CONTENT_FALLBACK_API_TOKEN`.

For an explicitly configured single-user pilot, the sidecar requires `CONTENT_FALLBACK_READER_ENABLED=true`, `CONTENT_FALLBACK_READER_USER_ID`, `CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS`, `NEWSFLUX_AI_MINIFLUX_BASE_URL`, and `NEWSFLUX_AI_ALLOWED_WEB_ORIGINS`. The caller's API key is revalidated against `/v1/me` and `/v1/entries/{id}` before and after each recovery. The internal `MINIFLUX_API_TOKEN` must resolve to the same configured user ID and role as the caller's key. An administrator is accepted only when both `/v1/me` responses identify the same administrator and the request-key lookup proves that both the article and its feed belong to that user. The private handoff carries only the request's entry/feed IDs and opaque fingerprints, never the caller's API key. The service independently checks that scope against its Miniflux identity and current article/feed ownership before contacting a provider, then checks them again before returning or caching content. A numeric user ID alone does not authorize recovery. A mismatch or unavailable identity fails closed. The private sidecar URL defaults to loopback; `CONTENT_FALLBACK_PRIVATE_URL` may only point to a fixed private/loopback origin and redirects are rejected.

The reverse proxy must expose only the intended same-origin Reader path, overwrite client-supplied forwarding headers, and reach the sidecar from one of the configured trusted proxy IPs. It must terminate HTTPS for the browser and send `X-Forwarded-Proto: https`. Do not publish the sidecar port or expose its bearer endpoint publicly. No reverse-proxy, Compose, or production configuration is added here.

The Reader action is explicit and only replaces the displayed body after a successful response whose Miniflux entry ID and exact URL fingerprint match the currently displayed article. The bridge returns paragraph-only canonicalized HTML and an allowlisted provenance summary. Failure, insufficient content, malformed output, a changed route/session, or a scope mismatch keeps the original Miniflux body. Read/star state is neither changed nor persisted by this integration. This is an implementation candidate; it does not establish that a deployed sidecar, proxy route, or WallHop provider is available.

### Future AI handoff and operational canary

The future AI resolver may consume the currently displayed body as an ephemeral input identified by the Miniflux `entry_id`, exact `url_fingerprint`, and a presentation-only origin mapped from the existing `content_origin` (`wallhop` → `RECOVERED_WALLHOP`, `miniflux_scraper` → `RECOVERED_MINIFLUX_SCRAPER`; the untouched Miniflux body → `ORIGINAL_MINIFLUX`). It should retain that identity and provenance through the request, avoid persisting recovered account content, and never write read/star state. This PR does not call an AI service or alter its contract.

Before any real-provider canary, first obtain explicit approval for the exact isolated runtime and public article. Build and run the candidate outside production with the fixed Miniflux user identity and private sidecar network described above. If the configured identity is administrative, prove that the per-request key and service token return the same user ID and admin role, and that the article and feed are owned by that identity. Do not create an artificial account or replace an existing credential to pass this gate. Choose an article whose publisher permits automated retrieval; confirm the source is publicly readable without login, cookies, subscription credentials, or supplied headers. Verify the provider policy allows that host before the operator clicks the Reader's explicit recovery action. Record only the entry ID, opaque URL fingerprint, provider, result status, validation counts, and timing; do not record API keys, cookies, article text, or full source URLs. Confirm the original body remains on failure and that Miniflux read/star values and the write-request counter are unchanged. Stop on any scope mismatch, unexpected redirect, identity/fingerprint mismatch, insufficient-content result, or credential/header requirement. This procedure is preparation only: no real WallHop request, Miniflux write, proxy configuration, production route, or deployment is performed by this PR.

## Content validation

The assessor combines useful word count, sentence and paragraph structure, `<article>`/`<main>` signals, JSON-LD `articleBody`, paywall and block-page markers, title-only detection, and comparison with the Miniflux body. Character count alone cannot accept content. A candidate must pass the full-content rules and add at least 30 useful words or 15% over the stored body, whichever is larger. Sanitized output is reconstructed as escaped paragraphs; scripts, remote images, links, forms, frames, and other active markup are not returned.

## Local checks

Run deterministic tests without external network calls:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/content_fallback/tests -p 'test_*.py' -v
```

No live Miniflux, WallHop, publisher, Compose, or production request is made by this test command. The four real-article WallHop attempts for this PR were separately blocked by the managed workspace network policy; none counted as a full-text pass. See the audit report.

Run the isolated runtime rehearsal:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/content_fallback_runtime_01.py
```

The rehearsal starts the actual HTTP handler and Miniflux client against synthetic services bound only to `127.0.0.1`, uses synthetic credentials and a temporary SQLite database, and replaces the WallHop provider at its service boundary. It exercises health, service authentication, read-only Miniflux access, policy gating, sanitized recovery, fallback, stale-entry rejection, cache persistence across a service restart, log redaction, and shutdown. Its JSON receipt contains gate names and counts only; it contains no article body, source URL, or token. The rehearsal does not build or run the Docker image. The Dockerfile healthcheck is a local `/healthz` probe and requires image/runtime validation before deployment.

## Deployment, backup, and rollback

This PR does not change the production Compose file, publish the service port, configure a reverse proxy, or enable the policy. A later isolated deployment should place the sidecar on a private container network, mount a named volume at `/data`, store the two API tokens in the secret manager, bind only an authenticated internal route, and start with `enabled:false`. Run first against a disposable Miniflux environment, then test one approved public article per source before changing an explicit policy to `ON_DEMAND`.

Back up the SQLite database with SQLite's online backup API while the service is running:

```sh
python3 - <<'PY'
import sqlite3

with sqlite3.connect('/data/content-fallback.sqlite3') as source:
    with sqlite3.connect('/backup/content-fallback.sqlite3') as target:
        source.backup(target)
PY
```

Preserve the policy JSON and secret-manager references as deployment configuration. Rollback by disabling the sidecar route and stopping the container. Miniflux needs no restore because the service did not write to it.
