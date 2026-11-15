#!/usr/bin/env bash
# G5 reusable exact-SHA DARK deploy. Reader bridge/policy/egress stay OFF.
# No production route switch, legacy mutation, provider request or PR244 activation.
set -Eeuo pipefail
block() { echo "G5_ADMISSION=BLOCKED CODE=$1"; exit 2; }
if [[ $# -eq 0 ]]; then echo "G5_MODE=SAFE_NOOP"; exit 0; fi
if [[ $# -eq 1 && "$1" == "--help" ]]; then
  echo "G5_MODE=HELP"
  echo "Usage: g5-dark-deploy.sh --check-only|--execute --source-sha <40hex> --expected-protected-fingerprint <16hex> --expected-npm111-sha <64hex> --egress-image-id sha256:<64hex>"
  echo "Execute only after separate operator GO: root and NEWSFLUX_G5_ACK=ISOLATED_DARK_DEPLOY_ONLY."
  echo "A successful run leaves a DARK isolated candidate, NOT live provider integration."
  exit 0
fi
MODE="" SOURCE_SHA="" EXPECTED_FP="" EXPECTED_NPM111_SHA="" EGRESS_IMAGE_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only|--execute)
      [[ -z "$MODE" ]] || block DUPLICATE_MODE
      MODE="$1"; shift ;;
    --source-sha)
      [[ $# -ge 2 && -z "$SOURCE_SHA" ]] || block ARGUMENT_SCOPE
      SOURCE_SHA="$2"; shift 2 ;;
    --expected-protected-fingerprint)
      [[ $# -ge 2 && -z "$EXPECTED_FP" ]] || block ARGUMENT_SCOPE
      EXPECTED_FP="$2"; shift 2 ;;
    --expected-npm111-sha)
      [[ $# -ge 2 && -z "$EXPECTED_NPM111_SHA" ]] || block ARGUMENT_SCOPE
      EXPECTED_NPM111_SHA="$2"; shift 2 ;;
    --egress-image-id)
      [[ $# -ge 2 && -z "$EGRESS_IMAGE_ID" ]] || block ARGUMENT_SCOPE
      EGRESS_IMAGE_ID="$2"; shift 2 ;;
    *) block ARGUMENT_SCOPE ;;
  esac
done
[[ "$MODE" == "--execute" || "$MODE" == "--check-only" ]] || block ARGUMENT_SCOPE
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ && "$EXPECTED_FP" =~ ^[0-9a-f]{16}$ && "$EXPECTED_NPM111_SHA" =~ ^[0-9a-f]{64}$ && "$EGRESS_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || block INVALID_EXACT_IDENTITIES
if [[ "$MODE" == "--execute" ]]; then
  [[ "${NEWSFLUX_G5_ACK:-}" == "ISOLATED_DARK_DEPLOY_ONLY" ]] || block EXPLICIT_ACK_REQUIRED
  [[ "${GITHUB_ACTIONS:-false}" != true && "$EUID" == 0 ]] || block OMV_ROOT_ONLY
fi
for cmd in docker git python3 tar mktemp flock awk; do
  command -v "$cmd" >/dev/null 2>&1 || block DEPENDENCY_MISSING
done
REPO="${NEWSFLUX_G5_REPO:-/dockerdata/compose/newsflux/repo}"
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || block REPO_MISSING
ORIGIN="$(git -C "$REPO" remote get-url origin)" || block ORIGIN_UNVERIFIED
case "$ORIGIN" in
  https://github.com/jfsdias/NewsFlux|https://github.com/jfsdias/NewsFlux.git|git@github.com:jfsdias/NewsFlux.git|ssh://git@github.com/jfsdias/NewsFlux.git) ;;
  *) block UNEXPECTED_REPOSITORY ;;
esac
docker info >/dev/null 2>&1 || block DOCKER_UNAVAILABLE
docker compose version >/dev/null 2>&1 || block COMPOSE_UNAVAILABLE
# Lock G4 too: both versions operate on the SAME fixed isolated project.
exec 8>/run/lock/newsflux-wallhop-g4-dark.lock
flock -n 8 || block CONCURRENT_G4
exec 9>/run/lock/newsflux-wallhop-g5-dark.lock
flock -n 9 || block CONCURRENT_G5

PROJECT=newsflux-wallhop-isolated
NEW_RECOVERY=newsflux-wallhop-recovery
NEW_RELAY=newsflux-wallhop-egress
LEGACY=newsflux-pr188-content-fallback
RELEASE_ROOT=/dockerdata/compose/newsflux/wallhop-dark/releases
STAGE="" COMPOSE="" OVERRIDE="" ARMED=0 STAGE_CREATED=0 FINISHED=0
BASE_FP="" BASE_NPM111_SHA=""

protected_running() {
  local name
  for name in npm "$LEGACY" newsflux; do
    [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == true ]] || return 1
  done
}
fingerprint_protected() {
  docker inspect npm "$LEGACY" newsflux | python3 -c '
import hashlib,json,sys
by_name={x["Name"].lstrip("/"):x for x in json.load(sys.stdin)}
required={"npm","newsflux-pr188-content-fallback","newsflux"}
if set(by_name)!=required: sys.exit(2)
snapshot={}
for n in required:
 x=by_name[n]
 snapshot[n]={"id":x["Id"],"image":x["Image"],
              "networks":sorted(x["NetworkSettings"]["Networks"]),
              "mounts":sorted((m.get("Type"),m.get("Name"),m.get("Destination"),m.get("RW"))
                             for m in x.get("Mounts",[]))}
print(hashlib.sha256(json.dumps(snapshot,sort_keys=True).encode()).hexdigest()[:16])
'
}
npm111_sha() {
  docker exec npm sha256sum /data/nginx/proxy_host/111.conf | awk '{print $1}'
}
candidate_absent() {
  local name
  for name in "$NEW_RECOVERY" "$NEW_RELAY"; do
    if docker container inspect "$name" >/dev/null 2>&1; then return 1; fi
  done
  for name in newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated; do
    if docker network inspect "$name" >/dev/null 2>&1; then return 1; fi
  done
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ]]
}

# Abort/failure after up => remove only isolated project containers/networks.
# If cleanup fails preserve source for RCA, emit HOLD, never report PASS.
cleanup() {
  local result="$1" failed=0 current
  (( FINISHED == 0 )) || return
  FINISHED=1
  trap - EXIT
  set +e
  if (( result != 0 && ARMED == 1 )); then
    docker compose -f "$COMPOSE" -f "$OVERRIDE" down >/dev/null 2>&1 || failed=1
    candidate_absent || failed=1
    protected_running || failed=1
    current="$(fingerprint_protected 2>/dev/null)"
    [[ "$current" == "$BASE_FP" ]] || failed=1
    current="$(npm111_sha 2>/dev/null)"
    [[ "$current" == "$BASE_NPM111_SHA" ]] || failed=1
    if (( failed != 0 )); then
      echo "G5_ROLLBACK=FAIL"
      echo "G5_HOLD=MANUAL_READ_ONLY_RECONCILIATION"
      exit 3
    fi
    echo "G5_ROLLBACK=PASS"
  fi
  if (( result != 0 && STAGE_CREATED == 1 )) && [[ -n "$STAGE" && -d "$STAGE" ]]; then
    # STAGE is exclusively created after verifying path absence.
    rm -rf -- "$STAGE" || { echo "G5_STAGING_CLEANUP=FAIL"; exit 3; }
  fi
  exit "$result"
}
trap 'cleanup $?' EXIT
trap 'exit 130' INT TERM HUP

BASE_FP="$(fingerprint_protected)" || block PROTECTED_INSPECT
if [[ "$BASE_FP" != "$EXPECTED_FP" ]]; then block PROTECTED_PRESTATE_DRIFT; fi
protected_running || block PROTECTED_SERVICE_STOPPED
BASE_NPM111_SHA="$(npm111_sha)" || block NPM111_READ
if [[ "$BASE_NPM111_SHA" != "$EXPECTED_NPM111_SHA" ]]; then block NPM111_PRESTATE_DRIFT; fi
candidate_absent || block EXISTING_CANDIDATE_OR_NETWORK
[[ "$(docker image inspect -f '{{.Id}}' "$EGRESS_IMAGE_ID" 2>/dev/null)" == "$EGRESS_IMAGE_ID" ]] || block RELAY_IMAGE_NOT_PINNED_LOCAL
python3 - "$REPO" <<'PY' || block DISK_HEADROOM
import shutil,sys
if shutil.disk_usage(sys.argv[1]).free < 10*1024**3: sys.exit(2)
PY
echo "G5_PROTECTED_PRESTATE=PASS"

REMOTE_MAIN="$(git -C "$REPO" ls-remote origin refs/heads/main | awk '{print $1}')" || block REMOTE_MAIN_UNAVAILABLE
if [[ "$REMOTE_MAIN" != "$SOURCE_SHA" ]]; then block REMOTE_MAIN_DRIFT; fi
# Execute may fetch the exact approved main ref; check-only stays fetch-free.
if [[ "$MODE" == "--execute" ]]; then
  git -C "$REPO" fetch --quiet --no-tags origin refs/heads/main || block SOURCE_FETCH
  [[ "$(git -C "$REPO" rev-parse FETCH_HEAD)" == "$SOURCE_SHA" ]] || block SOURCE_FETCH_DRIFT
fi
git -C "$REPO" cat-file -e "${SOURCE_SHA}^{commit}" || block EXACT_COMMIT_NOT_LOCAL
echo "G5_EXACT_SOURCE=PASS"
if [[ "$MODE" == "--check-only" ]]; then
  git -C "$REPO" show "$SOURCE_SHA:deploy/wallhop-isolated/g4_ipam_gate.py" |
    python3 - --check-only || block IPAM_OR_VPN_UNVERIFIED
  echo "G5_IPAM_GATE=PASS"
  echo "G5_CHECK_ONLY=PASS_NO_DOCKER_MUTATIONS"
  echo "G5_PROVIDER_CONTRACT=HOLD"
  echo "G5_PRODUCT_ACTIVATION=NOT_AUTHORIZED"
  exit 0
fi

# No descendant of the deployment directory may redirect writes via symlinks.
[[ ! -L "/dockerdata/compose/newsflux" && ! -L "/dockerdata/compose/newsflux/wallhop-dark" ]] || block RELEASE_PARENT_SYMLINK
[[ ! -L "$RELEASE_ROOT" ]] || block RELEASE_ROOT_SYMLINK
mkdir -p -m 0700 -- "$RELEASE_ROOT" || block RELEASE_ROOT_CREATE
[[ ! -L "$RELEASE_ROOT" ]] || block RELEASE_ROOT_SYMLINK
STAGE="$RELEASE_ROOT/$SOURCE_SHA"
[[ ! -e "$STAGE" && ! -L "$STAGE" ]] || block RELEASE_ALREADY_EXISTS
mkdir -m 0700 -- "$STAGE" || block RELEASE_CREATE
STAGE_CREATED=1
git -C "$REPO" archive "$SOURCE_SHA" | tar -xf - -C "$STAGE" || block SOURCE_ARCHIVE
COMPOSE="$STAGE/deploy/wallhop-isolated/compose.yaml"
OVERRIDE="$STAGE/deploy/wallhop-isolated/g5-dark-override.yaml"
[[ -f "$COMPOSE" && -f "$STAGE/deploy/wallhop-isolated/g4_ipam_gate.py" && -f "$STAGE/deploy/wallhop-isolated/topology_guard.py" ]] || block SOURCE_FILES
python3 "$STAGE/deploy/wallhop-isolated/g4_ipam_gate.py" --output "$OVERRIDE" || block IPAM_OR_VPN_UNVERIFIED
echo "G5_IPAM_GATE=PASS"
python3 "$STAGE/deploy/npm111-g2c/audit.py" || block NPM111_G2C

# Immutable source/image identity, not a mutable tag. May build ONLY new image.
SIDECAR_TAG="newsflux-wallhop-g5:${SOURCE_SHA:0:12}"
docker build --pull=false --label "org.opencontainers.image.revision=$SOURCE_SHA" \
  -f "$STAGE/services/content_fallback/Dockerfile" -t "$SIDECAR_TAG" "$STAGE" >/dev/null || block SIDECAR_BUILD
WALLHOP_SIDECAR_IMAGE="$(docker image inspect -f '{{.Id}}' "$SIDECAR_TAG")" || block IMAGE_INSPECT
[[ "$WALLHOP_SIDECAR_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || block IMAGE_ID_INVALID
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$SIDECAR_TAG")" == "$SOURCE_SHA" ]] || block IMAGE_REVISION
export WALLHOP_SIDECAR_IMAGE
export WALLHOP_EGRESS_IMAGE="$EGRESS_IMAGE_ID"
# Forced synthetic state. Real provider tokens/URLs are never read here.
export WALLHOP_MINIFLUX_PUBLIC_HOST=miniflux.example.test
export WALLHOP_MINIFLUX_PUBLIC_URL=https://miniflux.example.test
export WALLHOP_MINIFLUX_API_TOKEN=synthetic-only-not-real-account
export WALLHOP_RECOVERY_API_TOKEN=synthetic-only-not-real-service-token-1234567890
export WALLHOP_HAPROXY_CONFIG="$STAGE/deploy/wallhop-isolated/haproxy.cfg"
docker compose -f "$COMPOSE" -f "$OVERRIDE" config --format json |
  python3 "$STAGE/deploy/wallhop-isolated/topology_guard.py" || block TOPOLOGY
docker compose -f "$COMPOSE" -f "$OVERRIDE" config --format json |
  python3 -c '
import json,sys
c=json.load(sys.stdin)
r=c["services"]["wallhop-recovery"]["environment"]
e=c["services"]["wallhop-egress"]["environment"]
assert r["CONTENT_FALLBACK_READER_ENABLED"]=="false"
assert r["CONTENT_FALLBACK_POLICIES_JSON"]=="{\"enabled\":false}"
assert e["WALLHOP_UPSTREAM"]=="127.0.0.1:9"
assert e["MINIFLUX_UPSTREAM"]=="127.0.0.1:9"
for n,cidr in {"reader_internal":"10.240.0.96/28","egress_internal":"10.240.0.112/28"}.items():
 assert c["networks"][n]["ipam"]["config"]==[{"subnet":cidr}]
' || block DISABLED_POLICY_DRIFT
echo "G5_DARK_TOPOLOGY=PASS"

# Fresh locked protected checks before any Docker create; re-run current IPAM.
[[ "$(fingerprint_protected)" == "$BASE_FP" && "$(npm111_sha)" == "$BASE_NPM111_SHA" ]] || block PROTECTED_PRESTART_DRIFT
protected_running || block PROTECTED_PRESTART_STOPPED
candidate_absent || block CANDIDATE_RACE
rm -f -- "$OVERRIDE"
python3 "$STAGE/deploy/wallhop-isolated/g4_ipam_gate.py" --output "$OVERRIDE" || block IPAM_RACE_RECHECK
ARMED=1
docker compose -f "$COMPOSE" -f "$OVERRIDE" up -d --pull never --no-build >/dev/null || block DARK_START

READY=0
for _ in {1..45}; do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$NEW_RECOVERY" 2>/dev/null)" || break
  if [[ "$state" == healthy ]]; then READY=1; break; fi
  [[ "$state" != unhealthy ]] || break
  sleep 2
done
(( READY == 1 )) || block NEW_SERVICE_UNHEALTHY
docker inspect "$NEW_RECOVERY" "$NEW_RELAY" | python3 -c '
import json,sys
a,b=json.load(sys.stdin)
checks=[
 {a["Name"].lstrip("/"),b["Name"].lstrip("/")}=={"newsflux-wallhop-recovery","newsflux-wallhop-egress"},
 all(x["Config"]["Labels"].get("com.docker.compose.project")=="newsflux-wallhop-isolated" for x in (a,b)),
 set(a["NetworkSettings"]["Networks"])=={"newsflux_wallhop_reader_isolated","newsflux_wallhop_egress_isolated"},
 set(b["NetworkSettings"]["Networks"])=={"newsflux_wallhop_egress_isolated","npm-proxyyml_default"},
 all(x["State"].get("Running") for x in (a,b)),
 all(not x["HostConfig"].get("PortBindings") for x in (a,b)),
 all(x["HostConfig"].get("ReadonlyRootfs") for x in (a,b)),
 "/data" in (a["HostConfig"].get("Tmpfs") or {}),
 all(m.get("Type")!="volume" for m in a["Mounts"]),
 dict(v.split("=",1) for v in b["Config"]["Env"] if "=" in v).get("WALLHOP_UPSTREAM")=="127.0.0.1:9",
 dict(v.split("=",1) for v in b["Config"]["Env"] if "=" in v).get("MINIFLUX_UPSTREAM")=="127.0.0.1:9"
]
if not all(checks): sys.exit(2)
print("G5_RUNTIME_ISOLATION=PASS")
' || block RUNTIME_ISOLATION
# Verify effective runtime tmpfs rather than trusting only Docker HostConfig.
docker exec "$NEW_RECOVERY" python -c '
from pathlib import Path
matches=[line.split(" - ",1)[1].split()[0]
         for line in Path("/proc/self/mountinfo").read_text().splitlines()
         if line.split(" - ",1)[0].split()[4]=="/data"]
assert matches==["tmpfs"]
' >/dev/null || block RUNTIME_TMPFS_NOT_EFFECTIVE
echo "G5_RUNTIME_TMPFS=PASS"
docker network inspect newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated |
  python3 -c '
import json,sys
items=json.load(sys.stdin)
expected={"newsflux_wallhop_reader_isolated":"10.240.0.96/28","newsflux_wallhop_egress_isolated":"10.240.0.112/28"}
assert len(items)==2
for n in items:
 assert n["IPAM"]["Config"][0]["Subnet"]==expected[n["Name"]]
print("G5_RUNTIME_IPAM=PASS")
' || block RUNTIME_IPAM
[[ "$(fingerprint_protected)" == "$BASE_FP" && "$(npm111_sha)" == "$BASE_NPM111_SHA" ]] || block PROTECTED_POSTSTATE_DRIFT
protected_running || block PROTECTED_POSTSTATE_STOPPED

echo "G5_SOURCE_SHA=$SOURCE_SHA"
echo "G5_SIDECAR_IMAGE_ID=$WALLHOP_SIDECAR_IMAGE"
echo "G5_EGRESS_IMAGE_ID=$EGRESS_IMAGE_ID"
echo "G5_RELEASE_DIR=$STAGE"
echo "G5_READER_BRIDGE=DISABLED"
echo "G5_PROVIDER_CONTRACT=HOLD"
echo "G5_PRODUCT_ACTIVATION=NOT_AUTHORIZED"
echo "G5_EXTERNAL_ARTICLE_REQUESTS=DISABLED_BY_CONFIG"
echo "G5_PERSISTENCE=EPHEMERAL_TMPFS"
echo "G5_LEGACY_POSTSTATE=PASS"
echo "G5_DARK_DEPLOY=PASS"
echo "G5_PRODUCTION_DEPLOY=NOT_EXECUTED"
