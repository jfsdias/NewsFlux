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
sudo -E bash ai-functional-release.sh preflight        # read-only; accepts the installed pilot Caddyfile
sudo -E bash ai-functional-release.sh build
sudo -E bash ai-functional-release.sh promote-summary
sudo -E bash ai-functional-release.sh update-caddy     # CADDY_UPDATE=ALREADY_APPLIED: file and inode untouched
sudo -E bash ai-functional-release.sh promote-reader
sudo -E bash ai-functional-release.sh smoke
```

Rollback of the upgrade, run with the same `APPROVED_SHA`, in reverse order, each step idempotent:
`rollback-reader`, `rollback-caddy` (reports `NOT_APPLICABLE_UNCHANGED_BY_THIS_RELEASE` after checking that
the Caddyfile hash is still the one the upgrade found; any later edit gives `DRIFT_SINCE_RELEASE`), then
`rollback-summary`. This returns to Stage 1 exactly: same image IDs, Compose config hashes and
`config_files` sequences, and the same Caddyfile hash and inode. It does **not** go back to the
pre-Stage-1 state. That remains Stage 1's own rollback, run with Stage 1's `APPROVED_SHA`.

Rehearsed by `deploy/release-governance/rehearse-stage1-upgrade.sh`, which installs Stage 1 with the
operator script as it exists at `57f1c6a`, then upgrades and rolls back with this one. Miniflux,
miniflux-db, NPM, LiteLLM and WallHop are not touched.

## Stage 2 — S5 activation (separate approval; free model only)

```bash
sudo python3 deploy/release-governance/s5_key_audit.py ...  # operator-only admin read (see S5_KEY_GATE.md)
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
