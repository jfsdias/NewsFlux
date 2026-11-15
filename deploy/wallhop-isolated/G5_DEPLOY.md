# WallHop G5 — exact-SHA DARK deployment only

Status: **DRAFT / NOT MERGED / NOT EXECUTED ON OMV**. This is a proposed operator tool, **not** a production rollout authorization.

## What this does

G5 is the next stage after the **historical** PR #255 G4 canary. G4 remains unchanged and pinned to its old SHA/fingerprint. This G5 executor accepts an operator-approved **40-character full SHA** of `jfsdias/NewsFlux/main`, the independently recorded protected Docker fingerprint, the NPM111 file SHA256, and a locally present immutable relay **image ID**.

Two explicit modes: `--check-only` (no Docker resources created; remote main, current protected state, local image, space and visible IPAM/VPN routes checked) and `--execute` (requires a **separate operator GO**, `NEWSFLUX_G5_ACK=ISOLATED_DARK_DEPLOY_ONLY`, root and non-CI environment). No arguments => NOOP. The command refuses a moved `main`, changed protected fingerprint/NPM111 hash, pre-existing candidate/network, occupied /28s, unverified active VPN route fields, insufficient disk space, mutable relay image tags, or invalid topology.

`--execute` archives the **exact approved main SHA** into a new private path under `/dockerdata/compose/newsflux/wallhop-dark/releases/<full-SHA>`, builds only the **new** recovery image with a revision label, consumes a locally pinned HAProxy image ID (no mutable tag), expands and verifies disabled Compose topology and explicit /28s, repeats IPAM/protected checks near startup, starts only `newsflux-wallhop-recovery` and `newsflux-wallhop-egress`, validates health/identity/networks/readonly/tmpfs and protected poststate. On failure after any start it brings down the **new project only**, checks absence and protected hashes, and reports `G5_ROLLBACK=PASS|FAIL` (FAIL => HOLD). On success, it leaves the DARK candidate running and retains its source/config mount; it does **not** enable Reader routing or provider retrieval.

The new /28s are still the previously tested **candidate** pair `10.240.0.96/28` and `10.240.0.112/28`, rechecked live but **not globally reserved**. Observed host/VPN routes do not prove absence of unknown remote routes. Any subnet change requires a new reviewed implementation, not relaxing the gate.

## Mandatory boundaries

- Preserve NPM proxy host **111**, legacy PR188 sidecar and its SQLite/WAL RW volume, NewsFlux, Reader/Caddy, Miniflux/DB, LiteLLM and production Compose.
- No Reader bridge (`CONTENT_FALLBACK_READER_ENABLED=false`), no recovery policy (`{"enabled":false}`), no published ports, no durable sidecar volume.
- Synthetic Miniflux host (`miniflux.example.test`) and synthetic tokens only. Both relay upstreams are forcibly blackholed to `127.0.0.1:9`; no real WallHop or external article requests.
- A successful G5 dark deployment is **NOT** production activation, **NOT** proof of live WallHop effectiveness, **NOT** source-policy/privacy/provider-contract approval, and **NOT** PR #244 approval.
- `restart: "no"` and `/data` on tmpfs: the dark candidate is intentionally **non-durable**. Its container can disappear on host reboot and no data is intended to be preserved. Docker image/cache and the release source directory can persist.
- Do **not** run G5 `--execute` until this PR is reviewed, merged by explicit user authorization and a distinct OMV operator gate is authorized. The PM has not run it in the Home Server.

## Operator preflight (read-only)

Collect the baseline separately from the current OMV. **Never publish secrets, tokens, raw Docker JSON or complete Nginx configurations.** The fingerprint algorithm must match the one in `g5-dark-deploy.sh` (G4-compatible: protected container IDs, image IDs, network memberships and mount identities). The existing G3 value `3adeb9e111a2e108` was valid only for its earlier snapshot; it is not a perpetual expected value.

Use sanitized probes for the exact remote main, local relay image ID and NPM111 config hash:

```bash
git -C /dockerdata/compose/newsflux/repo ls-remote origin refs/heads/main
docker image inspect -f '{{.Id}}' haproxy:3.0.5-alpine
docker exec npm sha256sum /data/nginx/proxy_host/111.conf
```

Compute the protected fingerprint from a **reviewed operator read-only inventory** using exactly the `fingerprint_protected()` logic in this script. Explicitly compare it with the prior approved prestate. A fingerprint derived only after unexpected drift must not be accepted without an investigation.

The exact SHA must also be present in the local Git object store for `--check-only`. That mode intentionally does not run `git fetch`; source sync, if necessary, is a separate operator action.

Only with all four exact values established and independently accepted, an operator may run the read-only admission (substitute the actual validated values; placeholders below are not defaults):

```bash
bash deploy/wallhop-isolated/g5-dark-deploy.sh --check-only \
  --source-sha "$APPROVED_MAIN_SHA" \
  --expected-protected-fingerprint "$APPROVED_PROTECTED_FP" \
  --expected-npm111-sha "$APPROVED_NPM111_SHA256" \
  --egress-image-id "$APPROVED_HAPROXY_IMAGE_ID"
```

An eventual `--execute` uses the **same** four flags plus root, explicit `NEWSFLUX_G5_ACK=ISOLATED_DARK_DEPLOY_ONLY`, a distinct operator GO and a fresh protected/IPAM admission. **Do not execute now.**

## Tests and outstanding gates

Offline GitHub Actions: `wallhop-g5-dark-deploy.yaml` runs the G5 negative admission tests, `bash -n` and the existing G4/IPAM/topology regression suite. All are offline: no production smoke has been performed.

Before any OMV trial: review rollback behavior under partial Docker creates and signal interruption, validate release-directory mount persistence, provide a specifically reviewed operator teardown/rollback procedure for a successful dark deploy, verify CIDRs at that time and repeat independent protected host111/PR188 readback. No provider/network source-policy gate can be waived by G5 passing.

```text
PR255=MERGED_HISTORICAL_ONLY
G5=IMPLEMENTED_IN_DRAFT_PR_NOT_DEPLOYED
CODE_GATE=CI_REQUIRED
REAL_DEVICE_GATE=NOT_RUN
PROVIDER_CONTRACT=HOLD
SOURCE_POLICY=HOLD
READER_BRIDGE=DISABLED
PR244=HOLD
PRODUCT_ACTIVATION=NOT_AUTHORIZED
```
