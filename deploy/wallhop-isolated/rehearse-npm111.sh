#!/usr/bin/env bash
# CI-only destructive rehearsal on a disposable GitHub runner. Never run on OMV.
set -Eeuo pipefail

fail() { echo "NPM111_DISPOSABLE_GATE=FAIL CODE=$1" >&2; exit 2; }
[[ "${GITHUB_ACTIONS:-}" == true && "${CI:-}" == true ]] || fail CI_ONLY
docker info >/dev/null 2>&1 || fail DOCKER_UNAVAILABLE

NET=npm-proxyyml_default
LEGACY=newsflux-pr188-content-fallback
READER=newsflux-wallhop-recovery
RELAY=newsflux-wallhop-egress
COMPOSE=deploy/wallhop-isolated/compose.yaml
VOL=pr188-synthetic-"$GITHUB_RUN_ID"
net_created=0
volume_created=0
for name in "$LEGACY" npm "$READER" "$RELAY"; do
  if docker container inspect "$name" >/dev/null 2>&1; then fail EXISTING_CONTAINER; fi
done
for name in "$NET" newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated; do
  if docker network inspect "$name" >/dev/null 2>&1; then fail EXISTING_NETWORK; fi
done
if docker volume inspect "$VOL" >/dev/null 2>&1; then fail EXISTING_VOLUME; fi

finish() {
  local initial="$1" failures=0
  trap - EXIT
  set +e
  docker compose -f "$COMPOSE" down --remove-orphans >/dev/null 2>&1
  [[ $? -eq 0 ]] || failures=$((failures+1))
  for name in npm "$LEGACY"; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      docker rm -f "$name" >/dev/null 2>&1
      [[ $? -eq 0 ]] || failures=$((failures+1))
    fi
  done
  if (( volume_created )); then
    docker volume rm "$VOL" >/dev/null 2>&1
    [[ $? -eq 0 ]] || failures=$((failures+1))
  fi
  if (( net_created )); then
    docker network rm "$NET" >/dev/null 2>&1
    [[ $? -eq 0 ]] || failures=$((failures+1))
  fi
  if (( failures )); then echo "DISPOSABLE_CLEANUP=PARTIAL"; exit 3; fi
  echo "DISPOSABLE_CLEANUP=PASS"
  exit "$initial"
}
trap 'finish $?' EXIT

docker network create "$NET" >/dev/null
net_created=1
docker volume create "$VOL" >/dev/null
volume_created=1
BASE=python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704
docker pull -q "$BASE" >/dev/null

legacy_py=$(cat <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        b = b"LEGACY_OK"
        self.send_response(200)
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def log_message(self, *_): pass
HTTPServer(("0.0.0.0", 8790), Handler).serve_forever()
PY
)
docker run -d --name "$LEGACY" --network "$NET" -v "$VOL:/data:rw" \
  --restart no "$BASE" python -u -c "$legacy_py" >/dev/null
npm_py=$(cat <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from http.client import HTTPConnection
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        c = HTTPConnection("newsflux-pr188-content-fallback", 8790, timeout=2)
        try:
            c.request("GET", "/")
            r = c.getresponse()
            b = r.read()
            self.send_response(r.status)
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
        finally: c.close()
    def log_message(self, *_): pass
HTTPServer(("0.0.0.0", 8111), Handler).serve_forever()
PY
)
docker run -d --name npm --network "$NET" --restart no "$BASE" python -u -c "$npm_py" >/dev/null
probe() {
  local i
  for i in {1..15}; do
    if docker exec npm python -c 'import urllib.request; assert urllib.request.urlopen("http://127.0.0.1:8111", timeout=2).read() == b"LEGACY_OK"' >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}
probe || fail LEGACY_BEFORE
protected() {
  docker inspect -f '{{.Id}}|{{.Image}}|{{json .NetworkSettings.Networks}}|{{json .Mounts}}' \
    "$LEGACY" npm | sha256sum | cut -c1-64
}
before="$(protected)"
docker exec "$LEGACY" python -c 'from pathlib import Path; Path("/data/marker").write_text("KEEP")'
echo "SYNTHETIC_HOST111_BEFORE=PASS"

docker build -q -f services/content_fallback/Dockerfile \
  -t "wallhop-ci:${GITHUB_RUN_ID}" . >/dev/null
docker pull -q haproxy:3.0.5-alpine >/dev/null
export WALLHOP_SIDECAR_IMAGE="$(docker image inspect -f '{{.Id}}' "wallhop-ci:${GITHUB_RUN_ID}")"
export WALLHOP_EGRESS_IMAGE="$(docker image inspect -f '{{.Id}}' haproxy:3.0.5-alpine)"
export WALLHOP_MINIFLUX_PUBLIC_HOST=miniflux.example.test
export WALLHOP_MINIFLUX_PUBLIC_URL=https://miniflux.example.test
export WALLHOP_MINIFLUX_API_TOKEN=synthetic-test-token-not-real
export WALLHOP_RECOVERY_API_TOKEN=synthetic-service-token-not-real-0123456789
export WALLHOP_HAPROXY_CONFIG="$PWD/deploy/wallhop-isolated/haproxy.cfg"
docker compose -f "$COMPOSE" config --format json |
  python deploy/wallhop-isolated/topology_guard.py

docker compose -f "$COMPOSE" up -d --no-build --pull never >/dev/null
healthy=0
for i in {1..30}; do
  h="$(docker inspect -f '{{.State.Health.Status}}' "$READER" 2>/dev/null)" || fail CANDIDATE_MISSING
  if [[ "$h" == healthy ]]; then healthy=1; break; fi
  [[ "$h" != unhealthy ]] || fail CANDIDATE_UNHEALTHY
  sleep 2
done
((healthy)) || fail CANDIDATE_TIMEOUT

docker inspect "$READER" "$RELAY" | python -c '
import json,sys
a,b=json.load(sys.stdin)
assert set(a["NetworkSettings"]["Networks"]) == {"newsflux_wallhop_reader_isolated","newsflux_wallhop_egress_isolated"}
assert set(b["NetworkSettings"]["Networks"]) == {"newsflux_wallhop_egress_isolated","npm-proxyyml_default"}
assert a["HostConfig"]["ReadonlyRootfs"] and b["HostConfig"]["ReadonlyRootfs"]
assert not a["HostConfig"]["PortBindings"] and not b["HostConfig"]["PortBindings"]
assert all(m["Type"] != "volume" for m in a["Mounts"])
assert any(m["Destination"] == "/data" for m in a["Mounts"])
' || fail CANDIDATE_RUNTIME_NETWORK_OR_VOLUME

docker exec "$READER" python -c '
import socket
for h,p in (("npm",8111),("newsflux-pr188-content-fallback",8790),("1.1.1.1",443)):
    try: s=socket.create_connection((h,p),timeout=2)
    except OSError: pass
    else:
        s.close()
        raise SystemExit("FORBIDDEN_DIRECT_ROUTE")
socket.create_connection(("wallhop-egress",443),timeout=3).close()
' >/dev/null || fail PRIVATE_EGRESS_BOUNDARY

docker exec "$READER" python -c '
import socket,ssl
s=socket.create_connection(("wallhop-egress",443),timeout=3)
s.settimeout(7)
try: ssl.create_default_context().wrap_socket(s,server_hostname="unapproved.example.test")
except (ssl.SSLError,OSError,TimeoutError): pass
else: raise SystemExit("UNAPPROVED_SNI")
' >/dev/null || fail RELAY_SNI_REJECTION

probe || fail LEGACY_DURING
[[ "$(protected)" == "$before" ]] || fail LEGACY_IDENTITY_CHANGED_DURING
echo "SYNTHETIC_HOST111_DURING=PASS"

docker stop "$RELAY" >/dev/null
probe || fail LEGACY_ON_RELAY_FAILURE
[[ "$(protected)" == "$before" ]] || fail LEGACY_IDENTITY_CHANGED_ON_FAILURE
echo "SYNTHETIC_HOST111_FAILURE=PASS"

docker compose -f "$COMPOSE" down --remove-orphans >/dev/null
probe || fail LEGACY_AFTER_ROLLBACK
[[ "$(protected)" == "$before" ]] || fail LEGACY_IDENTITY_CHANGED_AFTER_ROLLBACK
docker exec "$LEGACY" python -c 'from pathlib import Path; assert Path("/data/marker").read_text() == "KEEP"' || fail LEGACY_STORAGE_CHANGED
for n in "$READER" "$RELAY"; do
  if docker container inspect "$n" >/dev/null 2>&1; then fail CANDIDATE_NOT_REMOVED; fi
done
for n in newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated; do
  if docker network inspect "$n" >/dev/null 2>&1; then fail CANDIDATE_NETWORK_NOT_REMOVED; fi
done
echo "SYNTHETIC_HOST111_AFTER_ROLLBACK=PASS"
echo "WALLHOP_REAL_DOCKER_DISPOSABLE_GATE=PASS"
echo "REAL_OMV_VALIDATION=NOT_RUN"
echo "WALLHOP_REAL_PROVIDER_REQUESTS=ZERO"
