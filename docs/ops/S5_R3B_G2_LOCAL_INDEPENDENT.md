# S5-R3B: `G2_LOCAL_INDEPENDENT` — offline evidence for the diagnostic executor's G2 gate

Status: implemented for **PM review only**. Not admitted for a privileged run: the tracked
`g2-admitted-signers` file is empty, so the mode verifies everything and then holds with
`G2L_SIGNERS_NOT_ADMITTED`. Nothing here dispatches GitHub Actions, posts a status, changes branch
protection or installs a runner.

## 1. What it is, and what it is not

The diagnostic wrapper's G2 gate needs proof that the exact source it is about to run was tested. The
remote mode (`G2_REMOTE_CI`) takes that proof from one GitHub Actions run. The local mode takes it from
offline evidence instead, under the same safety contract:

| Requirement      | `G2_REMOTE_CI`                                | `G2_LOCAL_INDEPENDENT`                                                                                                                                                                        |
| ---------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| exact commit     | run `head_sha`                                | manifest `commit` and `tree`, and the clean checkout the wrapper runs                                                                                                                         |
| exact tests      | workflow file at that commit                  | `g2-local-test-manifest.json` at that commit: the 10 workflow steps (same commands) plus R3 ×2 images, auth surface ×2, strict binding ×2, G2/executor/wrapper tests, ownership/cleanup audit |
| complete results | job listing complete, every job success       | every manifest step present once, `PASS`, exit 0, no failure/error/skip, test and check counts at or above the floor                                                                          |
| independence     | GitHub's runner                               | **two** complete runs by two distinct producers (different principals, keys and run IDs) plus a detached approval by a reviewer who is not the producer                                       |
| identity         | GitHub API                                    | OpenSSH signatures (`ssh-keygen -Y`), namespaced: `newsflux-g2-local-evidence`, `newsflux-g2-local-approval`                                                                                  |
| admission        | the workflow path and job name in the wrapper | signers in the tracked `g2-admitted-signers` file (empty), changed only in an admission-only descendant commit                                                                                |

It is **not** a skip: there is no `--skip-ci`, `--force`, `--ignore-gates` or bypass variable, no
arbitrary JSON with `PASS` is accepted, and a producer can never approve its own evidence (by
principal or by key).

## 2. Evidence bundle (`newsflux.g2-local-evidence/v1`)

Produced by `g2_local_evidence.py run` in a clean exact checkout on an **exclusive** Docker daemon
(it refuses to start if any container, non-default network or volume exists, because the legacy
rehearsals clean up by name):

| File                          | Content                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EVIDENCE_MANIFEST.json`      | repository, commit, tree, clean checkout, role (`PRODUCER`/`REPLAY`), principal, run ID, start/finish, completed/interrupted, SHA-256 of the bound files (auditor, wrapper, executor, workflow, test manifest, verifier) and of the other bundle files |
| `TEST_RESULTS.json`           | per step: status, exit code, tests ran/failures/errors/skipped, script checks PASS/FAIL, timings, SHA-256 of the private log; cleanup audit; secret scan                                                                                               |
| `ENVIRONMENT_PROVENANCE.json` | OS, kernel, architecture, Python and modules, Docker and Compose, git, image IDs and RepoDigests of every pinned image                                                                                                                                 |
| `SANITIZED_RECEIPT.txt`       | one line per fact, no log content                                                                                                                                                                                                                      |
| `REPLAY_INSTRUCTIONS.md`      | how a second producer and a reviewer replay and approve                                                                                                                                                                                                |
| `SHA256SUMS`                  | SHA-256 of the five files above                                                                                                                                                                                                                        |
| `SHA256SUMS.sig`              | the producer's OpenSSH signature of `SHA256SUMS`                                                                                                                                                                                                       |

Full logs stay private with the producer (0600); only their hashes are in the bundle.

**No hash cycle:** the manifest names the bound source files and the other bundle files;
`SHA256SUMS` names the five files; the signature covers `SHA256SUMS`; the approval (outside both
bundles) names each bundle's `SHA256SUMS` hash.

## 3. Detached approval (`newsflux.g2-local-approval/v1`)

Written by `g2_local_evidence.py approve` only after both bundles verify and both producer
signatures check out; it refuses when the reviewer is the producer. Fields: repository, commit, tree,
both `SHA256SUMS` hashes, the three principals, verdict `APPROVE_G2_LOCAL_DIAGNOSTIC_ONLY`, scope
`S5_R3_OMV_READONLY_DIAGNOSTIC`, time. Signed as `<approval>.sig`. The scope is the read-only
diagnostic only: it authorizes nothing about the key, inference, deploy or activation.

## 4. Verification (`HOLD` codes, all tested)

| Condition                                                                    | HOLD                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| bundle directory absent / file missing / extra file                          | `G2L_BUNDLE_MISSING` / `G2L_BUNDLE_INCOMPLETE` / `G2L_BUNDLE_UNEXPECTED_FILE`           |
| any file altered (sums, manifest's bundle hashes)                            | `G2L_BUNDLE_TAMPERED`                                                                   |
| unknown schema (bundle, results, approval, step status)                      | `G2L_SCHEMA_UNKNOWN`                                                                    |
| manifest key, bound file or count missing                                    | `G2L_MANIFEST_INCOMPLETE`                                                               |
| other commit / other tree / dirty checkout                                   | `G2L_OTHER_SHA` / `G2L_OTHER_TREE` / `G2L_CHECKOUT_NOT_CLEAN`                           |
| auditor, wrapper, executor, workflow, test-manifest or verifier hash differs | `G2L_FILE_HASH_<NAME>`                                                                  |
| required step omitted / unknown / duplicated                                 | `G2L_REQUIRED_TEST_MISSING` / `G2L_RESULTS_UNKNOWN_STEP` / `G2L_RESULTS_DUPLICATE_STEP` |
| required step skipped or blocked (or any skipped test)                       | `G2L_REQUIRED_TEST_SKIPPED`                                                             |
| FAIL, ERROR, non-zero exit, failures, errors, failed checks                  | `G2L_TEST_FAILED`                                                                       |
| fewer tests/checks than the manifest floor (silently dropped tests)          | `G2L_TEST_COUNT_LOW`                                                                    |
| interrupted or incomplete run                                                | `G2L_RUN_INTERRUPTED`                                                                   |
| pinned image absent or with another ID                                       | `G2L_IMAGE_MISMATCH`                                                                    |
| leftovers or secret-scan hits                                                | `G2L_CLEANUP` / `G2L_SECRET_SCAN`                                                       |
| approval absent / unsigned or signed by a non-admitted key / wrong namespace | `G2L_APPROVAL_MISSING` / `G2L_APPROVAL_SIGNATURE`                                       |
| approval for another commit or tree / other bundles / not an approval        | `G2L_APPROVAL_OTHER_SHA` / `G2L_APPROVAL_OTHER_EVIDENCE` / `G2L_NOT_APPROVED`           |
| reviewer is the producer (name or key)                                       | `G2L_SELF_APPROVAL`                                                                     |
| replay by the producer, same key, or same run ID                             | `G2L_REPLAY_NOT_INDEPENDENT`                                                            |
| evidence signature invalid or signer not admitted                            | `G2L_EVIDENCE_SIGNATURE`                                                                |
| no admitted signer at all (today)                                            | `G2L_SIGNERS_NOT_ADMITTED`                                                              |

The wrapper turns each into `S5R3_RUN_RESULT=HOLD_G2L_<code>` before any Docker call.

## 5. Admission (PM) — lifecycle without invalidating evidence

Signers live in the tracked file `ops/deploy/release-governance/g2-admitted-signers` (empty; comment lines are
ignored). The wrapper hands the verifier `--admitted-signers-from-source`, so the trust root is whatever that
file says at the exact HEAD the operator runs (G1 proves that HEAD and a clean tree).

1. Evidence is produced at the tested commit `T` (all code, tests and docs final).
2. The PM admits signers in a commit `A` that descends from `T` and changes **only**
   `g2-admitted-signers` (and optionally `docs/evidence/**`).
3. The operator runs `A`. The verifier accepts evidence for `T` because `T` is an ancestor of `A` and
   `git diff --name-only T A` is admission-only; bound files are re-hashed at `A` and must equal the evidence.
   Any other change after `T` holds `G2L_ADMISSION_DELTA_NOT_ALLOWED`; an evidence commit that is not an
   ancestor holds `G2L_OTHER_SHA`; the approval must still name `T` and its tree.

Admission never rescues tampering, self-approval, a non-admitted reviewer, an incomplete run, omitted
results or skips: every check of §4 still runs. Historical evidence (e.g. `d6dfa2c`) is verified with the
verifier of its own commit and is not rewritten.

## 6. Limits

- Signatures prove which key signed, not that two keys belong to independent people or machines;
  that judgement is the PM's when admitting signers.
- The producer environment is recorded, not attested by a third party (unlike a hosted runner).
- `ssh-keygen` (OpenSSH ≥ 8) is needed where the verifier runs.
