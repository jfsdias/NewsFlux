# ARTICLE-INTEL-GATEWAY-01 — A2 operational readiness specification

**Status:** DESIGN / READ-ONLY PREFLIGHT — NOT APPROVED FOR RUNTIME IMPLEMENTATION OR DEPLOYMENT  
**Date:** 2026-11-09  
**Repository baseline:** `main@43bcb26989ee8f2f8b28aba23ecdf8017fc54d57`  
**Related architecture PR:** [#201](https://github.com/jfsdias/NewsFlux/pull/201), OPEN/DRAFT when this file was authored  
**Related Content Fallback:** PR [#188](https://github.com/jfsdias/NewsFlux/pull/188), merged, but not connected to the Reader  
**Related roadmap:** PR [#195](https://github.com/jfsdias/NewsFlux/pull/195), separately open/draft  
**Deliverable:** a gated operational specification, not a new container, Docker Compose configuration, migration, secret or NewsFlux feature.

## 1. Intent and non-negotiable constraints

Design a **dedicated LiteLLM control plane** for NewsFlux (option **A2**) because the existing LiteLLM instance serves other clients. Reuse LiteLLM's provider transports, model management and virtual-key support rather than rebuilding them. Preserve the ability to configure **Mistral first**, then Google Gemini, Maritaca, Alibaba-hosted Qwen, OpenRouter, Ollama and other providers from the NewsFlux application.

Option A2 is **preferred for planning, not approved for deployment**. In case the resource and isolation gates fail, return for an architecture decision between shared LiteLLM with proven administrative isolation (A) and a thin NewsFlux backend using maintained SDKs (B). Do not quietly change course or deploy another service.

Never merge, deploy, restart, change image, provision credentials, create DB/users, alter firewalls, enroll paid models or publish an external endpoint without specific approval. Never change the existing `litellm` container or its PostgreSQL database merely because they are available.

Keep **Article Intelligence**, **Content Fallback**, **upstream synchronization**, and **editorial design** in separate PRs and rollout gates.

## 2. Grounded inputs and unknowns

Owner-supplied read-only audits A0.7, A0.8-R2 and A0.9 indicate:

| Fact | Observation | What it does **not** prove |
| --- | --- | --- |
| Shared LiteLLM runtime | v1.110.0; running; image `ghcr.io/berriai/litellm-database:main-latest` (moving tag) | That the same image/version is safe for a new A2 instance |
| PostgreSQL connectivity | `litellm-db` running/healthy; accepts connections on `ai_internal` | LiteLLM application's own DB session or isolation |
| Dynamic model storage | `STORE_MODEL_IN_DB` present; 8 model rows, 10 virtual key rows, 1 user row | Effective admin permission isolation, budgets or encryption integrity |
| Credential configuration | Master key and UI username/password present; salt variable absent | A standalone key-storage security gate; secret decryption or safe rotation |
| Other clients | `trof-ai-service` and `trof-backend` refer to LiteLLM in environment; several containers share `ai_internal` | Complete client inventory or absence of hidden reverse-proxy consumers |
| Proxy networking | Shared instance attached to `npm-proxyyml_default` | Which routes are publicly reachable or protected |

These facts **motivate** A2; they do not imply the shared instance is insecure. The proposed A2 instance must not reuse the shared master key, UI credentials, PostgreSQL database, tables, salt, virtual keys or admin endpoint.

The complete A0 report referenced at `/workspace/newsflux-ai-platform-architecture-a0.md` has **not** been independently available in this session. Do not treat its file hash or conclusions as newly verified.

## 3. Proposed logical topology

```text
Authenticated user / NewsFlux frontend
           |
     HTTPS same origin
           |
    NewsFlux web Caddy
       /api/ai/v1/*
           |
        AI BFF (new)
     authN/authZ, CSRF, entry permission,
     privacy and spend policy, editorial schema
         /       \
        /         \
Article Resolver    Restricted inference identity
   |                         |
Miniflux + approved      newsflux-ai-litellm
Content Fallback             |
  (separate track)       provider routes
                           /        \
                      Mistral     Ollama / future
                            |
                    newsflux-ai database
               (distinct DB identity/schema/backup)
```

**Trust boundaries:**
- Browser ↔ NewsFlux BFF: authenticated and authorized API, not raw LiteLLM or direct provider calls.
- BFF ↔ LiteLLM: private network, dedicated low-privilege inference key for summarization; dedicated management credential **only** on a restricted administrator code path.
- LiteLLM ↔ providers: allowlisted endpoint routing; external egress permitted only for explicitly configured providers. Local Ollama requires a separately approved internal route. Do not accept user-controlled URL or arbitrary `api_base`.
- LiteLLM ↔ database: dedicated database and least-privilege identity. A separate PostgreSQL **server** is optional; a separate logical DB/user is required.
- BFF ↔ Miniflux/Content Fallback: no arbitrary source URL input; entry-scoped authorization and verified content fingerprint must be settled first.

The AI BFF and A2 gateway are separate responsibilities and may require separate runtime PRs. This file creates **neither**.

**Exposure default:** no host-published ports for A2 gateway or DB; no direct connection from public NPM/Caddy to LiteLLM management, Swagger, Admin UI or provider API endpoints. Only a narrowly authenticated NewsFlux AI BFF route may be considered for publication after security gates. A private Docker network alone is not an authorization mechanism.

## 4. Dedicated A2 data store — decision still gated

Two supported topology candidates need capacity and operations evidence before choice:

| Candidate | Pros | Residual risk / approval gate |
| --- | --- | --- |
| **DB1** new isolated PostgreSQL container and volume for NewsFlux AI | Strongest lifecycle and backup separation | Extra RAM/storage/maintenance; backup and restore must be tested |
| **DB2** existing PostgreSQL server with new NewsFlux-only DB, role, permissions and backup target | Conserves resources and reuses existing operations | Shared server resource contention, owner-admin DDL, backup/restore and access isolation not yet proved |

**Do not select DB1 or DB2 implicitly.** First perform read-only host capacity and PostgreSQL dependency audits. Do not run CREATE DATABASE, ALTER ROLE, schema migrations, Compose up, or `docker build` under this readiness PR.

SQLite is not a substitute for LiteLLM PostgreSQL when database-backed models/virtual keys and budgets are required. Redis is **not automatically required** for a single-instance P0 design; assess independently for multi-worker/multi-replica routing, concurrency and rate-limit correctness.

Before recording provider credentials, generate and store a **dedicated, stable** `LITELLM_SALT_KEY` through an approved secret manager and independently generated dedicated master key. Do not recycle or rotate the shared instance's secrets. The A2 salt must be backed up and recoverable as part of encrypted database restore; changing it after model registration risks making stored credentials unreadable.

## 5. Image/version and configuration gate

- Use an **immutable image digest** for the new gateway, selected from a documented, tested release (not `latest` or `main-latest`). The existing 1.110.0 runtime version does not by itself authorize that version for A2.
- Verify image provenance, platform (`linux/amd64` on the OMV host if confirmed), digest, vulnerability status and startup. Name the actual registry digest and version **only after evidence**. No digest is invented in this spec.
- Pin PostgreSQL image/version (if DB1 chosen) and document upgrades and rollback compatibility. Schema migrations must be a controlled one-time operation, not accidental upgrades on every restart. The LiteLLM production documentation describes a separate migration job and `DISABLE_SCHEMA_UPDATE=true` on proxy instances; adapt this to the chosen single-host topology after validating the pinned release.
- Configure `STORE_MODEL_IN_DB=True` only for the dedicated control plane; avoid overlapping model declarations between file and DB unless intentionally reconciled.
- Use explicit request timeouts, output/context caps, bounded concurrency, conservative retry policy and status endpoints. Health checks must verify real readiness without issuing paid inference.
- No use of `latest` for a production image and no auto-update of the A2 image; upgrades use exact approved digest and prestate/rollback.
- Confirm `LITELLM_MODE=PRODUCTION` and redaction/no-payload logging behavior in the chosen image; do not log API keys, article text, raw provider outputs or source URLs with query strings.

## 6. Identity, administrative access and credential lifecycle

**Hard blocker before any UI or public API for key management:** NewsFlux currently stores Miniflux auth in browser state and does not possess a separately authenticated NewsFlux backend principal. The new backend MUST implement independently verified identity and explicit permissions. A trusted identity proxy mechanism/Authelia or OIDC may be evaluated, but none is approved merely because another service already uses it. Forwarded identity headers from untrusted request paths must be rejected.

P0 scope: *deployment administrator* may manage one NewsFlux-owned credential registry. This is **not** a license for every authenticated Miniflux user to manage global provider credentials. Summary requests require independent authorization for a specific entry; if this cannot be proven, the Reader integration remains disabled.

| Function | Permitted authority | Secret boundary |
| --- | --- | --- |
| List provider/model catalog | Authenticated NewsFlux principal with appropriate rights | Metadata only |
| Add/replace/revoke provider key | Verified `ai_admin` | Encrypted server-side, no secret returned, never persisted in browser preferences |
| Add/remove model deployment | Verified `ai_admin`, allowlisted provider and scope | Gateway admin credential never sent to browser |
| Validate connection | Admin + mode-specific consent | Metadata probe by default; separate explicit synthetic inference authorization and cost ceiling |
| Generate article summary | Verified `ai_reader` + **entry access** + effective privacy/budget policy | Dedicated restricted inference key, never master key |

`PUT/PATCH/DELETE` admin operations require CSRF protection when using cookie sessions, explicit authorization, concurrency/idempotency controls and non-secret audit trails. Credential deletion must block on dependent models until an authorized migration is completed.

Use the proposed `/api/ai/v1` routes in [Article Intelligence API contract v1](https://github.com/jfsdias/NewsFlux/blob/docs/article-intel-arch-a2-contract-v1/docs/contracts/ARTICLE_INTELLIGENCE_V1.md), but treat it as a draft until PR #201 is reviewed. Do not publish a route on the basis of this document alone.

## 7. Mistral-first dispatch gate

Mistral is the first target for a **synthetic-only** provider canary, with model and endpoint selected from the operator's verified account inventory. Do not infer currently available models, prices, quotas, retention settings or credits from a marketing page or an existing key.

Dispatch requires independent PASS conditions:

1. Approved Mistral model and exact LiteLLM route, provider attribution and structured-output capabilities.
2. Explicit **paid-inference permission** (if the operation has charge exposure) and configured hard request cap / spend ceiling that fails closed when cost is unknown or unavailable.
3. Approved account privacy/data-use configuration (Mistral training/data processing and zero-data-retention controls cannot be inferred from the key's presence).
4. A standard **synthetic Portuguese journalism** fixture, not a real NewsFlux/Miniflux article.
5. Canonical local output schema with provider-specific reduced transport schema; reject invalid JSON, mismatched paragraphs, incomplete content, unsupported action points, tool calls, and route/model mismatch.
6. Proper cancellation, deduplication, rate limiting, timeout and no automatic paid-provider fallback.
7. Redacted request/response metrics and a deterministic report.

The original Article Intelligence benchmark results (Maritaca HTTP 400 after one request, local Ollama performance limits) are diagnostic only; neither establishes that another provider/model meets the contract.

**No model API calls are authorized by approving this readiness document.**

## 8. Resource and security preflight checklist (read-only first)

| Gate ID | Evidence to obtain (do not print secrets) | Pass condition |
| --- | --- | --- |
| `A2_HOST_CAPACITY` | OMV memory available/swap trends, disk free, CPU headroom, container counts and resource budgets | No unacceptable pressure on Frigate, Miniflux, Home Assistant and existing clients; explicit capacity reservation |
| `A2_RUNTIME_IMAGE` | Tested image immutable digest, runtime version, platform, vulnerabilities | Exact version/digest approved, no floating tags |
| `A2_DATABASE_ISOLATION` | DB1 vs DB2 comparison, ownership/grants, migrations, backup plan | Independent DB/user and reproducible restore proof |
| `A2_NETWORK_ISOLATION` | Docker networks, publish/bind, reverse proxy and egress inventory | No direct public gateway/admin/DB route; BFF-only authorized ingress |
| `A2_SECRET_LIFECYCLE` | Secret manager, master/salt identities, rotation/recovery model | Dedicated master and stable salt, no key in repo/Compose/log/browser |
| `A2_IDENTITY_ADMIN` | Verified admin authN/authZ, impersonation and CSRF negative tests | Deny unauthenticated/non-admin management |
| `A2_ENTRY_AUTHORIZATION` | Session ↔ Miniflux account ↔ accessible entry mapping | Deny cross-account and guessed entry IDs |
| `A2_CLIENT_NON_INTERFERENCE` | Shared LiteLLM client/service inventory and before/after comparisons | Zero shared LiteLLM config/keys/models/DB changes |
| `A2_PRIVACY_RETENTION` | Mistral data settings, operator opt-in, cache/log retention | External article transfer off by default |
| `A2_SPEND_FAIL_CLOSED` | App-level budget checks, LiteLLM key limits and fault injection | No paid request when price/budget/accounting unknown |
| `A2_CONTRACT_TESTS` | Provider adapter fixtures, auth negative cases, schema/timeout/stale response | Contract tests PASS for synthetic flows |
| `A2_BACKUP_ROLLBACK` | Exact prestate, supported backup and restore, rollback rehearsal | Restore data + encryption material without changing shared service |
| `A2_HARNESS_DEVICE` | Browser/Reader workflow, especially Fold 884×1104 | Only when frontend integration later begins |

The next agent should first collect **sanitized read-only host and identity-topology evidence**, then return to PM for topology and auth mechanism approval. Never ask the user to paste a live provider key, master key, DB URL or whole Compose file containing secrets.

## 9. Deployment and rollback procedure (PROPOSED, NOT EXECUTABLE)

**Stage D0 — review:** Record an exact base SHA, approved image digests, DB choice, network diagram, backup plan, credential storage, threat model, test evidence, an explicit deploy approval and return-to-service criteria.

**Stage D1 — isolated build/test:** In a disposable or restricted environment, create only A2-owned resources after authorization. Use synthetic fixtures; test exact image/config, migration single-run, health, DB connectivity, model inventory, authentication/CSRF negatives, budget refusal and secret redaction. No public route.

**Stage D2 — internal integration:** BFF requests through one restricted LiteLLM virtual key; verify Mistral model mapping and an approved synthetic canary. Validate no shared service changes and negative security gates. Avoid real article text until privacy and content-parity gates pass.

**Stage D3 — gated Reader/UI:** A **separate** PR introduces in-app provider management behind verified admin auth; later a **separate** Reader PR consumes the same resolved article snapshot as Content Fallback. Preserve Miniflux original/read/star state and forbid silent model ranking or fallback.

**Rollback:** Disable NewsFlux AI BFF route and model dispatch, return the app to unchanged Miniflux Reader behavior, stop only NewsFlux AI-owned containers by exact identity, and restore **only dedicated** data after a validated backup/restore plan. Do not stop or modify `litellm`, `litellm-db`, Ollama, Home Assistant, Paperless, TROF, Frigate or Miniflux as collateral. Do not remove volumes until explicit operator authorization.

## 10. PR boundaries and developer handoff

| PR | Scope | Dependency |
| --- | --- | --- |
| `ARTICLE-INTEL-ARCH-01` (PR #201) | ADR 0002 and API v1, docs only | Review required |
| `ARTICLE-INTEL-GATEWAY-01` (this spec) | A2 readiness/topology, docs only | Independent draft; **not** runtime implementation |
| `ARTICLE-INTEL-GATEWAY-RUNTIME-01` | A2 isolated Compose, DB, migration, secrets, backups, internal health | Separate approval after all critical gates |
| `ARTICLE-INTEL-AUTH-API-01` | Server identity/admin and article permission middleware | Security review |
| `ARTICLE-INTEL-SETTINGS-01` | In-app provider/key/model controls, no browser persistence of secrets | Auth/API contract approved |
| `ARTICLE-INTEL-MISTRAL-01` | Synthetic canary, structured summary adapter + cost/privacy gates | Auth, gateway and approved model |
| `CONTENT-FALLBACK-READER-01` | Integrate approved PR #188 overlay with Reader | Separate Content Fallback runtime evidence |
| `ARTICLE-INTEL-READER-01` | On-open summarization of canonical resolved snapshot | Separate Reader, auth and provider gates |

Any discovered unrelated bug or UI enhancement is **reported and backlogged**, not fixed incidentally.

### Operational handoff fields

```text
NEWSFLUX_ARTICLE_INTEL_GATEWAY_A2_HANDOFF
BASE_SHA=
HEAD_SHA=
PR=
SCOPE=
A2_HOST_CAPACITY=
A2_RUNTIME_IMAGE=
A2_DATABASE_CHOICE=UNDECIDED
A2_NETWORK_ISOLATION=
A2_IDENTITY_ADMIN=
A2_ENTRY_AUTHORIZATION=
A2_SECRET_LIFECYCLE=
A2_PRIVACY_RETENTION=
A2_SPEND_FAIL_CLOSED=
A2_CLIENT_NON_INTERFERENCE=
A2_BACKUP_ROLLBACK=
CODE_GATE=
HARNESS_GATE=
REAL_DEVICE_GATE=
RESIDUAL_RISKS=
READY_FOR_RUNTIME_PR=NO
MERGE_AUTHORIZED=NO
DEPLOY_AUTHORIZED=NO
```

## 11. Sources and limitations

- LiteLLM production deployment, image, PostgreSQL, Redis and one-time migration guidance: https://docs.litellm.ai/docs/proxy/deploy
- LiteLLM model persistence and encryption fallback: https://docs.litellm.ai/docs/proxy/ui_credentials
- LiteLLM virtual keys / spend controls: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM Admin UI configuration: https://docs.litellm.ai/docs/proxy/ui
- LiteLLM production settings and logging: https://docs.litellm.ai/docs/proxy/prod
- NewsFlux PR #201 proposed architecture and contract: https://github.com/jfsdias/NewsFlux/pull/201
- NewsFlux Content Fallback PR #188: https://github.com/jfsdias/NewsFlux/pull/188

No OMV inspection was performed for this document. Real-world resource limits, auth proxy topology, secrets manager, DB1/DB2 preference, current provider pricing, runtime version compatibility, model availability, Mistral account privacy and actual gateway routes remain **UNVERIFIED**.
