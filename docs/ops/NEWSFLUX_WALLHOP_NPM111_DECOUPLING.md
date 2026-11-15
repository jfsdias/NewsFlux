# NEWSFLUX-WALLHOP-NPM111-DECOUPLE-01

**Status: PROPOSED / DRAFT.** Current main baseline: `4ea6581d1c8641e8619aa974e04b856695831e10`. WallHop candidate: PR #244 at `1ccd10a4309761a02c838a35e2fa86229baaa559`. This document is an architecture gate, not a rollout or merge authorization.

## Evidence and original conflict

The existing PR188 runtime is `newsflux-pr188-content-fallback`, service `content-fallback`, Compose project `newsflux-pr188-p2b-minimal`, joined to `npm-proxyyml_default`. Its RW volume contains SQLite and WAL/SHM. Operator-reported G2B evidence: NPM host 111 has a persisted `proxy_pass` to this container and selected 111 access logs contain 256 parseable requests in 24 hours and 775 in seven days. Loaded Nginx configuration and client identities remain unverified; these counts do not justify retirement.

PR #244 currently applies `networks: !override` to that very same service, removing its NPM network and leaving only `newsflux_wallhop_reader` and `newsflux_wallhop_egress`. Its `npm_upstream_gate` correctly blocks this while host 111 references PR188. Disabling the gate would create a potential live route outage. Do not disconnect, rename, stop or remove PR188, edit NPM111, or touch the existing volume.

## Proposed non-disruptive topology

Keep NPM host 111, the legacy container, its DNS identity, its `npm-proxyyml_default` membership and its SQLite volume unchanged. A new independent `newsflux-wallhop-content-fallback` instance would serve only the Reader's private same-origin bridge, through internal `wallhop_reader` and `wallhop_egress` networks. The new sidecar would have its own Compose project, service, name, DNS alias and non-shared storage, with no published ports, no NPM network and a policy that remains disabled until separate gates pass.

Reader/Caddy would address the new sidecar only by its private alias. A dedicated hardened SNI/TLS egress relay would be the sole outward path for the new sidecar; the relay, not the sidecar, may have a controlled connection to the shared NPM network. A new durable volume is not authorized by this document: its ownership, retention, backup, privacy and restoration require an independent decision. Isolated tests may use a disposable separate volume without migrating live PR188 data.

## Required implementation and security gates

A separate functional PR based on current `main` must replace PR244's legacy service override with a new isolated candidate and ensure no reuse of PR188 network aliases or RW mounts. It must preserve Reader existing networks and Caddy route parity, use an exact approved SHA/image, and fail closed if the NPM111 configuration, legacy container identity, Compose configuration, volume or protected service fingerprints drift. The operator's `PR188_G2C_RUNTIME_UPSTREAM_AND_TRAFFIC_CLASSIFICATION_READ_ONLY` receipt must precede any live candidate admission.

Test-driven development must first reproduce the host111 break in a disposable topology, then prove host111 routing remains functional before, during and after candidate activation. Regression tests must establish separate identities/storage, zero published ports, no direct NPM/Miniflux Internet path from the new sidecar, fail-closed SNI/TLS relay, disabled policy, and complete transactional rollback of new release-owned resources only. On rollback, legacy PR188 and NPM111 must remain unchanged; partial restoration is a hard failure and requires manual reconciliation.

## Holds and release order

PR244 is `NO_GO_AS_WRITTEN`; PR251 documents the solution but does not implement it. `WALLHOP_REAL_CONTRACT=BLOCKED`, `SOURCE_POLICY=BLOCKED`, and `NEW_STORAGE_DECISION=PENDING`. Real-source terms, public-access suitability and the WallHop `/raw/` contract are unverified. Paywalled access is not approved. No WallHop activation, no Miniflux or NPM mutation, and no PR merge or production deployment are permitted by this document.

Once the read-only G2C gate, architectural storage decision, isolated implementation, comprehensive CI, exact-main rebase, security review and operator approval exist, a separate release decision may follow. Until then the current PR188/NPM111 route must be preserved.

References: [PR #244](https://github.com/jfsdias/NewsFlux/pull/244), [PR #188](https://github.com/jfsdias/NewsFlux/pull/188), and the central Home Server G0/G1/G2/G2B ledger.
