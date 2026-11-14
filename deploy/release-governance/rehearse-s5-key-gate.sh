#!/usr/bin/env bash
# S5 key gate against a REAL, disposable LiteLLM proxy (pinned image + Postgres + TLS front).
#
# Synthetic only: synthetic master key, synthetic keys, model aliases pointing at an unreachable
# provider (127.0.0.1:9). No inference is performed. Nothing here is evidence about the live gateway.
#
# Proves, with the real LiteLLM authorization code:
#   - a least-privilege key (allowed_routes=llm_api_routes) gets 200 on /v1/models and 403 on /key/info
#     -> preflight reports KEY_INFO_ACCESS=HTTP_403, key gates NOT_VERIFIED, S5_PREFLIGHT=BLOCKED;
#   - an unrestricted key (models=[], no budget) fails KEY_SCOPE_GATE / KEY_BUDGET_GATE;
#   - a proxy_admin_viewer key reads the policy via POST /v2/key/info and cannot write;
#   - audit (host, viewer key) + preflight (Summary image, virtual key only) -> PASS only with the
#     operator's provider-cost confirmation; an unpriced alias stays NOT_VERIFIED; a paid alias FAILS.
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
LITELLM_IMAGE="${LITELLM_IMAGE:-litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9}"
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
CADDY_IMAGE="caddy@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d"
run="s5gate-$$"
net="$run-net"
work="$(mktemp -d)"
MASTER="sk-synthetic-master-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
pass=0
fail=0
ok() { echo "S5_KEY_GATE $1=PASS"; pass=$((pass + 1)); }
ko() { echo "S5_KEY_GATE $1=FAIL"; fail=$((fail + 1)); }

cleanup() {
  # Only this run's resources, by exact name.
  docker rm -f "$run-litellm" "$run-pg" "$run-tls" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker image rm "$run-summary:synthetic" >/dev/null 2>&1 || true
  # Key copies are owned by the Summary uid (10001); a non-root runner needs sudo to remove them.
  sudo -n rm -rf "$work" 2>/dev/null || rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: openai/s5-synthetic, api_base: "http://127.0.0.1:9/v1", api_key: synthetic-provider-key}
    model_info: {input_cost_per_token: 0, output_cost_per_token: 0}
  - model_name: newsflux-s5-unpriced
    litellm_params: {model: openai/s5-unpriced-synthetic, api_base: "http://127.0.0.1:9/v1", api_key: synthetic-provider-key}
  - model_name: newsflux-s5-paid
    litellm_params: {model: openai/s5-paid-synthetic, api_base: "http://127.0.0.1:9/v1", api_key: synthetic-provider-key}
    model_info: {input_cost_per_token: 0.0000002, output_cost_per_token: 0.0000006}
YAML
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$work/tls.key" -out "$work/tls.crt" -days 1 \
  -subj "/CN=$run-tls" -addext "subjectAltName=DNS:$run-tls,DNS:localhost" >/dev/null 2>&1
chmod 0644 "$work/tls.key" "$work/tls.crt" "$work/config.yaml"
printf 'https://:8443 {\n  tls /etc/s5/tls.crt /etc/s5/tls.key\n  reverse_proxy %s:4000\n}\n' "$run-litellm" >"$work/Caddyfile"

docker network create --label "org.newsflux.rehearsal=$run" "$net" >/dev/null
docker run -d --name "$run-pg" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec "$run-pg" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
docker run -d --name "$run-litellm" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -v "$work/config.yaml:/app/config.yaml:ro" "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null
docker run -d --name "$run-tls" --network "$net" -p 127.0.0.1::8443 -v "$work/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$work/tls.crt:/etc/s5/tls.crt:ro" -v "$work/tls.key:/etc/s5/tls.key:ro" "$CADDY_IMAGE" >/dev/null
port="$(docker port "$run-tls" 8443/tcp | head -1 | sed 's/.*://')"
G="https://localhost:$port"
for _ in $(seq 1 120); do curl -fsS --cacert "$work/tls.crt" "$G/health/liveliness" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS --cacert "$work/tls.crt" "$G/health/liveliness" >/dev/null || { echo "S5_KEY_GATE LITELLM_START=FAIL"; exit 1; }

api() { curl -sS --cacert "$work/tls.crt" -X POST "$G$1" -H "Authorization: Bearer $2" -H 'Content-Type: application/json' -d "$3"; }
code() { curl -s --cacert "$work/tls.crt" -o /dev/null -w '%{http_code}' "$@"; }
new_key() { api /key/generate "$MASTER" "$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["key"])'; }
LP="$(new_key '{"models":["newsflux-s5-free"],"allowed_routes":["llm_api_routes"],"max_budget":0.5,"budget_duration":"30d","tpm_limit":20000,"rpm_limit":5}')"
OPEN="$(new_key '{}')"
UNPRICED="$(new_key '{"models":["newsflux-s5-unpriced"],"allowed_routes":["llm_api_routes"],"max_budget":0.5,"budget_duration":"30d","tpm_limit":20000,"rpm_limit":5}')"
PAID="$(new_key '{"models":["newsflux-s5-paid"],"allowed_routes":["llm_api_routes"],"max_budget":0.5,"budget_duration":"30d","tpm_limit":20000,"rpm_limit":5}')"
api /user/new "$MASTER" '{"user_id":"viewer","user_role":"proxy_admin_viewer"}' >/dev/null
VIEW="$(new_key '{"user_id":"viewer"}')"
for name in LP OPEN UNPRICED PAID VIEW; do
  umask 077
  printf '%s\n' "${!name}" >"$work/$name.key"
  umask 022
done

# --- Real LiteLLM authorization behaviour ---------------------------------------------------------
[[ "$(code "$G/v1/models" -H "Authorization: Bearer $LP")" == 200 ]] && ok LEAST_PRIVILEGE_CATALOG_200 || ko LEAST_PRIVILEGE_CATALOG_200
[[ "$(code "$G/key/info" -H "Authorization: Bearer $LP")" == 403 ]] && ok LEAST_PRIVILEGE_KEY_INFO_403 || ko LEAST_PRIVILEGE_KEY_INFO_403
[[ "$(code -X POST "$G/key/generate" -H "Authorization: Bearer $VIEW" -H 'Content-Type: application/json' -d '{}')" == 403 ]] \
  && ok ADMIN_VIEWER_CANNOT_WRITE || ko ADMIN_VIEWER_CANNOT_WRITE

# --- Summary image: preflight with the virtual key only ------------------------------------------
build_args=(-f "$repo/services/article_intel_summary/Dockerfile")
context="$repo"
if [[ -n "${NEWSFLUX_TEST_PIP_CA:-}" ]]; then # TLS-inspecting sandboxes only (same pattern as rehearse-r12f09.sh)
  context="$work/ctx"
  mkdir -p "$context"
  cp -R "$repo/services" "$context/services"
  cp "$NEWSFLUX_TEST_PIP_CA" "$context/.pip-ca.pem"
  python3 - "$repo/services/article_intel_summary/Dockerfile" "$context/Dockerfile.sandbox" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
s = re.sub(r"^FROM (\S+)@sha256:\S+", r"FROM \1", s, count=1, flags=re.M)
s = s.replace("RUN pip install", "COPY .pip-ca.pem /tmp/ca.pem\nARG HTTPS_PROXY\nRUN PIP_CERT=/tmp/ca.pem pip install", 1)
open(sys.argv[2], "w").write(s)
PY
  build_args=(-f "$context/Dockerfile.sandbox" --network host --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}")
fi
docker build -q "${build_args[@]}" -t "$run-summary:synthetic" "$context" >/dev/null
calls=0
preflight() { # $1 key name, $2 alias, stdin: optional attestation
  calls=$((calls + 1))
  local secrets="$work/secrets-$calls-$1" # fresh per call: earlier copies belong to uid 10001
  mkdir -p "$secrets"
  cp "$work/$1.key" "$secrets/key"
  sudo chown -R 10001:10001 "$secrets" 2>/dev/null || chown -R 10001:10001 "$secrets"
  chmod 0400 "$secrets/key"
  docker run --rm -i --network "$net" --read-only --cap-drop ALL --security-opt no-new-privileges \
    -v "$secrets:/run/secrets/litellm:ro" -v "$work/tls.crt:/run/ca.crt:ro" -e SSL_CERT_FILE=/run/ca.crt \
    -e NEWSFLUX_AI_LITELLM_BASE_URL="https://$run-tls:8443" -e NEWSFLUX_AI_LITELLM_VIRTUAL_KEY_FILE=/run/secrets/litellm/key \
    -e NEWSFLUX_AI_LITELLM_S5_FREE_ALIAS="$2" -e NEWSFLUX_AI_LITELLM_MISTRAL_SMALL_ALIAS=mistral-small \
    -e NEWSFLUX_AI_LITELLM_S5_FREE_INPUT_USD_PER_MILLION=0 -e NEWSFLUX_AI_LITELLM_S5_FREE_OUTPUT_USD_PER_MILLION=0 \
    -e NEWSFLUX_AI_MONTHLY_BUDGET_USD=1.00 -e NEWSFLUX_AI_MAX_INPUT_TOKENS=4096 -e NEWSFLUX_AI_MAX_OUTPUT_TOKENS=512 \
    -e NEWSFLUX_AI_MAX_REQUESTS_PER_MINUTE=5 -e NEWSFLUX_AI_MAX_TOKENS_PER_MINUTE=20000 -e NEWSFLUX_AI_INFERENCE_TIMEOUT_SECONDS=15 \
    -e NEWSFLUX_AI_USAGE_DATABASE_PATH=/tmp/usage.sqlite3 --tmpfs /tmp \
    "$run-summary:synthetic" python -m services.article_intel_summary.s5_preflight "${@:3}" 2>&1 || true
}
audit() { # $1 key name, $2 alias, $3.. extra
  python3 "$here/s5_key_audit.py" --gateway-url "$G" --ca-file "$work/tls.crt" --admin-key-file "$work/VIEW.key" \
    --virtual-key-file "$work/$1.key" --alias "$2" --out "$work/$1.attestation.json" "${@:3}"
}
has() { grep -qx "$2" <<<"$1"; }

out="$(preflight LP newsflux-s5-free </dev/null)"
has "$out" CATALOG_ACCESS_GATE=PASS && has "$out" KEY_INFO_ACCESS=HTTP_403 && has "$out" KEY_SCOPE_GATE=NOT_VERIFIED \
  && has "$out" S5_PREFLIGHT=BLOCKED && ok LIVE_SHAPE_403_BLOCKS_WITHOUT_EVIDENCE || ko LIVE_SHAPE_403_BLOCKS_WITHOUT_EVIDENCE
grep -q "$(cat "$work/LP.key")" <<<"$out" && ko NO_KEY_IN_OUTPUT || ok NO_KEY_IN_OUTPUT

out="$(preflight OPEN newsflux-s5-free </dev/null)"
has "$out" KEY_INFO_ACCESS=OK && has "$out" KEY_SCOPE_GATE=FAIL && has "$out" KEY_BUDGET_GATE=FAIL && has "$out" S5_PREFLIGHT=BLOCKED \
  && ok UNRESTRICTED_KEY_FAILS || ko UNRESTRICTED_KEY_FAILS

audit_out="$(audit LP newsflux-s5-free)"
has "$audit_out" S5_KEY_AUDIT=WRITTEN && ok AUDIT_ADMIN_VIEWER_READ || ko AUDIT_ADMIN_VIEWER_READ
out="$(preflight LP newsflux-s5-free --attestation-stdin <"$work/LP.attestation.json")"
has "$out" KEY_EVIDENCE_SOURCE=ADMIN_ATTESTATION && has "$out" KEY_SCOPE_GATE=PASS && has "$out" GATEWAY_PRICE=ZERO \
  && has "$out" PRICING_GATE=NOT_VERIFIED && has "$out" S5_PREFLIGHT=BLOCKED \
  && ok NO_PROVIDER_CONFIRMATION_BLOCKS || ko NO_PROVIDER_CONFIRMATION_BLOCKS

audit LP newsflux-s5-free --confirm-provider-cost-zero --reference "synthetic rehearsal" >/dev/null
out="$(preflight LP newsflux-s5-free --attestation-stdin <"$work/LP.attestation.json")"
has "$out" PRICING_GATE=PASS && has "$out" KEY_BUDGET_GATE=PASS && has "$out" KEY_RATE_LIMIT_GATE=PASS && has "$out" S5_PREFLIGHT=PASS \
  && ok LEAST_PRIVILEGE_WITH_ATTESTATION_PASSES || ko LEAST_PRIVILEGE_WITH_ATTESTATION_PASSES

out="$(preflight OPEN newsflux-s5-free --attestation-stdin <"$work/LP.attestation.json")"
has "$out" ATTESTATION=REJECTED_KEY_MISMATCH && has "$out" S5_PREFLIGHT=BLOCKED && ok ATTESTATION_BOUND_TO_KEY || ko ATTESTATION_BOUND_TO_KEY

audit UNPRICED newsflux-s5-unpriced --confirm-provider-cost-zero --reference "synthetic rehearsal" >/dev/null
out="$(preflight UNPRICED newsflux-s5-unpriced --attestation-stdin <"$work/UNPRICED.attestation.json")"
has "$out" GATEWAY_PRICE=NOT_PUBLISHED && has "$out" PRICING_GATE=NOT_VERIFIED && has "$out" S5_PREFLIGHT=BLOCKED \
  && ok UNPUBLISHED_PRICE_BLOCKS || ko UNPUBLISHED_PRICE_BLOCKS

audit PAID newsflux-s5-paid --confirm-provider-cost-zero --reference "synthetic rehearsal" >/dev/null
out="$(preflight PAID newsflux-s5-paid --attestation-stdin <"$work/PAID.attestation.json")"
has "$out" PRICING_GATE=FAIL && has "$out" S5_PREFLIGHT=BLOCKED && ok PAID_PRICE_FAILS || ko PAID_PRICE_FAILS

grep -qE "$(cat "$work/LP.key")|$(cat "$work/VIEW.key")|$MASTER" "$work/LP.attestation.json" && ko NO_SECRET_IN_ATTESTATION || ok NO_SECRET_IN_ATTESTATION
[[ "$(stat -c %a "$work/LP.attestation.json")" == 600 ]] && ok ATTESTATION_MODE_0600 || ko ATTESTATION_MODE_0600

echo "S5_KEY_GATE_PASSED=$pass S5_KEY_GATE_FAILED=$fail"
[[ "$fail" -eq 0 ]]
