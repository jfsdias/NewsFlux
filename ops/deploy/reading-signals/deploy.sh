#!/usr/bin/env bash
# NF-E08 reading-signals sidecar (ADR 0002): owner-run apply / rollback / status on the OMV.
#
#   sudo -E APPROVED_SHA=<40-hex> \
#     READING_SIGNALS_READER_NETWORK=<private network shared by the Reader Caddy and the Summary API> \
#     READING_SIGNALS_EGRESS_NETWORK=<network the Summary API uses to reach Miniflux> \
#     READING_SIGNALS_MINIFLUX_BASE_URL=https://<miniflux host> \
#     READING_SIGNALS_ALLOWED_WEB_ORIGINS=https://<newsflux host> \
#     bash deploy.sh apply | rollback | status
#
# apply: clone the approved commit, build the sidecar image from it, take the one trusted proxy IP from the
# Reader's fixed address on the private network, write a 0600 env file, start the "reading-signals" profile
# and wait until the container is healthy. Nothing else on the host changes; the Caddy route ships with
# ai-functional-release.sh update-caddy.
# rollback: stop and remove the sidecar container. The data volume is kept; deleting it is a separate,
# explicit `docker volume rm newsflux-reading-signals_reading_signals_data`.
set -euo pipefail
umask 077

STATE_ROOT="${READING_SIGNALS_STATE_ROOT:-/dockerdata/compose/newsflux-reading-signals}"
REPO_URL="${NEWSFLUX_REPO_URL:-https://github.com/jfsdias/NewsFlux.git}"
READER_CONTAINER="${NEWSFLUX_READER_CONTAINER:-newsflux}"
HEALTH_TIMEOUT="${READING_SIGNALS_HEALTH_TIMEOUT:-90}"
PROJECT=newsflux-reading-signals
CONTAINER=newsflux-reading-signals
COMMAND="${1:-}"

die() { echo "GATE=BLOCKED STEP=$1 CODE=$2"; exit 1; }
gate() { echo "$1=$2"; }

[[ "$COMMAND" =~ ^(apply|rollback|status)$ ]] || die USAGE COMMAND_REQUIRED
if [[ "$COMMAND" == status ]]; then
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker inspect -f 'STATE={{.State.Status}} HEALTH={{if .State.Health}}{{.State.Health.Status}}{{end}} IMAGE={{.Image}} REVISION={{index .Config.Labels "org.opencontainers.image.revision"}}' "$CONTAINER"
  else
    echo "STATE=absent"
  fi
  exit 0
fi

APPROVED_SHA="${APPROVED_SHA:-}"
[[ "$APPROVED_SHA" =~ ^[0-9a-f]{40}$ ]] || die PREFLIGHT APPROVED_SHA_INVALID
RELEASE_DIR="$STATE_ROOT/${APPROVED_SHA:0:12}"
SRC="$RELEASE_DIR/source"
ENV_FILE="$RELEASE_DIR/reading-signals.env"
compose() {
  docker compose -p "$PROJECT" -f "$SRC/ops/deploy/reading-signals/compose.yaml" \
    --env-file "$ENV_FILE" --profile reading-signals "$@"
}

if [[ "$COMMAND" == rollback ]]; then
  [[ -f "$ENV_FILE" && -d "$SRC" ]] || die ROLLBACK RELEASE_NOT_APPLIED
  compose down --remove-orphans >/dev/null || die ROLLBACK COMPOSE_DOWN_FAILED
  docker inspect "$CONTAINER" >/dev/null 2>&1 && die ROLLBACK CONTAINER_STILL_PRESENT
  gate ROLLBACK PASS
  gate DATA_VOLUME KEPT
  exit 0
fi

# --- apply: validate every input before any write ---------------------------------------------------------
READER_NETWORK="${READING_SIGNALS_READER_NETWORK:-}"
EGRESS_NETWORK="${READING_SIGNALS_EGRESS_NETWORK:-}"
MINIFLUX_URL="${READING_SIGNALS_MINIFLUX_BASE_URL:-}"
ORIGINS="${READING_SIGNALS_ALLOWED_WEB_ORIGINS:-}"
NETWORK_RE='^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'
HTTPS_HOST_RE='^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'
[[ "$READER_NETWORK" =~ $NETWORK_RE ]] || die PREFLIGHT READER_NETWORK_INVALID
[[ "$EGRESS_NETWORK" =~ $NETWORK_RE ]] || die PREFLIGHT EGRESS_NETWORK_INVALID
[[ "$READER_NETWORK" != "$EGRESS_NETWORK" ]] || die PREFLIGHT NETWORKS_MUST_DIFFER
[[ "${MINIFLUX_URL%/}" =~ $HTTPS_HOST_RE ]] || die PREFLIGHT MINIFLUX_URL_INVALID
IFS=',' read -r -a origin_list <<<"$ORIGINS"
(( ${#origin_list[@]} > 0 )) || die PREFLIGHT ORIGINS_INVALID
for origin in "${origin_list[@]}"; do
  [[ "$origin" =~ $HTTPS_HOST_RE ]] || die PREFLIGHT ORIGINS_INVALID
done
docker network inspect "$READER_NETWORK" >/dev/null 2>&1 || die PREFLIGHT READER_NETWORK_MISSING
docker network inspect "$EGRESS_NETWORK" >/dev/null 2>&1 || die PREFLIGHT EGRESS_NETWORK_MISSING
# The Reader Caddy is the only peer allowed to assert HTTPS. Its address must be fixed (IPAM-configured),
# or a Reader release could hand the trusted IP to another container.
TRUSTED_IP="$(docker inspect -f "{{with index .NetworkSettings.Networks \"$READER_NETWORK\"}}{{if .IPAMConfig}}{{.IPAMConfig.IPv4Address}}{{end}}{{end}}" "$READER_CONTAINER" 2>/dev/null || true)"
[[ "$TRUSTED_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die PREFLIGHT READER_IP_NOT_FIXED
gate PREFLIGHT PASS
gate TRUSTED_PROXY_IP "$TRUSTED_IP"

# --- source at the approved commit -----------------------------------------------------------------------
mkdir -p "$RELEASE_DIR"
chmod 0700 "$STATE_ROOT" "$RELEASE_DIR"
if [[ ! -d "$SRC/.git" ]]; then
  git clone -q --no-checkout "$REPO_URL" "$SRC" || die SOURCE CLONE_FAILED
  git -C "$SRC" checkout -q --detach "$APPROVED_SHA" || die SOURCE CHECKOUT_FAILED
fi
[[ "$(git -C "$SRC" rev-parse HEAD)" == "$APPROVED_SHA" ]] || die SOURCE HEAD_MISMATCH
[[ -z "$(git -C "$SRC" status --porcelain)" ]] || die SOURCE NOT_CLEAN
gate SOURCE PASS

# --- image built from that commit only -------------------------------------------------------------------
IMAGE_ID="$(docker build -q -f "$SRC/services/reading_signals/Dockerfile" \
  --label "org.opencontainers.image.revision=$APPROVED_SHA" \
  -t "$PROJECT:${APPROVED_SHA:0:12}" "$SRC")" || die BUILD BUILD_FAILED
[[ "$IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]] || die BUILD IMAGE_ID_INVALID
gate BUILD PASS
gate IMAGE "$IMAGE_ID"

# --- env file (no secrets: URLs, origins, network names, the image id and the trusted IP) ----------------
PREVIOUS_IMAGE="$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
{
  printf 'READING_SIGNALS_IMAGE=%s\n' "$IMAGE_ID"
  printf 'READING_SIGNALS_ENABLED=true\n'
  printf 'READING_SIGNALS_TRUSTED_PROXY_IPS=%s\n' "$TRUSTED_IP"
  printf 'READING_SIGNALS_MINIFLUX_BASE_URL=%s\n' "${MINIFLUX_URL%/}"
  printf 'READING_SIGNALS_ALLOWED_WEB_ORIGINS=%s\n' "$ORIGINS"
  printf 'READING_SIGNALS_READER_NETWORK=%s\n' "$READER_NETWORK"
  printf 'READING_SIGNALS_EGRESS_NETWORK=%s\n' "$EGRESS_NETWORK"
} >"$ENV_FILE"
chmod 0600 "$ENV_FILE"
printf '%s\n' "${PREVIOUS_IMAGE:-none}" >"$RELEASE_DIR/previous-image"

# --- start and wait for health ---------------------------------------------------------------------------
compose up -d --no-build >/dev/null || die APPLY COMPOSE_UP_FAILED
deadline=$((SECONDS + HEALTH_TIMEOUT))
health=""
while (( SECONDS < deadline )); do
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER" 2>/dev/null || true)"
  [[ "$health" == healthy || "$health" == unhealthy ]] && break
  sleep 2
done
[[ "$health" == healthy ]] || {
  echo "ROLLBACK=sudo -E APPROVED_SHA=$APPROVED_SHA bash $SRC/ops/deploy/reading-signals/deploy.sh rollback"
  die APPLY "HEALTH_${health:-TIMEOUT}"
}
[[ "$(docker inspect -f '{{.Image}}' "$CONTAINER")" == "$IMAGE_ID" ]] || die APPLY RUNNING_IMAGE_MISMATCH
printf '%s\n' "$APPROVED_SHA" >"$STATE_ROOT/CURRENT"
gate APPLY PASS
gate PREVIOUS_IMAGE "${PREVIOUS_IMAGE:-none}"
echo "ROLLBACK=sudo -E APPROVED_SHA=$APPROVED_SHA bash $SRC/ops/deploy/reading-signals/deploy.sh rollback"
