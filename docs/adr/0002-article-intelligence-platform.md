# ADR 0002 — Article Intelligence platform and provider management

- **Status:** PROPOSED — A2 is the PM-preferred planning direction; no deploy or functional implementation approval
- **Date:** 2026-11-09
- **Scope:** Article Intelligence only; documentation and interface contracts
- **Decision owner:** NewsFlux project manager
- **Evidence baseline:** GitHub main `43bcb26989ee8f2f8b28aba23ecdf8017fc54d57`; operator-reported A0, A0.7, A0.8-R2, and A0.9 observations

## Problem and constraints

NewsFlux is currently a browser frontend accessing Miniflux, without an established NewsFlux backend identity. Reader uses the Miniflux entry content and does not yet call the merged Content Fallback Service (PR #188). The roadmap for on-open summaries lives separately in draft PR #195. These tracks must not share a functional PR.

The owner requires model/provider selection and API key management **inside the NewsFlux application**; first implementation priority is Mistral, with future Google Gemini, Maritaca, Alibaba Qwen, OpenRouter, Ollama and other compatible providers. Do not create a bespoke multi-provider inference transport, vault, or router while a maintained solution satisfies the requirements.

Miniflux remains the source of truth for entry identity, source URL, feeds, categories, read and star status. Content Fallback is a read-only presentation overlay and must not mutate Miniflux data.

## Observed environment, not deployment approval

Operator-provided read-only audits report the shared LiteLLM container at version **1.110.0**, PostgreSQL reachable on network `ai_internal`, `STORE_MODEL_IN_DB` configured, **8 model rows, 10 virtual-key rows, 1 user row**, and **0 rows** in the specific credentials and budgets tables counted. The container also joins `npm-proxyyml_default`. Other services share the AI network; some explicitly reference LiteLLM. These observations do not establish which models/keys are active, which clients use them, or the effectiveness of permissions, logging, budgets, decryption, and proxy controls.

The shared installation has a master key and UI credentials; `LITELLM_SALT_KEY` was absent in its inspected environment. LiteLLM documents a master-key fallback for database-encrypted provider credentials when the salt is absent. **Never add a salt, rotate a key, or change the shared deployment as part of this ADR.** Preserved credentials may depend on the existing key.

The full A0 report, referenced by the operator at `/workspace/newsflux-ai-platform-architecture-a0.md`, was not available for independent inspection in this planning session. Treat its unverified details as reported, not independently tested.

## Candidate architectures

| Option | Decision | Rationale |
| --- | --- | --- |
| A — Reuse shared LiteLLM for NewsFlux administration | HOLD | Minimizes containers, but admin/configuration changes could affect existing clients; role isolation and blast radius remain unproven |
| **A2 — Dedicated LiteLLM control plane for NewsFlux** | **PREFERRED FOR DESIGN** | Reuses mature provider adapters and model/credential management, with separate admin key, encryption key, DB identity, models, spend controls, and lifecycle |
| B — Thin backend using maintained SDKs directly | CONTINGENCY | Avoids a second LiteLLM deployment if A2 fails resource/security gates, but requires additional secret/model management |
| C — Browser calls providers directly | REJECT | Provider secrets and model administration must not be exposed to browser storage, bundles, URLs or network responses |

**Preferred decision:** design a dedicated LiteLLM instance behind a thin, authenticated NewsFlux AI backend. A2 is conditional on resource, image, DB, authentication, authorization, encryption, backup, telemetry, and network gates. This document does **not** authorize provisioning or a new database.

The gateway will handle provider-specific transport, costs and routing. The NewsFlux backend owns article authorization, editorial prompts, canonical summary validation, policy, spending prechecks, and stale-response protection. The browser owns presentation, not credentials or provider protocol details.

## P0 identity and credential boundary

1. The NewsFlux AI backend must establish its **own verified principal and administrator authorization**. Current browser-side Miniflux credentials or a frontend-provided user ID are **not** an adequate authorization proof. Choose and validate OIDC or a carefully secured trusted reverse-proxy identity mechanism in a separate identity design gate. Reject requests without validated identity. Never trust identity headers received directly from the Internet.
2. P0 may be **deployment-admin-managed** (one authorized administrative scope), not per-user BYOK. The app must still enforce that the requesting principal is authorized to read the particular Miniflux entry; a server-wide Miniflux token must not accidentally expose another account's entries. If this mapping cannot be proven, summarize-on-open stays disabled.
3. API keys are entered temporarily in an authenticated NewsFlux settings form and transported over HTTPS to the backend, with explicit CSRF protection where cookie sessions are used. Do not persist API keys in `localStorage`, nanostores, browser export/import, telemetry, errors, request URLs, repository or source maps.
4. The management backend may use a **dedicated A2 management credential** over a private route. Inference must use a separate restricted virtual key allowing only approved models/routes. Never send LiteLLM master keys to browsers. Never expose the LiteLLM admin UI or management endpoints via the NewsFlux public reverse proxy.
5. Dedicated LiteLLM should have a new, stable `LITELLM_SALT_KEY` established **before** any models/credentials are added, separately backed up with controlled access. Pin image by approved immutable digest; do not deploy a moving `latest` image. Dedicated PostgreSQL database/user and private volumes are required, even if a shared PostgreSQL *server* is reused following an isolation gate.
6. Only the backend may implement add/replace/test/revoke credentials; responses contain opaque IDs, provider identifiers, masked hints and statuses — **never secret values**. Prevent cross-provider/cross-principal writes. Revoke operations must check dependent models, fail closed and support rollback.
7. Provider API base URLs are chosen from server-maintained allowlists. An arbitrary browser-supplied proxy URL, inference endpoint or article URL must not be accepted. Local Ollama is accessed only over an approved internal origin with SSRF and authorization controls.

## Model and provider behavior

- Model identity is `(provider_id, deployment_id, model_id)`; the same family (e.g., Qwen) may be hosted by Alibaba, OpenRouter or local Ollama with different policy and costs.
- Prioritize **Mistral** as the first independently authorized synthetic adapter. No paid inference without an explicit budget and user authorization. Future providers use the same NewsFlux contract; model capabilities (JSON schema, streaming, context, pricing, retention, tooling) are versioned and tested per route, not assumed.
- Use Chat Completions as the initial gateway transport where compatible, with adapter-specific feature negotiation. Structured outputs are validated against a **NewsFlux canonical schema locally**; provider transport schemas may be reduced to the provider's supported subset. For example, Maritaca's schema dialect needs separate compatibility evidence.
- All tool/function calls are disabled for article summarization in P0. External web browsing and publisher requests must not be initiated by the LLM provider adapter.
- No silent fallback. A configured fallback route may run only after explicit permission, privacy compatibility and a cost ceiling. Unknown prices, unknown account settings or missing budget status must fail closed rather than trigger paid calls.
- Provider connection checks have two distinct actions: metadata-only connectivity (no inference) and a separately authorized synthetic inference canary (may consume tokens).

## Article Content Resolver dependency

The single content resolver must return an authenticated, versioned snapshot tied to Miniflux entry ID, title, URL/content fingerprints, feed, publication time, completeness status, origin, and stable paragraph IDs. It uses Miniflux content first and the approved Content Fallback overlay only according to explicit feed/domain policies. It must verify Content Fallback response identity and fingerprint again after asynchronous recovery.

Reader and Article Intelligence must use the **same resolved snapshot**; never summarize a recovered text while displaying an unrelated or stale Miniflux version. Reader integration is a **separate PR** from provider management and model inferencing.

Only the entry ID and an opaque request ID/profile choice are accepted from the browser; backend fetches and authorizes article content. No arbitrary article URLs or article bodies in the public summary request.

Article text is untrusted prompt data, not instructions. Paragraph references must resolve to the exact snapshot. Incomplete articles must be represented as partial/insufficient, not falsely presented as whole-article summaries. Article content may be transmitted to paid providers only after the configured privacy and retention policy is approved.

## Data handling and reliability

- Default: **summarize-on-open disabled**, no automatic paid inference, no persistent article/summary cache, no provider fallback.
- Set explicit input/output token caps, request timeout, bounded concurrency, request-level deduplication, cancellation semantics, and operator-approved spend ceilings. Treat budget enforcement as defense in depth: LiteLLM controls plus an app-level pre-dispatch fail-closed limit.
- Any future summary cache must be separately authorized and scoped by principal, entry fingerprint, content provenance, prompt/schema version, provider deployment and model; specify retention and deletion first.
- Logs must omit article text, provider secret values, model response body, source URLs with query strings and credential material; emit only sanitized request ID, operation, status, model identity, coarse timings, cost/accounting status and provenance metadata.
- Never assert factual correctness solely because a response satisfies JSON Schema. Validate reference IDs and deterministic invariants; retain conservative abstention for unsupported factual claims.
- A late response must never overwrite the active article after navigation or session change. No write-back to Miniflux content or read/star state.

## Gates before any runtime PR

1. **Resource/topology:** independent A2 name, DB/user, image digest, volumes, networks, startup, capacity, backup/restore, deploy and rollback plan; no changes to the existing `litellm` container or its DB.
2. **Identity/authorization:** authenticated NewsFlux administrative principal, entry-level content authorization, CSRF, endpoint access control, session revocation, admin/read split.
3. **Secrets:** encryption/backup and rotation threat model; no plaintext in logs/exports; canary proves masking and protected management routes.
4. **Budget/privacy:** Mistral account terms/settings, explicit paid authorization and limits, retention policy, opt-in before sending real article text.
5. **Provider contract:** synthetic tests of schema negotiation, unknown model, 4xx/429/timeout, JSON invalidity, incomplete content, stale article/session, streaming interruption, forbidden tools and budget failures.
6. **Content parity:** independent Content Fallback runtime/device tests before on-open UI; same snapshot in Reader and summary.
7. **Delivery:** separate documentation, gateway, API, settings, Mistral, and Reader PRs; each specifies BASE/HEAD, files, code/harness/device gates, residual risks. No merge or deployment without owner authorization.

## Sequencing and separation

1. ARTICLE-INTEL-ARCH-01: this ADR and proposed API contract, **docs only**.
2. ARTICLE-INTEL-GATEWAY-01: isolated A2 infrastructure on an approved branch after topology gates.
3. ARTICLE-INTEL-API-01: identity, server-side credential/model management contract.
4. ARTICLE-INTEL-SETTINGS-01: provider/key/model configuration in NewsFlux.
5. ARTICLE-INTEL-MISTRAL-01: first approved synthetic Mistral path with cost/privacy gates.
6. CONTENT-FALLBACK-RUNTIME-01 and CONTENT-FALLBACK-READER-01: independent content track.
7. ARTICLE-INTEL-READER-01: on-open summary only after content snapshot parity and backend protections.

These are dependencies, not permission to execute or merge later PRs. Do not mix upstream sync, redesign, or Content Fallback behavior into Article Intelligence PRs.

## References

- LiteLLM model persistence/encryption: https://docs.litellm.ai/docs/proxy/model_management
- LiteLLM deployment and immutable image guidance: https://docs.litellm.ai/docs/proxy/deploy
- LiteLLM virtual keys and route permissions: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM budget prerequisites: https://docs.litellm.ai/docs/proxy/users
- LiteLLM authentication models: https://docs.litellm.ai/docs/proxy/authentication
- Content Fallback contract: https://github.com/jfsdias/NewsFlux/blob/43bcb26989ee8f2f8b28aba23ecdf8017fc54d57/services/content_fallback/README.md
- Existing browser auth: https://github.com/jfsdias/NewsFlux/blob/43bcb26989ee8f2f8b28aba23ecdf8017fc54d57/src/store/authState.js

## Decision log

- **2026-11-09:** PM selected A2 for **documentation/planning only**, on the basis of A0.7/A0.8/A0.9 observations. Full runtime gate, identity model and spending/privacy policy **remain open**.
- **MERGE / DEPLOY:** not authorized.
