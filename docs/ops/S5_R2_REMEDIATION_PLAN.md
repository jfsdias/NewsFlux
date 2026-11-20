# S5-R2: key policy and provider remediation plan (offline, read-only)

Track: `NEWSFLUX_S5_R2_KEY_AND_PROVIDER_REMEDIATION_PLAN_OFFLINE`. Status: **plan only**. Revised by
S5-R2B (offline evidence hardening): rehearsal facts are now assertion-backed (section 10), D1 stays
open (section 2), and the `OBJECT_PERMISSION` handling follows the S5-R1 auditor contract (3.3).
Revised again by S5-R2C (offline harness closeout, section 11): full column coverage, fail-closed
setup, strict refusal contracts, exact reset date, mandatory provenance and verified cleanup.

This document authorizes nothing. In particular it does not authorize:

- a key update;
- creating a credential;
- a LiteLLM or Postgres write;
- inference or sending articles;
- a deploy;
- changes to `s5_preflight.py`.

Every write step below needs its own GO (section 8).

## 1. Facts and their evidence level

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Exactly one LiteLLM key matches the Summary key's fingerprint. It is valid and not blocked, its routes are exactly `llm_api_routes`, and its spend is known.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | OMV run of the S5-R1 auditor `3822e09` (`REPORTED_OPERATOR`, [PR #271 7027705548](https://github.com/jfsdias/NewsFlux/pull/271#issuecomment-7027705548))                                                                                                                                                                |
| F2  | `KEY_SCOPE_DETAIL=WILDCARD`, `KEY_MODELS_COUNT=1`. The single `models` entry is `all-proxy-models`, `all-team-models`, `*` or contains `*`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same receipt; auditor `classify_scope` (`CONFIRMED_GITHUB`)                                                                                                                                                                                                                                                             |
| F3  | The entry is very likely `all-proxy-models`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner screenshot 2026-11-17: dedicated NewsFlux key, `Models=all-proxy-models`, RPM/TPM "Unlimited" (`USER_SUPPLIED_SCREENSHOT`, homeserver `2026-11-17-newsflux-ai-settings-01-ui-key-models-architecture.md`). **`INFERENCE`, not a current read.**                                                                   |
| F4  | `KEY_RATE_LIMITS=FAIL` with `KEY_RPM_WITHIN_APP=KEY_TPM_WITHIN_APP=NOT_APPLICABLE`. The key's RPM and TPM are not positive integers (null, zero, negative or non-integer). The Summary caps exist (otherwise `APP_CAP_MISSING`).                                                                                                                                                                                                                                                                                                                                                                                                                               | Receipt + auditor `classify_key`. Consistent with F3 ("Unlimited") and with R4B-R2 (2026-11-17: RPM/TPM `MISSING`).                                                                                                                                                                                                     |
| F5  | `KEY_BUDGET=FAIL` with spend known. At least one of these holds: `max_budget` missing, non-numeric or ≤ 0; `max_budget` above the Summary monthly cap; `budget_duration` missing or blank; Summary budget cap missing; spend ≥ `max_budget`. **The receipt does not say which.**                                                                                                                                                                                                                                                                                                                                                                               | Receipt + auditor. R4B-R2 (2026-11-17) reported `max_budget` `MISSING` and `budget_duration` `MISSING_OR_INVALID`. That is two days old and was about another model, so it is **`INFERENCE`: probable, not confirmed**.                                                                                                 |
| F6  | `KEY_INDIRECTION=OBJECT_PERMISSION`: the key has an `object_permission_id`. Its contents are **unknown**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Receipt                                                                                                                                                                                                                                                                                                                 |
| F7  | One S5 deployment, in the DB, enabled. Its provider prefix is not in the auditor's family list (`OTHER`), and it has an `api_base` that is neither the `ollama` service nor loopback (`CUSTOM_ENDPOINT`). No cost in `model_info` (`NOT_PUBLISHED`). Its model string is not in the image's bundled price map (`NOT_LISTED`).                                                                                                                                                                                                                                                                                                                                  | Receipt                                                                                                                                                                                                                                                                                                                 |
| F8  | No fallback rule (alias, default, context, content, general_settings) and callbacks within the allowlist, **in configuration**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Receipt (`FALLBACK_GATE=PASS`, `CALLBACK_GATE=PASS`). Runtime parity is not verified.                                                                                                                                                                                                                                   |
| F9  | Pinned LiteLLM image (same digest as CI): `/key/update` changes `models`, `rpm_limit`, `tpm_limit`, `max_budget` and `budget_duration` **in place**; the key value is unchanged and the same key keeps authenticating; the key's catalog then lists only the exact alias; an existing `object_permission` row is untouched; an update with explicit `null`s restores the prestate exactly (including `budget_reset_at=null`).                                                                                                                                                                                                                                  | `deploy/release-governance/rehearse-s5-key-policy-update.sh` (S5-R2C), 52 automatic checks over every column of the key, permission and budget rows, exit 0 only if all PASS (section 11) (`VERIFIED_SYNTHETIC_ASSERTED`, lab image only, see 1.1). **Production semantics: `UNVERIFIED`.**                             |
| F10 | Pinned image: `budget_duration: "30d"` is a **calendar-month** budget, not a rolling 30 days. Set on 2026-11-20 it gave `budget_reset_at=2026-12-01 00:00:00` (UTC). In the source, `get_next_standardized_reset_time` → `_handle_day_reset` maps exactly `30d` to `_handle_month_reset` ("monthly reset on 1st", at the configured reset time of day), and `get_budget_window_start` treats `30d` as calendar months. Other values differ: `1d` = next midnight, `7d` = next Monday, other `Nd` = midnight + N days. Consequence: the first window after the change is partial (here 11 days), and a full monthly `max_budget` is available again on the 1st. | Source: `litellm/litellm_core_utils/duration_parser.py` in the lab image (`VERIFIED_SOURCE_LAB_IMAGE`); observed and asserted by check `R2C04_RESET_EXACT_NEXT_MONTH_UTC` (exact next boundary from the UTC clock bracket of the update) (`VERIFIED_SYNTHETIC_ASSERTED`). **Production semantics: `UNVERIFIED`** (1.1). |
| F11 | Pinned image: `object_permission.models` is enforced for **managed agents** (keys with an `agent_id`). For an ordinary virtual key the row governs MCP servers, MCP tool permissions, vector stores, agents, search tools, skills and blocked tools.                                                                                                                                                                                                                                                                                                                                                                                                           | LiteLLM source in the pinned image (`proxy/schema.prisma`, `proxy/auth/auth_checks.py` `can_agent_call_model`, vector-store checks) (`VERIFIED_SOURCE_LAB_IMAGE`, LiteLLM 1.109.1). **Production semantics: `UNVERIFIED`** (1.1).                                                                                       |
| F12 | The S5-R1 auditor (R2A, `3822e09`, sha256 `f200fbc7…8c80`, run unmodified on the lab DB) gives `KEY_POLICY_GATE=FAIL` (`WILDCARD`) on the prestate shape; after the target update it gives `KEY_SCOPE`, `KEY_RATE_LIMITS`, `KEY_BUDGET`, `KEY_VALIDITY` and `KEY_ROUTES` = PASS but keeps **`KEY_POLICY_GATE=NOT_VERIFIED`** with `KEY_INDIRECTION=OBJECT_PERMISSION`. An identical key without `object_permission` gives `KEY_POLICY_GATE=PASS`.                                                                                                                                                                                                              | S5-R2B/R2C rehearsal checks `R2B02_*` (`VERIFIED_SYNTHETIC_ASSERTED`)                                                                                                                                                                                                                                                   |

### 1.1 Lab image provenance and production parity

| Item                     | Value                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lab LiteLLM image        | `litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9` (registry manifest digest). In this lab the local Docker image ID is printed separately and happens to equal it; the two are different identifier types and the harness never treats one as the other. Created 2026-11-12T01:27:10Z, linux/amd64, package `litellm` 1.109.1 (printed by every rehearsal run). Same pin as CI. |
| Lab Postgres image       | `postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663`                                                                                                                                                                                                                                                                                                                                      |
| Image labels             | Chainguard wolfi-base labels; `org.opencontainers.image.source=https://github.com/BerriAI/litellm`. The revision label belongs to the base layer and is **not** used as proof of the LiteLLM commit.                                                                                                                                                                                                                    |
| Production (PM-reported) | `ghcr.io/berriai/litellm-database:main-latest`, local Docker IMAGE ID `sha256:95017a…`. A local image ID and a registry digest are different identifiers: they cannot be compared, and `main-latest` is a moving tag.                                                                                                                                                                                                   |
| Parity                   | **`PRODUCTION_SEMANTICS=UNVERIFIED`.** F9–F12 hold for the lab image only. Before any write, obtain the production image's `RepoDigests` and `litellm` package version privately, then re-run the rehearsal with `LITELLM_IMAGE=<that digest>` and require exit 0. Never rehearse on the production container.                                                                                                          |

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

**Status: `D1=OWNER_OPEN`.** This plan does not choose automatically. PM recommendation (comment
7038526448): **D1-B**, an explicit admin allowlist with no wildcard. It must keep model discovery
separate from approval for inference, cost, consent and fallback, and must allow no auto-approval and
no automatic fallback that bypasses S5. The owner has not decided. No S5 contract or `s5_preflight.py`
change happens before that decision, and it would come in its own PR. The trade-off is only recorded: D1-A needs no contract change but removes every other
model from this key; D1-B keeps the admin-approved catalog but needs a new contract and a separate
functional PR. **Neither option authorizes a key update.** Section 3.1 describes the D1-A target only
because it is the policy the current contract can verify; it is used if, and only if, `GO_D1_SCOPE`
chooses D1-A.

## 3. Key policy remediation (existing dedicated key, in place, no rotation)

### 3.1 Target policy (only if `GO_D1_SCOPE` chooses D1-A)

| Field                                   | Target                                                              | Source of the value                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `models`                                | `["<S5 alias>"]`, exact string, one entry                           | `NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS` in the running Summary (read privately)                             |
| `allowed_routes`                        | `["llm_api_routes"]` (already PASS, unchanged)                      | —                                                                                                       |
| `rpm_limit`                             | positive integer, at or below `NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE` | Summary environment (read privately); equal to the cap unless the owner chooses lower                   |
| `tpm_limit`                             | positive integer, at or below `NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE`   | same                                                                                                    |
| `max_budget`                            | above 0 and at or below `NEWSFLUX_AI_MONTHLY_BUDGET_USD`            | same. A positive cap is required **even if S5 is expected to cost zero**: it bounds an unexpected bill. |
| `budget_duration`                       | `"30d"`                                                             | brief. F10: in the lab image this is a calendar month resetting on the 1st; production `UNVERIFIED`.    |
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

**Contract (unchanged by S5-R2B):** while the key has any `object_permission_id`, the S5-R1 auditor
reports `KEY_INDIRECTION=OBJECT_PERMISSION` and **`KEY_POLICY_GATE=NOT_VERIFIED`**, even after scope,
limits and budget are fixed (F12). The auditor does not inspect the row, and this plan does not change
that classification. Fixing the 3.1 fields therefore cannot by itself make the key gate PASS.

The future classification must keep four cases apart:

| Case                                  | Meaning                                                                                                                                          | Gate effect / action                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Proven empty effective permissions | The row is read, every grant field is empty, no tool permissions, no agent, on a LiteLLM version whose source is checked                         | Still `NOT_VERIFIED` under today's contract. Accepting "empty = safe" needs its own contract, fail-closed tests and PM review (below). Alternatively, unlink the row under `GO_OBJPERM_WRITE`. |
| 2. Present and potentially relevant   | Any grant (MCP servers or groups, tool permissions, vector stores, agents, search tools, skills, toolsets, models with an agent id) is non-empty | `NOT_VERIFIED` or `FAIL`. Plan a separate change, with its own prestate and rollback, to empty or unlink it. The owner decides; never as a side effect of the key update.                      |
| 3. Unknown structure                  | The row is missing, unreadable, or has columns or shapes the classifier does not know                                                            | `NOT_VERIFIED` (fail closed). No write until the structure is understood.                                                                                                                      |
| 4. Production version not equivalent  | The production LiteLLM version (1.1) is not proven equivalent to the source checked for F11                                                      | `NOT_VERIFIED` for cases 1–2 as well: F11 (which fields matter for an ordinary key) must be re-checked against that version's source first.                                                    |

Any future rule that treats an inert row as safe is a **new contract**: it needs its own spec,
fail-closed tests (RED first: unknown column, non-empty grant, missing row, version mismatch → never
PASS) and PM review. It is not part of S5-R2 or S5-R2B.

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
   - `KEY_INDIRECTION` is unchanged. While it is `OBJECT_PERMISSION`, the expected
     `KEY_POLICY_GATE` is **`NOT_VERIFIED`**, not PASS (F12, 3.3). PASS is expected only if the row
     was unlinked under its own `GO_OBJPERM_WRITE` (`KEY_INDIRECTION=NONE`).
   - The private prestate and post-change state are compared field by field, as the rehearsal does:
     only the 3.1 fields (plus `budget_reset_at`, set by LiteLLM) may differ.
   - Every other gate's classification is unchanged.
   - Then run `s5-preflight`. It stays `BLOCKED` (attestation, pricing) and is not expected to pass.
7. **Abort and rollback criteria:**
   - any post-change classification other than the expected one;
   - a fingerprint mismatch;
   - Summary or LiteLLM health regresses;
   - the catalog smoke fails;
   - the prestate file hash differs from the one recorded.

   Rollback is one `/key/update` restoring every prestate value of the 3.1 fields, including
   explicit `null`s (F9). Then compare the full state with the private prestate, field by field
   (`models`, limits, budget, `budget_duration`, `budget_reset_at`, validity, routes, permission link
   and grants, spend), and re-run the auditor against the prestate classifications. A partial
   rollback (any field left over) is an abort-level failure, as the rehearsal asserts.

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
- F9–F12 describe the **lab** LiteLLM image (1.1). `PRODUCTION_SEMANTICS=UNVERIFIED` until the
  rehearsal passes against the production image digest and F11 is re-checked against its source.
- `D1=OPEN`. D1-A disables every other model for this key; D1-B needs a new contract and PR. No key
  write is possible before `GO_D1_SCOPE`.
- With the `object_permission` link in place, `KEY_POLICY_GATE` stays `NOT_VERIFIED` after the key
  fix (F12). Reaching PASS needs either an unlink (`GO_OBJPERM_WRITE`) or a new reviewed contract.
- `30d` gives a partial first budget window (F10); the monthly cap is not prorated.
- The DB/YAML evidence never covers runtime caches, environment overrides or network egress.
- Provider terms change over time. Pricing and privacy evidence needs a review date and re-checking
  before activation.

## 10. S5-R2B rehearsal evidence (lab image, synthetic only)

`deploy/release-governance/rehearse-s5-key-policy-update.sh` runs a disposable LiteLLM + Postgres
(pins in 1.1), a synthetic master key, synthetic keys, and unreachable `*.invalid` providers. It
performs no inference, and never touches the production gateway. Every expectation is a check
printed as `S5R2B <NAME>=PASS|FAIL`; it exits non-zero on any FAIL, on any read or validation failure,
and on a failed cleanup. It prints no key, token hash, fingerprint or DSN. `--self-test` runs the
comparator and check unit tests without Docker.

| Area                                | Checks                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R2B-01 target update                | `/key/update` HTTP 200; `models` exactly `[alias]`; rpm, tpm, `max_budget`, `budget_duration` equal the synthetic target; untouched fields unchanged; `object_permission_id` and its grants unchanged; same key row still authenticates; catalog exactly the alias |
| R2B-02 auditor contract             | Auditor fetched from git at `3822e09`, SHA-256 verified, run unmodified: prestate `FAIL`/`WILDCARD`; after fix other key gates PASS, `KEY_INDIRECTION=OBJECT_PERMISSION`, `KEY_POLICY_GATE=NOT_VERIFIED`; control key without the link `PASS`                      |
| R2B-03 negative cases               | update of a nonexistent key refused (404) with state unchanged; invalid payload refused (422) with state unchanged; partial rollback (rpm omitted) detected by the comparator                                                                                      |
| R2B-03 rollback                     | HTTP 200; the 17 compared columns plus the permission grants equal the structured prestate (incl. `budget_reset_at=null`); catalog equals the prestate catalog; key still authenticates                                                                            |
| R2B-04 budget semantics, provenance | `30d` reset on the 1st at 00:00 UTC; image reference and `litellm` version printed                                                                                                                                                                                 |
| Health, cleanup                     | LiteLLM liveliness before and after; cleanup removes only this run's containers, network and temp dir, then verifies they are gone (`CLEANUP=PASS` or `FAIL`)                                                                                                      |

Results on 2026-11-20:

| Run                                                                                  | Result                                                                        | Exit |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---- |
| RED: previous script (`49d40f0`) with target rpm 6 and rpm omitted from the rollback | Printed rpm 6 after the update and after the "rollback", no check failed      | 0    |
| GREEN: clean run                                                                     | 36 checks PASS, `CLEANUP=PASS`                                                | 0    |
| `S5R2B_FAULT=wrong_target`                                                           | `TARGET_RPM_LIMIT=FAIL` (and the auditor then reports `KEY_RATE_LIMITS=FAIL`) | 1    |
| `S5R2B_FAULT=skip_rollback`                                                          | `ROLLBACK_EQUALS_PRESTATE=FAIL (rpm_limit)`                                   | 1    |
| `S5R2B_FAULT=cleanup`                                                                | `CLEANUP=FAIL`                                                                | 1    |
| `--self-test`                                                                        | `S5R2B_SELF_TEST=PASS`                                                        | 0    |

The previous script's cleanup used `docker rm -f … || true`, which also hid failures; `docker rm -f`
exits 0 for a missing container, so cleanup now verifies absence instead of trusting exit codes.

The R2B checks above are superseded by section 11.

## 11. S5-R2C offline harness closeout (lab image, synthetic only)

Findings PMR2C-01..04 (PM comment 7029579146) are fixed in the same two files. Every check prints
`S5R2C <NAME>=PASS|FAIL`; any FAIL, setup error, unreadable state or unverified cleanup gives a
non-zero exit.

### 11.1 Policy coverage (R2C-01)

Schema discovered at run time from `information_schema` and classified explicitly. An unknown or
missing column fails the run before any key is created (`SCHEMA_*_ALL_CLASSIFIED`). Nothing is presumed
safe.

| Table / class            | Columns (pinned lab image, LiteLLM 1.109.1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Rule                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Key: secret identity (1) | `token`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Row identity only; never printed                                                         |
| Key: target (5)          | `models`, `rpm_limit`, `tpm_limit`, `max_budget`, `budget_duration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Must equal the target after update and the prestate after rollback                       |
| Key: derived (1)         | `budget_reset_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Exact next UTC month boundary after update; null after rollback                          |
| Key: bookkeeping (2)     | `updated_at`, `settings_updated_at`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Observed to move on every `/key/update`; the only columns excluded from equality         |
| Key: invariant (39)      | `key_name`, `key_alias`, `soft_budget_cooldown`, `spend`, `expires`, `aliases`, `config`, `user_id`, `team_id`, `permissions`, `max_parallel_requests`, `metadata`, `blocked`, `allowed_cache_controls`, `model_spend`, `model_max_budget`, `budget_id`, `organization_id`, `created_at`, `created_by`, `updated_by`, `allowed_routes`, `object_permission_id`, `auto_rotate`, `key_rotation_at`, `last_rotation_at`, `rotation_count`, `rotation_interval`, `project_id`, `router_settings`, `policies`, `access_group_ids`, `last_active`, `agent_id`, `budget_limits`, `budget_fallbacks`, `key_type`, `tpd_limit`, `total_spend` | Must not change at any step                                                              |
| Object permission (13)   | `object_permission_id`, `mcp_servers`, `vector_stores`, `mcp_access_groups`, `mcp_tool_permissions`, `agents`, `agent_access_groups`, `blocked_tools`, `models`, `mcp_toolsets`, `search_tools`, `mcp_tool_search_enabled`, `skills`                                                                                                                                                                                                                                                                                                                                                                                                 | Whole row compared; an unknown grant column fails                                        |
| Linked budget row        | every column of `LiteLLM_BudgetTable` for the key's `budget_id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Whole row compared (its own `updated_at`/`updated_by` excluded only after a budget edit) |

- The S5-R1 auditor's `KEY_COLUMNS` and `OPTIONAL_INDIRECTION_COLUMNS`, plus `agent_id`, are read
  from the pinned auditor at run time. All 18 must be compared (`AUDITOR_POLICY_COLUMNS_COMPARED`).
  The R2B comparator missed `budget_id`, `access_group_ids`, `policies` and `agent_id`.
- The rehearsed key carries non-null `budget_id` (with a linked budget row), `access_group_ids`,
  `agent_id`, `metadata`, `permissions` and an object permission, so a reset to null is detectable.
- `agent_id`: the column exists in the lab version, and `/key/generate` accepts it
  (`AGENT_ID_SUPPORTED_IN_LAB`).
- `policies`: the column exists, but setting it returns 403 Enterprise in the lab image
  (`POLICIES_IN_LAB=ENTERPRISE_GATED`). It is compared in every case, and its mutation is injected
  directly into the disposable lab DB.
- **Incidental mutations:** six were each applied, detected and then restored. They cover
  `budget_id`, `access_group_ids`, `agent_id`, `policies`, the permission column `mcp_toolsets` and
  the linked budget row's `max_budget`. The R2B comparator reported all six as `MISSED`; the R2C
  comparator `DETECTED` every one. This is the RED → GREEN for R2C-01.
- **Bounded:** coverage is exact for the lab schema only. A different production version must
  pass the same classification first, because an unknown column fails closed.

### 11.2 Setup fail-closed (R2C-02)

- **Shell mode:** `set -Eeuo pipefail` with an `ERR` trap (`SETUP_STEP=FAIL`) and an `EXIT` trap
  that always runs cleanup and turns any non-zero status into a non-zero exit.
- **Workspace validation:** the workspace is `mktemp -d "$TMPDIR/s5r2c.XXXXXXXX"`. Before anything
  is written, the script checks that it is non-empty, a real directory (not a symlink) and has the
  expected prefix. Cleanup removes it only if it passed that validation, so there is never an
  `rm -rf ""`.
- **File modes:** they are verified after `chmod`.
- **RED:** the R2B script run with `TMPDIR` pointing to a missing directory printed the `mktemp`
  error, wrote `/config.yaml`, `/probe.py` and `/s5_audit.py` to the filesystem root, and still
  finished with 36/36 PASS, exit 0. Those three files were removed afterwards.
- **GREEN:** `--self-test` runs the three setup faults (`setup_mktemp`, `setup_write`,
  `setup_chmod`) in a sandboxed `TMPDIR` and a separate empty working directory. Each must:
  - exit non-zero with `SETUP_STEP=FAIL`;
  - finish with `CLEANUP=PASS`;
  - create no container or network;
  - leave both directories empty;
  - leave no file at `/` or in the repository root;
  - leave the repository's git status unchanged.

### 11.3 Negative HTTP contract (R2C-03)

Contract confirmed in the lab image:

| Case            | Response that counts as the intended refusal                            |
| --------------- | ----------------------------------------------------------------------- |
| Missing key     | HTTP 404 with `error.type=not_found_error` and `code=404`               |
| Invalid payload | HTTP 422 with `detail[].type=int_parsing` at `loc=["body","rpm_limit"]` |

- **Anything else fails.** That includes 401 (`token_not_found_in_db`), 403, 500, a non-JSON body,
  a 404 without the not-found type, and a 422 on another field.
- **Each refusal must leave the legitimate key unchanged** across all compared columns and linked
  rows.
- **RED:** the R2B predicate (`status != 200`) accepts 401, 403 and 500. The self-test proves this
  through real HTTP round trips against a local stub that returns each of those codes.
- **GREEN:** the R2C classifier rejects all of them in the same stub test. Live, `S5R2C_FAULT=neg_401`
  makes both negative checks FAIL with status 401.

### 11.4 Reset date, provenance, cleanup (R2C-04)

- **Reset date:** the update call is bracketed by UTC clock reads. `budget_reset_at` must equal the
  first day of the month after the update time, at 00:00:00 UTC, and must be later than the update.
  This matches `_handle_month_reset` in the lab source: the 1st at 00:00 of the current month has
  always passed, so the reset rolls to the next month.
- **RED (reset):** the R2B check (`day 01 and 00:00:00`) accepts stale dates such as `2020-01-01`
  and `2026-11-01`. GREEN: the new check rejects them, and also rejects the right day with the wrong
  second and the wrong day of the right month. Both are proven in the self-test.
- **Provenance is mandatory:**
  - the image reference must be pinned by `@sha256`;
  - the image's `RepoDigests` must contain that manifest digest;
  - the running container's image must equal the local image ID;
  - the `litellm` package version must be exactly the approved one (`1.109.1` for the default pin).
    A non-default image needs `S5R2C_EXPECTED_LITELLM_VERSION`.
- **Versions that fail the gate:** `UNKNOWN`, an empty value, `1.109.2` and `1.109.1rc1`. All of
  these exit non-zero before the probe runs.
- **Identifiers printed separately:** the manifest digest, the local image ID and the package
  version, with `PRODUCTION_PARITY=UNVERIFIED`.
- **Cleanup:** it verifies that each container and the network are absent, by exact-name listing.
  A listing that fails, or a resource still present, gives `CLEANUP=FAIL` and a non-zero exit, as
  does an injected failed network removal.

### 11.5 Results (2026-11-20, lab image)

| Run                                    | Result                                                                                                       | Exit |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---- |
| RED R2C-02: R2B script, missing TMPDIR | stray writes at `/`, 36/36 PASS                                                                              | 0    |
| GREEN: clean run                       | 52/52 PASS, containers and network absent, `CLEANUP=PASS`                                                    | 0    |
| `--self-test`                          | Python unit + stub HTTP tests PASS; `setup_mktemp`, `setup_write`, `setup_chmod` each PASS                   | 0    |
| `S5R2C_FAULT=unknown_column`           | `SCHEMA_KEY_COLUMNS_ALL_CLASSIFIED=FAIL`, `SCHEMA_OBJPERM_COLUMNS_ALL_CLASSIFIED=FAIL`; stops before any key | 1    |
| `S5R2C_FAULT=wrong_target`             | `TARGET_RPM_LIMIT=FAIL`                                                                                      | 1    |
| `S5R2C_FAULT=neg_401`                  | both negative refusal checks FAIL (status 401)                                                               | 1    |
| `S5R2C_FAULT=skip_rollback`            | `ROLLBACK_EQUALS_PRESTATE=FAIL (rpm_limit)`, `FINAL_STATE_EQUALS_PRESTATE=FAIL`                              | 1    |
| `S5R2C_FAULT=cleanup`                  | `CLEANUP=FAIL`                                                                                               | 1    |

The final campaign repeats all of the above from a clean clone of the final HEAD; its results are
recorded in the PR #271 follow-up and the homeserver ledger (a commit cannot contain its own run).

### 11.6 Offline readiness

`LAB_OFFLINE_HARNESS=READY_FOR_PM_REVIEW` for the **lab image only**. This harness can support a
future intervention only as a pre-check run against the production image's digest and version, which
the owner supplies privately (`PRODUCTION_SEMANTICS=UNVERIFIED` until then). It authorizes no write.
`D1=OPEN`. `KEY_POLICY_GATE` stays `NOT_VERIFIED` while the object permission is linked.
`S5_PREFLIGHT=BLOCKED` and `S5_ACTIVATION=NO_GO` are unchanged.

## 12. S5-R3 pre-replay ownership guard (PM comment 7038526448)

The PM found that cleanup addressed resources **by name** and that `S5R2C_RUN_ID` can be set by the
caller. A collision with an existing name could therefore remove resources the run did not create.

- **RED:** reproduced against `988b072`. A decoy container and a decoy network were created under
  this run's names, with no labels. A run that failed before creating anything (`setup_mktemp`) still
  removed both, and reported `CLEANUP=PASS`.
- **Fix, in `rehearse-s5-key-policy-update.sh` only:**
  - **Unique run:** each run has a unique ID (UTC timestamp plus nonce) and a random 16-hex nonce
    that never appears in a name.
  - **Names checked first:** the run refuses to start if any name it would use already exists
    (`OWNERSHIP_PREEXISTING=FAIL`). In that case nothing is created and nothing is removed.
  - **Labels and IDs:** every created resource carries `org.newsflux.s5r2c.run=<run>` and
    `org.newsflux.s5r2c.owner=<nonce>`. Its full ID is recorded (`OWNED_*`), and later
    `exec`/`cp`/`inspect` calls use that ID, not the name.
  - **Owned-only cleanup:** cleanup removes only resources whose owner label equals this run's nonce,
    by ID. It also finds a container that was created but never started, by name **and** nonce. It
    verifies each one is absent, then that nothing with the nonce remains.
  - **Unowned resources:** any resource that is not owned is reported (`CLEANUP_OWNERSHIP=FAIL`) and
    never removed.
  - **No early removal:** a run that fails before creating anything issues **no** Docker removal
    (`CLEANUP_DOCKER=NOT_NEEDED`).
- **Tests (`--ownership-test`, real Docker), 5/5 PASS:**
  - decoys survive an early failure;
  - a container name collision is refused;
  - a network name collision is refused;
  - with a partial creation, only owned resources are removed, and a bystander with the same run
    label but another nonce survives;
  - a container that was created but could not start is adopted and removed.
- **Regression:** `--self-test` PASS, full rehearsal 52/52 PASS with owned IDs recorded and verified
  absent, and the `cleanup` fault exits 1 without touching an unowned ID.

**Scope of the guarantees (PM note):**

- **Bounded comparisons:** the harness compares a bounded set of fields, columns and rows in the lab
  image's schema. It does not guarantee arbitrary runtime behaviour, caches, environment overrides or
  egress.
- **`policies`:** in this image the field is gated to LiteLLM Enterprise. It is compared, but only
  its null value is exercised through the API.
- **Not an attestation:** none of this is a production attestation, and `PRODUCTION_PARITY` stays
  `UNVERIFIED`.

The read-only auditor increment, the image inventory and the lab equivalence procedure are on branch
`claude/newsflux-s5-r3-readonly-increment` (`docs/ops/S5_R3_READONLY_INCREMENT.md`).
