# Article Intelligence Summary API — SUMMARY-01

This package adds one HTTP operation,
`POST /api/ai/v1/entries/{entry_id}/summary`, on a FastAPI ASGI application. It reuses the merged `services.article_intel_auth.MinifluxAuthService`; it does not add another login, identity store, session system, provider, or persistent summary cache.

## Request and authorization

The request body is capped at 8 KiB, must be JSON, rejects duplicate keys, and is validated against `contracts/summary-request.schema.json`. Its only accepted fields are `schema_version`, UUID `request_id`, and the registered `editorial-default` `profile_id`. The route rejects query parameters, arbitrary article URLs, HTML, free-form prompts, model selectors and provider keys. It accepts the existing Miniflux API key only in `X-Miniflux-API-Key`; `X-NewsFlux-Miniflux-Server` is checked by the reused auth module against its exact operator-configured server. No credential is persisted or logged.

Each request must use HTTPS, an allowed request Host and an exact allowed `Origin` when supplied. `OPTIONS` checks the exact origin, method and headers. The API emits `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Vary: Origin`. When TLS terminates at a proxy, the ASGI server must trust forwarded protocol/host data only from explicitly configured proxy addresses. This PR does not add a proxy or deployment configuration.

After request validation, the route calls `MinifluxAuthService.authorize_entry()` with the request's own key and requested entry ID. That call revalidates `/v1/me`, fetches the entry with the same user's key, and checks entry and feed ownership. The API itself issues no Miniflux writes, article URL fetches, or Content Fallback calls.

After a generated result, it repeats the same authorization and content read. If the key was revoked, the identity changed, or the article fingerprint changed while inference ran, the route discards the result and returns an authentication or stale-snapshot error. Nothing is cached between requests.

## Content snapshot and completeness

`ContentSnapshotResolver` uses the existing pure `services.content_fallback.content.assess_content()` quality assessor on authorized Miniflux HTML; it does not call the Content Fallback service, scraper, WallHop, or provider code. It converts its safe text blocks into `p1`, `p2`, ... paragraph IDs, calculates a snapshot fingerprint scoped to the entry, user, origin and content, and enforces source, paragraph and text limits. Short, paywalled, blocked, repeated-teaser or oversized content returns `status=insufficient` without invoking an adapter.

Miniflux does not attest that its body is the full article. Even when the quality assessor considers the text sufficient, this API returns `status=partial` and `content_scope=unknown` with an explicit limitation. It never claims `complete` from Miniflux content alone. The resolver's output contract is request-scoped: `entry_id`, `user_id`, `content_origin`, `content_fingerprint`, `content_scope`, and identified paragraphs. A future integration may supply a validated Content Fallback overlay as the effective body and rerun the same resolver; no such integration is implemented here, and Miniflux remains unchanged.

## Inference boundary

The only adapter enabled by default is `DisabledInferenceAdapter`, which returns a safe `unavailable` result and makes no network request. The deterministic synthetic adapter exists only in `tests/support.py`; it accepts exactly one frozen synthetic snapshot and refuses any other content. There is no production fake output, provider router, LiteLLM call, Mistral credential, or paid inference.

The adapter receives only a fixed system instruction and a separate JSON article-data field. Publisher text remains untrusted data; the system instruction says not to follow instructions found in the article, and the adapter has no tool or browser interface. Adapter output and the final response are bounded to 64 KiB and validated locally against the paragraph IDs in the exact request snapshot. The final API object is validated against `contracts/summary-response.schema.json`; errors use `contracts/summary-error.schema.json`. This verifies structure and provenance but does not mathematically prove factual support. The synthetic fixture's expected facts/references are independently frozen in tests.

No summaries are cached or persisted. A two-request per-process concurrency cap applies. The service passes a 15-second timeout to the adapter; the current disabled production adapter makes no request, and the synthetic test adapter respects the argument. Any future provider adapter must enforce that deadline and return sanitized errors. The ASGI application does not enable credentialed cookies.

## Dependencies and local tests

The repository had no Python web/API dependency manifest. The development runtime already provided FastAPI 0.141.1, Pydantic 2.13.4, JSON Schema 4.26.0, HTTPX 0.28.1 and Uvicorn 0.52.1. Exact direct dependencies used here are pinned in `requirements.txt`; CI installs them before running this package's tests.

```sh
python3 -m pip install -r services/article_intel_summary/requirements.txt
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/article_intel_summary/tests -p 'test_*.py' -v
```

The HTTP integration harness drives the actual ASGI route in-process through HTTPX and a synthetic Miniflux transport. It performs no network calls outside the process, uses no real credentials, never invokes providers, and never writes Miniflux data.

The initial contract intentionally implements only one summary profile and the synthetic adapter boundary. Draft PR #201 proposes a broader API/operation contract, and PR #204 proposes the later A2 LiteLLM runtime; both are still drafts and must be reconciled before provider integration. PR #206 is an isolated Content Fallback runtime rehearsal and was inspected for its loopback-test approach, but no code from that draft is imported.
