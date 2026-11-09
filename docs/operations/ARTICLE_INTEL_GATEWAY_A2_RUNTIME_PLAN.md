# ARTICLE-INTEL-GATEWAY-01 — A2 isolated runtime plan

- **Status:** PROPOSED — DOCUMENTATION ONLY. No implementation, provisioning, inference, merge or deployment authorized.
- **Date:** 2026-11-09
- **Owner:** NewsFlux PM
- **Target repository:** `jfsdias/NewsFlux`
- **Verified initial main/base SHA:** `43bcb26989ee8f2f8b28aba23ecdf8017fc54d57`
- **Architecture dependency:** draft [PR #201](https://github.com/jfsdias/NewsFlux/pull/201), ADR 0002 and Article Intelligence Contract v1. Because #201 is open, its documents are not yet in `main`; this plan must be reconciled against its reviewed version before any runtime PR.
- **Boundary:** Do not edit Content Fallback PR #188, draft roadmap PR #195, `Content.jsx`, `ArticleDetail.jsx`, Caddyfile, shared LiteLLM, upstream sync, production Compose, or UI redesign in this planning step.

## 1. Executive decision

Use **architecture A2 as a design hypothesis**: a dedicated LiteLLM deployment with its own database identity, secrets, management boundary and operational lifecycle, called by a thin NewsFlux AI backend. Prioritize Mistral for the first *separately authorized synthetic* adapter. Keep provider/model/route registry generic for Google Gemini, Maritaca, Alibaba Qwen, OpenRouter and Ollama local.

**Fail closed:** A2 is not deployable until capacity, identity/authorization, database isolation, secret custody, administrative route isolation, egress, cost/privacy and rollback gates pass. Revisit a safely shared LiteLLM instance (A) or maintained direct SDKs (B) only if A2 proves infeasible. Do not confuse a successful container health check with an authorized production service.

### Evidence already available (operator-read-only reports, not independently re-executed)

| Area | Reported evidence | Remaining uncertainty |
| --- | --- | --- |
| Shared gateway | `litellm` 1.110.0, image `ghcr.io/berriai/litellm-database:main-latest` | Release integrity, effective proxy/admin policy, current readiness |
| Shared database | `litellm-db` healthy, PostgreSQL reachable; 8 model rows, 10 virtual-key rows, 1 user row | DB grants, encrypted model credentials, spend enforcement, whether app can query |
| Shared secrets | Master key, UI username/password set; independent salt absent in inspected environment | Effective encryption at rest and safe key migration |
| Networks | `ai_internal`, `npm-proxyyml_default`; multiple clients/peers | Proxy exposure, complete client inventory, trust boundaries |
| NewsFlux auth | Direct browser-to-Miniflux auth stored client-side | No independently validated NewsFlux AI backend principal |
| Content | Content Fallback backend merged in PR #188 | No Reader/content-snapshot parity or approved live publisher recovery |

**Protect the shared installation.** Never change its master key, salt, DB schema, roles, models, volumes, networks, image or clients under A2 work. No assumptions about which stored credentials are encrypted or which tables are authoritative solely from row counts.

## 2. Logical topology (design, not deployed)

```text
Browser NewsFlux
  | HTTPS authenticated session; no LiteLLM key
  v
NewsFlux AI Backend /api/ai/v1
  | verify principal/role/CSRF/entry access; control transfer and spend
  | dedicated restricted inference credential (for summary)
  | separate admin-side integration (for provider management)
  v
Private NewsFlux AI application network
  |
  +-- Dedicated LiteLLM instance (single replica P0)
        |-- private, separate PostgreSQL database + least-privilege DB user
        |-- dedicated, immutable master + salt key (custodied separately)
        |-- egress to explicitly approved provider origins
        +-- future approved internal Ollama route (not shared by default)

Independent content path:
Miniflux -> [Content Fallback after its gates] -> verified ArticleSnapshot
              -> Reader and summary request use identical snapshot identity
```

Do **not** attach the dedicated LiteLLM proxy to the existing `ai_internal` or `npm-proxyyml_default` merely for convenience. No direct browser access to the LiteLLM proxy, DB, Admin UI or management API. Only the NewsFlux AI backend may be reachable behind a reviewed HTTPS route. Authentication via the existing Miniflux browser token alone is **not** established as safe backend identity.

### Proposed deployment inventory (names are placeholders, not discovered paths)

| Component | Proposed purpose | Control |
| --- | --- | --- |
| `newsflux-ai-api` | authenticated thin BFF/API, authorization and editorial contract | only browser-facing route; avoid new public host ports |
| `newsflux-ai-litellm` | isolated gateway/model+credential control plane | no public port, UI/admin routes blocked from untrusted clients |
| `newsflux-ai-postgres` **or** isolated DB/user on an existing PostgreSQL *server* | persistent model/config/virtual key/spend data | separate database, role and migrations from all current DBs |
| `newsflux-ai-db-internal` | gateway-to-database Docker network | `internal:true` and no external port mappings |
| `newsflux-ai-backend-internal` | backend-to-gateway communication | no public route to gateway |
| `newsflux-ai-egress` | constrained outbound gateway route for providers | explicitly reviewed DNS and egress restrictions; do not claim Docker networks are a full egress firewall |
| `newsflux-ai-secrets` (conceptual) | root-only secret volumes or a reviewed secret manager | no keys in Compose YAML, Git, runtime reports or browser storage |

A gateway cannot be **only** on an `internal:true` network and still reach Mistral externally. Therefore isolate the DB on an internal network and explicitly review outbound routing/allowlisting for the gateway. Ollama access, if later permitted, must use a separate approved internal path; do not allow browser-chosen endpoint URLs.

The host is an existing OMV Docker deployment. The canonical NewsFlux app remains managed under `/dockerdata/compose/newsflux`, with its separate exact-SHA deployment policy. The location and Compose project name of a **future** AI stack are intentionally **not** selected until the operator audits filesystem, available resources and service naming conflicts. Do not modify the original production Compose as an incidental shortcut.

## 3. Runtime and resource gate (PRESTATE before any new image pull)

**Read-only collection required**, with sanitized output:

- Host OS/architecture, Docker version, Docker Compose version, daemon default security configuration.
- RAM total/available, swap pressure, CPU load, disk free/inodes and Docker disk pressure. Previous host incidents involved disk capacity; do not rely on old free-space samples.
- Which containers and networks are live, and any name/port/subnet collision with proposed A2.
- Current `newsflux`, `litellm`, `litellm-db` container identities, restart counts, digests and resource use as *baseline*, never a change target.
- Existing PostgreSQL server capacity/configuration and ability to provision a distinct database and user without granting access to any existing database; dedicated PostgreSQL container is allowed only after the footprint comparison.
- Backup destination capacity, restore rehearsal environment, storage ownership and permissions.
- If any secret path or config must be read, report key *presence* and permissions only. Never print environment values, Docker inspect `Env` arrays, DSNs, passwords, keys, or provider payloads.
- Check whether host egress controls can restrict Mistral and future provider domains, DNS behavior, redirects and localhost/private network access. Treat lack of egress isolation as a security finding.

**Admission:** choose architecture A2 only when memory/disk and rollback budgets are measured and accepted; no unilateral `docker pull`, `compose up`, volume creation, DB creation, host firewall change or package installation at this gate.

## 4. Immutable image, migrations and database ownership

1. Select a LiteLLM release supported by upstream documentation and verify exact published image digest, runtime compatibility, and its security status. The shared `main-latest` image is *not* a release policy for A2. Record `IMAGE_REFERENCE`, `IMAGE_DIGEST`, `LITELLM_VERSION`, `DB_SCHEMA/MIGRATION_VERSION` before staging.
2. One authority for A2's model registry: **database-backed model management**. Keep infrastructure configuration in immutable config and models in the DB; avoid simultaneous file-defined models that are uneditable from NewsFlux.
3. Generate and retain distinct A2 master and salt keys **before first credential**, stored with access control and encrypted backup. Salt is non-rotatable in place under the documented flow; plan restore and explicit credential re-entry rather than editing it casually.
4. Create a distinct PostgreSQL database with an isolated role, bounded connections, grants only to its own DB and an approved migration role. Do not reuse the shared LiteLLM database or role. Decide on a dedicated Postgres container versus existing server only after examining grants, operational dependencies and capacity.
5. Run migrations as an explicit **one-shot preflight/upgrade action** against the A2 database and with reviewed version; don't run them against the shared schema. For normal serving use `DISABLE_SCHEMA_UPDATE=true` only after a migration job is provisioned and verified. On first bootstrap, configure initial schema deliberately; never disable migration without an alternative.
6. Isolated staging uses synthetic placeholder provider credentials and fake HTTP provider(s); production provider credentials entered via the reviewed administrative flow only.
7. Prestate+poststate: record exact A2 container image ID, database schema, masked model count, keys and backup hashes. Never log secret values.

Official deployment reference: https://docs.litellm.ai/docs/proxy/deploy and https://docs.litellm.ai/docs/proxy/ui_credentials

## 5. Authentication and management boundary — blocking design choice

**Before implementing a credential settings form**, choose a NewsFlux AI backend identity mechanism. Current NewsFlux auth state in the browser is not an authorization system for the new backend.

Acceptable candidate for audit: existing Authelia OIDC with an Authorization Code + PKCE flow and backend session, or a rigorously authenticated reverse-proxy identity boundary with unforgeable headers and direct access blocked. This is a candidate only; present availability and OIDC client/grants are **unverified**. If neither meets the requirements, API management remains disabled.

Minimum controls:

- Backend verifies principal, session, administrator role, CSRF (for cookie sessions), same-origin/proxy trust boundary, expiry, logout, rate limits and per-entry authorization.
- Admin route allowlist; LiteLLM management API and master key accessible only by the NewsFlux backend administrative component. The *inference client* uses a separate restricted key, allowlisted model IDs and limited routes. Do not derive admin keys from inference keys.
- Reject any client-supplied `user_id`, private API base URL, SQL/DB connection string, arbitrary article URL, provider key ID outside the NewsFlux-owned registry, or arbitrary LiteLLM management path.
- No per-user BYOK in P0 without verified tenant-to-entry mapping. A deployment-admin-managed credential scope is the only candidate for initial configuration.
- Database `proxy_admin` and Admin UI permissions are separated from NewsFlux UI authentication; the LiteLLM Admin UI is not directly published.
- Credential create/replace/revoke operations are audit-trailed without secret values and fail closed if dependent models or transaction outcomes cannot be reconciled.
- Avoid a long-lived cached admin key in any browser session, trace or static resource.

Blocking deliverable: **AUTH_DECISION_RECORD** with effective identity design, API permission matrix, negative tests, security review and logout behavior. No AUTH approval => no admin UI, no provider onboarding, no article transfer.

## 6. Secrets, backup, recovery and key lifecycle

- A2 secrets: distinct `MASTER_KEY`, `SALT_KEY`, DB auth, credential-manager material, restricted inference virtual keys; no relation to the existing shared instance.
- Store outside repo and image, with restrictive ownership/modes and reference-based injection. If on host files, audit backups and root access explicitly. Never print secrets through `docker inspect`, health checks, CI logs or diagnostics.
- Establish encrypted PostgreSQL backup with periodic retention, independent off-host or failure-domain copy, manifests/hashes, and separate secure escrow for the salt/master keys. Verify a **restored** isolated copy works with at least one synthetic credential; counts-only backup is insufficient.
- A2 DB migrations and credential encryption make rollback **data-sensitive**. Pre-change database snapshot and key escrow precede every schema/image upgrade; restoring the container alone is not an adequate rollback.
- Revoke/replace provider credentials without deleting keys used by active model mappings; fail closed on unknown dependency state. Verify stale sessions cannot re-add deleted keys.
- Audit LiteLLM's provider-request logging, request/response logging, dashboard telemetry, budgets, spend logs and exception paths. Article body, source URLs with sensitive query, raw model output and provider secrets must not be logged or exported.
- Retention and deletion rules for operational events vs provider content are separate. Default to **no persistent summaries** in NewsFlux P0.

## 7. Mistral-first controlled path

The initial adapter is Mistral, but **do not run paid inference yet**:

1. Review current Mistral API account state, retention and data-training opt-out/ZDR conditions; documentation alone cannot establish this account's settings.
2. Discover supported models/regions/pricing via provider documentation and authorized metadata API calls in a separate gate. Verify `model_id`, capabilities, context, streaming, structured output and tool disable behavior.
3. Define cost envelope: max requests, input/output token caps, an explicit monetary ceiling and external-transmission consent. Unknown price/budget enforcement => no paid dispatch. A provider-owned hard limit, if available, is complementary.
4. Build initial provider transport through LiteLLM's maintained Mistral adapter, not custom HTTP for the first path. Validate routing with **synthetic news articles**, first 1 request, then at most the separately approved fixture count.
5. Locally validate NewsFlux canonical summary schema and paragraph references. Use a provider-safe transport schema; never require full canonical JSON Schema in the provider if unsupported.
6. Test 4xx, 429, timeout, partial stream, invalid JSON, wrong effective model, action hallucination, budget failure, cancellation and session/entry changes without retrying silently.
7. The first real-article request requires **separate approval** after Content Fallback → Reader parity and privacy controls pass.

Mistral is a model/provider choice, not a permanent API design assumption. Google, Maritaca, Qwen Cloud, OpenRouter and Ollama use the same NewsFlux API contract and provider-specific compatibility tests.

## 8. Safe smoke, harness and device gates

| Gate | Evidence for PASS | Fail-closed / regression condition |
| --- | --- | --- |
| A2_PRESTATE | resources, network paths, db topology, secrets custody, approved digest all inventoried | Missing baseline blocks any deploy |
| A2_ISOLATION | dedicated DB/role and private networks; shared LiteLLM counts/SHAs invariant | Cross-database privilege, unexpected shared-container restart |
| A2_DB_MIGRATION | explicit isolated migration + schema contract and clean startup | Schema drift or shared DB touched |
| A2_BACKUP_RESTORE | restore database + cryptographic key access into disposable isolation, synthetic credentials decrypt | Counts-only backup or missing salt blocks promotion |
| A2_AUTH_ADMIN | unauthenticated and reader principals denied, admin mutation CSRF gated, admin UI not publicly routable | Any browser access to LiteLLM master key or management path |
| A2_AUTH_ENTRY | only authorized entry IDs and snapshots can be summarized | Guessed entry ID or stale-session leak |
| A2_SECRETS | no secrets in frontend bundle, browser persistent storage, logs, errors, traces or exports | Secret value or proxy admin token exposed |
| A2_EGRESS | approved provider origins and internal Ollama route only; reject private/loopback arbitrary URLs | Gateway can fetch arbitrary browser-supplied endpoint |
| A2_BUDGET | unknown price and failed accounting reject paid inference; rate limit in single-replica mode verified | Paid inference with missing guardrail |
| A2_CONTENT | Content Fallback returns same active entry/snapshot used by Reader and summary | Out-of-date article or cross-principal result |
| A2_INFERENCE | only synthetic fixture; verified Mistral effective model, bounded usage and reference validity | Wrong model, truncation or ungrounded action |
| A2_NO_IMPACT | shared LiteLLM, TROF, Paperless and other existing consumers stay stable | Any regression in neighboring containers |
| A2_ROLLBACK | image and DB restored from exact approved prestate; old service remains available | Rollback of only image or only DB |
| A2_DEVICE | settings and Reader validated on mobile/tablet/Fold including 884×1104 | UI regression or keyboard/focus leak |
| A2_CHANGE_CONTROL | BASE_SHA, HEAD_SHA, file inventory, code/harness/device gates, residual risks | Unrelated change, merge, prod deploy or implicit `latest` |

Do not infer gateway readiness solely from a `/health` response. Check DB reads, admin-route denial, encrypted secret recovery and model-route authorization in an approved isolated environment.

## 9. Work breakdown and PR dependencies

| Order | Track / purpose | Scope and release boundary |
| --- | --- | --- |
| 0 | **ARTICLE-INTEL-ARCH-01 / PR #201** | ADR and proposed frontend/backend contract, docs-only, still draft |
| 1 | **ARTICLE-INTEL-GATEWAY-01 / this plan** | docs-only A2 runtime design, topology and gates; does not provision |
| 2 | **ARTICLE-INTEL-AUTH-01** | explicit backend identity/auth + negative tests, separate from provider registration |
| 3 | **ARTICLE-INTEL-GATEWAY-02** | isolated A2 Compose/DB/secret references in dedicated infrastructure PR after PRESTATE and owner approval |
| 4 | **ARTICLE-INTEL-ADMIN-01** | registered provider/key/model management backend; no Reader changes |
| 5 | **ARTICLE-INTEL-SETTINGS-01** | provider model and credential management UI, no direct provider keys in browser storage |
| 6 | **ARTICLE-INTEL-MISTRAL-01** | separate synthetic canary and adapter, cost and privacy gates |
| parallel | **CONTENT-FALLBACK-RUNTIME/READER** | PR #188 follow-up, independent of all AI gateway PRs |
| final | **ARTICLE-INTEL-READER-01** | on-open summary after authorized common content snapshot and backend |

**Dependency rule:** No functional gateway PR can be promoted from planning until both PR #201 contracts are reviewed and A2 runtime/auth gates have owners and results. PR #195 remains independent as a roadmap-only draft. Never bundle upstream sync, redesign, Miniflux mutation or Content Fallback changes into the same PR.

## 10. Execution authorization and handoff

This document is a **design package**, not executable Compose or an approval to create resources. Next authorized act after PM review: a **read-only resource/identity preflight** on OMV and authentication boundary; collect sanitized evidence. Only after the owner explicitly authorizes implementation should agents create a disposable A2 stack.

```text
NEWSFLUX_A2_GATEWAY_PLAN_HANDOFF
PLAN_STATUS=PROPOSED
TOPOLOGY=A2_DEDICATED_LITELLM
PRODUCTION_CHANGES=NO
SHARED_LITELLM_CHANGES=NO
PROVIDER_REQUESTS=NO
INFERENCE_REQUESTS=NO
PAYMENT_AUTHORIZATION=NO
NEXT_GATE=READ_ONLY_CAPACITY_AND_AUTHORITY
IMPLEMENTATION_APPROVAL=PENDING
MERGE_APPROVAL=PENDING
DEPLOY_APPROVAL=PENDING
```

## Official upstream documentation

- LiteLLM production deployment and database/migration contracts: https://docs.litellm.ai/docs/proxy/deploy
- LiteLLM Quickstart (master/salt and database): https://docs.litellm.ai/docs/proxy/docker_quick_start
- LiteLLM model management (file-vs-DB source of truth): https://docs.litellm.ai/docs/proxy/ui_credentials
- LiteLLM Admin UI authentication and environment login hardening: https://docs.litellm.ai/docs/proxy/ui
- LiteLLM virtual-key roles and explicit `allowed_routes` caveat: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM production checklist: https://docs.litellm.ai/docs/proxy/prod
