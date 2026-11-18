#!/usr/bin/env bash
# NEWSFLUX-AI-SETTINGS-01 — single read-only OMV preflight (operator-run, idempotent, sanitized).
#
#   sudo bash deploy/release-governance/ai-settings-readonly-preflight.sh
#
# Writes nothing, creates nothing, restarts nothing, calls no network service. Prints only
# classifications, counts, image/revision identifiers and SHA-256 of non-secret files. Never prints
# environment values, keys, paths of secret files, URLs, user IDs or file contents.
# Exit 0 = every check PASS, 3 = at least one HOLD (operator decision needed before any release).
set -Euo pipefail
umask 077

PROJECT="${NEWSFLUX_PROJECT:-newsflux}"
SUMMARY_SERVICE="${NEWSFLUX_SUMMARY_SERVICE:-summary-api}"
READER_CONTAINER="${NEWSFLUX_READER_CONTAINER:-newsflux}"
read -r -a PROTECTED_NAMES <<<"${NEWSFLUX_PROTECTED_CONTAINERS:-miniflux miniflux-db}"
PRE_STAGE1=6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108
STAGE1=56d434b9c81e66d9e03a827be3bd42f48dd68636c83a0ea9baa70322f30f95d6
# Caddyfile carrying the NEWSFLUX-AI-SETTINGS-01 admin routes (PR #264); already-applied state.
ADMIN_ROUTES="${NEWSFLUX_TARGET_CADDY_SHA:-}"
hold=0

out() { printf '%s=%s\n' "$1" "$2"; }
holdout() { out "$1" "$2"; hold=1; }
env_of() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null | sed -n "s/^$2=//p" | head -1; }
flag() { [[ "$(env_of "$1" "$2" | tr '[:upper:]' '[:lower:]')" == true ]] && echo ON || echo OFF; }

command -v docker >/dev/null || { holdout DOCKER UNAVAILABLE; out PREFLIGHT HOLD; exit 3; }

# ---- Summary API --------------------------------------------------------------------------------
summary="$(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$SUMMARY_SERVICE")"
if [[ -z "$summary" || "$(wc -l <<<"$summary")" -ne 1 ]]; then
  holdout SUMMARY_CONTAINER NOT_UNIQUE
else
  out SUMMARY_IMAGE "$(docker inspect -f '{{.Image}}' "$summary")"
  out SUMMARY_REVISION "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker inspect -f '{{.Image}}' "$summary")")"
  out SUMMARY_HEALTH "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$summary")"
  user="$(docker inspect -f '{{.Config.User}}' "$summary")"
  [[ "$user" == 10001:10001 || "$user" == 10001 ]] && out SUMMARY_USER UID10001 || holdout SUMMARY_USER NOT_10001
  out SUMMARY_PUBLISHED_PORTS "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$summary")"
  out SUMMARY_COMPOSE_FILES "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$summary" | tr ',' '\n' | grep -c .)"
  # /data must be a mount writable by UID 10001 for the managed settings store.
  data_type="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}{{end}}{{end}}' "$summary")"
  [[ -n "$data_type" ]] && out DATA_MOUNT "$data_type" || holdout DATA_MOUNT ABSENT
  data_stat="$(docker exec "$summary" stat -c '%u %a' /data 2>/dev/null || true)"
  [[ "${data_stat%% *}" == 10001 ]] && out DATA_OWNER UID10001 || holdout DATA_OWNER "NOT_10001"
  out DATA_MODE "${data_stat##* }"
  managed="$(docker exec "$summary" sh -c 'test -e /data/newsflux-ai-settings && echo PRESENT || echo ABSENT' 2>/dev/null || echo UNKNOWN)"
  out MANAGED_SETTINGS_DIR "$managed"
  [[ -n "$(env_of "$summary" NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS)" ]] && out ADMIN_ALLOWLIST CONFIGURED || holdout ADMIN_ALLOWLIST EMPTY
  origins="$(env_of "$summary" NEWSFLUX_AI_ALLOWED_WEB_ORIGINS)"
  [[ "$origins" == https://* ]] && out ALLOWED_ORIGINS "HTTPS_COUNT_$(tr ',' '\n' <<<"$origins" | grep -c .)" || holdout ALLOWED_ORIGINS NOT_HTTPS_OR_EMPTY
  [[ -n "$(env_of "$summary" NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE)" ]] && out BOOTSTRAP_KEY_FILE_CONFIGURED YES || out BOOTSTRAP_KEY_FILE_CONFIGURED NO
  [[ -n "$(env_of "$summary" NEWSFLUX_AI_MODEL_POLICY_JSON)" ]] && out ENV_MODEL_POLICY PRESENT || out ENV_MODEL_POLICY ABSENT_LEGACY
  for name in NEWSFLUX_AI_ADMIN_CONFIG_WRITES_ENABLED NEWSFLUX_AI_INFERENCE_ENABLED NEWSFLUX_AI_ALLOW_LOCAL_ARTICLE_PROCESSING \
    NEWSFLUX_AI_ALLOW_EXTERNAL_ARTICLE_TRANSFER NEWSFLUX_AI_ALLOW_PAID_INFERENCE; do
    out "${name#NEWSFLUX_AI_}" "$(flag "$summary" "$name")"
  done
fi

# ---- Reader / Caddy -----------------------------------------------------------------------------
if ! docker inspect "$READER_CONTAINER" >/dev/null 2>&1; then
  holdout READER_CONTAINER ABSENT
else
  out READER_IMAGE "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")"
  out READER_REVISION "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")")"
  out READER_SERVICE "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$READER_CONTAINER")"
  [[ -n "$(env_of "$READER_CONTAINER" NEWSFLUX_PILOT_TRUSTED_PROXY_IP)" ]] && out TRUSTED_PROXY_IP CONFIGURED || holdout TRUSTED_PROXY_IP ABSENT
  caddy="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$READER_CONTAINER")"
  if [[ -z "$caddy" ]]; then
    holdout CADDYFILE_MOUNT ABSENT
  elif [[ -L "$caddy" ]]; then
    holdout CADDYFILE_MOUNT SYMLINK
  elif [[ ! -f "$caddy" ]]; then
    holdout CADDYFILE_MOUNT NOT_REGULAR_FILE
  else
    out CADDYFILE_MOUNT REGULAR_FILE
    host_sha="$(sha256sum "$caddy" | cut -d' ' -f1)"
    ctr_sha="$(docker exec "$READER_CONTAINER" sha256sum /etc/caddy/Caddyfile 2>/dev/null | cut -d' ' -f1)"
    out ACTIVE_CADDY_SHA256 "$host_sha"
    [[ "$host_sha" == "$ctr_sha" ]] && out CADDY_CONTAINER_READBACK MATCH || holdout CADDY_CONTAINER_READBACK MISMATCH
    case "$host_sha" in
      "$STAGE1") out CADDY_STATE STAGE1_ACCEPTED_PRIOR ;;
      "$PRE_STAGE1") out CADDY_STATE PRE_STAGE1_ACCEPTED_PRIOR ;;
      *)
        if [[ -n "$ADMIN_ROUTES" && "$host_sha" == "$ADMIN_ROUTES" ]]; then out CADDY_STATE TARGET_ALREADY_APPLIED
        else holdout CADDY_STATE UNKNOWN_DRIFT; fi ;;
    esac
    out CADDYFILE_MODE "$(stat -c '%a' "$caddy")"
    out CADDYFILE_INODE "$(stat -c '%i' "$caddy")"
  fi
fi

# ---- Protected services (identity only) ---------------------------------------------------------
for name in "${PROTECTED_NAMES[@]}"; do
  if [[ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" == true ]]; then
    out "PROTECTED_${name}" "RUNNING $(docker inspect -f '{{.Image}}' "$name")"
  else
    holdout "PROTECTED_${name}" NOT_RUNNING
  fi
done
out WALLHOP_RESOURCES "$(( $(docker ps -aq --filter name=wallhop | grep -c . || true) + $(docker network ls -q --filter name=wallhop | grep -c . || true) ))"
lock="${NEWSFLUX_RELEASE_LOCK:-/run/lock/newsflux-release.lock}"
[[ -e "$lock" ]] && out RELEASE_LOCK_FILE PRESENT || out RELEASE_LOCK_FILE ABSENT

out SECRET_PRINTED NO
out WRITES_PERFORMED NO
if [[ "$hold" -eq 0 ]]; then out PREFLIGHT PASS; exit 0; fi
out PREFLIGHT HOLD
exit 3
