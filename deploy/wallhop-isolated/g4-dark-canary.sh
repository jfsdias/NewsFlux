#!/usr/bin/env bash
# NewsFlux G4: supervised, temporary, dark WallHop canary on the OMV.
# Only NEW project resources may be started/stopped; NPM111/PR188/Reader are immutable.
set -Eeuo pipefail

G4_SOURCE_SHA=f2984fcc06d858d3a68bd263371c9e7f4d8775c1
G4_EXPECTED_FINGERPRINT=3adeb9e111a2e108

if [[ "$#" -eq 0 ]]; then
  echo "G4_MODE=SAFE_NOOP"
  exit 0
fi
if [[ "$#" -ne 1 ]]; then
  echo "G4_ADMISSION=BLOCKED CODE=ARGUMENT_SCOPE"
  exit 2
fi
if [[ "$1" == "--help" ]]; then
  echo "G4_MODE=HELP"
  echo "Usage: sudo env NEWSFLUX_G4_ACK=ISOLATED_DARK_ONLY bash g4-dark-canary.sh --execute"
  echo "This runs a dark synthetic canary then removes only release-owned containers/networks."
  exit 0
fi
if [[ "$1" != "--execute" ]]; then
  echo "G4_ADMISSION=BLOCKED CODE=INVALID_MODE"
  exit 2
fi
if [[ "${NEWSFLUX_G4_ACK:-}" != "ISOLATED_DARK_ONLY" ]]; then
  echo "G4_ADMISSION=BLOCKED CODE=EXPLICIT_ACK_REQUIRED"
  exit 2
fi

# The caller must be the operator at the Home Server; never invoke from CI.
if [[ "${GITHUB_ACTIONS:-false}" == "true" || "$EUID" != 0 ]]; then
  echo "G4_ADMISSION=BLOCKED CODE=OMV_ROOT_ONLY"
  exit 2
fi

for command in docker git python3 tar mktemp sha256sum awk flock; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "G4_ADMISSION=BLOCKED CODE=DEPENDENCY_MISSING"
    exit 2
  fi
done

REPO="${NEWSFLUX_G4_REPO:-/dockerdata/compose/newsflux/repo}"
docker info >/dev/null 2>&1 || { echo "G4_ADMISSION=BLOCKED CODE=DOCKER_UNAVAILABLE"; exit 2; }
docker compose version >/dev/null 2>&1 || { echo "G4_ADMISSION=BLOCKED CODE=COMPOSE_UNAVAILABLE"; exit 2; }
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || { echo "G4_ADMISSION=BLOCKED CODE=REPO_MISSING"; exit 2; }

# Lock release-owned operations. Never delete or stop any preexisting candidate.
exec 9>/run/lock/newsflux-wallhop-g4-dark.lock
flock -n 9 || { echo "G4_ADMISSION=BLOCKED CODE=CONCURRENT_RUN"; exit 2; }

PROJECT=newsflux-wallhop-isolated
NEW_RECOVERY=newsflux-wallhop-recovery
NEW_RELAY=newsflux-wallhop-egress
LEGACY=newsflux-pr188-content-fallback
STAGE=""
COMPOSE=""
START_ARMED=0
BASE_FINGERPRINT=""
BASE_NPM111_SHA=""
FINISHED=0

fingerprint_protected() {
  docker inspect npm "$LEGACY" newsflux | python3 -c '
import hashlib, json, sys
items = json.load(sys.stdin)
required = {"npm", "newsflux-pr188-content-fallback", "newsflux"}
by_name = {x["Name"].lstrip("/"): x for x in items}
if set(by_name) != required:
    sys.exit(2)
snapshot = {}
for n in required:
    x = by_name[n]
    snapshot[n] = {
        "id": x["Id"],
        "image": x["Image"],
        "networks": sorted(x["NetworkSettings"]["Networks"]),
        "mounts": sorted(
            (m.get("Type"), m.get("Name"), m.get("Destination"), m.get("RW"))
            for m in x.get("Mounts", [])
        ),
    }
print(hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:16])
'
}

npm111_sha() {
  # Hash only. Do not emit the config body, URLs, IP addresses or credentials.
  docker exec npm sha256sum /data/nginx/proxy_host/111.conf | awk '{print $1}'
}

candidate_absent() {
  for name in "$NEW_RECOVERY" "$NEW_RELAY"; do
    if docker container inspect "$name" >/dev/null 2>&1; then return 1; fi
  done
  for name in newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated; do
    if docker network inspect "$name" >/dev/null 2>&1; then return 1; fi
  done
  if [[ -n "$(docker ps -aq --filter label=com.docker.compose.project="$PROJECT")" ]]; then
    return 1
  fi
  return 0
}

cleanup() {
  local original="$1" cleanup_failed=0 current=""
  if (( FINISHED )); then return; fi
  FINISHED=1
  trap - EXIT
  set +e
  if (( START_ARMED )) && [[ -n "$COMPOSE" ]]; then
    docker compose -f "$COMPOSE" down --remove-orphans >/dev/null 2>&1
    [[ "$?" -eq 0 ]] || cleanup_failed=1
    candidate_absent || cleanup_failed=1
  fi
  if [[ -n "$BASE_FINGERPRINT" ]]; then
    current="$(fingerprint_protected 2>/dev/null)"
    if [[ "$current" == "$BASE_FINGERPRINT" ]]; then
      echo "G4_PROTECTED_POSTSTATE=PASS"
    else
      echo "G4_PROTECTED_POSTSTATE=DRIFT_OR_UNVERIFIED"
      cleanup_failed=1
    fi
  fi
  if [[ -n "$BASE_NPM111_SHA" ]]; then
    current="$(npm111_sha 2>/dev/null)"
    if [[ "$current" == "$BASE_NPM111_SHA" ]]; then
      echo "G4_NPM111_CONFIG_POSTSTATE=PASS"
    else
      echo "G4_NPM111_CONFIG_POSTSTATE=DRIFT_OR_UNVERIFIED"
      cleanup_failed=1
    fi
  fi
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then
    rm -rf -- "$STAGE"
    [[ "$?" -eq 0 ]] || cleanup_failed=1
  fi
  if (( cleanup_failed )); then
    echo "G4_ROLLBACK=PARTIAL_FAIL_CLOSED"
    exit 3
  fi
  if (( START_ARMED )); then echo "G4_ROLLBACK=PASS"; fi
  exit "$original"
}
trap 'cleanup $?' EXIT

echo "=== NEWSFLUX G4 DARK — EXACT-SHA OPERATOR CANARY ==="
echo "G4_SOURCE_SHA=$G4_SOURCE_SHA"

# Validate operator G3 fingerprint again immediately before any network work.
BASE_FINGERPRINT="$(fingerprint_protected)" || { echo "G4_GATE=BLOCKED CODE=PROTECTED_INSPECT"; exit 2; }
if [[ "$BASE_FINGERPRINT" != "$G4_EXPECTED_FINGERPRINT" ]]; then
  echo "G4_GATE=BLOCKED CODE=G3_FINGERPRINT_DRIFT"
  exit 2
fi
echo "G4_G3_FINGERPRINT=PASS"

BASE_NPM111_SHA="$(npm111_sha)" || { echo "G4_GATE=BLOCKED CODE=NPM111_READ"; exit 2; }
[[ "$BASE_NPM111_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "G4_GATE=BLOCKED CODE=NPM111_HASH"; exit 2; }

if ! candidate_absent; then
  echo "G4_GATE=BLOCKED CODE=EXISTING_CANDIDATE_OR_NETWORK"
  exit 2
fi
echo "G4_COLLISIONS=NONE"
# Require at least 10 GiB available. Do not make new persistent state.
python3 - "$REPO" <<'PY'
import shutil,sys
if shutil.disk_usage(sys.argv[1]).free < 10 * 1024**3:
    print("G4_GATE=BLOCKED CODE=DISK_HEADROOM")
    sys.exit(2)
print("G4_DISK_HEADROOM=PASS")
PY

# The source SHA is a compile-time constant: never use implicit latest.
REMOTE="$(git -C "$REPO" ls-remote origin refs/heads/main | awk '{print $1}')"
[[ "$REMOTE" == "$G4_SOURCE_SHA" ]] || { echo "G4_GATE=BLOCKED CODE=REMOTE_MAIN_DRIFT"; exit 2; }
git -C "$REPO" fetch --no-tags --quiet origin refs/heads/main
FETCHED="$(git -C "$REPO" rev-parse FETCH_HEAD)"
[[ "$FETCHED" == "$G4_SOURCE_SHA" ]] || { echo "G4_GATE=BLOCKED CODE=FETCH_DRIFT"; exit 2; }
echo "G4_EXACT_SOURCE=PASS"

STAGE="$(mktemp -d /tmp/newsflux-g4-dark.XXXXXXXX)" || exit 2
git -C "$REPO" archive "$G4_SOURCE_SHA" | tar -x -C "$STAGE"
COMPOSE="$STAGE/deploy/wallhop-isolated/compose.yaml"
[[ -f "$COMPOSE" && -f "$STAGE/deploy/wallhop-isolated/topology_guard.py" ]] || {
  echo "G4_GATE=BLOCKED CODE=EXACT_SOURCE_FILES"
  exit 2
}

# Verify NPM111 on-disk and expanded Nginx config using the merged read-only tool.
python3 "$STAGE/deploy/npm111-g2c/audit.py" || {
  echo "G4_GATE=BLOCKED CODE=NPM111_STATIC_G2C"
  exit 2
}

# Build new image from *exact source*; inspect and pass only immutable local IDs.
docker build -q --pull -f "$STAGE/services/content_fallback/Dockerfile" \
  -t "newsflux-wallhop-g4:$G4_SOURCE_SHA" "$STAGE" >/dev/null || {
  echo "G4_GATE=BLOCKED CODE=SIDECAR_BUILD"
  exit 2
}
docker pull -q haproxy:3.0.5-alpine >/dev/null || {
  echo "G4_GATE=BLOCKED CODE=RELAY_IMAGE"
  exit 2
}
export WALLHOP_SIDECAR_IMAGE WALLHOP_EGRESS_IMAGE
WALLHOP_SIDECAR_IMAGE="$(docker image inspect -f '{{.Id}}' "newsflux-wallhop-g4:$G4_SOURCE_SHA")"
WALLHOP_EGRESS_IMAGE="$(docker image inspect -f '{{.Id}}' haproxy:3.0.5-alpine)"
[[ "$WALLHOP_SIDECAR_IMAGE" =~ ^sha256:[a-f0-9]{64}$ && "$WALLHOP_EGRESS_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || {
  echo "G4_GATE=BLOCKED CODE=IMAGE_ID_NOT_IMMUTABLE"
  exit 2
}
echo "G4_IMAGE_IDS=LOCAL_SHA256_VERIFIED"

# Dummy credentials and a non-resolving .test host: no live Miniflux tokens.
export WALLHOP_MINIFLUX_PUBLIC_HOST=miniflux.example.test
export WALLHOP_MINIFLUX_PUBLIC_URL=https://miniflux.example.test
export WALLHOP_MINIFLUX_API_TOKEN=synthetic-only-not-real-account
export WALLHOP_RECOVERY_API_TOKEN=synthetic-only-not-real-service-token-1234567890
export WALLHOP_HAPROXY_CONFIG="$STAGE/deploy/wallhop-isolated/haproxy.cfg"

docker compose -f "$COMPOSE" config --format json |
  python3 "$STAGE/deploy/wallhop-isolated/topology_guard.py" || {
    echo "G4_GATE=BLOCKED CODE=DISABLED_TOPOLOGY"
    exit 2
  }

# Protect against a race between preflight and the only create step.
BASE_BEFORE_UP="$(fingerprint_protected)"
[[ "$BASE_BEFORE_UP" == "$G4_EXPECTED_FINGERPRINT" ]] || {
  echo "G4_GATE=BLOCKED CODE=PROTECTED_PRESTART_DRIFT"
  exit 2
}
candidate_absent || { echo "G4_GATE=BLOCKED CODE=CANDIDATE_RACE"; exit 2; }

# At this point the only permitted mutations are the NEW Compose project's
# candidate containers and networks; rollback is armed *before* calling up.
START_ARMED=1
docker compose -f "$COMPOSE" up -d --pull never --no-build >/dev/null || {
  echo "G4_GATE=BLOCKED CODE=DARK_START"
  exit 2
}

# Verify the candidate is healthy without querying any article/provider.
READY=0
for i in {1..45}; do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$NEW_RECOVERY" 2>/dev/null)" || break
  if [[ "$state" == "healthy" ]]; then READY=1; break; fi
  if [[ "$state" == "unhealthy" ]]; then break; fi
  sleep 2
done
if (( ! READY )); then
  echo "G4_GATE=BLOCKED CODE=CANDIDATE_NOT_HEALTHY"
  exit 2
fi
echo "G4_NEW_RECOVERY_HEALTH=PASS"

docker inspect "$NEW_RECOVERY" "$NEW_RELAY" | python3 -c '
import json,sys
a,b=json.load(sys.stdin)
checks={
    "RECOVERY_NETWORKS": set(a["NetworkSettings"]["Networks"]) == {"newsflux_wallhop_reader_isolated","newsflux_wallhop_egress_isolated"},
    "RELAY_NETWORKS": set(b["NetworkSettings"]["Networks"]) == {"newsflux_wallhop_egress_isolated","npm-proxyyml_default"},
    "RECOVERY_ONLY_PRIVATE": "npm-proxyyml_default" not in a["NetworkSettings"]["Networks"],
    "NO_PUBLISHED_PORTS": not a["HostConfig"]["PortBindings"] and not b["HostConfig"]["PortBindings"],
    "READONLY_ROOT": a["HostConfig"]["ReadonlyRootfs"] and b["HostConfig"]["ReadonlyRootfs"],
    "RECOVERY_TMPFS_CONFIG": "/data" in (a["HostConfig"].get("Tmpfs") or {}),
    "NO_SHARED_VOLUME": all(m["Type"] != "volume" for m in a["Mounts"]),
    "STILL_RUNNING": a["State"]["Running"] and b["State"]["Running"],
}
for name,value in checks.items():
    print("G4_" + name + "=" + ("PASS" if value else "FAIL"))
if not all(checks.values()): sys.exit(2)
' || { echo "G4_GATE=BLOCKED CODE=RUNTIME_ISOLATION"; exit 2; }

docker exec "$NEW_RECOVERY" python -c '
from pathlib import Path
mounts = [line.split(" - ",1)[1].split()[0] for line in Path("/proc/self/mountinfo").read_text().splitlines() if line.split(" - ",1)[0].split()[4] == "/data"]
assert mounts == ["tmpfs"]
' >/dev/null || { echo "G4_GATE=BLOCKED CODE=DATA_NOT_TMPFS"; exit 2; }
echo "G4_TMPFS_EFFECTIVE=PASS"

# Preserve the original identities while sidecar is running and when its
# relay fails; no requests to real WallHop or to actual article URLs.
[[ "$(fingerprint_protected)" == "$BASE_FINGERPRINT" ]] || {
  echo "G4_GATE=BLOCKED CODE=PROTECTED_DRIFT_DURING"
  exit 2
}
[[ "$(npm111_sha)" == "$BASE_NPM111_SHA" ]] || {
  echo "G4_GATE=BLOCKED CODE=NPM111_CONF_DRIFT_DURING"
  exit 2
}
echo "G4_LEGACY_DURING=PASS"

docker stop "$NEW_RELAY" >/dev/null
[[ "$(fingerprint_protected)" == "$BASE_FINGERPRINT" ]] || {
  echo "G4_GATE=BLOCKED CODE=PROTECTED_DRIFT_ON_RELAY_FAILURE"
  exit 2
}
echo "G4_LEGACY_ON_RELAY_FAILURE=PASS"
echo "G4_DARK_CANARY=PASS"
echo "WALLHOP_EXTERNAL_ARTICLE_REQUESTS=NOT_ISSUED_BY_OPERATOR"
echo "G4_NEW_CONTAINERS_PERSIST=NO_AFTER_AUTO_ROLLBACK"
# EXIT trap removes the new sidecar/relay and reports exact protected parity.
