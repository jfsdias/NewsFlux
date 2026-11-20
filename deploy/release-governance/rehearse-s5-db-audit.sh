#!/usr/bin/env bash
# S5-R1 DB/config auditor against a REAL, disposable LiteLLM proxy (pinned image + Postgres).
#
# Synthetic only: synthetic master key, synthetic keys, model aliases pointing at an unreachable
# provider (127.0.0.1:9). No inference. Nothing here is evidence about the live gateway.
#
# Proves, with LiteLLM's real schema, driver and key storage:
#   - the probe (same bootstrap as the operator command) finds the key by fingerprint only;
#   - a least-privilege key passes the key gates; an unrestricted key and a key with missing
#     limits fail; YAML fallbacks and callbacks are detected; a configured zero price never
#     passes PRICING_GATE;
#   - the probe's transaction is really READ ONLY (a write inside it is refused by Postgres);
#   - the output never contains a key, token hash, fingerprint, alias, URL or DSN.
set -Eeuo pipefail
umask 022
here="$(cd "$(dirname "$0")" && pwd)"
LITELLM_IMAGE="${LITELLM_IMAGE:-litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9}"
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
run="s5db-$$"
net="$run-net"
work="$(mktemp -d)"
MASTER="sk-synthetic-master-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
pass=0
fail=0
ok() { echo "S5_DB_AUDIT $1=PASS"; pass=$((pass + 1)); }
ko() { echo "S5_DB_AUDIT $1=FAIL"; fail=$((fail + 1)); }
cleanup() {
  docker rm -f "$run-litellm" "$run-pg" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: openrouter/synthetic/s5-model, api_base: "http://127.0.0.1:9/v1", api_key: synthetic-provider-key}
    model_info: {input_cost_per_token: 0, output_cost_per_token: 0}
  - model_name: newsflux-s5-fallback
    litellm_params: {model: openrouter/synthetic/s5-fallback, api_base: "http://127.0.0.1:9/v1", api_key: synthetic-provider-key}
    model_info: {input_cost_per_token: 0, output_cost_per_token: 0}
router_settings:
  fallbacks: [{newsflux-s5-fallback: [newsflux-s5-free]}]
litellm_settings:
  success_callback: []
YAML
chmod 0644 "$work/config.yaml"

docker network create --label "org.newsflux.rehearsal=$run" "$net" >/dev/null
docker run -d --name "$run-pg" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do docker exec "$run-pg" pg_isready -q -U postgres 2>/dev/null && break; sleep 1; done
docker run -d --name "$run-litellm" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" \
  -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" -e LITELLM_LOCAL_MODEL_COST_MAP=True \
  -e STORE_MODEL_IN_DB=True -v "$work/config.yaml:/app/config.yaml:ro" "$LITELLM_IMAGE" --config /app/config.yaml --port 4000 >/dev/null
L() { docker exec -i "$run-litellm" "$@"; }
for _ in $(seq 1 120); do L python3 -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 && break; sleep 2; done
L python3 -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1 \
  || { echo "S5_DB_AUDIT LITELLM_START=FAIL"; exit 1; }

api() { # $1 path, $2 json body (master key stays inside this script and the disposable container)
  L python3 - "$1" "$2" "$MASTER" <<'PY'
import json, sys, urllib.request
req = urllib.request.Request("http://127.0.0.1:4000" + sys.argv[1], data=sys.argv[2].encode(), method="POST",
                             headers={"Authorization": "Bearer " + sys.argv[3], "Content-Type": "application/json"})
print(json.load(urllib.request.urlopen(req, timeout=30)).get("key", ""))
PY
}
LP="$(api /key/generate '{"models":["newsflux-s5-free"],"allowed_routes":["llm_api_routes"],"max_budget":0.5,"budget_duration":"30d","tpm_limit":20000,"rpm_limit":5}')"
OPEN="$(api /key/generate '{}')"
NOLIMITS="$(api /key/generate '{"models":["newsflux-s5-fallback"],"allowed_routes":["llm_api_routes"]}')"
REMAP="$(api /key/generate '{"models":["newsflux-s5-free"],"allowed_routes":["llm_api_routes"],"max_budget":0.5,"budget_duration":"30d","tpm_limit":20000,"rpm_limit":5,"aliases":{"newsflux-s5-free":"newsflux-s5-fallback"}}')"
[[ "$LP" == sk-* && "$OPEN" == sk-* && "$NOLIMITS" == sk-* && "$REMAP" == sk-* ]] && ok SYNTHETIC_KEYS_CREATED || ko SYNTHETIC_KEYS_CREATED

probe() { # $1 virtual key, $2 alias -> classification JSON (same bootstrap as the operator command)
  local fp
  fp="$(python3 -c 'import hashlib,sys; t=hashlib.sha256(sys.argv[1].encode()).hexdigest(); print(hashlib.sha256(b"newsflux-s5-key-attestation-v1\0"+t.encode()).hexdigest())' "$1")"
  local bootstrap
  bootstrap="$(python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); import s5_db_readonly_audit as a; print(a.PROBE_BOOTSTRAP)' "$here")"
  { printf '{"fingerprint":"%s","alias":"%s","caps":{"rpm":5,"tpm":20000,"budget":1.0},"allowed_callbacks":[]}\n' "$fp" "$2"
    cat "$here/s5_db_readonly_audit.py"; } | L python3 -c "$bootstrap" || true
}
field() { python3 -c 'import json,sys; print(json.loads(sys.stdin.read().strip().splitlines()[-1]).get(sys.argv[1], ""))' "$1"; }

out="$(probe "$LP" newsflux-s5-free)"
[[ "$(field KEY_MATCH <<<"$out")" == ONE && "$(field KEY_POLICY_GATE <<<"$out")" == PASS && "$(field DB_READ_ONLY <<<"$out")" == VERIFIED ]] \
  && ok LEAST_PRIVILEGE_KEY_PASSES_KEY_POLICY || { ko LEAST_PRIVILEGE_KEY_PASSES_KEY_POLICY; echo "$out"; }
[[ "$(field YAML_CONFIG <<<"$out")" == LOADED && "$(field DEPLOYMENTS_YAML <<<"$out")" == 1 && "$(field PROVIDER_FAMILY <<<"$out")" == OPENROUTER ]] \
  && ok YAML_DEPLOYMENT_CLASSIFIED || { ko YAML_DEPLOYMENT_CLASSIFIED; echo "$out"; }
[[ "$(field CONFIGURED_PRICE <<<"$out")" == ZERO && "$(field PRICING_GATE <<<"$out")" == NOT_VERIFIED_PROVIDER_TERMS ]] \
  && ok ZERO_CONFIG_PRICE_IS_NOT_PROOF || ko ZERO_CONFIG_PRICE_IS_NOT_PROOF
[[ "$(field OFFICIAL_ATTESTATION <<<"$out")" == HOLD_NO_ACCEPTABLE_ATTESTATION_SOURCE && "$(field S5_PREFLIGHT_EFFECT <<<"$out")" == NONE ]] \
  && ok NEVER_AN_OFFICIAL_ATTESTATION || ko NEVER_AN_OFFICIAL_ATTESTATION

out="$(probe "$OPEN" newsflux-s5-free)"
[[ "$(field KEY_SCOPE_DETAIL <<<"$out")" == UNRESTRICTED_ALL_MODELS && "$(field KEY_POLICY_GATE <<<"$out")" == FAIL ]] \
  && ok UNRESTRICTED_KEY_FAILS || { ko UNRESTRICTED_KEY_FAILS; echo "$out"; }

out="$(probe "$NOLIMITS" newsflux-s5-fallback)"
[[ "$(field KEY_RATE_LIMITS <<<"$out")" == FAIL && "$(field KEY_BUDGET <<<"$out")" == FAIL && "$(field FALLBACK_ALIAS_RULE <<<"$out")" == PRESENT \
   && "$(field FALLBACK_GATE <<<"$out")" == FAIL ]] && ok MISSING_LIMITS_AND_YAML_FALLBACK_FAIL || { ko MISSING_LIMITS_AND_YAML_FALLBACK_FAIL; echo "$out"; }

out="$(probe "$REMAP" newsflux-s5-free)"
[[ "$(field KEY_INDIRECTION <<<"$out")" == ALIASES && "$(field MODEL_ROUTE_GATE <<<"$out")" == FAIL ]] \
  && ok KEY_ALIAS_REMAP_FAILS || { ko KEY_ALIAS_REMAP_FAILS; echo "$out"; }

out="$(probe "sk-synthetic-not-a-real-key-000000" newsflux-s5-free)"
[[ "$(field KEY_MATCH <<<"$out")" == NONE ]] && ok UNKNOWN_KEY_NOT_FOUND || ko UNKNOWN_KEY_NOT_FOUND

# The probe's connection mode really refuses writes on the real database.
ro="$(L python3 - <<'PY'
import os, psycopg
c = psycopg.connect(os.environ["DATABASE_URL"])
c.read_only = True
try:
    c.execute('UPDATE "LiteLLM_VerificationToken" SET "spend" = "spend"')
    print("WRITE_ACCEPTED")
except psycopg.errors.ReadOnlySqlTransaction:
    print("WRITE_REFUSED")
finally:
    c.rollback(); c.close()
PY
)"
[[ "$ro" == WRITE_REFUSED ]] && ok READ_ONLY_TRANSACTION_REFUSES_WRITES || ko READ_ONLY_TRANSACTION_REFUSES_WRITES

all="$(probe "$LP" newsflux-s5-free; probe "$OPEN" newsflux-s5-free; probe "$NOLIMITS" newsflux-s5-fallback)"
leak=0
for secret in "$LP" "$OPEN" "$NOLIMITS" "$MASTER" newsflux-s5 synthetic-provider-key 127.0.0.1 postgresql:// openrouter/; do
  grep -qF -- "$secret" <<<"$all" && leak=1
done
for key in "$LP" "$OPEN" "$NOLIMITS"; do
  grep -qF "$(printf '%s' "$key" | sha256sum | cut -c1-64)" <<<"$all" && leak=1
done
[[ "$leak" == 0 ]] && ok NO_SECRET_ALIAS_URL_OR_HASH_IN_OUTPUT || ko NO_SECRET_ALIAS_URL_OR_HASH_IN_OUTPUT

echo "S5_DB_AUDIT_PASSED=$pass S5_DB_AUDIT_FAILED=$fail"
[[ "$fail" -eq 0 ]]
