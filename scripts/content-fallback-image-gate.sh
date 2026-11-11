#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"
expected_sha="${2:-}"

if [[ "$mode" != "baseline" && "$mode" != "candidate" ]]; then
  printf '%s\n' 'IMAGE_GATE_MODE=INVALID' >&2
  exit 2
fi

actual_sha="$(git rev-parse HEAD)"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  printf '%s\n' 'SOURCE_SHA_GATE=FAIL' >&2
  exit 1
fi

image_tag="newsflux-content-fallback:${mode}-${actual_sha:0:12}"
docker build --file services/content_fallback/Dockerfile --tag "$image_tag" . >/dev/null
printf 'DOCKER_BUILD_%s=PASS\n' "${mode^^}"

if [[ "$mode" == "baseline" ]]; then
  if ! docker run --rm --entrypoint python "$image_tag" -c 'import services.content_fallback.server'; then
    printf '%s\n' 'BASELINE_IMAGE_IMPORT=FAIL' >&2
    exit 1
  fi
  printf '%s\n' 'BASELINE_IMAGE_IMPORT=PASS'

  fixture_dockerfile="${CONTENT_FALLBACK_MISSING_DEPENDENCY_DOCKERFILE:-scripts/tests/fixtures/content_fallback_image_gate_missing_auth.Dockerfile}"
  if [[ ! -f "$fixture_dockerfile" ]]; then
    printf '%s\n' 'MISSING_DEPENDENCY_FIXTURE=NOT_FOUND' >&2
    exit 1
  fi

  fixture_tag="newsflux-content-fallback:missing-auth-fixture-${actual_sha:0:12}"
  docker build \
    --file "$fixture_dockerfile" \
    --build-arg "BASE_IMAGE=$image_tag" \
    --tag "$fixture_tag" \
    . >/dev/null
  printf '%s\n' 'MISSING_DEPENDENCY_FIXTURE_BUILD=PASS'

  set +e
  import_output="$(docker run --rm --entrypoint python "$fixture_tag" -c 'import services.content_fallback.server' 2>&1)"
  import_status=$?
  set -e
  if [[ "$import_status" -eq 0 ]] || ! grep -Fq "No module named 'services.article_intel_auth'" <<<"$import_output"; then
    printf '%s\n' 'MISSING_DEPENDENCY_FIXTURE_IMPORT_RED=NOT_REPRODUCED' >&2
    exit 1
  fi
  printf '%s\n' 'MISSING_DEPENDENCY_FIXTURE_IMPORT_RED=PASS'
  exit 0
fi

docker run --rm --entrypoint python "$image_tag" -c 'import services.content_fallback.server; print("PYTHON_IMPORT=PASS")'

configured_user="$(docker image inspect --format '{{.Config.User}}' "$image_tag")"
if [[ "$configured_user" != "10001:10001" ]]; then
  printf '%s\n' 'NON_ROOT_GATE=FAIL' >&2
  exit 1
fi
printf '%s\n' 'NON_ROOT_GATE=PASS'

healthcheck="$(docker image inspect --format '{{json .Config.Healthcheck.Test}}' "$image_tag")"
if [[ "$healthcheck" == "null" || "$healthcheck" == "[]" ]]; then
  printf '%s\n' 'HEALTHCHECK_CONFIG_GATE=FAIL' >&2
  exit 1
fi

container_name="content-fallback-p0-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1
}
trap cleanup EXIT

docker run --detach \
  --name "$container_name" \
  --network none \
  --env MINIFLUX_BASE_URL=http://127.0.0.1:9 \
  --env MINIFLUX_API_TOKEN=synthetic-miniflux-token \
  --env CONTENT_FALLBACK_API_TOKEN=synthetic-content-fallback-token-0123456789 \
  --env CONTENT_FALLBACK_DB_PATH=/tmp/content-fallback-p0.sqlite3 \
  --env CONTENT_FALLBACK_POLICIES_JSON='{}' \
  "$image_tag" >/dev/null

python3 - "$container_name" <<'PY'
import json
import subprocess
import sys

name = sys.argv[1]
raw = subprocess.check_output(
    ["docker", "inspect", "--format", "{{json .HostConfig.PortBindings}}", name],
    text=True,
).strip()
bindings = json.loads(raw)
if bindings and any(value for value in bindings.values()):
    raise SystemExit("NO_PUBLIC_PORTS_GATE=FAIL")
print("NO_PUBLIC_PORTS_GATE=PASS")
PY

docker exec "$container_name" python -c '
import os
from services.content_fallback.server import Settings

settings = Settings.from_env()
assert not settings.policies.enabled
assert settings.reader_bridge is None
print("NO_RUNTIME_FEATURE_ACTIVATION=PASS")
'

for attempt in $(seq 1 20); do
  health_status="$(docker inspect --format '{{.State.Health.Status}}' "$container_name")"
  if [[ "$health_status" == "healthy" ]]; then
    break
  fi
  if [[ "$health_status" == "unhealthy" ]]; then
    printf '%s\n' 'HEALTHCHECK=FAIL' >&2
    exit 1
  fi
  sleep 1
done

if [[ "$health_status" != "healthy" ]]; then
  printf '%s\n' 'HEALTHCHECK=FAIL' >&2
  exit 1
fi

docker exec "$container_name" python -c '
import json
from urllib.request import urlopen

with urlopen("http://127.0.0.1:8790/healthz", timeout=2) as response:
    payload = json.load(response)
assert response.status == 200
assert payload.get("status") == "ok"
assert payload.get("thirteen_ft_enabled") is False
print("HEALTHCHECK=PASS")
'
