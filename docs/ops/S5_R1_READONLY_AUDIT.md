# S5-R1: read-only LiteLLM audit without a new admin key

Track: `NEWSFLUX_S5_R1`. Status: development only. This document authorizes no production change,
no `enable-s5`, no inference, no `/key/update`, no LiteLLM or Postgres write, no merge and no deploy.

## 1. Evidence reconciliation (what is known for S5, and from where)

| Source                                                                                                                       | Date       | Model it is about          | What it showed                                                                                                                                                                                                                                           | Valid as current S5 evidence?                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R4B-R2 read-only DB classification ([#260 6956716798](https://github.com/jfsdias/NewsFlux/pull/260#issuecomment-6956716798)) | 2026-11-17 | Local Ollama `llama3.2:3b` | The key matched exactly one row. `models` has **1** entry, which is **not** the Ollama alias. `allowed_routes=["llm_api_routes"]`. Not blocked or expired. **RPM, TPM, `max_budget` and `budget_duration` missing.** DB fallback settings were declared. | **No.** It is a historical, operator-reported read about another target model. It is re-checked below for S5. |
| Owner decision ([#260 6957016178](https://github.com/jfsdias/NewsFlux/pull/260#issuecomment-6957016178))                     | 2026-11-17 | Key ownership              | The virtual key is **dedicated to NewsFlux** (owner-reported). Rotation is not indicated. The preferred change is an in-place policy update after a GO.                                                                                                  | Yes, as an ownership statement (`REPORTED_OWNER`). It is not technical proof of consumers.                    |
| Owner constraint ([#260 6948942250](https://github.com/jfsdias/NewsFlux/pull/260#issuecomment-6948942250))                   | 2026-11-17 | Audit method               | Do not create a `proxy_admin_viewer` key. Use the access that already exists.                                                                                                                                                                            | Yes: a standing constraint.                                                                                   |
| Release `12929fb` receipt (homeserver ledger, 2026-11-19)                                                                    | 2026-11-19 | S5                         | `S5_PREFLIGHT=BLOCKED`, `KEY_INFO_ACCESS=HTTP_403` (expected for an `llm_api_routes` key), key gates `NOT_VERIFIED`, `GATEWAY_PRICE=NOT_PUBLISHED`, `PROVIDER_COST_CONFIRMATION=MISSING`. Local gates, catalog and logging `PASS`.                       | Yes for those gates on that day (`REPORTED_OPERATOR`). It contains no key policy evidence.                    |

What the old R4B-R2 read implies for S5, and what it does not:

- **Limits and budget.** RPM, TPM and budget are key-level fields. If nobody changed the key since
  2026-11-17, `KEY_RATE_LIMITS` and `KEY_BUDGET` will still be `FAIL` for S5. This is an expectation to
  confirm, not a result.
- **Scope.** "1 model, not the Ollama alias" says nothing about whether that one model **is** the S5
  alias. That is exactly what `KEY_SCOPE` must establish now.
- **Not transferable.** The Ollama deployment, provider and endpoint findings do not apply to S5. The
  S5 alias has its own deployments, provider, fallbacks and price.

## 2. The S5-R1 auditor

`ops/deploy/release-governance/s5_db_readonly_audit.py` is a single file, stdlib-only on the host. It
uses only access that already exists on the OMV host, as the R4B-R2 approach did:

- **Summary container (UID 10001).** It derives the domain-separated key fingerprint (the same value
  the official attestation binds to), the configured S5 alias and the app's RPM/TPM/budget caps. The
  virtual key never leaves the container.
- **LiteLLM container.** It runs the probe with its own `DATABASE_URL` and installed `psycopg`:
  - the connection is `read_only` (`BEGIN READ ONLY`), checked with `SHOW transaction_read_only = on`;
  - the statement timeout is 5 s;
  - only `SELECT` statements run;
  - the transaction is rolled back at the end.
- **YAML and prices.** It also reads the YAML named on LiteLLM's own command line, and LiteLLM's
  **bundled local** price map. It makes no network call.
- **Data in transit.** The alias and the fingerprint travel on stdin, never on argv. LiteLLM's token
  hashes never leave the LiteLLM process: they are compared there by fingerprint.
- **Output.** Enums and counts only. The host refuses any value that is not `[A-Z0-9_,]` or a number.
  It never prints the key, token hash, fingerprint, alias, deployment or model names, URLs, DSN, raw
  rows or provider settings.

### Gates reported (prefix `S5R1_`)

| Gate                    | PASS only if                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KEY_POLICY_GATE`       | All of the following hold: exactly one key matches the fingerprint (an exact match computed inside Postgres over every row, with no scan limit); it is not blocked and not expired; `models` is **exactly** the one-element list `["<S5 alias>"]` (duplicates, non-string entries, non-list values, empty, wildcard, extra or other models fail); `allowed_routes` is exactly `["llm_api_routes"]`; RPM and TPM are positive **and** at or below the NewsFlux caps (a missing app cap never passes); `0 < max_budget <= app budget`; a budget window exists; spend is known and below budget (unknown spend gives `KEY_BUDGET=NOT_VERIFIED`, never zero). Limits are read from the key or its `LiteLLM_BudgetTable` row. Any key-level `aliases` remap or `router_settings` gives **FAIL**. Team, access-group, policy or object-permission inheritance gives **NOT_VERIFIED**. |
| `MODEL_ROUTE_GATE`      | At least one enabled S5 deployment (DB and YAML both counted), one provider family, no key alias remap, and a complete deployment read. A count above the read bound gives `DEPLOYMENTS_DB=NOT_VERIFIED_TRUNCATED` and `NOT_VERIFIED`. An `OTHER` provider, a custom endpoint, partly blocked deployments, or no deployment found while the YAML could not be read all give `NOT_VERIFIED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `FALLBACK_GATE`         | No `fallbacks`, `context_window_fallbacks` or `content_policy_fallbacks` rule for the S5 alias, no `*` rule and no `default_fallbacks`. These are checked in DB `router_settings` and `litellm_settings`, the YAML, and the key's own `router_settings`. An unparseable shape gives `NOT_VERIFIED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PRICING_GATE`          | **Never PASS here.** A non-zero configured or published price gives `FAIL`. Configured zero gives `NOT_VERIFIED_PROVIDER_TERMS`, because a zero in LiteLLM only means zero recorded spend. Otherwise `NOT_VERIFIED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `CALLBACK_GATE`         | The configured success, failure, generic and service callbacks (DB and YAML) are a subset of `NEWSFLUX_AI_ALLOWED_LITELLM_CALLBACKS`. Only `null`, `""` or `[]` mean "no callback". Any other shape (mapping, nested list, number, a non-mapping settings block) is reported as `UNRECOGNIZED` and gives `NOT_VERIFIED`, or `FAIL` if a known disallowed callback is also present. The runtime list is still checked separately by `s5-preflight`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `PROVIDER_PRIVACY_GATE` | **Never PASS here.** It is always `NOT_VERIFIED_OPERATOR_TERMS_REQUIRED`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OFFICIAL_ATTESTATION`  | Always `HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE`, with `EVIDENCE_KIND=DIAGNOSTIC_DB_CONFIG_READONLY` and `S5_PREFLIGHT_EFFECT=NONE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

The host refuses to run in four cases: not root; `NEWSFLUX_AI_INFERENCE_ENABLED` or
`NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER` is `true`; the Summary or LiteLLM container is not
unique; the probe's output is not a safe enum. Every Python it starts inside a container runs with
`-B`, so no bytecode is written. The receipt states only what the tool can show:

- `DELIBERATE_DB_CONFIG_WRITES=NONE`: read-only transaction, `SELECT` only, no write issued.
- `CONTAINER_IDENTITY=UNCHANGED|CHANGED`: ID, image, start time, restart count and state, before and
  after the run.
- `FILESYSTEM_INTEGRITY=NOT_PROVEN`: an unchanged container identity is not proof that no file
  changed. The tool does not claim that.

**`general_settings` (corrective R2A).** It is read from the DB and the YAML. In the tested LiteLLM
version the proxy consumes fallbacks only from `router_settings` and `litellm_settings`. A fallback
key found in `general_settings` is therefore reported as `FALLBACK_GENERAL_SETTINGS=PRESENT_UNVERIFIED_SEMANTICS`
and keeps `FALLBACK_GATE` from `PASS` (`NOT_VERIFIED`). It is never claimed to be effective. A key
`aliases` or `router_settings` value that is not a mapping is reported as `*_UNRECOGNIZED` and never
read as "no indirection". Port 11434 alone never makes an endpoint local: only the `ollama` service
name and loopback addresses do.

**The YAML is a required source (corrective R2).** The route, fallback and callback gates can only
pass when LiteLLM's YAML was read and is a mapping whose `model_list`, `router_settings` and
`litellm_settings` sections have the expected shapes. Otherwise `YAML_CONFIG` is `NOT_FOUND`,
`UNREADABLE`, `INVALID_ROOT` or `INVALID_STRUCTURE`, and any of those three gates that would have
passed becomes `NOT_VERIFIED`. A `FAIL` proven from the DB is kept. A LiteLLM that genuinely runs
without a YAML therefore never reaches `PASS` on these gates. That is intentional fail-closed
behaviour.

On an older LiteLLM schema, the probe selects only the columns that exist. Missing required columns
give `DB_SCHEMA_UNSUPPORTED`. A missing optional indirection column means that mechanism does not
exist in that version, reported as `KEY_SCHEMA=PARTIAL_OPTIONAL`. A missing `allowed_routes` column
gives `KEY_ROUTES=NOT_VERIFIED`.

### Evidence for the tool (synthetic only)

| Kind                                                            | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit tests (78)                                                 | `ops/deploy/release-governance/test_s5_db_readonly_audit.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Real LiteLLM + Postgres + Summary image, disposable (19 checks) | `ops/deploy/release-governance/rehearse-s5-db-audit.sh`, pinned to the same LiteLLM image as `rehearse-s5-key-gate.sh`, CI `synthetic-release`. It uses real `/key/generate` keys, the real Prisma schema and token storage, and the exact operator bootstrap. It shows that the probe's transaction refuses an `UPDATE`, that a missing, list-rooted or unparseable YAML never yields `PASS`, and runs the host entry point (the operator command) end to end against a real Summary image labelled like production. |

## 3. Official attestation: `HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE`

The S5 preflight accepts key evidence only as `SELF_INTROSPECTION` or as `LIVE_LITELLM_ADMIN_READ`.
The first is impossible with an `llm_api_routes` key (HTTP 403, by design). The second, `s5_key_audit.py`,
needs an admin credential, and the owner declined to create one. **The preflight is unchanged and
`S5_PREFLIGHT` stays `BLOCKED`.** The DB read is diagnostic evidence for the PM. It is never presented
as an attestation.

There are two minimal ways out. Neither is implemented or authorized here; each needs its own GO.

- **A. No code change.** If an administrative credential **already exists** (for example, the owner
  operates LiteLLM with its master key), the owner can run the official `s5_key_audit.py`
  interactively. `S5_KEY_GATE.md` allows the master key "only interactively and never stored next to
  the application". This changes nothing in the contract. It does mean handing that credential to the
  tool through a private file, so it needs the owner's explicit decision. No new key is created.
- **B. Isolated PR (proposal).** Add a second evidence kind, `LITELLM_DB_READONLY_ATTESTATION`, under a
  contract the PM revises first:
  - **Producer:** this auditor, run as root on the host. It writes a 0600 attestation with the same
    key fields as the official one.
  - **Binding and freshness:** the same fingerprint binding and the same 24 h maximum age.
  - **Provenance:** a read-only proof, the LiteLLM image digest and the schema class.
  - **Preflight change:** the preflight accepts the new kind only when explicitly enabled, keeps every
    gate identical, and still requires the provider-cost confirmation.
  - **Why it is sound:** LiteLLM's DB is the store the proxy itself authorizes keys from.
  - **Why it is weaker:** it bypasses LiteLLM's API layer, so a cache or an environment override at
    runtime is not covered.
  - **Required tests (TDD):** the kind is refused unless enabled; a stale or mismatched attestation is
    rejected; every gate is unchanged; the PASS/BLOCKED matrix is identical to the official kind on the
    same synthetic rows; and a real-LiteLLM rehearsal against `rehearse-s5-key-gate.sh` passes.

## 4. Pricing and provider privacy: independent gates

Neither the alias name ("Free") nor a configured zero proves gratuity. Neither gate can be satisfied
from configuration. The auditor reports `PROVIDER_FAMILY` (for example `OPENROUTER`, `GROQ`, `GEMINI`)
so the owner knows **which** terms to review. The owner then records, with a date and a reference:

1. **Cost.** Whether that provider's model is billed at zero for this account. Free tiers can change,
   can have quotas that fall back to paid, and can require a payment method on file. Only then use
   `--confirm-provider-cost-zero --reference "<terms, date>"` (official path A or B).
2. **Retention and training.** Whether prompts (article text) are logged, retained, used for training
   or reviewed by humans, under the provider's current data policy for the tier in use. If prompts are
   used for training, or the policy is unknown, keep `NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER=false`.
3. **Routing intermediaries.** If the family is an aggregator (for example `OPENROUTER`), its own
   policy **and** the upstream provider's policy both apply.
4. **Published price map.** `PUBLISHED_PRICE_MAP` comes from LiteLLM's bundled map in the image. It is
   a hint, not the provider's bill.

## 5. Correction of the existing key's policy: plan only (not applied)

The key is owner-confirmed as dedicated to NewsFlux, so the plan is an **in-place** policy update. It
does not rotate the key or create a new one.

- **Target policy**, from `S5_KEY_GATE.md`:
  - `models: ["<S5 alias>"]`
  - `allowed_routes: ["llm_api_routes"]`
  - `rpm_limit` and `tpm_limit` at or below the Summary caps (`NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE`,
    `NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE`)
  - `max_budget` at or below `NEWSFLUX_AI_MONTHLY_BUDGET_USD`
  - `budget_duration: "30d"`
  - no key `aliases`, no key `router_settings`, no team
- **Prestate:**
  - Run the S5-R1 auditor and keep the receipt.
  - The owner records the current field values **privately** (host file, 0600) from the admin UI
    session that already exists. They are never posted.
  - Confirm that `last_active` matches only NewsFlux traffic.
- **Change:** only after a specific GO. Use the owner's existing admin session (LiteLLM UI "Edit Key"
  or `POST /key/update` with the existing admin credential). The key value does not change.
- **Readback:**
  - Re-run the S5-R1 auditor. `KEY_POLICY_GATE` must be `PASS`, with the container state unchanged.
  - Then `s5-preflight`, which stays `BLOCKED` until the official attestation and the provider
    confirmation exist.
- **Rollback:** restore the recorded prestate values with the same mechanism, then re-run the auditor.
  Keys are not deleted or regenerated at any point.
- **Gateway side:** remove or scope any S5 fallback the auditor reports (`FALLBACK_GATE=FAIL`), and set
  an explicit `input_cost_per_token: 0` / `output_cost_per_token: 0` on the S5 deployment **only if**
  the provider terms confirm it. This is a separate gateway change with its own GO, and is never mixed
  into the Summary code.

## 6. OMV command (read-only)

The command is pinned to an exact commit and checks the file's SHA-256 before running it. It needs
root on the OMV host. It does not need the release directory. The current pin is in the PR handoff.
