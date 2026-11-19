# NEWSFLUX-AI-SETTINGS-01 — R4.4B red-team remediation (pointer)

Date: 2026-11-18 · Status: **NO-GO, pending the real read-only OMV receipt** · Merges: none · Deploy: none · Production mutations: 0

> **Superseded by R4.4C** (`NEWSFLUX_AI_SETTINGS_01_FINAL_PM_HANDOFF.md`): the executor described here was replaced in #268 by a small procedure around the existing `release.py`. Do not use the pins below.

This PR (#261) is documentation only again. The operator executor that R4.4 added under `docs/ops/r44/` was removed here. The corrected tool, its read-only A/B command, the Gate D receipt wrapper and the disposable test matrix now live in the dedicated operator PR [jfsdias/NewsFlux#268](https://github.com/jfsdias/NewsFlux/pull/268), under `deploy/r44-admin-allowlist/`. Do not merge or run any R4.4 executor from this PR's history (`946b899`).

| PM finding (R4.4 tool `946b899`)                       | R4.4B fix (#268)                                                                                                          | Evidence                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0: `write_atomic` outside the rollback boundary       | First write and every later step inside the boundary; `replaced` marker; durable-restore check; unproven restore → exit 6 | RED: fault after `os.replace` left `ADMIN_USER_IDS=7` on disk, exit 3, no rollback. GREEN: `ROLLBACK=PASS`, exact bytes, mode and owner |
| P1: A/B command `exit 0` after a failed identity check | Audit first, key only after it passes, aggregate result and exit code re-raised                                           | RED: `R44_IDENTITY_EXIT=3` with overall exit 0. GREEN: 13/13 wrapper cases                                                              |
| P1: raw paths in output                                | Explicit key schema, value contract, path fingerprints, `BACKUP_ID`                                                       | Canary checks on every test output                                                                                                      |
| P1: inventory skipped uninspectable containers         | `HOST_INVENTORY=INSPECT_FAILED` HOLD before key and write                                                                 | `audit_inventory_fail_closed`, `apply_inventory_fail_closed`, `ab_audit_inventory_fail`                                                 |
| Key requested before runtime trust                     | Pinned image, revision label, `docker diff`, code manifest identical to the approved revision; consent for `/v1/users`    | `trust_*` cases: `TEST_SECRET_ASKS=0` on every mismatch                                                                                 |

Found and fixed during R4.4B, each with RED reproduced first:

- **Clone ownership under `sudo`.** Git refused the operator's clone when the tool ran as root, so the code manifest was always `UNVERIFIED`; this would have blocked the real OMV run. Fixed with `safe.directory` for that one repository.
- **`config --hash` vs the `up` label.** On Compose 5.1.3 (CI) they differ. Equivalence is now proved by hash, or else field by field, and anything the comparison doesn't cover HOLDs.
- **Rollback.** It now compares label with label, with the same field-by-field fallback.

Final state of #268 (`891a148`):

- Tests: 43/43 locally (Compose 5.7.1). On CI (Compose 5.1.3): 42/42 with the root-only case skipped, 13/13 wrapper and 10/10 Gate D. All repository checks green.
- Read-only command: `deploy/r44-admin-allowlist/r44b-readonly-ab.sh`, pinned to tool commit `c75bac4cf2116ea6037f5c99c1076ed3fab18d8d`, SHA-256 `c962b5190598b2fae8501bf53c860ad0dc6682342c5710e8bf654c17a79daff0`, expected Summary image `sha256:db40e22a12ce3776c2f00666bc7523c7cfbf2127f7e265182d0941dc3b711049` at `d54eda2b`.

Disposable tests prove nothing about the OMV state.
