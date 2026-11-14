# WallHop topology B — controlled egress (supersedes the draft in jfsdias/NewsFlux#239)

Reconciled with the confirmed OMV inventory: Reader in project `newsflux`, Miniflux in project `miniflux`,
sidecar in project `newsflux-pr188-p2b-minimal`, all three currently on `npm-proxyyml_default`. Nothing here
assumes they share a Compose project, and **Miniflux, miniflux-db and NPM are not modified or recreated**.

```text
Browser ─HTTPS─ NPM ─ Reader/Caddy ──(newsflux_wallhop_reader, internal)── sidecar
                                                                              │
                                                       (newsflux_wallhop_egress, internal)
                                                                              │
                                     relay (HAProxy, TLS passthrough, SNI allowlist) ── npm-proxyyml_default
                                        ├─ SNI wallhop.io            → wallhop.io:443 (Internet)
                                        └─ SNI <public Miniflux host> → npm:443 → Miniflux (unchanged)
```

- The sidecar leaves `npm-proxyyml_default` (`networks: !override`) and has no published port.
- Every outbound request is pinned by `EgressRelayResolver` to the relay; TLS validates the original hostname.
  Non-allowlisted hosts, IP literals, other ports, `http://` and redirects to such targets fail before connecting.
- The relay accepts only allowlisted SNI; no SNI or another name is closed before any upstream connection.
  A DNS change pointing an allowlisted name elsewhere fails TLS validation in the sidecar.
- `CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY=true` makes the sidecar refuse to start without the relay.
- The Reader joins the internal `wallhop_reader` network with a static address through a hash-pinned
  `--extra-override` + `--network-added` release (`release.py`); its other networks are unchanged.
- `Caddyfile.wallhop` = current pilot Caddyfile + the #234 Reader bridge route (validated, R17-H12 static
  route gates PASS). It is only installed in the WallHop activation step.

## Evidence

`rehearse-topology.sh` (real sidecar image, real `haproxy.cfg`, synthetic endpoints with a throwaway CA):
12/12 gates — sidecar healthy; WallHop and Miniflux reachable only via the relay with TLS validated;
app-level allowlist; no direct route to Internet/NPM/WallHop/DNS; relay rejects unlisted and missing SNI;
DNS hijack defeated by TLS; no published ports; only internal networks; no IPv6 path; hardened relay
(read-only, non-root, all capabilities dropped); fail-closed without relay.

## Not done (blocks activation)

1. **Approved sources.** `CONTENT_FALLBACK_POLICIES_JSON` stays `{"enabled": false}`. Only operator-approved,
   publicly readable sources whose terms permit automated retrieval may be listed. Paywalled sources (the old
   `config.example.json` candidates) must not be enabled: that would circumvent access controls.
2. **Real WallHop contract.** `wallhop.io` is blocked from the agent environment; `/raw` and `/api`
   availability, format and limits were not verified against the live service.
3. **Operator activation procedure** (networks, relay project, sidecar override, Reader network release,
   Caddyfile swap, Reader build with `VITE_CONTENT_FALLBACK_READER_BASE_PATH=/api/content-fallback`) and its
   rehearsal with the Reader bridge end to end are not written yet.
