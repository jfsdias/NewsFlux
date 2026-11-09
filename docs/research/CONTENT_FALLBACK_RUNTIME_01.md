# Content Fallback Runtime 01 — isolated validation record

## Scope and disposition

- Repository: `jfsdias/NewsFlux`
- Base reviewed: `99e434020e1ced468a9d0c7a7297c79f984334ea`
- Track: `CONTENT-FALLBACK-RUNTIME-01`
- Scope: operational audit, loopback-only synthetic runtime rehearsal, container healthcheck, and runbook evidence.
- Reader, ArticleDetail, application authentication, production Compose, NPM, Miniflux data, 13ft, and Article Intelligence are unchanged.
- No merge, image publication, OMV resource creation, or production deployment was performed.

## Existing service contract confirmed

The sidecar accepts `GET /healthz` and authenticated, empty-body `POST /v1/entries/{entry_id}/recover`. The caller provides only a numeric Miniflux entry ID; source URLs are read from Miniflux. The service uses a dedicated bearer token and a separately configured Miniflux token. The Miniflux adapter exposes reads only, including `GET /v1/entries/{id}/fetch-content?update_content=false`; it does not update article content, read state, or starred state.

Recovery defaults off. A recovery needs the global enable flag and an explicit feed/domain policy. A complete original body short-circuits provider use; rejected, incomplete, disabled, stale, or unavailable recovery returns the current Miniflux body. Successful content is validated and reconstructed as escaped paragraphs before being returned or stored.

WallHop receives only a source URL for an explicitly selected, public, policy-eligible article. The adapter does not forward cookies, Miniflux tokens, browser credentials, or caller headers. Source URL credentials, sensitive query parameters, unsafe schemes/ports, and private or reserved DNS answers are rejected. DNS is pinned for connections, redirects are revalidated, HTTPS downgrade is blocked, redirect count is bounded, the request timeout is eight seconds, and the response body is capped at 4 MiB. Global and per-source concurrency are bounded. The 13ft provider remains unavailable. The checked-in example keeps `enabled:false` and leaves Economist disabled.

The separate sidecar token is global service authentication, not proof of the currently signed-in NewsFlux user. Consequently the API must not be exposed to the browser or published as an unauthenticated public route. A future Reader integration still needs an explicit identity/authorization boundary; that is out of scope here.

SQLite stores only validated, sanitized overlays and compact provenance. It is owner-only, bounded to 512 records and 64 MiB, individual content is capped at 2 MiB, records expire after 30 days, and source/content fingerprint changes invalidate an overlay. Read/star state is not part of the fingerprint. The existing ADR selects an isolated sidecar, with no production Compose or Reader integration in this phase.

## Isolated runtime rehearsal

Command:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/content_fallback_runtime_01.py
```

The rehearsal starts the actual service HTTP handler and actual Miniflux client with synthetic HTTP fixtures bound to IPv4 loopback (`127.0.0.1`) on ephemeral ports. It uses synthetic credentials, an ephemeral SQLite file, fixed synthetic entries, and a mocked provider boundary. It does not instantiate the live WallHop transport and cannot send an article URL to WallHop. It checks startup, health, invalid service authentication without a Miniflux read, empty-body enforcement, successful sanitized recovery, incomplete fallback, stale-entry rejection, disabled-policy behavior, the sufficient-original short circuit, SQLite mode `0600`, persistence after stopping and restarting the service, safe log output, read-only Miniflux behavior, and orderly shutdown.

Observed receipt on the final local source tree:

```text
runtime_gate=PASS
health_gate=PASS
service_auth_gate=PASS
miniflux_read_only_gate=PASS
policy_gate=PASS
wallhop_mock_gate=PASS
content_validation_gate=PASS
fallback_gate=PASS
stale_entry_gate=PASS
sqlite_persistence_gate=PASS
secret_redaction_gate=PASS
bind_host=127.0.0.1
loopback_http_requests=17
miniflux_get_requests=8
miniflux_write_requests=0
wallhop_mock_calls=3
wallhop_live_requests=0
external_network_requests=0
sqlite_file_mode=0600
```

The receipt is a synthetic local result, not evidence of Docker networking, host egress enforcement, OMV capacity, or live-provider quality. The `external_network_requests=0` counter describes this harness configuration and its mock boundary; it is not an OS-level packet capture.

The rehearsal tests and the existing suite together pass 103 tests under Python 3.14.7. Existing deterministic tests cover the SSRF/DNS/redirect rules, response-size limits, provider timeouts, bounded retries, service concurrency limits, cache invalidation/retention, and SQLite bounds. The Dockerfile now defines a loopback `/healthz` healthcheck; the healthcheck was statically asserted, not run inside a built container.

Test-first evidence: the new focused tests were run before adding the runtime runner and healthcheck; they failed on the missing runtime gate and missing Dockerfile healthcheck. After implementation and adjustment of the synthetic recovery fixture to satisfy the existing 180-word completeness rule, the focused suite passed 4/4. The baseline service suite had passed 99/99 before the new tests; the final full service suite passed 103/103.

## Environment and unexecuted gates

| Gate                                       | Result                                                    | Evidence / limitation                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Existing + runtime Python tests            | `PASS`                                                    | 103 tests, zero failures, Python 3.14.7.                                                                                      |
| Loopback synthetic runtime                 | `PASS`                                                    | Receipt above; no real provider or production service.                                                                        |
| SSRF and content security                  | `PASS`                                                    | Existing deterministic tests plus the service audit; no external fetch.                                                       |
| Miniflux read-only behavior                | `PASS`                                                    | Eight synthetic GETs, zero synthetic writes; no production Miniflux access.                                                   |
| Service authentication and policy          | `PASS`                                                    | Wrong token rejected before Miniflux access; disabled policy skips provider.                                                  |
| Cache and rollback mechanics               | `PASS` locally                                            | SQLite survives a service stop/restart; shutdown is exercised. No OMV volume/backup/restore was touched.                      |
| Resource limits                            | `PASS` in deterministic tests                             | Timeouts, bounded attempts, response caps, and concurrency limits tested. CPU/memory behavior of a container is not measured. |
| Docker image build and healthcheck runtime | `NOT_TESTED`                                              | Docker is unavailable in the development environment. The Dockerfile healthcheck is not a container-runtime receipt.          |
| OMV PRESTATE                               | `NOT_ACCESSED`                                            | No OMV host, container, network, disk, or resource was inspected or changed.                                                  |
| WallHop live canaries                      | `NOT_TESTED — AWAITING EXPLICIT SAMPLE/TRANSFER APPROVAL` | No URL or article data was sent to WallHop. Earlier managed-workspace 403 evidence remains historical and was not re-tested.  |
| Browser / device gate                      | `NOT_APPLICABLE`                                          | No NewsFlux UI or Reader integration changed.                                                                                 |

There is no real-publisher recovery result in this phase. Any eventual candidate among NYT, Bloomberg, WSJ, or Folha requires a PM-approved public sample URL, a documented original-content baseline and expected result, and explicit approval to transfer that URL to WallHop. No canary result may be inferred from the synthetic fixture. Economist remains disabled.

## Deployment and rollback boundary

This PR does not edit the production Compose file, create an OMV resource, publish a port, add a reverse-proxy route, create a registry image, change secrets, or enable recovery policies. A future isolated runtime must first complete a read-only OMV PRESTATE and receive separate authorization before creating resources. It should use an image pinned to an approved source SHA/digest, a private network and private SQLite volume, distinct secrets from a secret manager, no public port, and `enabled:false` initially.

Operational rollback is to disable the sidecar route/policy and stop the sidecar. No Miniflux restore is needed because the sidecar is read-only. The local rehearsal proves its process can be stopped and restarted; it does not prove OMV rollback or backup/restore.

## Future Reader contract (not implemented)

The current response has `entry_id`, `url_fingerprint`, `content_origin`, `status`, `content_html`, and `validation`, with provider provenance on successful recovery. It does not expose `content_fingerprint`, `source_fingerprint`, or `recovery_status`; `content_fingerprint` is an internal snapshot/cache value only. Those names must not be assumed to exist in the API. A future Reader adapter must bind the response's entry ID and URL fingerprint to the currently displayed entry and preserve original content on any failure or stale response. Authorization must be resolved before the browser can use the service. This work belongs in `CONTENT-FALLBACK-READER-01`.

## Residual risks and next step

- Live provider extraction quality, response time, and accessibility of the four candidate publishers remain unknown.
- The sidecar's global bearer token is not a per-user authorization mechanism.
- Miniflux token permissions and the production private-network route require deployment review; issuing GET-only calls does not make a stolen token read-only.
- WallHop performs the publisher fetch outside this service; local DNS validation cannot control WallHop's later network resolution.
- Container CPU/memory limits, OMV resource headroom, Docker healthcheck behavior, and backup/restore remain unverified.
- Content-completeness assessment is heuristic; only approved, lawful live samples can establish source-specific quality.

Next: PM review of the isolated service and runtime evidence. After review, obtain a read-only OMV PRESTATE and separately approve each live WallHop sample/transfer before any server resource creation or real-provider request. No merge or deploy is implied by this record.
