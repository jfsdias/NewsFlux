# R12F-09 — Summary candidate READINESS_FAILED: root cause and fix

**Status:** root cause `CONFIRMED` by reproduction in an isolated Docker environment (agent sandbox and CI).
Production evidence is `REPORTED` by the operator. No production action was taken by this fix.

## Incident (REPORTED)

`all` stopped at `promote-summary`: `PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED` about 6 s after
`promote_started`; automatic rollback restored image `sha256:07b05db…` and config hash `f3a18788…`
(`EXACT_CONFIG_RESTORE=PASS`). The candidate container was removed by the rollback, so no logs remained.

## Reasoning from the code

`release.py::_wait_ready` fails before the 30 s image healthcheck can run only when the candidate
container is **not running** 5 s after `compose up`. The rollback restored the identical config hash, so
Compose interpolation of the seven files was identical; the difference had to be the image.

## Root cause (CONFIRMED)

`ai-functional-release.sh` runs with `umask 077`. Its `git clone`/`checkout` of the approved source therefore
created files `0600` and directories `0700`. `services/article_intel_summary/Dockerfile` copies sources with
`COPY` (modes preserved) and runs as `USER 10001:10001`, which cannot read root-owned `0600` files. The candidate
exits immediately with:

```text
PermissionError: [Errno 13] Permission denied: '/app/services/__init__.py'
```

The previous production image and every CI image were built from `umask 022` checkouts, which is why no
earlier gate saw it. The Reader image is unaffected (its runtime is root-run Caddy serving a bundle produced
inside the build stage).

## Evidence

| Check                                                                                                                                                      | Result                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same commit `2dab359`, real Dockerfile, checkout `umask 077`                                                                                               | `exited`, `ExitCode=1`, `PermissionError` (RED)                                                                                                                                                                                                                                           |
| Same commit, checkout `umask 022`                                                                                                                          | `healthy`                                                                                                                                                                                                                                                                                 |
| Fix commit, checkout `umask 077` (`test-r12f09-image-umask.sh`)                                                                                            | `PASS user=10001:10001` (GREEN)                                                                                                                                                                                                                                                           |
| `rehearse-r12f09.sh`: real release tool, `newsflux` project, seven ordered Compose files (last pins the running image), protected `miniflux`/`miniflux-db` | 12/12 — incident reproduced (`READINESS_FAILED`), forensics captured before rollback (`exit_code=1`, `PermissionError`), exact config-hash restore, fixed candidate promoted and healthy by the image healthcheck, exact rollback, idempotent rollback, re-promotion, protected unchanged |

The sandbox adapts only the dependency-install line of the Dockerfile to reach PyPI through its TLS
proxy; CI runs the unmodified Dockerfile.

## Fix (minimal)

1. Summary `Dockerfile`: `RUN chmod -R a+rX,go-w /app/services` before `USER` — modes no longer depend
   on how the build context was checked out.
2. Operator script: source checkout under `umask 022` (source is not secret) and a new
   **`CANDIDATE_START` gate** after `build`: the candidate runs isolated (no network, non-root,
   synthetic non-secret settings) and must serve `/healthz` before any production container is touched.
3. `release.py`: on any failed promotion, the candidate's state, exit code, OOM flag, health codes and a
   redacted log tail are written to `failure-*.json` (mode 0600) **before** rollback, and summarized in the
   journal and stderr. A future failure will no longer lose its evidence.

Not changed: healthcheck parameters, readiness timeouts, Miniflux, NPM, LiteLLM, WallHop.

Same defect class exists in `services/content_fallback/Dockerfile` (also `USER 10001` + `COPY`); it is fixed
in the WallHop PR, not here.

## Safety follow-up (PM review): forensics can never block the rollback

In the first version of this PR `_capture_failure()` and `_journal()` ran before the automatic rollback, so
an `OSError` (for example `ENOSPC` on the release volume) could have skipped the rollback. Now:

| Situation                                              | Behaviour                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `failure-*.json` cannot be written (ENOSPC, read-only) | rollback runs; `FORENSIC_CAPTURE=UNAVAILABLE`                                 |
| `docker inspect` / `docker logs` fail                  | rollback runs; `FORENSIC_CAPTURE=PARTIAL` (file kept when writable)           |
| journal cannot be written after the change             | rollback runs; `JOURNAL=UNAVAILABLE`                                          |
| journal cannot be written **before** any change        | nothing is touched; `JOURNAL_UNAVAILABLE_BEFORE_CHANGE`                       |
| the rollback itself fails                              | reported distinctly: `ROLLBACK_FAILED:<code>:AFTER:<code>` (incl. `IO_ERROR`) |

The operator terminal receives safe codes only (status, exit code, OOM flag, capture/journal state). Application
log content goes, sanitized, to 0600 files only — also for the operator script's `CANDIDATE_START` gate.

Tests: `test_release_failure_io.py` — 7 tests, RED 6/7 on the previous head, GREEN 7/7. `rehearse-r12f09.sh`
adds the same incident with ENOSPC on forensics, failing `docker logs` and failing journal at once, on seven
Compose files with real images: rollback still runs, exact image/config-hash/7-file sequence restored,
protected containers unchanged, no raw log on the terminal.
