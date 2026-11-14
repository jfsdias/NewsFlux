#!/usr/bin/env bash
# WallHop-B activation and rollback — single operator procedure (OMV).
#
#   export APPROVED_SHA=<40-hex main commit containing this script> WALLHOP_ENV=/root/wallhop.env
#   sudo -E bash wallhop-activation.sh prepare         # release dir + exact source (no Docker change)
#   sudo -E bash wallhop-activation.sh preflight       # strictly read-only; prints every gate
#   sudo -E bash wallhop-activation.sh activate-infra  # networks, relay, sidecar isolation, Reader network+UI, Caddy route
#   sudo -E bash wallhop-activation.sh enable-policy   # ONLY with SOURCE_POLICY_GATE=PASS and WALLHOP_REAL_CONTRACT_GATE=PASS
#   sudo -E bash wallhop-activation.sh smoke
#   sudo -E bash wallhop-activation.sh rollback        # reverse order, exact sidecar config-hash, idempotent
#
# Never touches Miniflux, miniflux-db, NPM, LiteLLM or the Summary API. The policy stays
# {"enabled": false} unless both external gates pass. Output: gate names, identifiers, hashes.
set -Eeuo pipefail
umask 077
: "${APPROVED_SHA:?APPROVED_SHA required}"
[[ "$APPROVED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "GATE=BLOCKED CODE=APPROVED_SHA_INVALID"; exit 1; }
# Non-secret site settings (public URLs, static IP); never tokens.
[[ -n "${WALLHOP_ENV:-}" && -f "$WALLHOP_ENV" ]] && set -a && . "$WALLHOP_ENV" && set +a
: "${WALLHOP_MINIFLUX_PUBLIC_URL:?public HTTPS Miniflux URL required}"
: "${WALLHOP_ALLOWED_WEB_ORIGINS:?public Reader origin required}"
: "${WALLHOP_READER_USER_ID:?Miniflux user id of the Reader owner required}"
WALLHOP_MINIFLUX_PUBLIC_HOST="${WALLHOP_MINIFLUX_PUBLIC_URL#https://}"; WALLHOP_MINIFLUX_PUBLIC_HOST="${WALLHOP_MINIFLUX_PUBLIC_HOST%%/*}"
SIDECAR_CONTAINER="${WALLHOP_SIDECAR_CONTAINER:-newsflux-pr188-content-fallback}"
READER_CONTAINER="${NEWSFLUX_READER_CONTAINER:-newsflux}"
NEWSFLUX_PROJECT="${NEWSFLUX_PROJECT:-newsflux}"
NPM_NETWORK="${WALLHOP_NPM_NETWORK:-npm-proxyyml_default}"
READER_NET=newsflux_wallhop_reader; EGRESS_NET=newsflux_wallhop_egress
# The Reader's static address sits OUTSIDE the dynamic range, so the sidecar can never take it.
WALLHOP_READER_SUBNET="${WALLHOP_READER_SUBNET:-172.31.250.0/28}"; WALLHOP_READER_DYNAMIC_RANGE="${WALLHOP_READER_DYNAMIC_RANGE:-172.31.250.8/29}"
WALLHOP_READER_IP="${WALLHOP_READER_IP:-172.31.250.2}"
WALLHOP_UPSTREAM="${WALLHOP_UPSTREAM:-wallhop.io:443}"; WALLHOP_MINIFLUX_UPSTREAM="${WALLHOP_MINIFLUX_UPSTREAM:-npm:443}"
HAPROXY_REF="${WALLHOP_HAPROXY_IMAGE:-haproxy:3.0.5-alpine}"
read -r -a PROTECTED_NAMES <<<"${NEWSFLUX_PROTECTED_CONTAINERS:-miniflux miniflux-db}"
REPO_URL="${NEWSFLUX_REPO_URL:-https://github.com/jfsdias/NewsFlux.git}"
RELEASE_DIR="${NEWSFLUX_RELEASE_ROOT:-/dockerdata/compose/newsflux/.releases}/wallhop-${APPROVED_SHA:0:12}"
SRC="$RELEASE_DIR/source"; LOCK="${NEWSFLUX_RELEASE_LOCK:-/run/lock/newsflux-release.lock}"
EXPECTED_PILOT_CADDY_SHA="${EXPECTED_PILOT_CADDY_SHA:-}"
gate() { printf '%s=%s\n' "$1" "$2"; }
die() { gate "$1" BLOCKED; echo "CODE=$2"; exit 1; }
label() { docker inspect -f "{{index .Config.Labels \"$2\"}}" "$1"; }
sidecar_files() { label "$SIDECAR_CONTAINER" com.docker.compose.project.config_files | tr ',' '\n'; }
release_tool() { python3 "$SRC/deploy/release-governance/release.py" --policy "$SRC/deploy/release-governance/policy.json" --lock "$LOCK" "$@"; }
caddy_source() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$READER_CONTAINER"; }

require_source() {
  [[ -d "$SRC/.git" && "$(git -C "$SRC" rev-parse HEAD)" == "$APPROVED_SHA" ]] || die SOURCE_GATE NOT_PREPARED
  [[ -z "$(git --no-optional-locks -C "$SRC" status --porcelain --untracked-files=no)" ]] || die SOURCE_GATE DIRTY_SOURCE
}

prepare() {
  mkdir -p "$RELEASE_DIR"
  local filter=(); [[ "$REPO_URL" == https://* ]] && filter=(--filter=blob:none)
  ( umask 022
    [[ -d "$SRC/.git" ]] || git clone --quiet "${filter[@]}" --no-checkout "$REPO_URL" "$SRC"
    git -C "$SRC" fetch --quiet origin main
    git -C "$SRC" merge-base --is-ancestor "$APPROVED_SHA" origin/main || exit 3
    git -C "$SRC" -c advice.detachedHead=false checkout --quiet --force "$APPROVED_SHA" ) || die SOURCE_GATE APPROVED_SHA_NOT_ON_MAIN
  require_source; gate PREPARE PASS
}

# External gates. They never pass on defaults: the operator must provide reviewed evidence files.
source_policy_gate() {
  python3 - "${WALLHOP_APPROVED_SOURCES:-}" <<'PY'
import json, sys
DENY = {"nytimes.com", "wsj.com", "bloomberg.com", "ft.com", "economist.com", "folha.uol.com.br", "washingtonpost.com",
        "estadao.com.br", "globo.com", "valor.globo.com", "theatlantic.com", "newyorker.com", "medium.com"}
try:
    d = json.load(open(sys.argv[1]))
    assert d["version"] == "wallhop-approved-sources-v1" and d["approved_by"] and d["approved_at"]
    domains = []
    for s in d["sources"]:
        dom = s["domain"].strip().lower()
        assert dom and "/" not in dom and ":" not in dom
        assert s["public_without_login"] is True and s["terms_permit_automated_retrieval"] is True and s["terms_reviewed_url"].startswith("https://")
        assert not any(dom == x or dom.endswith("." + x) for x in DENY), f"paywalled:{dom}"
        domains.append(dom)
    assert domains
except Exception as error:  # noqa: BLE001
    print("SOURCE_POLICY_GATE=BLOCKED CODE=" + ("PAYWALLED_SOURCE" if "paywalled" in str(error) else "NO_VALID_APPROVED_SOURCES"))
    sys.exit(1)
print("SOURCE_POLICY_GATE=PASS SOURCES=" + ",".join(domains))
PY
}
contract_gate() {
  python3 - "${WALLHOP_CONTRACT_EVIDENCE:-}" "${WALLHOP_APPROVED_SOURCES:-}" <<'PY'
import json, sys
try:
    e = json.load(open(sys.argv[1])); s = json.load(open(sys.argv[2]))
    approved = {x["domain"].lower() for x in s["sources"]}
    assert e["version"] == "wallhop-contract-evidence-v1" and e["checked_by"] and e["checked_at"]
    assert e["endpoint"] == "https://wallhop.io/raw/" and e["http_status"] == 200 and e["content_type"].startswith("text/html")
    assert e["sample_domain"].lower() in approved and e["terms_reviewed"] is True and e["no_credentials_or_cookies_used"] is True
except Exception:  # noqa: BLE001
    print("WALLHOP_REAL_CONTRACT_GATE=BLOCKED CODE=NO_VALID_CONTRACT_EVIDENCE"); sys.exit(1)
print("WALLHOP_REAL_CONTRACT_GATE=PASS")
PY
}

preflight() { # read-only
  require_source
  docker inspect "$SIDECAR_CONTAINER" >/dev/null 2>&1 || die PREFLIGHT SIDECAR_NOT_FOUND
  docker inspect "$READER_CONTAINER" >/dev/null 2>&1 || die PREFLIGHT READER_NOT_FOUND
  [[ "$(label "$READER_CONTAINER" com.docker.compose.project)" == "$NEWSFLUX_PROJECT" ]] || die PREFLIGHT READER_PROJECT_MISMATCH
  docker network inspect "$NPM_NETWORK" >/dev/null 2>&1 || die PREFLIGHT NPM_NETWORK_NOT_FOUND
  local name; for name in "${PROTECTED_NAMES[@]}"; do docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die PREFLIGHT "PROTECTED_${name}_NOT_RUNNING"; done
  gate SIDECAR_PROJECT "$(label "$SIDECAR_CONTAINER" com.docker.compose.project)"
  gate SIDECAR_SERVICE "$(label "$SIDECAR_CONTAINER" com.docker.compose.service)"
  gate SIDECAR_CONFIG_HASH "$(label "$SIDECAR_CONTAINER" com.docker.compose.config-hash)"
  gate SIDECAR_NETWORKS "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$SIDECAR_CONTAINER")"
  gate ACTIVE_CADDY_SHA256 "$(sha256sum "$(caddy_source)" | cut -d' ' -f1)"
  for net in "$READER_NET" "$EGRESS_NET"; do
    if docker network inspect "$net" >/dev/null 2>&1; then
      [[ "$(docker network inspect -f '{{.Internal}}' "$net")" == true ]] || die PREFLIGHT "${net}_NOT_INTERNAL"; gate "$net" EXISTS_INTERNAL
    else gate "$net" ABSENT; fi
  done
  source_policy_gate || true
  contract_gate || true
  gate PREFLIGHT PASS
}

sidecar_compose() { # extra files...
  local args=(compose -p "$(label "$SIDECAR_CONTAINER" com.docker.compose.project)" --project-directory "$(label "$SIDECAR_CONTAINER" com.docker.compose.project.working_dir)")
  local f; while read -r f; do [[ -n "$f" ]] && args+=(-f "$f"); done <"$RELEASE_DIR/sidecar.before.files"
  for f in "$@"; do args+=(-f "$f"); done
  printf '%s\n' "${args[@]}"
}
run_sidecar_compose() { local cmd=(); mapfile -t cmd < <(sidecar_compose "${@:2}"); docker "${cmd[@]}" $1; }

wait_healthy() { local c=$1 i; for i in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" == healthy ]] && return 0; sleep 2; done; return 1; }

activate_infra() {
  require_source
  local svc; svc="$(label "$SIDECAR_CONTAINER" com.docker.compose.service)"
  # 1. Record the exact sidecar state for rollback (once).
  if [[ ! -f "$RELEASE_DIR/sidecar.before.json" ]]; then
    sidecar_files >"$RELEASE_DIR/sidecar.before.files"
    docker inspect -f '{"image":"{{.Image}}","config_hash":"{{index .Config.Labels "com.docker.compose.config-hash"}}","service":"{{index .Config.Labels "com.docker.compose.service"}}"}' "$SIDECAR_CONTAINER" >"$RELEASE_DIR/sidecar.before.json"
    cp -p "$(caddy_source)" "$RELEASE_DIR/Caddyfile.before"
  fi
  # 2. Internal networks.
  docker network inspect "$READER_NET" >/dev/null 2>&1 || docker network create --internal --subnet "$WALLHOP_READER_SUBNET" --ip-range "$WALLHOP_READER_DYNAMIC_RANGE" --label org.newsflux.wallhop=1 "$READER_NET" >/dev/null
  docker network inspect "$EGRESS_NET" >/dev/null 2>&1 || docker network create --internal --label org.newsflux.wallhop=1 "$EGRESS_NET" >/dev/null
  # 3. Rendered overlays (service name from the live container), relay image pinned by ID.
  sed "s/^  content-fallback:/  $svc:/" "$SRC/deploy/wallhop-b/sidecar.override.yaml" >"$RELEASE_DIR/sidecar.override.yaml"
  docker image inspect "$HAPROXY_REF" >/dev/null 2>&1 || docker pull -q "$HAPROXY_REF" >/dev/null
  export WALLHOP_EGRESS_IMAGE; WALLHOP_EGRESS_IMAGE="$(docker image inspect -f '{{.Id}}' "$HAPROXY_REF")"
  export WALLHOP_NPM_NETWORK="$NPM_NETWORK" WALLHOP_HAPROXY_CFG="$SRC/deploy/wallhop-b/haproxy.cfg" WALLHOP_MINIFLUX_PUBLIC_URL WALLHOP_MINIFLUX_PUBLIC_HOST \
    WALLHOP_READER_IP WALLHOP_ALLOWED_WEB_ORIGINS WALLHOP_READER_USER_ID WALLHOP_UPSTREAM WALLHOP_MINIFLUX_UPSTREAM
  export WALLHOP_READER_ENABLED=false WALLHOP_POLICIES_JSON='{"enabled":false}'
  local extra=("$RELEASE_DIR/sidecar.override.yaml"); [[ -n "${WALLHOP_REHEARSAL_OVERRIDE:-}" ]] && { gate REHEARSAL_OVERRIDE IN_USE; extra+=("$WALLHOP_REHEARSAL_OVERRIDE"); }
  # 4. Relay, then the sidecar moved to internal networks only.
  run_sidecar_compose "up -d --no-deps wallhop-egress" "${extra[@]}" >/dev/null
  run_sidecar_compose "up -d --no-deps $svc" "${extra[@]}" >/dev/null
  wait_healthy "$SIDECAR_CONTAINER" || { gate ACTIVATE_INFRA "SIDECAR_NOT_HEALTHY_ROLLING_BACK"; rollback; exit 1; }
  [[ "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$SIDECAR_CONTAINER" | xargs -n1 | sort | xargs)" == "$EGRESS_NET $READER_NET" ]] \
    || { gate ACTIVATE_INFRA "SIDECAR_NETWORKS_UNEXPECTED_ROLLING_BACK"; rollback; exit 1; }
  # 5. Reader: recovery UI build + internal bridge network, through the governed release tool.
  local reader_svc; reader_svc="$(label "$READER_CONTAINER" com.docker.compose.service)"
  sed "s/^  newsflux:/  $reader_svc:/" "$SRC/deploy/wallhop-b/reader.override.yaml" >"$RELEASE_DIR/reader.override.yaml"
  sed -i "s/\${WALLHOP_READER_IP:?}/$WALLHOP_READER_IP/" "$RELEASE_DIR/reader.override.yaml"
  if [[ -z "${WALLHOP_READER_IMAGE:-}" ]]; then
    docker build --quiet -f "$SRC/Dockerfile" --build-arg SOURCE_COMMIT="$APPROVED_SHA" \
      --build-arg SOURCE_COMMIT_DATE="$(git -C "$SRC" show -s --format=%cI "$APPROVED_SHA")" \
      --build-arg VITE_ARTICLE_INTELLIGENCE_ENABLED=1 --build-arg VITE_CONTENT_FALLBACK_READER_BASE_PATH=/api/content-fallback \
      -t "newsflux-reader-recovery:$APPROVED_SHA" "$SRC" >/dev/null
    WALLHOP_READER_IMAGE="$(docker image inspect -f '{{.Id}}' "newsflux-reader-recovery:$APPROVED_SHA")"
  fi
  local prot=(); local n; for n in "${PROTECTED_NAMES[@]}"; do prot+=(--protected "$n"); done
  [[ -f "$RELEASE_DIR/reader/manifest.json" ]] || release_tool plan --project "$NEWSFLUX_PROJECT" --service "$reader_svc" \
    --candidate-image "$WALLHOP_READER_IMAGE" --approved-sha "$APPROVED_SHA" "${prot[@]}" --release-dir "$RELEASE_DIR/reader" \
    --extra-override "$RELEASE_DIR/reader.override.yaml" --network-added "$READER_NET" \
    --ready-probe '["sh","-c","wget -qO- http://127.0.0.1:2000/ | grep -q \"id=.root.\""]' >/dev/null
  release_tool promote --manifest "$RELEASE_DIR/reader/manifest.json" --timeout 180 || { gate ACTIVATE_INFRA READER_RELEASE_FAILED_ROLLING_BACK; rollback; exit 1; }
  # 6. Caddy bridge route (in place; validated; restored on failure).
  local caddy; caddy="$(caddy_source)"
  docker run --rm --network none -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP=127.0.0.1 -v "$SRC/deploy/wallhop-b/Caddyfile.wallhop:/etc/caddy/Caddyfile:ro" \
    "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { rollback; die ACTIVATE_INFRA CADDYFILE_INVALID; }
  cat "$SRC/deploy/wallhop-b/Caddyfile.wallhop" >"$caddy"
  docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { gate ACTIVATE_INFRA CADDY_RELOAD_FAILED_ROLLING_BACK; rollback; exit 1; }
  gate WALLHOP_POLICY DISABLED
  gate ACTIVATE_INFRA PASS
}

enable_policy() {
  require_source
  source_policy_gate || die ENABLE_POLICY SOURCE_POLICY_GATE
  contract_gate || die ENABLE_POLICY WALLHOP_REAL_CONTRACT_GATE
  [[ -f "$RELEASE_DIR/sidecar.before.json" ]] || die ENABLE_POLICY INFRA_NOT_ACTIVE
  local svc policy; svc="$(label "$SIDECAR_CONTAINER" com.docker.compose.service)"
  policy="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(json.dumps({"enabled":True,"domains":{s["domain"].lower():{"state":"ON_DEMAND","provider":"wallhop"} for s in d["sources"]},"feeds":{}},separators=(",",":")))' "$WALLHOP_APPROVED_SOURCES")"
  export WALLHOP_EGRESS_IMAGE; WALLHOP_EGRESS_IMAGE="$(docker inspect -f '{{.Image}}' "$(docker ps -q --filter "label=com.docker.compose.service=wallhop-egress" | head -1)")"
  export WALLHOP_NPM_NETWORK="$NPM_NETWORK" WALLHOP_HAPROXY_CFG="$SRC/deploy/wallhop-b/haproxy.cfg" WALLHOP_MINIFLUX_PUBLIC_URL WALLHOP_MINIFLUX_PUBLIC_HOST \
    WALLHOP_READER_IP WALLHOP_ALLOWED_WEB_ORIGINS WALLHOP_READER_USER_ID WALLHOP_UPSTREAM WALLHOP_MINIFLUX_UPSTREAM
  export WALLHOP_READER_ENABLED=true WALLHOP_POLICIES_JSON="$policy"
  local extra=("$RELEASE_DIR/sidecar.override.yaml"); [[ -n "${WALLHOP_REHEARSAL_OVERRIDE:-}" ]] && extra+=("$WALLHOP_REHEARSAL_OVERRIDE")
  run_sidecar_compose "up -d --no-deps $svc" "${extra[@]}" >/dev/null
  wait_healthy "$SIDECAR_CONTAINER" || { gate ENABLE_POLICY SIDECAR_NOT_HEALTHY; exit 1; }
  gate WALLHOP_POLICY ENABLED
}

rollback() { # idempotent, reverse order
  [[ -f "$RELEASE_DIR/sidecar.before.json" ]] || { gate ROLLBACK NOTHING_TO_ROLL_BACK; return 0; }
  local caddy svc before_hash; caddy="$(caddy_source)"
  if [[ -f "$RELEASE_DIR/Caddyfile.before" ]] && ! cmp -s "$RELEASE_DIR/Caddyfile.before" "$caddy"; then
    cat "$RELEASE_DIR/Caddyfile.before" >"$caddy"
    docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || gate ROLLBACK CADDY_RELOAD_FAILED
  fi
  gate CADDY_RESTORED "$(cmp -s "$RELEASE_DIR/Caddyfile.before" "$caddy" && echo PASS || echo FAIL)"
  if [[ -f "$RELEASE_DIR/reader/manifest.json" ]]; then release_tool rollback --manifest "$RELEASE_DIR/reader/manifest.json" --timeout 180 || gate ROLLBACK READER_ROLLBACK_FAILED; fi
  svc="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["service"])' "$RELEASE_DIR/sidecar.before.json")"
  before_hash="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["config_hash"])' "$RELEASE_DIR/sidecar.before.json")"
  run_sidecar_compose "up -d --no-deps $svc" >/dev/null
  wait_healthy "$SIDECAR_CONTAINER" || gate ROLLBACK SIDECAR_NOT_HEALTHY
  [[ "$(label "$SIDECAR_CONTAINER" com.docker.compose.config-hash)" == "$before_hash" ]] && gate SIDECAR_CONFIG_RESTORED PASS || gate SIDECAR_CONFIG_RESTORED FAIL
  local relay; relay="$(docker ps -aq --filter "label=com.docker.compose.service=wallhop-egress" --filter "label=com.docker.compose.project=$(label "$SIDECAR_CONTAINER" com.docker.compose.project)")"
  [[ -n "$relay" ]] && docker rm -f $relay >/dev/null
  local net; for net in "$READER_NET" "$EGRESS_NET"; do
    if docker network inspect "$net" >/dev/null 2>&1; then
      [[ "$(docker network inspect -f '{{len .Containers}}' "$net")" == 0 ]] && docker network rm "$net" >/dev/null || gate ROLLBACK "${net}_STILL_IN_USE"
    fi
  done
  gate ROLLBACK DONE
}

smoke() {
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$SIDECAR_CONTAINER")" == healthy ]] || die SMOKE SIDECAR_NOT_HEALTHY
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$SIDECAR_CONTAINER")" == 0 ]] || die SMOKE SIDECAR_PUBLISHES_PORT
  docker exec "$SIDECAR_CONTAINER" python -c "
import socket
for host, port in (('1.1.1.1', 443), ('npm', 443), ('miniflux', 8080)):
    try:
        socket.create_connection((host, port), timeout=3).close(); raise SystemExit('reachable')
    except OSError: pass" >/dev/null 2>&1 || die SMOKE SIDECAR_HAS_DIRECT_ROUTE
  local name; for name in "${PROTECTED_NAMES[@]}"; do docker inspect -f '{{.State.Running}}' "$name" | grep -qx true || die SMOKE "PROTECTED_${name}_DOWN"; done
  gate SMOKE PASS
}

case "${1:-}" in
  prepare) prepare ;; preflight) preflight ;; activate-infra) activate_infra ;; enable-policy) enable_policy ;;
  smoke) smoke ;; rollback) rollback ;; gates) source_policy_gate || true; contract_gate || true ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
