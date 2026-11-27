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
| Atomicity            | See [First activation state machine](#first-activation-state-machine-r2). Success is returned only after the record is renamed, read back and digest-checked, and the journal is removed.                                                                                                                                                                                                                                                                                            |
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

Symptom: LEGACY with legacy aliases, and the gateway refuses the bootstrap key. `save-key`
is refused with `MIGRATION_REQUIRED`, and the migration preview reports the gateway as
unavailable (`KEY_UNVERIFIED`). Neither admin path can proceed. This recovery has no HTTP
route and works with writes OFF.

**Key classification (R2).** A failed discovery alone does not prove a key revoked. The
current key is probed once against `/v1/models`, and the result is classified:

- `rejected`: the gateway answered **HTTP 401 or 403**.
- `absent`: there is no valid key file or value.
- `verified`: the key works. The recovery is refused (`CONFIG_CONFLICT`); it is not a
  rotation tool.
- `inconclusive`: an outage, connection error, timeout, HTTP 5xx or 429, or a malformed
  answer. The recovery is refused (`RECOVERY=HOLD_KEY_STATE_INCONCLUSIVE`) without any
  write.

Only `rejected` and `absent` unlock the plan. `CURRENT_KEY=` in the plan output prints the
class. The same check is repeated at `--apply` and under the write lock.

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
  current bootstrap key is `rejected` or `absent`, so it is not a general rotation tool. The candidate
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

## First activation state machine (R2)

The first managed write (migration, key recovery, or a first key or policy save on a server
without legacy aliases) writes, in order:

1. `previous.json`: a snapshot only. If it fails, nothing points at it and the bootstrap
   stays authoritative.
2. `activation.pending`: the intent journal. It holds the kind, target revision, and the
   SHA-256 of the record, of `previous.json` and of the audit.
3. `activated`: the marker.
4. `migration.json`: the manifest, when it applies.
5. `settings.json`: the record.
6. Readback of the record (revision and digest).
7. Finalization (the commit point): directory `fsync`, unlink the journal, directory `fsync` (see below).

Every atomic write is a temp file, `fsync`, rename, then a directory `fsync`. An error
after the rename still counts as "maybe renamed". The resulting terminal states are:

| Failure point                                                                 | Terminal state                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before the record was renamed (any write of 1–4, or step 5 before the rename) | **CLEAN**: marker, audit and journal are withdrawn (journal last), and the bootstrap stays authoritative. If the withdrawal itself fails, the journal remains and the state is FAIL_CLOSED.                                                                                                                           |
| After the record was renamed (directory `fsync` error, readback error, crash) | **FAIL_CLOSED**: every file and the journal are kept as evidence. Nothing is deleted.                                                                                                                                                                                                                                 |
| Journal removal fails                                                         | **FAIL_CLOSED**: record and journal both remain.                                                                                                                                                                                                                                                                      |
| Journal unlinked, but the following directory `fsync` fails                   | Whether the unlink survives a crash is unknown, so the journal is **restored** with the same bytes. The state is FAIL_CLOSED again (`CONFIG_UNAVAILABLE`) and roll-forward recovers. If the restored journal cannot be made visible, the call raises `COMMIT_INDETERMINATE`, never success and never a clean failure. |

While `activation.pending` exists, every read (status, effective values, admin API,
preflight) fails closed with `CONFIG_UNAVAILABLE`. The preflight prints
`INTERRUPTED_ACTIVATION=YES` and `PREFLIGHT=HOLD`. A record never exists without its marker
and journal, the store never falls back to LEGACY silently, and an incomplete transaction is
never reported as success.

## Operator recovery of an interrupted first activation (P2/R2)

```bash
python -m services.article_intel_summary.operator_recover_interrupted_activation_ai_settings --confirm RECOVER-INTERRUPTED-ACTIVATION
```

**Roll forward: journal present and record present.** Everything is checked against the
journal: marker `v1`, digests of the record, `previous.json` and audit (or no audit), and
the record revision. On a match, the same finalization as the first activation runs:
directory `fsync`, journal unlink, directory `fsync`, with the journal restored if that
last sync fails. The readback must then show MANAGED at the journaled revision. A
finalization fault prints `RECOVERY=HOLD_CONFIG_UNAVAILABLE` (journal restored; run the
command again) or `RECOVERY=HOLD_COMMIT_INDETERMINATE`, never `PASS`.

- The state stays MANAGED, so this is allowed with inference ON.
- No model approval is created: the policy is what the record already holds.
- Receipt: `RECOVERY=PASS_COMMITTED_ACTIVATION_COMPLETED`, `JOURNAL_REMOVED=YES`,
  `DATA_FILES_DELETED=0`.
- Any mismatch gives `RECOVERY=HOLD_RECOVERY_INTEGRITY_FAILED` and changes nothing.

**Roll back to bootstrap: journal present, record absent.** This is **refused while
`NEWSFLUX_AI_INFERENCE_ENABLED=true`** (`INFERENCE_ENABLED`), because returning to the
bootstrap re-enables the LEGACY policy. The steps, in order:

1. **Validate** the whole store before anything moves.
   - Only known names, `.new-*` temp files and private backup directories may exist.
     Anything else gives `CONFIG_INVALID`.
   - The marker must be `v1`.
   - `previous.json` and the audit must match the journal. A mismatch gives
     `RECOVERY_INTEGRITY_FAILED`.
2. **Stage** `interrupted-activation-<revision>/recovery.json` (0700 directory, 0600 file) by
   atomic rename.
   - It holds exactly: `version`, `kind`, `revision`, `journal_sha256`, `created_at`, and
     `files[]` of `{name, sha256, bytes}`.
   - Names are restricted to the basenames `activated`, `activation.pending`,
     `previous.json`, `migration.json` and `.new-[a-z0-9_]+`. There are no separators and
     no traversal.
   - A crash while staging leaves no manifest and nothing moved, and the next run restarts.
3. **Move under control.** Before any move, the whole root is inventoried. Only the write
   lock, private backup directories and still-unmoved listed files may be present. Any other
   file or directory, including one added after staging, gives `RECOVERY_INTEGRITY_FAILED`
   and nothing moves. Each file must exist in exactly one place (root or backup) with its
   recorded SHA-256 and size, and the backup must hold nothing else.
   Each file is re-hashed before and after its rename. The journal and then the marker move
   last.
4. **Readback.** The root is inventoried again: only the write lock and private backup
   directories may remain. Anything else, such as content added before completion, gives
   `RECOVERY_INTEGRITY_FAILED` and no receipt. The status must be the bootstrap (not
   MANAGED).
5. **Integrity re-check.** Every backup file must match its manifest digest and size.
6. **Completion receipt.** `recovery.done` (manifest SHA-256, files verified, time) is
   written by atomic rename **only now**.

The receipt reads `RECOVERY=PASS_ROLLED_BACK_TO_BOOTSTRAP`,
`FILES_VERIFIED_SHA256_AND_SIZE=YES`, `COMPLETION_RECEIPT=WRITTEN_AFTER_READBACK`,
`JOURNAL_REMOVED=NO`, `JOURNAL_PRESERVED_IN_BACKUP=YES` and `DATA_FILES_DELETED=0`.

**Resuming an interrupted roll-back.** Running the command again resumes from the
manifest. It first re-runs the location and digest checks, and also checks the journal
digest against the manifest. These cases give `RECOVERY_INTEGRITY_FAILED` or
`CONFIG_INVALID` with no file changed and no receipt:

- a tampered or missing moved file;
- an extra file in the backup;
- a wrong size or digest in the manifest;
- a malicious name or a schema violation in the manifest.

A completed recovery (with `recovery.done`) cannot be repeated (`CONFIG_CONFLICT`). With
no journal and no unfinished backup, the command is refused (`CONFIG_CONFLICT`). A record
missing after a completed activation is a deletion, not an interruption, and stays
fail-closed for forensic review. Concurrent runs are serialized by the write lock, and
exactly one completes.

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
  `InterruptedActivationRecoveryTests` (9), and for R2 `FirstActivationCommitIntegrityTests`
  (7, including every write point before and after the rename), `InterruptedRecoveryManifestTests`
  (18) and `BootstrapKeyClassificationTests` (3), then for R3 the finalization tests in
  `FirstActivationCommitIntegrityTests` (now 9) and `RollForwardFinalizationTests` (3). `test_operator_preflight.py` covers the revert,
  key-recovery and interrupted-activation CLIs and the preflight signals.
- Node: `src/utils/litellm-migration-state.test.js`, `src/utils/summary-model-preference.test.js`.
- Browser, against the real Summary admin API: `tests/aux/pilot-e2e/ai-settings-migration.spec.js`.
- Browser, Reader settings harness: `tests/aux/reader-ai-e2e/summary-preference.spec.js`.
- Viewports 360, 390, 820, 884×1104 and 1440 are emulated only. No real device was used.
