# Security notes

## Network boundaries

- Entry URLs come only from a Miniflux entry fetched by numeric ID. The API does not accept a URL from the caller.
- The Miniflux base URL is trusted deployment configuration and may be private for an internal container address. Miniflux redirects are not followed; the configured origin is pinned and the `X-Auth-Token` is not sent to another origin.
- WallHop is called only for an explicitly enabled source. Source URLs with credentials, non-standard ports, sensitive query keys, non-HTTP schemes, or any private/loopback/link-local/reserved DNS answer are rejected before WallHop receives them.
- The sidecar pins each outbound connection to a resolved address, rejects non-public answers, re-resolves and validates every redirect, blocks HTTPS downgrade, limits redirects to three, and caps the response body at 4 MiB. The Miniflux API response cap is 2 MiB.
- No cookies, browser credentials, Miniflux auth headers, or caller headers are sent to WallHop. The URL is encoded into one path segment so its query cannot become WallHop query parameters.

## Content and credentials

- The endpoint requires a separate bearer token. Keep it and the Miniflux token in a secret manager. Do not publish the container port.
- The Miniflux token is sent only in an `X-Auth-Token` header to the configured Miniflux origin. The API client uses `GET /v1/entries/{id}`, `GET /v1/feeds/{feed_id}`, and `GET /v1/entries/{id}/fetch-content?update_content=false`; it has no `PUT`, `POST`, or `DELETE` operation. The feed response includes feed settings, but the sidecar only reads the URL rewrite rules and never logs or stores other feed fields.
- Native scraping is limited to an explicit feed policy, pre-resolves the article host to a public address, rejects sensitive URLs and configured URL rewrite rules, and relies on Miniflux 2.3.5's own connection-time private-network guard. Keep `FETCHER_ALLOW_PRIVATE_NETWORKS` disabled; the service cannot override or verify that Miniflux runtime setting.
- Logs contain entry ID, source host, status, and request route only. They do not include article bodies, source URL query values, cookies, API tokens, or provider response bodies.
- WallHop content is treated as hostile input. Scripts and active markup are never executed or returned; text is escaped into fresh paragraph tags. Remote links and images are omitted in P0.
- Successful overlays from either provider persist in a private SQLite database keyed by entry ID and a fingerprint of the URL, title, publication time, feed ID, and original content. Read/star state is deliberately excluded. Changed source fields invalidate the record; records expire after 30 days and are bounded by entry, content-size, and total-database limits.

## Gates

- The feature and all policies default to disabled. There is no preloading path.
- The SQLite volume contains sanitized recovered prose and provenance. Restrict filesystem access, back it up through SQLite's online backup API, and remove the volume only when the saved overlays are no longer needed.
- 13ft is not an accepted provider value. Runtime configuration cannot open its gate; a separate security review and code change are required.
- No real publisher or production Miniflux test is bundled in the deterministic test suite.

## Residual risks

- A Miniflux API token may permit writes if stolen, even though this service issues GET only. Deployment review should protect secret access, verify the Miniflux account's permissions, and restrict the sidecar's network path to Miniflux where feasible.
- DNS pinning protects the sidecar's connections, but WallHop performs its own fetch after receiving the public article URL. The explicit source allowlist and preflight DNS check reduce exposure but cannot control WallHop's later DNS resolution.
- Completeness is heuristic. False negatives retain the original feed content; false positives remain possible and require real-article validation before enabling any source.
