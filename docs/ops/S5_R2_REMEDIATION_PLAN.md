# S5-R2: key policy and provider remediation plan (offline, read-only)

Track: `NEWSFLUX_S5_R2_KEY_AND_PROVIDER_REMEDIATION_PLAN_OFFLINE`. Status: **plan only**.

This document authorizes nothing. In particular it does not authorize:

- a key update;
- creating a credential;
- a LiteLLM or Postgres write;
- inference or sending articles;
- a deploy;
- changes to `s5_preflight.py`.

Every write step below needs its own GO (section 8).

## 1. Facts and their evidence level

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Exactly one LiteLLM key matches the Summary key's fingerprint. It is valid and not blocked, its routes are exactly `llm_api_routes`, and its spend is known.                                                                                                                                                                                                                                                                  | OMV run of the S5-R1 auditor `3822e09` (`REPORTED_OPERATOR`, [PR #271 7027705548](https://github.com/jfsdias/NewsFlux/pull/271#issuecomment-7027705548))                                                                                            |
| F2  | `KEY_SCOPE_DETAIL=WILDCARD`, `KEY_MODELS_COUNT=1`. The single `models` entry is `all-proxy-models`, `all-team-models`, `*` or contains `*`.                                                                                                                                                                                                                                                                                   | Same receipt; auditor `classify_scope` (`CONFIRMED_GITHUB`)                                                                                                                                                                                         |
| F3  | The entry is very likely `all-proxy-models`.                                                                                                                                                                                                                                                                                                                                                                                  | Owner screenshot 2026-11-17: dedicated NewsFlux key, `Models=all-proxy-models`, RPM/TPM "Unlimited" (`USER_SUPPLIED_SCREENSHOT`, homeserver `2026-11-17-newsflux-ai-settings-01-ui-key-models-architecture.md`). **Inference, not a current read.** |
| F4  | `KEY_RATE_LIMITS=FAIL` with `KEY_RPM_WITHIN_APP=KEY_TPM_WITHIN_APP=NOT_APPLICABLE`. The key's RPM and TPM are not positive integers (null, zero, negative or non-integer). The Summary caps exist (otherwise `APP_CAP_MISSING`).                                                                                                                                                                                              | Receipt + auditor `classify_key`. Consistent with F3 ("Unlimited") and with R4B-R2 (2026-11-17: RPM/TPM `MISSING`).                                                                                                                                 |
| F5  | `KEY_BUDGET=FAIL` with spend known. At least one of these holds: `max_budget` missing, non-numeric or ≤ 0; `max_budget` above the Summary monthly cap; `budget_duration` missing or blank; Summary budget cap missing; spend ≥ `max_budget`. **The receipt does not say which.**                                                                                                                                              | Receipt + auditor. R4B-R2 (2026-11-17) reported `max_budget` `MISSING` and `budget_duration` `MISSING_OR_INVALID`. That is two days old and was about another model, so it is **probable, not confirmed**.                                          |
| F6  | `KEY_INDIRECTION=OBJECT_PERMISSION`: the key has an `object_permission_id`. Its contents are **unknown**.                                                                                                                                                                                                                                                                                                                     | Receipt                                                                                                                                                                                                                                             |
| F7  | One S5 deployment, in the DB, enabled. Its provider prefix is not in the auditor's family list (`OTHER`), and it has an `api_base` that is neither the `ollama` service nor loopback (`CUSTOM_ENDPOINT`). No cost in `model_info` (`NOT_PUBLISHED`). Its model string is not in the image's bundled price map (`NOT_LISTED`).                                                                                                 | Receipt                                                                                                                                                                                                                                             |
| F8  | No fallback rule (alias, default, context, content, general_settings) and callbacks within the allowlist, **in configuration**.                                                                                                                                                                                                                                                                                               | Receipt (`FALLBACK_GATE=PASS`, `CALLBACK_GATE=PASS`). Runtime parity is not verified.                                                                                                                                                               |
| F9  | Pinned LiteLLM image (same digest as CI): `/key/update` changes `models`, `rpm_limit`, `tpm_limit`, `max_budget` and `budget_duration` **in place**; the key value is unchanged and the same key keeps authenticating; the key's catalog then lists only the exact alias; an existing `object_permission` row is untouched; an update with explicit `null`s restores the prestate exactly (including `budget_reset_at=null`). | `deploy/release-governance/rehearse-s5-key-policy-update.sh`, run on 2026-11-20 against disposable synthetic containers (`VERIFIED_SYNTHETIC`). **Re-run it against the production LiteLLM image digest before any write.**                         |
| F10 | Pinned image: `budget_duration: "30d"` set on 2026-11-20 gave `budget_reset_at=2026-12-01 00:00:00`. The reset follows a calendar boundary, not "30 days from now".                                                                                                                                                                                                                                                           | Same rehearsal (`VERIFIED_SYNTHETIC`)                                                                                                                                                                                                               |
| F11 | Pinned image: `object_permission.models` is enforced for **managed agents** (keys with an `agent_id`). For an ordinary virtual key the row governs MCP servers, MCP tool permissions, vector stores, agents, search tools, skills and blocked tools.                                                                                                                                                                          | LiteLLM source in the pinned image (`proxy/schema.prisma`, `proxy/auth/auth_checks.py` `can_agent_call_model`, vector-store checks) (`VERIFIED_SOURCE_PINNED_IMAGE`). The production image may differ.                                              |

## 2. Open architectural decision (owner + PM), required before any key write

`docs/ops/S5_KEY_GATE.md` requires the key's `models` to be **exactly `[<S5 alias>]`**. The owner stated
on 2026-11-17 that this dedicated key is meant to reach the models of the admin-managed catalog. PR
#270 (merged) offers primary/fallback choices from an admin allowlist. These two goals conflict:

- **D1-A: exact S5 scope.** Follow the current contract: `models=["<S5 alias>"]`. Every other catalog
  model becomes unusable with this key, including Mistral (already forced off) and any later admin
  approval. Changing models then requires a key update each time. This is the smallest change and
  needs no contract change.
- **D1-B: explicit allowlist scope.** `models` equals the exact list of admin-approved aliases (still
  never `all-proxy-models`). This requires a **revised `S5_KEY_GATE` contract and preflight change**,
  with its own PR, TDD and PM review. It is out of scope here.

Recommendation: **D1-A now**. S5 is the only model under activation review, and D1-A needs no code
change. Revisit D1-B only when a second model is actually approved for activation.

## 3. Key policy remediation (existing dedicated key, in place, no rotation)

### 3.1 Target policy (D1-A)

| Field                                   | Target                                                              | Source of the value                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `models`                                | `["<S5 alias>"]`, exact string, one entry                           | `NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS` in the running Summary (read privately)                             |
| `allowed_routes`                        | `["llm_api_routes"]` (already PASS, unchanged)                      | —                                                                                                       |
| `rpm_limit`                             | positive integer, at or below `NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE` | Summary environment (read privately); equal to the cap unless the owner chooses lower                   |
| `tpm_limit`                             | positive integer, at or below `NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE`   | same                                                                                                    |
| `max_budget`                            | above 0 and at or below `NEWSFLUX_AI_MONTHLY_BUDGET_USD`            | same. A positive cap is required **even if S5 is expected to cost zero**: it bounds an unexpected bill. |
| `budget_duration`                       | `"30d"`                                                             | brief. Note F10: the reset is a calendar boundary.                                                      |
| `spend`                                 | must stay below `max_budget` after the change                       | if the current spend is not below the new cap, abort and escalate                                       |
| `aliases`, `router_settings`, `team_id` | none, unchanged (already none)                                      | —                                                                                                       |
| `object_permission_id`                  | **decided after the private classification** (3.3)                  | —                                                                                                       |

No value is assumed in this document. The real values are read privately at prestate time and never
posted.

### 3.2 Pinning down `KEY_BUDGET=FAIL` without assuming values

The current receipt cannot distinguish the causes listed in F5. Proposed read-only increment to the
S5-R1 auditor, to be built in a later PR with TDD, before any write. It adds these
classifications, enums only:

- `KEY_MAX_BUDGET=MISSING|INVALID|NONPOSITIVE|ABOVE_APP_CAP|OK`
- `KEY_BUDGET_DURATION=MISSING|BLANK|PRESENT`
- `KEY_SPEND_VS_MAX=BELOW|AT_OR_ABOVE|NOT_APPLICABLE`
- `APP_BUDGET_CAP=PRESENT|MISSING`
- `KEY_RPM=MISSING|NONPOSITIVE|NON_INTEGER|OK` and the same for `KEY_TPM`
- `KEY_SCOPE_TOKEN=ALL_PROXY_MODELS|ALL_TEAM_MODELS|STAR|CONTAINS_STAR`. These four token names are
  LiteLLM keywords, not aliases, so printing them is safe.

Tests: unit tests per enum (RED first), and the real LiteLLM/Postgres rehearsal with keys that
reproduce each cause.

### 3.3 `OBJECT_PERMISSION`

Proposed read-only classification of the linked `LiteLLM_ObjectPermissionTable` row, inside the
same increment. It prints counts only, never names:

- `OBJPERM_MODELS_COUNT`, `OBJPERM_MCP_SERVERS_COUNT`, `OBJPERM_MCP_ACCESS_GROUPS_COUNT`,
  `OBJPERM_MCP_TOOL_PERMISSIONS=NONE|PRESENT`, `OBJPERM_VECTOR_STORES_COUNT`, `OBJPERM_AGENTS_COUNT`,
  `OBJPERM_AGENT_ACCESS_GROUPS_COUNT`, `OBJPERM_SEARCH_TOOLS_COUNT`, `OBJPERM_SKILLS_COUNT`,
  `OBJPERM_MCP_TOOLSETS_COUNT`, `OBJPERM_BLOCKED_TOOLS_COUNT`
- `KEY_AGENT_ID=NONE|PRESENT`. Per F11, `object_permission.models` matters only for agent keys.

Decision table, for a later GO:

| Classification                                                       | Action                                                                                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every count 0, no tool permissions, no agent                         | Inert in the pinned version. Leave it, and record that it was inspected. Removing it is an extra write with no security gain.                                                     |
| any non-model grant > 0 (MCP, vector stores, search, skills, agents) | The key can reach tools or stores beyond inference. Plan a separate change, with its own prestate and rollback, to empty those grants. The owner decides; never as a side effect. |
| `models` count > 0 and `KEY_AGENT_ID=PRESENT`                        | Model grants via the managed-agent path. `KEY_POLICY_GATE` cannot pass until it is reconciled.                                                                                    |
| production LiteLLM version differs from the pinned image             | Re-check F11 against that version's source before deciding.                                                                                                                       |

## 4. Provider and route (`PROVIDER_FAMILY=OTHER`, `CUSTOM_ENDPOINT`)

Why the auditor says `OTHER`: it maps the deployment's provider prefix (`custom_llm_provider`, or the
part of `litellm_params.model` before the first `/`) against a short list of 23 families. The pinned
LiteLLM supports 187 providers. Prefixes such as `hosted_vllm`, `openai_like`, `custom_openai`,
`litellm_proxy`, `deepinfra`, `nebius`, `chutes`, `nscale`, `novita` or `featherless_ai` all
classify as `OTHER`, and so does a model string with no prefix. `CUSTOM_ENDPOINT` means an `api_base`
is set and is not `ollama` or loopback. Together these mean S5 is called through an explicit base URL.
That is typical of an OpenAI-compatible endpoint, an aggregator or a self-hosted server. **None of
this says who operates it.**

Evidence to collect privately (owner or operator; nothing posted publicly, no inference):

1. **Deployment identity.**
   - Exact provider prefix.
   - `api_base` **host only**: the operator of that host, and whether it is first-party, an aggregator
     or a self-hosted server.
   - The upstream model name.
   - Source: the LiteLLM admin UI "Models" page (existing admin session), or the private prestate file
     in section 7.
2. **Credential owner.** Which provider account the deployment's `api_key` belongs to (name and
   plan), **never the key itself**.
3. **Intermediaries.** Whether the host forwards to another provider. If it does, both data policies
   apply.
4. **Runtime parity.** Confirm the running proxy uses this DB deployment. The S5-R1 YAML read showed 0
   YAML deployments. Check that no environment variable overrides `api_base`, through the admin UI
   model view.

## 5. Pricing and privacy: independent gates, evidence required

`PRICING_GATE` and `PROVIDER_PRIVACY_GATE` stay `NOT_VERIFIED` until the owner records, with a date and
a reference (URL and capture date, kept privately; a summary goes in the ledger):

| Gate    | Evidence required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost    | Each of the following, for the account and plan identified in 4.2: the provider's current price for that exact upstream model; whether usage is billed at zero; free-tier quotas and what happens when they are exceeded (refused, or billed); whether a payment method is on file; and whether an aggregator adds a fee. Only then may the owner set explicit `input_cost_per_token: 0` and `output_cost_per_token: 0` on the deployment (a separate gateway change and GO), or use `--confirm-provider-cost-zero --reference …` on the official attestation path. |
| Privacy | The data policy for that tier, with an answer to each of: retention period; use of prompts or completions for **training**; human review; logging by any intermediary; data location. If prompts can be used for training or the policy is unknown, external article transfer stays OFF, and the owner may decline S5 entirely.                                                                                                                                                                                                                                     |
| Consent | Once cost and privacy are documented: an explicit owner decision to send article text to that provider (`NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=true` in a later activation GO). It is never implied by a key or pricing fix.                                                                                                                                                                                                                                                                                                                                  |

A configured zero in LiteLLM, the word "free" in an alias, or a listing in LiteLLM's price map is
**never** enough.

## 6. Official attestation: A vs B

|                | A. Official `s5_key_audit.py` with an **existing** admin credential                                                                                                                                                                     | B. New evidence kind `LITELLM_DB_READONLY_ATTESTATION`                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code change    | None                                                                                                                                                                                                                                    | Auditor writes a 0600 attestation; preflight accepts the new kind only when explicitly enabled. PR, TDD and PM review needed. **No preflight change in this phase.** |
| Credential     | The owner's existing admin credential (for example the master key), used interactively once and passed through a root-only temporary file that is removed right after. **No new key.**                                                  | None beyond the DB access already used by S5-R1                                                                                                                      |
| Coverage       | Live LiteLLM API (`/v2/key/info`, `/model/info`): what the proxy itself reports, including cache                                                                                                                                        | DB and YAML rows. Misses runtime cache, environment overrides and runtime callbacks.                                                                                 |
| Risk           | The master key briefly enters a host file and the auditor's memory. If it leaks, the whole gateway is exposed. Mitigations: root-only tmpfs file, immediate removal, no shell history, only the 2 GETs/POST-reads of the official tool. | A weaker evidence class, and the contract must be revised. The risk is accepting evidence that differs from runtime.                                                 |
| Decision owner | Owner (credential handling)                                                                                                                                                                                                             | PM (contract) + owner                                                                                                                                                |
| Recommendation | **A**, _after_ the key policy fix, if the owner accepts the single interactive credential use. It is the existing contract and needs no new code or key.                                                                                | Only if the owner declines every use of an existing admin credential                                                                                                 |

Either way, an attestation passes only after the key policy (section 3) and the provider cost
confirmation (section 5) are fixed. `S5_PREFLIGHT` stays `BLOCKED` until then.

## 7. Safety of the future write intervention (runbook draft, not authorized)

1. **Preconditions (abort if any is false):**
   - inference and external transfer OFF in the Summary;
   - Summary on the approved SHA;
   - LiteLLM healthy;
   - a fresh S5-R1 receipt with `KEY_MATCH=ONE` and the same fingerprint prefix as the OMV receipt;
   - the S5-R2 increment (3.2/3.3) receipt reviewed;
   - the F9 rehearsal re-run against the **production LiteLLM image digest**, all PASS.
2. **Private prestate.** Root-only, mode 0600, on the host, never posted:
   - **contents:** the key's current policy fields (`models`, `rpm_limit`, `tpm_limit`, `max_budget`, `budget_duration`, `budget_reset_at`, `spend`, `allowed_routes`, `object_permission_id`), the linked `object_permission` row, and the S5 deployment's `litellm_params` **without** `api_key` plus its `model_info`;
   - **how it is read:** one read-only transaction (same mechanism as S5-R1, with a `--private-prestate PATH` mode, specified for the increment PR);
   - **what is published:** only the file's SHA-256 and the classification lines.
3. **Exact identity.** The write targets the key matched by fingerprint (never by alias or name). In
   the admin UI, the owner checks the key alias and the prefix shown before editing.
4. **Backup.** The private prestate (2) is the rollback source. Optionally, the owner may also take a
   full LiteLLM DB backup with their usual tool. That is the owner's choice; this plan does not
   require or perform it.
5. **Change (owner, existing admin session).** Exactly the fields of 3.1, in one `/key/update` (or one
   admin UI "Edit key" save). Nothing else: no model, deployment, budget table, team or
   object-permission edits in the same change.
6. **Post-change verification:**
   - Re-run the S5-R1 auditor. Expected: `KEY_SCOPE=PASS (EXACT_ALIAS)`, `KEY_RATE_LIMITS=PASS`,
     `KEY_BUDGET=PASS`, `KEY_VALIDITY/ROUTES=PASS`, `KEY_MATCH=ONE`, same fingerprint prefix.
   - `KEY_INDIRECTION` is unchanged (or NONE if 3.3 removed it under its own GO).
   - Every other gate's classification is unchanged.
   - Then run `s5-preflight`. It stays `BLOCKED` (attestation, pricing) and is not expected to pass.
7. **Abort and rollback criteria:**
   - any post-change classification other than the expected one;
   - a fingerprint mismatch;
   - Summary or LiteLLM health regresses;
   - the catalog smoke fails;
   - the prestate file hash differs from the one recorded.

   Rollback is one `/key/update` restoring the prestate values, including explicit `null`s (F9). Then
   re-run the auditor and compare against the prestate classifications.

8. **Records.** The receipt (classifications only) goes to the NewsFlux PR and the homeserver ledger,
   with readback. The prestate file is kept privately until the PM closes the change, then shredded
   by the owner.

## 8. GOs that will be needed (none granted here)

| GO                     | Scope                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GO_D1_SCOPE`          | Owner and PM choose D1-A or D1-B (section 2)                                                                                                      |
| `GO_S5R2_INCREMENT`    | Develop the read-only auditor increment (3.2, 3.3, `--private-prestate`) in a PR with TDD, CI and PM review                                       |
| `GO_S5R2_READONLY_RUN` | One OMV run of that increment (read-only; private prestate written on the host)                                                                   |
| `GO_PROVIDER_EVIDENCE` | Owner gathers the section 4 and 5 evidence privately; no inference                                                                                |
| `GO_KEY_POLICY_WRITE`  | The single in-place key update of section 7, by the owner's existing admin session, with prestate and rollback                                    |
| `GO_OBJPERM_WRITE`     | Only if 3.3 finds grants to remove; separate change                                                                                               |
| `GO_PRICING_CONFIG`    | Explicit zero costs on the deployment, only with verified provider terms; separate gateway change                                                 |
| `GO_ATTESTATION_A`     | The owner's single interactive use of an existing admin credential for the official auditor (or `GO_ATTESTATION_B_DESIGN` for the alternative PR) |
| `GO_S5_ACTIVATION`     | Only after `S5_PREFLIGHT=PASS`, documented consent and a release GO (`enable-s5`)                                                                 |

## 9. Residual risks

- F3 and F5 rely partly on two-day-old or screenshot evidence. 3.2 removes that uncertainty without
  writing anything.
- F9–F11 describe the **pinned** LiteLLM image. Production may run a different version, so re-run the
  rehearsal and re-check F11 against the production image digest.
- Narrowing the key to the S5 alias (D1-A) disables every other model for this key, by design.
- The DB/YAML evidence never covers runtime caches, environment overrides or network egress.
- Provider terms change over time. Pricing and privacy evidence needs a review date and re-checking
  before activation.
