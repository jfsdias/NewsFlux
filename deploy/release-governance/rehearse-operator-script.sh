#!/usr/bin/env bash
# Disposable end-to-end rehearsal of ai-functional-release.sh with the production naming
# (project `newsflux`, service `summary-api`, Reader container `newsflux`, protected `miniflux`
# and `miniflux-db`), two ordered Summary Compose layers, the old pilot Caddyfile (6970ee…),
# and a TLS front standing in for NPM. Only local images are used (busybox, caddy).
#
# The Summary container is a Caddy stand-in that answers /healthz and the catalog's
# unauthenticated responses; the real Summary API behaviour is covered by its unit tests.
# `build` and `enable-s5` are not exercised here (no registry access, no Python image);
# config-only enablement is covered by test_release_docker.py.
#
#   sudo bash deploy/release-governance/rehearse-operator-script.sh
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
SHA="$(git -C "$repo" rev-parse HEAD)"
[[ -z "$(git -C "$repo" status --porcelain --untracked-files=no -- deploy/release-governance deploy/article-intel-pilot)" ]] || { echo "commit release files first"; exit 1; }
for name in newsflux miniflux miniflux-db; do
  if docker inspect "$name" >/dev/null 2>&1; then echo "REHEARSAL=REFUSED CODE=CONTAINER_${name}_EXISTS (never run on a real host)"; exit 1; fi
done
work="$(mktemp -d /tmp/nf-rehearsal.XXXXXX)"
CADDY_IMAGE=caddy:2.10.2-alpine
pass=0; fail=0
ok() { echo "REHEARSAL_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "REHEARSAL_GATE $1=FAIL"; fail=$((fail + 1)); }
cleanup() {
  docker compose -p newsflux --project-directory "$work/stack" -f "$work/stack/compose.yaml" -f "$work/stack/compose.layer2.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f miniflux miniflux-db npm-front >/dev/null 2>&1 || true
  docker network rm nfrh-npm >/dev/null 2>&1 || true
  docker image rm -f "newsflux-summary:$SHA" "newsflux-reader:$SHA" nfrh-summary:previous nfrh-reader:previous >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/stack" "$work/srv-prev" "$work/srv-new" "$work/releases"
# Exact source the operator script will clone (a bare repo whose main is this commit).
# Single-commit bare repo (works from shallow CI/sandbox checkouts too).
git init -q --bare "$work/origin.git"
git -C "$work/origin.git" fetch -q --depth=1 "file://$repo" "HEAD:refs/heads/main"
[[ "$(git -C "$work/origin.git" rev-parse main)" == "$SHA" ]]

# ---- images (local bases only) -------------------------------------------------------------
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
  local dir="$work/img-$1"; mkdir -p "$dir"
  if [[ "$3" == summary ]]; then
    cp "$work/summary.Caddyfile" "$dir/Caddyfile"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY Caddyfile /etc/caddy/Caddyfile\nHEALTHCHECK --interval=1s --timeout=2s --retries=3 CMD wget -qO- http://127.0.0.1:8788/healthz | grep -q ok\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  else
    printf '<!doctype html><div id="root"></div><!-- %s -->\n' "$3" >"$dir/index.html"
    printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY index.html /srv/index.html\n' "$CADDY_IMAGE" "$2" >"$dir/Dockerfile"
  fi
  docker build -q -t "$1" "$dir" >/dev/null
}
mk_image nfrh-summary:previous "$(printf 'a%.0s' {1..40})" summary
mk_image "newsflux-summary:$SHA" "$SHA" summary
mk_image nfrh-reader:previous "$(printf 'a%.0s' {1..40})" reader-previous
mk_image "newsflux-reader:$SHA" "$SHA" reader-new

# ---- "production" stack ----------------------------------------------------------------------
git -C "$repo" show a398387905bf399ca767c6c25fa32b7fc00f3620:deploy/article-intel-pilot/Caddyfile >"$work/stack/Caddyfile"
[[ "$(sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1)" == 6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108 ]]
npm_ip=172.29.0.10
docker network create --subnet 172.29.0.0/24 nfrh-npm >/dev/null
docker run -d --name miniflux --network nfrh-npm busybox:1.36.1 sleep 3600 >/dev/null
docker run -d --name miniflux-db --network nfrh-npm busybox:1.36.1 sleep 3600 >/dev/null
cat >"$work/stack/compose.yaml" <<EOF
services:
  newsflux:
    container_name: newsflux
    image: nfrh-reader:previous
    environment:
      NEWSFLUX_PILOT_TRUSTED_PROXY_IP: $npm_ip
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
    networks: [npm, summary_private]
  summary-api:
    image: nfrh-summary:previous
    environment:
      NEWSFLUX_AI_ALLOWED_WEB_ORIGINS: https://news.rehearsal.test
      NEWSFLUX_AI_MINIFLUX_BASE_URL: https://miniflux.rehearsal.test
      NEWSFLUX_AI_INFERENCE_ENABLED: "false"
    networks: [summary_private]
networks:
  npm: { external: true, name: nfrh-npm }
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
docker run -d --name npm-front --network nfrh-npm --ip "$npm_ip" -v "$work/npm.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec npm-front test -f /data/caddy/pki/authorities/local/root.crt && break; sleep 1; done
docker cp npm-front:/data/caddy/pki/authorities/local/root.crt "$work/ca.crt" >/dev/null

summary_before="$(docker inspect -f '{{.Id}} {{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-summary-api-1)"
reader_before="$(docker inspect -f '{{.Id}} {{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux)"
protected_before="$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)"

export APPROVED_SHA="$SHA" NEWSFLUX_REPO_URL="file://$work/origin.git" NEWSFLUX_RELEASE_ROOT="$work/releases" \
  NEWSFLUX_RELEASE_LOCK="$work/release.lock" NEWSFLUX_PUBLIC_CURL_RESOLVE="news.rehearsal.test:443:$npm_ip" \
  NEWSFLUX_PUBLIC_CURL_CACERT="$work/ca.crt"
op() { bash "$here/ai-functional-release.sh" "$@"; }
state() { docker ps -a --no-trunc --format '{{.ID}} {{.Image}} {{.Status}}' | sed 's/Up [^)]*/Up/' | sort; find "$work/releases" -printf '%p %s %T@\n' | sort; sha256sum "$work/stack/Caddyfile"; }

op prepare >/dev/null && ok PREPARE || ko PREPARE
before="$(state)"
op preflight >"$work/preflight.out" && ok PREFLIGHT_PASS || { cat "$work/preflight.out"; ko PREFLIGHT_PASS; }
[[ "$(state)" == "$before" ]] && ok PREFLIGHT_READ_ONLY || ko PREFLIGHT_READ_ONLY
grep -q '^SUMMARY_COMPOSE_FILES=2$' "$work/preflight.out" && ok PREFLIGHT_SEES_ALL_COMPOSE_LAYERS || ko PREFLIGHT_SEES_ALL_COMPOSE_LAYERS

op promote-summary >/dev/null && ok PROMOTE_SUMMARY || ko PROMOTE_SUMMARY
labels="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' newsflux-summary-api-1)"
[[ "$labels" == "$work/stack/compose.yaml,$work/stack/compose.layer2.yaml,$work/releases/"*"/summary-api/candidate.override.json" ]] && ok SUMMARY_LAYERS_PRESERVED || ko SUMMARY_LAYERS_PRESERVED
# Catalog smoke must fail closed while the Caddy route is still missing (Caddy's plain 403).
if op smoke >"$work/smoke-early.out" 2>&1; then ko CATALOG_SMOKE_FAILS_WITHOUT_ROUTE; else grep -q 'CODE=NOT_SUMMARY_API_RESPONSE\|CODE=READER_REVISION' "$work/smoke-early.out" && ok CATALOG_SMOKE_FAILS_WITHOUT_ROUTE || { cat "$work/smoke-early.out"; ko CATALOG_SMOKE_FAILS_WITHOUT_ROUTE; }; fi
op update-caddy >/dev/null && ok UPDATE_CADDY || ko UPDATE_CADDY
op promote-reader >/dev/null && ok PROMOTE_READER || ko PROMOTE_READER
op smoke >"$work/smoke.out" && ok SMOKE || { cat "$work/smoke.out"; ko SMOKE; }
grep -q '^CATALOG_SMOKE=PASS$' "$work/smoke.out" && ok CATALOG_SMOKE || ko CATALOG_SMOKE
[[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected_before" ]] && ok PROTECTED_UNCHANGED || ko PROTECTED_UNCHANGED

op rollback-reader >/dev/null && ok ROLLBACK_READER || ko ROLLBACK_READER
op rollback-caddy >/dev/null && ok ROLLBACK_CADDY || ko ROLLBACK_CADDY
op rollback-summary >/dev/null && ok ROLLBACK_SUMMARY || ko ROLLBACK_SUMMARY
[[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-summary-api-1)" == "$(cut -d' ' -f2- <<<"$summary_before")" ]] && ok SUMMARY_IMAGE_AND_CONFIG_RESTORED || ko SUMMARY_IMAGE_AND_CONFIG_RESTORED
[[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux)" == "$(cut -d' ' -f2- <<<"$reader_before")" ]] && ok READER_IMAGE_AND_CONFIG_RESTORED || ko READER_IMAGE_AND_CONFIG_RESTORED
[[ "$(sha256sum "$work/stack/Caddyfile" | cut -d' ' -f1)" == 6970ee2b48b3c2e904a3a7fb5460afcb2fcad6e3647b55b812b68a1c1fdc9108 ]] && ok CADDY_RESTORED || ko CADDY_RESTORED
op rollback-summary >/dev/null && ok ROLLBACK_IDEMPOTENT || ko ROLLBACK_IDEMPOTENT
[[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected_before" ]] && ok PROTECTED_UNCHANGED_AFTER_ROLLBACK || ko PROTECTED_UNCHANGED_AFTER_ROLLBACK

# A Reader candidate that does not serve the app is rolled back automatically.
printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nRUN rm -rf /srv && mkdir /srv\n' "$CADDY_IMAGE" "$SHA" | docker build -q -t "newsflux-reader:$SHA" - >/dev/null
rm -rf "$work/releases/"*/newsflux
if op promote-reader >"$work/bad.out" 2>&1; then ko BROKEN_READER_ROLLED_BACK; else
  grep -q 'PROMOTION_FAILED_ROLLED_BACK:READINESS_FAILED' "$work/bad.out" && [[ "$(docker inspect -f '{{.Image}}' newsflux)" == "$(cut -d' ' -f2 <<<"$reader_before")" ]] && ok BROKEN_READER_ROLLED_BACK || { cat "$work/bad.out"; ko BROKEN_READER_ROLLED_BACK; }
fi

echo "REHEARSAL_PASSED=$pass REHEARSAL_FAILED=$fail"
[[ "$fail" -eq 0 ]]
