#!/usr/bin/env bash
# Disposable WallHop-B isolation rehearsal with the REAL sidecar image and the REAL relay config.
# Synthetic "wallhop.io" and "NPM/Miniflux" TLS endpoints use a throwaway CA trusted only by the
# rehearsal sidecar. No real WallHop, publisher, Miniflux or production host is contacted.
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
run="nfw$RANDOM"
work="$(mktemp -d /tmp/nfw.XXXXXX)"
HAPROXY_IMAGE="${HAPROXY_IMAGE:-haproxy:3.0.5-alpine}"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10.2-alpine}"
pass=0; fail=0
ok() { echo "TOPOLOGY_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "TOPOLOGY_GATE $1=FAIL"; fail=$((fail + 1)); }
check() { local name=$1; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else ko "$name"; fi; }
cleanup() {
  [[ -n "${KEEP:-}" ]] && { echo "KEPT run=$run work=$work"; return; }
  docker rm -f "$run-sidecar" "$run-relay" "$run-relay-bad" "$run-wallhop" "$run-npm" >/dev/null 2>&1 || true
  docker network rm "$run-reader" "$run-egress" "$run-npm" >/dev/null 2>&1 || true
  docker image rm -f "$run-sidecar:test" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Throwaway CA and leaf certificates.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$run-ca" -keyout "$work/ca.key" -out "$work/ca.crt" 2>/dev/null
leaf() {
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout "$work/$1.key" -out "$work/$1.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$1" >"$work/$1.ext"
  openssl x509 -req -in "$work/$1.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial -days 1 -extfile "$work/$1.ext" -out "$work/$1.crt" 2>/dev/null
}
leaf wallhop.io; leaf miniflux.rehearsal.test
chmod 755 "$work"; chmod 644 "$work"/*.crt "$work"/*.key

docker build -q -f "$repo/services/content_fallback/Dockerfile" -t "$run-sidecar:test" "$repo" >/dev/null
docker network create --internal "$run-reader" >/dev/null
docker network create --internal "$run-egress" >/dev/null
docker network create "$run-npm" >/dev/null

cat >"$work/wallhop.Caddyfile" <<'C'
https://wallhop.io:443 {
	tls /certs/wallhop.io.crt /certs/wallhop.io.key
	respond "<html><body><article><p>SYNTHETIC_WALLHOP_BODY</p></article></body></html>" 200
}
C
cat >"$work/npm.Caddyfile" <<'C'
https://miniflux.rehearsal.test:443 {
	tls /certs/miniflux.rehearsal.test.crt /certs/miniflux.rehearsal.test.key
	header Content-Type application/json
	respond /v1/me `{"id":7,"username":"synthetic","is_admin":false}` 200
	respond 404
}
C
docker run -d --name "$run-wallhop" --network "$run-npm" --network-alias wallhop-origin \
  -v "$work:/certs:ro" -v "$work/wallhop.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
docker run -d --name "$run-npm" --network "$run-npm" --network-alias npm \
  -v "$work:/certs:ro" -v "$work/npm.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null

relay() { # name wallhop_upstream
  docker run -d --name "$1" --network "$run-egress" --network-alias "${1#"$run"-}" \
    --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 99:99 \
    --sysctl net.ipv4.ip_unprivileged_port_start=443 \
    -e MINIFLUX_PUBLIC_HOST=miniflux.rehearsal.test -e MINIFLUX_UPSTREAM=npm:443 -e WALLHOP_UPSTREAM="$2" \
    -v "$here/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro" "$HAPROXY_IMAGE" >/dev/null
  docker network connect "$run-npm" "$1"
}
relay "$run-relay" wallhop-origin:443
# Simulated DNS hijack: the allowlisted name now leads to a service with a different certificate.
relay "$run-relay-bad" npm:443

docker run -d --name "$run-sidecar" --network "$run-reader" \
  -e MINIFLUX_BASE_URL=https://miniflux.rehearsal.test -e MINIFLUX_API_TOKEN=synthetic-token \
  -e CONTENT_FALLBACK_API_TOKEN="$(head -c 24 /dev/urandom | base64)" \
  -e CONTENT_FALLBACK_HOST=0.0.0.0 -e CONTENT_FALLBACK_EGRESS_RELAY=relay \
  -e CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY=true \
  -e CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS=wallhop.io,miniflux.rehearsal.test \
  -e SSL_CERT_FILE=/certs/ca.crt -v "$work:/certs:ro" "$run-sidecar:test" >/dev/null
docker network connect "$run-egress" "$run-sidecar"
for _ in $(seq 1 30); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$run-sidecar")" == healthy ]] && break; sleep 1; done
check SIDECAR_HEALTHY test "$(docker inspect -f '{{.State.Health.Status}}' "$run-sidecar")" = healthy

py() { docker exec -e RELAY="$1" "$run-sidecar" python -c "$2"; }
PRE='
import os, socket, ssl
from services.content_fallback.server import build_egress_http
from services.content_fallback.http_client import UnsafeURL, FetchError
http = build_egress_http({"CONTENT_FALLBACK_EGRESS_RELAY": os.environ["RELAY"], "CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS": "wallhop.io,miniflux.rehearsal.test"})
'
check WALLHOP_VIA_RELAY_TLS_VALIDATED py relay "$PRE
r = http.get('https://wallhop.io/raw/https://publisher.example/a')
assert r.status == 200 and b'SYNTHETIC_WALLHOP_BODY' in r.body"
check MINIFLUX_VIA_RELAY_NO_MINIFLUX_CHANGE py relay "$PRE
r = http.get('https://miniflux.rehearsal.test/v1/me', same_origin='https://miniflux.rehearsal.test', allow_private_origin=True)
assert r.status == 200 and b'synthetic' in r.body"
check APP_ALLOWLIST_BLOCKS_OTHER_HOSTS py relay "$PRE
for url in ('https://example.com/', 'https://93.184.216.34/', 'https://wallhop.io:8443/', 'http://wallhop.io/'):
    try:
        http.get(url)
    except UnsafeURL:
        continue
    raise SystemExit(url)"
check NO_DIRECT_EGRESS_ROUTE py relay "
import socket
for host, port in (('wallhop-origin', 443), ('npm', 443), ('1.1.1.1', 443), ('8.8.8.8', 53), ('$run-npm', 443)):
    try:
        socket.create_connection((host, port), timeout=3).close()
    except OSError:
        continue
    raise SystemExit(f'reachable {host}:{port}')"
check RELAY_REJECTS_UNLISTED_SNI py relay "
import socket, ssl
ctx = ssl.create_default_context()
for sni in ('evil.example', 'localhost'):
    try:
        with socket.create_connection(('relay', 443), timeout=5) as s:
            ctx.wrap_socket(s, server_hostname=sni).close()
    except (OSError, ssl.SSLError):
        continue
    raise SystemExit(sni)
ctx2 = ssl.create_default_context(); ctx2.check_hostname = False; ctx2.verify_mode = ssl.CERT_NONE
try:
    with socket.create_connection(('relay', 443), timeout=5) as s:
        ctx2.wrap_socket(s).close()
    raise SystemExit('no-SNI accepted')
except (OSError, ssl.SSLError):
    pass"
check DNS_HIJACK_DEFEATED_BY_TLS py relay-bad "$PRE
try:
    http.get('https://wallhop.io/raw/x')
except FetchError:
    raise SystemExit(0)
raise SystemExit('hijacked upstream accepted')"
check NO_PUBLISHED_PORTS test "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$run-sidecar")$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$run-relay")" = "00"
check SIDECAR_ONLY_INTERNAL_NETWORKS test "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$run-sidecar" | tr ' ' '\n' | grep -c .)" = 2
check SIDECAR_NO_IPV6 py relay "
import socket
addrs = [a for a in socket.getaddrinfo(socket.gethostname(), None) if a[0] == socket.AF_INET6]
assert not [a for a in addrs if not a[4][0].startswith(('fe80', '::1'))], addrs
try:
    socket.create_connection(('2606:4700:4700::1111', 443), timeout=3).close()
    raise SystemExit('IPv6 egress reachable')
except OSError:
    pass"
check RELAY_HARDENED test "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.Config.User}} {{.HostConfig.CapDrop}}' "$run-relay")" = "true 99:99 [ALL]"
check FAIL_CLOSED_WITHOUT_RELAY docker exec "$run-sidecar" python -c "
from services.content_fallback.server import build_egress_http
try:
    build_egress_http({'CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY': 'true'})
except ValueError:
    raise SystemExit(0)
raise SystemExit(1)"
echo "TOPOLOGY_PASSED=$pass TOPOLOGY_FAILED=$fail"
[[ "$fail" -eq 0 ]]
