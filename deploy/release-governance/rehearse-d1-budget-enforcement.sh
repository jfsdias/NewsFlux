#!/usr/bin/env bash
# D1-R6-01: does the exact LiteLLM image ENFORCE a key-level max_budget (not merely store it)?
#
# Disposable lab only: synthetic master key and keys, synthetic Postgres, Docker --internal network (no egress,
# nothing is ever inferred). Two keys are generated with the same max_budget: one whose recorded spend is above
# it, one below. Authentication runs before routing, so a budget refusal for the first key and admission at
# authentication for the second prove that the gateway itself enforces key max_budget for this image.
# A positive budget observed in a read-only receipt is only GATEWAY_POLICY_OBSERVED; it counts as
# GATEWAY_ENFORCEMENT_EVIDENCE only for an image whose enforcement this rehearsal proved.
#
#   S5R3_LITELLM_IMAGE=<repo>@sha256:<digest> S5R3_EXPECTED_LITELLM_VERSION=<x.y.z> bash rehearse-d1-budget-enforcement.sh
#   Prints D1BUDGET <PROBE>=PASS|FAIL lines; exit 0 only if both probes behave and cleanup holds.
set -Eeuo pipefail
umask 022
DEFAULT_LITELLM_IMAGE="litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9"
LITELLM_IMAGE="${S5R3_LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then LITELLM_VERSION="1.109.1"; else LITELLM_VERSION="${S5R3_EXPECTED_LITELLM_VERSION:-}"; fi
if [[ ! "$LITELLM_IMAGE" =~ @sha256:[0-9a-f]{64}$ || ! "$LITELLM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "D1BUDGET LAB_IMAGE_PINNED=FAIL"; exit 1
fi
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
run="d1budget-$(date -u +%Y%m%d%H%M%S)-${nonce:0:6}"
net="$run-net"
OWNER_LABEL="org.newsflux.d1budget.owner"
docker_used=0
work=""
rc=0
[[ "$nonce" =~ ^[0-9a-f]{16}$ ]] || { echo "D1BUDGET NONCE=FAIL"; exit 1; }

cleanup() {
  local status=0 id ids
  if [[ "$docker_used" == 1 ]]; then
    ids="$(docker ps -a -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || status=1
    for id in $ids; do docker rm -f -v "$id" >/dev/null 2>&1 || status=1; done
    ids="$(docker network ls -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || status=1
    for id in $ids; do docker network rm "$id" >/dev/null 2>&1 || status=1; done
    [[ "$( { docker ps -a -q --filter "label=$OWNER_LABEL=$nonce"; docker network ls -q --filter "label=$OWNER_LABEL=$nonce"; } | wc -l)" == 0 ]] || status=1
  fi
  if [[ -n "$work" && -d "$work" && "$work" == "${TMPDIR:-/tmp}"/d1budget.* ]]; then rm -rf -- "$work" || status=1; fi
  if [[ "$status" == 0 ]]; then echo "D1BUDGET CLEANUP=PASS"; else echo "D1BUDGET CLEANUP=FAIL"; fi
  return "$status"
}
finish() { local code=$?; trap - EXIT ERR; set +e; [[ "$code" != 0 ]] && rc=1; cleanup || rc=1; echo "D1BUDGET_EXIT=$rc"; exit "$rc"; }
trap 'echo "D1BUDGET SETUP_STEP=FAIL (line $LINENO)"' ERR
trap finish EXIT

work="$(mktemp -d "${TMPDIR:-/tmp}/d1budget.XXXXXXXX")"
cat >"$work/config.yaml" <<'YAML'
model_list:
  - model_name: newsflux-s5-free
    litellm_params: {model: hosted_vllm/synthetic-s5, api_base: "https://s5.invalid/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# Names must be provably free: a Docker query that fails is never read as "absent".
docker info >/dev/null 2>&1 || { echo "D1BUDGET DOCKER_UNAVAILABLE=FAIL"; exit 1; }
for name in "$run-pg" "$run-litellm"; do
  found="$(docker ps -a -q --filter "name=^/$name\$")" || { echo "D1BUDGET OWNERSHIP_CHECK=FAIL"; exit 1; }
  [[ -z "$found" ]] || { echo "D1BUDGET OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
done
found="$(docker network ls -q --filter "name=^$net\$")" || { echo "D1BUDGET OWNERSHIP_CHECK=FAIL"; exit 1; }
[[ -z "$found" ]] || { echo "D1BUDGET OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
docker_used=1
docker network create --internal --label "$OWNER_LABEL=$nonce" "$net" >/dev/null   # --internal: no egress
pg_id="$(docker run -d --name "$run-pg" --label "$OWNER_LABEL=$nonce" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE")"
for _ in $(seq 1 30); do docker exec "$pg_id" pg_isready -q -U postgres >/dev/null 2>&1 && break; sleep 1; done
ll_id="$(docker run -d --name "$run-litellm" --label "$OWNER_LABEL=$nonce" --network "$net" -e LITELLM_MASTER_KEY="$MASTER" \
  -e LITELLM_LOCAL_MODEL_COST_MAP=True -e DATABASE_URL="postgresql://postgres:synthetic@$run-pg:5432/litellm" \
  -v "$work/config.yaml:/app/config.yaml:ro" "$LITELLM_IMAGE" --config /app/config.yaml --port 4000)"
ready=0
for _ in $(seq 1 150); do
  if docker exec "$ll_id" python3 -B -c 'import urllib.request;urllib.request.urlopen("http://127.0.0.1:4000/health/liveliness",timeout=2)' >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { echo "D1BUDGET SETUP_STEP=FAIL (litellm)"; exit 1; }
version="$(docker exec "$ll_id" python3 -B -I -c 'import importlib.metadata as m; print(m.version("litellm"))')"
[[ "$version" == "$LITELLM_VERSION" ]] || { echo "D1BUDGET LAB_LITELLM_VERSION=FAIL"; exit 1; }
echo "D1BUDGET LAB_LITELLM_VERSION=PASS ($version)"
egress="$(docker exec "$ll_id" python3 -B -I -c 'import socket
try:
    socket.create_connection(("1.1.1.1", 443), timeout=3); print("OPEN")
except OSError:
    print("BLOCKED")')"
[[ "$egress" == BLOCKED ]] || { echo "D1BUDGET NO_EGRESS=FAIL"; exit 1; }
echo "D1BUDGET NO_EGRESS=PASS"

docker exec -i "$ll_id" python3 -B -I - "$MASTER" <<'PY' || rc=1
import json, sys, urllib.error, urllib.request
master = sys.argv[1]
BASE = "http://127.0.0.1:4000"
ALIAS, OTHER = "newsflux-s5-free", "other-model"


def call(method, path, body=None, headers=None, limit=4000):
    req = urllib.request.Request(BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers=dict({"Content-Type": "application/json"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            return resp.status, resp.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read(limit).decode("utf-8", "replace")
    except Exception as error:  # noqa: BLE001
        return None, type(error).__name__


def generate(spend):
    status, body = call("POST", "/key/generate", {"models": [ALIAS], "max_budget": 0.5, "budget_duration": "30d",
                        "spend": spend, "key_alias": f"d1-budget-{spend}"}, {"Authorization": "Bearer " + master},
                        limit=1_000_000)
    return json.loads(body).get("key", "") if status == 200 else ""


over, under = generate(1.0), generate(0.0)
print(f"D1BUDGET KEYS_GENERATED={'PASS' if over and under else 'FAIL'}")
if not (over and under):
    sys.exit(1)
failures = 0
for name, key, expect_refused in (("OVER_BUDGET_REFUSED", over, True), ("UNDER_BUDGET_ADMITTED", under, False)):
    status, text = call("POST", "/v1/chat/completions", {"model": ALIAS, "messages": [{"role": "user", "content": "x"}]},
                        {"Authorization": "Bearer " + key})
    try:
        error_type = json.loads(text).get("error", {}).get("type")
    except (ValueError, AttributeError):
        error_type = None
    # LiteLLM answers an exhausted key with a structured 4xx (1.109.1/1.110.0: 422, type budget_exceeded).
    refused = status is not None and 400 <= status < 500 and error_type == "budget_exceeded"
    ok = refused if expect_refused else (status is not None and not refused)
    failures += 0 if ok else 1
    # Status and verdict only; never the body.
    print(f"D1BUDGET {name}={'PASS' if ok else 'FAIL'} (status {status}, budget_refusal={'YES' if refused else 'NO'})")
sys.exit(1 if failures else 0)
PY
