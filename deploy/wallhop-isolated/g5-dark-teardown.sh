#!/usr/bin/env bash
# G5 teardown: ONLY a verified, DARK, disabled, independently deployed pair.
# This is not a generic recovery command and never manages legacy PR188/NPM111.
set -Eeuo pipefail
block() { echo "G5_TEARDOWN_ADMISSION=BLOCKED CODE=$1"; exit 2; }
if [[ $# -eq 0 ]]; then echo "G5_TEARDOWN_MODE=SAFE_NOOP"; exit 0; fi
if [[ $# -eq 1 && "$1" == "--help" ]]; then
  echo "G5_TEARDOWN_MODE=HELP"
  echo "Usage: g5-dark-teardown.sh --check-only|--execute --source-sha <40hex> --expected-protected-fingerprint <16hex> --expected-npm111-sha <64hex> --expected-recovery-image-id sha256:<64hex> --expected-relay-image-id sha256:<64hex>"
  echo "Execute requires root, independent operator GO and NEWSFLUX_G5_STOP_ACK=STOP_ISOLATED_DARK_ONLY."
  exit 0
fi
MODE="" SOURCE_SHA="" EXPECTED_FP="" EXPECTED_NPM111_SHA="" REC_ID="" RELAY_ID=""
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
    --expected-recovery-image-id)
      [[ $# -ge 2 && -z "$REC_ID" ]] || block ARGUMENT_SCOPE
      REC_ID="$2"; shift 2 ;;
    --expected-relay-image-id)
      [[ $# -ge 2 && -z "$RELAY_ID" ]] || block ARGUMENT_SCOPE
      RELAY_ID="$2"; shift 2 ;;
    *) block ARGUMENT_SCOPE ;;
  esac
done
[[ "$MODE" == "--execute" || "$MODE" == "--check-only" ]] || block ARGUMENT_SCOPE
[[ "$SOURCE_SHA" =~ ^[a-f0-9]{40}$ && "$EXPECTED_FP" =~ ^[a-f0-9]{16}$ && "$EXPECTED_NPM111_SHA" =~ ^[a-f0-9]{64}$ && "$REC_ID" =~ ^sha256:[a-f0-9]{64}$ && "$RELAY_ID" =~ ^sha256:[a-f0-9]{64}$ ]] || block INVALID_IDENTITIES
if [[ "$MODE" == "--execute" ]]; then
  [[ "${NEWSFLUX_G5_STOP_ACK:-}" == "STOP_ISOLATED_DARK_ONLY" ]] || block EXPLICIT_ACK_REQUIRED
  [[ "${GITHUB_ACTIONS:-false}" != true && "$EUID" == 0 ]] || block OMV_ROOT_ONLY
fi
for cmd in docker python3 flock awk sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || block DEPENDENCY_MISSING
done
docker info >/dev/null 2>&1 || block DOCKER_UNAVAILABLE
exec 8>/run/lock/newsflux-wallhop-g4-dark.lock
flock -n 8 || block CONCURRENT_G4
exec 9>/run/lock/newsflux-wallhop-g5-dark.lock
flock -n 9 || block CONCURRENT_G5
NEW_RECOVERY=newsflux-wallhop-recovery
NEW_RELAY=newsflux-wallhop-egress
LEGACY=newsflux-pr188-content-fallback
RELEASE_DIR="/dockerdata/compose/newsflux/wallhop-dark/releases/$SOURCE_SHA"
[[ -d "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || block UNKNOWN_RELEASE
[[ -f "$RELEASE_DIR/deploy/wallhop-isolated/compose.yaml" &&
   -f "$RELEASE_DIR/deploy/wallhop-isolated/g5-dark-override.yaml" &&
   -f "$RELEASE_DIR/deploy/wallhop-isolated/haproxy.cfg" ]] || block RELEASE_FILES_MISSING
[[ -f "$RELEASE_DIR/deploy/wallhop-isolated/g5-dark-teardown.sh" ]] || block TEARDOWN_SOURCE_MISSING
# Do not let an unrelated operator script remove an otherwise valid candidate.
ARCHIVED_WRAPPER_HASH="$(sha256sum "$RELEASE_DIR/deploy/wallhop-isolated/g5-dark-teardown.sh" | awk '{print $1}')" || block ARCHIVED_TEARDOWN_HASH
RUNNING_WRAPPER_HASH="$(sha256sum "$0" | awk '{print $1}')" || block RUNNING_TEARDOWN_HASH
[[ "$ARCHIVED_WRAPPER_HASH" == "$RUNNING_WRAPPER_HASH" ]] || block TEARDOWN_WRAPPER_BYTES_DRIFT
echo "G5_TEARDOWN_WRAPPER_IDENTITY=PASS"

protected_running() {
  local n
  for n in npm "$LEGACY" newsflux; do
    [[ "$(docker inspect -f '{{.State.Running}}' "$n" 2>/dev/null)" == true ]] || return 1
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
  local n
  for n in "$NEW_RECOVERY" "$NEW_RELAY"; do
    if docker container inspect "$n" >/dev/null 2>&1; then return 1; fi
  done
  for n in newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated; do
    if docker network inspect "$n" >/dev/null 2>&1; then return 1; fi
  done
  [[ -z "$(docker ps -aq --filter label=com.docker.compose.project=newsflux-wallhop-isolated)" ]]
}
verify_candidate() {
  docker inspect "$NEW_RECOVERY" "$NEW_RELAY" | python3 -c '
import json,sys
a,b=json.load(sys.stdin)
rec_id,relay_id,release_dir,source_sha=sys.argv[1:5]
if a["Image"]!=rec_id or b["Image"]!=relay_id: sys.exit(2)
if a["Config"]["Labels"].get("org.opencontainers.image.revision")!=source_sha: sys.exit(2)
if (a["Name"].lstrip("/"),b["Name"].lstrip("/"))!=("newsflux-wallhop-recovery","newsflux-wallhop-egress"): sys.exit(2)
if any(x["Config"]["Labels"].get("com.docker.compose.project")!="newsflux-wallhop-isolated" for x in (a,b)): sys.exit(2)
if set(a["NetworkSettings"]["Networks"])!={"newsflux_wallhop_reader_isolated","newsflux_wallhop_egress_isolated"}: sys.exit(2)
if set(b["NetworkSettings"]["Networks"])!={"newsflux_wallhop_egress_isolated","npm-proxyyml_default"}: sys.exit(2)
if any(x["HostConfig"].get("PortBindings") or not x["HostConfig"].get("ReadonlyRootfs") for x in (a,b)): sys.exit(2)
if "/data" not in (a["HostConfig"].get("Tmpfs") or {}): sys.exit(2)
if any(m.get("Type")=="volume" for m in a.get("Mounts",[])): sys.exit(2)
mounts=[m for m in b.get("Mounts",[]) if m.get("Destination")=="/usr/local/etc/haproxy/haproxy.cfg"]
if len(mounts)!=1 or mounts[0].get("Source")!=release_dir+"/deploy/wallhop-isolated/haproxy.cfg" or mounts[0].get("RW"): sys.exit(2)
def env(x):
 return dict(y.split("=",1) for y in x["Config"]["Env"] if "=" in y)
r,e=env(a),env(b)
if r.get("CONTENT_FALLBACK_READER_ENABLED")!="false" or r.get("CONTENT_FALLBACK_POLICIES_JSON")!="{\"enabled\":false}": sys.exit(2)
if r.get("MINIFLUX_BASE_URL")!="https://miniflux.example.test": sys.exit(2)
if not r.get("MINIFLUX_API_TOKEN","").startswith("synthetic-only-"): sys.exit(2)
if not r.get("CONTENT_FALLBACK_API_TOKEN","").startswith("synthetic-only-"): sys.exit(2)
if e.get("WALLHOP_UPSTREAM")!="127.0.0.1:9" or e.get("MINIFLUX_UPSTREAM")!="127.0.0.1:9": sys.exit(2)
' "$REC_ID" "$RELAY_ID" "$RELEASE_DIR" "$SOURCE_SHA" || return 1

  docker network inspect newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated |
    python3 -c '
import json,sys
items=json.load(sys.stdin)
expected={
 "newsflux_wallhop_reader_isolated":("10.240.0.96/28",{"newsflux-wallhop-recovery"}),
 "newsflux_wallhop_egress_isolated":("10.240.0.112/28",{"newsflux-wallhop-recovery","newsflux-wallhop-egress"})
}
if len(items)!=2: sys.exit(2)
for n in items:
 name=n["Name"]
 if name not in expected or n.get("Internal") is not True: sys.exit(2)
 cidr,allowed=expected[name]
 if n["IPAM"]["Config"][0].get("Subnet")!=cidr: sys.exit(2)
 if n.get("Labels",{}).get("com.docker.compose.project")!="newsflux-wallhop-isolated": sys.exit(2)
 attached={v.get("Name") for v in (n.get("Containers") or {}).values()}
 if not attached.issubset(allowed): sys.exit(2)
' || return 1
}
BASE_FP="$(fingerprint_protected)" || block PROTECTED_INSPECT
[[ "$BASE_FP" == "$EXPECTED_FP" ]] || block PROTECTED_PRESTATE_DRIFT
protected_running || block PROTECTED_SERVICE_STOPPED
BASE_NPM111_SHA="$(npm111_sha)" || block NPM111_READ
[[ "$BASE_NPM111_SHA" == "$EXPECTED_NPM111_SHA" ]] || block NPM111_PRESTATE_DRIFT
verify_candidate || block CANDIDATE_IDENTITY_OR_TOPOLOGY
echo "G5_TEARDOWN_PRECHECK=PASS"

if [[ "$MODE" == "--check-only" ]]; then
  echo "G5_TEARDOWN_CHECK_ONLY=PASS_NO_DOCKER_MUTATIONS"
  exit 0
fi
# Admission recheck immediately before touching only independently-owned G5 resources.
[[ "$(fingerprint_protected)" == "$BASE_FP" && "$(npm111_sha)" == "$BASE_NPM111_SHA" ]] || block PROTECTED_PRESTOP_DRIFT
protected_running || block PROTECTED_PRESTOP_STOPPED
verify_candidate || block CANDIDATE_PRESTOP_DRIFT
MUTATING=1
finished=0
on_exit() {
  local status="$1"
  trap - EXIT
  if (( status != 0 && MUTATING == 1 )); then
    echo "G5_TEARDOWN=PARTIAL_HOLD"
    echo "G5_NEXT=MANUAL_READ_ONLY_RECONCILIATION"
  fi
  exit "$status"
}
trap 'on_exit $?' EXIT
trap 'exit 130' INT TERM HUP

# Explicit fixed names only. No rm/prune of volumes, images or release directory.
docker rm -f "$NEW_RECOVERY" "$NEW_RELAY" >/dev/null || block DARK_CONTAINER_REMOVE_FAILED
docker network rm newsflux_wallhop_reader_isolated newsflux_wallhop_egress_isolated >/dev/null || block DARK_NETWORK_REMOVE_FAILED
candidate_absent || block DARK_RESOURCES_STILL_PRESENT
protected_running || block PROTECTED_POSTSTATE_STOPPED
[[ "$(fingerprint_protected)" == "$BASE_FP" && "$(npm111_sha)" == "$BASE_NPM111_SHA" ]] || block PROTECTED_POSTSTATE_DRIFT
echo "G5_TEARDOWN=PASS"
echo "G5_PROTECTED_POSTSTATE=PASS"
echo "G5_RELEASE_SOURCE_PRESERVED=YES"
echo "G5_IMAGES_PRESERVED=YES"
echo "G5_LEGACY_PR188_NPM111=UNCHANGED_BY_SCRIPT"
