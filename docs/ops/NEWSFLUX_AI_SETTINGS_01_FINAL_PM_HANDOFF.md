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

`deploy/r44-admin-allowlist/r44-omv-command.sh` in #268 at `89ae3d3`, pinned to procedure commit `1958395c595f8bb1b73b727240f2523a8bd2c0c3` (SHA-256 `a32d69aa470815d5e7d2ed12bbcabf01d98f75711231b75f59bc1771291df252`). It expects Summary image `sha256:db40e22a…1049` at `d54eda2b`.

Earlier operator documents (R4.4 runbook, R4.4B pointer) are superseded by this handoff.
