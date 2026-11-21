#!/usr/bin/env bash
# S5-R3: does a key scoped to exactly one alias keep that scope on every route `llm_api_routes` admits?
#
# Disposable lab only: synthetic master key and key, synthetic Postgres, and a Docker --internal network
# (no egress: nothing can reach ChatGPT or any provider, so nothing is ever inferred). Authentication runs
# before every route handler, so a model-access refusal proves the key scope held on that route; any other
# outcome means authentication let the request through and is reported as SCOPE_NOT_ENFORCED_AT_AUTH.
#
#   S5R3_LITELLM_IMAGE=<repo>@sha256:<digest> S5R3_EXPECTED_LITELLM_VERSION=<x.y.z> bash rehearse-s5-r3-auth-surface.sh
#   (defaults to the pinned 1.109.1 lab image). Prints S5R3AUTH <PROBE>=PASS|FAIL lines; exit 0 only if
#   every other-model probe is refused at authentication, every alias probe is admitted, and cleanup holds. Ownership guard identical to rehearse-s5-r3-readonly-increment.sh.
set -Eeuo pipefail
umask 022
DEFAULT_LITELLM_IMAGE="litellm/litellm@sha256:11175975a3093e05e92faee2fe2fe3412a3ae2fcaa849eb0fe25d5f0d8bcb2e9"
LITELLM_IMAGE="${S5R3_LITELLM_IMAGE:-$DEFAULT_LITELLM_IMAGE}"
if [[ "$LITELLM_IMAGE" == "$DEFAULT_LITELLM_IMAGE" ]]; then LITELLM_VERSION="1.109.1"; else LITELLM_VERSION="${S5R3_EXPECTED_LITELLM_VERSION:-}"; fi
if [[ ! "$LITELLM_IMAGE" =~ @sha256:[0-9a-f]{64}$ || ! "$LITELLM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "S5R3AUTH LAB_IMAGE_PINNED=FAIL"; exit 1
fi
PG_IMAGE="postgres@sha256:f377d590e5474681d4d7838635031a2b50647923b7abfa803ce9b5ff35d5c663"
nonce="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
run="s5r3auth-$(date -u +%Y%m%d%H%M%S)-${nonce:0:6}"
net="$run-net"
OWNER_LABEL="org.newsflux.s5r3auth.owner"
docker_used=0
work=""
rc=0
[[ "$nonce" =~ ^[0-9a-f]{16}$ ]] || { echo "S5R3AUTH NONCE=FAIL"; exit 1; }

cleanup() {
  local status=0 id ids
  if [[ "$docker_used" == 1 ]]; then
    ids="$(docker ps -a -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || status=1
    for id in $ids; do docker rm -f -v "$id" >/dev/null 2>&1 || status=1; done
    ids="$(docker network ls -q --no-trunc --filter "label=$OWNER_LABEL=$nonce")" || status=1
    for id in $ids; do docker network rm "$id" >/dev/null 2>&1 || status=1; done
    [[ "$( { docker ps -a -q --filter "label=$OWNER_LABEL=$nonce"; docker network ls -q --filter "label=$OWNER_LABEL=$nonce"; } | wc -l)" == 0 ]] || status=1
  fi
  if [[ -n "$work" && -d "$work" && "$work" == "${TMPDIR:-/tmp}"/s5r3auth.* ]]; then rm -rf -- "$work" || status=1; fi
  if [[ "$status" == 0 ]]; then echo "S5R3AUTH CLEANUP=PASS"; else echo "S5R3AUTH CLEANUP=FAIL"; fi
  return "$status"
}
finish() { local code=$?; trap - EXIT ERR; set +e; [[ "$code" != 0 ]] && rc=1; cleanup || rc=1; echo "S5R3AUTH_EXIT=$rc"; exit "$rc"; }
trap 'echo "S5R3AUTH SETUP_STEP=FAIL (line $LINENO)"' ERR
trap finish EXIT

work="$(mktemp -d "${TMPDIR:-/tmp}/s5r3auth.XXXXXXXX")"
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
docker info >/dev/null 2>&1 || { echo "S5R3AUTH DOCKER_UNAVAILABLE=FAIL"; exit 1; }
for name in "$run-pg" "$run-litellm"; do
  found="$(docker ps -a -q --filter "name=^/$name\$")" || { echo "S5R3AUTH OWNERSHIP_CHECK=FAIL"; exit 1; }
  [[ -z "$found" ]] || { echo "S5R3AUTH OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
done
found="$(docker network ls -q --filter "name=^$net\$")" || { echo "S5R3AUTH OWNERSHIP_CHECK=FAIL"; exit 1; }
[[ -z "$found" ]] || { echo "S5R3AUTH OWNERSHIP_PREEXISTING=FAIL"; exit 1; }
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
[[ "$ready" == 1 ]] || { echo "S5R3AUTH SETUP_STEP=FAIL (litellm)"; exit 1; }
version="$(docker exec "$ll_id" python3 -B -I -c 'import importlib.metadata as m; print(m.version("litellm"))')"
[[ "$version" == "$LITELLM_VERSION" ]] || { echo "S5R3AUTH LAB_LITELLM_VERSION=FAIL"; exit 1; }
echo "S5R3AUTH LAB_LITELLM_VERSION=PASS ($version)"
egress="$(docker exec "$ll_id" python3 -B -I -c 'import socket
try:
    socket.create_connection(("1.1.1.1", 443), timeout=3); print("OPEN")
except OSError:
    print("BLOCKED")')"
[[ "$egress" == BLOCKED ]] || { echo "S5R3AUTH NO_EGRESS=FAIL"; exit 1; }
echo "S5R3AUTH NO_EGRESS=PASS"

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


status, body = call("POST", "/key/generate", {"models": [ALIAS], "allowed_routes": ["llm_api_routes"], "key_alias": "auth-surface"},
                    {"Authorization": "Bearer " + master}, limit=1_000_000)
key = json.loads(body).get("key", "") if status == 200 else ""
print(f"S5R3AUTH KEY_GENERATED={'PASS' if key else 'FAIL'}")
if not key:
    sys.exit(1)
bearer = {"Authorization": "Bearer " + key}
codex = {"Authorization": "Bearer synthetic-chatgpt-bearer-not-a-key", "x-litellm-api-key": key}
probes = (
    ("CHAT_COMPLETIONS_OTHER", "POST", "/v1/chat/completions", {"model": OTHER, "messages": [{"role": "user", "content": "x"}]}, bearer),
    ("RESPONSES_OTHER", "POST", "/v1/responses", {"model": OTHER, "input": "x"}, bearer),
    ("CODEX_RESPONSES_OTHER", "POST", "/backend-api/codex/responses", {"model": OTHER, "input": "x"}, codex),
    ("CODEX_RESPONSES_ALIAS", "POST", "/backend-api/codex/responses", {"model": ALIAS, "input": "x"}, codex),
    ("ANTHROPIC_PASSTHROUGH_OTHER", "POST", "/anthropic/v1/messages", {"model": OTHER, "max_tokens": 1, "messages": [{"role": "user", "content": "x"}]}, bearer),
    ("GEMINI_PASSTHROUGH_OTHER", "POST", f"/gemini/v1beta/models/{OTHER}:generateContent", {"contents": [{"parts": [{"text": "x"}]}]},
     {"x-goog-api-key": key}),
    ("CHAT_COMPLETIONS_ALIAS", "POST", "/v1/chat/completions", {"model": ALIAS, "messages": [{"role": "user", "content": "x"}]}, bearer),
)
unclassified = 0
for name, method, path, body, headers in probes:
    status, text = call(method, path, body, headers)
    lowered = text.lower()
    if status in (401, 403) and ("model" in lowered and ("not allowed" in lowered or "access" in lowered or "denied" in lowered)):
        verdict = "SCOPE_ENFORCED_AT_AUTH"
    elif status in (401, 403) and ("route" in lowered or "not allowed to call" in lowered):
        verdict = "ROUTE_DENIED_AT_AUTH"
    elif status is None or status == 401:
        verdict = "UNCLASSIFIED_AUTH_OUTCOME" if status == 401 else "NO_RESPONSE"  # never read as enforced
        unclassified += 1
    else:
        verdict = "ADMITTED_AT_AUTH"   # authentication admitted the request; the handler then failed (no egress)
    expected = "ADMITTED_AT_AUTH" if name.endswith("_ALIAS") else "SCOPE_ENFORCED_AT_AUTH"
    ok = verdict == expected
    unclassified += 0 if ok else 1
    # Status and verdict only: never the body (it could echo request data).
    print(f"S5R3AUTH {name}={'PASS' if ok else 'FAIL'} ({verdict}, status {status}, expected {expected})")
sys.exit(1 if unclassified else 0)
PY
