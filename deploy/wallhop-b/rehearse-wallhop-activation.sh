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
for net in newsflux_wallhop_reader newsflux_wallhop_egress; do
  docker network inspect "$net" >/dev/null 2>&1 && { echo "WALLHOP_REHEARSAL=REFUSED (network $net exists)"; exit 1; }
done
[[ -z "$(docker ps -aq --filter label=com.docker.compose.project=newsflux-pr188-p2b-minimal)" ]] || { echo "WALLHOP_REHEARSAL=REFUSED (sidecar project exists)"; exit 1; }
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
  # Scoped: only the relay labelled with THIS run, and only networks this run was allowed to create.
  docker ps -aq --filter "label=org.newsflux.rehearsal=$run" | xargs -r docker rm -f >/dev/null 2>&1 || true
  for net in newsflux_wallhop_reader newsflux_wallhop_egress; do
    [[ "$(docker network inspect -f '{{index .Labels "org.newsflux.wallhop"}}' "$net" 2>/dev/null)" == 1 ]] && docker network rm "$net" >/dev/null 2>&1
  done
  docker network rm "$NPM_NET" >/dev/null 2>&1 || true
  # The decoy is removed by its own ID only; prove it survived the scoped cleanup above.
  if [[ -n "${DECOY:-}" ]]; then
    [[ "$(docker inspect -f '{{.State.Running}}' "$DECOY" 2>/dev/null)" == true ]] && echo "CLEANUP_SCOPE=PASS" || echo "CLEANUP_SCOPE=FAIL"
    docker rm -f "$DECOY" >/dev/null 2>&1 || true
  fi
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
# Decoy: an unrelated project's relay. Neither the procedure nor this rehearsal's cleanup may touch it.
DECOY="$(docker run -d --label com.docker.compose.project=unrelated-project --label com.docker.compose.service=wallhop-egress busybox:1.36.1 sleep 3600)"
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
  wallhop-egress:
    labels: { org.newsflux.rehearsal: "$run" }
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
# Synthetic NPM proxy-host directory (read-only for the procedure): one unrelated host by default.
mkdir -p "$work/npm-proxy-host"
printf 'server {\n  set $server "unrelated-app";\n  proxy_pass http://$server:8080;\n}\n' >"$work/npm-proxy-host/37.conf"
export WALLHOP_NPM_PROXY_HOST_DIR="$work/npm-proxy-host"
op() { bash "${WALLHOP_ACTIVATION_SCRIPT:-$here/wallhop-activation.sh}" "$@"; }
recover() {
  curl -sS --noproxy '*' --max-time 30 --resolve "news.rehearsal.test:443:$FRONT_IP" --cacert "$work/ca.crt" -o "$work/out.json" -w '%{http_code}' \
    -X POST https://news.rehearsal.test/api/content-fallback/reader/v1/entries/501/recover -H "Origin: https://news.rehearsal.test" \
    -H "X-Miniflux-API-Key: $USER_KEY" -H "X-NewsFlux-Miniflux-Server: https://miniflux.rehearsal.test" || echo 000
}
snapshot() { docker ps -a --no-trunc --format '{{.ID}} {{.Image}}' | sort; docker network ls -q | sort; find "$work/releases" -printf '%p %s\n' 2>/dev/null | sort; sha256sum "$work/newsflux/Caddyfile"; }

baseline_ok() { # exact restoration of everything the procedure may touch
  [[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-pr188-content-fallback)" == "$sidecar_before" ]] &&
  [[ "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' newsflux-pr188-content-fallback)" == "$NPM_NET" ]] &&
  [[ "$(docker inspect -f '{{len .HostConfig.PortBindings}}' newsflux-pr188-content-fallback)" == 1 ]] &&
  [[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux)" == "$reader_before" ]] &&
  [[ "$(sha256sum "$work/newsflux/Caddyfile" | cut -d' ' -f1)" == "$caddy_before" ]] &&
  ! docker network inspect newsflux_wallhop_reader >/dev/null 2>&1 && ! docker network inspect newsflux_wallhop_egress >/dev/null 2>&1 &&
  [[ -z "$(docker ps -aq --filter "label=org.newsflux.rehearsal=$run")" ]] &&
  [[ "$(docker inspect -f '{{.Id}} {{.Image}}' miniflux miniflux-db)" == "$protected_before" ]]
}
reset_release() { rm -rf "$work"/releases/wallhop-*/baseline "$work"/releases/wallhop-*/reader "$work"/releases/wallhop-*/*.yaml; }

op prepare >/dev/null && ok PREPARE || ko PREPARE
before="$(snapshot)"; out="$(op preflight 2>&1)" && ok PREFLIGHT || { echo "$out"; ko PREFLIGHT; }
[[ "$(snapshot)" == "$before" ]] && ok PREFLIGHT_READ_ONLY || ko PREFLIGHT_READ_ONLY
grep -q 'SOURCE_POLICY_GATE=BLOCKED' <<<"$out" && grep -q 'WALLHOP_REAL_CONTRACT_GATE=BLOCKED' <<<"$out" && ok GATES_BLOCKED_BY_DEFAULT || ko GATES_BLOCKED_BY_DEFAULT
WALLHOP_REHEARSAL_OVERRIDE= WALLHOP_TEST_FAULT=network_create op preflight >/dev/null 2>&1 && ko FAULT_INJECTION_REFUSED_OUTSIDE_REHEARSAL || ok FAULT_INJECTION_REFUSED_OUTSIDE_REHEARSAL
op enable-policy >/dev/null 2>&1 && ko ENABLE_REFUSED_WITHOUT_EVIDENCE || ok ENABLE_REFUSED_WITHOUT_EVIDENCE

# ---- 0a. NPM upstream gate: an NPM proxy host that still targets the sidecar blocks before any change ----
reset_release
npm_conf_before="$(sha256sum "$work"/npm-proxy-host/*.conf)"
set +e; WALLHOP_NPM_PROXY_HOST_DIR= op activate-infra >"$work/npm0.out" 2>&1; rc=$?; set -e
[[ "$rc" == 1 ]] && grep -q '^CODE=NPM_UPSTREAM_DEPENDENCY' "$work/npm0.out" && grep -q 'NPM_PROXY_HOSTS_NOT_VERIFIED' "$work/npm0.out" && baseline_ok \
  && ok NPM_UPSTREAMS_NOT_VERIFIED_BLOCKS || { cat "$work/npm0.out"; ko NPM_UPSTREAMS_NOT_VERIFIED_BLOCKS "rc=$rc"; }
printf 'server {\n  set $server "newsflux-pr188-content-fallback";\n  proxy_pass http://$server:8080;\n}\n' >"$work/npm-proxy-host/111.conf"
set +e; op activate-infra >"$work/npm1.out" 2>&1; rc=$?; set -e
[[ "$rc" == 1 ]] && grep -q '^NPM_UPSTREAM_REFERENCE=111.conf$' "$work/npm1.out" && grep -q '^CODE=NPM_UPSTREAM_DEPENDENCY' "$work/npm1.out" && baseline_ok \
  && ok NPM_HOST_TARGETING_SIDECAR_BLOCKS || { cat "$work/npm1.out"; ko NPM_HOST_TARGETING_SIDECAR_BLOCKS "rc=$rc"; }
grep -q 'newsflux-pr188-content-fallback' "$work/npm1.out" && ko NPM_CONF_CONTENT_NOT_PRINTED || ok NPM_CONF_CONTENT_NOT_PRINTED
printf 'server {\n  # set $server "newsflux-pr188-content-fallback";  (retired)\n  set $server "unrelated-app";\n}\n' >"$work/npm-proxy-host/111.conf"
op preflight 2>/dev/null | grep -qx 'NPM_UPSTREAM_GATE=PASS' && ok NPM_COMMENTED_REFERENCE_IGNORED || ko NPM_COMMENTED_REFERENCE_IGNORED
rm -f "$work/npm-proxy-host/111.conf"
[[ "$(sha256sum "$work"/npm-proxy-host/*.conf)" == "$npm_conf_before" ]] && ok NPM_CONF_NEVER_MODIFIED || ko NPM_CONF_NEVER_MODIFIED

# ---- 0. REAL fault (no injection): relay image unavailable after the networks were created ---------------
reset_release
set +e; WALLHOP_HAPROXY_IMAGE="$run-missing:none" op activate-infra >"$work/real.out" 2>&1; rc=$?; set -e
[[ "$rc" == 1 ]] && baseline_ok && ok REAL_FAULT_RELAY_IMAGE_ROLLS_BACK || { tail -5 "$work/real.out"; ko REAL_FAULT_RELAY_IMAGE_ROLLS_BACK "rc=$rc"; op rollback >/dev/null 2>&1 || true
  for net in newsflux_wallhop_reader newsflux_wallhop_egress; do docker network rm "$net" >/dev/null 2>&1 || true; done; }

# ---- 1. any activation stage failing => automatic rollback to the exact baseline, exit 1 ----------------
for f in network_create relay_up sidecar_up reader_plan reader_promote caddy_validate caddy_reload; do
  reset_release
  set +e; WALLHOP_TEST_FAULT="$f" op activate-infra >"$work/f.out" 2>&1; rc=$?; set -e
  if [[ "$rc" == 1 ]] && grep -q 'ACTIVATE_INFRA=FAILED' "$work/f.out" && grep -q '^ROLLBACK=PASS' "$work/f.out" && baseline_ok; then
    ok "AUTO_ROLLBACK_ON_${f^^}"
  else cat "$work/f.out"; ko "AUTO_ROLLBACK_ON_${f^^}" "rc=$rc"; fi
done

# ---- 2. rollback-stage failures => ROLLBACK_PARTIAL, non-zero, evidence kept; a clean re-run restores -----
for f in rollback_caddy rollback_reader rollback_sidecar rollback_relay rollback_network; do
  reset_release
  op activate-infra >/dev/null 2>&1 || ko "SETUP_FOR_${f^^}"
  set +e; WALLHOP_TEST_FAULT="$f" op rollback >"$work/r.out" 2>&1; rc=$?; set -e
  if [[ "$rc" == 2 ]] && grep -q '^ROLLBACK=PARTIAL' "$work/r.out" && grep -q 'FAILURES=.' "$work"/releases/wallhop-*/rollback-receipt.txt; then
    ok "PARTIAL_ROLLBACK_REPORTED_${f^^}"
  else cat "$work/r.out"; ko "PARTIAL_ROLLBACK_REPORTED_${f^^}" "rc=$rc"; fi
  op rollback >/dev/null 2>&1 && baseline_ok && ok "RECOVERY_AFTER_${f^^}" || ko "RECOVERY_AFTER_${f^^}"
done

# ---- 3. full happy path, policy enable failure restores the disabled policy, then exact rollback ----------
reset_release
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
grep -q 'SOURCE_POLICY_GATE=BLOCKED CODE=PAYWALLED_SOURCE' <<<"$pw" && ok PAYWALLED_SOURCE_REFUSED || ko PAYWALLED_SOURCE_REFUSED
WALLHOP_APPROVED_SOURCES="$work/partial.json" op enable-policy >/dev/null 2>&1 && ko CONTRACT_EVIDENCE_REQUIRED || ok CONTRACT_EVIDENCE_REQUIRED
disabled_id="$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-pr188-content-fallback)"
set +e; WALLHOP_TEST_FAULT=policy_sidecar_ready WALLHOP_APPROVED_SOURCES="$work/partial.json" WALLHOP_CONTRACT_EVIDENCE="$work/contract.json" op enable-policy >"$work/p.out" 2>&1; rc=$?; set -e
[[ "$rc" == 1 ]] && grep -q 'POLICY_RESTORED_DISABLED=PASS' "$work/p.out" \
  && [[ "$(docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' newsflux-pr188-content-fallback)" == "$disabled_id" ]] \
  && ok POLICY_FAILURE_RESTORES_DISABLED || { cat "$work/p.out"; ko POLICY_FAILURE_RESTORES_DISABLED "rc=$rc"; }
st="$(recover)"; python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));sys.exit(0 if d.get("status")!="recovered" else 1)' "$work/out.json" 2>/dev/null \
  && ok NO_RECOVERY_AFTER_POLICY_FAILURE || ko NO_RECOVERY_AFTER_POLICY_FAILURE "status=$st"
WALLHOP_APPROVED_SOURCES="$work/partial.json" WALLHOP_CONTRACT_EVIDENCE="$work/contract.json" op enable-policy >/dev/null 2>&1 && ok ENABLE_WITH_SYNTHETIC_EVIDENCE || ko ENABLE_WITH_SYNTHETIC_EVIDENCE
st="$(recover)"
[[ "$st" == 200 ]] && python3 - "$work/out.json" <<'PY' && ok READER_RECOVERY_E2E || ko READER_RECOVERY_E2E "status=$st"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["status"] == "recovered" and d["content_origin"] == "wallhop" and "<script" not in d["content_html"]
PY
writes="$(docker exec miniflux python -c "import json,urllib.request;print(len(json.load(urllib.request.urlopen('http://127.0.0.1:8080/__harness__/state'))['writes']))" 2>/dev/null || echo x)"
[[ "$writes" == 0 ]] && ok NO_MINIFLUX_WRITES || ko NO_MINIFLUX_WRITES "$writes"
op rollback >"$work/rb.out" 2>&1 && grep -q '^ROLLBACK=PASS' "$work/rb.out" && baseline_ok && ok EXACT_ROLLBACK || { cat "$work/rb.out"; ko EXACT_ROLLBACK; }
op rollback >/dev/null 2>&1 && baseline_ok && ok ROLLBACK_IDEMPOTENT || ko ROLLBACK_IDEMPOTENT
[[ "$(docker inspect -f '{{.State.Running}}' "$DECOY" 2>/dev/null)" == true ]] && ok UNRELATED_RELAY_UNTOUCHED || ko UNRELATED_RELAY_UNTOUCHED
echo "ACTIVATION_PASSED=$pass ACTIVATION_FAILED=$fail"
[[ "$fail" -eq 0 ]]
