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
| Audit                | `migration.json` (0600) is the migration manifest. It records the kind (`migration` or `key_recovery`), the new and previous revision, the UTC time, the legacy model ids, aliases and labels, and the SHA-256 of the exact `settings.json` bytes committed (`record_sha256`) and of the `previous.json` bytes replaced (`previous_sha256`). No credential.                                                                                                                          |
| Atomicity            | First activation order: `previous.json`, `activation.pending` (intent journal: target revision and record digest), `activated`, `migration.json`, `settings.json`, then the journal is removed. If the record write fails, the marker, audit and journal are withdrawn and legacy stays authoritative. If the process dies after the marker, the store fails closed (`CONFIG_UNAVAILABLE`), never back to legacy; recovery is the explicit operator procedure below.                 |
| Concurrency          | The file lock plus the revision compare-and-swap: of two concurrent migrations exactly one commits; the other gets `CONFIG_CONFLICT`.                                                                                                                                                                                                                                                                                                                                                |

## Operator revert (rollback) — only the untouched migration (red-team P0-RT-01)

There is no HTTP route. Run it inside the Summary container as the service user. It works
with admin writes OFF and is **refused while `NEWSFLUX_AI_INFERENCE_ENABLED=true`**
(`INFERENCE_ENABLED`), because a revert re-enables the legacy models.

```bash
python -m services.article_intel_summary.operator_revert_legacy_migration_ai_settings --expected-revision <32-hex current revision> --confirm REVERT_NEWSFLUX_AI_LEGACY_MIGRATION
```

The revert is bound to the migration manifest. Every invariant below must hold; otherwise it
is refused **without touching any file** (`ROLLBACK_STATE_CHANGED`, or `CONFIG_CONFLICT` /
`CONFIG_INVALID`):

1. `--expected-revision` equals the current managed revision **and** the manifest revision.
   Any later approval, revocation, `save-policy`, key change (even one changed back to the
   same key) or `operator_restore_previous` creates a new revision, so it is refused.
2. SHA-256 of the current `settings.json` and `previous.json` equals `record_sha256` and
   `previous_sha256`. This catches edits and a manifest re-aligned to a later state.
3. The current policy is exactly the empty allowlist, the managed key equals the bootstrap
   key, and `previous.json` is the bootstrap snapshot (revision `bootstrap`, no policy, same
   key). Bootstrap-key equality alone is not sufficient.
4. The legacy aliases in the environment are exactly the migrated set, so the revert
   cannot enable a different legacy set. The manifest kind is `migration` (a key recovery
   cannot be reverted: the bootstrap key is the revoked one).
5. The environment is still LEGACY (no `NEWSFLUX_AI_MODEL_POLICY_JSON`).

Files are moved, never deleted, into `legacy-revert-<revision>/` (0700). The record moves
first, so an interruption fails closed, and the marker moves last. Running it again with
the same revision resumes the revert only after re-checking the moved record against the
manifest. A completed revert is a conflict if repeated.

**A state modified after the migration cannot be reverted to legacy.** Use the managed
controls instead: revoke approvals in the admin UI, or `operator_restore_previous` for the
previous managed record. Any other emergency path needs its own owner GO. This is
intentionally out of scope.

## Operator recovery when the legacy bootstrap key is revoked (red-team P1-RT-02)

Symptom: LEGACY with legacy aliases, and the bootstrap key fails discovery. `save-key` is
refused with `MIGRATION_REQUIRED`, and the migration preview reports the gateway as
unavailable (`KEY_UNVERIFIED`). Neither admin path can proceed. This recovery has no HTTP
route and works with writes OFF.

```bash
python -m services.article_intel_summary.operator_recover_legacy_key_ai_settings --key-file /run/newsflux/replacement-key --plan
```

```bash
python -m services.article_intel_summary.operator_recover_legacy_key_ai_settings --key-file /run/newsflux/replacement-key --apply --plan-digest <PLAN_DIGEST> --confirm RECOVER-LEGACY-KEY-AND-MIGRATE
```

- The replacement key is read only from an owner-only (0600, not a symlink) file owned by
  the service user. It is never taken from argv or the environment, and never printed.
  Delete the file after the run.
- `--plan` is read-only. It is refused unless the source is LEGACY with aliases **and** the
  current bootstrap key fails discovery, so it is not a general rotation tool. The candidate
  must pass the same authenticated discovery, and each legacy model is verified with it. It
  prints counts and `PLAN_DIGEST`, an HMAC keyed by the candidate key that goes stale if the
  key, revision or gateway facts change.
- `--apply` repeats every check under the write lock. It then stores the verified key and
  the explicit empty allowlist (no model approved; external and paid models still need
  per-model consent) with a `key_recovery` manifest. It uses the same journaled first
  activation as the migration.
- The bootstrap key file is never modified. The revoked key in `previous.json` is never
  reinstated: `operator_restore_previous` is refused while the current state is the
  recovery state, and a legacy revert is refused.

## Operator recovery of an interrupted first activation (P2)

Symptom: the store reports `CONFIG_UNAVAILABLE`. The read-only preflight prints
`INTERRUPTED_ACTIVATION=YES` (marker and `activation.pending` present, `settings.json`
absent) and `PREFLIGHT=HOLD`.

```bash
python -m services.article_intel_summary.operator_recover_interrupted_activation_ai_settings --confirm RECOVER-INTERRUPTED-ACTIVATION
```

- Journal present, record absent: nothing was committed. The marker, journal,
  `previous.json`, `migration.json` and any `.new-*` partial write are moved (never
  deleted) into `interrupted-activation-<revision>/` (0700). `recovery.json` lists each
  file's SHA-256 and size and is written before any move. The marker moves last, and
  `recovery.done` closes the backup. The readback must show the unchanged bootstrap
  (`KEY_SOURCE=BOOTSTRAP`); otherwise the result is `HOLD`. A recovery interrupted midway
  resumes from its `recovery.json`.
- Journal present, record committed with the journaled revision and digest: roll forward.
  The stale journal is removed, and the committed managed record stays authoritative.
- No journal: refused (`CONFIG_CONFLICT`). A record missing after a completed activation is
  a deletion or corruption, not an interruption. It stays fail-closed for forensic review
  and is never silently restored to bootstrap.
- A tampered journal is `CONFIG_INVALID`, and nothing is moved.

## Preview tokens and multiple workers

The admin preview token is an HMAC with a per-process random secret. A migration confirmed
in a different worker or after a restart is refused (409) and nothing is written. Several
Summary workers or replicas therefore **fail closed** and do not share previews. Production
runs one Summary process. Do not add a shared secret without a separate design review.

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

- Backend: `services/article_intel_summary/tests/test_admin_settings.py`: `LegacyMigrationTests`
  (30), `MigrationRollbackRedTeamTests` (11), `LegacyKeyRecoveryTests` (9) and
  `InterruptedActivationRecoveryTests` (9). `test_operator_preflight.py` covers the revert,
  key-recovery and interrupted-activation CLIs and the preflight signals.
- Node: `src/utils/litellm-migration-state.test.js`, `src/utils/summary-model-preference.test.js`.
- Browser, against the real Summary admin API: `scripts/pilot-e2e/ai-settings-migration.spec.js`.
- Browser, Reader settings harness: `reader-ai-e2e/summary-preference.spec.js`.
- Viewports 360, 390, 820, 884×1104 and 1440 are emulated only. No real device was used.
