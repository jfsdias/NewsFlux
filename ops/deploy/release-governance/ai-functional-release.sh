#!/usr/bin/env bash
# NewsFlux AI functional release — single operator procedure for the OMV host.
#
#   export APPROVED_SHA=<40-hex commit on main>
#   sudo -E bash ai-functional-release.sh prepare          # creates the release dir + exact source (no Docker change)
#   sudo -E bash ai-functional-release.sh preflight        # strictly read-only: writes nothing, changes nothing
#   sudo -E bash ai-functional-release.sh build            # exact-SHA images, revision labels verified
#   sudo -E bash ai-functional-release.sh promote-summary  # new Summary image, inference still disabled
#   sudo -E bash ai-functional-release.sh update-caddy     # Caddyfile -> this SHA (closed prior-state list, backup, in-place, validated, rollback)
#   sudo -E bash ai-functional-release.sh promote-reader   # new Reader image, readiness proven by HTTP probe
#   sudo -E bash ai-functional-release.sh smoke            # fail-closed production checks + receipt
#   sudo -E bash ai-functional-release.sh s5-attestation-path   # prints $RELEASE_DIR/s5-key-attestation.json
#   sudo python3 s5_key_audit.py ... --out "$(sudo -E bash ai-functional-release.sh s5-attestation-path)"
#   sudo -E bash ai-functional-release.sh s5-preflight     # read-only LiteLLM key/model/price/budget/logging gates
#   sudo -E bash ai-functional-release.sh enable-s5        # only after s5-preflight PASS (re-run internally)
#
# D1 mode (LiteLLM governs models and cost; D1-R7-02). Explicit, never inferred:
#   export RELEASE_MODE=d1 D1_COST_AUTHORITY=gateway_budget_enforced|explicit_unlimited \
#          D1_EVIDENCE_FILE=/root/newsflux-d1.XXXXXXXX/evidence.json D1_EVIDENCE_SHA256=<64 hex, from the ledger> \
#          D1_EXTERNAL_TRANSFER_CONSENT=GRANTED   # the owner's external-transfer consent, recorded in the ledger
#   [D1_OWNER_LEDGER_REPO=<homeserver checkout>]   # required for explicit_unlimited
#   sudo -E bash ai-functional-release.sh d1-preflight     # plan + D1 preflight in the TARGET configuration (no change)
#   sudo -E bash ai-functional-release.sh enable-s5        # d1-preflight PASS -> promote -> live re-check
#   sudo -E bash ai-functional-release.sh disable-s5       # exact rollback to the dark configuration
#   sudo -E bash ai-functional-release.sh all              # prepare..smoke, stops at the first failed gate
#   rollbacks: disable-s5 | rollback-reader | rollback-caddy | rollback-summary
#
# Scope: only `summary-api` and the Reader service are recreated, via release.py (exact image ID,
# drift checks, host lock, readiness, automatic rollback). Miniflux, miniflux-db, NPM, LiteLLM and the
# content-fallback sidecar are never touched. Output is gate names, identifiers and hashes only.
set -Eeuo pipefail
umask 077
# No bytecode in the exact source checkout: a __pycache__ left by any python3 run makes require_source DIRTY_SOURCE.
export PYTHONDONTWRITEBYTECODE=1

: "${APPROVED_SHA:?APPROVED_SHA (40-hex commit on main) is required}"
[[ "$APPROVED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "GATE=BLOCKED CODE=APPROVED_SHA_INVALID"; exit 1; }
PROJECT="${NEWSFLUX_PROJECT:-newsflux}"
SUMMARY_SERVICE="${NEWSFLUX_SUMMARY_SERVICE:-summary-api}"
READER_CONTAINER="${NEWSFLUX_READER_CONTAINER:-newsflux}"
read -r -a PROTECTED_NAMES <<<"${NEWSFLUX_PROTECTED_CONTAINERS:-miniflux miniflux-db}"
REPO_URL="${NEWSFLUX_REPO_URL:-https://github.com/jfsdias/NewsFlux.git}"
RELEASE_ROOT="${NEWSFLUX_RELEASE_ROOT:-/dockerdata/compose/newsflux/.releases}"
RELEASE_DIR="$RELEASE_ROOT/ai-functional-${APPROVED_SHA:0:12}"
SRC="$RELEASE_DIR/source"
LOCK="${NEWSFLUX_RELEASE_LOCK:-/run/lock/newsflux-release.lock}"
# Closed list of Reader Caddyfile states a release may migrate FROM (sha256 of the exact bytes). Not
# configurable from the environment: an unknown live state is drift and blocks. Extend only by review.
#   6970ee… pilot Caddyfile before Stage 1 (R12F-09 validated rollback state)
#   56d434b… Stage 1 Caddyfile (main 57f1c6a…d54eda2: summary + GET-only catalog route)
ACCEPTED_PRIOR_CADDY_SHAS=(
  6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108
  56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
)
CADDY_STATE_DIR="$RELEASE_DIR/caddy"
# Test-only fault injection for the disposable rehearsals; ignored for the production release root.
REHEARSAL_FAULT="${NEWSFLUX_REHEARSAL_FAULT:-}"
[[ "$RELEASE_ROOT" == /dockerdata/compose/newsflux/.releases ]] && REHEARSAL_FAULT=""
READER_PORT="${NEWSFLUX_READER_PORT:-2000}"
# Reader build flags. WallHop recovery stays hidden until its sidecar route passes its own gates.
READER_BASE_PATH="${READER_BASE_PATH:-/}"
READER_AI_ENABLED="${READER_AI_ENABLED:-1}"
READER_RECOVERY_BASE_PATH="${READER_RECOVERY_BASE_PATH:-}"
# WallHop path A (user's browser opens the article on WallHop after a per-click consent). Off unless exactly "true".
READER_WALLHOP_EXTERNAL_OPEN="${READER_WALLHOP_EXTERNAL_OPEN:-}"
[[ -z "$READER_WALLHOP_EXTERNAL_OPEN" || "$READER_WALLHOP_EXTERNAL_OPEN" == true ]] || { echo "GATE=BLOCKED CODE=READER_WALLHOP_EXTERNAL_OPEN_INVALID"; exit 1; }
PUBLIC_CURL_RESOLVE="${NEWSFLUX_PUBLIC_CURL_RESOLVE:-}" # optional "host:443:ip" when hairpin DNS is unavailable
PUBLIC_CURL_CACERT="${NEWSFLUX_PUBLIC_CURL_CACERT:-}"   # optional CA bundle (disposable rehearsal only)

gate() { printf '%s=%s\n' "$1" "$2"; }
die() { gate "$1" BLOCKED; echo "CODE=$2"; exit 1; }
release_tool() { python3 -B "$SRC/ops/deploy/release-governance/release.py" --policy "$SRC/ops/deploy/release-governance/policy.json" --lock "$LOCK" "$@"; }
summary_container() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SUMMARY_SERVICE"; }
container_name() { docker inspect -f '{{.Name}}' "$1" | sed 's#^/##'; }
reader_service() { docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$READER_CONTAINER"; }
caddy_source() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$READER_CONTAINER"; }
container_env() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" | sed -n "s/^$2=//p" | head -1; }
image_id() { docker image inspect -f '{{.Id}}' "$1"; }
image_revision() { docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1"; }
protected_args() { local name; for name in "${PROTECTED_NAMES[@]}" "$@"; do printf -- '--protected\n%s\n' "$name"; done; }
READER_PROBE='["sh","-c","wget -qO- http://127.0.0.1:'"$READER_PORT"'/ | grep -q \"id=.root.\""]'

require_source() {
  [[ -d "$SRC/.git" ]] || die SOURCE_GATE NOT_PREPARED_RUN_PREPARE
  [[ "$(git -C "$SRC" rev-parse HEAD)" == "$APPROVED_SHA" ]] || die SOURCE_GATE HEAD_MISMATCH
  # --no-optional-locks: checking cleanliness must not rewrite .git/index (preflight is read-only).
  [[ -z "$(git --no-optional-locks -C "$SRC" status --porcelain)" ]] || die SOURCE_GATE DIRTY_SOURCE
}

prepare() {
  mkdir -p "$RELEASE_DIR"
  local filter=()
  [[ "$REPO_URL" == https://* ]] && filter=(--filter=blob:none)
  # R12F-09: source is not secret. Check it out with umask 022 so build-context modes are
  # readable by non-root image users (the Dockerfiles also normalize modes defensively).
  (
    umask 022
    [[ -d "$SRC/.git" ]] || git clone --quiet "${filter[@]}" --no-checkout "$REPO_URL" "$SRC"
    git -C "$SRC" fetch --quiet origin main
    git -C "$SRC" merge-base --is-ancestor "$APPROVED_SHA" origin/main || exit 3
    git -C "$SRC" -c advice.detachedHead=false checkout --quiet --force "$APPROVED_SHA"
    # Bytecode is never source: drop __pycache__ left by an earlier run (untracked; tracked files stay untouched).
    git -C "$SRC" ls-files --others --exclude-standard --directory | { grep -E '(^|/)__pycache__/$' || true; } \
      | while read -r dir; do rm -rf -- "${SRC:?}/$dir"; done
  ) || die SOURCE_GATE APPROVED_SHA_NOT_ON_MAIN_OR_CHECKOUT_FAILED
  require_source
  gate RELEASE_DIR "$RELEASE_DIR"
  gate PREPARE PASS
}

# Strictly read-only: no file, network attachment, container or image is created or changed.
preflight() {
  require_source
  local summary reader_svc caddy active
  summary="$(summary_container)"
  [[ -n "$summary" && "$(wc -l <<<"$summary")" -eq 1 ]] || die PREFLIGHT SUMMARY_CONTAINER_NOT_UNIQUE
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$summary")" == healthy ]] || die PREFLIGHT SUMMARY_NOT_HEALTHY
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$summary")" == 0 ]] || die PREFLIGHT SUMMARY_PUBLISHES_PORT
  [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$READER_CONTAINER")" == "$PROJECT" ]] || die PREFLIGHT READER_PROJECT_MISMATCH
  reader_svc="$(reader_service)"
  python3 - "$SRC/ops/deploy/release-governance/policy.json" "$PROJECT" "$reader_svc" "$SUMMARY_SERVICE" <<'PY' || die PREFLIGHT SERVICE_NOT_IN_POLICY
import json, sys
allowed = {(i["project"], i["service"]) for i in json.load(open(sys.argv[1]))["allowed"]}
sys.exit(0 if {(sys.argv[2], sys.argv[3]), (sys.argv[2], sys.argv[4])} <= allowed else 1)
PY
  docker exec "$READER_CONTAINER" sh -c "wget -qO- http://127.0.0.1:$READER_PORT/ | grep -q 'id=.root.'" || die PREFLIGHT READER_PROBE_FAILS_ON_CURRENT
  caddy="$(caddy_source)"
  [[ -n "$caddy" && -f "$caddy" ]] || die PREFLIGHT CADDYFILE_NOT_BIND_MOUNTED
  [[ ! -L "$caddy" ]] || die PREFLIGHT CADDYFILE_IS_SYMLINK
  active="$(sha256sum "$caddy" | cut -d' ' -f1)"
  accepted_prior_caddy "$active" || [[ "$active" == "$(sha256sum "$SRC/ops/deploy/article-intel-pilot/Caddyfile" | cut -d' ' -f1)" ]] \
    || die PREFLIGHT ACTIVE_CADDY_DRIFT
  local name
  for name in "${PROTECTED_NAMES[@]}"; do
    docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die PREFLIGHT "PROTECTED_${name}_NOT_RUNNING"
  done
  [[ -n "$(container_env "$summary" NEWSFLUX_AI_ALLOWED_WEB_ORIGINS)" ]] || die PREFLIGHT PUBLIC_ORIGIN_UNKNOWN
  release_tool inspect --project "$PROJECT" | sha256sum | cut -d' ' -f1 | sed 's/^/INSPECT_SHA256=/'
  gate SUMMARY_CONTAINER "$(container_name "$summary") $(docker inspect -f '{{.Image}}' "$summary")"
  gate SUMMARY_COMPOSE_FILES "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$summary" | tr ',' '\n' | grep -c .)"
  gate READER_SERVICE "$reader_svc"
  gate READER_IMAGE "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")"
  gate ACTIVE_CADDY_SHA256 "$active"
  gate PREFLIGHT PASS
}

build() {
  require_source
  docker build --quiet -f "$SRC/services/article_intel_summary/Dockerfile" \
    --build-arg SOURCE_COMMIT="$APPROVED_SHA" -t "newsflux-summary:$APPROVED_SHA" "$SRC" >/dev/null
  docker build --quiet -f "$SRC/Dockerfile" \
    --build-arg SOURCE_COMMIT="$APPROVED_SHA" \
    --build-arg SOURCE_COMMIT_DATE="$(git -C "$SRC" show -s --format=%cI "$APPROVED_SHA")" \
    --build-arg VITE_BASE_PATH="$READER_BASE_PATH" \
    --build-arg VITE_ARTICLE_INTELLIGENCE_ENABLED="$READER_AI_ENABLED" \
    --build-arg VITE_CONTENT_FALLBACK_READER_BASE_PATH="$READER_RECOVERY_BASE_PATH" \
    --build-arg VITE_WALLHOP_EXTERNAL_OPEN_ENABLED="$READER_WALLHOP_EXTERNAL_OPEN" \
    -t "newsflux-reader:$APPROVED_SHA" "$SRC" >/dev/null
  local kind
  for kind in summary reader; do
    [[ "$(image_revision "newsflux-$kind:$APPROVED_SHA")" == "$APPROVED_SHA" ]] || die BUILD "${kind^^}_REVISION_LABEL_MISMATCH"
    gate "${kind^^}_IMAGE_ID" "$(image_id "newsflux-$kind:$APPROVED_SHA")"
  done
  candidate_start_gate
  gate BUILD PASS
}

# R12F-09: prove the candidate Summary image starts and serves /healthz as its own non-root user,
# isolated (no network, synthetic non-secret settings), BEFORE any production container is touched.
candidate_start_gate() {
  local image="newsflux-summary:$APPROVED_SHA" cid ok=0 i
  cid="$(docker run -d --network none \
    -e NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.invalid -e NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://newsflux.invalid \
    "$image")"
  for i in $(seq 1 30); do
    if docker exec "$cid" python -c "import json,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8788/healthz', timeout=2); assert json.load(r)['status']=='ok'" >/dev/null 2>&1; then ok=1; break; fi
    [[ "$(docker inspect -f '{{.State.Running}}' "$cid")" == true ]] || break
    sleep 1
  done
  if [[ "$ok" != 1 ]]; then
    gate CANDIDATE_START "FAIL status=$(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$cid")"
    # Sanitized log tail goes to a private file (best effort); never to the operator terminal.
    if ( umask 077; docker logs --tail 40 "$cid" 2>&1 \
      | sed -E 's#https?://[^ ]+#[URL]#g; s#(authorization|bearer|token|key|secret|password)[^ ]*#[REDACTED]#Ig' \
      >"$RELEASE_DIR/candidate-start-failure.log" ) 2>/dev/null; then
      gate FORENSIC_CAPTURE CAPTURED
    else
      gate FORENSIC_CAPTURE UNAVAILABLE
    fi
    docker rm -f "$cid" >/dev/null
    die BUILD CANDIDATE_DOES_NOT_START
  fi
  docker rm -f "$cid" >/dev/null
  gate CANDIDATE_START PASS
}

promote() { # service kind [extra plan args...]
  local service=$1 kind=$2 dir="$RELEASE_DIR/$1"; shift 2
  local image
  image="$(image_id "newsflux-$kind:$APPROVED_SHA")"
  # Protected = services outside this release. The Summary/Reader pair is released (and rolled back)
  # independently, so neither pins the other's container identity.
  mapfile -t prot < <(protected_args)
  [[ -f "$dir/manifest.json" ]] || release_tool plan --project "$PROJECT" --service "$service" \
    --candidate-image "$image" --approved-sha "$APPROVED_SHA" "${prot[@]}" --release-dir "$dir" "$@"
  release_tool promote --manifest "$dir/manifest.json" --timeout 180
}

sha_of() { sha256sum "$1" | cut -d' ' -f1; }
accepted_prior_caddy() { local h; for h in "${ACCEPTED_PRIOR_CADDY_SHAS[@]}"; do [[ "$1" == "$h" ]] && return 0; done; return 1; }
in_container_caddy_sha() { docker exec "$READER_CONTAINER" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1; }
caddy_reload() { docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; }
fault() { [[ -n "$REHEARSAL_FAULT" && "$REHEARSAL_FAULT" == "$1" ]]; }

# Caddy state transitions share the host release lock with release.py (same flock file), in a
# subshell so the lock is released before any later release.py call in the same process.
with_release_lock() { # gate function
  local gate_name=$1; shift
  (
    mkdir -p "$(dirname "$LOCK")"
    exec 9>>"$LOCK"
    flock -n 9 || die "$gate_name" RELEASE_LOCKED
    "$@"
  )
}

live_caddy() { # sets LIVE_CADDY to the bind-mounted host path of the Reader Caddyfile, or blocks
  LIVE_CADDY="$(caddy_source)"
  [[ -n "$LIVE_CADDY" ]] || die "$1" CADDYFILE_NOT_BIND_MOUNTED
  [[ ! -L "$LIVE_CADDY" ]] || die "$1" CADDYFILE_IS_SYMLINK
  [[ -f "$LIVE_CADDY" ]] || die "$1" CADDYFILE_NOT_REGULAR_FILE
}

restore_from_backup() { # caddy expected_sha -> restore bytes in place (same inode), reload, verify
  cat "$CADDY_STATE_DIR/before.Caddyfile" >"$1"
  [[ "$(sha_of "$1")" == "$2" ]] || return 1
  caddy_reload || return 1
  [[ "$(in_container_caddy_sha)" == "$2" ]]
}

# Stage 1 (or pre-Stage 1) -> this release's Caddyfile. Evidence lives in $RELEASE_DIR/caddy (0700):
#   before.Caddyfile (exact prior bytes, 0600), before.sha256, target.sha256, before.stat, transition.log
update_caddy_locked() {
  local caddy new active target inode
  live_caddy CADDY_UPDATE
  caddy="$LIVE_CADDY"
  new="$SRC/ops/deploy/article-intel-pilot/Caddyfile"
  active="$(sha_of "$caddy")"
  target="$(sha_of "$new")"
  if [[ "$active" == "$target" ]]; then
    if [[ -f "$CADDY_STATE_DIR/target.sha256" && "$(cat "$CADDY_STATE_DIR/target.sha256")" == "$target" ]]; then
      gate CADDY_UPDATE ALREADY_APPLIED_BY_THIS_RELEASE   # idempotent re-run
    else
      # This release does not change Caddy. Record the hash so rollback-caddy is a verified no-op.
      sha_of "$caddy" >"$RELEASE_DIR/caddy-unchanged.sha256"
      gate CADDY_UPDATE ALREADY_APPLIED
    fi
    [[ "$(in_container_caddy_sha)" == "$target" ]] || die CADDY_UPDATE READBACK_MISMATCH
    return
  fi
  accepted_prior_caddy "$active" || die CADDY_UPDATE ACTIVE_CADDY_DRIFT
  [[ "$(in_container_caddy_sha)" == "$active" ]] || die CADDY_UPDATE MOUNT_READBACK_MISMATCH
  # Validate the new file with the running Reader image, isolated, before anything is written.
  docker run --rm --network none -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP=127.0.0.1 -v "$new:/etc/caddy/Caddyfile:ro" \
    "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || die CADDY_UPDATE NEW_CADDYFILE_INVALID
  mkdir -p -m 0700 "$CADDY_STATE_DIR"
  chmod 0700 "$CADDY_STATE_DIR"
  if [[ -f "$CADDY_STATE_DIR/before.sha256" ]]; then
    # A previous attempt of this release kept a backup: it must be of the state we see now.
    [[ "$(cat "$CADDY_STATE_DIR/before.sha256")" == "$active" ]] || die CADDY_UPDATE BACKUP_OF_OTHER_STATE
    [[ "$(sha_of "$CADDY_STATE_DIR/before.Caddyfile")" == "$active" ]] || die CADDY_UPDATE BACKUP_CORRUPT
  else
    ( umask 077; cat "$caddy" >"$CADDY_STATE_DIR/before.Caddyfile" )
    [[ "$(sha_of "$CADDY_STATE_DIR/before.Caddyfile")" == "$active" ]] || die CADDY_UPDATE BACKUP_VERIFY_FAILED
    ( umask 077
      printf '%s\n' "$active" >"$CADDY_STATE_DIR/before.sha256"
      stat -c 'mode=%a uid=%u gid=%g inode=%i' "$caddy" >"$CADDY_STATE_DIR/before.stat" )
  fi
  ( umask 077; printf '%s\n' "$target" >"$CADDY_STATE_DIR/target.sha256" )
  inode="$(stat -c %i "$caddy")"
  fault caddy-before-write && die CADDY_UPDATE REHEARSAL_FAULT_BEFORE_WRITE
  # Single-file bind mount: rewrite in place so the container keeps seeing the same inode.
  if fault caddy-during-write; then
    head -c 64 "$new" >"$caddy"
    restore_from_backup "$caddy" "$active" || die CADDY_UPDATE WRITE_FAILED_RESTORE_UNVERIFIED
    die CADDY_UPDATE WRITE_FAILED_RESTORED
  fi
  if ! cat "$new" >"$caddy" || [[ "$(sha_of "$caddy")" != "$target" ]]; then
    restore_from_backup "$caddy" "$active" || die CADDY_UPDATE WRITE_FAILED_RESTORE_UNVERIFIED
    die CADDY_UPDATE WRITE_FAILED_RESTORED
  fi
  if fault caddy-reload || ! caddy_reload; then
    restore_from_backup "$caddy" "$active" || die CADDY_UPDATE RELOAD_FAILED_RESTORE_UNVERIFIED
    die CADDY_UPDATE RELOAD_FAILED_RESTORED
  fi
  [[ "$(stat -c %i "$caddy")" == "$inode" ]] || die CADDY_UPDATE INODE_CHANGED
  [[ "$(in_container_caddy_sha)" == "$target" ]] || die CADDY_UPDATE READBACK_MISMATCH
  ( umask 077; printf 'UPDATED from=%s to=%s\n' "$active" "$target" >>"$CADDY_STATE_DIR/transition.log" )
  gate CADDY_FROM_SHA256 "$active"
  gate ACTIVE_CADDY_SHA256 "$target"
  gate CADDY_UPDATE PASS
}

update_caddy() {
  require_source
  with_release_lock CADDY_UPDATE update_caddy_locked
}

rollback_caddy_locked() {
  local caddy unchanged="$RELEASE_DIR/caddy-unchanged.sha256" before target active inode
  live_caddy CADDY_ROLLBACK
  caddy="$LIVE_CADDY"
  active="$(sha_of "$caddy")"
  if [[ ! -f "$CADDY_STATE_DIR/before.sha256" ]]; then
    [[ -f "$unchanged" ]] || die CADDY_ROLLBACK BACKUP_MISSING
    # This release found the route already installed and changed nothing: nothing to restore, but
    # the active file must still be exactly what it found.
    [[ "$active" == "$(cat "$unchanged")" ]] || die CADDY_ROLLBACK DRIFT_SINCE_RELEASE
    gate CADDY_ROLLBACK NOT_APPLICABLE_UNCHANGED_BY_THIS_RELEASE
    return
  fi
  before="$(cat "$CADDY_STATE_DIR/before.sha256")"
  target="$(cat "$CADDY_STATE_DIR/target.sha256")"
  accepted_prior_caddy "$before" || die CADDY_ROLLBACK BACKUP_STATE_NOT_ACCEPTED
  [[ "$(sha_of "$CADDY_STATE_DIR/before.Caddyfile")" == "$before" ]] || die CADDY_ROLLBACK BACKUP_CORRUPT
  if [[ "$active" == "$before" ]]; then
    [[ "$(in_container_caddy_sha)" == "$before" ]] || die CADDY_ROLLBACK READBACK_MISMATCH
    gate CADDY_ROLLBACK ALREADY_RESTORED   # idempotent re-run
    return
  fi
  # Only the exact state this release installed may be replaced; anything else is a concurrent change.
  [[ "$active" == "$target" ]] || die CADDY_ROLLBACK DRIFT_SINCE_RELEASE
  inode="$(stat -c %i "$caddy")"
  restore_from_backup "$caddy" "$before" || die CADDY_ROLLBACK RESTORE_UNVERIFIED
  [[ "$(stat -c %i "$caddy")" == "$inode" ]] || die CADDY_ROLLBACK INODE_CHANGED
  ( umask 077; printf 'ROLLED_BACK from=%s to=%s\n' "$target" "$before" >>"$CADDY_STATE_DIR/transition.log" )
  gate ACTIVE_CADDY_SHA256 "$before"
  gate CADDY_ROLLBACK PASS
}

rollback_caddy() {
  with_release_lock CADDY_ROLLBACK rollback_caddy_locked
}

# Fail-closed public catalog check: the request must traverse NPM -> Caddy -> Summary API and be
# refused by the Summary API's own authentication (JSON, schema_version 1, exact code).
catalog_probe() { # expected_status expected_code [send_miniflux_header]
  local summary origin miniflux host body status resolve=()
  summary="$(summary_container)"
  origin="$(container_env "$summary" NEWSFLUX_AI_ALLOWED_WEB_ORIGINS | cut -d, -f1)"
  miniflux="$(container_env "$summary" NEWSFLUX_AI_MINIFLUX_BASE_URL)"
  host="${origin#https://}"; host="${host%%/*}"
  [[ "$origin" == https://* && -n "$host" ]] || die CATALOG_SMOKE PUBLIC_ORIGIN_UNKNOWN
  [[ -n "$PUBLIC_CURL_RESOLVE" ]] && resolve=(--resolve "$PUBLIC_CURL_RESOLVE")
  [[ -n "$PUBLIC_CURL_CACERT" ]] && resolve+=(--cacert "$PUBLIC_CURL_CACERT")
  local headers=(-H "Origin: $origin")
  [[ "${3:-}" == with-server ]] && headers+=(-H "X-NewsFlux-Miniflux-Server: $miniflux")
  body="$(mktemp)"
  status="$(curl -sS --noproxy '*' --max-time 15 "${resolve[@]}" -o "$body" -w '%{http_code}' "${headers[@]}" "$origin/api/ai/v1/models")" || { rm -f "$body"; die CATALOG_SMOKE CURL_FAILED; }
  [[ "$status" == "$1" ]] || { rm -f "$body"; die CATALOG_SMOKE "UNEXPECTED_STATUS_$status"; }
  python3 - "$body" "$2" <<'PY' || { rm -f "$body"; die CATALOG_SMOKE NOT_SUMMARY_API_RESPONSE; }
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if d.get("schema_version") == "1" and d.get("error", {}).get("code") == sys.argv[2] else 1)
PY
  rm -f "$body"
}

smoke() {
  require_source
  local summary reader_svc
  summary="$(summary_container)"
  reader_svc="$(reader_service)"
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$summary")" == healthy ]] || die SMOKE SUMMARY_NOT_HEALTHY
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$summary")")" == "$APPROVED_SHA" ]] || die SMOKE SUMMARY_REVISION
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")")" == "$APPROVED_SHA" ]] || die SMOKE READER_REVISION
  docker exec "$READER_CONTAINER" sh -c "wget -qO- http://127.0.0.1:$READER_PORT/ | grep -q 'id=.root.'" || die SMOKE READER_NOT_SERVING_APP
  docker exec "$READER_CONTAINER" wget -qO- http://summary-api:8788/healthz | grep -q '"ok"' || die SMOKE SUMMARY_UNREACHABLE_FROM_READER
  catalog_probe 401 UNAUTHENTICATED with-server
  catalog_probe 403 NOT_AUTHORIZED
  gate CATALOG_SMOKE PASS
  local name
  for name in "${PROTECTED_NAMES[@]}"; do
    docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die SMOKE "PROTECTED_${name}_DOWN"
  done
  {
    echo "APPROVED_SHA=$APPROVED_SHA"
    echo "SUMMARY=$(container_name "$summary") $(docker inspect -f '{{.Image}} {{.State.Health.Status}}' "$summary")"
    echo "READER=$READER_CONTAINER $(docker inspect -f '{{.Image}} {{.State.Status}}' "$READER_CONTAINER")"
    echo "ACTIVE_CADDY_SHA256=$(sha256sum "$(caddy_source)" | cut -d' ' -f1)"
    for name in "${PROTECTED_NAMES[@]}"; do echo "PROTECTED=$name $(docker inspect -f '{{.Id}} {{.Image}}' "$name")"; done
    echo "INFERENCE_ENABLED=$(container_env "$summary" NEWSFLUX_AI_INFERENCE_ENABLED)"
    echo "SUMMARY_MANIFEST_SHA256=$(sha256sum "$RELEASE_DIR/$SUMMARY_SERVICE/manifest.json" 2>/dev/null | cut -d' ' -f1)"
    echo "READER_MANIFEST_SHA256=$(sha256sum "$RELEASE_DIR/$reader_svc/manifest.json" 2>/dev/null | cut -d' ' -f1)"
  } >"$RELEASE_DIR/receipt.txt"
  cat "$RELEASE_DIR/receipt.txt"
  gate SMOKE PASS
  echo "NEXT=open NewsFlux over HTTPS > Settings > Reading > Article intelligence (catalog must list S5)."
}

S5_KEY_ATTESTATION="$RELEASE_DIR/s5-key-attestation.json"

s5_preflight() {
  # The attestation (written by s5_key_audit.py on the host with a read-only admin credential) goes in on
  # stdin; the admin credential itself never enters the Summary container.
  if [[ -f "$S5_KEY_ATTESTATION" && ! -L "$S5_KEY_ATTESTATION" ]]; then
    docker exec -i "$(summary_container)" python -m services.article_intel_summary.s5_preflight --attestation-stdin <"$S5_KEY_ATTESTATION"
  else
    docker exec "$(summary_container)" python -m services.article_intel_summary.s5_preflight
  fi
}

RELEASE_MODE="${RELEASE_MODE:-legacy}"
[[ "$RELEASE_MODE" == legacy || "$RELEASE_MODE" == d1 ]] || { echo "GATE=BLOCKED CODE=RELEASE_MODE_INVALID"; exit 1; }
D1_DIR="$RELEASE_DIR/d1-enable"
D1_EVIDENCE_TARGET=/run/newsflux-d1/evidence.json
D1_PREFLIGHT_ARGV=(python -B -m services.article_intel_summary.cost_authority preflight)
# The one-off candidate container gets no fixed address (candidate-run resets them), and the gateway path (NPM access
# list) may admit only the service's fixed addresses: there, only the gates that need no network run; the live gates
# (real catalog, callbacks) run in the promoted container, which rolls back automatically if they fail.
D1_CANDIDATE_ARGV=("${D1_PREFLIGHT_ARGV[@]}" --offline)

d1_inputs() {
  [[ "$RELEASE_MODE" == d1 ]] || die D1 RELEASE_MODE_NOT_D1
  [[ "${D1_COST_AUTHORITY:-}" == gateway_budget_enforced || "${D1_COST_AUTHORITY:-}" == explicit_unlimited ]] || die D1 DECLARATION_MISSING
  [[ "${D1_EVIDENCE_SHA256:-}" =~ ^[0-9a-f]{64}$ ]] || die D1 EVIDENCE_DIGEST_NOT_PINNED
  [[ "${D1_EXTERNAL_TRANSFER_CONSENT:-}" == GRANTED ]] || die D1 EXTERNAL_TRANSFER_CONSENT_MISSING
  local src="${D1_EVIDENCE_FILE:-}"
  [[ "$src" == /* && -f "$src" && ! -L "$src" ]] || die D1 EVIDENCE_FILE_INVALID
  [[ "$(stat -c '%u %a' "$src")" == "0 644" ]] || die D1 EVIDENCE_FILE_NOT_ROOT_0644
  [[ "$(sha_of "$src")" == "$D1_EVIDENCE_SHA256" ]] || die D1 EVIDENCE_DIGEST_MISMATCH
  if [[ "$D1_COST_AUTHORITY" == explicit_unlimited ]]; then
    # The embedded owner decision must be the file at the pinned commit of the homeserver ledger's main line.
    [[ -d "${D1_OWNER_LEDGER_REPO:-}/.git" ]] || die D1 OWNER_LEDGER_REPO_MISSING
    python3 -I -B - "$SRC/services/article_intel_summary" "$src" "$D1_OWNER_LEDGER_REPO" <<'PY' || die D1 OWNER_DECISION_NOT_IN_LEDGER
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("d1_evidence", sys.argv[1] + "/d1_evidence.py")
lib = importlib.util.module_from_spec(spec); spec.loader.exec_module(lib)
document = json.load(open(sys.argv[2], encoding="utf-8"))
problem = lib.verify_owner_decision_in_ledger(document.get("owner_decision") or {}, sys.argv[3])
print(f"D1_OWNER_DECISION_LEDGER={problem or 'PASS'}")
sys.exit(1 if problem else 0)
PY
  fi
}

# Release-owned copy of the pinned evidence (root, 0644, in the root-only release dir) and the D1 override:
# LiteLLM governs models and cost, NewsFlux money controls are blanked, consent and every non-financial gate stay.
d1_prepare() {
  local evidence="$D1_DIR/evidence.json" policy="$RELEASE_DIR/d1-enable.policy.json"
  mkdir -p "$D1_DIR"
  if [[ ! -f "$evidence" ]]; then
    install -m 0644 -o 0 -g 0 "$D1_EVIDENCE_FILE" "$evidence"
  fi
  [[ "$(sha_of "$evidence")" == "$D1_EVIDENCE_SHA256" ]] || die D1 RELEASE_EVIDENCE_COPY_DRIFT
  if [[ ! -f "$policy" ]]; then
    # Local NewsFlux limits for D1 (inference safety, not cost: LiteLLM governs cost). The input estimate is
    # conservative (1 token per UTF-8 byte, prompt framing ~2.7k), so the legacy 2048 refused every article.
    local lim
    for lim in "${D1_MAX_INPUT_TOKENS:=32000}" "${D1_MAX_OUTPUT_TOKENS:=1024}" "${D1_MAX_REQUESTS_PER_MINUTE:=10}" \
               "${D1_MAX_TOKENS_PER_MINUTE:=100000}" "${D1_INFERENCE_TIMEOUT_SECONDS:=30}"; do
      [[ "$lim" =~ ^[1-9][0-9]{0,6}$ ]] || die D1 LIMIT_INVALID
    done
    python3 -I -B - "$SUMMARY_SERVICE" "$evidence" "$D1_EVIDENCE_TARGET" "$D1_COST_AUTHORITY" "$D1_EVIDENCE_SHA256" \
      "$D1_MAX_INPUT_TOKENS" "$D1_MAX_OUTPUT_TOKENS" "$D1_MAX_REQUESTS_PER_MINUTE" "$D1_MAX_TOKENS_PER_MINUTE" \
      "$D1_INFERENCE_TIMEOUT_SECONDS" >"$policy" <<'PY'
import json, sys
service, source, target, declaration, digest, max_in, max_out, rpm, tpm, timeout = sys.argv[1:]
environment = {
    "NEWSFLUX_AI_INFERENCE_ENABLED": "true",
    "NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER": "true",
    "NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED": "true",
    "NEWSFLUX_AI_MODEL_AUTHORITY": "litellm_key",
    "NEWSFLUX_AI_LITELLM_COST_AUTHORITY": declaration,
    "NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_FILE": target,
    "NEWSFLUX_AI_LITELLM_COST_AUTHORITY_EVIDENCE_SHA256": digest,
    "NEWSFLUX_AI_ALLOW_PAID_INFERENCE": "false",
    "NEWSFLUX_AI_MAX_INPUT_TOKENS": max_in,
    "NEWSFLUX_AI_MAX_OUTPUT_TOKENS": max_out,
    "NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE": rpm,
    "NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE": tpm,
    "NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS": timeout,
}
# No duplicated cost control: NewsFlux budget and prices are blanked (LiteLLM is the cost authority).
for name in ("NEWSFLUX_AI_MONTHLY_BUDGET_USD", "NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION",
             "NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION", "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_INPUT_USD_PER_MILLION",
             "NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_OUTPUT_USD_PER_MILLION"):
    environment[name] = ""
print(json.dumps({"services": {service: {"environment": environment, "volumes": [
    {"type": "bind", "source": source, "target": target, "read_only": True}]}}}, indent=2, sort_keys=True))
PY
    chmod 0444 "$policy"
  fi
  if [[ ! -f "$D1_DIR/manifest.json" ]]; then
    local summary
    summary="$(summary_container)"
    [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$summary")")" == "$APPROVED_SHA" ]] || die D1 SUMMARY_NOT_ON_APPROVED_SHA
    mapfile -t prot < <(protected_args)
    release_tool plan --project "$PROJECT" --service "$SUMMARY_SERVICE" \
      --candidate-image "$(docker inspect -f '{{.Image}}' "$summary")" --approved-sha "$APPROVED_SHA" "${prot[@]}" \
      --release-dir "$D1_DIR" --extra-override "$policy" --mount-added "$evidence:$D1_EVIDENCE_TARGET" >/dev/null \
      || die D1 PLAN_FAILED
  fi
}

# The D1 preflight runs in a one-off container of the TARGET configuration (override env + read-only evidence
# mount, candidate image), never in the running dark container: NOT_APPLICABLE there is not an admission.
d1_preflight() {
  require_source
  d1_inputs
  d1_prepare
  local out
  out="$(release_tool candidate-run --manifest "$D1_DIR/manifest.json" -- "${D1_CANDIDATE_ARGV[@]}")" || true
  printf '%s\n' "$out"
  grep -qx 'D1_PREFLIGHT=PASS_OFFLINE_ONLY' <<<"$out" || die D1_PREFLIGHT TARGET_CONFIGURATION_NOT_PASS
  gate D1_TARGET_PREFLIGHT PASS_OFFLINE_GATES
}

enable_d1() {
  d1_preflight
  release_tool promote --manifest "$D1_DIR/manifest.json" --timeout 180
  # Live re-check in the promoted container: same evidence, real catalog, live callbacks.
  local out
  out="$(docker exec "$(summary_container)" "${D1_PREFLIGHT_ARGV[@]}")" || true
  printf '%s\n' "$out" | sed 's/^/LIVE_/'
  if ! grep -qx 'D1_PREFLIGHT=PASS' <<<"$out"; then
    release_tool rollback --manifest "$D1_DIR/manifest.json" --timeout 180
    die ENABLE_D1 LIVE_RECHECK_FAILED_ROLLED_BACK
  fi
  gate D1_ENABLED PASS
  echo "NEXT=in the Reader: Settings lists the key's models; summarize one public article once."
}

enable_s5() {
  require_source
  [[ "$RELEASE_MODE" == d1 ]] && { enable_d1; return; }
  s5_preflight || die ENABLE_S5 S5_PREFLIGHT_NOT_PASS
  local summary policy dir="$RELEASE_DIR/s5-enable"
  summary="$(summary_container)"
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$summary")")" == "$APPROVED_SHA" ]] || die ENABLE_S5 SUMMARY_NOT_ON_APPROVED_SHA
  policy="$RELEASE_DIR/s5-enable.policy.json"
  if [[ ! -f "$policy" ]]; then
    cat >"$policy" <<JSON
{"services":{"$SUMMARY_SERVICE":{"environment":{"NEWSFLUX_AI_INFERENCE_ENABLED":"true","NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER":"true","NEWSFLUX_AI_LITELLM_MODEL_CHOICE":"s5-free","NEWSFLUX_AI_ALLOW_PAID_INFERENCE":"false","NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK":"false","NEWSFLUX_AI_MODEL_DISCOVERY_ENABLED":"true"}}}}
JSON
    chmod 0444 "$policy"
  fi
  mapfile -t prot < <(protected_args)
  [[ -f "$dir/manifest.json" ]] || release_tool plan --project "$PROJECT" --service "$SUMMARY_SERVICE" \
    --candidate-image "$(docker inspect -f '{{.Image}}' "$summary")" --approved-sha "$APPROVED_SHA" "${prot[@]}" \
    --release-dir "$dir" --extra-override "$policy"
  release_tool promote --manifest "$dir/manifest.json" --timeout 180
  catalog_probe 401 UNAUTHENTICATED with-server
  gate S5_ENABLED PASS
  echo "NEXT=in the Reader: Settings shows S5 available; open one public article and click 'Summarize with AI' once."
}

case "${1:-}" in
  prepare) prepare ;;
  preflight) preflight ;;
  build) build ;;
  promote-summary) require_source; promote "$SUMMARY_SERVICE" summary ;;
  update-caddy) update_caddy ;;
  promote-reader) require_source; promote "$(reader_service)" reader --ready-probe "$READER_PROBE" ;;
  smoke) smoke ;;
  s5-attestation-path) require_source; echo "$S5_KEY_ATTESTATION" ;;
  s5-preflight) s5_preflight ;;
  d1-preflight) d1_preflight ;;
  enable-s5) enable_s5 ;;
  disable-s5) require_source
    if [[ "$RELEASE_MODE" == d1 ]]; then release_tool rollback --manifest "$D1_DIR/manifest.json"
    else release_tool rollback --manifest "$RELEASE_DIR/s5-enable/manifest.json"; fi ;;
  rollback-summary) require_source; release_tool rollback --manifest "$RELEASE_DIR/$SUMMARY_SERVICE/manifest.json" ;;
  rollback-reader) require_source; release_tool rollback --manifest "$RELEASE_DIR/$(reader_service)/manifest.json" ;;
  rollback-caddy) rollback_caddy ;;
  all)
    prepare; preflight; build
    promote "$SUMMARY_SERVICE" summary || { gate ALL "STOPPED_AT_PROMOTE_SUMMARY"; exit 1; }
    update_caddy
    promote "$(reader_service)" reader --ready-probe "$READER_PROBE" || { gate ALL "STOPPED_AT_PROMOTE_READER"; exit 1; }
    smoke ;;
  *) sed -n '2,/^# Scope:/p' "$0" | sed '$d'; exit 2 ;;
esac
