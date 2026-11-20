# G2 evidence for tested commit `57c536f` (R4, Epic A)

Byte-exact (do not reformat). Tested commit `57c536fb583a52bb42a88d9a1b051869abc64b1f`, tree
`884e7b84a66d386bd79782c0fb335a94f107dd04`. This directory is admission-only relative to that commit.

## G2_REMOTE_CI — satisfied

GitHub Actions run [44797429438](https://github.com/jfsdias/NewsFlux/actions/runs/44797429438), attempt 1,
event `pull_request` (PR #272), workflow `.github/workflows/summary-release-rehearsal.yaml`, `head_sha`
`57c536f`, completed/success; job listing complete (`total_count=1`): `synthetic-release` (job 136500493723),
same run/attempt/SHA, success, all 10 workflow steps green. The PR base `3822e09` is an ancestor of
`57c536f`, so the merge tree tested by the runner equals the commit tree. Triggered automatically by opening
the Draft PR (no manual dispatch). Scope: the workflow steps only (not the R3/auth/strict-binding rehearsals,
which the local producer run covers).

## G2_LOCAL_INDEPENDENT — not complete

| Run | Where | Result |
| --- | --- | --- |
| Producer (`newsflux-g2-producer-claude`, key `SHA256:6FidKwxB…`) | this session's container | **18/18 PASS**, 420 unit tests, 255 checks, 0 failures/errors/skips, cleanup 0, checkout residue 0, secret scan 0; `SHA256SUMS` sha256 `3fd0aca256bb6a961ca578479f993ba666209e6538be9d9b7f6c2f79c943c179` |
| Replayer (`newsflux-g2-replayer-cloud`, key `SHA256:8D2uwmJ3…`, private key never left its container) | separate cloud session, other environment, started by the owner ("Go ahead") | **COMPLETE_WITH_FAILURES**, 14/18: X11/X12/X13 on LiteLLM 1.110.0 failed because that environment's proxy refuses `pkg-containers.githubusercontent.com` (ghcr layer storage), so the pinned image could not be pulled; W01 had one transient Summary-image build error (not reproduced when rebuilt by hand). Signature verified; `SHA256SUMS` sha256 `26de18c0575883adef3a2e5462a0bc6685e7473be8f32cacea42c00f5f8d83fc`; verifier: `G2L_RESULT=HOLD_G2L_TEST_FAILED` (correct) |

No approval was produced. Unblocking the local route needs, in the replayer's environment, the host
`pkg-containers.githubusercontent.com` allowed (owner setting), then a new owner-started replay and a
third, owner-started reviewer session. Not needed while `G2_REMOTE_CI` is satisfied.

`operator-command.txt`: the supervised OMV command rendered for `57c536f` with the remote G2 arguments. **Not to
be run without a PM GO**; it is read-only and holds on any gate.
