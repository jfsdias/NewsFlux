#!/usr/bin/env bash
set -euo pipefail
image='python:3.12-slim@sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704'
volume="newsflux-ownership-${GITHUB_RUN_ID:-local}-$$"
holder="${volume}-holder"
cleanup() {
  docker rm -f "$holder" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run --rm --mount "type=volume,src=$volume,dst=/data" "$image" chmod 700 /data
common=(--mount "type=volume,src=$volume,dst=/data" --mount "type=bind,src=$PWD,dst=/app,readonly" -w /app "$image" python /app/services/article_intel_summary/tests/ownership_container_probe.py)
docker run -d --name "$holder" "${common[@]}" holder >/dev/null
ready=0
for _ in {1..50}; do
  if docker logs "$holder" 2>&1 | grep -qx READY; then ready=1; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$holder")" != true ]; then docker logs "$holder"; exit 1; fi
  sleep 0.1
done
test "$ready" = 1
test "$(docker run --rm "${common[@]}" contender)" = BLOCKED
docker kill "$holder" >/dev/null
test "$(docker run --rm "${common[@]}" successor)" = RECOVERED_UNCERTAIN
echo OWNERSHIP_CONTAINER_GATE=PASS
