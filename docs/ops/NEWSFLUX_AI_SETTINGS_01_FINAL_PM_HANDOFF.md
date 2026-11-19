# NEWSFLUX-AI-SETTINGS-01 — final PM handoff (R4.4C proportionality review)

Date: 2026-11-19 · Merges: none · Deploy: none · Production mutations: 0

This closes the operational engineering for AI Settings. It separates the four gates so the PM can decide the merges without another engineering round.

## Operational approach — decision

| Option                                      | Assessment                                                                                                                                                                                                                                                                                                                                     | Decision     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **A — reuse `release.py` (main)**           | Already governed, rehearsed in CI and used in production. Its configuration-only mode (`--extra-override`) does exactly this, with lock, manifest, drift and protected checks, Summary-only recreate with the pinned image, and automatic plus idempotent rollback. No production file is edited, so the interrupt-safety P0 class disappears. | **Selected** |
| B — keep the R4.4B executor and fix it      | About 1,300 lines that edit the live env file. Fixing interrupts needs a signal guard, a journal and recovery logic (a patch of about 690 lines was drafted and not adopted). More code to maintain and review for a one-key change.                                                                                                           | Rejected     |
| C — new small manual runbook without a tool | Simpler than B, but it would re-implement drift, protected and rollback checks by hand, worse than A.                                                                                                                                                                                                                                          | Rejected     |

Result: [jfsdias/NewsFlux#268](https://github.com/jfsdias/NewsFlux/pull/268) now holds a 183-line procedure around `release.py`, a single pinned OMV command and a rehearsal test (9 files). The executor is deleted.

## Risk classification

- **Confirmed blockers (now resolved, RED → GREEN):**
  - The R4.4B executor left a persistent env change on Ctrl+C, SIGTERM or SIGHUP after the write. Resolved by design: there is no file edit any more.
  - The procedure could not read the operator's clone when run as root (git `safe.directory`). Fixed, with a regression test.
  - An unknown `release.py` failure could be classed as "no change". It is now exit 3 only if the live Summary is provably the original, otherwise exit 6.
- **Risks that block production execution until met:** the real read-only receipt on the OMV, a verified single admin (or the owner's explicit choice), and a specific production GO for `apply`.
- **Accepted residual risks (managed by supervised recovery):**
  - SIGKILL, power loss or OOM during promote can leave the Summary with the override, or mid-recreate. Recovery is the idempotent `R44_MODE=rollback`; base files are never modified.
  - The override is functionally inert on the deployed version (nothing calls the admin check).
  - A plain `docker compose up` from the repository files drops the override (fail-closed: admin denied).
  - The OMV command needs commit `4c3e075` reachable on GitHub.
- **Non-blocking backlog:** fold the allowlist into the private env file during the governed AI Settings release; `release.py` itself has no SIGINT handling (mitigated here by `setsid` and ignored signals); Gate D is reported, not auto-acted on.

## Gates

| Gate                   | Criteria                                                            | State                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #268 code merge        | Static safety, scope isolation, tests, CI                           | **PASS** — 9 scoped files, rehearsal 19/19 locally and in CI (Compose 5.1.3), all checks green at `89ae3d3`                                                                                                                                                                           |
| Functional chain merge | Exact integration, functional correctness, no regressions           | **PASS for PM decision** — HEADs unchanged since R4.2; exact tree `48d77c0` all CI green. Inert while the allowlist is empty: admin routes fail closed (`test_admin_requires_verified_miniflux_admin_and_configured_allowlist` on main) and writes are OFF. Merging is not deploying. |
| OMV configuration      | Verified admin, authorized change, backup/rollback, real preflight  | **PENDING** — run the pinned command with `MODE=readonly`, then `MODE=apply` after the specific GO                                                                                                                                                                                    |
| Deploy                 | Approved SHA, specific production authorization, canary, validation | **NOT STARTED** — separate governed release (`ai-functional-release.sh`/`release.py`) after the merges                                                                                                                                                                                |

## Operator command

`deploy/r44-admin-allowlist/r44-omv-command.sh` in #268 at `119836684c4a2d81172bd3716e02e16e0e6f5294` (SHA-256 `f1a4e3c2c90672d73637716cb623a5b66f36f985bbc3dfcc26b954c7d0d61477`). It is pinned to procedure commit `019a11e7a138094adac8ba77112f811b629e123e` (SHA-256 `797708f18e24c7001188dab110fc3dcf53d9b54d6aa38619a7adacd43d3e0f6e`) and expects Summary image `sha256:db40e22a…1049` at `d54eda2b`.

## R4.4D — rollback reachability (final recovery gate)

- **Defect** (PM, source-proven; RED on `89ae3d3`): `R44_MODE=rollback` was evaluated after the running/healthy trust gate. A stopped Summary gave `SUMMARY_CONTAINER=NOT_UNIQUE_OR_NOT_RUNNING` and an unhealthy one gave `SUMMARY_HEALTH=UNHEALTHY`, so rollback was refused exactly when it was needed.
- **Fix:**
  - Rollback is now routed right after the pin checks and uses only `release.py rollback`.
  - The manifest must be root-owned and not group- or world-writable.
  - A `release.py` refusal (tampered or invalid manifest, foreign state, drift, protected drift, lock) is exit 3, with nothing changed.
  - Success requires a healthy Summary, the pre-change config label and an empty allowlist; anything else is exit 6, supervised recovery.
  - An absent container stays a supervised-recovery case (exit 6), as `release.py` refuses it.
- **Tests:** rehearsal 31/31 locally (Compose 5.7.1) and in CI run 44444465746 (Compose 5.1.3). It covers rollback from a stopped and from an unhealthy Summary, idempotence, refusal of a non-private, tampered or invalid manifest, refusal of foreign state, an absent container (exit 6), and protected containers unchanged. The `readonly` and `apply` gates are unchanged. All checks on #268 are green.

Earlier operator documents (R4.4 runbook, R4.4B pointer) are superseded by this handoff.
