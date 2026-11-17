# NEWSFLUX-AI-SETTINGS-01 — Configure LiteLLM from the NewsFlux application

**Status:** DESIGN / ARCHITECTURE GATES ONLY — NOT IMPLEMENTED, NO PRODUCTION WRITES  
**Source baseline:** `d54eda2bdb8bc5c3d1bd58d40236f48da762e852`  
**Date:** 2026-11-17 (America/Bahia)  
**Dependency:** PR #260 remains OPEN/DRAFT with PRIVACY HOLD. Keep scope separate.

## User goal and screenshot

Owner wants to enter/replace **the dedicated NewsFlux LiteLLM virtual key** in the NewsFlux UX and select the **primary** and **fallback** models in the application, without modifying source code or Docker configuration for every model choice. The owner reports the current key is specific to NewsFlux and the supplied LiteLLM screenshot shows `Models=all-proxy-models`, `TPM=Unlimited`, `RPM=Unlimited`, `Expires=Never`. Do **not** store or reproduce the key ID/token from the image.

The screenshot resolves a **classification error**, not a security approval: the previous R4B-R2 audit reported `KEY_MODELS_COUNT=1`, `KEY_LOCAL_ALIAS_MEMBER=NO`. `all-proxy-models` is a model *access group/special permission*, not necessarily a literal model deployment. It is consistent with the reported count and supports broad access intent. Effective models remain subject to gateway/team/group permissions and actual authenticated discovery; not every visible model is eligible for article processing.

Official references:
- https://docs.litellm.ai/docs/proxy/access_management/llm
- https://docs.litellm.ai/docs/proxy/virtual_keys
- https://docs.litellm.ai/docs/proxy/configuration/ui

## Confirmed current application capabilities (avoid duplicate work)

- Primary and fallback selectors **already exist** in `src/components/Settings/ArticleIntelligence.jsx`, within `Settings → Reading → Article Intelligence`. An optional fallback switch, `SUMMARY_FALLBACK_NONE`, different-model check, paid-model consent and cross-provider consent are implemented.
- Preferences `aiSummaryModel`, `aiSummaryFallbackEnabled`, `aiSummaryFallbackModel`, `aiSummaryFallbackAllowPaid`, `aiSummaryFallbackAllowCrossProvider` are **nonsecret identifiers**, persisted in browser via `src/store/settingsState.js`, validated by `src/utils/settings-schema.js`.
- `src/apis/article-intelligence.js` authenticates `GET /api/ai/v1/models` using the existing Miniflux session and sends summary v2/v3 requests with model IDs and explicit fallback consent.
- Summary backend `services/article_intel_summary/app.py` already authenticates its model catalog and summary endpoints. Shared auth module `services/article_intel_auth/auth.py` has `authorize_admin` and an explicit admin user-id allowlist.
- Backend-only `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE` is a private `0600` file; the Summary runtime is nonroot UID 10001. No admin API currently exists for writing this key from the browser.
- Model discovery `GET /v1/models` + `GET /model/info` is already intersected with the operator-approved `NEWSFLUX_AI_MODEL_POLICY_JSON` in `services/article_intel_summary/catalog.py`. **Discovery is not authorization**.
- Current gateway-only R4B-R2 runtime findings: `KEY_RPM=MISSING`, `KEY_TPM=MISSING`, `KEY_BUDGET_AMOUNT=MISSING`, one DB deployment for the target alias but literal provider and endpoint comparisons inconclusive, DB/YAML fallbacks configured. R4B privacy remains HOLD, notwithstanding the screenshot of broad access.

## Intended UX — minimal extension, not redesign

**Existing location:** Settings → Reading → Article Intelligence. Admin-only **LiteLLM Integration** section placed before the existing model controls. Reuse current SettingSection/SettingItem/Arco components, editorial/OLED palette and opaque settings surface. Test phone 360/390 px, tablet 820 px, Fold 884×1104 and desktop.

| Control | Behavior |
|---|---|
| Integration status | `CONNECTED`, `NOT_CONFIGURED`, `VALIDATION_FAILED`, `UNVERIFIED`; never show raw key or key hash |
| Virtual-key field | Password/masked input, **only to replace/register key**; empty when opened even if configured; never preload existing key |
| `Testar conexão` | Server-admin authenticated safe read-only call to LiteLLM model catalog, classify result without inference; preserve existing key on failure |
| `Salvar / Substituir chave` | Explicit admin operation after valid test and confirmation; backend writes atomically to approved protected secret store; no local/session storage |
| `Atualizar modelos` | Server-side authenticated live discovery with bounded size, no cookies/credentials in model metadata |
| Primary model | **Reuse existing selector**, improve search/filter if model count makes radio list unwieldy, show provider/local-or-external/available/price status |
| Fallback model | **Reuse existing switch and model selector**, different from primary; default disabled; show transient-only rule, paid and cross-provider separate opt-ins |
| Global approved model policy | Admin-only allowlist of gateway-discovered compatible models and their transfer/cost classification, persisted on server without code change |
| User preferences | Existing per-browser model IDs and consent toggles; no secret; unavailable saved choice remains visibly unavailable instead of silent substitution |

Model choices in the UX do not automatically turn on `NEWSFLUX_AI_INFERENCE_ENABLED`, `NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING` or `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER`. A key with access to all gateway models does **not** give NewsFlux blanket approval to process articles on any external model. Explicit, authenticated operator **approval** of each model and its data boundary remains required. Only provider/cost/compatibility-verified options become selectable.

## Required backend architecture decision before implementation

The current private key is injected through an operator-managed secret **file mount**. A browser-editable field needs a **server-side owner and writable protected persistence**; neither browser storage nor Miniflux is acceptable. Before coding, choose and document ONE canonical storage strategy:

1. **Preferred if operational mounts support it:** retain `NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE` as canonical path in a dedicated owner-only (UID 10001) protected secret volume, with a controlled admin-only replacement API, exclusive lock, atomic write+fsync+rename, permission enforcement, startup readback, rollback copy and prestate safeguards. Inspect current Docker mount mode and file ownership before deciding; do not silently mutate production mounts. Key never enters git/ledger/backups in plaintext.
2. **Alternative:** a dedicated secret manager already legitimately connected and deployable, with a single canonical reference and explicit backup/recovery. No new service or secret manager assumed.

Likewise define a single **nonsecret operator model-policy store** and revision/precedence relative to `NEWSFLUX_AI_MODEL_POLICY_JSON`; do not create two competing persistent sources. Suggest an admin-controlled JSON policy file, versioned and atomically persisted in the same secured backend data area, with operator env policy as immutable fallback **only if precedence is formally approved**. Configuration edits require atomic rollback and generation IDs to prevent stale updates. No new Miniflux writes, new per-user server preferences, provider API credentials or model-specific raw secret storage.

## API proposal (not yet implemented)

- `GET /api/ai/v1/admin/litellm/status`: **admin-only**, includes configured boolean, check status/timestamp, policy revision; no credential or host address.
- `POST /api/ai/v1/admin/litellm/validate`: one-time masked credential supplied in HTTPS body, max length, no-store; read-only LiteLLM catalog check, no inference or persistence, no arbitrary gateway URL/SSRF. A blank credential may test the existing backend-stored key without returning it.
- `PUT /api/ai/v1/admin/litellm/credential`: admin-only, explicit confirmation, anti-CSRF, revision check, validated new credential only; protected atomic store, rollback, no key value in response; **not enabled in production until storage/GO gate**.
- `GET /api/ai/v1/admin/litellm/model-policy`, `PUT /api/ai/v1/admin/litellm/model-policy`: schema-validated approved aliases / classification / permissions with revision, fail-closed drift handling; no raw endpoint/URL metadata exposed.
- Existing `GET /api/ai/v1/models` stays user-authenticated and returns only model aliases approved by policy, with normalized status, origin and pricing privacy labels.
- Any admin mutation endpoint must call `MinifluxAuthService.authorize_admin`, enforce exact origin/host/TLS, CSRF protection for same-origin requests, size limits, bounded timeouts, concurrency locks and denial without any writes. No new privileged access to the LiteLLM admin API or its key management endpoints is part of this feature.

**Threat model:** browser secrets, cross-user privilege escalation, XSS/localStorage leaks, CSRF, SSRF, file symlink races, atomic write failure, stale session, stale cached catalog, gateway remapping GET→POST, aliases pointing at paid or remote models, fallback cross-boundary, budget exhaustion, no untrusted article content forwarded with admin credentials. Refuse with categorized errors; never echo raw token, headers, provider error body, DSN, host details or private paths.

## PR and gate boundaries

**Architectural gate first** (no productive key write): approve secure persistence source of truth and nonsecret policy override precedence.

- **Functional PR A**: Summary admin API + protected credential management + approved model-policy persistence; strictly backend-only, TDD red/green, synthetic clients. No UX redesign.
- **UX PR B**: admin status and masked one-time credential field, existing model selector improvements/search and consent UX; only frontend + i18n/UI tests. BASE SHA must include validated PR A contract, no combined code PR.
- **PR #260** remains independent Summary local-only consent hardening; do not mutate its open draft branch or bypass its privacy HOLD. Reconcile APIs in a separate validated review once base lineage is ready.
- **Upstream sync** and **WallHop** stay independent.

**Gates**: admin allowlist, HTTPS/CSRF, no browser persistence or plaintext key readback, synthetic denial and rollback, owner-only file permissions & atomic replace, masked response and logs, authenticated full catalog/pricing/cost/consent intersection, no silent external fallback, no unchecked dynamic provider route, stale session/refetch, 216-test Summary suite plus new tests, Reader harness/real devices, protected OMV pre/poststate, exact SHA release, reversible canary and explicit GO. **Never auto-merge or auto-deploy.**

```ini
FEATURE=NEWSFLUX_AI_SETTINGS_01
CURRENT_MODEL_UI=PRIMARY_AND_FALLBACK_ALREADY_EXISTS
NEW_COMPONENT=ADMIN_LITELLM_CONNECTION_AND_MODEL_POLICY
KEY_IN_BROWSER_STORAGE=FORBIDDEN
PERSISTENCE_SOURCE_OF_TRUTH=GATE_REQUIRED
IMPLEMENTED=NO
PR260=OPEN_DRAFT_HOLD
PRODUCTION_CHANGES=0
MERGE=NO
DEPLOY=NO
```
