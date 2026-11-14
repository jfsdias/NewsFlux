#!/usr/bin/env bash
# Disposable CI-only topology smoke test: no real services or host ports.
set -Eeuo pipefail
project="newsflux-wallhop-ci-${GITHUB_RUN_ID:-$$}-${RANDOM}"
file="$(cd "$(dirname "$0")" && pwd)/compose.rehearsal.json"
compose=(docker compose -p "$project" -f "$file")
cleanup() { "${compose[@]}" down --remove-orphans >/dev/null; }
trap cleanup EXIT
[[ "$project" == newsflux-wallhop-ci-* ]] || exit 1
"${compose[@]}" pull -q
"${compose[@]}" up -d --no-build
for service in reader sidecar miniflux; do
  id=$("${compose[@]}" ps -q "$service")
  [[ -n "$id" && "$(docker inspect --format '{{len .HostConfig.PortBindings}}' "$id")" == 0 ]]
done
for name in reader_net miniflux_net; do
  [[ "$(docker network inspect --format '{{.Internal}}' "${project}_${name}")" == true ]]
done
# Retry readiness only; the tests themselves are executed once.
ready=0
for _ in $(seq 1 30); do
  if "${compose[@]}" exec -T reader python -c "import urllib.request; urllib.request.urlopen('http://sidecar:8000', timeout=1).read()" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
"${compose[@]}" exec -T sidecar python -c "import urllib.request; urllib.request.urlopen('http://miniflux:8000', timeout=2).read()" >/dev/null
"${compose[@]}" exec -T reader python -c "import socket; exec('try:\\n socket.getaddrinfo(\"miniflux\", 8000)\\nexcept socket.gaierror:\\n pass\\nelse:\\n raise SystemExit(1)')"
"${compose[@]}" exec -T sidecar python -c "import socket; s=socket.socket(); s.settimeout(1); result=s.connect_ex(('203.0.113.1',443)); s.close(); assert result != 0"
printf 'ISOLATED_SYNTHETIC_NETWORK_REHEARSAL=PASS\n'
