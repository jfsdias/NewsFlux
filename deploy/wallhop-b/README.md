# WallHop B private topology — blocked candidate

This is an infrastructure proposal, **not a deployment authorization or a working WallHop route**. It does not include the Caddy fragment from draft PR #234. No production Compose files, Miniflux, NPM, Summary API, or LiteLLM are changed by this proposal.

The JSON document is a Compose-format candidate for two project-private internal bridges: `newsflux` ↔ `content-fallback` and `content-fallback` ↔ `miniflux`. The sidecar has no published host port and both Reader recovery and the provider registry are explicitly disabled. It intentionally has no external egress network, so WallHop is unreachable until a separately reviewed, technically enforced HTTPS-only path and safe DNS resolution are designed and tested. Network names alone do not prove ACLs or prevent a multihomed container from reaching unintended services. The implementation cannot yet satisfy the controlled `wallhop.io` egress requirement.

Do not apply this overlay to a runtime. `newsflux` and `miniflux` are candidate Compose service names; the actual project and its active effective Compose stack must be reconciled before use. Compose merges network attachments, and existing Miniflux and Reader access must be preserved. An internal bridge does not itself protect against unauthorized peers attached to that bridge. Exact static Reader IPs, trusted proxy identities, non-overlapping subnets, DNS resolution of source hosts without SSRF, a digest-pinned image, private file permissions, and effective network membership all remain target-side gates. The PR #234 Caddy fragment, proxy trust, and path contract must be reviewed against its then-current HEAD without importing it into this infrastructure patch.

Run offline checks:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s deploy/wallhop-b -p 'test*.py'
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s services/content_fallback/tests -p 'test_*.py'
```

These validate the declared candidate and existing application-layer checks. They do not start Docker, inspect target state, prove live isolation, validate TLS/DNS/redirect behavior over the candidate topology, or test a rollback. A disposable Compose stack with synthetic Reader, Miniflux, DNS and HTTPS provider is required to validate those gates with zero real publishers, zero WallHop calls and zero Miniflux writes. A reviewed exact prestate and isolated rollback rehearsal are prerequisites to preparing an operator-only rollback; the present document is not a rollback procedure.

A separate CI-only Docker rehearsal uses synthetic HTTP servers on two internal networks. It checks Reader-to-sidecar and sidecar-to-Miniflux reachability, Reader DNS separation, no published ports and failed access to a reserved documentation IP. It performs no real publisher, WallHop or Miniflux request. This rehearsal models the topology; it does not execute the candidate overlay, validate controlled HTTPS egress, or prove production rollback.
