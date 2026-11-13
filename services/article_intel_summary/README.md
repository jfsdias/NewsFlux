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

## Shared LiteLLM integration

`create_app()` wires the existing LiteLLM adapter only when inference is explicitly enabled and the server-side configuration is complete. An unset or invalid setting leaves `DisabledInferenceAdapter` active. The request always targets the fixed backend URL plus `/v1/chat/completions`; the browser cannot choose a model or send a provider credential. The backend selects one of two operator-configured choices, `s5-free` or `mistral-small`, and sends that choice's exact configured LiteLLM alias. There is no automatic fallback between them.

The actual aliases configured on the operational LiteLLM instance have not been verified in this repository. Configure `NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS` and `NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS` from that instance before enabling inference. These are not presumed to be the provider API model names. Rates also remain explicit operator inputs; the code does not assume S5 Free costs zero. Paid inference requires `NEWSFLUX_AI_ALLOW_PAID_INFERENCE=true`; this is required for Mistral Small and whenever either configured rate is nonzero.

The backend uses only the authorized Miniflux title and identified paragraphs, removes URLs before transfer, excludes browser and Miniflux credentials, treats article text as untrusted, sends one non-streaming request, follows no redirects, imposes timeouts and response limits, and never retries automatically. The response must identify the configured alias and include usage accounting. NewsFlux parses strict JSON and validates its response schema, paragraph references, size and provenance. HTTP 429, timeouts, invalid output and unavailable service produce safe errors. Model selection is entirely server controlled.

For the S5 pilot, configure `NEWSFLUX_AI_S5_MAX_OUTPUT_TOKENS=2048` independently of `NEWSFLUX_AI_MAX_OUTPUT_TOKENS` (the latter remains the Mistral limit). Set the S5 inference timeout to at most 25 seconds and reserve sufficient tokens per minute for the configured input and output maxima. The API candidate deadline is 60 seconds, with 10 seconds reserved before dispatch for revalidation. Expiry ends the HTTP wait; a dispatched request may continue remotely, and its local worker retains capacity until accounting completes. The pilot requires exclusive ownership of a persistent local ledger volume. Orphaned in-flight reservations become uncertain only after ownership is acquired. Records are not automatically deleted during admission; ledger space and a separately approved retention policy require operational monitoring.

Configuration is supplied only to the backend:

| Purpose                                          | Settings                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explicit enablement and transfer authorization   | `NEWSFLUX_AI_INFERENCE_ENABLED`, `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER`                                                                                                                                                                                     |
| Optional paid inference                          | `NEWSFLUX_AI_ALLOW_PAID_INFERENCE`                                                                                                                                                                                                                                 |
| Fixed shared gateway and server-side secret file | `NEWSFLUX_AI_LITELLM_BASE_URL`, `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE`                                                                                                                                                                                             |
| Backend model choice and configured aliases      | `NEWSFLUX_AI_LITELLM_MODEL_CHOICE`, `NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS`, `NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS`                                                                                                                                                 |
| Per-choice input/output rates and monthly budget | `NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION`, `NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION`, `NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION`, `NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION`, `NEWSFLUX_AI_MONTHLY_BUDGET_USD` |
| Token, request, concurrency and timeout caps     | `NEWSFLUX_AI_MAX_INPUT_TOKENS`, `NEWSFLUX_AI_MAX_OUTPUT_TOKENS`, `NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE`, `NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE`, `NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS`                                                                               |
| Existing private usage ledger                    | `NEWSFLUX_AI_USAGE_DATABASE_PATH`                                                                                                                                                                                                                                  |

The LiteLLM key file must be an owner-only regular file with mode `0600`; it is never included in settings representations or logs. The existing SQLite ledger stores only request/token counts, reservation state, timestamps and costs in an owner-only directory and file. It stores no article, prompt, result, user identity or credentials. It enforces the configured monthly cost budget, request/token rates and one in-flight call. A zero configured rate can still be reserved while request and token limits remain enforced; this is an explicit operator cost input, not a product claim about a model's current price.

Tests use `httpx.MockTransport`, synthetic article content and fake LiteLLM responses. No provider call or Miniflux write was made. `AVAILABLE_MODEL_ALIASES=NOT_VERIFIED_IN_LITELLM`; production alias mapping, effective pricing, privacy/logging settings and a reachable same-origin backend runtime remain deployment gates. A controlled canary requires separate explicit authorization. Miniflux-only responses stay `partial` with `content_scope=unknown`; no summary is cached or persisted, and generated output is not a guarantee of factual completeness.

## Dependencies and local tests

The repository had no Python web/API dependency manifest. The development runtime already provided FastAPI 0.141.1, Pydantic 2.13.4, JSON Schema 4.26.0, HTTPX 0.28.1 and Uvicorn 0.52.1. Exact direct dependencies used here are pinned in `requirements.txt`; CI installs them before running this package's tests.

```sh
python3 -m pip install -r services/article_intel_summary/requirements.txt
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/article_intel_summary/tests -p 'test_*.py' -v
```

The HTTP integration harness drives the actual ASGI route in-process through HTTPX and a synthetic Miniflux transport. It performs no network calls outside the process, uses no real credentials, never invokes providers, and never writes Miniflux data.

The API remains one registered `editorial-default` profile and never accepts a client-side model choice. The synthetic adapter boundary is used for deterministic tests; operational provider configuration is not present in this checkout.

## Optional S5 Free → Mistral Small fallback (separate functional PR)

The service defaults to **one model and one request**. The optional S5 → Mistral
fallback is disabled unless the operator explicitly sets
`NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK=true`. It is only available with
`NEWSFLUX_AI_LITELLM_MODEL_CHOICE=s5-free`, configured and distinct S5 and
Mistral LiteLLM aliases, valid nonzero Mistral input/output prices, and both
`NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=true` and
`NEWSFLUX_AI_ALLOW_PAID_INFERENCE=true`. An incomplete opt-in fails closed:
the service uses `DisabledInferenceAdapter` rather than silently routing
some requests to paid inference.

The first attempt targets only the configured S5 alias. The backend attempts
Mistral **once at most** when S5 returns 429, 500, 502, 503, 504, or an HTTPX
timeout. It does not fallback for authentication/permission errors, other 4xx,
redirects, budget or rate denial, unsafe/unavailable source content, malformed
model output, wrong model identity, or invalid/insufficient configuration.
Neither model is retried; model selection is not browser-controlled. A bounded
fraction of the request deadline is reserved for the fallback.

Both model adapters use **the same private SQLite usage ledger** and the same
virtual key. Every attempt makes its own pre-dispatch reservation and is
accounted at **that model's configured prices**; unknown usage stays reserved
conservatively. The selected alias must also be echoed by LiteLLM as the model
identity before a result is accepted. The ordinary request-scoped Miniflux
ownership and stale-source revalidation still apply. The API never writes
Miniflux, schedules background inference, or persists prompts/responses.

To allow the second attempt in one minute, the **backend** must have
`NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE >= 2` and
`NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE >= 2 * (MAX_INPUT_TOKENS + MAX_OUTPUT_TOKENS)`.
The LiteLLM virtual key needs independently verified permission to use
**both aliases**, matching effective per-key RPM/TPM, and a bounded total
budget/expiry; changing backend variables does not modify that key. Existing
operator R15 settings (1 RPM / 4000 TPM) are **not ready** for fallback.
Mistral and external transfer still require separate operator authorization.
The S5 zero-price setting is an operator-supplied pricing assumption and must
be rechecked when the provider's promotional offer changes.

The fallback is deliberately not configured in the shared LiteLLM model router.
Transparent gateway-side fallback could violate the application’s required
model identity and per-model cost accounting. Keep the gateway and other
consumers unchanged. This change does **not** authorize a production deployment,
credential-policy change, or live inference.
