# S5-R2: key policy and provider remediation plan (offline, read-only)

Track: `NEWSFLUX_S5_R2_KEY_AND_PROVIDER_REMEDIATION_PLAN_OFFLINE`. Status: **plan only**. Revised by
S5-R2B (offline evidence hardening): rehearsal facts are now assertion-backed (section 10), D1 stays
open (section 2), and the `OBJECT_PERMISSION` handling follows the S5-R1 auditor contract (3.3).

This document authorizes nothing. In particular it does not authorize:

- a key update;
- creating a credential;
- a LiteLLM or Postgres write;
- inference or sending articles;
- a deploy;
- changes to `s5_preflight.py`.

Every write step below needs its own GO (section 8).

## 1. Facts and their evidence level

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Exactly one LiteLLM key matches the Summary key's fingerprint. It is valid and not blocked, its routes are exactly `llm_api_routes`, and its spend is known.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | OMV run of the S5-R1 auditor `3822e09` (`REPORTED_OPERATOR`, [PR #271 7027705548](https://github.com/jfsdias/NewsFlux/pull/271#issuecomment-7027705548))                                                                                                  |
| F2  | `KEY_SCOPE_DETAIL=WILDCARD`, `KEY_MODELS_COUNT=1`. The single `models` entry is `all-proxy-models`, `all-team-models`, `*` or contains `*`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same receipt; auditor `classify_scope` (`CONFIRMED_GITHUB`)                                                                                                                                                                                               |
| F3  | The entry is very likely `all-proxy-models`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Owner screenshot 2026-11-17: dedicated NewsFlux key, `Models=all-proxy-models`, RPM/TPM "Unlimited" (`USER_SUPPLIED_SCREENSHOT`, homeserver `2026-11-17-newsflux-ai-settings-01-ui-key-models-architecture.md`). **`INFERENCE`, not a current read.**     |
| F4  | `KEY_RATE_LIMITS=FAIL` with `KEY_RPM_WITHIN_APP=KEY_TPM_WITHIN_APP=NOT_APPLICABLE`. The key's RPM and TPM are not positive integers (null, zero, negative or non-integer). The Summary caps exist (otherwise `APP_CAP_MISSING`).                                                                                                                                                                                                                                                                                                                                                                                                                               | Receipt + auditor `classify_key`. Consistent with F3 ("Unlimited") and with R4B-R2 (2026-11-17: RPM/TPM `MISSING`).                                                                                                                                       |
| F5  | `KEY_BUDGET=FAIL` with spend known. At least one of these holds: `max_budget` missing, non-numeric or ≤ 0; `max_budget` above the Summary monthly cap; `budget_duration` missing or blank; Summary budget cap missing; spend ≥ `max_budget`. **The receipt does not say which.**                                                                                                                                                                                                                                                                                                                                                                               | Receipt + auditor. R4B-R2 (2026-11-17) reported `max_budget` `MISSING` and `budget_duration` `MISSING_OR_INVALID`. That is two days old and was about another model, so it is **`INFERENCE`: probable, not confirmed**.                                   |
| F6  | `KEY_INDIRECTION=OBJECT_PERMISSION`: the key has an `object_permission_id`. Its contents are **unknown**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Receipt                                                                                                                                                                                                                                                   |
| F7  | One S5 deployment, in the DB, enabled. Its provider prefix is not in the auditor's family list (`OTHER`), and it has an `api_base` that is neither the `ollama` service nor loopback (`CUSTOM_ENDPOINT`). No cost in `model_info` (`NOT_PUBLISHED`). Its model string is not in the image's bundled price map (`NOT_LISTED`).                                                                                                                                                                                                                                                                                                                                  | Receipt                                                                                                                                                                                                                                                   |
| F8  | No fallback rule (alias, default, context, content, general_settings) and callbacks within the allowlist, **in configuration**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Receipt (`FALLBACK_GATE=PASS`, `CALLBACK_GATE=PASS`). Runtime parity is not verified.                                                                                                                                                                     |
| F9  | Pinned LiteLLM image (same digest as CI): `/key/update` changes `models`, `rpm_limit`, `tpm_limit`, `max_budget` and `budget_duration` **in place**; the key value is unchanged and the same key keeps authenticating; the key's catalog then lists only the exact alias; an existing `object_permission` row is untouched; an update with explicit `null`s restores the prestate exactly (including `budget_reset_at=null`).                                                                                                                                                                                                                                  | `deploy/release-governance/rehearse-s5-key-policy-update.sh` (S5-R2B), 36 automatic checks, exit 0 only if all PASS (section 10) (`VERIFIED_SYNTHETIC_ASSERTED`, lab image only, see 1.1). **Production semantics: `UNVERIFIED`.**                        |
| F10 | Pinned image: `budget_duration: "30d"` is a **calendar-month** budget, not a rolling 30 days. Set on 2026-11-20 it gave `budget_reset_at=2026-12-01 00:00:00` (UTC). In the source, `get_next_standardized_reset_time` → `_handle_day_reset` maps exactly `30d` to `_handle_month_reset` ("monthly reset on 1st", at the configured reset time of day), and `get_budget_window_start` treats `30d` as calendar months. Other values differ: `1d` = next midnight, `7d` = next Monday, other `Nd` = midnight + N days. Consequence: the first window after the change is partial (here 11 days), and a full monthly `max_budget` is available again on the 1st. | Source: `litellm/litellm_core_utils/duration_parser.py` in the lab image (`VERIFIED_SOURCE_LAB_IMAGE`); observed and asserted by check `R2B04_30D_RESET_ON_CALENDAR_FIRST` (`VERIFIED_SYNTHETIC_ASSERTED`). **Production semantics: `UNVERIFIED`** (1.1). |
| F11 | Pinned image: `object_permission.models` is enforced for **managed agents** (keys with an `agent_id`). For an ordinary virtual key the row governs MCP servers, MCP tool permissions, vector stores, agents, search tools, skills and blocked tools.                                                                                                                                                                                                                                                                                                                                                                                                           | LiteLLM source in the pinned image (`proxy/schema.prisma`, `proxy/auth/auth_checks.py` `can_agent_call_model`, vector-store checks) (`VERIFIED_SOURCE_LAB_IMAGE`, LiteLLM 1.109.1). **Production semantics: `UNVERIFIED`** (1.1).                         |
| F12 | The S5-R1 auditor (R2A, `3822e09`, sha256 `f200fbc7…8c80`, run unmodified on the lab DB) gives `KEY_POLICY_GATE=FAIL` (`WILDCARD`) on the prestate shape; after the target update it gives `KEY_SCOPE`, `KEY_RATE_LIMITS`, `KEY_BUDGET`, `KEY_VALIDITY` and `KEY_ROUTES` = PASS but keeps **`KEY_POLICY_GATE=NOT_VERIFIED`** with `KEY_INDIRECTION=OBJECT_PERMISSION`. An identical key without `object_permission` gives `KEY_POLICY_GATE=PASS`.                                                                                                                                                                                                              | S5-R2B rehearsal checks `R2B02_*` (`VERIFIED_SYNTHETIC_ASSERTED`)                                                                                                                                                                                         |

### 1.1 Lab image provenance and production parity

| Item                     | Value                                                                                                                                                                                                                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lab LiteLLM image        | `litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9` (registry digest; local image Id equals it), created 2026-11-12T01:27:10Z, linux/amd64, package `litellm` 1.109.1 (printed by every rehearsal run). Same pin as CI.                                                  |
| Lab Postgres image       | `postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663`                                                                                                                                                                                                                             |
| Image labels             | Chainguard wolfi-base labels; `org.opencontainers.image.source=https://github.com/BerriAI/litellm`. The revision label belongs to the base layer and is **not** used as proof of the LiteLLM commit.                                                                                                           |
| Production (PM-reported) | `ghcr.io/berriai/litellm-database:main-latest`, local Docker IMAGE ID `sha256:95017a…`. A local image ID and a registry digest are different identifiers: they cannot be compared, and `main-latest` is a moving tag.                                                                                          |
| Parity                   | **`PRODUCTION_SEMANTICS=UNVERIFIED`.** F9–F12 hold for the lab image only. Before any write, obtain the production image's `RepoDigests` and `litellm` package version privately, then re-run the rehearsal with `LITELLM_IMAGE=<that digest>` and require exit 0. Never rehearse on the production container. |

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

**Status: `D1=OPEN` (owner + PM).** This plan makes no recommendation and does not choose
automatically. The trade-off is only recorded: D1-A needs no contract change but removes every other
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
