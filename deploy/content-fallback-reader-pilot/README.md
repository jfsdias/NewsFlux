# Reader recovery ingress preparation

This directory contains only a Caddy route fragment and its isolated test. It
does not replace the active Caddyfile, alter Compose, create Docker networks,
publish the Content Fallback port, enable recovery, or contact Miniflux,
WallHop, LiteLLM, or the Summary API.

The fragment must be imported inside the existing `:2000` NewsFlux site block.
It allows only `POST /api/content-fallback/reader/v1/entries/{positive-id}/recover`
from the one configured reverse-proxy IP when that proxy supplies
`X-Forwarded-Proto: https`. It strips `/api/content-fallback` before forwarding,
so the sidecar receives `/reader/v1/entries/{id}/recover`. All other
`/api/content-fallback/*` paths and methods return 404. The sidecar's private
`/v1/entries/{id}/recover` and `/healthz` paths are never routed from the
Reader.

The Caddy hop replaces forwarding metadata and removes `Forwarded`,
`Authorization`, `Cookie`, and `X-Forwarded-Client-Cert`. The only authentication
headers forwarded are the two Reader Bridge inputs: the user's Miniflux API key
and the claimed Miniflux server. The sidecar validates the exact Origin,
transport trust, user identity and role, article/feed ownership, current
fingerprints, and session state before and after recovery. The private service
token is used only on the sidecar's loopback handoff; it is not sent by Caddy or
to WallHop.

## Preconditions before a target-specific Compose change

The current OMV account could reach the host but lacked permission to read the
Docker socket. The effective Compose files and running Caddyfile therefore
remain unverified. Do not consume the historical container IDs or the readable
repository checkout as current runtime identity. Before preparing a target
overlay, capture through an already authorized read-only Docker account:

- the running Reader and Content Fallback image IDs and revision labels;
- all active Compose file paths and hashes, plus the active Caddyfile hash;
- the NPM-to-Reader peer address and each relevant container's network/IP;
- whether a dedicated Miniflux network already exists and its membership;
- published-port bindings, health, mounts, volume identity and SQLite metadata;
- only the presence/perms of secret mounts and sanitized flags/policy counts;
- the exact Main and service user IDs/roles through authorized Miniflux GETs.

Never print tokens or key values. If the Reader or sidecar is attached to the
shared NPM network, do not treat that as private isolation. The proposed target
topology is:

1. NPM stays on its existing edge network and continues to reach only the
   Reader Caddy. NPM must overwrite client-supplied forwarding headers.
2. Reader Caddy and Content Fallback share a dedicated internal bridge network.
   Content Fallback is not attached to the NPM network and publishes no host
   port.
3. Content Fallback reaches Miniflux over a dedicated private network shared
   only by those services. Adding Miniflux to a network is a production change
   and needs a separately reviewed Compose/rollback plan.
4. Any outbound WallHop path is a distinct target gate. Do not change host
   firewall or network policy in this delivery.

Set `NEWSFLUX_PILOT_TRUSTED_PROXY_IP` to the exact NPM peer address observed by
Reader Caddy. Set `CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS` to the exact static
Reader Caddy address observed by the sidecar. Reject subnets, wildcards, and
addresses inferred from an old deployment. The NPM must terminate HTTPS and
overwrite `X-Forwarded-Proto`; the isolated test proves only the behavior of its
synthetic edge proxy, not the active NPM configuration.

## Fail-closed feature settings

Build the Reader and Content Fallback images from the same approved full SHA.
Build the Reader with
`VITE_CONTENT_FALLBACK_READER_BASE_PATH=/api/content-fallback`; this is a
build-time same-origin relative path. Keep the service disabled until a separate
pilot authorization:

```ini
CONTENT_FALLBACK_READER_ENABLED=false
CONTENT_FALLBACK_POLICIES_JSON={"enabled":false,"domains":{},"feeds":{}}
```

Do not pass `services/content_fallback/config.example.json` unchanged to a live
service: it lists publisher-specific `ON_DEMAND` policies that remain dormant
only while the global switch is false. A later pilot must explicitly authorize
one eligible public source and one user action. No background recovery or
publisher-wide policy is part of this package.

The CI image IDs are ephemeral runner artifacts, not deployable registry
references. Before a target change, publish only through the approved release
process and pin both images as `repository@sha256:<digest>`, with
`org.opencontainers.image.revision` equal to the approved source SHA. Never
promote a mutable tag or the Actions synthetic merge SHA as the source identity.

## Controlled promotion and exact rollback plan

Promotion is not authorized by this PR. After a separate approval and a passing
target preflight:

1. Save exact copies and SHA-256 hashes of every active Compose file and the
   active Caddyfile. Record current Reader/sidecar image IDs, network
   attachments, port bindings, health, volume identity, and sanitized feature
   state. Keep secret values out of the receipt.
2. Take an SQLite online backup of the Content Fallback volume and verify the
   backup opens. Keep the original volume attached during rollback; do not
   restore Miniflux because recovery is read-only.
3. Validate both digest-pinned images and the Caddy fragment in the isolated
   network before any runtime switch. The target route must reject direct
   requests, wrong methods, wrong Origin, an untrusted proxy peer, and spoofed
   forwarding headers.
4. Start with both feature settings above disabled. Confirm health, private
   reachability, no published sidecar port, and no Miniflux writes. Enabling the
   Reader Bridge and one `ON_DEMAND` policy requires a separate authorization.
5. For rollback, first remove the Reader Bridge import/route and disable the
   feature/policy, then restore the exact backed-up Compose/Caddyfile and prior
   Reader image digest. Keep the SQLite volume untouched and verify the prior
   Reader health and route. NPM and Miniflux are not recreated or reconfigured.

This sequence cannot be executed safely until the active image IDs, Compose
files, Caddyfile and networks are readable and the sidecar's Miniflux identity
is confirmed. No route was applied to OMV in this task.

## Isolated test

`python3 scripts/content-fallback-reader-caddy-gate.py` runs pinned Caddy,
Nginx, and Python images on a temporary internal Docker network. It verifies
the path rewrite, allowed headers, header overwrite/removal, method/path
rejection, rejection of an untrusted direct peer, and absence of published
ports. Its backend is synthetic and records no credentials. This complements
the exact-SHA Reader/HTTPS harness; it does not validate the active NPM or
OMV network.
