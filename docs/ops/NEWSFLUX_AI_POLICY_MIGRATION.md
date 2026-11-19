# NewsFlux AI — explicit LEGACY → MANAGED policy migration and inert model preferences

Track: NEWSFLUX-AI-POLICY-FALLBACK-01. Status: development only. This document does not
authorize any production change, deploy, merge or flag activation.

## Why

Before this change, the first authorized admin write (`save-key`, `approve-model`,
`save-policy`) on a server without `NEWSFLUX_AI_MODEL_POLICY_JSON` turned the implicit legacy
policy (the S5 and Mistral Small aliases from environment variables) into an explicit empty
allowlist. The legacy models stopped running without any preview or confirmation.

## Migration contract (P0)

| Item                 | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Policy sources       | `status.policy_source`: `legacy` (no policy JSON, bootstrap), `environment` (policy JSON, bootstrap), `managed` (record in the admin store).                                                                                                                                                                                                                                                                                                                                         |
| Pending migration    | `status.migration_required` is true when the source is `legacy` and at least one legacy alias is configured.                                                                                                                                                                                                                                                                                                                                                                         |
| Implicit first write | Refused with `MIGRATION_REQUIRED` (HTTP 409). The check runs in each public method and again under the write lock in `_save`. No file is written.                                                                                                                                                                                                                                                                                                                                    |
| Preview              | `GET /api/ai/v1/admin/litellm/migration-preview` (admin only, read-only, allowed with writes OFF). Per legacy model: alias, found on the gateway, chat or not, identity verified, local or external (external only when the identity is verified), price class, whether the gateway price matches the legacy setting, consents needed later, and blockers. Never returns the key, provider identity, upstream host or prices.                                                        |
| Preview token        | HMAC-SHA256 with a per-process random secret over revision, current key, gateway state and rows. A changed gateway, key, revision or a process restart makes it stale.                                                                                                                                                                                                                                                                                                               |
| Migrate              | `POST /api/ai/v1/admin/litellm/migrate-policy` with exactly `{expected_revision, preview_token, confirm: "MIGRATE-LEGACY-POLICY"}`. Requires writes enabled, the current revision, a verified gateway and a fresh token. A wrong confirmation gives 422 `MIGRATION_NOT_CONFIRMED`; a stale or forged token or revision gives 409 `CONFIG_CONFLICT`; a gateway failure gives 503 `KEY_UNVERIFIED`. The unlocked pre-check means a failed attempt does not create the store directory. |
| Result               | The key is unchanged. The policy is `{"version":1,"models":[]}`: no model is approved. Each legacy model must be approved through the existing per-model flow, with external and paid consent. The record schema is unchanged (`version, revision, key, policy`), so earlier builds can still read it.                                                                                                                                                                               |
| Audit                | `migration.json` (0600) with source, new and previous revision, UTC time and the legacy model ids, aliases and labels. No credential.                                                                                                                                                                                                                                                                                                                                                |
| Atomicity            | Order: `previous.json`, `activated`, `migration.json`, `settings.json`. If the record write fails, the marker and audit are withdrawn and legacy stays authoritative. If the process dies after the marker, the store fails closed (`CONFIG_UNAVAILABLE`), never back to legacy.                                                                                                                                                                                                     |
| Concurrency          | The file lock plus the revision compare-and-swap: of two concurrent migrations exactly one commits; the other gets `CONFIG_CONFLICT`.                                                                                                                                                                                                                                                                                                                                                |

## Operator revert (rollback)

There is no HTTP route. Run it inside the Summary container as the service user. It works
with admin writes OFF.

```bash
python -m services.article_intel_summary.operator_revert_legacy_migration_ai_settings --expected-revision <32-hex current revision> --confirm REVERT_NEWSFLUX_AI_LEGACY_MIGRATION
```

- It requires the exact current revision, an intact `migration.json`, the managed key equal to
  the bootstrap key (so a replaced key is never silently reverted), and an environment that
  is still LEGACY.
- It moves `settings.json`, `previous.json`, `migration.json` and then `activated` into
  `legacy-revert-<revision>/` (0700) inside the admin store. Nothing is deleted. The record
  moves first, so an interruption fails closed. Running it again with the same revision
  completes an interrupted revert. Running it after it has completed is a conflict.
- Output is classification lines only (`REVERT=PASS_LEGACY_BOOTSTRAP_RESTORED`,
  `RAW_CREDENTIAL_EXPORTED=NO`). The read-only preflight now reports `POLICY_SOURCE` and
  `LEGACY_MIGRATION_REQUIRED`.

## Inert primary and fallback preference (P1)

- Primary and fallback stay in the existing browser settings (`aiSummaryModel`,
  `aiSummaryFallbackEnabled`, `aiSummaryFallbackModel`). There is no new storage and no
  server write.
- Unavailable catalog models can be selected and saved. Each one is shown as a saved
  preference that does not run. A saved model that is no longer in the catalog stays visible,
  checked and disabled ("saved, no longer offered"). It is never rewritten or replaced.
- The fallback list never offers the primary. A saved fallback equal to the primary is shown as
  unused. A runnable fallback behind an unavailable primary is shown as waiting.
- Routing is unchanged (`resolveSummaryRouting`): no request for an unavailable primary, and a
  fallback only when enabled, well formed, different from the primary and the primary is
  available. The server revalidates the fallback at its attempt.
- Saving a preference approves no model, enables no inference and grants no consent for
  external transfer or paid use. Paid and cross-provider fallback consents stay explicit and
  off by default.

## Verification (synthetic only)

- Backend: `services/article_intel_summary/tests/test_admin_settings.py` (`LegacyMigrationTests`,
  30 tests) and `test_operator_preflight.py` (CLI and preflight).
- Node: `src/utils/litellm-migration-state.test.js`, `src/utils/summary-model-preference.test.js`.
- Browser, against the real Summary admin API: `scripts/pilot-e2e/ai-settings-migration.spec.js`.
- Browser, Reader settings harness: `reader-ai-e2e/summary-preference.spec.js`.
- Viewports 360, 390, 820, 884×1104 and 1440 are emulated only. No real device was used.
