#!/usr/bin/env bash
# Disposable rehearsal of the UPGRADE from the deployed Stage 1 (A = 57f1c6a…) to this commit (B),
# with production naming and the operator scripts themselves:
#
#   1. pre-Stage1 stack (old pilot Caddyfile 6970ee…), then Stage 1 is installed with the operator
#      script AS IT EXISTS AT A (its own source checkout, its own release dir);
#   2. upgrade to B with this commit's operator script, two-service strategy:
#      prepare → preflight (read-only, accepts the installed pilot Caddyfile) → promote-summary →
#      update-caddy (ALREADY_APPLIED, Caddyfile untouched) → promote-reader → smoke (both revisions B);
#      a Summary-only upgrade is shown to fail smoke with READER_REVISION (not a supported strategy);
#   3. rollback of B (reader, caddy, summary) restores Stage 1 exactly: image IDs, Compose config
#      hashes and config_files sequences, Caddyfile hash AND inode; rollback is idempotent; Stage 1
#      smoke (script A) passes again;
#   4. Miniflux, miniflux-db, the NPM stand-in and a LiteLLM stand-in keep their container identity;
#      no WallHop network or container appears; inference stays disabled.
#
# Images are local stand-ins (Caddy) labelled with the revision, as in rehearse-operator-script.sh;
# real Summary image start-up is covered by rehearse-r12f09.sh. Synthetic only; never a real host.
#
#   sudo bash deploy/release-governance/rehearse-stage1-upgrade.sh
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
A="${STAGE1_SHA:-57f1c6aaa22b44a087cdf7c7bc0dfbb83f521c37}"
B="$(git -C "$repo" rev-parse HEAD)"
PILOT_OLD=6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- deploy/release-governance deploy/article-intel-pilot)" ]] || { echo "commit release files first"; exit 1; }
git -C "$repo" merge-base --is-ancestor "$A" "$B" || { echo "UPGRADE_REHEARSAL=REFUSED CODE=STAGE1_NOT_ANCESTOR"; exit 1; }
for name in newsflux miniflux miniflux-db litellm; do
  if docker inspect "$name" >/dev/null 2>&1; then echo "UPGRADE_REHEARSAL=REFUSED CODE=CONTAINER_${name}_EXISTS (never run on a real host)"; exit 1; fi
done
work="$(mktemp -d /tmp/nf-upgrade.XXXXXX)"
CADDY_IMAGE=caddy:2.10.2-alpine
pass=0
fail=0
ok() { echo "UPGRADE_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "UPGRADE_GATE $1=FAIL"; fail=$((fail + 1)); }
cleanup() {
  docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.yaml" -f "$work/stack/compose.layer2.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f miniflux miniflux-db npm-front litellm >/dev/null 2>&1 || true
  docker network rm nfup-npm >/dev/null 2>&1 || true
  docker image rm -f "newsflux-summary:$A" "newsflux-reader:$A" "newsflux-summary:$B" "newsflux-reader:$B" \
    nfup-summary:previous nfup-reader:previous >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
mkdir -p "$work/stack" "$work/releases"

# Origin whose main is B (A is an ancestor), so both releases prepare from the same remote.
git init -q --bare "$work/origin.git"
git -C "$work/origin.git" fetch -q --depth=50 "file://$repo" "$B:refs/heads/main"
git -C "$work/origin.git" cat-file -e "$A" || { echo "UPGRADE_REHEARSAL=REFUSED CODE=STAGE1_NOT_IN_HISTORY"; exit 1; }
git -C "$repo" show "$A:deploy/release-governance/ai-functional-release.sh" >"$work/op-stage1.sh"

# ---- stand-in images ---------------------------------------------------------------------------
cat >"$work/summary.Caddyfile" <<'EOF'
:8788 {
	@me path /api/ai/v1/models
	handle /healthz {
		header Content-Type application/json
		respond `{"status":"ok"}` 200
	}
	@auth {
		path /api/ai/v1/models
		header X-NewsFlux-Miniflux-Server *
	}
	handle @auth {
		header Content-Type application/json
		respond `{"schema_version":"1","request_id":null,"error":{"code":"UNAUTHENTICATED","retryable":false}}` 401
	}
	handle @me {
		header Content-Type application/json
		respond `{"schema_version":"1","request_id":null,"error":{"code":"NOT_AUTHORIZED","retryable":false}}` 403
	}
	respond 404
}
EOF
mk_image() { # tag revision kind
  local dir="$work/img-${1//[:\/]/_}"
  mkdir -p "$dir"
  if [[ "$3" == summary ]]; then
    cp "$work/summary.Caddyfile" "$dir/Caddyfile"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY Caddyfile /etc/caddy/Caddyfile\nHEALTHCHECK --interval=1s --timeout=2s --retries=3 CMD wget -qO- http://127.0.0.1:8788/healthz | grep -q ok\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  else
    printf '<!doctype html><div id="root"></div><!-- %s %s -->\n' "$3" "$2" >"$dir/index.html"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY index.html /srv/index.html\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  fi
  docker build -q -t "$1" "$dir" >/dev/null
}
PREV="$(printf 'f%.0s' {1..40})"
mk_image nfup-summary:previous "$PREV" summary
mk_image nfup-reader:previous "$PREV" reader
for sha in "$A" "$B"; do
  mk_image "newsflux-summary:$sha" "$sha" summary
  mk_image "newsflux-reader:$sha" "$sha" reader
done

# ---- pre-Stage1 "production" ---------------------------------------------------------------------
git -C "$repo" show a398387905bf399ca767c6c25fa32b7fc00f3620:deploy/article-intel-pilot/Caddyfile >"$work/stack/Caddyfile"
[[ "$(sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1)" == "$PILOT_OLD" ]]
npm_ip=172.29.1.10
docker network create --subnet 172.29.1.0/24 nfup-npm >/dev/null
docker run -d --name miniflux --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name miniflux-db --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name litellm --network nfup-npm busybox:1.36.1 sleep 3600 >/dev/null
cat >"$work/stack/compose.yaml" <<EOF
services:
  newsflux:
    container_name: newsflux
    image: nfup-reader:previous
    environment:
      NEWSFLUX_PILOT_TRUSTED_PROXY_IP: $npm_ip
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
    networks: [npm, summary_private]
  summary-api:
    image: nfup-summary:previous
    environment:
      NEWSFLUX_AI_ALLOWED_WEB_ORIGINS: https://news.rehearsal.test
      NEWSFLUX_AI_MINIFLUX_BASE_URL: https://miniflux.rehearsal.test
      NEWSFLUX_AI_INFERENCE_ENABLED: "false"
    networks: [summary_private]
networks:
  npm: { external: true, name: nfup-npm }
  summary_private: { internal: true }
EOF
printf 'services:\n  summary-api:\n    environment:\n      LAYER: "2"\n' >"$work/stack/compose.layer2.yaml"
docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.yaml" -f "$work/stack/compose.layer2.yaml" up -d --wait >/dev/null
cat >"$work/npm.Caddyfile" <<'EOF'
{
	local_certs
}
news.rehearsal.test {
	tls internal
	reverse_proxy newsflux:2000 {
		header_up X-Forwarded-Proto https
	}
}
EOF
docker run -d --name npm-front --network nfup-npm --ip "$npm_ip" -v "$work/npm.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec npm-front test -f /data/caddy/pki/authorities/local/root.crt && break; sleep 1; done
docker cp npm-front:/data/caddy/pki/authorities/local/root.crt "$work/ca.crt" >/dev/null

export NEWSFLUX_REPO_URL="file://$work/origin.git" NEWSFLUX_RELEASE_ROOT="$work/releases" \
  NEWSFLUX_RELEASE_LOCK="$work/release.lock" NEWSFLUX_PUBLIC_CURL_RESOLVE="news.rehearsal.test:443:$npm_ip" \
  NEWSFLUX_PUBLIC_CURL_CACERT="$work/ca.crt"
opA() { APPROVED_SHA="$A" bash "$work/op-stage1.sh" "$@"; }
opB() { APPROVED_SHA="$B" bash "$here/ai-functional-release.sh" "$@"; }
identity() { # container -> image id, compose config hash, compose file sequence
  docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}} {{index .Config.Labels "com.docker.compose.project.config_files"}}' "$1"
}
summary_ctr() { docker ps -q --filter label=com.docker.compose.project=newsflux --filter label=com.docker.compose.service=summary-api; }
outside() { docker inspect -f '{{.Name}} {{.Id}} {{.Image}} {{.State.StartedAt}}' miniflux miniflux-db npm-front litellm; }
caddy_id() { stat -c '%i' "$work/stack/Caddyfile"; sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1; }
state() { docker ps -a --no-trunc --format '{{.ID}} {{.Image}} {{.Status}}' | sed 's/Up [^)]*/Up/' | sort; find "$work/releases" -printf '%p %s %T@\n' | sort; caddy_id; }
outside_before="$(outside)"

# ---- 1. Stage 1 with the operator script at A ----------------------------------------------------
{ opA prepare && opA preflight && opA promote-summary && opA update-caddy && opA promote-reader && opA smoke; } >"$work/stage1.out" 2>&1 \
  && ok STAGE1_INSTALLED_WITH_SCRIPT_A || { tail -5 "$work/stage1.out"; ko STAGE1_INSTALLED_WITH_SCRIPT_A; }
stage1_summary="$(identity "$(summary_ctr)")"
stage1_reader="$(identity newsflux)"
stage1_caddy="$(caddy_id)"
[[ "$(tail -1 <<<"$stage1_caddy")" != "$PILOT_OLD" ]] && ok STAGE1_PILOT_ROUTE_ACTIVE || ko STAGE1_PILOT_ROUTE_ACTIVE

# ---- 2. Upgrade to B --------------------------------------------------------------------------------
opB prepare >/dev/null && ok UPGRADE_PREPARE || ko UPGRADE_PREPARE
before="$(state)"
opB preflight >"$work/preflight.out" 2>&1 && ok UPGRADE_PREFLIGHT_ON_STAGE1 || { tail -3 "$work/preflight.out"; ko UPGRADE_PREFLIGHT_ON_STAGE1; }
[[ "$(state)" == "$before" ]] && ok UPGRADE_PREFLIGHT_READ_ONLY || ko UPGRADE_PREFLIGHT_READ_ONLY
[[ "$(opB s5-attestation-path)" == "$work/releases/ai-functional-${B:0:12}/s5-key-attestation.json" ]] \
  && ok ATTESTATION_PATH_IS_RELEASE_DIR || ko ATTESTATION_PATH_IS_RELEASE_DIR

opB promote-summary >/dev/null 2>&1 && ok UPGRADE_PROMOTE_SUMMARY || ko UPGRADE_PROMOTE_SUMMARY
# Summary-only is not a supported strategy: smoke demands both services on B.
if opB smoke >"$work/smoke-partial.out" 2>&1; then ko SUMMARY_ONLY_UPGRADE_FAILS_SMOKE; else
  grep -qx 'CODE=READER_REVISION' "$work/smoke-partial.out" && ok SUMMARY_ONLY_UPGRADE_FAILS_SMOKE || { tail -3 "$work/smoke-partial.out"; ko SUMMARY_ONLY_UPGRADE_FAILS_SMOKE; }
fi
opB update-caddy >"$work/caddy.out" 2>&1 && grep -qx 'CADDY_UPDATE=ALREADY_APPLIED' "$work/caddy.out" \
  && ok UPGRADE_CADDY_ALREADY_APPLIED || { cat "$work/caddy.out"; ko UPGRADE_CADDY_ALREADY_APPLIED; }
[[ "$(caddy_id)" == "$stage1_caddy" ]] && ok UPGRADE_CADDY_FILE_AND_INODE_UNCHANGED || ko UPGRADE_CADDY_FILE_AND_INODE_UNCHANGED
opB promote-reader >/dev/null 2>&1 && ok UPGRADE_PROMOTE_READER || ko UPGRADE_PROMOTE_READER
opB smoke >"$work/smoke.out" 2>&1 && grep -qx 'CATALOG_SMOKE=PASS' "$work/smoke.out" && ok UPGRADE_SMOKE_BOTH_ON_B || { tail -3 "$work/smoke.out"; ko UPGRADE_SMOKE_BOTH_ON_B; }
grep -qx 'INFERENCE_ENABLED=false' "$work/smoke.out" && ok INFERENCE_STILL_DISABLED || ko INFERENCE_STILL_DISABLED
[[ "$(outside)" == "$outside_before" ]] && ok OUTSIDE_SERVICES_UNCHANGED_AFTER_UPGRADE || ko OUTSIDE_SERVICES_UNCHANGED_AFTER_UPGRADE

# ---- 3. Rollback of B restores Stage 1 exactly ---------------------------------------------------
opB rollback-reader >/dev/null 2>&1 && ok ROLLBACK_READER || ko ROLLBACK_READER
opB rollback-caddy >"$work/rbcaddy.out" 2>&1 && grep -qx 'CADDY_ROLLBACK=NOT_APPLICABLE_UNCHANGED_BY_THIS_RELEASE' "$work/rbcaddy.out" \
  && ok ROLLBACK_CADDY_NOOP_VERIFIED || { cat "$work/rbcaddy.out"; ko ROLLBACK_CADDY_NOOP_VERIFIED; }
opB rollback-summary >/dev/null 2>&1 && ok ROLLBACK_SUMMARY || ko ROLLBACK_SUMMARY
[[ "$(identity "$(summary_ctr)")" == "$stage1_summary" ]] && ok SUMMARY_EXACTLY_STAGE1 || { echo "want $stage1_summary"; echo "got  $(identity "$(summary_ctr)")"; ko SUMMARY_EXACTLY_STAGE1; }
[[ "$(identity newsflux)" == "$stage1_reader" ]] && ok READER_EXACTLY_STAGE1 || { echo "want $stage1_reader"; echo "got  $(identity newsflux)"; ko READER_EXACTLY_STAGE1; }
[[ "$(caddy_id)" == "$stage1_caddy" ]] && ok CADDY_EXACTLY_STAGE1 || ko CADDY_EXACTLY_STAGE1
{ opB rollback-reader && opB rollback-caddy && opB rollback-summary; } >/dev/null 2>&1 \
  && [[ "$(identity "$(summary_ctr)")" == "$stage1_summary" && "$(identity newsflux)" == "$stage1_reader" ]] \
  && ok ROLLBACK_IDEMPOTENT || ko ROLLBACK_IDEMPOTENT
opA smoke >"$work/smoke-stage1.out" 2>&1 && ok STAGE1_SMOKE_PASSES_AFTER_ROLLBACK || { tail -3 "$work/smoke-stage1.out"; ko STAGE1_SMOKE_PASSES_AFTER_ROLLBACK; }

# A Caddyfile edited after the upgrade is reported, never silently "restored".
cp -p "$work/stack/Caddyfile" "$work/Caddyfile.keep"
printf '\n# drift\n' >>"$work/stack/Caddyfile"
if opB rollback-caddy >"$work/drift.out" 2>&1; then ko CADDY_DRIFT_DETECTED; else grep -qx 'CODE=DRIFT_SINCE_RELEASE' "$work/drift.out" && ok CADDY_DRIFT_DETECTED || ko CADDY_DRIFT_DETECTED; fi
cat "$work/Caddyfile.keep" >"$work/stack/Caddyfile"

# ---- 4. Nothing outside the release changed --------------------------------------------------------
[[ "$(outside)" == "$outside_before" ]] && ok MINIFLUX_NPM_LITELLM_UNCHANGED || ko MINIFLUX_NPM_LITELLM_UNCHANGED
[[ -z "$(docker network ls -q --filter name=wallhop)$(docker ps -aq --filter name=wallhop)" ]] && ok NO_WALLHOP_RESOURCES || ko NO_WALLHOP_RESOURCES

echo "UPGRADE_PASSED=$pass UPGRADE_FAILED=$fail"
[[ "$fail" -eq 0 ]]
