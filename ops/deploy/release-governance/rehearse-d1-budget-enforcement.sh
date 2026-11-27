#!/usr/bin/env bash
# D1-R6-01: does the exact LiteLLM image ENFORCE a key-level max_budget (not merely store it)?
#
# Disposable lab only: synthetic master key and keys, synthetic Postgres, Docker --internal network (no egress,
# no real provider, nothing is inferred). The only "provider" is a local mock that answers OpenAI-format chat
# completions and counts the requests it receives. Two keys get the same max_budget: one with recorded spend
# above it, one below. Negative control: the first key is refused with budget_exceeded AND the mock receives
# nothing (refused before routing). Positive control (D1-R7): the second key gets HTTP 200 with the mock's own
# reply AND the mock counts exactly one request (admitted at authentication and routed), so a different error
# can never be mistaken for admission.
# Image binding (D1-R7): the default is the production runtime pin of the R5 operator command; the image's
# config digest (the image ID on the OMV's classic store) and its repo digest are both checked.
# A positive budget observed in a read-only receipt is only GATEWAY_POLICY_OBSERVED; it counts as
# GATEWAY_ENFORCEMENT_EVIDENCE only for an image whose enforcement this rehearsal proved.
#
#   bash rehearse-d1-budget-enforcement.sh        # production pin (litellm-database 1.110.0, config 95017a67…)
#   S5R3_LITELLM_IMAGE=<repo>@sha256:<digest> S5R3_EXPECTED_LITELLM_VERSION=<x.y.z> \
#     S5R3_EXPECTED_CONFIG_DIGEST=sha256:<config> bash rehearse-d1-budget-enforcement.sh
#   Prints D1BUDGET <PROBE>=PASS|FAIL lines; exit 0 only if both probes behave and cleanup holds.
set -Eeuo pipefail
umask 022
# Production runtime pin (R5 operator command: --expect-repo-digest / --expect-image-id / --expect-litellm-version).
DEFAULT_LITELLM_IMAGE="ghcr.io/berriai/litellm-database@sha256:eb7a0adff81ce89de44a8985d411b89d628f96d2dfb69e3d55eaf61dd4db143a"
DEFAULT_CONFIG_DIGEST="sha256:95017a6781a986878745e4577172c9f5e74a060d5311491ce452bd9015d2f5ab"
LITELLM_IMAGE="${S5R3_LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then
  LITELLM_VERSION="1.110.0"; CONFIG_DIGEST="$DEFAULT_CONFIG_DIGEST"
else
  LITELLM_VERSION="${S5R3_EXPECTED_LITELLM_VERSION:-}"; CONFIG_DIGEST="${S5R3_EXPECTED_CONFIG_DIGEST:-}"
fi
if [[ ! "$LITELLM_IMAGE" =~ @sha256:[0-9a-f]{64}$ || ! "$LITELLM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ \
      || ! "$CONFIG_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]; then
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
    litellm_params: {model: openai/synthetic-s5, api_base: "http://mock-provider:8080/v1", api_key: synthetic}
  - model_name: other-model
    litellm_params: {model: openai/synthetic-other, api_base: "https://other.invalid/v1", api_key: synthetic}
YAML
chmod 0644 "$work/config.yaml"
MASTER="sk-synthetic-master-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# Names must be provably free: a Docker query that fails is never read as "absent".
docker info >/dev/null 2>&1 || { echo "D1BUDGET DOCKER_UNAVAILABLE=FAIL"; exit 1; }
for name in "$run-pg" "$run-litellm" "$run-mock"; do
  found="$(docker ps -a -q --filter "name=^/$name\$")" || { echo "D1BUDGET OWNERSHIP_CHECK=FAIL"; exit 1; }
  [[ -z "$found" ]] || { echo "D1BUDGET OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
done
found="$(docker network ls -q --filter "name=^$net\$")" || { echo "D1BUDGET OWNERSHIP_CHECK=FAIL"; exit 1; }
[[ -z "$found" ]] || { echo "D1BUDGET OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
docker_used=1
docker image inspect "$LITELLM_IMAGE" >/dev/null 2>&1 || docker pull -q "$LITELLM_IMAGE" >/dev/null
# Config digest = the image ID on a classic Docker store (the OMV pin); read it from the image's own manifest.
config="$(docker save "$LITELLM_IMAGE" | tar -xO manifest.json | python3 -c 'import json,sys; print("sha256:"+json.load(sys.stdin)[0]["Config"].rsplit("/",1)[-1])')"
[[ "$config" == "$CONFIG_DIGEST" ]] || { echo "D1BUDGET LAB_IMAGE_CONFIG_DIGEST=FAIL"; exit 1; }
echo "D1BUDGET LAB_IMAGE_CONFIG_DIGEST=PASS (${config:7:12})"
docker network create --internal --label "$OWNER_LABEL=$nonce" "$net" >/dev/null   # --internal: no egress
pg_id="$(docker run -d --name "$run-pg" --label "$OWNER_LABEL=$nonce" --network "$net" -e POSTGRES_PASSWORD=synthetic -e POSTGRES_DB=litellm "$PG_IMAGE")"
for _ in $(seq 1 30); do docker exec "$pg_id" pg_isready -q -U postgres >/dev/null 2>&1 && break; sleep 1; done
# Local mock provider (same image, its own Python): counts requests, answers a fixed OpenAI-format completion.
mock_id="$(docker run -d --name "$run-mock" --label "$OWNER_LABEL=$nonce" --network "$net" --network-alias mock-provider \
  --entrypoint python3 "$LITELLM_IMAGE" -B -I -c '
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length") or 0))
        print("MOCK_REQUEST", self.path, flush=True)
        body = json.dumps({"id": "mock-1", "object": "chat.completion", "created": 0, "model": "synthetic-s5",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "mock-provider-ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
HTTPServer(("0.0.0.0", 8080), H).serve_forever()')"
mock_requests() { docker logs "$mock_id" 2>/dev/null | grep -c '^MOCK_REQUEST /v1/chat/completions$' || true; }
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

probe() { # name key -> prints "status refused content"
  docker exec -i "$ll_id" python3 -B -I - "$2" <<'PY'
import json, sys, urllib.error, urllib.request
req = urllib.request.Request("http://127.0.0.1:4000/v1/chat/completions", method="POST",
                             data=json.dumps({"model": "newsflux-s5-free", "messages": [{"role": "user", "content": "x"}]}).encode(),
                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + sys.argv[1]})
try:
    with urllib.request.urlopen(req, timeout=40) as resp:
        status, text = resp.status, resp.read(100000).decode("utf-8", "replace")
except urllib.error.HTTPError as error:
    status, text = error.code, error.read(100000).decode("utf-8", "replace")
except Exception:  # noqa: BLE001
    status, text = 0, ""
try:
    doc = json.loads(text)
except ValueError:
    doc = {}
refused = 400 <= status < 500 and isinstance(doc.get("error"), dict) and doc["error"].get("type") == "budget_exceeded"
content = ""
if status == 200:
    try:
        content = doc["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        content = ""
print(status, "YES" if refused else "NO", "MOCK" if content == "mock-provider-ok" else "OTHER")   # never the body
PY
}
keys="$(docker exec -i "$ll_id" python3 -B -I - "$MASTER" <<'PY'
import json, sys, urllib.request
def generate(spend):
    req = urllib.request.Request("http://127.0.0.1:4000/key/generate", method="POST",
        data=json.dumps({"models": ["newsflux-s5-free"], "max_budget": 0.5, "budget_duration": "30d", "spend": spend,
                         "key_alias": f"d1-budget-{spend}"}).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + sys.argv[1]})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return json.loads(resp.read()).get("key", "")
print(generate(1.0), generate(0.0))
PY
)"
read -r over under <<<"$keys"
[[ "$over" == sk-* && "$under" == sk-* ]] && echo "D1BUDGET KEYS_GENERATED=PASS" || { echo "D1BUDGET KEYS_GENERATED=FAIL"; exit 1; }
before="$(mock_requests)"
read -r status refused content <<<"$(probe OVER "$over")"
after="$(mock_requests)"
if [[ "$refused" == YES && "$after" == "$before" ]]; then
  echo "D1BUDGET OVER_BUDGET_REFUSED_BEFORE_ROUTING=PASS (status $status, mock_requests +$((after - before)))"
else
  echo "D1BUDGET OVER_BUDGET_REFUSED_BEFORE_ROUTING=FAIL (status $status, budget_refusal=$refused, mock_requests +$((after - before)))"; rc=1
fi
before="$after"
read -r status refused content <<<"$(probe UNDER "$under")"
after="$(mock_requests)"
if [[ "$status" == 200 && "$content" == MOCK && $((after - before)) == 1 ]]; then
  echo "D1BUDGET UNDER_BUDGET_ADMITTED_AND_ROUTED=PASS (status 200, mock reply, mock_requests +1)"
else
  echo "D1BUDGET UNDER_BUDGET_ADMITTED_AND_ROUTED=FAIL (status $status, content=$content, mock_requests +$((after - before)))"; rc=1
fi
