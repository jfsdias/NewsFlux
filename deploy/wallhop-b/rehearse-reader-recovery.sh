#!/usr/bin/env bash
# WallHop-B Reader recovery end to end, disposable, real components:
#   client ─HTTPS─ NPM stand-in ─ Reader Caddy (REAL Caddyfile.wallhop) ─(internal)─ sidecar (REAL image,
#   Reader bridge) ─(internal)─ relay (REAL haproxy.cfg) ─ synthetic WallHop (TLS "wallhop.io") and
#   synthetic Miniflux (scripts/reader-wallhop-p1-r2/fixture_server.py behind TLS "miniflux.rehearsal.test").
# Throwaway CA; no real WallHop, publisher, Miniflux or production host. Only synthetic keys.
set -Eeuo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(git -C "$here" rev-parse --show-toplevel)"
run="nfr$RANDOM"; work="$(mktemp -d /tmp/nfr.XXXXXX)"; chmod 755 "$work"
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.10.2-alpine}"; HAPROXY_IMAGE="${HAPROXY_IMAGE:-haproxy:3.0.5-alpine}"
PY_IMAGE="${PY_IMAGE:-python:3.12-slim}"
pass=0; fail=0
ok() { echo "RECOVERY_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "RECOVERY_GATE $1=FAIL${2:+ ($2)}"; fail=$((fail + 1)); }
cleanup() {
  [[ -n "${KEEP:-}" ]] && { echo "KEPT run=$run work=$work"; return; }
  docker rm -f "$run-npm" "$run-reader" "$run-sidecar" "$run-relay" "$run-wallhop" "$run-miniflux" >/dev/null 2>&1 || true
  docker network rm "$run-reader" "$run-egress" "$run-npm" >/dev/null 2>&1 || true
  docker image rm -f "$run-sidecar:test" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

USER_KEY="synthetic-user-key-$RANDOM$RANDOM"; OTHER_KEY="synthetic-other-key-$RANDOM"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$run-ca" -keyout "$work/ca.key" -out "$work/ca.crt" 2>/dev/null
leaf() {
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$1" -keyout "$work/$1.key" -out "$work/$1.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\n' "$1" >"$work/$1.ext"
  openssl x509 -req -in "$work/$1.csr" -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial -days 1 -extfile "$work/$1.ext" -out "$work/$1.crt" 2>/dev/null
}
for host in wallhop.io miniflux.rehearsal.test news.rehearsal.test; do leaf "$host"; done
chmod 644 "$work"/*.crt "$work"/*.key

docker build -q -f "$repo/services/content_fallback/Dockerfile" -t "$run-sidecar:test" "$repo" >/dev/null
docker network create --internal --subnet 172.31.71.0/24 "$run-reader" >/dev/null
docker network create --internal "$run-egress" >/dev/null
docker network create --subnet 172.31.72.0/24 "$run-npm" >/dev/null
NPM_IP=172.31.72.10; READER_IP=172.31.71.10

# Synthetic Miniflux (existing p1-r2 fixture) and synthetic WallHop (logs request headers names only).
docker run -d --name "$run-miniflux" --network "$run-npm" --network-alias miniflux-origin \
  -e NEWSFLUX_TEST_USER_KEY="$USER_KEY" -e NEWSFLUX_TEST_ROTATED_KEY="rotated-$USER_KEY" \
  -e NEWSFLUX_TEST_OTHER_USER_KEY="$OTHER_KEY" -e NEWSFLUX_TEST_ADMIN_KEY="admin-$USER_KEY" \
  -v "$repo/scripts/reader-wallhop-p1-r2/fixture_server.py:/srv/fixture_server.py:ro" "$PY_IMAGE" python /srv/fixture_server.py >/dev/null
cat >"$work/wallhop.py" <<'PY'
import http.server, ssl, sys
PARAS = [
    "Synthetic WallHop paragraph %d. Researchers compared water temperature, wind direction and shoreline movement at several coastal stations during repeated autumn visits, keeping each observation for later comparison." % i
    for i in range(1, 9)
]
BODY = ("<html><head><title>Synthetic story 501</title></head><body><article>"
        + "".join(f"<p>{p}</p>" for p in PARAS)
        + "<script>window.__unsafe = 1</script><img src='https://tracker.invalid/p.gif'></article></body></html>").encode()
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        sys.stdout.write("WALLHOP_REQUEST path=%s headers=%s\n" % (self.path, ",".join(sorted(k.lower() for k in self.headers.keys()))))
        sys.stdout.flush()
        if not self.path.startswith("/raw/https://publisher.example.test/article/"):
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(BODY))); self.end_headers(); self.wfile.write(BODY)
    def log_message(self, *a): pass
server = http.server.ThreadingHTTPServer(("0.0.0.0", 443), H)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain("/certs/wallhop.io.crt", "/certs/wallhop.io.key")
server.socket = ctx.wrap_socket(server.socket, server_side=True)
server.serve_forever()
PY
docker run -d --name "$run-wallhop" --network "$run-npm" --network-alias wallhop-origin \
  -v "$work:/certs:ro" -v "$work/wallhop.py:/srv/wallhop.py:ro" "$PY_IMAGE" python -u /srv/wallhop.py >/dev/null

# NPM stand-in: TLS for the Reader origin and for the public Miniflux host.
cat >"$work/npm.Caddyfile" <<C
https://news.rehearsal.test:443 {
	tls /certs/news.rehearsal.test.crt /certs/news.rehearsal.test.key
	reverse_proxy reader:2000 {
		header_up X-Forwarded-Proto https
	}
}
https://miniflux.rehearsal.test:443 {
	tls /certs/miniflux.rehearsal.test.crt /certs/miniflux.rehearsal.test.key
	reverse_proxy miniflux-origin:8080
}
C
docker run -d --name "$run-npm" --network "$run-npm" --ip "$NPM_IP" --network-alias npm \
  -v "$work:/certs:ro" -v "$work/npm.Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null

# Relay (real config) and sidecar (real image) on internal networks only.
docker run -d --name "$run-relay" --network "$run-egress" --network-alias wallhop-egress \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true --user 99:99 \
  --sysctl net.ipv4.ip_unprivileged_port_start=443 \
  -e MINIFLUX_PUBLIC_HOST=miniflux.rehearsal.test -e MINIFLUX_UPSTREAM=npm:443 -e WALLHOP_UPSTREAM=wallhop-origin:443 \
  -v "$here/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro" "$HAPROXY_IMAGE" >/dev/null
docker network connect "$run-npm" "$run-relay"
POLICY='{"enabled":true,"domains":{"publisher.example.test":{"state":"ON_DEMAND","provider":"wallhop"}},"feeds":{}}'
# The publisher host gets a PUBLIC answer for the SSRF pre-check only; the sidecar has no route to it.
docker run -d --name "$run-sidecar" --network "$run-reader" --network-alias content-fallback-reader \
  --add-host publisher.example.test:93.184.216.34 \
  -e MINIFLUX_BASE_URL=https://miniflux.rehearsal.test -e MINIFLUX_API_TOKEN="$USER_KEY" \
  -e CONTENT_FALLBACK_API_TOKEN="$(head -c 32 /dev/urandom | base64)" -e CONTENT_FALLBACK_HOST=0.0.0.0 \
  -e CONTENT_FALLBACK_EGRESS_RELAY=wallhop-egress -e CONTENT_FALLBACK_REQUIRE_EGRESS_RELAY=true \
  -e CONTENT_FALLBACK_EGRESS_ALLOWED_HOSTS=wallhop.io,miniflux.rehearsal.test \
  -e CONTENT_FALLBACK_READER_ENABLED=true -e CONTENT_FALLBACK_READER_USER_ID=7 \
  -e CONTENT_FALLBACK_READER_TRUSTED_PROXY_IPS="$READER_IP" \
  -e NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.rehearsal.test -e NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://news.rehearsal.test \
  -e CONTENT_FALLBACK_POLICIES_JSON="$POLICY" -e SSL_CERT_FILE=/certs/ca.crt -v "$work:/certs:ro" "$run-sidecar:test" >/dev/null
docker network connect "$run-egress" "$run-sidecar"

# Reader: real Caddyfile.wallhop; joins npm and the internal bridge network with a static IP.
printf '<!doctype html><div id="root"></div>\n' >"$work/index.html"
docker run -d --name "$run-reader" --network "$run-npm" --network-alias reader \
  -e NEWSFLUX_PILOT_TRUSTED_PROXY_IP="$NPM_IP" \
  -v "$here/Caddyfile.wallhop:/etc/caddy/Caddyfile:ro" -v "$work/index.html:/srv/index.html:ro" "$CADDY_IMAGE" >/dev/null
docker network connect --ip "$READER_IP" "$run-reader" "$run-reader"

for _ in $(seq 1 40); do [[ "$(docker inspect -f '{{.State.Health.Status}}' "$run-sidecar")" == healthy ]] && break; sleep 1; done
[[ "$(docker inspect -f '{{.State.Health.Status}}' "$run-sidecar")" == healthy ]] && ok SIDECAR_HEALTHY || ko SIDECAR_HEALTHY

url=https://news.rehearsal.test/api/content-fallback/reader/v1/entries
recover() { # entry key -> writes body to $work/out.json, echoes status
  curl -sS --noproxy '*' --max-time 30 --resolve "news.rehearsal.test:443:$NPM_IP" --cacert "$work/ca.crt" \
    -o "$work/out.json" -w '%{http_code}' -X POST "$url/$1/recover" \
    -H "Origin: https://news.rehearsal.test" -H "X-Miniflux-API-Key: $2" \
    -H "X-NewsFlux-Miniflux-Server: https://miniflux.rehearsal.test" || echo 000
}
status="$(recover 501 "$USER_KEY")"
if [[ "$status" == 200 ]] && python3 - "$work/out.json" <<'PY'
import hashlib, json, sys
d = json.load(open(sys.argv[1]))
assert d["status"] == "recovered" and d["content_origin"] == "wallhop" and d["entry_id"] == 501, d.get("status")
assert d["url_fingerprint"] == hashlib.sha256(b"https://publisher.example.test/article/501").hexdigest()
assert "Synthetic WallHop paragraph 8" in d["content_html"]
PY
then ok READER_RECOVERY_E2E; else ko READER_RECOVERY_E2E "status=$status $(head -c 200 "$work/out.json" 2>/dev/null)"; fi
python3 - "$work/out.json" <<'PY' && ok CONTENT_SANITIZATION || ko CONTENT_SANITIZATION
import json, sys
html = json.load(open(sys.argv[1])).get("content_html", "")
assert html and "<script" not in html and "<img" not in html and "tracker.invalid" not in html and "__unsafe" not in html
PY
logs="$(docker logs "$run-wallhop" 2>&1)"
grep -q 'WALLHOP_REQUEST path=/raw/https://publisher.example.test/article/501' <<<"$logs" && ok WALLHOP_CALLED_WITH_AUTHORIZED_ENTRY_URL_ONLY || ko WALLHOP_CALLED_WITH_AUTHORIZED_ENTRY_URL_ONLY
if grep -qiE 'x-auth-token|x-miniflux-api-key|authorization|cookie' <<<"$logs" || grep -q "$USER_KEY" <<<"$logs"; then ko NO_CREDENTIAL_LEAK_TO_WALLHOP; else ok NO_CREDENTIAL_LEAK_TO_WALLHOP; fi
[[ "$(recover 501 wrong-key)" =~ ^(401|403)$ ]] && ok WRONG_KEY_REJECTED || ko WRONG_KEY_REJECTED
other="$(recover 801 "$OTHER_KEY")"; [[ "$other" != 200 ]] && ok OTHER_USER_REJECTED || ko OTHER_USER_REJECTED "status=$other"
direct="$(curl -sS --noproxy '*' --max-time 10 -o /dev/null -w '%{http_code}' -X POST "http://$(docker inspect -f "{{(index .NetworkSettings.Networks \"$run-npm\").IPAddress}}" "$run-reader"):2000/api/content-fallback/reader/v1/entries/501/recover" -H "X-Forwarded-Proto: https" -H "X-Miniflux-API-Key: $USER_KEY" || echo 000)"
[[ "$direct" == 404 ]] && ok UNTRUSTED_CLIENT_CANNOT_REACH_BRIDGE || ko UNTRUSTED_CLIENT_CANNOT_REACH_BRIDGE "status=$direct"
writes="$(docker exec "$run-miniflux" python -c "import json,urllib.request;print(json.load(urllib.request.urlopen('http://127.0.0.1:8080/__harness__/state'))['writes'])" 2>/dev/null || echo unknown)"
[[ "$writes" == "[]" || "$writes" == "0" ]] && ok NO_MINIFLUX_WRITES || ko NO_MINIFLUX_WRITES "writes=$writes"
[[ "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$run-sidecar" | wc -w)" == 2 ]] && ok SIDECAR_INTERNAL_ONLY || ko SIDECAR_INTERNAL_ONLY
echo "RECOVERY_PASSED=$pass RECOVERY_FAILED=$fail"
[[ "$fail" -eq 0 ]]
