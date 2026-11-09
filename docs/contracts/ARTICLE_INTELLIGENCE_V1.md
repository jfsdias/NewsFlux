# Article Intelligence — proposed API contract v1

- **Status:** PROPOSED / DOCUMENTATION ONLY
- **Reference ADR:** [ADR 0002](../adr/0002-article-intelligence-platform.md)
- **Initial provider:** Mistral, pending privacy/cost authorization
- **Future providers:** Google Gemini, Maritaca, Alibaba Qwen, OpenRouter, Ollama local and subsequent adapters
- **No running API, migrations, provider requests, secret storage or UI are created by this document.**

## Version and identity

All routes below are **proposed**, not implemented. Namespace: `/api/ai/v1`. Requests and responses are JSON over authenticated HTTPS, with bounded body sizes and a strict versioned contract. API server identity is NOT inherited implicitly from the existing browser-to-Miniflux session.

The backend derives `principal_id`, `tenant_scope`, authorization and allowed entry IDs from a verified session. Browser-provided IDs, HTTP headers or Miniflux credentials by themselves cannot grant NewsFlux AI permissions. Roles for P0:

| Role | Allowed |
| --- | --- |
| `ai_admin` | Manage providers, models, credentials, budget/policies; review status |
| `ai_reader` | Request an authorized article summary if enabled; view only its own returned summary |
| Anonymous or unverifiable | Nothing |

P0 may implement only the deployment-admin account. A multi-user production release requires an explicit account-to-Miniflux-entry authorization model and tenancy tests first. Do not create a guest bypass.

Use secure, HttpOnly, SameSite cookies for cookie-based sessions plus origin/CSRF validation on mutations; or implement a reviewed OIDC/BFF design. Which authentication mechanism is selected remains **GATED**. The backend denies requests if the scheme is not established.

## Provider registry and status

A provider descriptor includes `provider_id`, `display_name`, `transport`, `authentication_mode`, `capabilities`, `available_models`, `health_state`, `privacy_status` and `configured`. It must never include a credential value or a full arbitrary API endpoint.

Canonical IDs proposed for the registry:

| ID | Meaning | Initial state |
| --- | --- | --- |
| `mistral` | Mistral direct provider | First implementation, pending approved canary |
| `google` | Gemini through Google | Contract only |
| `maritaca` | Maritaca direct | Contract only; schema adapter pending evidence |
| `qwen_cloud` | Alibaba-hosted Qwen | Contract only; region policy required |
| `openrouter` | OpenRouter aggregator | Contract only; route/provider metadata must be verified |
| `ollama_local` | Approved internal Ollama | Contract only; no browser-configured base URL |

`GET /providers` — authenticated list of safe provider descriptors. `GET /models?provider_id=mistral` — allowed model catalog: per-model context/capability/cost metadata where verified; unknown values must remain unknown. A selectable model key is `(provider_id, deployment_id, model_id)`; the registry must not confuse provider routing with model families.

Return health as `unconfigured|configured_unverified|ready|degraded|disabled`. A 200 catalog response or a configured key does not imply a successful inference.

## Administrator credential and model management

All endpoints under `/admin/` require an independently verified `ai_admin` principal. Never proxy arbitrary LiteLLM management paths and never return the A2 LiteLLM master key, provider API keys or bearer credentials.

| Proposed route | Intent |
| --- | --- |
| `GET /admin/credentials` | Masked inventory scoped to NewsFlux deployment |
| `POST /admin/credentials` | Register a provider credential; one-time input, server-side persistence |
| `PUT /admin/credentials/{credential_id}` | Controlled replacement; old value never returned |
| `DELETE /admin/credentials/{credential_id}` | Revoke, after dependent-model guard and explicit confirmation |
| `GET /admin/model-deployments` | Effective NewsFlux gateway model mappings |
| `POST /admin/model-deployments` | Create one allowlisted deployment with credential reference |
| `PATCH /admin/model-deployments/{deployment_id}` | Update allowed deployment metadata |
| `DELETE /admin/model-deployments/{deployment_id}` | Disable/remove only NewsFlux-owned deployment |
| `GET /admin/policy` | Effective summarization, budget, fallback and privacy policy |
| `PUT /admin/policy` | Versioned update with precondition/rollback |
| `POST /admin/connections/check` | Metadata-only connection check by default |

Example registration request (placeholders, not real secrets):

~~~json
{
  "provider_id": "mistral",
  "label": "NewsFlux Mistral",
  "api_key": "OPERATOR_ENTERED_SECRET"
}
~~~

Example safe reply:

~~~json
{
  "credential_id": "cred_opaque",
  "provider_id": "mistral",
  "label": "NewsFlux Mistral",
  "configured": true,
  "masked_hint": "••••",
  "verification": "not_tested",
  "secret_returned": false
}
~~~

The browser must not retain the submitted value in settings state, localStorage, persistence/export APIs, logs or crash reports. The `masked_hint` must be non-reversible and must not encode a significant portion of the secret. Server authentication and authorization are prerequisites for these routes, not subsequent enhancements.

`POST /admin/connections/check` with `mode=metadata_only` must make **no inference request**. A `mode=synthetic_inference` test requires separate explicit operator consent, a safe fixture and a cost ceiling. Invalid credentials must not be echoed in errors. Restrict rate, concurrency and retries for both paths.

Every admin mutation needs idempotency/precondition handling, an audit event without secrets, and a documented recovery path. Deleting or rotating a credential used by a model deployment should be blocked until its dependency is resolved. A2 management endpoint permissions must not affect the existing shared LiteLLM installation.

## Settings and policy

The settings UI controls provider/model choice, credentials, model policy, connection test, paid inference opt-in, fallback, privacy status and budgeting **inside NewsFlux**.

Proposed settings reply:

~~~json
{
  "schema_version": "1",
  "summarize_on_open": false,
  "primary_deployment_id": null,
  "fallback_deployment_ids": [],
  "fallback_enabled": false,
  "allow_paid_inference": false,
  "allow_external_article_transfer": false,
  "request_token_limit": null,
  "monthly_spend_limit": null,
  "retention_policy": "no_persistent_summaries",
  "revision": 1
}
~~~

Unknown costs or unenforceable budgets block paid dispatch, even if LiteLLM itself is reachable. The app-level pre-dispatch check and LiteLLM budget enforcement are independent safeguards. The system must distinguish monetary limits from throughput (RPM/TPM) limits. No automatic paid fallback and no inference while the account's data-use and retention settings are unreviewed.

Provider-specific privacy disclosures must state whether article text is sent externally. Ollama-local must be a distinct policy from Qwen cloud: choosing a model family does not imply that execution is local.

## Article summarization

`POST /entries/{entry_id}/summary`

Allowed request body:

~~~json
{
  "schema_version": "1",
  "request_id": "opaque-client-correlation-id",
  "profile_id": "editorial-default"
}
~~~

Do not accept client-supplied article URLs, article HTML, paragraph content, arbitrary provider base URLs, credentials, authority claims, or model prompts. The backend checks the session and the requested entry's authorization, resolves the effective article snapshot using Miniflux and the gated Content Fallback overlay, then dispatches the bounded editorial operation. The only client-level model selection allowed is an identifier already authorized by the administrator policy (not an arbitrary endpoint). Data may leave the host only under an enabled privacy policy.

The resolver returns, internally, `entry_id`, `content_fingerprint`, `source_fingerprint`, `content_origin`, `completeness`, `paragraphs[{id,text}]` and a session/entry revision. These values are **not** accepted as authoritative from the browser. When Content Fallback is unsuccessful, expose `partial` or `insufficient` instead of silently claiming full content. Reference IDs are stable only within a particular snapshot.

Proposed validated result:

~~~json
{
  "schema_version": "1",
  "request_id": "opaque-client-correlation-id",
  "entry_id": 12345,
  "status": "complete",
  "content_scope": "full",
  "summary": "A source-grounded summary.",
  "key_points": [
    {
      "text": "A source-supported point.",
      "paragraph_ids": ["p2", "p4"]
    }
  ],
  "action_points": [],
  "limitations": [],
  "provenance": {
    "content_origin": "miniflux",
    "content_fingerprint": "opaque-digest",
    "provider_id": "mistral",
    "deployment_id": "opaque-deployment",
    "effective_model_id": "verified-model",
    "prompt_version": "editorial-v1"
  }
}
~~~

`status`: `complete|partial|insufficient|unavailable`. A provider or gateway transport failure returns a safe failure code, not an invented summary. `content_scope`: `full|partial|unknown`. Do not mark a response complete if source completeness or paragraph evidence is insufficient. Action points may be empty and must be explicit only where the article supports them; do not generate speculative to-dos.

Stable paragraph ID validation, structured response size limits, link-free rendered text, and source-versus-summary coverage are separate tests. Passing JSON Schema is **not proof of factual grounding**. The canonical JSON Schema (versioned, strict locally) is a NewsFlux artifact to be authored and tested in the implementation PR. The provider transport schema is negotiated per route/capability; no assumption that full JSON Schema features work in every provider.

Tool use, web searches by the model and external functions are disabled in P0. Treat text extracted from publishers as untrusted prompt data (prompt-injection boundary). Limit input length and output tokens before dispatch. Sanitize provider errors; do not return full article contents through these API errors.

## Cancellation, consistency and error semantics

- Each request binds to a server-verified principal, Miniflux entry ID, session revision, snapshot fingerprint, policy revision, deployment and prompt/schema version.
- If the user navigates to another article, changes session, or an article snapshot changes while processing, the result must not replace the active Reader's content/summary. Cancellation must release resources when practical; stale results must be discarded.
- Idempotency deduplicates safely by principal, request ID, content fingerprint and policy revision; never reuse a cached summary across principals without a separate security decision.
- No persistent article or summary store in P0. Request-scoped computation may exist, bounded in time and memory. Content Fallback's independent bounded store retains its own existing policy; do not merge caches.

Error envelope:

~~~json
{
  "schema_version": "1",
  "request_id": "opaque-client-correlation-id",
  "error": {
    "code": "PROVIDER_UNAVAILABLE",
    "retryable": false
  }
}
~~~

Suggested codes: `UNAUTHENTICATED` (401), `NOT_AUTHORIZED` (403), `ENTRY_NOT_ACCESSIBLE` (404), `STALE_SNAPSHOT` (409), `INVALID_REQUEST` (422), `PRIVACY_GATE_CLOSED` (403), `BUDGET_GATE_CLOSED` (429), `PROVIDER_UNAVAILABLE` (503), `SOURCE_INSUFFICIENT` (422), and `INFERENCE_DISABLED` (403). HTTP mappings and retry policies require implementation tests; do not expose raw provider bodies, keys, tokens, paywalled text, or database errors.

## Required test contracts

| Gate | Required evidence |
| --- | --- |
| IDENTITY_ADMIN | Unauthorized users cannot list/add/replace/revoke credentials or change budgets |
| IDENTITY_ENTRY | User cannot summarize/read another principal's entry, including guessed IDs |
| CSRF_ORIGIN | Cross-origin cookie-authenticated writes denied; untrusted identity headers denied |
| SECRETS | API key never appears in API readback, browser persistence/export, logs, traces or exception bodies |
| PROVIDER_REGISTRY | Mistral-first, additional providers can be registered without Reader changes |
| INFERENCE_TRANSPORT | Synthetic fixture, correct model and provider attribution, bounded tokens and cost |
| PROVIDER_SCHEMA | Unsupported provider keywords stripped only in transport schema; canonical local validation still strict |
| PRIVACY | External article transfer disabled by default; account data-use policy checked before authorization |
| BUDGET | Paid inference/fallback fails closed on unknown price, absent limits or accounting failure |
| READ_PARITY | Reader and summary reference same entry/fingerprint/content origin |
| STALE_SESSION | Navigation/logout/content refresh discards stale async result |
| SAFETY | No arbitrary URLs, SSRF, model tool use, article prompt instructions or source text in errors |
| DEPLOY | No shared LiteLLM service changes; A2 exact image/DB/rollback and protected routes verified |
| PRESENTATION | Mobile/tablet/Fold Reader works without layout regression; disabled summary retains original UX |

## Separation of implementation PRs

1. **Architecture ADR and contracts (this document):** no runtime changes.
2. **Gateway infrastructure:** dedicated A2, DB, network, exact image pin, backup/rollback.
3. **Backend administration:** authenticated route implementation and secret/model integration.
4. **NewsFlux settings:** UI after admin contract gates.
5. **Mistral adapter:** synthetic tests first and paid/privacy authorization.
6. **Content Fallback ↔ Reader:** independent behavior PR after approved live runtime tests.
7. **Article Intelligence ↔ Reader:** after all dependencies, never bundled with upstream sync or redesign.

No downstream PR, merge, model call or production deploy is implicitly authorized by acceptance of this contract.

## External specifications

- LiteLLM model administration: https://docs.litellm.ai/docs/proxy/model_management
- LiteLLM virtual keys and route authorization: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM authentication: https://docs.litellm.ai/docs/proxy/authentication
- LiteLLM budgets and limits: https://docs.litellm.ai/docs/proxy/users
- LiteLLM production deployment: https://docs.litellm.ai/docs/proxy/deploy
- Existing NewsFlux Content Fallback API: https://github.com/jfsdias/NewsFlux/blob/43bcb26989ee8f2f8b28aba23ecdf8017fc54d57/services/content_fallback/README.md
