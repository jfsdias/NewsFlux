# S5-R3B `G2_LOCAL_INDEPENDENT` evidence for commit `d6dfa2c`

Byte-exact copies (do not reformat: every file is covered by `SHA256SUMS` and signatures).

| Item | Value |
| --- | --- |
| Repository | `jfsdias/NewsFlux` |
| Tested commit | `d6dfa2c4eeb858cfba2f7af500ef8d2a37e32884` (clean checkout, verified empty `git status`) |
| Git tree | `65f58e65c5a8f97765482c39c42ad7f1e4d4a89b` |
| Auditor / wrapper / executor SHA-256 | `6e5bef4e…14d11` / `eabadfb9…8a9ad` / `159c5aac…7652e` |
| Workflow / test manifest / verifier SHA-256 | `8d671404…f049` / `81665feb…8b89` / `3d003d95…8596` |
| Producer bundle | `producer-bundle/`, principal `claude-producer`, run `9a5cb3cb…`, 16:43:14–17:11:48Z, `SHA256SUMS` sha256 `808915f9edca1033a83d09cf1f2e67977b8843aa8191e995877067ecc2be278c`, manifest sha256 `0cc83f38…b752` |
| Replay bundle | `replay-bundle/`, principal `claude-replayer`, 17:13:01–17:39:55Z, `SHA256SUMS` sha256 `b232b25d277aeaa5ce34e9db9f4ddfcff5c27a7976c35313db825b361e068edd`, manifest sha256 `064d3fe7…0e16` |
| Detached approval | `approval.json` (+ `.sig`), reviewer `claude-reviewer`, sha256 `305f96b8912b65d2319b08dfc17346e5d71c6147c4acf0b1aad7c299720f2200` |
| Verifier on these files | `G2L_RESULT=PASS` (run by the reviewer and again by the implementer) |
| Results, each run | 18/18 steps PASS: 400 unit tests (0 failures, 0 errors, 0 skips), 255 script checks (0 FAIL), cleanup 0 leftovers, secret scan 0 hits |

Environment (both runs): Linux x86_64 6.18.44, Ubuntu 24.04, Python 3.12.3 (fastapi, httpx, yaml), Docker
29.10.0, Compose 5.7.1, exclusive disposable Docker daemon, pinned images listed in
`ENVIRONMENT_PROVENANCE.json`. Declared sandbox adaptation: a TLS-inspecting proxy, so Summary image builds
used `NEWSFLUX_TEST_PIP_CA` (Dockerfile `FROM` stays digest-pinned).

## Limits (read before admitting anything)

- **Same host, same daemon, same session:** producer, replayer and reviewer were three agents in one cloud
  sandbox. All three ephemeral keys were generated there, so the implementer had technical access to every
  private key. This demonstrates the mechanism and two real executions; it is **not** independence of people
  or machines. `allowed_signers` here is for reproducing the check only and must not be admitted as is.
- To admit the mode, the PM names signers whose keys are held by separate parties, in a reviewed change to
  `LOCAL_ADMITTED_SIGNERS`; evidence must then be produced at that new commit.
- Minor finding (not fixed, to keep this evidence valid): `rehearse-s5-r3a-strict-binding.sh` imports the
  auditor with `python3 -I`, which ignores `PYTHONDONTWRITEBYTECODE`, leaving an untracked
  `deploy/release-governance/__pycache__/…pyc` in the checkout. It does not affect results; it makes a
  second `run` on the same checkout refuse (dirty tree).
- `operator-command.txt` is the template rendered for this commit; `<G2_ARGS>` is intentionally left open
  (no remote run exists; the local mode is not admitted). Not to be run without a PM GO.
