# Article Intelligence authentication foundation

This package contains framework-neutral identity, administrative authorization, entry authorization and exact-origin CORS primitives for a future NewsFlux AI API. It does **not** start a server, add an API route, store provider or Miniflux credentials, call an inference provider, or integrate with the Reader. No new dependency is required.

## Decision and compatibility

The module preserves the current NewsFlux Miniflux login. The frontend continues to use its existing Miniflux URL and API key, current password-to-dedicated-key provisioning path, persistent auth state, and logout flow. This package accepts a request-scoped copy of that API key and validates it with Miniflux for each protected operation. It does not change `src/store/authState.js`, `src/utils/auth-apikey.js`, or `src/utils/session.js`.

Current login/logout and API calls remain in the browser. The existing `src/apis/ofetch.js` captures an auth-session snapshot and rejects a response after the session changes. The future AI API client must use the same session-revision and response-discard behavior. The module itself has no persistent NewsFlux session and cannot cancel a Miniflux request that was already authorized and is in flight when a user logs out.

## Runtime configuration

Set these values only in the future AI backend's protected runtime configuration. The module contains no credential environment variable and accepts no global Miniflux token.

| Name                                  | Requirement                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEWSFLUX_AI_MINIFLUX_BASE_URL`       | One operator-configured `https://` API base; may include a simple reverse-proxy path prefix. No credentials, query, fragment, encoded path or dot segments.                                  |
| `NEWSFLUX_AI_ALLOWED_WEB_ORIGINS`     | Comma-separated exact HTTPS NewsFlux browser origins, including scheme and optional non-default port; no paths, wildcards or credentials.                                                    |
| `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` | Optional comma-separated positive Miniflux numeric user IDs. Missing, empty or malformed input results in no authorized admins. The allowlist is scoped to the one configured Miniflux base. |

Example with synthetic values only:

```text
NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.example
NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://newsflux.example
NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=7,12
```

An absent or invalid Miniflux base or browser-origin configuration must prevent the AI backend from starting. A missing, empty or invalid admin allowlist disables administrative authorization while leaving the existing NewsFlux reader untouched.

## Request adapter contract

The HTTP framework adapter is future work. For each request it must pass the following data to the module:

- `api_key`: value from `X-Miniflux-API-Key` (the user's existing key; never a provider key).
- `claimed_miniflux_base_url`: value from `X-NewsFlux-Miniflux-Server`. This is an untrusted compatibility claim only. The module canonicalizes and compares it to the server configuration; it never uses the claim as an outbound destination.
- `request_origin`: browser `Origin`, when present. It is checked against the exact allowlist for CORS. `Origin` is **not** an identity credential.
- `request_is_secure=True`: only when the request is HTTPS on the direct connection or when TLS termination is provided by an explicitly trusted reverse proxy. Never derive this from an arbitrary client-supplied `X-Forwarded-Proto` header.
- `client_claims`: optional decoded request claims; `user_id`, `is_admin`, `principal_id`, `tenant_id`, role claims and equivalent spellings are rejected.

The API key is the actual bearer credential. Every operation calls Miniflux `GET /v1/me` with `X-Auth-Token` against the single configured Miniflux base. The backend validates a positive integer `id`, nonempty `username`, and strict boolean `is_admin`. No positive identity cache is used. Requests with an Origin outside the allowlist fail before the Miniflux key is sent. A claimed Miniflux base mismatch also fails before any network request.

The outbound HTTP transport is the existing `services.content_fallback.http_client.PinnedHTTPClient`, reused for DNS pinning, response limits, timeouts, and redirect checks. The caller pins the target to the configured Miniflux base, sets a 5-second timeout, and disables redirects. Only the user's request key is sent as `X-Auth-Token`; browser Origin, Authorization, Cookie, client identity headers, and Content Fallback's service token are not forwarded. The private-origin allowance exists only because this exact operator-configured Miniflux endpoint may be on a trusted private network; do not make the destination client-selectable.

## Administrative authorization

`authorize_admin()` revalidates `/v1/me` on the current request and permits access only if:

1. Miniflux returned `is_admin` as the JSON boolean `true`.
2. The verified Miniflux user ID is in the valid, nonempty, backend-configured allowlist.
3. The request's claimed Miniflux base matches the configured base.

Miniflux administrator status alone is insufficient. The allowlist alone is insufficient. The client cannot supply either fact. Provider credentials, model selection, budgets and provider admin endpoints are not implemented here.

## Article authorization

`authorize_entry()` validates a positive signed-64-bit entry ID, verifies `/v1/me`, then issues `GET /v1/entries/{id}` with the **same user's key**. It rejects inaccessible entries and verifies the returned entry ID, entry `user_id`, feed ID, nested feed ID, and feed `user_id` against the verified principal. A 404-safe `entry_not_accessible` response avoids exposing whether a guessed ID exists for another user.

The result contains a request-scoped entry snapshot and content hash. It omits the Miniflux key, server URL and source article URL. The article URL is never fetched by this package. The result is not persisted or passed to Content Fallback or an AI provider. Content completeness, recovered content, summarization and external transfer remain separate work.

## CORS, proxy trust and cookies

`OriginPolicy` reflects only an exact configured HTTPS origin, rejects opaque `null` and wildcard origins, limits preflight headers, sets `Vary: Origin`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and does not enable credentialed cookies. A disallowed browser origin with the required custom API-key header is denied at preflight and request policy. A non-browser client that already possesses a valid Miniflux key is authorized by that key; Origin is not a way to authenticate such a client.

The package does not implement HTTP response middleware, TLS termination or reverse-proxy configuration. Before connecting it to routes, the API host must enforce HTTPS, configure exact hostnames, and trust forwarded host/protocol headers only from explicitly configured proxy addresses. Do not expose the backend through arbitrary host routing. No cookie session exists in this PR. If a future route uses cookies, HttpOnly/Secure/SameSite, CSRF tokens, session expiry and revocation become mandatory gates.

## Safe failures and limits

All module failures use generic `AuthError` codes and fixed messages. Upstream error bodies, URLs, headers, and credentials are omitted. `/v1/me` responses are capped at 64 KiB; entry responses are capped at 2 MiB; each outbound GET is limited to five seconds; redirects are disabled. Invalid, revoked, malformed, oversized, or unavailable upstream responses fail closed. No retry or credential cache exists.

## Tests and remaining integration gates

Tests use synthetic API keys and fake/pinned HTTP transports only. They do not contact Miniflux, use production credentials, change Miniflux data, or call AI providers. The framework-neutral module's HTTPS, CORS, origin, identity, admin and entry rules are unit/integration tested. The following are outside this package and must be verified when the real backend is created: actual route middleware wiring, same-origin HTTPS deployment, reverse-proxy trust configuration, rate limiting, security headers, real-browser CORS behavior, and stale-response discard in any future AI UI. OIDC/Authelia is not required absent a demonstrated failure of the Miniflux-native design.

The API assumptions follow the [Miniflux API reference](https://miniflux.app/docs/api.html). The broader Article Intelligence architecture and planned runtime boundaries are recorded in [PR #201](https://github.com/jfsdias/NewsFlux/pull/201) and [PR #204](https://github.com/jfsdias/NewsFlux/pull/204).
