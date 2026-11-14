#!/usr/bin/env bash
# NewsFlux AI functional release — single operator script for the OMV host.
#
#   sudo APPROVED_SHA=<40-hex merged main SHA> bash ai-functional-release.sh preflight
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh build
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh promote-summary
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh update-caddy
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh promote-reader
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh smoke
#   sudo APPROVED_SHA=<sha> bash ai-functional-release.sh rollback-reader|rollback-caddy|rollback-summary
#
# Each step is independently safe in this order: the new Summary API still serves
# contract v1 for the current Reader; the Caddy change only adds a GET route; the
# new Reader needs both. Only `summary-api` and the Reader service are recreated,
# via release.py (exact image ID, drift checks, lock, automatic rollback). Miniflux,
# miniflux-db, NPM, LiteLLM and the content-fallback sidecar are never touched.
# The script prints identifiers, hashes and gate names only — never secrets,
# environment values or file contents.
set -Eeuo pipefail
umask 077

: "${APPROVED_SHA:?APPROVED_SHA (40-hex merged commit) is required}"
[[ "$APPROVED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "GATE=BLOCKED CODE=APPROVED_SHA_INVALID"; exit 1; }
PROJECT="${NEWSFLUX_PROJECT:-newsflux}"
SUMMARY_SERVICE="${NEWSFLUX_SUMMARY_SERVICE:-summary-api}"
READER_CONTAINER="${NEWSFLUX_READER_CONTAINER:-newsflux}"
REPO_URL="${NEWSFLUX_REPO_URL:-https://github.com/jfsdias/NewsFlux.git}"
RELEASE_ROOT="${NEWSFLUX_RELEASE_ROOT:-/dockerdata/compose/newsflux/.releases}"
RELEASE_ID="ai-functional-${APPROVED_SHA:0:12}"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_ID"
SRC="$RELEASE_DIR/source"
EXPECTED_ACTIVE_CADDY_SHA="${EXPECTED_ACTIVE_CADDY_SHA:-6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108}"
# Reader build flags. WallHop recovery stays hidden until its sidecar route is deployed.
READER_BASE_PATH="${READER_BASE_PATH:-/}"
READER_AI_ENABLED="${READER_AI_ENABLED:-1}"
READER_RECOVERY_BASE_PATH="${READER_RECOVERY_BASE_PATH:-}"
PROTECTED=(--protected miniflux --protected miniflux-db)

gate() { printf '%s=%s\n' "$1" "$2"; }
die() { gate "$1" "BLOCKED"; echo "CODE=$2"; exit 1; }
release_tool() { python3 "$SRC/deploy/release-governance/release.py" --policy "$SRC/deploy/release-governance/policy.json" "$@"; }
summary_container() { docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SUMMARY_SERVICE"; }
reader_service() { docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$READER_CONTAINER"; }
caddy_source() {
  docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$READER_CONTAINER"
}

fetch_source() {
  mkdir -p "$RELEASE_DIR"
  if [[ ! -d "$SRC/.git" ]]; then
    git clone --quiet --filter=blob:none --no-checkout "$REPO_URL" "$SRC"
  fi
  git -C "$SRC" fetch --quiet origin main
  git -C "$SRC" merge-base --is-ancestor "$APPROVED_SHA" origin/main || die SOURCE_GATE APPROVED_SHA_NOT_ON_MAIN
  git -C "$SRC" -c advice.detachedHead=false checkout --quiet --force "$APPROVED_SHA"
  [[ "$(git -C "$SRC" rev-parse HEAD)" == "$APPROVED_SHA" ]] || die SOURCE_GATE HEAD_MISMATCH
  [[ -z "$(git -C "$SRC" status --porcelain)" ]] || die SOURCE_GATE DIRTY_SOURCE
  gate SOURCE_GATE PASS
}

image_id() { docker image inspect -f '{{.Id}}' "$1"; }
image_revision() { docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1"; }

preflight() {
  fetch_source
  local summary reader_svc caddy
  summary="$(summary_container)"
  [[ -n "$summary" && "$(wc -l <<<"$summary")" -eq 1 ]] || die PREFLIGHT SUMMARY_CONTAINER_NOT_UNIQUE
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$summary")" == healthy ]] || die PREFLIGHT SUMMARY_NOT_HEALTHY
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$summary")" == 0 ]] || die PREFLIGHT SUMMARY_PUBLISHES_PORT
  reader_svc="$(reader_service)"
  [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$READER_CONTAINER")" == "$PROJECT" ]] || die PREFLIGHT READER_PROJECT_MISMATCH
  grep -q "\"service\": \"$reader_svc\"" "$SRC/deploy/release-governance/policy.json" || die PREFLIGHT READER_SERVICE_NOT_IN_POLICY
  caddy="$(caddy_source)"
  [[ -n "$caddy" && -f "$caddy" ]] || die PREFLIGHT CADDYFILE_NOT_BIND_MOUNTED
  local active
  active="$(sha256sum "$caddy" | cut -d' ' -f1)"
  if [[ "$active" != "$EXPECTED_ACTIVE_CADDY_SHA" && "$active" != "$(sha256sum "$SRC/deploy/article-intel-pilot/Caddyfile" | cut -d' ' -f1)" ]]; then
    die PREFLIGHT ACTIVE_CADDY_DRIFT
  fi
  for name in miniflux miniflux-db; do
    docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die PREFLIGHT "PROTECTED_${name}_NOT_RUNNING"
  done
  release_tool --lock "$RELEASE_DIR/preflight.lock" inspect --project "$PROJECT" >"$RELEASE_DIR/inspect-before.json"
  sha256sum "$RELEASE_DIR/inspect-before.json" | cut -d' ' -f1 | sed 's/^/INSPECT_BEFORE_SHA256=/'
  gate SUMMARY_CONTAINER "$(docker inspect -f '{{.Name}} {{.Image}}' "$summary")"
  gate READER_SERVICE "$reader_svc"
  gate READER_IMAGE "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")"
  gate ACTIVE_CADDY_SHA256 "$active"
  gate PREFLIGHT PASS
}

build() {
  fetch_source
  docker build --quiet -f "$SRC/services/article_intel_summary/Dockerfile" \
    --build-arg SOURCE_COMMIT="$APPROVED_SHA" -t "newsflux-summary:$APPROVED_SHA" "$SRC" >/dev/null
  docker build --quiet -f "$SRC/Dockerfile" \
    --build-arg SOURCE_COMMIT="$APPROVED_SHA" \
    --build-arg SOURCE_COMMIT_DATE="$(git -C "$SRC" show -s --format=%cI "$APPROVED_SHA")" \
    --build-arg VITE_BASE_PATH="$READER_BASE_PATH" \
    --build-arg VITE_ARTICLE_INTELLIGENCE_ENABLED="$READER_AI_ENABLED" \
    --build-arg VITE_CONTENT_FALLBACK_READER_BASE_PATH="$READER_RECOVERY_BASE_PATH" \
    -t "newsflux-reader:$APPROVED_SHA" "$SRC" >/dev/null
  for kind in summary reader; do
    [[ "$(image_revision "newsflux-$kind:$APPROVED_SHA")" == "$APPROVED_SHA" ]] || die BUILD "${kind^^}_REVISION_LABEL_MISMATCH"
    gate "${kind^^}_IMAGE_ID" "$(image_id "newsflux-$kind:$APPROVED_SHA")"
  done
  gate BUILD PASS
}

plan_and_promote() {
  local service=$1 kind=$2 dir="$RELEASE_DIR/$1" image
  image="$(image_id "newsflux-$kind:$APPROVED_SHA")"
  local protected=("${PROTECTED[@]}")
  if [[ "$kind" == summary ]]; then protected+=(--protected "$READER_CONTAINER"); else protected+=(--protected "$(docker inspect -f '{{.Name}}' "$(summary_container)" | sed 's#^/##')"); fi
  if [[ ! -f "$dir/manifest.json" ]]; then
    release_tool --lock /run/lock/newsflux-release.lock plan --project "$PROJECT" --service "$service" \
      --candidate-image "$image" --approved-sha "$APPROVED_SHA" "${protected[@]}" --release-dir "$dir"
  fi
  release_tool --lock /run/lock/newsflux-release.lock promote --manifest "$dir/manifest.json" --timeout 180
}

update_caddy() {
  fetch_source
  local caddy new backup
  caddy="$(caddy_source)"
  new="$SRC/deploy/article-intel-pilot/Caddyfile"
  backup="$RELEASE_DIR/Caddyfile.before-$EXPECTED_ACTIVE_CADDY_SHA"
  [[ "$(sha256sum "$caddy" | cut -d' ' -f1)" == "$EXPECTED_ACTIVE_CADDY_SHA" ]] || die CADDY_UPDATE ACTIVE_CADDY_DRIFT
  docker run --rm --network none -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP=127.0.0.1 -v "$new:/etc/caddy/Caddyfile:ro" \
    "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || die CADDY_UPDATE NEW_CADDYFILE_INVALID
  cp -p "$caddy" "$backup"
  # Single-file bind mount: rewrite in place so the container keeps the same inode.
  cat "$new" >"$caddy"
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

smoke() {
  local summary
  summary="$(summary_container)"
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$summary")" == healthy ]] || die SMOKE SUMMARY_NOT_HEALTHY
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$summary")")" == "$APPROVED_SHA" ]] || die SMOKE SUMMARY_REVISION
  [[ "$(image_revision "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")")" == "$APPROVED_SHA" ]] || die SMOKE READER_REVISION
  docker exec "$READER_CONTAINER" wget -qO- http://summary-api:8788/healthz | grep -q '"ok"' || die SMOKE SUMMARY_UNREACHABLE_FROM_READER
  docker exec "$READER_CONTAINER" wget -qO /dev/null http://127.0.0.1:2000/ || die SMOKE READER_HTTP
  # Unauthenticated catalog must be refused (never 200) — proves the route exists and is protected.
  code="$(docker exec "$READER_CONTAINER" wget -S -qO /dev/null http://summary-api:8788/api/ai/v1/models 2>&1 | awk '/HTTP\//{print $2; exit}' || true)"
  [[ "$code" != 200 ]] || die SMOKE CATALOG_NOT_AUTHENTICATED
  for name in miniflux miniflux-db; do
    docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die SMOKE "PROTECTED_${name}_DOWN"
  done
  release_tool --lock "$RELEASE_DIR/preflight.lock" inspect --project "$PROJECT" >"$RELEASE_DIR/inspect-after.json"
  gate SMOKE PASS
  echo "NEXT=open NewsFlux over HTTPS, Settings > Reading > Article intelligence, then 'Summarize with AI' on one article (one explicit click)."
}

case "${1:-}" in
  preflight) preflight ;;
  build) build ;;
  promote-summary) fetch_source; plan_and_promote "$SUMMARY_SERVICE" summary ;;
  update-caddy) update_caddy ;;
  promote-reader) fetch_source; plan_and_promote "$(reader_service)" reader ;;
  smoke) smoke ;;
  rollback-summary) release_tool rollback --manifest "$RELEASE_DIR/$SUMMARY_SERVICE/manifest.json" ;;
  rollback-reader) release_tool rollback --manifest "$RELEASE_DIR/$(reader_service)/manifest.json" ;;
  rollback-caddy) rollback_caddy ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
