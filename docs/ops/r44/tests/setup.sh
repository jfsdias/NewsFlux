#!/usr/bin/env bash
# Disposable R4.4 topology: project "newsflux" with Summary (real image @ deployed main) + Reader stand-in,
# protected stand-ins miniflux (fake HTTPS API), miniflux-db, npm. Never a real host.
set -euo pipefail
T="$1"; rm -rf "$T"; mkdir -p "$T"/{ca,tls,private,state}
cd "$T"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj "/CN=r44 test CA" -keyout ca/ca.key -out ca/ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=miniflux.test" -keyout tls/server.key -out tls/server.csr 2>/dev/null
printf 'subjectAltName=DNS:miniflux.test\n' > tls/ext
openssl x509 -req -in tls/server.csr -CA ca/ca.pem -CAkey ca/ca.key -CAcreateserial -days 2 -extfile tls/ext -out tls/server.pem 2>/dev/null
chmod 644 tls/server.key ca/ca.pem
cp "$(dirname "$0")/fake_miniflux.py" .
cat > private/summary.env <<'EOF'
# Summary private settings (test)
NEWSFLUX_AI_MINIFLUX_BASE_URL=https://miniflux.test
NEWSFLUX_AI_ALLOWED_WEB_ORIGINS=https://news.rehearsal.test
NEWSFLUX_AI_MINIFLUX_ADMIN_USER_IDS=
NEWSFLUX_AI_INFERENCE_ENABLED=false
EOF
if [ "${R44T_NO_KEY_LINE:-0}" = 1 ]; then sed -i '/ADMIN_USER_IDS/d' private/summary.env; printf '%s' "$(cat private/summary.env)" > private/summary.env; fi
chmod 600 private/summary.env
printf 'SUMMARY_IMAGE=r44-summary:test\nPRIV_ENV=./private/summary.env\n' > .env
printf ':8080 {\n respond "r44"\n}\n' > Caddyfile
cat > compose.yaml <<'EOF'
services:
  summary-api:
    image: ${SUMMARY_IMAGE:?exact image required}
    env_file:
      - ${PRIV_ENV:?private settings file required}
    environment:
      SSL_CERT_FILE: /ca/ca.pem
    volumes:
      - summary-data:/data
      - ./ca/ca.pem:/ca/ca.pem:ro
    networks: [mf]
  pilot-reader:
    image: python:3.12-alpine
    container_name: newsflux
    command: ["sleep", "infinity"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
    depends_on:
      summary-api: {condition: service_healthy}
    networks: [mf]
networks:
  mf: {external: true, name: r44-mf}
volumes:
  summary-data: {}
EOF
cat > override.yaml <<'EOF'
services:
  summary-api:
    stop_grace_period: 5s
    healthcheck:
      interval: 2s
      start_period: 2s
EOF
docker network create r44-mf >/dev/null
docker run -d --name miniflux --network r44-mf --network-alias miniflux.test -v "$T/tls:/tls:ro" -v "$T/state:/state:ro" \
  -v "$T/fake_miniflux.py:/srv/m.py:ro" python:3.12-alpine python /srv/m.py >/dev/null
docker run -d --name miniflux-db python:3.12-alpine sleep infinity >/dev/null
docker run -d --name npm python:3.12-alpine sleep infinity >/dev/null
docker compose -p newsflux -f compose.yaml -f override.yaml up -d --wait >/dev/null 2>&1
