# Retired CI: local historical checks

PR #289 retires automatic and manual GitHub Actions workflows; it does not authorize WallHop activation or deployment. These are historical, optional, off-host checks, not replacement deployment gates or evidence that a provider is approved.

Source for the retired definitions: commit `86922a91d4aa7b4d0540072a521dd8410cca2b93`, files `.github/workflows/wallhop-g4-operator.yaml`, `.github/workflows/wallhop-g5-dark-deploy.yaml`, and `.github/workflows/r44-operator-tool.yaml`. Inspect exact originals with `git show 86922a91d4aa7b4d0540072a521dd8410cca2b93:<path>`. Use a disposable local checkout away from any production host; use only synthetic credentials and a clean environment.

- G4: `python3 archive/retired-ci/g4-compose-check.py` reproduces the historical inline Compose expansion assertions with synthetic values and blackholed relay addresses. It requires the Docker Compose CLI and runs only `docker compose ... config`; it does not start services. The separate offline admission tests and syntax check are `python3 -m unittest discover -s ops/ops/deploy/wallhop-isolated -p 'test_g4_operator.py' -v`, `python3 -m unittest discover -s ops/ops/deploy/wallhop-isolated -p 'test_g4_ipam_gate.py' -v`, and `bash -n ops/ops/deploy/wallhop-isolated/g4-dark-canary.sh`.
- G5: offline negative admission and topology test commands are preserved in the historical workflow and test files. They do not authorize running G5 operator commands.
- R4.4: `bash archive/retired-ci/r44-static-check.sh` reproduces the syntax, Python 3.9 grammar and prohibited-pattern checks from the historical workflow. Its disposable Docker image build and root procedure rehearsal remain historical and are **not** safe to run against a production host; consult the pinned workflow and test scripts in a disposable isolated environment before any separate decision to run them.

The historical UX-REACH diagnostic scripts remain under `tests/aux/ux-reach-01/`. Their runner requires exact baseline and candidate checkouts, compatible locked dependencies and the pinned browser described by the historical `.github/workflows/ux-reach-01-pen-drag-diagnostic.yaml` at the same commit. A future execution must independently validate these prerequisites.

Do not run deployment, teardown, canary or provider access as part of these checks. No production test, live provider test, branch protection validation or end-to-end historical rehearsal is implied by preserving these files.
