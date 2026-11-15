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

## Reader recovery end to end

`rehearse-reader-recovery.sh` (real `Caddyfile.wallhop`, real sidecar image with the Reader bridge, real relay,
synthetic WallHop and synthetic Miniflux from `scripts/reader-wallhop-p1-r2/fixture_server.py`): 10/10 —
recovery through the same-origin route, sanitized content (no script/img/tracker), WallHop receives only the
Miniflux-authorized entry URL and no credential header, wrong key and other user rejected, untrusted client
cannot reach the bridge, zero Miniflux writes, sidecar on internal networks only. It found and fixed a real
defect: with the relay enabled, every recovery ended `skipped_security` because the publisher SSRF check used the
egress map instead of public DNS.

The browser flow (consent, cancel, Original/Recovered toggle, failure keeps original) is covered by
`e2e/reader-content-recovery.spec.js` (R2-1…R2-6) and the CI job "Exact-SHA images and same-origin HTTPS".

## Gates that block activation

| Gate                    | State                    | Evidence / what unblocks it                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WALLHOP_REAL_CONTRACT` | **BLOCKED**              | Re-checked 2026-11-15: the agent egress proxy refuses `wallhop.io` (`connect_rejected`). `/raw/<url>` behaviour, formats, limits and terms are unverified. Prepared, not run: `wallhop_contract_audit.py` (operator-only; authorization token for the current date; 3 GET requests at most, no retries or redirects; approved public article only; paywalled domains refused; private output). Unblock: the operator authorizes and runs it once from the OMV, then reviews the saved terms. |
| `SOURCE_POLICY`         | **BLOCKED**              | No operator-approved source. Policies stay `{"enabled": false}`; `config.example.json` is now an empty, disabled policy (the paywalled candidates were removed). Candidate matrix and required evidence: [`docs/ops/WALLHOP_SOURCE_POLICY.md`](../../docs/ops/WALLHOP_SOURCE_POLICY.md).                                                                                                                                                                                                     |
| `ACTIVATION_PROCEDURE`  | **REHEARSED (isolated)** | `wallhop-activation.sh` is transactional and rehearsed in disposable Docker by `rehearse-wallhop-activation.sh` (CI job `wallhop-b-topology`). Faults are injected in every activation stage and every restore step (Caddy, Reader, sidecar, relay, networks). Not run against the live host.                                                                                                                                                                                                |

**`NPM_UPSTREAM` gate (new, blocks activation):** the ledger's G2 audit found the protected
**NPM host 111** with a literal `proxy_pass` to `newsflux-pr188-content-fallback`. That is the
container this procedure takes off `npm-proxyyml_default`. Activating would leave that host without
an upstream, so `activate-infra` now refuses before any change unless both of these hold:

- the operator provides the NPM proxy-host directory read-only (`WALLHOP_NPM_PROXY_HOST_DIR`);
- no non-comment line there names the sidecar's container, its Compose service or its network
  aliases.

Only file names are reported. NPM itself is never edited. Unblocking it is a separate NPM decision
(host 111 is protected): either retire that route through the PR188 retirement audit, or point it
elsewhere.

Activation order once unblocked: networks → relay project → sidecar override (record previous config hash) →
Reader network release (`release.py --extra-override reader.override.yaml --network-added newsflux_wallhop_reader`)
→ `Caddyfile.wallhop` → Reader build with recovery path → enable the approved policy. Rollback in reverse;
Miniflux, miniflux-db and NPM are never modified.

## Activation transaction semantics (`wallhop-activation.sh`)

| Situation                                                                              | Behaviour                                                                                               | Exit                                     |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `activate-infra` succeeds                                                              | All stages pass; policy stays `{"enabled": false}`                                                      | 0                                        |
| Any stage fails (networks, relay, sidecar, Reader plan/promote, Caddy validate/reload) | Automatic rollback to the recorded baseline, verified by readback                                       | 1 (`ROLLBACK=PASS`)                      |
| Rollback cannot restore the baseline                                                   | `ROLLBACK=PARTIAL FAILURES=…`, `rollback-receipt.txt` written; re-run `rollback`                        | 2                                        |
| `enable-policy` fails                                                                  | Policy restored to `{"enabled": false}` and `READER_ENABLED=false`, sidecar identity verified unchanged | 1 (`POLICY_RESTORED_DISABLED=PASS`) or 2 |
| `rollback` (explicit)                                                                  | Same readback as above; idempotent                                                                      | 0 or 2                                   |

The baseline (sidecar project/files/identity/networks, Reader identity/networks, Caddyfile, protected-service
identities, pre-existing networks) is recorded before the first change. Networks are removed only if this run
created them; the relay is removed only within its own Compose project. `WALLHOP_TEST_FAULT` is honoured only
together with `WALLHOP_REHEARSAL_OVERRIDE`; otherwise the script refuses to run.

The rehearsal refuses to start on a host that has `newsflux`, the sidecar, `miniflux`, `miniflux-db` or any
`newsflux_wallhop_*` network, and its cleanup removes only containers labelled `org.newsflux.rehearsal=<run>`
and networks it created. An unrelated decoy relay must survive (`UNRELATED_RELAY_UNTOUCHED`, `CLEANUP_SCOPE`).
