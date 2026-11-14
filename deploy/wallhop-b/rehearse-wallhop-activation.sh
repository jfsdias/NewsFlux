#!/usr/bin/env bash
# Disposable rehearsal of wallhop-activation.sh against production-shaped, SEPARATE Compose projects:
#   `newsflux` (Reader, pilot Caddyfile bind mount), `newsflux-pr188-p2b-minimal` (REAL sidecar image on the
#   shared NPM network with a published port, as today), protected `miniflux` (synthetic, p1-r2 fixture) and
#   `miniflux-db`, an NPM TLS stand-in, and a synthetic TLS "wallhop.io". Throwaway CA; no real WallHop.
# The external gates are exercised with missing, incomplete and paywalled evidence (must BLOCK), then with
# synthetic evidence for the synthetic domain only (rehearsal), followed by a full exact rollback.
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(git -C "$here" rev-parse --show-toplevel)"
SHA="$(git -C "$repo" rev-parse HEAD)"
for name in newsflux newsflux-pr188-content-fallback miniflux miniflux-db; do
  docker inspect "$name" >/dev/null 2>&1 && { echo "WALLHOP_REHEARSAL=REFUSED ($name exists)"; exit 1; }
done
run="nfa$RANDOM"; work="$(mktemp -d /tmp/nfa.XXXXXX)"; chmod 755 "$work"
CADDY_IMAGE=caddy:2.10.2-alpine; PY_IMAGE=python:3.12-slim
pass=0; fail=0
ok() { echo "ACTIVATION_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "ACTIVATION_GATE $1=FAIL${2:+ ($2)}"; fail=$((fail + 1)); }
NPM_NET="$run-npm"
cleanup() {
  [[ -n "${KEEP:-}" ]] && { echo "KEPT run=$run work=$work"; return; }
  docker compose -p newsflux --project-directory "$work/newsflux" -f "$work/newsflux/compose.yaml" down -v >/dev/null 2>&1 || true
  docker compose -p newsflux-pr188-p2b-minimal --project-directory "$work/sidecar" -f "$work/sidecar/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true
  docker rm -f miniflux miniflux-db "$run-front" "$run-wallhop" >/dev/null 2>&1 || true
  docker ps -aq --filter label=com.docker.compose.service=wallhop-egress | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker network rm newsflux_wallhop_reader newsflux_wallhop_egress "$NPM_NET" >/dev/null 2>&1 || true
  docker image rm -f "$run-sidecar:test" "$run-reader:prev" "$run-reader:new" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# ---- source remote, certificates, images ---------------------------------------------------------------
git init -q --bare "$work/origin.git"; git -C "$work/origin.git" fetch -q --depth=1 "file://$repo" "HEAD:refs/heads/main"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$run-ca" -keyout "$work/ca.key" -out "$work/ca.crt" 2>/dev/null
leaf() {
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout "$work/$1.key" -out "$work/$1.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$1" >"$work/$1.ext"
  openssl x509 -req -in "$work/$1.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial -days 1 -extfile "$work/$1.ext" -out "$work/$1.crt" 2>/dev/null
}
for h in wallhop.io miniflux.rehearsal.test news.rehearsal.test; do leaf "$h"; done; chmod 644 "$work"/*.crt "$work"/*.key
docker build -q -f "$repo/services/content_fallback/Dockerfile" -t "$run-sidecar:test" "$repo" >/dev/null
for kind in prev new; do
  mkdir -p "$work/img-$kind"; printf '<!doctype html><div id="root"></div><!-- %s -->\n' "$kind" >"$work/img-$kind/index.html"
  rev="$SHA"; [[ "$kind" == prev ]] && rev="$(printf 'a%.0s' {1..40})"
  printf 'FROM %s\nLABEL org.opencontainers.image.revision=%s\nCOPY index.html /srv/index.html\n' "$CADDY_IMAGE" "$rev" >"$work/img-$kind/Dockerfile"
  docker build -q -t "$run-reader:$kind" "$work/img-$kind" >/dev/null
done

# ---- production-shaped state ---------------------------------------------------------------------------
docker network create --subnet 172.30.88.0/24 "$NPM_NET" >/dev/null
FRONT_IP=172.30.88.10
USER_KEY="synthetic-user-key-$RANDOM$RANDOM"
docker run -d --name miniflux --network "$NPM_NET" -e NEWSFLUX_TEST_USER_KEY="$USER_KEY" -e NEWSFLUX_TEST_ROTATED_KEY="r-$USER_KEY" \
  -e NEWSFLUX_TEST_OTHER_USER_KEY="o-$USER_KEY" -e NEWSFLUX_TEST_ADMIN_KEY="a-$USER_KEY" \
  -v "$repo/scripts/reader-wallhop-p1-r2/fixture_server.py:/srv/f.py:ro" "$PY_IMAGE" python /srv/f.py >/dev/null
docker run -d --name miniflux-db --network "$NPM_NET" busybox:1.36.1 sleep 3600 >/dev/null
cat >"$work/front.Caddyfile" <<C
https://news.rehearsal.test:443 {
	tls /certs/news.rehearsal.test.crt /certs/news.rehearsal.test.key
	reverse_proxy newsflux:2000 {
		header_up X-Forwarded-Proto https
	}
}
https://miniflux.rehearsal.test:443 {
	tls /certs/miniflux.rehearsal.test.crt /certs/miniflux.rehearsal.test.key
	reverse_proxy miniflux:8080
}
C
docker run -d --name "$run-front" --network "$NPM_NET" --ip "$FRONT_IP" --network-alias npm -v "$work:/certs:ro" -v "$work/front.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
sed -n '/^PARAS = \[/,/^server.serve_forever()/p' "$here/rehearse-reader-recovery.sh" | sed '1i import http.server, ssl, sys' >"$work/wallhop.py"
docker run -d --name "$run-wallhop" --network "$NPM_NET" --network-alias wallhop-origin -v "$work:/certs:ro" -v "$work/wallhop.py:/srv/w.py:ro" "$PY_IMAGE" python -u /srv/w.py >/dev/null
mkdir -p "$work/newsflux" "$work/sidecar" "$work/sidecar-data"; chmod 777 "$work/sidecar-data"
git -C "$repo" show HEAD:deploy/article-intel-pilot/Caddyfile >"$work/newsflux/Caddyfile"
cat >"$work/newsflux/compose.yaml" <<Y
services:
  newsflux:
    container_name: newsflux
    image: $run-reader:prev
    environment: { NEWSFLUX_PILOT_TRUSTED_PROXY_IP: "$FRONT_IP" }
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
    networks: [npm]
networks:
  npm: { external: true, name: $NPM_NET }
Y
cat >"$work/sidecar/compose.yaml" <<Y
services:
  content-fallback:
    container_name: newsflux-pr188-content-fallback
    image: $run-sidecar:test
    ports: ["127.0.0.1:18790:8790"]
    environment:
      MINIFLUX_BASE_URL: http://miniflux:8080
      MINIFLUX_API_TOKEN: "$USER_KEY"
      CONTENT_FALLBACK_API_TOKEN: "$(head -c 32 /dev/urandom | base64 | tr -d '/+=')"
      CONTENT_FALLBACK_HOST: 0.0.0.0
      CONTENT_FALLBACK_POLICIES_JSON: '{}'
    volumes: ["$work/sidecar-data:/data"]
    networks: [npm]
networks:
  npm: { external: true, name: $NPM_NET }
Y
docker compose -p newsflux --project-directory "$work/newsflux" -f "$work/newsflux/compose.yaml" up -d >/dev/null
docker compose -p newsflux-pr188-p2b-minimal --project-directory "$work/sidecar" -f "$work/sidecar/compose.yaml" up -d --wait >/dev/null
cat >"$work/rehearsal.override.yaml" <<Y
services:
  content-fallback:
    environment: { SSL_CERT_FILE: /certs/ca.crt }
    volumes: ["$work:/certs:ro"]
    extra_hosts: ["publisher.example.test:93.184.216.34"]
Y
sidecar_before="$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-pr188-content-fallback)"
reader_before="$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux)"
caddy_before="$(sha256sum "$work/newsflux/Caddyfile" | cut -d' ' -f1)"
protected_before="$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)"

export APPROVED_SHA="$SHA" NEWSFLUX_REPO_URL="file://$work/origin.git" NEWSFLUX_RELEASE_ROOT="$work/releases" \
  NEWSFLUX_RELEASE_LOCK="$work/release.lock" WALLHOP_NPM_NETWORK="$NPM_NET" \
  WALLHOP_MINIFLUX_PUBLIC_URL=https://miniflux.rehearsal.test WALLHOP_ALLOWED_WEB_ORIGINS=https://news.rehearsal.test \
  WALLHOP_READER_USER_ID=7 WALLHOP_UPSTREAM=wallhop-origin:443 WALLHOP_HAPROXY_IMAGE=haproxy:3.0.5-alpine \
  WALLHOP_READER_IMAGE="$(docker image inspect -f '{{.Id}}' "$run-reader:new")" WALLHOP_REHEARSAL_OVERRIDE="$work/rehearsal.override.yaml"
op() { bash "$here/wallhop-activation.sh" "$@"; }
recover() {
  curl -sS --noproxy '*' --max-time 30 --resolve "news.rehearsal.test:443:$FRONT_IP" --cacert "$work/ca.crt" -o "$work/out.json" -w '%{http_code}' \
    -X POST https://news.rehearsal.test/api/content-fallback/reader/v1/entries/501/recover -H "Origin: https://news.rehearsal.test" \
    -H "X-Miniflux-API-Key: $USER_KEY" -H "X-NewsFlux-Miniflux-Server: https://miniflux.rehearsal.test" || echo 000
}
snapshot() { docker ps -a --no-trunc --format '{{.ID}} {{.Image}}' | sort; docker network ls -q | sort; find "$work/releases" -printf '%p %s\n' 2>/dev/null | sort; sha256sum "$work/newsflux/Caddyfile"; }

op prepare >/dev/null && ok PREPARE || ko PREPARE
before="$(snapshot)"; out="$(op preflight 2>&1)" && ok PREFLIGHT || { echo "$out"; ko PREFLIGHT; }
[[ "$(snapshot)" == "$before" ]] && ok PREFLIGHT_READ_ONLY || ko PREFLIGHT_READ_ONLY
grep -q 'SOURCE_POLICY_GATE=BLOCKED' <<<"$out" && grep -q 'WALLHOP_REAL_CONTRACT_GATE=BLOCKED' <<<"$out" && ok GATES_BLOCKED_BY_DEFAULT || ko GATES_BLOCKED_BY_DEFAULT
op enable-policy >/dev/null 2>&1 && ko ENABLE_REFUSED_WITHOUT_EVIDENCE || ok ENABLE_REFUSED_WITHOUT_EVIDENCE

op activate-infra >"$work/act.out" 2>&1 && ok ACTIVATE_INFRA || { cat "$work/act.out"; ko ACTIVATE_INFRA; }
nets="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' newsflux-pr188-content-fallback | xargs -n1 | sort | xargs)"
[[ "$nets" == "newsflux_wallhop_egress newsflux_wallhop_reader" ]] && ok SIDECAR_LEFT_SHARED_NETWORK || ko SIDECAR_LEFT_SHARED_NETWORK "$nets"
[[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' newsflux-pr188-content-fallback)" == 0 ]] && ok SIDECAR_PORT_REMOVED || ko SIDECAR_PORT_REMOVED
op smoke >/dev/null 2>&1 && ok SMOKE_ISOLATION || ko SMOKE_ISOLATION
st="$(recover)"; python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if d.get("status")!="recovered" else 1)' "$work/out.json" 2>/dev/null \
  && ok POLICY_DISABLED_NO_RECOVERY || ko POLICY_DISABLED_NO_RECOVERY "status=$st"

cat >"$work/partial.json" <<'J'
{"version":"wallhop-approved-sources-v1","approved_by":"rehearsal","approved_at":"2026-11-14","sources":[{"domain":"publisher.example.test","public_without_login":true,"terms_permit_automated_retrieval":true,"terms_reviewed_url":"https://publisher.example.test/terms"}]}
J
cat >"$work/paywalled.json" <<'J'
{"version":"wallhop-approved-sources-v1","approved_by":"rehearsal","approved_at":"2026-11-14","sources":[{"domain":"www.nytimes.com","public_without_login":true,"terms_permit_automated_retrieval":true,"terms_reviewed_url":"https://www.nytimes.com/terms"}]}
J
cat >"$work/contract.json" <<'J'
{"version":"wallhop-contract-evidence-v1","checked_by":"rehearsal","checked_at":"2026-11-14","endpoint":"https://wallhop.io/raw/","http_status":200,"content_type":"text/html; charset=utf-8","sample_domain":"publisher.example.test","terms_reviewed":true,"no_credentials_or_cookies_used":true}
J
pw="$(WALLHOP_APPROVED_SOURCES="$work/paywalled.json" WALLHOP_CONTRACT_EVIDENCE="$work/contract.json" op enable-policy 2>&1 || true)"
grep -q 'SOURCE_POLICY_GATE=BLOCKED CODE=PAYWALLED_SOURCE' <<<"$pw" && ok PAYWALLED_SOURCE_REFUSED || ko PAYWALLED_SOURCE_REFUSED "$pw"
WALLHOP_APPROVED_SOURCES="$work/partial.json" op enable-policy >/dev/null 2>&1 && ko CONTRACT_EVIDENCE_REQUIRED || ok CONTRACT_EVIDENCE_REQUIRED
WALLHOP_APPROVED_SOURCES="$work/partial.json" WALLHOP_CONTRACT_EVIDENCE="$work/contract.json" op enable-policy >/dev/null 2>&1 && ok ENABLE_WITH_SYNTHETIC_EVIDENCE || ko ENABLE_WITH_SYNTHETIC_EVIDENCE
st="$(recover)"
[[ "$st" == 200 ]] && python3 - "$work/out.json" <<'PY' && ok READER_RECOVERY_E2E || ko READER_RECOVERY_E2E "status=$st"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["status"] == "recovered" and d["content_origin"] == "wallhop" and "<script" not in d["content_html"]
PY
writes="$(docker exec miniflux python -c "import json,urllib.request;print(len(json.load(urllib.request.urlopen('http://127.0.0.1:8080/__harness__/state'))['writes']))" 2>/dev/null || echo x)"
[[ "$writes" == 0 ]] && ok NO_MINIFLUX_WRITES || ko NO_MINIFLUX_WRITES "$writes"

op rollback >"$work/rb.out" 2>&1 && ok ROLLBACK || { cat "$work/rb.out"; ko ROLLBACK; }
[[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-pr188-content-fallback)" == "$sidecar_before" ]] && ok SIDECAR_EXACT_RESTORE || ko SIDECAR_EXACT_RESTORE
[[ "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' newsflux-pr188-content-fallback)" == "$NPM_NET" ]] && ok SIDECAR_NETWORK_RESTORED || ko SIDECAR_NETWORK_RESTORED
[[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux)" == "$reader_before" ]] && ok READER_EXACT_RESTORE || ko READER_EXACT_RESTORE
[[ "$(sha256sum "$work/newsflux/Caddyfile" | cut -d' ' -f1)" == "$caddy_before" ]] && ok CADDY_RESTORED || ko CADDY_RESTORED
! docker network inspect newsflux_wallhop_reader >/dev/null 2>&1 && ! docker network inspect newsflux_wallhop_egress >/dev/null 2>&1 && ok NETWORKS_REMOVED || ko NETWORKS_REMOVED
[[ -z "$(docker ps -aq --filter label=com.docker.compose.service=wallhop-egress)" ]] && ok RELAY_REMOVED || ko RELAY_REMOVED
[[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected_before" ]] && ok PROTECTED_UNCHANGED || ko PROTECTED_UNCHANGED
op rollback >/dev/null 2>&1 && ok ROLLBACK_IDEMPOTENT || ko ROLLBACK_IDEMPOTENT
echo "ACTIVATION_PASSED=$pass ACTIVATION_FAILED=$fail"
[[ "$fail" -eq 0 ]]
