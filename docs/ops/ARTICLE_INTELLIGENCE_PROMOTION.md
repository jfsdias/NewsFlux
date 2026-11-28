# Article Intelligence — controlled promotion plan (OMV)

Preconditions (each requires the operator's explicit approval):

1. `R12F09_READINESS_FIX` merged; `APPROVED_SHA` = the resulting `main` commit (exact SHA, never a branch).
2. This PR merged (adds S5 end-to-end coverage only; no runtime change).
3. The R12F-09 validated rollback state is still current (Summary `sha256:07b05db…`, config hash
   `f3a18788…`, Reader `sha256:a3f9700…`, Caddy `6970ee2b…`). `preflight` verifies it read-only.

## Stage 1 — Summary v2 + catalog route + Reader UI (inference stays disabled)

```bash
export APPROVED_SHA=<40-hex main SHA>
sudo -E bash ai-functional-release.sh prepare
sudo -E bash ai-functional-release.sh preflight        # read-only
sudo -E bash ai-functional-release.sh build            # includes CANDIDATE_START (R12F-09)
sudo -E bash ai-functional-release.sh promote-summary  # auto-rollback + forensics on failure
sudo -E bash ai-functional-release.sh update-caddy
sudo -E bash ai-functional-release.sh promote-reader   # HTTP readiness probe
sudo -E bash ai-functional-release.sh smoke            # fail-closed catalog smoke + receipt
```

Expected user-visible result: Settings → Reading → Article intelligence lists S5 and Mistral Small as
unavailable ("Disabled" / "Paid inference not authorized"); "Summarize with AI" explains the model is not
available. No article leaves the server.

Rollback, in reverse order and each idempotent: `rollback-reader`, `rollback-caddy`, `rollback-summary`.

## Upgrade from an installed Stage 1 (e.g. `57f1c6a…` → a later approved SHA)

Requires its own merge and deploy authorization. Strategy: **two-service upgrade**. Summary and Reader are
both rebuilt and promoted at the new `APPROVED_SHA`, because `smoke` requires both image revisions to
match it. A Summary-only upgrade is not supported: `smoke` fails with `CODE=READER_REVISION`.

```bash
export APPROVED_SHA=<new 40-hex SHA on main>
sudo -E bash ai-functional-release.sh prepare
sudo -E bash ai-functional-release.sh preflight        # read-only; live Caddyfile must be an accepted prior state or already the target
sudo -E bash ai-functional-release.sh build
sudo -E bash ai-functional-release.sh promote-summary
sudo -E bash ai-functional-release.sh update-caddy     # see "Caddyfile transition" below
sudo -E bash ai-functional-release.sh promote-reader
sudo -E bash ai-functional-release.sh smoke
```

### Caddyfile transition (`update-caddy` / `rollback-caddy`)

The Reader's `/etc/caddy/Caddyfile` is a single-file bind mount. `update-caddy` holds the host release
lock (the same `flock` file `release.py` uses) and:

1. resolves the mount source on the host; refuses a symlink or non-regular file;
2. if the live file already equals this release's Caddyfile: `CADDY_UPDATE=ALREADY_APPLIED` (release does
   not change Caddy; `rollback-caddy` is then a verified no-op) or `ALREADY_APPLIED_BY_THIS_RELEASE`
   (idempotent re-run);
3. otherwise the live SHA-256 must be in the **closed** list `ACCEPTED_PRIOR_CADDY_SHAS` (pre-Stage 1
   `6970ee…`, Stage 1 `56d434b…`, AI settings `201d453…`), not configurable from the environment; anything else is
   `ACTIVE_CADDY_DRIFT` and nothing is written;
4. the in-container view must match the host file; the new file is validated with the running Reader
   image (`caddy validate`, `--network none`) **before** any write;
5. backup of the exact prior bytes to `$RELEASE_DIR/caddy/before.Caddyfile` (dir 0700, files 0600) with
   `before.sha256`, `target.sha256` and `before.stat` (mode, owner, inode);
6. in-place rewrite (same inode), hash check, `caddy reload` inside the Reader only (no container is
   recreated); a failed write or reload restores the exact prior bytes and reloads them
   (`WRITE_FAILED_RESTORED` / `RELOAD_FAILED_RESTORED`);
7. readback: inode unchanged and the container sees the target hash; `CADDY_UPDATE=PASS`.

`rollback-caddy` restores the backup only if the live file is exactly what this release installed
(`DRIFT_SINCE_RELEASE` otherwise, file untouched), verifies the backup hash first (`BACKUP_CORRUPT`),
reloads and reads back; a repeated run reports `ALREADY_RESTORED`.

Rollback of the upgrade, run with the same `APPROVED_SHA`, in reverse order, each step idempotent:
`rollback-reader`, `rollback-caddy`, then `rollback-summary`. This returns to Stage 1 exactly: same image IDs, Compose config hashes and
`config_files` sequences, and the same Caddyfile hash and inode. It does **not** go back to the
pre-Stage-1 state. That remains Stage 1's own rollback, run with Stage 1's `APPROVED_SHA`.

Rehearsed by `ops/deploy/release-governance/rehearse-stage1-upgrade.sh`, which installs Stage 1 with the
operator script as it exists at `57f1c6a`, then upgrades and rolls back with this one, always through a
real Stage 1 → new Caddyfile transition (failure injection before/during write and on reload, drift,
admin route methods, exact rollback). `test_caddy_transition.py` covers the same state machine without
Docker. Miniflux,
miniflux-db, NPM, LiteLLM and WallHop are not touched.

## Stage 2 — S5 activation (separate approval; free model only)

```bash
sudo python3 ops/deploy/release-governance/s5_key_audit.py ...  # operator-only admin read (see S5_KEY_GATE.md)
sudo -E bash ai-functional-release.sh s5-preflight     # read-only: key, alias, prices, budget, callbacks
sudo -E bash ai-functional-release.sh enable-s5        # hash-pinned config-only override
```

The key gate contract (why `/key/info` returns 403 for a least-privilege key, what counts as evidence,
and the admin attestation) is in [S5_KEY_GATE.md](S5_KEY_GATE.md).

Gates required before `enable-s5`: `S5_PREFLIGHT=PASS`, plus the operator's attestation of provider
privacy/retention (not technically verifiable). Mistral and the S5→Mistral fallback stay forced off.
Functional acceptance: one explicit click on one public article; the result footer must read
`Model: S5 (<alias>) · Source: original Miniflux text`. Disable with `disable-s5` (exact config restore).

## What this does not do

No WallHop (separate PR/gates), no paid inference, no change to Miniflux, miniflux-db, NPM or LiteLLM.
