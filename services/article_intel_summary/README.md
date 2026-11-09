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

## LiteLLM A2 / Mistral adapter

`create_app()` now wires `LiteLLMInferenceAdapter` only when every backend setting below is valid and approved. All approval flags default to false; an unset value never enables inference. With the current environment unset, the app creates `DisabledInferenceAdapter` and makes no gateway request. The adapter accepts exactly `mistral-small-2603` and posts once to `/v1/chat/completions`; it does not select a fallback, enable streaming, or send tools/function calls. It sends JSON mode only after the operator-approved deployment JSON-mode gate passes. NewsFlux still parses strict JSON and applies its own response schema and paragraph-reference validation.

The integration reuses the authorized entry and `ContentSnapshotResolver` from this service. It sends only the title and identified paragraph text/IDs. It removes absolute and bare-domain URLs before transfer, including query strings, and never forwards the Miniflux API key, cookies, user identity, or Miniflux server URL. Article text remains untrusted data in a separate user message; the fixed system message prohibits following article instructions. The gateway client verifies TLS, follows no redirects, caps response bytes, applies timeouts and makes no automatic retries. Error responses, provider bodies, prompts, and model output are not written to logs by this adapter. The service reauthorizes the entry and content fingerprint after inference and discards an obsolete result.

The deployment must provide these protected backend settings. Each `*_APPROVED`, `*_REVIEWED`, `*_VERIFIED`, and `*_AUTHORIZED` flag must remain absent or false until its evidence has been independently reviewed. Setting a flag is not evidence that A2 exists or that the associated control is correctly configured.

| Purpose                                                                    | Setting                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Master enablement and external/paid transfer approvals                     | `NEWSFLUX_AI_INFERENCE_ENABLED`, `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER`, `NEWSFLUX_AI_ALLOW_PAID_INFERENCE`                                                                                                                                  |
| Dedicated A2 deployment and exact model mapping                            | `NEWSFLUX_AI_A2_RUNTIME_APPROVED`, `NEWSFLUX_AI_DEDICATED_A2_CONFIRMED`, `NEWSFLUX_AI_MISTRAL_MAPPING_VERIFIED`                                                                                                                                     |
| JSON mode, account privacy/retention/training, backend and LiteLLM logging | `NEWSFLUX_AI_MISTRAL_JSON_MODE_VERIFIED`, `NEWSFLUX_AI_ACCOUNT_PRIVACY_REVIEWED`, `NEWSFLUX_AI_ACCOUNT_RETENTION_REVIEWED`, `NEWSFLUX_AI_ACCOUNT_TRAINING_REVIEWED`, `NEWSFLUX_AI_BACKEND_LOGGING_REVIEWED`, `NEWSFLUX_AI_LITELLM_LOGGING_REVIEWED` |
| Gateway budget/rate-limit enforcement and current price review             | `NEWSFLUX_AI_LITELLM_BUDGET_ENFORCEMENT_VERIFIED`, `NEWSFLUX_AI_LITELLM_RATE_LIMITS_VERIFIED`, `NEWSFLUX_AI_MISTRAL_PRICE_REVIEWED`                                                                                                                 |
| Fixed gateway URL, exact model ID and virtual-key file path                | `NEWSFLUX_AI_LITELLM_BASE_URL`, `NEWSFLUX_AI_LITELLM_MODEL_ID`, `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE`                                                                                                                                              |
| Price evidence and operator-approved local limits                          | `NEWSFLUX_AI_MISTRAL_PRICE_SOURCE_URL`, `NEWSFLUX_AI_MISTRAL_PRICE_VERIFIED_AT`, `NEWSFLUX_AI_MISTRAL_INPUT_USD_PER_MILLION`, `NEWSFLUX_AI_MISTRAL_OUTPUT_USD_PER_MILLION`, `NEWSFLUX_AI_MONTHLY_BUDGET_USD`                                        |
| Request/token limits and private usage ledger                              | `NEWSFLUX_AI_MAX_INPUT_TOKENS`, `NEWSFLUX_AI_MAX_OUTPUT_TOKENS`, `NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE`, `NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE`, `NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS`, `NEWSFLUX_AI_USAGE_DATABASE_PATH`                             |

The virtual key is a dedicated LiteLLM key, not the Mistral key or LiteLLM master key. Store it in a service-owned file with mode `0600`; do not put it in browser configuration, a repository `.env`, or logs. The usage database must be an absolute path in an owner-only directory (mode `0700` or stricter); its file is created with mode `0600`. It records only token counts, reservation state, timestamps, and cost; it does not store prompts, responses, article IDs, user IDs, or credentials. Any ledger error blocks the request. Pre-dispatch reserves the maximum configured token cost and checks a local monthly budget, RPM, TPM, and one in-flight call. The configured LiteLLM key must independently enforce provider-side budget and rate caps. There is no built-in monthly budget amount.

As of 2026-11-09, Mistral's public list-price page lists `mistral-small-2603` at USD 0.15 per million input tokens and USD 0.60 per million output tokens ([official pricing](https://docs.mistral.ai/inference/pricing), [model documentation](https://docs.mistral.ai/models/mistral-small-4-0-26-03)). These are public list rates, not verified account charges, taxes, regional price, or proof of a zero-cost tier. The deployment must recheck the official source and effective account terms before enabling paid inference. The operator must provide an explicit monthly budget and token limits; none are hardcoded.

The gateway is not available or verified in this development workspace. Thus the real A2 mapping, account retention/training/logging controls, provider-side budget enforcement, and effective price are **BLOCKED / NOT TESTED**. No Mistral or LiteLLM request was made during this implementation. The configured-gateway tests use `httpx.MockTransport` and synthetic article text only. A first, single synthetic canary needs a separate approval containing the actual gateway/deployment digest, provider/model mapping, price source, prompt version, token caps, maximum estimated cost, approved budget, gateway cap evidence, privacy/logging review, and rollback. Its status remains `NOT_AUTHORIZED`; this code is not evidence of live inference.

Use this approval record only after the A2 evidence is available. Leave it `SAFE_TO_EXECUTE=NO` until the separate approval is explicit:

```text
MISTRAL_REAL_CANARY_AUTHORIZATION

GATEWAY=
IMAGE_DIGEST=
DEPLOYMENT_ID=
EFFECTIVE_MODEL=
PROVIDER=
MODEL_PRICE_SOURCE=
PROMPT_VERSION=

MAX_INPUT_TOKENS=
MAX_OUTPUT_TOKENS=
MAX_ESTIMATED_COST=
APPROVED_BUDGET=
PROVIDER_BUDGET_ENFORCEMENT=

DATA_CLASS=SYNTHETIC_ONLY
EXTERNAL_TRANSFER_APPROVED=
ACCOUNT_PRIVACY_REVIEW=
LOGGING_REVIEW=

REQUEST_COUNT=1
ROLLBACK=
SAFE_TO_EXECUTE=NO
```

No summaries are cached or persisted. The service keeps its two-request per-process cap; the Mistral adapter and its persistent ledger additionally allow only one provider call at a time. Response bytes and output are bounded to 128 KiB and 64 KiB respectively, and the API validates the final object against `contracts/summary-response.schema.json` and the exact snapshot paragraph IDs. The result remains `partial` with `content_scope=unknown` for Miniflux-only content. This validates structure and provenance but does not mathematically prove factual support. The ASGI application does not enable credentialed cookies.

## Dependencies and local tests

The repository had no Python web/API dependency manifest. The development runtime already provided FastAPI 0.141.1, Pydantic 2.13.4, JSON Schema 4.26.0, HTTPX 0.28.1 and Uvicorn 0.52.1. Exact direct dependencies used here are pinned in `requirements.txt`; CI installs them before running this package's tests.

```sh
python3 -m pip install -r services/article_intel_summary/requirements.txt
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/article_intel_summary/tests -p 'test_*.py' -v
```

The HTTP integration harness drives the actual ASGI route in-process through HTTPX and a synthetic Miniflux transport. It performs no network calls outside the process, uses no real credentials, never invokes providers, and never writes Miniflux data.

The initial contract intentionally implements only one summary profile and the synthetic adapter boundary. Draft PR #201 proposes a broader API/operation contract, and PR #204 proposes the later A2 LiteLLM runtime; both are still drafts and must be reconciled before provider integration. PR #206 is an isolated Content Fallback runtime rehearsal and was inspected for its loopback-test approach, but no code from that draft is imported.
