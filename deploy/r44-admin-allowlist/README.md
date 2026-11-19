# R4.4 — Summary admin allowlist via the existing release tool

Operator procedure for NEWSFLUX-AI-SETTINGS-01: set `NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS` for the running
Summary on the OMV after the owner's identity is verified. It is not application code and not a release of new
code.

## Design (proportionality decision, R4.4C)

The change reuses `deploy/release-governance/release.py` from `main` (`d54eda2b`), which is already governed,
rehearsed in CI and used for production releases. That tool's configuration-only mode (`--extra-override`, the
same mode used for the S5 policy override) does the work:

- **No production file is edited.** The allowlist is a one-key Compose override in a new release directory.
  The env file and the Compose files are untouched, so no interruption can leave a persistent change behind.
- **What `release.py` already provides:** an exclusive lock, a hashed manifest, drift checks on the Compose and
  env files, a closed policy, and fingerprints of protected containers. It recreates only the Summary with the
  pinned running image ID (`--no-deps --no-build --pull never`) and rolls back automatically on failure.
- **Rollback** is `release.py rollback`: an idempotent recreate from the untouched base files.

This replaces the earlier ~1,300-line executor (R4.4/R4.4B). That executor edited the live env file, which made
interrupt-safe rollback a P0 problem. RED was reproduced: a Ctrl+C after `os.replace` left the change on disk.

## Procedure (`r44-allowlist.sh`, run as root from a verified checkout)

| Mode                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readonly` (default) | Checks the SHA-256 pins of `release.py`, `policy.json` and the #265 preflight. Checks runtime trust before any secret: the Summary must be the expected image ID and revision, healthy, with no filesystem drift under `/app`, `/usr` or `/etc/ssl`. Then the owner enters their own Miniflux key at a hidden prompt; it goes to the Summary on stdin, and `/v1/me` runs through the Summary's own client. The admin ID list is read only if the owner types `LIST-ADMIN-IDS`. |
| `apply`              | Runs the read-only steps, requires `R44_ADMIN_ID` to equal the verified ID and the allowlist to be empty, then asks for the phrase `APPLY-R44-ADMIN-<id>`. Then `release.py plan` and `promote`, a check that the effective allowlist is `CONFIGURED_COUNT_1`, and Gate D (the pinned #265 preflight, reported for the PM).                                                                                                                                                    |
| `rollback`           | Owner phrase `ROLLBACK-R44`, then `release.py rollback` (idempotent). Verifies the allowlist is back to empty.                                                                                                                                                                                                                                                                                                                                                                 |

Output is `KEY=VALUE` only, with no paths, URLs, usernames or keys.

Exit codes:

| Exit | Meaning                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 0    | PASS / applied                                                                                                |
| 3    | HOLD, nothing changed (a failure is classed as "no change" only if the live Summary is provably the original) |
| 4    | Owner decision required (more than one admin, or admin listing declined)                                      |
| 5    | Failed and rolled back by `release.py`                                                                        |
| 6    | Supervised recovery required: run `rollback`                                                                  |

## Interrupts and crash recovery

- **Before the plan** (read-only): an interrupt stops the procedure and nothing has changed.
- **During promote and verification:** the procedure ignores SIGINT, SIGTERM and SIGHUP, and `release.py` runs in
  its own session (`setsid -w`). A terminal Ctrl+C or an ssh hangup therefore never reaches `release.py` or its
  `docker compose` children. The section is bounded by `release.py`'s readiness timeout.
- **SIGKILL, power loss or OOM** (not interceptable): base files are never modified, so the worst case is a
  Summary running with the override, or a Summary mid-recreate. Recovery is `R44_MODE=rollback
R44_RELEASE_ID=<id>`, which is idempotent; the release ID is printed before promote. On the deployed version
  nothing calls the admin check, so the override has no functional effect until the AI settings release ships.

## Tests

`tests/procedure-test.sh` (root; CI uses `sudo -E`) runs on a disposable topology: the real Summary image, a
fake Miniflux over HTTPS, protected stand-ins and canaries. It covers identity, runtime trust, apply, refusal,
rollback and idempotence, a Ctrl+C/SIGTERM/SIGHUP to the whole process group during promote, an interrupt
before any change, SIGKILL of `release.py` mid-promote followed by supervised rollback, an operator-owned clone
run as root, and a tampered pin. `release.py` itself keeps its own tests on `main` (`test_release_docker.py`
covers the configuration-only override promote and rollback).

```bash
bash deploy/r44-admin-allowlist/tests/build-test-image.sh "$PWD"
sudo -E env "PATH=$PATH" bash deploy/r44-admin-allowlist/tests/procedure-test.sh
```

Passing tests on a disposable topology prove nothing about the production state.
