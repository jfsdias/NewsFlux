# NewsFlux D1 — LiteLLM as model and cost authority (successor contract)

Status: **proposal for PM review** (docs only). The implementation is a separate Draft PR
(`claude/newsflux-d1-litellm-key-authority`), default off. The current S5/operator-policy contract stays in
force and fail-closed until this successor is reviewed, merged and deployed under separate authorization.

Owner decisions (2026-11-20, recorded by the PM in
[PR271 comment 7047495122](https://github.com/jfsdias/NewsFlux/pull/271#issuecomment-7047495122)):

- R2 "Chave do LiteLLM rege os modelos disponíveis."
- R3 "LiteLLM controla custos. Não precisa ser controlado ou aparecer no NewsFlux."

```
LITELLM_MODEL_AUTHORITY=TRUE
LITELLM_COST_AUTHORITY=TRUE
NEWSFLUX_MODEL_ADMINISTRATION_DUPLICATION=FALSE
NEWSFLUX_COST_ADMINISTRATION=FALSE
NEWSFLUX_COST_DISPLAY=FALSE
```

## 1. Model authority

- The models NewsFlux may offer are exactly the aliases the Summary API's virtual key lists
  (`GET /v1/models` with that key; `GET /model/info` for capability). There is no second NewsFlux allowlist.
- What stays in NewsFlux, and is not "administration":
  - **capability:** only `mode == "chat"` models are selectable; unknown mode is `COMPATIBILITY_UNVERIFIED`;
  - **backend validation:** every request re-resolves the chosen ID against the current catalog
    (`adapter_for`), and the fallback against the same state (`fallback_view`);
  - **identity:** the response `model` must equal the alias; provider identity pinning for fallback;
  - **user preferences:** primary and fallback stay user choices; a revoked model is reported as missing and
    is never silently replaced;
  - **effective key permissions:** whatever the key cannot call never appears.
- **Catalog visibility is not inference authorization.** Inference still needs the inference flag, the
  external-transfer authorization, the consent rules below, and a healthy gateway.
- The key never reaches the browser and is never stored there (unchanged).

## 2. Cost authority

LiteLLM is the only place where money is administered and displayed: budgets, prices, spend. NewsFlux shows
no amount and asks the owner for no cost configuration. But the safety the current gates give must not be
lost silently, so the successor requires a **declared and verified** cost authority:

| Declaration (`NEWSFLUX_AI_LITELLM_COST_AUTHORITY`) | Meaning                                                        | Release-time evidence required                                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway_budget_enforced`                          | the virtual key carries a gateway budget that LiteLLM enforces | read-only receipt: `KEY_MAX_BUDGET=OK`-class (positive `max_budget`), `KEY_BUDGET_DURATION` recognized, spend below max, fresh (≤ 7 days), bound to the deployed key fingerprint |
| `explicit_unlimited`                               | the owner explicitly accepts no gateway budget for this key    | a recorded owner decision naming the key fingerprint and date; the receipt shows `max_budget` absent                                                                             |
| missing / anything else                            | **not** unlimited: unknown                                     | none possible → `COST_AUTHORITY_UNPROVEN`, nothing available                                                                                                                     |

Runtime keeps only a **local throttle** (requests/minute, tokens/minute, concurrency) to protect NewsFlux
itself; it is not a cost control and needs no price.

## 3. Inventory of current cost mechanisms (main `12929fb`) and successor classification

| #   | Mechanism (file)                                                                   | Today                   | Class                                     | Successor                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Local USD ledger month check (`budget.py` `reserve`)                               | blocks inference        | **ADAPT**                                 | keep RPM/TPM/concurrency; skip USD only under a declared gateway cost authority (implemented)                                                            |
| 2   | `NEWSFLUX_AI_MONTHLY_BUDGET_USD` (`litellm_adapter.py`)                            | required for readiness  | **DEPRECATE**                             | not required under the successor; kept for the legacy contract until it is retired                                                                       |
| 3   | Per-model price fields and `_estimate_max_cost`/`_calculate_cost`                  | required, block         | **REMOVE (successor) / keep (legacy)**    | not read in key-authority mode (implemented)                                                                                                             |
| 4   | Legacy price env vars (`*_USD_PER_MILLION`)                                        | required for legacy IDs | **DEPRECATE**                             | retire with the legacy S5/Mistral path                                                                                                                   |
| 5   | Policy price fields (`NEWSFLUX_AI_MODEL_POLICY_JSON`)                              | validated               | **DEPRECATE**                             | the policy itself is superseded by key authority                                                                                                         |
| 6   | Catalog price verification (`PRICE_MISMATCH`, `PRICE_NOT_VERIFIED`)                | blocks                  | **REMOVE (successor)**                    | provider-identity pinning **KEPT** (security, not cost)                                                                                                  |
| 7   | Catalog price display, `pricing_class` in v3 responses                             | display                 | **ADAPT**                                 | `pricing.status = gateway_governed`, amounts null, not shown (implemented)                                                                               |
| 8   | Admin price classification and price-equality approval gates (`admin_settings.py`) | blocks approval         | **DEPRECATE**                             | approval itself disappears under key authority; follow-up PR                                                                                             |
| 9   | Frontend price UI (settings, admin, migration, locales; PR269 adds more)           | display                 | **REMOVE (successor)**                    | hidden for gateway-governed models (implemented); admin screens in a follow-up PR; PR269's price blockers should not be merged as is                     |
| 10  | S5 preflight price/budget gates (`s5_preflight.py`)                                | release gate            | **ADAPT**                                 | price-zero and pricing gates retired; budget gate replaced by the cost-authority evidence of §2; rate-limit, scope, routes, validity, callbacks **KEPT** |
| 11  | Admin attestation `s5_key_audit.py` (`--confirm-provider-cost-zero`)               | release evidence        | **ADAPT**                                 | keep key policy fields; drop cost confirmation                                                                                                           |
| 12  | Governance rehearsals (`rehearse-s5-key-gate.sh`, …)                               | CI                      | **ADAPT**                                 | add successor cases; keep current ones while the legacy contract exists                                                                                  |
| 13  | `NEWSFLUX_AI_ALLOW_PAID_INFERENCE`                                                 | blocks paid models      | **ADAPT → consent**                       | "paid" is a cost notion; what remains is consent (§4)                                                                                                    |
| 14  | Tests asserting price/budget                                                       | —                       | **KEEP until the legacy path is retired** | successor tests added alongside                                                                                                                          |

Removal happens only in follow-up PRs after the successor is deployed and the legacy path is retired; nothing
is deleted silently.

## 4. Non-financial gates (all kept)

Model scope (key models only), authentication (Miniflux user, admin allowlist), JWT (the read-only receipt
reports `JWT_AUTH`; JWT enabled is a hold for this key), inherited permissions (team, access groups, object
permissions reported by the read-only receipt; any extra indirection is a hold), route restriction
(`llm_api_routes` only), callbacks (allowlist), fallback (one attempt after a transient failure, same catalog
state, cross-provider consent), external transfer (`NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER`), consent and
provider privacy.

**LiteLLM permission is not consent.** A model the key allows is not, by that fact, a model to which article
text may be sent. Consent remains a separate owner decision (global external-transfer authorization, and
per-request user consent where the UI asks for it).

## 5. Privacy and attestation strategy

The old "official attestation" (admin key + provider-cost-zero confirmation) is replaced by evidence that
already exists, with provenance:

1. **Read-only DB/config receipt** (`s5_db_readonly_audit.py`, strict binding, contract-validated): key scope,
   routes, validity, budget fields, JWT, inheritance, callbacks, fallback config. Freshness ≤ 7 days at release (no runtime expiry; see AI_MODEL_CATALOG.md), bound to
   the key fingerprint and the exact LiteLLM image. It is a **diagnostic**, not a certification.
2. **Operator-provided administrative evidence**: a screenshot or export from the LiteLLM admin UI of the key's
   budget and model list, dated, attached to the PM record (no new admin key).
3. **Provider privacy:** the provider's published terms for each external provider in the key's model list,
   reviewed by the owner/PM. Until reviewed: `PROVIDER_PRIVACY=HOLD` and external transfer stays off.

No new admin key is created; no attestation is fabricated; the R3B diagnostic is not a privacy certification.

## 6. Canary and rollback (procedure for a future GO; nothing runs now)

Preconditions: successor merged and deployed with the mode **off**; fresh read-only receipt; cost-authority
declaration matching the receipt (§2); provider privacy reviewed; owner consent recorded; `enable-s5`-class GO.

1. Set `NEWSFLUX_AI_MODEL_AUTHORITY=litellm_key` and the declaration; keep inference and external transfer off;
   verify the catalog lists exactly the key's chat models, with no price shown.
2. Enable inference and external transfer for one user; one summary of one synthetic-safe article; verify the
   response model equals the alias, the local throttle counts it, and LiteLLM's own spend view moved.
3. Negative checks: revoke one model in LiteLLM → it disappears, the saved preference reports missing; stop the
   gateway → `GATEWAY_UNAVAILABLE`, no substitution; timeout → transient failure, at most one fallback.
4. Rollback at any failure: flags OFF (inference, external transfer), then remove the mode (back to the
   operator-policy contract). Both are configuration-only.

The synthetic version of this procedure is rehearsed in the implementation PR
(`tests/test_d1_synthetic_canary.py`).

## 7. Remaining decisions

- PM: accept this contract; accept the `explicit_unlimited` semantics.
- Owner: provider privacy review and consent for external transfer (unchanged HOLD).
