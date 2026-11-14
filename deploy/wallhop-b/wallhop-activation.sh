#!/usr/bin/env bash
# WallHop-B activation and rollback — single operator procedure (OMV), transactional.
#
#   export APPROVED_SHA=<40-hex main commit containing this script> WALLHOP_ENV=/root/wallhop.env
#   sudo -E bash wallhop-activation.sh prepare         # release dir + exact source (no Docker change)
#   sudo -E bash wallhop-activation.sh preflight       # strictly read-only; prints every gate
#   sudo -E bash wallhop-activation.sh activate-infra  # transactional: any failure after the first change rolls back
#   sudo -E bash wallhop-activation.sh enable-policy   # ONLY with SOURCE_POLICY_GATE=PASS and WALLHOP_REAL_CONTRACT_GATE=PASS
#   sudo -E bash wallhop-activation.sh smoke
#   sudo -E bash wallhop-activation.sh rollback        # reverse order + readback; exit 0 only on ROLLBACK=PASS
#
# Exit codes: 0 success; 1 blocked/failed with the baseline restored (or nothing changed);
#             2 ROLLBACK_PARTIAL — restoration incomplete, evidence in <release-dir>/rollback-receipt.txt.
# Never touches Miniflux, miniflux-db, NPM, LiteLLM or the Summary API. Output: gate names, IDs, hashes.
set -Eeuo pipefail
umask 077
: "${APPROVED_SHA:?APPROVED_SHA required}"
[[ "$APPROVED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "GATE=BLOCKED CODE=APPROVED_SHA_INVALID"; exit 1; }
[[ -n "${WALLHOP_ENV:-}" && -f "$WALLHOP_ENV" ]] && set -a && . "$WALLHOP_ENV" && set +a # non-secret site settings only
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
BASE="$RELEASE_DIR/baseline"
READER_PROBE='["sh","-c","wget -qO- http://127.0.0.1:2000/ | grep -q \"id=.root.\""]'

gate() { printf '%s=%s\n' "$1" "$2"; }
die() { gate "$1" BLOCKED; echo "CODE=$2"; exit 1; }
label() { docker inspect -f "{{index .Config.Labels \"$2\"}}" "$1"; }
release_tool() { python3 "$SRC/deploy/release-governance/release.py" --policy "$SRC/deploy/release-governance/policy.json" --lock "$LOCK" "$@"; }
caddy_source() { docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$READER_CONTAINER"; }
networks_of() { docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1" | xargs -n1 | sort | xargs; }
identity_of() { docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}} {{len .HostConfig.PortBindings}}' "$1"; }

# Test-only fault injection: refused unless the disposable rehearsal override is in use.
if [[ -n "${WALLHOP_TEST_FAULT:-}" && -z "${WALLHOP_REHEARSAL_OVERRIDE:-}" ]]; then
  echo "GATE=BLOCKED CODE=FAULT_INJECTION_OUTSIDE_REHEARSAL"; exit 1
fi
fault() { [[ "${WALLHOP_TEST_FAULT:-}" == "$1" ]] && { echo "INJECTED_FAULT=$1" >&2; return 1; }; return 0; }

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
  gate SIDECAR_IDENTITY "$(identity_of "$SIDECAR_CONTAINER")"
  gate SIDECAR_NETWORKS "$(networks_of "$SIDECAR_CONTAINER")"
  gate READER_IDENTITY "$(identity_of "$READER_CONTAINER")"
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

# ---- sidecar compose helpers ---------------------------------------------------------------------------
sidecar_compose() { # extra files...
  local args=(compose -p "$(cat "$BASE/sidecar.project")" --project-directory "$(cat "$BASE/sidecar.workdir")")
  local f; while read -r f; do [[ -n "$f" ]] && args+=(-f "$f"); done <"$BASE/sidecar.files"
  for f in "$@"; do args+=(-f "$f"); done
  printf '%s\n' "${args[@]}"
}
run_sidecar_compose() { local cmd=(); mapfile -t cmd < <(sidecar_compose "${@:2}"); docker "${cmd[@]}" $1; }
wait_healthy() { local c=$1 i; for i in $(seq 1 60); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null)" == healthy ]] && return 0; sleep 2; done; return 1; }
overlay_env() { # policy_json reader_enabled
  export WALLHOP_NPM_NETWORK="$NPM_NETWORK" WALLHOP_HAPROXY_CFG="$SRC/deploy/wallhop-b/haproxy.cfg" WALLHOP_MINIFLUX_PUBLIC_URL \
    WALLHOP_MINIFLUX_PUBLIC_HOST WALLHOP_READER_IP WALLHOP_ALLOWED_WEB_ORIGINS WALLHOP_READER_USER_ID WALLHOP_UPSTREAM WALLHOP_MINIFLUX_UPSTREAM
  export WALLHOP_EGRESS_IMAGE; WALLHOP_EGRESS_IMAGE="$(cat "$BASE/relay.image" 2>/dev/null || true)"
  export WALLHOP_POLICIES_JSON="$1" WALLHOP_READER_ENABLED="$2"
}
overlays() { printf '%s\n' "$RELEASE_DIR/sidecar.override.yaml"; [[ -n "${WALLHOP_REHEARSAL_OVERRIDE:-}" ]] && printf '%s\n' "$WALLHOP_REHEARSAL_OVERRIDE"; return 0; }

# ---- baseline (recorded once, before the first change) ---------------------------------------------------
record_baseline() {
  [[ -f "$BASE/complete" ]] && return 0
  mkdir -p "$BASE"
  label "$SIDECAR_CONTAINER" com.docker.compose.project >"$BASE/sidecar.project"
  label "$SIDECAR_CONTAINER" com.docker.compose.project.working_dir >"$BASE/sidecar.workdir"
  label "$SIDECAR_CONTAINER" com.docker.compose.service >"$BASE/sidecar.service"
  label "$SIDECAR_CONTAINER" com.docker.compose.project.config_files | tr ',' '\n' >"$BASE/sidecar.files"
  identity_of "$SIDECAR_CONTAINER" >"$BASE/sidecar.identity"
  networks_of "$SIDECAR_CONTAINER" >"$BASE/sidecar.networks"
  identity_of "$READER_CONTAINER" >"$BASE/reader.identity"
  networks_of "$READER_CONTAINER" >"$BASE/reader.networks"
  cp -p "$(caddy_source)" "$BASE/Caddyfile"
  local name; for name in "${PROTECTED_NAMES[@]}"; do docker inspect -f '{{.Name}} {{.Id}} {{.Image}}' "$name"; done >"$BASE/protected"
  : >"$BASE/networks.preexisting"
  local net; for net in "$READER_NET" "$EGRESS_NET"; do if docker network inspect "$net" >/dev/null 2>&1; then echo "$net" >>"$BASE/networks.preexisting"; fi; done
  touch "$BASE/complete"
}
created_net() { ! grep -qx "$1" "$BASE/networks.preexisting" 2>/dev/null; }

# ---- activation stages (each returns non-zero on failure; nothing is swallowed) ---------------------------
stage_networks() {
  fault network_create || return 1
  docker network inspect "$READER_NET" >/dev/null 2>&1 || docker network create --internal --subnet "$WALLHOP_READER_SUBNET" \
    --ip-range "$WALLHOP_READER_DYNAMIC_RANGE" --label org.newsflux.wallhop=1 "$READER_NET" >/dev/null || return 1
  docker network inspect "$EGRESS_NET" >/dev/null 2>&1 || docker network create --internal --label org.newsflux.wallhop=1 "$EGRESS_NET" >/dev/null || return 1
}
stage_relay() {
  sed "s/^  content-fallback:/  $(cat "$BASE/sidecar.service"):/" "$SRC/deploy/wallhop-b/sidecar.override.yaml" >"$RELEASE_DIR/sidecar.override.yaml" || return 1
  docker image inspect "$HAPROXY_REF" >/dev/null 2>&1 || docker pull -q "$HAPROXY_REF" >/dev/null || return 1
  docker image inspect -f '{{.Id}}' "$HAPROXY_REF" >"$BASE/relay.image" || return 1
  overlay_env '{"enabled":false}' false
  fault relay_up || return 1
  local extra; mapfile -t extra < <(overlays)
  run_sidecar_compose "up -d --no-deps wallhop-egress" "${extra[@]}" >/dev/null 2>&1 || return 1
}
stage_sidecar() {
  overlay_env '{"enabled":false}' false
  fault sidecar_up || return 1
  local extra; mapfile -t extra < <(overlays)
  run_sidecar_compose "up -d --no-deps $(cat "$BASE/sidecar.service")" "${extra[@]}" >/dev/null 2>&1 || return 1
  wait_healthy "$SIDECAR_CONTAINER" || return 1
  [[ "$(networks_of "$SIDECAR_CONTAINER")" == "$EGRESS_NET $READER_NET" ]] || return 1
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' "$SIDECAR_CONTAINER")" == 0 ]] || return 1
}
stage_reader() {
  local reader_svc; reader_svc="$(label "$READER_CONTAINER" com.docker.compose.service)" || return 1
  sed -e "s/^  newsflux:/  $reader_svc:/" -e "s/\${WALLHOP_READER_IP:?}/$WALLHOP_READER_IP/" \
    "$SRC/deploy/wallhop-b/reader.override.yaml" >"$RELEASE_DIR/reader.override.yaml" || return 1
  if [[ -z "${WALLHOP_READER_IMAGE:-}" ]]; then
    docker build --quiet -f "$SRC/Dockerfile" --build-arg SOURCE_COMMIT="$APPROVED_SHA" \
      --build-arg SOURCE_COMMIT_DATE="$(git -C "$SRC" show -s --format=%cI "$APPROVED_SHA")" \
      --build-arg VITE_ARTICLE_INTELLIGENCE_ENABLED=1 --build-arg VITE_CONTENT_FALLBACK_READER_BASE_PATH=/api/content-fallback \
      -t "newsflux-reader-recovery:$APPROVED_SHA" "$SRC" >/dev/null || return 1
    WALLHOP_READER_IMAGE="$(docker image inspect -f '{{.Id}}' "newsflux-reader-recovery:$APPROVED_SHA")" || return 1
  fi
  local prot=() n; for n in "${PROTECTED_NAMES[@]}"; do prot+=(--protected "$n"); done
  fault reader_plan || return 1
  if [[ ! -f "$RELEASE_DIR/reader/manifest.json" ]]; then
    release_tool plan --project "$NEWSFLUX_PROJECT" --service "$reader_svc" --candidate-image "$WALLHOP_READER_IMAGE" \
      --approved-sha "$APPROVED_SHA" "${prot[@]}" --release-dir "$RELEASE_DIR/reader" \
      --extra-override "$RELEASE_DIR/reader.override.yaml" --network-added "$READER_NET" --ready-probe "$READER_PROBE" >/dev/null || return 1
  fi
  fault reader_promote || return 1
  release_tool promote --manifest "$RELEASE_DIR/reader/manifest.json" --timeout 180 >/dev/null 2>&1 || return 1
}
stage_caddy() {
  local caddy; caddy="$(caddy_source)" || return 1
  fault caddy_validate || return 1
  docker run --rm --network none -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP=127.0.0.1 -v "$SRC/deploy/wallhop-b/Caddyfile.wallhop:/etc/caddy/Caddyfile:ro" \
    "$(docker inspect -f '{{.Image}}' "$READER_CONTAINER")" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || return 1
  cat "$SRC/deploy/wallhop-b/Caddyfile.wallhop" >"$caddy" || return 1
  fault caddy_reload || return 1
  docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || return 1
}

activate_infra() {
  require_source
  docker inspect "$SIDECAR_CONTAINER" >/dev/null 2>&1 || die ACTIVATE_INFRA SIDECAR_NOT_FOUND
  record_baseline
  local stage
  for stage in networks relay sidecar reader caddy; do
    if ! "stage_$stage"; then
      gate ACTIVATE_INFRA "FAILED STAGE=$stage"
      # Transactional: any failure after the first change restores the baseline; both outcomes are reported.
      if rollback; then exit 1; else exit 2; fi
    fi
    gate "STAGE_$stage" PASS
  done
  gate WALLHOP_POLICY DISABLED
  gate ACTIVATE_INFRA PASS
}

enable_policy() {
  require_source
  source_policy_gate || die ENABLE_POLICY SOURCE_POLICY_GATE
  contract_gate || die ENABLE_POLICY WALLHOP_REAL_CONTRACT_GATE
  [[ -f "$BASE/complete" && -f "$RELEASE_DIR/sidecar.override.yaml" ]] || die ENABLE_POLICY INFRA_NOT_ACTIVE
  local svc policy disabled_identity extra; svc="$(cat "$BASE/sidecar.service")"
  disabled_identity="$(identity_of "$SIDECAR_CONTAINER")"
  policy="$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(json.dumps({"enabled":True,"domains":{s["domain"].lower():{"state":"ON_DEMAND","provider":"wallhop"} for s in d["sources"]},"feeds":{}},separators=(",",":")))' "$WALLHOP_APPROVED_SOURCES")"
  mapfile -t extra < <(overlays)
  overlay_env "$policy" true
  if run_sidecar_compose "up -d --no-deps $svc" "${extra[@]}" >/dev/null 2>&1 && fault policy_sidecar_ready && wait_healthy "$SIDECAR_CONTAINER"; then
    gate WALLHOP_POLICY ENABLED; return 0
  fi
  gate ENABLE_POLICY FAILED
  # Fail closed: restore the disabled policy and prove the sidecar is back to its pre-enable identity.
  overlay_env '{"enabled":false}' false
  if run_sidecar_compose "up -d --no-deps $svc" "${extra[@]}" >/dev/null 2>&1 && wait_healthy "$SIDECAR_CONTAINER" \
    && [[ "$(identity_of "$SIDECAR_CONTAINER")" == "$disabled_identity" ]]; then
    gate POLICY_RESTORED_DISABLED PASS; exit 1
  fi
  gate POLICY_RESTORED_DISABLED FAIL; exit 2
}

rollback() { # idempotent, reverse order, then readback against the recorded baseline
  [[ -f "$BASE/complete" ]] || { gate ROLLBACK NOTHING_TO_ROLL_BACK; return 0; }
  local failures=() caddy svc relay net
  caddy="$(caddy_source)"
  if ! cmp -s "$BASE/Caddyfile" "$caddy"; then
    { cat "$BASE/Caddyfile" >"$caddy" && docker exec "$READER_CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; } \
      || failures+=(CADDY_RELOAD)
  fi
  if [[ -f "$RELEASE_DIR/reader/manifest.json" ]]; then
    { fault rollback_reader && release_tool rollback --manifest "$RELEASE_DIR/reader/manifest.json" --timeout 180 >/dev/null 2>&1; } || failures+=(READER_RELEASE_ROLLBACK)
  fi
  svc="$(cat "$BASE/sidecar.service")"
  { fault rollback_sidecar && run_sidecar_compose "up -d --no-deps $svc" >/dev/null 2>&1 && wait_healthy "$SIDECAR_CONTAINER"; } || failures+=(SIDECAR_RESTORE)
  relay="$(docker ps -aq --filter "label=com.docker.compose.service=wallhop-egress" --filter "label=com.docker.compose.project=$(cat "$BASE/sidecar.project")")"
  if [[ -n "$relay" ]]; then docker rm -f $relay >/dev/null 2>&1 || failures+=(RELAY_REMOVE); fi
  for net in "$READER_NET" "$EGRESS_NET"; do
    if created_net "$net" && docker network inspect "$net" >/dev/null 2>&1; then
      { fault rollback_network && docker network rm "$net" >/dev/null 2>&1; } || failures+=("NETWORK_REMOVE_$net")
    fi
  done
  # Readback: the baseline is the only definition of success.
  [[ "$(identity_of "$SIDECAR_CONTAINER" 2>/dev/null)" == "$(cat "$BASE/sidecar.identity")" ]] || failures+=(SIDECAR_IDENTITY)
  [[ "$(networks_of "$SIDECAR_CONTAINER" 2>/dev/null)" == "$(cat "$BASE/sidecar.networks")" ]] || failures+=(SIDECAR_NETWORKS)
  [[ "$(identity_of "$READER_CONTAINER" 2>/dev/null)" == "$(cat "$BASE/reader.identity")" ]] || failures+=(READER_IDENTITY)
  [[ "$(networks_of "$READER_CONTAINER" 2>/dev/null)" == "$(cat "$BASE/reader.networks")" ]] || failures+=(READER_NETWORKS)
  cmp -s "$BASE/Caddyfile" "$(caddy_source)" || failures+=(CADDYFILE)
  [[ -z "$(docker ps -aq --filter "label=com.docker.compose.service=wallhop-egress" --filter "label=com.docker.compose.project=$(cat "$BASE/sidecar.project")")" ]] || failures+=(RELAY_PRESENT)
  for net in "$READER_NET" "$EGRESS_NET"; do if created_net "$net" && docker network inspect "$net" >/dev/null 2>&1; then failures+=("NETWORK_PRESENT_$net"); fi; done
  local name; for name in "${PROTECTED_NAMES[@]}"; do docker inspect -f '{{.Name}} {{.Id}} {{.Image}}' "$name"; done >"$RELEASE_DIR/protected.after" 2>/dev/null || true
  cmp -s "$BASE/protected" "$RELEASE_DIR/protected.after" || failures+=(PROTECTED_CHANGED)
  { echo "AT=$(date -u +%FT%TZ)"; echo "FAILURES=${failures[*]:-NONE}"; } >"$RELEASE_DIR/rollback-receipt.txt" 2>/dev/null || true
  if ((${#failures[@]})); then gate ROLLBACK "PARTIAL FAILURES=${failures[*]}"; return 2; fi
  gate ROLLBACK PASS
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
  smoke) smoke ;; rollback) if rollback; then exit 0; else exit 2; fi ;; gates) source_policy_gate || true; contract_gate || true ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
