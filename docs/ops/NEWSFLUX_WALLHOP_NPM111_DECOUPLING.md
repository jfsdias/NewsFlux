# NEWSFLUX-WALLHOP-NPM111-DECOUPLE-01 — compatibility-preserving architecture gate

**Status:** PROPOSED / DRAFT / NO DEPLOY / NO MERGE AUTHORIZATION.
**Source GitHub main audited:** `4ea6581d1c8641e8619aa974e04b856695831e10` (PR #250 merged and deployed, per operator receipt on 2026-11-15).
**Existing WallHop candidate:** PR #244 HEAD `1ccd10a4309761a02c838a35e2fa86229baaa559` (DRAFT/HOLD, historically based on `f7b2987...`).
**Governance:** no update to NPM host 111, Miniflux, NewsFlux Reader, PR188 runtime/volume, LiteLLM, DNS, Caddy or production Compose in this documentation PR.

## The confirmed incompatibility

The existing PR #188 sidecar is a separate Compose project `newsflux-pr188-p2b-minimal`, service `content-fallback`, container `newsflux-pr188-content-fallback`, connected to `npm-proxyyml_default`; it has a named RW `/data` volume with SQLite/WAL/SHM. OMV operator G2/G2B receipts found NPM host **111** has a persisted `proxy_pass` reference to that container and parsed **256 requests in 24 hours** and **775 in 7 days** from selected host 111 access logs. This is evidence of recent log activity, not yet proof of exact live Nginx upstream and clients. No evidence authorizes retiring its route or database.

PR #244's `deploy/wallhop-b/sidecar.override.yaml` currently applies `networks: !override` to **the same** `content-fallback` service, replacing its NPM membership with private `wallhop_reader` and `wallhop_egress` networks. `wallhop-activation.sh:stage_sidecar` requires those two private networks only. `npm_upstream_gate` intentionally blocks a `111.conf` that still names the existing sidecar. Do **not** simply suppress that gate or let the Reader candidate sever the live host 111 route.

## Preferred solution to implement in a *separate functional PR*

**Preserve the legacy PR188 runtime and provide a new, independently named WallHop sidecar.** The proposed topology is:

```text
Existing live path (unchanged):
  HTTPS clients ── NPM host 111 ── npm-proxyyml_default ── newsflux-pr188-content-fallback
                                                                └─ current RW SQLite/WAL volume

New, initially DISABLED path (not deployed or approved by this document):
  Browser ── HTTPS/NPM Reader ── Caddy same-origin POST ── wallhop_reader (internal)
                                                       └─ newsflux-wallhop-content-fallback
                                                           └─ wallhop_egress (internal)
                                                                  └─ hardened SNI relay
                                                                         └─ tightly allowed egress
```

The new container must use a **different Compose project, service name, container name, DNS alias and storage target** than PR188, with zero shared RW mounts. Reuse of the old container/volume, port publication, direct NPM membership for the new sidecar, and implicit migration are prohibited. A new persistent volume remains an **architectural decision gate** (retention, backup, ownership, encryption, user isolation); a disposable nonpersistent volume is acceptable for isolated tests only.

The relay and Reader may use the private networks as designed in #244, but the new sidecar MUST NOT inherit NPM exposure. The existing NPM host111 continues to resolve the original container. Until the Reader bridge is separately approved, the new sidecar's reader policy remains disabled.

## Required implementation adjustments and tests

Create a dedicated **functional PR** based on current `main`—do not merge the old PR #244 as-is. Preserve the #244 TDD/test fixture and privacy contract, then update these exact surfaces with focused change control:

1. **Identity separation:** rename the WallHop candidate service, Compose project and container; remove `!override` of legacy `content-fallback`. Do not attach the new service to NPM or use the PR188 RW volume. Pin image to the approved SHA/digest. Keep `CONTENT_FALLBACK_POLICIES_JSON={\"enabled\":false}`.
2. **Reader routing:** Caddy bridge may target only the new private alias on `wallhop_reader`; the Reader's existing external/proxy and Summary networks must be preserved. No change to NPM host111 target.
3. **Preflight:** fail closed if any existing `newsflux-pr188-content-fallback` identity, Compose config hash, network list, named-volume identity, NPM111 conf hash, active proxy route or protected-service identity differs from baseline. Verify the *loaded Nginx config* via sanitized, read-only evidence (G2C) before an activation candidate.
4. **Transaction/rollback:** on failure, remove only release-owned new containers/networks/mounts; restore any Reader/Caddy differences from exact manifests; never recreate, disconnect, stop, rename, remove or modify the legacy sidecar. Reconcile NPM111 and PR188 again after rollback. If any protected identity drifts, fail closed with `ROLLBACK=PARTIAL`.
5. **Negative tests:** (a) 111.conf still points to old sidecar and traffic path survives, (b) new sidecar has private networks only and no published ports, (c) no cross-RW mount, (d) direct network and DNS resolution to NPM/Miniflux from new sidecar are blocked, (e) relay is the sole egress path with TLS/SNI verification, (f) the disabled policy never fetches publishers, (g) failed activation leaves PR188/NPM111 identity and Caddy unchanged, (h) runtime config and logs are sanitized, (i) no new persistence without separately approved decision.
6. **Rehearsal:** run full Docker Compose disposable topology with synthetic NPM111 traffic before/during/after activation and every injected failure; 0 regressions. Do not use synthetic PASS as proof of real NPM111 runtime or terms.
7. **Live admission gates:** `NPM111_G2C_RUNTIME_AND_TRAFFIC`, `LEGACY_STATE_PRESERVED`, `STORAGE_DECISION`, `READER_ROUTE_PARITY`, `SOURCE_POLICY`, `WALLHOP_REAL_CONTRACT`, exact main SHA and independent release authorization. Keep `SOURCE_POLICY` and `WALLHOP_REAL_CONTRACT` **BLOCKED** until verified; no paywall circumvention.

## Options not selected

- **Delete/retire PR188 or change NPM111:** NO; recent traffic, RW state, missing restore and loaded-config proof. This requires a separate retirement/migration campaign and explicit operational authorization.
- **Keep one sidecar on NPM and additionally join it to private networks:** NO for the isolated WallHop target; a shared network keeps the direct connectivity and weakens the isolation contract.
- **Silently replace 111's DNS alias with a new proxy:** NO; a new access path, routing/security boundary and rollback risk must be independently reviewed.
- **Bypass #244 `NPM_UPSTREAM` gate:** NO; it accurately protects a consumer.

## Sequencing and accounting

```ini
HOST111_DEPENDENCY=ARCHITECTURAL_PATH_IDENTIFIED_NOT_YET_IMPLEMENTED
LEGACY_PR188=KEEP_PROTECTED
NPM111=KEEP_PROTECTED
PR244_AS_WRITTEN=NO_GO
NEW_FUNCTIONAL_PR_REQUIRED=YES
PR236_AI_UI_DOCS=SEPARATE_TRACK
WALLHOP_REAL_CONTRACT=BLOCKED
SOURCE_POLICY=BLOCKED
READER_ACTIVATION=HOLD
STORAGE_DECISION=PENDING
NO_MERGE_WITHOUT_NEW_USER_AUTHORIZATION=YES
NO_DEPLOY_WITHOUT_NEW_USER_AUTHORIZATION=YES
NEXT_GATE=G2C_READ_ONLY_RUNTIME_UPSTREAM_AND_TRAFFIC_CORRELATION
```

Reference: [PR #244](https://github.com/jfsdias/NewsFlux/pull/244), [PR #188](https://github.com/jfsdias/NewsFlux/pull/188), and central Home Server ledger (G0/G1, G2, G2B campaigns). No raw logs, credentials, private article content or database bytes belong in git.
