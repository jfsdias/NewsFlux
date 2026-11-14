#!/usr/bin/env bash
# NewsFlux AI functional release — single operator procedure for the OMV host.
#
#   export APPROVED_SHA=<40-hex commit on main>
#   sudo -E bash ai-functional-release.sh prepare          # creates the release dir + exact source (no Docker change)
#   sudo -E bash ai-functional-release.sh preflight        # strictly read-only: writes nothing, changes nothing
#   sudo -E bash ai-functional-release.sh build            # exact-SHA images, revision labels verified
#   sudo -E bash ai-functional-release.sh promote-summary  # new Summary image, inference still disabled
#   sudo -E bash ai-functional-release.sh update-caddy     # adds the GET-only catalog route (in-place, validated)
#   sudo -E bash ai-functional-release.sh promote-reader   # new Reader image, readiness proven by HTTP probe
#   sudo -E bash ai-functional-release.sh smoke            # fail-closed production checks + receipt
#   sudo -E bash ai-functional-release.sh s5-preflight     # read-only LiteLLM key/model/price/budget/logging gates
#   sudo -E bash ai-functional-release.sh enable-s5        # only after s5-preflight PASS (re-run internally)
#   sudo -E bash ai-functional-release.sh all              # prepare..smoke, stops at the first failed gate
#   rollbacks: disable-s5 | rollback-reader | rollback-caddy | rollback-summary
#
# Scope: only `summary-api` and the Reader service are recreated, via release.py (exact image ID,
# drift checks, host lock, readiness, automatic rollback). Miniflux, miniflux-db, NPM, LiteLLM and the
# content-fallback sidecar are never touched. Output is gate names, identifiers and hashes only.
set -Eeuo pipefail
umask 077

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
EXPECTED_ACTIVE_CADDY_SHA="${EXPECTED_ACTIVE_CADDY_SHA:-6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108}"
READER_PORT="${NEWSFLUX_READER_PORT:-2000}"
# Reader build flags. WallHop recovery stays hidden until its sidecar route passes its own gates.
READER_BASE_PATH="${READER_BASE_PATH:-/}"
READER_AI_ENABLED="${READER_AI_ENABLED:-1}"
READER_RECOVERY_BASE_PATH="${READER_RECOVERY_BASE_PATH:-}"
PUBLIC_CURL_RESOLVE="${NEWSFLUX_PUBLIC_CURL_RESOLVE:-}" # optional "host:443:ip" when hairpin DNS is unavailable
PUBLIC_CURL_CACERT="${NEWSFLUX_PUBLIC_CURL_CACERT:-}"   # optional CA bundle (disposable rehearsal only)

gate() { printf '%s=%s\n' "$1" "$2"; }
die() { gate "$1" BLOCKED; echo "CODE=$2"; exit 1; }
release_tool() { python3 "$SRC/deploy/release-governance/release.py" --policy "$SRC/deploy/release-governance/policy.json" --lock "$LOCK" "$@"; }
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
  [[ -d "$SRC/.git" ]] || git clone --quiet "${filter[@]}" --no-checkout "$REPO_URL" "$SRC"
  git -C "$SRC" fetch --quiet origin main
  git -C "$SRC" merge-base --is-ancestor "$APPROVED_SHA" origin/main || die SOURCE_GATE APPROVED_SHA_NOT_ON_MAIN
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet --force "$APPROVED_SHA"
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
  python3 - "$SRC/deploy/release-governance/policy.json" "$PROJECT" "$reader_svc" "$SUMMARY_SERVICE" <<'PY' || die PREFLIGHT SERVICE_NOT_IN_POLICY
import json, sys
allowed = {(i["project"], i["service"]) for i in json.load(open(sys.argv[1]))["allowed"]}
sys.exit(0 if {(sys.argv[2], sys.argv[3]), (sys.argv[2], sys.argv[4])} <= allowed else 1)
PY
  docker exec "$READER_CONTAINER" sh -c "wget -qO- http://127.0.0.1:$READER_PORT/ | grep -q 'id=.root.'" || die PREFLIGHT READER_PROBE_FAILS_ON_CURRENT
  caddy="$(caddy_source)"
  [[ -n "$caddy" && -f "$caddy" ]] || die PREFLIGHT CADDYFILE_NOT_BIND_MOUNTED
  active="$(sha256sum "$caddy" | cut -d' ' -f1)"
  [[ "$active" == "$EXPECTED_ACTIVE_CADDY_SHA" || "$active" == "$(sha256sum "$SRC/deploy/article-intel-pilot/Caddyfile" | cut -d' ' -f1)" ]] || die PREFLIGHT ACTIVE_CADDY_DRIFT
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
    -t "newsflux-reader:$APPROVED_SHA" "$SRC" >/dev/null
  local kind
  for kind in summary reader; do
    [[ "$(image_revision "newsflux-$kind:$APPROVED_SHA")" == "$APPROVED_SHA" ]] || die BUILD "${kind^^}_REVISION_LABEL_MISMATCH"
    gate "${kind^^}_IMAGE_ID" "$(image_id "newsflux-$kind:$APPROVED_SHA")"
  done
  gate BUILD PASS
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

update_caddy() {
  require_source
  local caddy new backup
  caddy="$(caddy_source)"
  new="$SRC/deploy/article-intel-pilot/Caddyfile"
  backup="$RELEASE_DIR/Caddyfile.before-$EXPECTED_ACTIVE_CADDY_SHA"
  if [[ "$(sha256sum "$caddy" | cut -d' ' -f1)" == "$(sha256sum "$new" | cut -d' ' -f1)" ]]; then gate CADDY_UPDATE ALREADY_APPLIED; return; fi
  [[ "$(sha256sum "$caddy" | cut -d' ' -f1)" == "$EXPECTED_ACTIVE_CADDY_SHA" ]] || die CADDY_UPDATE ACTIVE_CADDY_DRIFT
  docker run --rm --network none -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP=127.0.0.1 -v "$new:/etc/caddy/Caddyfile:ro" \
    "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || die CADDY_UPDATE NEW_CADDYFILE_INVALID
  cp -p "$caddy" "$backup"
  cat "$new" >"$caddy" # single-file bind mount: keep the inode
  if ! docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    cat "$backup" >"$caddy"
    docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
    die CADDY_UPDATE RELOAD_FAILED_RESTORED
  fi
  gate ACTIVE_CADDY_SHA256 "$(docker exec "$READER_CONTAINER" sha256sum /etc/caddy/Caddyfile | cut -d' ' -f1)"
  gate CADDY_UPDATE PASS
}

rollback_caddy() {
  local caddy backup="$RELEASE_DIR/Caddyfile.before-$EXPECTED_ACTIVE_CADDY_SHA"
  caddy="$(caddy_source)"
  [[ -f "$backup" ]] || die CADDY_ROLLBACK BACKUP_MISSING
  cat "$backup" >"$caddy"
  docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die CADDY_ROLLBACK RELOAD_FAILED
  [[ "$(sha256sum "$caddy" | cut -d' ' -f1)" == "$EXPECTED_ACTIVE_CADDY_SHA" ]] || die CADDY_ROLLBACK HASH_MISMATCH
  gate CADDY_ROLLBACK PASS
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

s5_preflight() {
  docker exec "$(summary_container)" python -m services.article_intel_summary.s5_preflight
}

enable_s5() {
  require_source
  s5_preflight || die ENABLE_S5 S5_PREFLIGHT_NOT_PASS
  local summary policy dir="$RELEASE_DIR/s5-enable"
  summary="$(summary_container)"
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$summary")")" == "$APPROVED_SHA" ]] || die ENABLE_S5 SUMMARY_NOT_ON_APPROVED_SHA
  policy="$RELEASE_DIR/s5-enable.policy.json"
  if [[ ! -f "$policy" ]]; then
    cat >"$policy" <<JSON
{"services":{"$SUMMARY_SERVICE":{"environment":{"NEWSFLUX_AI_INFERENCE_ENABLED":"true","NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER":"true","NEWSFLUX_AI_LITELLM_MODEL_CHOICE":"s5-free","NEWSFLUX_AI_ALLOW_PAID_INFERENCE":"false","NEWSFLUX_AI_ENABLE_S5_MISTRAL_FALLBACK":"false"}}}}
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
  s5-preflight) s5_preflight ;;
  enable-s5) enable_s5 ;;
  disable-s5) require_source; release_tool rollback --manifest "$RELEASE_DIR/s5-enable/manifest.json" ;;
  rollback-summary) require_source; release_tool rollback --manifest "$RELEASE_DIR/$SUMMARY_SERVICE/manifest.json" ;;
  rollback-reader) require_source; release_tool rollback --manifest "$RELEASE_DIR/$(reader_service)/manifest.json" ;;
  rollback-caddy) rollback_caddy ;;
  all)
    prepare; preflight; build
    promote "$SUMMARY_SERVICE" summary || { gate ALL "STOPPED_AT_PROMOTE_SUMMARY"; exit 1; }
    update_caddy
    promote "$(reader_service)" reader --ready-probe "$READER_PROBE" || { gate ALL "STOPPED_AT_PROMOTE_READER"; exit 1; }
    smoke ;;
  *) sed -n '2,18p' "$0"; exit 2 ;;
esac
